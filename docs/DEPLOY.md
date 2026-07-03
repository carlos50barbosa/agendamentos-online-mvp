# Deploy automatizado (CI/CD)

Pipeline em [.github/workflows/deploy.yml](../.github/workflows/deploy.yml).

## Como funciona

- **Pull Request** → roda `backend-tests` e `frontend-build` (Vite). **Não** faz deploy.
- **Push na `main`** (ou `workflow_dispatch` na `main`) → roda os testes/build e, **se o gate passar**, executa o job `deploy`, que entra por SSH no VPS e roda o `scripts/deploy.sh` já existente (`git pull` → `npm ci` → `pm2 reload` do backend → build + `rsync` do frontend).

**Gate do deploy:** `npm run test:asaas` + `npm run test:plan` (backend) **+** `frontend-build` (Vite). Se qualquer um falhar, o deploy é bloqueado.

Ou seja: **um merge/push na `main` publica sozinho**, e um teste vermelho **trava** o deploy.

## Secrets necessárias (Settings → Secrets and variables → Actions)

| Secret | Obrigatória | Descrição |
|--------|:----------:|-----------|
| `DEPLOY_SSH_HOST` | ✅ | Host/IP do VPS (ex.: `agendamentosonline.com`) |
| `DEPLOY_SSH_USER` | ✅ | Usuário SSH de deploy (ex.: `deploy`) |
| `DEPLOY_SSH_KEY` | ✅ | Chave **privada** SSH (conteúdo do arquivo, PEM/OpenSSH) |
| `DEPLOY_SSH_PORT` | ➖ | Porta SSH (default `22`) |
| `DEPLOY_DIR` | ➖ | Caminho do projeto no VPS (default `/opt/apps/agendamentos-online-mvp`) |
| `DEPLOY_API_URL` | ➖ | Vira `VITE_API_URL` no build do front (default do script: `https://agendamentosonline.com/api`) |
| `DEPLOY_HEALTHCHECK_URL` | ➖ | Se setada, o pipeline faz um smoke check HTTP após o deploy (ex.: `https://agendamentosonline.com/api/webhooks/asaas`) |

### Gerar a chave SSH de deploy

No seu computador:

```bash
ssh-keygen -t ed25519 -C "gha-deploy" -f ./gha_deploy -N ""
```

- Adicione o **público** (`gha_deploy.pub`) ao VPS, no usuário de deploy:
  ```bash
  ssh usuario@host 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys' < gha_deploy.pub
  ```
- Cole o **privado** (`gha_deploy`, arquivo inteiro incl. cabeçalhos) na secret `DEPLOY_SSH_KEY`.
- Apague as cópias locais depois (`rm gha_deploy gha_deploy.pub`).

> O usuário de deploy **não precisa de sudo** (o pipeline não recarrega o Nginx: `NGINX_RELOAD=0`). Se um dia precisar recarregar Nginx no deploy, configure sudo sem senha só para `nginx -t`/`systemctl reload nginx`.

## Aprovação manual (opcional, recomendado para pagamentos)

O job `deploy` usa o environment `production`. Para exigir um clique de aprovação antes de cada publicação:

**Settings → Environments → `production` → Required reviewers** → adicione você mesmo.

Aí todo deploy fica "pausado" aguardando aprovação no GitHub.

## Migrations (passo MANUAL)

O deploy **não** mexe no banco. Antes (ou logo após) publicar mudanças de schema, aplique os `.sql` pendentes no MySQL do servidor, em ordem cronológica pelo nome do arquivo.

Pendente agora (Asaas):

```bash
mysql -u USER -p agendamentos < backend/sql/2026-07-02-add-asaas-columns.sql
```

## `.env` do servidor

O `.env` vive **no VPS** (não no repo) e é relido no `pm2 reload --update-env`. Para ativar o Asaas em produção, adicione ao `.env` do backend:

```
ASAAS_API_KEY=...
ASAAS_ENV=production        # ou sandbox
ASAAS_WEBHOOK_TOKEN=...
# flags de runtime do backend — ligue por fluxo quando validar em sandbox:
DEPOSIT_PROVIDER=asaas
BILLING_PROVIDER=asaas
```

E no painel do Asaas aponte o webhook para `https://SEU_DOMINIO/api/webhooks/asaas` com o mesmo `ASAAS_WEBHOOK_TOKEN`.

## Rollback

```bash
ssh usuario@host
cd /opt/apps/agendamentos-online-mvp
git checkout <commit-anterior>
BRANCH=<commit-anterior> bash scripts/deploy.sh   # ou apenas: bash scripts/deploy.sh após o checkout
```

## Observações

- O workflow `backend.yml` antigo (só `test:plan`) ficou **redundante** — pode ser removido, já que o `deploy.yml` roda `test:plan` + `test:asaas`.
- O deploy roda `scripts/deploy.sh` **sem alterações** — o mesmo script testado no fluxo manual (`scripts/remote-deploy.sh`).
- CI/CD só publica a partir da `main`. PRs/branches recebem só a validação (testes + build).
