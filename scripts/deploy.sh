#!/usr/bin/env bash
set -euo pipefail

# Deploy Agendamentos Online — VPS script
#
# Defaults (override via env or flags):
#   PROJECT_DIR=/opt/apps/agendamentos-online-mvp
#   FRONT_DIR="$PROJECT_DIR/frontend"
#   BACK_DIR="$PROJECT_DIR/backend"
#   DOCROOT="$FRONT_DIR/dist"   (o nginx serve o dist direto; veja a nota abaixo)
#   API_URL=https://agenda0.com.br/api
#   PM2_PROCESS=agendamento-api
#   BRANCH=(current)
#   NGINX_RELOAD=0
#   SKIP_BACKEND=0
#   SKIP_FRONTEND=0
#
# Usage examples:
#   API_URL=https://agenda0.com.br/api ./scripts/deploy.sh
#   BRANCH=main NGINX_RELOAD=1 ./scripts/deploy.sh

PROJECT_DIR=${PROJECT_DIR:-/opt/apps/agendamentos-online-mvp}
FRONT_DIR=${FRONT_DIR:-"$PROJECT_DIR/frontend"}
BACK_DIR=${BACK_DIR:-"$PROJECT_DIR/backend"}
# Default = o proprio dist. O nginx da VPS tem `root .../frontend/dist`, entao o build
# ja publica no lugar certo. Defina DOCROOT explicitamente so' se o servidor web servir
# de um diretorio separado (ai o rsync abaixo entra em acao).
DOCROOT=${DOCROOT:-"$FRONT_DIR/dist"}
API_URL=${API_URL:-https://agenda0.com.br/api}
PM2_PROCESS=${PM2_PROCESS:-agendamento-api}
BRANCH=${BRANCH:-}
NGINX_RELOAD=${NGINX_RELOAD:-0}
SKIP_BACKEND=${SKIP_BACKEND:-0}
SKIP_FRONTEND=${SKIP_FRONTEND:-0}
LOCK_FILE=${LOCK_FILE:-/var/lock/deploy-agendamentos.lock}
LOCK_TIMEOUT=${LOCK_TIMEOUT:-900}

# Exclusao mutua entre deploys. Dois deploys simultaneos no mesmo diretorio se atropelam:
# `git pull`, `npm ci` e `npm run build` disputam a mesma arvore e o resultado e' um deploy
# que falha no meio (aconteceu em 18/07/2026, um deploy manual colidindo com o do CI).
#
# Reexecuta o script sob flock. DEPLOY_LOCKED evita recursao infinita na segunda entrada.
if [[ "${DEPLOY_LOCKED:-}" != "1" ]]; then
  if command -v flock >/dev/null 2>&1; then
    echo "==> Aguardando lock de deploy ($LOCK_FILE, timeout ${LOCK_TIMEOUT}s)"
    # --conflict-exit-code separa "nao consegui o lock" (75) de "o deploy falhou" (1).
    # Sem isso o flock sai 1 mudo e o CI mostra uma falha sem causa aparente.
    set +e
    env DEPLOY_LOCKED=1 flock --timeout "$LOCK_TIMEOUT" --conflict-exit-code 75 \
      "$LOCK_FILE" "$0" "$@"
    rc=$?
    set -e
    if [[ $rc -eq 75 ]]; then
      echo "Erro: outro deploy esta em andamento (lock $LOCK_FILE nao liberou em ${LOCK_TIMEOUT}s)." >&2
      echo "      Aguarde o deploy atual terminar e rode de novo." >&2
    fi
    exit $rc
  fi
  echo "AVISO: flock indisponivel — seguindo SEM protecao contra deploy concorrente." >&2
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "Erro: comando '$1' não encontrado." >&2; exit 1; }; }

echo "==> Verificando dependências..."
need git; need npm; need rsync; need pm2

echo "==> Indo para o projeto: $PROJECT_DIR"
cd "$PROJECT_DIR"

if [[ -n "$BRANCH" ]]; then
  echo "==> Checando branch $BRANCH"; git fetch --all --prune; git checkout "$BRANCH"
fi

echo "==> Atualizando repositório (git pull)"
git fetch --all --prune
git pull --ff-only

if [[ "$SKIP_BACKEND" != "1" ]]; then
  echo "==> Backend: instalando dependências (npm ci)"
  cd "$BACK_DIR"
  npm ci
  # Migrações pendentes ANTES de recarregar a API (set -e aborta o deploy se falhar,
  # evitando recarregar a API contra um schema desatualizado). Bootstrap (uma vez, no VPS):
  #   mysql -u<user> -p <db> < backend/sql/2026-07-05-add-asaas-split-sinal.sql   # aplica a pendente
  #   node scripts/migrate.mjs --baseline                                          # registra o histórico
  echo "==> Backend: aplicando migrações pendentes"
  node scripts/migrate.mjs
  echo "==> Backend: recarregando PM2 ($PM2_PROCESS)"
  pm2 reload "$PM2_PROCESS" --update-env
else
  echo "==> (PULANDO backend)"
fi

if [[ "$SKIP_FRONTEND" != "1" ]]; then
  echo "==> Frontend: instalando dependências (npm ci)"
  cd "$FRONT_DIR"
  npm ci
  echo "==> Frontend: build com VITE_API_URL=$API_URL"
  export VITE_API_URL="$API_URL"
  npm run build

  # Na VPS o nginx aponta o `root` direto para $FRONT_DIR/dist, entao o build ja
  # publica sozinho e o rsync abaixo so criava uma copia morta em outro diretorio
  # (que ninguem servia). Se DOCROOT for o proprio dist, um `rsync --delete dist/ dist/`
  # seria o diretorio sobre si mesmo — pular e' obrigatorio, nao so' otimizacao.
  DIST_DIR="$(cd dist && pwd -P)"
  DOCROOT_REAL="$(cd "$DOCROOT" 2>/dev/null && pwd -P || echo "$DOCROOT")"
  if [[ "$DIST_DIR" == "$DOCROOT_REAL" ]]; then
    echo "==> DOCROOT e' o proprio dist/ ($DIST_DIR) — build ja publicado, nada a copiar"
  else
    echo "==> Publicando dist/ em $DOCROOT"
    rsync -avz --delete dist/ "$DOCROOT/"
  fi
else
  echo "==> (PULANDO frontend)"
fi

if [[ "$NGINX_RELOAD" == "1" ]]; then
  echo "==> Testando e recarregando Nginx"
  sudo nginx -t && sudo systemctl reload nginx
fi

echo "==> Deploy concluído com sucesso."

