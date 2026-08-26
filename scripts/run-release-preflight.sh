#!/bin/sh
set -eu

# Ejecuta la parte local y no destructiva de la compuerta antes de crear el
# commit candidato. Los smokes de MySQL 8 y salud por SHA viven en CI porque
# requieren una base efímera y un deployment ya iniciado, respectivamente.
# DATABASE_URL solo se usa para generar los tipos de Prisma; no abre conexión.
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL='mysql://u:p@localhost:3306/nortex_release_types'
  export DATABASE_URL
fi

git diff --check
npm audit --omit=dev --audit-level=moderate
npx --no-install prisma generate --schema=backend/prisma/schema.prisma
npx tsc --noEmit
npm test
npm run check:design
npm run test:mutation
npm run build:seo

printf '%s\n' 'Release preflight local OK. Faltan los smokes CI de MySQL 8 y salud por SHA antes de promover.'
