#!/usr/bin/env bash
#
# backup-db.sh — Backup diario de la base de datos MySQL de Nortex a almacenamiento
# SEPARADO del Droplet principal (Capa 6 del Security & Integrity Loop).
#
# Por qué: hoy `db` y `app` corren en el mismo docker-compose, con el volumen local
# `mysql_data`. Si el Droplet muere, se pierde TODO. Este script saca un dump
# consistente y lo sube a un bucket S3-compatible (DigitalOcean Spaces / AWS S3),
# fuera del servidor, con retención y alerta ante fallo.
#
# NINGÚN secreto vive en este script — todo viene de variables de entorno.
#
# ── Variables de entorno requeridas ────────────────────────────────────────────
#   DATABASE_URL            mysql://user:pass@host:port/dbname   (o usar MYSQL_* abajo)
#     (alternativa)         MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE
#   BACKUP_S3_BUCKET        s3://mi-bucket-backups/nortex        (destino off-site)
#   BACKUP_S3_ENDPOINT      https://nyc3.digitaloceanspaces.com  (endpoint S3-compatible)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY                    (credenciales del bucket)
# ── Opcionales ─────────────────────────────────────────────────────────────────
#   BACKUP_DIR              dir local temporal (default /var/backups/nortex)
#   BACKUP_KEEP_DAYS        retención local en días (default 7)
#   BACKUP_ALERT_WEBHOOK    URL (Slack/Discord/genérica) para avisar si FALLA
#
# ── Uso (cron diario 02:30, fuera de horario pico) ─────────────────────────────
#   30 2 * * *  /ruta/a/scripts/backup-db.sh >> /var/log/nortex-backup.log 2>&1
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nortex}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# ── Alerta ante fallo: cualquier error dispara el trap, avisa y sale ≠ 0 ────────
fail() {
  local msg="❌ Nortex DB backup FALLÓ (${TIMESTAMP}): $1"
  echo "$msg" >&2
  if [[ -n "${BACKUP_ALERT_WEBHOOK:-}" ]]; then
    local safe_msg="${msg//\"/}"   # quitar comillas: el mensaje es interno/controlado
    curl -fsS -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"${safe_msg}\"}" "$BACKUP_ALERT_WEBHOOK" || true
  fi
  exit 1
}
trap 'fail "línea $LINENO"' ERR

# ── Resolver credenciales de la BD ─────────────────────────────────────────────
# Preferimos DATABASE_URL (mysql://user:pass@host:port/db); si no, MYSQL_*.
if [[ -n "${DATABASE_URL:-}" ]]; then
  proto_removed="${DATABASE_URL#*://}"
  creds="${proto_removed%@*}"          # user:pass
  hostpart="${proto_removed#*@}"       # host:port/db?params
  DB_USER="${creds%%:*}"
  DB_PASS="${creds#*:}"
  hostport="${hostpart%%/*}"           # host:port
  DB_HOST="${hostport%%:*}"
  DB_PORT="${hostport#*:}"; [[ "$DB_PORT" == "$DB_HOST" ]] && DB_PORT=3306
  dbname="${hostpart#*/}"              # db?params
  DB_NAME="${dbname%%\?*}"
else
  DB_HOST="${MYSQL_HOST:-127.0.0.1}"
  DB_PORT="${MYSQL_PORT:-3306}"
  DB_USER="${MYSQL_USER:?falta MYSQL_USER o DATABASE_URL}"
  DB_PASS="${MYSQL_PASSWORD:?falta MYSQL_PASSWORD}"
  DB_NAME="${MYSQL_DATABASE:?falta MYSQL_DATABASE}"
fi

[[ -n "${BACKUP_S3_BUCKET:-}" ]] || fail "falta BACKUP_S3_BUCKET (destino off-site)"
command -v mysqldump >/dev/null || fail "mysqldump no está instalado"
command -v aws >/dev/null       || fail "aws cli no está instalada"

mkdir -p "$BACKUP_DIR"

# Password vía archivo temporal 0600 (NUNCA en argv → no se ve en `ps`).
CNF="$(mktemp)"; chmod 600 "$CNF"
trap 'rm -f "$CNF"; trap - ERR' EXIT
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' \
  "$DB_USER" "$DB_PASS" "$DB_HOST" "$DB_PORT" > "$CNF"

DUMP_FILE="${BACKUP_DIR}/nortex-${DB_NAME}-${TIMESTAMP}.sql.gz"

# ── Dump consistente (single-transaction = sin lock para InnoDB) ───────────────
echo "→ Generando dump de ${DB_NAME}…"
mysqldump --defaults-extra-file="$CNF" \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$DUMP_FILE"

SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "→ Dump local: ${DUMP_FILE} (${SIZE})"

# ── Subir OFF-SITE (S3-compatible) ─────────────────────────────────────────────
S3_DEST="${BACKUP_S3_BUCKET%/}/$(date +%Y)/$(date +%m)/$(basename "$DUMP_FILE")"
echo "→ Subiendo a ${S3_DEST}…"
if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
  aws s3 cp "$DUMP_FILE" "$S3_DEST" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
else
  aws s3 cp "$DUMP_FILE" "$S3_DEST" --only-show-errors
fi
echo "✓ Backup off-site OK."

# ── Retención local (el ciclo de vida del bucket maneja la retención remota) ───
find "$BACKUP_DIR" -name 'nortex-*.sql.gz' -type f -mtime "+${BACKUP_KEEP_DAYS}" -delete
echo "✓ Backup completo (${TIMESTAMP})."
