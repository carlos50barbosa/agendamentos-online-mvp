#!/usr/bin/env bash
set -euo pipefail

# Remote deploy helper
# Usage:
#   scripts/remote-deploy.sh user@host [-p port] [-i identity] [-D /remote/project] [VAR=VALUE ...]
# Examples:
#   scripts/remote-deploy.sh usuario@seu_servidor BRANCH=main API_URL=https://agendamentosonline.com/api
#   scripts/remote-deploy.sh usuario@seu_servidor -i ~/.ssh/id_rsa -p 22 NGINX_RELOAD=1

PORT=22
IDENTITY=""
REMOTE_DIR=/opt/apps/agendamentos-online-mvp

usage(){
  echo "Usage: $0 user@host [-p port] [-i identity] [-D /remote/project] [VAR=VALUE ...]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port) PORT="$2"; shift 2;;
    -i|--identity) IDENTITY="$2"; shift 2;;
    -D|--dir) REMOTE_DIR="$2"; shift 2;;
    -h|--help) usage;;
    --) shift; break;;
    *) break;;
  esac
done

[[ $# -lt 1 ]] && usage
HOST="$1"; shift || true

# Remaining args are VAR=VALUE pairs to pass to remote env
ENVSTR=""
for kv in "$@"; do
  if [[ "$kv" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]]; then
    ENVSTR+="$kv "
  else
    echo "Aviso: ignorando argumento inválido '$kv' (esperado VAR=VAL)" >&2
  fi
done

SSH_OPTS=( -p "$PORT" )
[[ -n "$IDENTITY" ]] && SSH_OPTS+=( -i "$IDENTITY" )

set -x
ssh "${SSH_OPTS[@]}" "$HOST" "cd '$REMOTE_DIR' && ${ENVSTR}bash scripts/deploy.sh"

