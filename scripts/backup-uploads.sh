#!/usr/bin/env bash
# Snapshot diario de backend/uploads (agenda0). Retencao: 14 dias.
# Instalado em /usr/local/bin/ e disparado por /etc/cron.d/agenda0-uploads-backup
set -euo pipefail

SRC=/opt/apps/agendamentos-online-mvp/backend/uploads
DST=/opt/backups/agenda0-uploads
RETENCAO_DIAS=14

[ -d "$SRC" ] || { echo "ERRO: origem ausente: $SRC" >&2; exit 1; }

# Nao gera snapshot de origem vazia. Sem esta guarda, um cenario de perda seria
# arquivado como snapshot vazio e a rotacao apagaria os snapshots bons.
N=$(find "$SRC" -type f | wc -l)
[ "$N" -gt 0 ] || { echo "ERRO: origem vazia ($N arquivos) - abortando para preservar o historico" >&2; exit 1; }

mkdir -p "$DST"
TS=$(date +%Y%m%d-%H%M%S)
TMP="$DST/uploads-$TS.tar.gz.tmp"
FINAL="$DST/uploads-$TS.tar.gz"

tar -czf "$TMP" -C "$(dirname "$SRC")" uploads
tar -tzf "$TMP" >/dev/null          # so publica se o arquivo abre
mv "$TMP" "$FINAL"

# Rotacao restrita ao padrao de nome deste script
find "$DST" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime "+$RETENCAO_DIAS" -delete

echo "[$(date -Is)] ok: $FINAL ($N arquivos, $(du -h "$FINAL" | cut -f1))"
