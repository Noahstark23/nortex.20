#!/bin/sh
# Smoke destructivo exclusivamente para una BD efímera de GitHub Actions.
set -eu

: "${DATABASE_URL:?Define DATABASE_URL para la BD MySQL 8 desechable}"
: "${LEGACY_SCHEMA_PATH:?Define LEGACY_SCHEMA_PATH con el schema anterior a PR #158}"
: "${NORTEX_ALLOW_DESTRUCTIVE_SCHEMA_SMOKE:?Falta el opt-in destructivo}"

if [ "${GITHUB_ACTIONS:-false}" != "true" ] \
  || [ "$NORTEX_ALLOW_DESTRUCTIVE_SCHEMA_SMOKE" != "issue-159-ci-only" ]; then
  echo "❌ El smoke destructivo solo se permite en GitHub Actions con opt-in explícito."
  exit 64
fi

# Parseo real de URL: no basta que una BD externa comparta el mismo basename.
node -e '
const u = new URL(process.env.DATABASE_URL);
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const dbName = u.pathname.replace(/^\//, "");
if (!localHosts.has(u.hostname) || dbName !== "nortex_deploy_test") {
  console.error("❌ DATABASE_URL debe apuntar a nortex_deploy_test en loopback.");
  process.exit(64);
}
'

CURRENT_SCHEMA="backend/prisma/schema.prisma"
PRISMA_CLI="./node_modules/.bin/prisma"
TSX_CLI="./node_modules/.bin/tsx"
REPRO_LOG="$(mktemp /tmp/nortex-deploy-repro.XXXXXX)"
DUPLICATE_LOG="$(mktemp /tmp/nortex-deploy-duplicates.XXXXXX)"
CROSS_TENANT_LOG="$(mktemp /tmp/nortex-deploy-cross-tenant.XXXXXX)"
RETURN_DUPLICATE_LOG="$(mktemp /tmp/nortex-deploy-return-duplicates.XXXXXX)"
PAYMENT_DUPLICATE_LOG="$(mktemp /tmp/nortex-deploy-payment-duplicates.XXXXXX)"
RACE_ONE_LOG="$(mktemp /tmp/nortex-deploy-race-one.XXXXXX)"
RACE_TWO_LOG="$(mktemp /tmp/nortex-deploy-race-two.XXXXXX)"
TIMEOUT_LOG="$(mktemp /tmp/nortex-deploy-timeout.XXXXXX)"
cleanup_deploy_smoke_logs() {
  rm -f "$REPRO_LOG" "$DUPLICATE_LOG" "$CROSS_TENANT_LOG" \
    "$RETURN_DUPLICATE_LOG" "$PAYMENT_DUPLICATE_LOG" \
    "$RACE_ONE_LOG" "$RACE_TWO_LOG" "$TIMEOUT_LOG"
}
trap cleanup_deploy_smoke_logs EXIT HUP INT TERM

run_ci_entrypoint() {
  # Timeout HOLGADO a propósito (default de prod: 120s): en runners compartidos
  # el db push de instalación fresca roza los 60s y con ese valor el smoke
  # falló por variancia de hardware con un schema idéntico al de corridas
  # verdes previas. Este número protege contra CUELGUES (metadata lock), no
  # mide performance; el mecanismo de kill ya lo prueba la fase dedicada del
  # wrapper con 5s.
  GITHUB_ACTIONS=true \
  NORTEX_SCHEMA_ONLY_FOR_CI=1 \
  DB_PUSH_ATTEMPTS=2 \
  SCHEMA_SYNC_TIMEOUT_SECONDS=180 \
    sh scripts/docker-entrypoint.sh
}

echo "Verificando confinamiento y timeout externo…"
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts empty
TIMEOUT_STATUS=0
node scripts/run-with-timeout.mjs 5 node -e 'setTimeout(() => {}, 10000)' >"$TIMEOUT_LOG" 2>&1 || TIMEOUT_STATUS=$?
sed -n '1,10000p' "$TIMEOUT_LOG"
if [ "$TIMEOUT_STATUS" -ne 124 ]; then
  echo "❌ El wrapper no terminó el proceso bloqueado con exit 124."
  exit 1
fi

echo "Verificando instalación completamente nueva por la ruta real de producción…"
run_ci_entrypoint

echo "Restaurando el schema legado dentro de la BD efímera…"
"$PRISMA_CLI" db push --schema="$LEGACY_SCHEMA_PATH" --skip-generate --force-reset
"$PRISMA_CLI" db execute --schema="$LEGACY_SCHEMA_PATH" --file=tests/fixtures/deploy-schema-existing-data.sql

echo "Reproduciendo el bloqueo original de db push…"
REPRO_STATUS=0
"$PRISMA_CLI" db push --schema="$CURRENT_SCHEMA" --skip-generate >"$REPRO_LOG" 2>&1 || REPRO_STATUS=$?
sed -n '1,10000p' "$REPRO_LOG"
if [ "$REPRO_STATUS" -eq 0 ] || ! grep -Fq -- "--accept-data-loss" "$REPRO_LOG"; then
  echo "❌ No se reprodujo el warning esperado de Prisma."
  exit 1
fi

echo "Aplicando el upgrade por la ruta real del entrypoint…"
run_ci_entrypoint
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts success

echo "Verificando redeploy idempotente…"
run_ci_entrypoint
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts success

echo "Verificando fallo inmediato ante devoluciones con clientEventId duplicado…"
"$PRISMA_CLI" db execute --schema="$CURRENT_SCHEMA" --file=tests/fixtures/deploy-schema-duplicate-product-returns.sql
RETURN_DUPLICATE_STATUS=0
run_ci_entrypoint >"$RETURN_DUPLICATE_LOG" 2>&1 || RETURN_DUPLICATE_STATUS=$?
sed -n '1,10000p' "$RETURN_DUPLICATE_LOG"
if [ "$RETURN_DUPLICATE_STATUS" -eq 0 ] \
  || ! grep -Fq "clientEventId duplicado" "$RETURN_DUPLICATE_LOG" \
  || grep -Fq "reintentando" "$RETURN_DUPLICATE_LOG"; then
  echo "❌ El entrypoint no falló inmediatamente ante devoluciones duplicadas."
  exit 1
fi
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts return-duplicates

echo "Restaurando el fixture de devoluciones y verificando convergencia…"
"$PRISMA_CLI" db execute --schema="$CURRENT_SCHEMA" --file=tests/fixtures/deploy-schema-reset-product-return-duplicates.sql
run_ci_entrypoint
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts success

echo "Verificando fallo inmediato ante abonos con clientEventId duplicado…"
"$PRISMA_CLI" db execute --schema="$CURRENT_SCHEMA" --file=tests/fixtures/deploy-schema-duplicate-payments.sql
PAYMENT_DUPLICATE_STATUS=0
run_ci_entrypoint >"$PAYMENT_DUPLICATE_LOG" 2>&1 || PAYMENT_DUPLICATE_STATUS=$?
sed -n '1,10000p' "$PAYMENT_DUPLICATE_LOG"
if [ "$PAYMENT_DUPLICATE_STATUS" -eq 0 ] \
  || ! grep -Fq "Hay abonos con clientEventId duplicado" "$PAYMENT_DUPLICATE_LOG" \
  || grep -Fq "reintentando" "$PAYMENT_DUPLICATE_LOG"; then
  echo "❌ El entrypoint no falló inmediatamente ante abonos duplicados."
  exit 1
fi
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts payment-duplicates

echo "Restaurando los abonos y verificando convergencia concurrente desde estado parcial…"
"$PRISMA_CLI" db execute --schema="$CURRENT_SCHEMA" --file=tests/fixtures/deploy-schema-reset-payment-duplicates.sql
"$PRISMA_CLI" db execute --schema="$CURRENT_SCHEMA" --file=tests/fixtures/deploy-schema-drop-seller-index.sql
RACE_ONE_STATUS=0
RACE_TWO_STATUS=0
run_ci_entrypoint >"$RACE_ONE_LOG" 2>&1 &
RACE_ONE_PID=$!
run_ci_entrypoint >"$RACE_TWO_LOG" 2>&1 &
RACE_TWO_PID=$!
wait "$RACE_ONE_PID" || RACE_ONE_STATUS=$?
wait "$RACE_TWO_PID" || RACE_TWO_STATUS=$?
sed -n '1,10000p' "$RACE_ONE_LOG"
sed -n '1,10000p' "$RACE_TWO_LOG"
if [ "$RACE_ONE_STATUS" -ne 0 ] || [ "$RACE_TWO_STATUS" -ne 0 ]; then
  echo "❌ Uno de los iniciadores concurrentes no convergió."
  exit 1
fi
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts success

echo "Verificando fallo inmediato ante asignaciones duplicadas…"
"$PRISMA_CLI" db execute --schema="$CURRENT_SCHEMA" --file=tests/fixtures/deploy-schema-duplicate-sellers.sql
DUPLICATE_STATUS=0
run_ci_entrypoint >"$DUPLICATE_LOG" 2>&1 || DUPLICATE_STATUS=$?
sed -n '1,10000p' "$DUPLICATE_LOG"
if [ "$DUPLICATE_STATUS" -eq 0 ] \
  || ! grep -Fq "asignaciones de carga duplicadas" "$DUPLICATE_LOG" \
  || grep -Fq "reintentando" "$DUPLICATE_LOG"; then
  echo "❌ El entrypoint no falló inmediatamente ante duplicados."
  exit 1
fi
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts duplicates

echo "Verificando fallo inmediato ante relación cross-tenant…"
"$PRISMA_CLI" db execute --schema="$CURRENT_SCHEMA" --file=tests/fixtures/deploy-schema-cross-tenant.sql
CROSS_TENANT_STATUS=0
run_ci_entrypoint >"$CROSS_TENANT_LOG" 2>&1 || CROSS_TENANT_STATUS=$?
sed -n '1,10000p' "$CROSS_TENANT_LOG"
if [ "$CROSS_TENANT_STATUS" -eq 0 ] \
  || ! grep -Fq "otro tenant" "$CROSS_TENANT_LOG" \
  || grep -Fq "reintentando" "$CROSS_TENANT_LOG"; then
  echo "❌ El entrypoint no falló inmediatamente ante una relación cross-tenant."
  exit 1
fi
"$TSX_CLI" scripts/verify-deploy-schema-smoke.ts cross-tenant

echo "✅ Smoke MySQL 8: fresh install, upgrade, idempotencia, carrera y fallos cerrados superados."
