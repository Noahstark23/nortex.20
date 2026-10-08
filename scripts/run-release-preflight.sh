#!/bin/sh
set -eu

# Ejecuta la parte local y no destructiva de la compuerta antes de crear el
# commit candidato. La integración usa MySQL 8 efímero local; la salud por SHA
# sigue siendo evidencia remota porque requiere un deployment ya iniciado.
# DATABASE_URL solo se usa para generar los tipos de Prisma; no abre conexión.
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL='mysql://u:p@localhost:3306/nortex_release_types'
  export DATABASE_URL
fi

git diff --check
npm audit --omit=dev --audit-level=moderate
npx --no-install prisma generate --schema=backend/prisma/schema.prisma
npx --no-install tsc --noEmit
npm test
# La cobertura de dinero/inventario no es opcional en un candidato de release:
# esta compuerta usa MySQL 8 desechable y falla por suites ausentes u omitidas.
npm run test:integration:required
npm run check:design
npm run test:mutation
npm run build:seo

printf '%s\n' 'Release preflight local OK. Aún falta la evidencia remota del SHA exacto, staging y la autorización manual antes de promover.'
