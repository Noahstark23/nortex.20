#!/bin/bash
# Guarda, consulta y retira la clave de proveedor de QA en el llavero de macOS.
# El valor nunca se muestra, nunca viaja en argumentos y nunca toca el disco del repo.
set -euo pipefail
set +x

SERVICE="${NORTEX_QA_KEYCHAIN_SERVICE:-nortex-qa-anthropic}"
ACCOUNT="${NORTEX_QA_KEYCHAIN_ACCOUNT:-ANTHROPIC_API_KEY}"

usage() {
  cat <<'USAGE'
Uso: scripts/qa/nortexgpt-credential.sh <guardar|estado|retirar> [--reemplazar]

  guardar     Pide la clave con entrada oculta y la escribe en el llavero.
              La clave la lee `security` directamente desde la terminal: no pasa
              por este script, ni por el historial, ni por la línea de comandos.
  estado      Informa presencia, longitud y huella sha256 truncada. Nunca la clave.
  retirar     Borra la entrada del llavero.

Variables opcionales: NORTEX_QA_KEYCHAIN_SERVICE, NORTEX_QA_KEYCHAIN_ACCOUNT.
USAGE
}

require_macos() {
  if ! command -v security >/dev/null 2>&1; then
    echo "Este flujo requiere el llavero de macOS (comando 'security')." >&2
    exit 4
  fi
}

exists() { security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; }

cmd_guardar() {
  if exists && [ "${1:-}" != "--reemplazar" ]; then
    echo "Ya hay una credencial de QA guardada en '$SERVICE'. Usá --reemplazar para sustituirla." >&2
    exit 2
  fi
  echo "Pegá la clave de QA cuando 'security' la pida. No se muestra en pantalla." >&2
  # -w al final: `security` solicita el valor con entrada oculta y lo pide dos veces.
  security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" \
    -D "Nortex QA — clave de proveedor" \
    -j "Sólo evaluación local de NortexGPT. No usar en producción." -w
  echo "Credencial guardada." >&2
  cmd_estado
}

cmd_estado() {
  local key length fingerprint shape
  if ! key="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null)"; then
    printf 'credencial=ausente service=%s account=%s\n' "$SERVICE" "$ACCOUNT"
    return 3
  fi
  length="${#key}"
  fingerprint="$(printf '%s' "$key" | shasum -a 256 | cut -c1-12)"
  case "$key" in sk-ant-*) shape="reconocida" ;; *) shape="no-reconocida" ;; esac
  unset key
  printf 'credencial=presente service=%s account=%s bytes=%s sha256[0:12]=%s forma=%s\n' \
    "$SERVICE" "$ACCOUNT" "$length" "$fingerprint" "$shape"
}

cmd_retirar() {
  if ! exists; then
    echo "No hay credencial guardada en '$SERVICE'." >&2
    return 0
  fi
  security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null
  echo "Credencial retirada de '$SERVICE'." >&2
}

require_macos
case "${1:-}" in
  guardar) shift; cmd_guardar "$@" ;;
  estado)  cmd_estado ;;
  retirar) cmd_retirar ;;
  ""|-h|--help|ayuda) usage ;;
  *) usage; exit 64 ;;
esac
