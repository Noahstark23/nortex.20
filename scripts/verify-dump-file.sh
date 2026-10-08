#!/usr/bin/env bash
#
# verify-dump-file.sh — Valida un dump comprimido ANTES de darlo por bueno.
#
# Un `mysqldump` que muere a mitad (disco lleno, OOM, la BD cortó la conexión)
# deja un archivo que EXISTE y hasta descomprime, pero está truncado. Sin este
# chequeo se subía igual: el backup se veía verde y el día que hiciera falta
# restaurar, no servía. Vive aparte de backup-db.sh para poder probarlo solo
# —incluido el caso negativo— en el CI.
#
# Uso:  scripts/verify-dump-file.sh <dump.sql.gz>
# Env:  BACKUP_REQUIRED_TABLES (default: las tablas fiscales) · BACKUP_MIN_BYTES
# Salida por stdout: "<tablas encontradas>"   (para que el llamador la registre)
#
set -euo pipefail

DUMP_FILE="${1:-}"
[[ -n "$DUMP_FILE" ]] || { echo "❌ Uso: $0 <dump.sql.gz>" >&2; exit 1; }
[[ -f "$DUMP_FILE" ]] || { echo "❌ No existe el dump: $DUMP_FILE" >&2; exit 1; }

REQUIRED_TABLES="${BACKUP_REQUIRED_TABLES:-Tenant User Product Sale SaleItem InvoiceSeries AuditLog}"
MIN_BYTES="${BACKUP_MIN_BYTES:-1024}"

rechazar() { echo "❌ Dump inválido: $1" >&2; exit 1; }

gzip -t "$DUMP_FILE" 2>/dev/null || rechazar "el archivo comprimido está corrupto (gzip -t)."

BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
[[ "$BYTES" -ge "$MIN_BYTES" ]] || rechazar "pesa ${BYTES} bytes (mínimo ${MIN_BYTES}): sospechoso de vacío."

# UNA sola pasada de streaming: los dumps grandes no entran en memoria y una
# segunda pasada duplica el costo de descompresión.
# OJO: `gzip -cd … | grep -q` cierra la tubería en el primer match y con
# `pipefail` eso devuelve 141 (SIGPIPE) aunque el match fuera exitoso. Por eso el
# resumen se arma con awk, que consume todo el flujo.
RESUMEN="$(gzip -cd "$DUMP_FILE" | awk '
    /^CREATE TABLE `/ {
        linea = $0
        sub(/^CREATE TABLE `/, "", linea)
        sub(/`.*$/, "", linea)
        print "TABLA " linea
    }
    /Dump completed/ { cerrado = 1 }
    END { if (cerrado) print "CERRADO" }
')"

# mysqldump escribe "-- Dump completed on …" SOLO al terminar bien: su ausencia
# es la firma de un dump truncado.
grep -qx 'CERRADO' <<< "$RESUMEN" || rechazar "no tiene el cierre de mysqldump (truncado)."

FALTANTES=""
for tabla in $REQUIRED_TABLES; do
  grep -qx "TABLA ${tabla}" <<< "$RESUMEN" || FALTANTES="${FALTANTES} ${tabla}"
done
[[ -z "$FALTANTES" ]] || rechazar "faltan tablas críticas:${FALTANTES}"

grep -c '^TABLA ' <<< "$RESUMEN"
