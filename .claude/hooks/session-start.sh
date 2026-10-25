#!/bin/bash
# Prepara as sessões do Claude Code na nuvem: instala as dependências e o
# Postgres usado por scripts/testar-banco.sh. No computador local não faz nada.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund

if ! ls /usr/lib/postgresql/*/bin/initdb >/dev/null 2>&1; then
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null) \
    || echo "Aviso: não consegui instalar o Postgres; scripts/testar-banco.sh não vai rodar." >&2
fi
