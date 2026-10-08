#!/usr/bin/env bash
#
# verify-backup-restore.sh — Prueba que un backup SE PUEDE RESTAURAR.
#
# "Un backup no probado no existe": que el dump se genere y suba no dice nada
# sobre si sirve. Este script lo restaura en una base DESECHABLE y compara el
# resultado contra el origen (tablas y conteos de filas), que es la única
# evidencia real de que el respaldo funciona. Lo corre el CI en cada PR y se
# puede correr a mano en producción contra el dump de anoche.
#
# ── Uso ────────────────────────────────────────────────────────────────────────
#   scripts/verify-backup-restore.sh <dump.sql.gz>
#
# ── Variables ──────────────────────────────────────────────────────────────────
#   RESTORE_DATABASE_URL   mysql://user:pass@host:port/db_desechable   (requerida)
#   SOURCE_DATABASE_URL    origen del dump; si está, compara tablas y conteos
#   BACKUP_RESTORE_FORCE=1 permite restaurar sobre una BD cuyo nombre no dice
#                          "restore"/"test" (ver el guard de abajo)
#
set -euo pipefail

DUMP_FILE="${1:-}"
[[ -n "$DUMP_FILE" ]] || { echo "❌ Uso: $0 <dump.sql.gz>" >&2; exit 1; }
[[ -f "$DUMP_FILE" ]] || { echo "❌ No existe el dump: $DUMP_FILE" >&2; exit 1; }
[[ -n "${RESTORE_DATABASE_URL:-}" ]] || { echo "❌ Falta RESTORE_DATABASE_URL (BD desechable)." >&2; exit 1; }

# Parseo compartido con el backup (maneja `@` en la contraseña y percent-encoding).
# shellcheck source=scripts/db-url.sh
source "$(dirname "$0")/db-url.sh"

parsear_url_mysql "$RESTORE_DATABASE_URL" DEST

# ── Guard de seguridad ─────────────────────────────────────────────────────────
# Este script hace DROP DATABASE. Apuntarlo por error a producción sería el peor
# desenlace posible para una herramienta cuyo propósito es proteger los datos.
if [[ "${BACKUP_RESTORE_FORCE:-0}" != "1" ]]; then
  case "$DEST_NAME" in
    *restore*|*test*|*tmp*|*scratch*) ;;
    *) echo "❌ Me niego a borrar la base '${DEST_NAME}': el nombre no parece desechable." >&2
       echo "   Usá una BD con 'restore'/'test'/'tmp' en el nombre, o exportá BACKUP_RESTORE_FORCE=1." >&2
       exit 1 ;;
  esac
fi

if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  parsear_url_mysql "$SOURCE_DATABASE_URL" ORIG
  if [[ "$ORIG_HOST" == "$DEST_HOST" && "$ORIG_PORT" == "$DEST_PORT" && "$ORIG_NAME" == "$DEST_NAME" ]]; then
    echo "❌ El destino de la restauración es la MISMA base que el origen. Abortado." >&2
    exit 1
  fi
fi

# Recién acá el chequeo de herramientas: los guards de seguridad se evalúan
# SIEMPRE, incluso en una máquina sin el cliente mysql instalado.
command -v mysql >/dev/null || { echo "❌ El cliente mysql no está instalado." >&2; exit 1; }

# Contraseña por archivo 0600: nunca en argv (se vería en `ps`).
CNF_DEST="$(mktemp)"; chmod 600 "$CNF_DEST"
limpiar() { rm -f "$CNF_DEST" "${CNF_ORIG:-}"; }
trap limpiar EXIT
escribir_cnf "$CNF_DEST" "$DEST_USER" "$DEST_PASS" "$DEST_HOST" "$DEST_PORT"

mysql_dest() { mysql --defaults-extra-file="$CNF_DEST" "$@"; }

# ── 1 · Base desechable limpia ─────────────────────────────────────────────────
echo "→ Recreando la base desechable '${DEST_NAME}'…"
mysql_dest -e "DROP DATABASE IF EXISTS \`${DEST_NAME}\`; CREATE DATABASE \`${DEST_NAME}\` CHARACTER SET utf8mb4;"

# ── 2 · Restaurar ──────────────────────────────────────────────────────────────
echo "→ Restaurando ${DUMP_FILE}…"
gzip -cd "$DUMP_FILE" | mysql_dest "$DEST_NAME"

# ── 3 · Inventario de lo restaurado ────────────────────────────────────────────
# COUNT(*) real por tabla: information_schema.TABLE_ROWS es una ESTIMACIÓN en
# InnoDB y puede diferir por miles de filas — inútil para comparar.
conteos() {
  local cnf="$1" db="$2" tablas t
  tablas="$(mysql --defaults-extra-file="$cnf" -N -B -e \
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;")"
  for t in $tablas; do
    printf '%s %s\n' "$t" "$(mysql --defaults-extra-file="$cnf" -N -B -e "SELECT COUNT(*) FROM \`${db}\`.\`${t}\`;")"
  done
}

CONTEOS_DEST="$(conteos "$CNF_DEST" "$DEST_NAME")"
TABLAS_DEST="$(grep -c . <<< "$CONTEOS_DEST" || true)"
FILAS_DEST="$(awk '{s+=$2} END {print s+0}' <<< "$CONTEOS_DEST")"
echo "✓ Restaurado: ${TABLAS_DEST} tablas, ${FILAS_DEST} filas."

[[ "$TABLAS_DEST" -gt 0 ]] || { echo "❌ La restauración dejó la base VACÍA." >&2; exit 1; }

# ── 4 · Comparación contra el origen (la prueba de verdad) ─────────────────────
if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  CNF_ORIG="$(mktemp)"; chmod 600 "$CNF_ORIG"
  escribir_cnf "$CNF_ORIG" "$ORIG_USER" "$ORIG_PASS" "$ORIG_HOST" "$ORIG_PORT"
  CONTEOS_ORIG="$(conteos "$CNF_ORIG" "$ORIG_NAME")"

  if ! DIFERENCIAS="$(diff <(echo "$CONTEOS_ORIG") <(echo "$CONTEOS_DEST"))"; then
    echo "❌ La base restaurada NO coincide con el origen:" >&2
    echo "$DIFERENCIAS" >&2
    echo "   (< origen · > restaurado)" >&2
    exit 1
  fi
  echo "✓ Tablas y conteos idénticos al origen."
fi

# ── 5 · Tablas fiscales presentes ──────────────────────────────────────────────
REQUERIDAS="${BACKUP_REQUIRED_TABLES:-Tenant User Product Sale SaleItem InvoiceSeries AuditLog}"
FALTANTES=""
for tabla in $REQUERIDAS; do
  grep -qE "^${tabla} " <<< "$CONTEOS_DEST" || FALTANTES="${FALTANTES} ${tabla}"
done
[[ -z "$FALTANTES" ]] || { echo "❌ Faltan tablas críticas tras restaurar:${FALTANTES}" >&2; exit 1; }

echo "✅ Backup RESTAURABLE y verificado."
