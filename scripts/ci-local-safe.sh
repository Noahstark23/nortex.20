#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" != "22" ]; then
  printf 'ERROR: Nortex requiere Node 22; versión activa: %s\n' "$(node --version)" >&2
  printf '%s\n' 'Usa: mise exec node@22.23.2 -- sh scripts/ci-local-safe.sh' >&2
  exit 1
fi

# Prisma solo necesita una URL sintácticamente válida para generar tipos.
# Esta URL no se usa para desplegar ni modificar ninguna base remota.
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL='mysql://u:p@127.0.0.1:3307/nortex_ci_types'
  export DATABASE_URL
fi

git diff --check
npx --no-install prisma generate --schema=backend/prisma/schema.prisma
npx --no-install tsc --noEmit
npm test
npm run check:design

if [ "${NORTEX_CI_MUTATION:-0}" = "1" ]; then
  npm run test:mutation
fi

if [ "${NORTEX_CI_SEO:-0}" = "1" ]; then
  npm run build:seo
else
  npm run build
fi

printf '%s\n' 'CI local OK: no se ejecutó deploy, webhook, push ni mutación de BD.'
