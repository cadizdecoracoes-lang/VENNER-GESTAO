#!/bin/bash
# Aplica as migrações e roda os testes do banco num Postgres temporário,
# na mesma ordem do GitHub (.github/workflows/ci.yml). Não toca no Supabase.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
if [ -z "$bin" ] || [ ! -x "$bin/initdb" ]; then
  echo "Postgres não encontrado (instale o pacote postgresql)." >&2
  exit 1
fi

dados="$(mktemp -d)"
porta="${PORTA_TESTE:-5499}"
dono="$(id -un)"
como() { if [ "$dono" = root ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$dono" = root ] && chown postgres "$dados"

trap 'como "\"$bin/pg_ctl\" -D \"$dados\" -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$dados"' EXIT
como "\"$bin/initdb\" -D \"$dados\" -U postgres -A trust" >/dev/null
como "\"$bin/pg_ctl\" -D \"$dados\" -o '-p $porta -k /tmp -c listen_addresses=' -l \"$dados/log\" -w start" >/dev/null

cd "$raiz"
for f in supabase/tests/00_stub_supabase.sql supabase/migrations/*.sql supabase/tests/[1-9]*.sql; do
  echo "== $f"
  if ! psql -h /tmp -p "$porta" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -o /dev/null -f "$f" 2>"$dados/erro"; then
    grep -v 'NOTICE:' "$dados/erro" >&2
    echo "FALHOU em $f" >&2
    exit 1
  fi
done
echo "Banco: todas as migrações e testes passaram."
