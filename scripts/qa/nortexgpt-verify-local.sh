#!/bin/sh
# Verificación local de la configuración de QA de NortexGPT.
#
#   sh scripts/qa/nortexgpt-verify-local.sh
#
# Ejecuta la compuerta canónica del repositorio y la prueba del lanzador con una
# credencial sintética. No hace deploy, push, merge, ni toca bases reales; no usa
# la credencial real ni llama al proveedor. Deja los registros en
# docs/evidence/nortexgpt/evaluation-20260908/ para poder auditar el resultado.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
EVIDENCE="docs/evidence/nortexgpt/evaluation-20260908"
mkdir -p "$EVIDENCE" reports/assistant-evaluation

RUNNER=""
if command -v mise >/dev/null 2>&1; then RUNNER="mise exec --"; fi
NODE_VERSION=$($RUNNER node --version 2>/dev/null || node --version)
printf 'Node activo: %s (esperado v22.23.2)\n' "$NODE_VERSION"

# Estado del árbol antes y después: esta verificación no debe alterar nada del usuario.
git status --short --branch > "$EVIDENCE/git-status-before.log"

status_gate="no_ejecutada"
status_selftest="no_ejecutada"

printf '\n== Compuerta canónica (prisma generate, tsc, vitest, diseño, build) ==\n'
if $RUNNER sh scripts/ci-local-safe.sh > "$EVIDENCE/gates.log" 2>&1; then
  status_gate="aprobada"
else
  status_gate="fallida"
fi
tail -n 25 "$EVIDENCE/gates.log" || true
printf 'compuerta: %s (registro completo en %s/gates.log)\n' "$status_gate" "$EVIDENCE"

printf '\n== Prueba del lanzador con credencial sintética (llavero real de macOS) ==\n'
if $RUNNER node scripts/qa/nortexgpt-launcher-selftest.mjs \
     --report "$EVIDENCE/launcher-selftest.json" > "$EVIDENCE/launcher-selftest.log" 2>&1; then
  status_selftest="aprobada"
else
  status_selftest="fallida"
fi
cat "$EVIDENCE/launcher-selftest.log" || true

git status --short --branch > "$EVIDENCE/git-status-after.log"

printf '\n== Resumen ==\n'
printf 'compuerta_canonica=%s\n' "$status_gate"
printf 'prueba_del_lanzador=%s\n' "$status_selftest"
printf 'llamadas_al_proveedor=0\n'
printf 'revision_humana=pendiente\n'
printf '\nEvidencia en %s\n' "$EVIDENCE"

[ "$status_gate" = "aprobada" ] && [ "$status_selftest" = "aprobada" ] || exit 1
