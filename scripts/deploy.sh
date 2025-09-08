#!/usr/bin/env bash
set -euo pipefail

# Deploy Agendamentos Online — VPS script
#
# Defaults (override via env or flags):
#   PROJECT_DIR=/opt/apps/agendamentos-online-mvp
#   FRONT_DIR="$PROJECT_DIR/frontend"
#   BACK_DIR="$PROJECT_DIR/backend"
#   DOCROOT=/var/www/agendamentosonline.com
#   API_URL=https://agendamentosonline.com/api
#   PM2_PROCESS=agendamento-api
#   BRANCH=(current)
#   NGINX_RELOAD=0
#   SKIP_BACKEND=0
#   SKIP_FRONTEND=0
#
# Usage examples:
#   API_URL=https://agendamentosonline.com/api ./scripts/deploy.sh
#   BRANCH=main NGINX_RELOAD=1 ./scripts/deploy.sh

PROJECT_DIR=${PROJECT_DIR:-/opt/apps/agendamentos-online-mvp}
FRONT_DIR=${FRONT_DIR:-"$PROJECT_DIR/frontend"}
BACK_DIR=${BACK_DIR:-"$PROJECT_DIR/backend"}
DOCROOT=${DOCROOT:-/var/www/agendamentosonline.com}
API_URL=${API_URL:-https://agendamentosonline.com/api}
PM2_PROCESS=${PM2_PROCESS:-agendamento-api}
BRANCH=${BRANCH:-}
NGINX_RELOAD=${NGINX_RELOAD:-0}
SKIP_BACKEND=${SKIP_BACKEND:-0}
SKIP_FRONTEND=${SKIP_FRONTEND:-0}

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
  echo "==> Publicando dist/ em $DOCROOT"
  rsync -avz --delete dist/ "$DOCROOT/"
else
  echo "==> (PULANDO frontend)"
fi

if [[ "$NGINX_RELOAD" == "1" ]]; then
  echo "==> Testando e recarregando Nginx"
  sudo nginx -t && sudo systemctl reload nginx
fi

echo "==> Deploy concluído com sucesso."

