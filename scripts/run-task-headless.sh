#!/usr/bin/env bash
#
# run-task-headless.sh
# ---------------------------------------------------------------------------
# Orquesta una tarea del agente en modo headless con aislamiento por rama de Git:
#
#   1. Valida que exista tasks/current.md (si no, aborta).
#   2. Lee el ID y el contenido de la tarea.
#   3. Crea e intercambia a una rama limpia  agent/task-<ID>.
#   4. Invoca a Claude Code en modo headless con el contenido de la tarea.
#   5. Ejecuta  npm test.
#   6. Si los tests fallan, le pasa las últimas 20 líneas del error a Claude para
#      que intente autorepararse (máximo 2 reintentos).
#   7. Si los tests pasan, commitea y deja preparado (sin ejecutar) el push.
#
# Uso:  scripts/run-task-headless.sh
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Configuración --------------------------------------------------------
MAX_RETRIES=2
TASK_FILE="tasks/current.md"

# Posicionarse siempre en la raíz del repositorio para que las rutas relativas
# (tasks/current.md, etc.) funcionen sin importar desde dónde se invoque.
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

TEST_LOG="$(mktemp -t run-task-test.XXXXXX.log)"
cleanup() { rm -f "$TEST_LOG"; }
trap cleanup EXIT

log() { printf '\033[1;34m[run-task]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[run-task][error]\033[0m %s\n' "$*" >&2; }

# --- 1. Validar tasks/current.md -----------------------------------------
if [[ ! -f "$TASK_FILE" ]]; then
  err "No existe '$TASK_FILE'. Copiá tasks/queue.md a $TASK_FILE y completá la tarea."
  exit 1
fi

# --- 2. Leer ID y contenido ----------------------------------------------
TASK_CONTENT="$(cat "$TASK_FILE")"

TASK_ID="$(grep -m1 -E '^[[:space:]]*ID_TAREA:' "$TASK_FILE" \
            | cut -d':' -f2- \
            | tr -d '[:space:]' || true)"

if [[ -z "$TASK_ID" ]]; then
  err "No se pudo leer 'ID_TAREA:' desde $TASK_FILE. Completá ese campo (ej: ID_TAREA: 001)."
  exit 1
fi

# Sanitizar: solo permitir caracteres válidos para un nombre de rama de Git.
if [[ ! "$TASK_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  err "ID_TAREA inválido ('$TASK_ID'). Usá solo letras, números, '.', '_' o '-'."
  exit 1
fi

BRANCH="agent/task-${TASK_ID}"
log "Tarea: $TASK_ID  ->  rama: $BRANCH"

# --- 3. Crear e intercambiar a una rama limpia ---------------------------
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  err "La rama '${BRANCH}' ya existe. Eliminala con 'git branch -D ${BRANCH}' o cambiá el ID."
  exit 1
fi

log "Creando y cambiando a la rama '${BRANCH}'..."
git checkout -b "$BRANCH"

# --- Helpers headless de Claude ------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  err "El CLI 'claude' no está instalado o no está en PATH. Instalá Claude Code para continuar."
  exit 1
fi

# Invoca a Claude en modo headless con la instrucción recibida por argumento.
run_claude() {
  local prompt="$1"
  log "Invocando a Claude Code en modo headless..."
  claude -p "$prompt"
}

# Ejecuta npm test capturando salida a $TEST_LOG. Devuelve el código de salida
# real de npm (no el de tee). Pensada para usarse como condición de un if/while,
# contexto en el que 'set -e' queda suspendido y no aborta ante un test fallido.
run_tests() {
  log "Ejecutando 'npm test'..."
  npm test 2>&1 | tee "$TEST_LOG"
  return "${PIPESTATUS[0]}"
}

# --- 4. Primera invocación headless --------------------------------------
run_claude "$TASK_CONTENT"

# --- 5 y 6. Tests + bucle de autoreparación ------------------------------
attempt=0
while true; do
  if run_tests; then
    log "Tests OK."
    break
  fi

  if [[ "$attempt" -ge "$MAX_RETRIES" ]]; then
    err "Los tests siguen fallando tras $MAX_RETRIES reintento(s). Abortando."
    exit 1
  fi

  attempt=$((attempt + 1))
  log "Tests fallaron. Intento de autoreparación $attempt/$MAX_RETRIES..."

  LAST_ERRORS="$(tail -n 20 "$TEST_LOG")"
  run_claude "$(printf '%s\n\nLos tests de la tarea %s fallaron. A continuación las últimas 20 líneas del error de "npm test". Corregí el código para que todos los tests pasen.\n\n--- ERROR ---\n%s' \
      "$TASK_CONTENT" "$TASK_ID" "$LAST_ERRORS")"
done

# --- 7. Commit + push preparado (sin ejecutar) ---------------------------
git add -A
if git diff --cached --quiet; then
  log "No hay cambios para commitear (el agente no modificó archivos)."
else
  git commit -m "feat(agent): finalizada tarea ${TASK_ID}"
  log "Commit creado: feat(agent): finalizada tarea ${TASK_ID}"
fi

log "Flujo completado. La rama '${BRANCH}' está lista."
log "Para publicarla, revisá los cambios y ejecutá manualmente:"
printf '\n    git push -u origin %s\n\n' "$BRANCH"
