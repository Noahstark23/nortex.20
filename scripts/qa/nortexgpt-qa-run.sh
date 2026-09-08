#!/bin/bash
# Lanzador de QA: carga la clave del proveedor desde el llavero de macOS y la deja
# únicamente en el entorno del proceso que la necesita.
#
#   scripts/qa/nortexgpt-qa-run.sh <comando> [args...]
#
# Garantías:
# - La clave no se imprime, no se escribe en disco y no viaja en argumentos.
# - `exec` reemplaza este shell: no queda un proceso padre con el secreto en memoria.
# - Sin credencial el lanzador falla cerrado (código 3) y no arranca el comando:
#   una consulta sin clave devolvería el respaldo determinista y gastaría un turno.
set -euo pipefail
set +x

SERVICE="${NORTEX_QA_KEYCHAIN_SERVICE:-nortex-qa-anthropic}"
ACCOUNT="${NORTEX_QA_KEYCHAIN_ACCOUNT:-ANTHROPIC_API_KEY}"

if [ "$#" -eq 0 ]; then
  cat <<'USAGE' >&2
Uso: scripts/qa/nortexgpt-qa-run.sh <comando> [args...]

Ejemplos:
  scripts/qa/nortexgpt-qa-run.sh node scripts/qa/nortexgpt-eval-server.mjs --allow-provider
  scripts/qa/nortexgpt-qa-run.sh node scripts/qa/nortexgpt-credential-probe.mjs

Guardá la credencial antes con: scripts/qa/nortexgpt-credential.sh guardar
USAGE
  exit 64
fi

if ! command -v security >/dev/null 2>&1; then
  echo "Este lanzador requiere el llavero de macOS (comando 'security')." >&2
  exit 4
fi

if ! ANTHROPIC_API_KEY="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null)"; then
  cat <<EOFERR >&2
No hay credencial de QA en el llavero (service=$SERVICE, account=$ACCOUNT).
Guardala con:  scripts/qa/nortexgpt-credential.sh guardar
No se ejecutó "$1": una consulta sin clave produce el respaldo determinista.
EOFERR
  exit 3
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "La credencial de QA está vacía; volvé a guardarla antes de continuar." >&2
  unset ANTHROPIC_API_KEY
  exit 3
fi

export ANTHROPIC_API_KEY
# El secreto queda sólo en el entorno de este proceso, que ahora pasa a ser el comando.
exec "$@"
