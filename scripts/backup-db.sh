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
#   BACKUP_REQUIRED_TABLES  tablas que el dump DEBE contener (default: las fiscales)
#   BACKUP_MIN_BYTES        tamaño mínimo del dump comprimido (default 1024)
#   BACKUP_LOCAL_ONLY=1     NO subir off-site. SOLO para CI/pruebas: un backup que
#                           se queda en el mismo disco que la BD no es un backup.
#
# ── Cómo se ejecuta ────────────────────────────────────────────────────────────
#   En producción lo corre el servicio `backup` del docker-compose (ver
#   Dockerfile.backup + scripts/backup-scheduler.sh). NO es un cron del host: la
#   BD no publica puertos y solo se alcanza desde adentro de la red de compose.
#   A mano (dentro de la red): docker compose run --rm backup bash scripts/backup-db.sh
#
# `-E` (además de `euo pipefail`): sin él, el `trap ... ERR` de abajo NO se
# hereda dentro de las funciones. Como las credenciales ahora se escriben desde
# `escribir_cnf`, un fallo ahí adentro mataría el backup SIN disparar la alerta
# — el peor resultado: falla en silencio y nadie se entera hasta que hace falta
# restaurar.
set -Eeuo pipefail

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
# El `source` va ANTES del `if`, no adentro. Adentro estaba mal: `db-url.sh`
# aporta DOS cosas —`parsear_url_mysql`, que solo hace falta con DATABASE_URL, y
# `escribir_cnf`, que hace falta SIEMPRE—. Sourceándolo solo en la rama de
# DATABASE_URL, un despliegue con MYSQL_USER/MYSQL_PASSWORD moría más abajo con
# `escribir_cnf: command not found`: otra vez un fallo nocturno, solo en ciertos
# servidores, con una alerta que dice "línea N" y no explica nada.
# shellcheck source=scripts/db-url.sh
source "$(dirname "$0")/db-url.sh"

# Preferimos DATABASE_URL (mysql://user:pass@host:port/db); si no, MYSQL_*.
if [[ -n "${DATABASE_URL:-}" ]]; then
  # El parseo cortaba por el PRIMER `@`, así que una contraseña con `@` dejaba
  # el host en basura y el backup fallaba todas las noches contra un host
  # inexistente. Tampoco decodificaba el percent-encoding que Prisma exige.
  parsear_url_mysql "$DATABASE_URL" DB
else
  DB_HOST="${MYSQL_HOST:-127.0.0.1}"
  DB_PORT="${MYSQL_PORT:-3306}"
  DB_USER="${MYSQL_USER:?falta MYSQL_USER o DATABASE_URL}"
  DB_PASS="${MYSQL_PASSWORD:?falta MYSQL_PASSWORD}"
  DB_NAME="${MYSQL_DATABASE:?falta MYSQL_DATABASE}"
fi

command -v mysqldump >/dev/null || fail "mysqldump no está instalado"
if [[ "${BACKUP_LOCAL_ONLY:-0}" == "1" ]]; then
  echo "⚠️  BACKUP_LOCAL_ONLY=1 — el dump NO se sube off-site (modo prueba/CI)."
else
  [[ -n "${BACKUP_S3_BUCKET:-}" ]] || fail "falta BACKUP_S3_BUCKET (destino off-site)"
  command -v aws >/dev/null       || fail "aws cli no está instalada"
fi

mkdir -p "$BACKUP_DIR"

# Password vía archivo temporal 0600 (NUNCA en argv → no se ve en `ps`).
CNF="$(mktemp)"; chmod 600 "$CNF"
trap 'rm -f "$CNF"; trap - ERR' EXIT
escribir_cnf "$CNF" "$DB_USER" "$DB_PASS" "$DB_HOST" "$DB_PORT"

DUMP_FILE="${BACKUP_DIR}/nortex-${DB_NAME}-${TIMESTAMP}.sql.gz"

# ── Dump consistente (single-transaction = sin lock para InnoDB) ───────────────
echo "→ Generando dump de ${DB_NAME}…"
mysqldump --defaults-extra-file="$CNF" \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$DUMP_FILE"

SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
echo "→ Dump local: ${DUMP_FILE} (${SIZE})"

# ── Verificar el dump ANTES de subirlo ─────────────────────────────────────────
# Subir un dump truncado borra la única señal de que algo anduvo mal. La lógica
# vive en scripts/verify-dump-file.sh para poder probarla sola en el CI (que
# comprueba además que RECHACE un dump cortado).
echo "→ Verificando integridad del dump…"
TABLE_COUNT="$("$(dirname "$0")/verify-dump-file.sh" "$DUMP_FILE")"
echo "✓ Dump verificado: ${TABLE_COUNT} tablas, cierre presente."

# Copia off-site. Definida al nivel superior (no dentro del `if`) porque también
# la usa el latido de evidencia más abajo.
aws_cp() {
  if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
    aws s3 cp "$1" "$2" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
  else
    aws s3 cp "$1" "$2" --only-show-errors
  fi
}

# ── Subir OFF-SITE (S3-compatible) ─────────────────────────────────────────────
S3_DEST="local://${DUMP_FILE}"
if [[ "${BACKUP_LOCAL_ONLY:-0}" == "1" ]]; then
  echo "→ Subida omitida (BACKUP_LOCAL_ONLY=1)."
else
  S3_DEST="${BACKUP_S3_BUCKET%/}/$(date +%Y)/$(date +%m)/$(basename "$DUMP_FILE")"
  echo "→ Subiendo a ${S3_DEST}…"
  aws_cp "$DUMP_FILE" "$S3_DEST"
  echo "✓ Backup off-site OK."
fi

# ── Evidencia del último backup bueno ──────────────────────────────────────────
# La DGI (DT 09-2007) pide poder DEMOSTRAR el respaldo, y para operar hace falta
# saber si el backup de anoche corrió. Este latido es la fuente de esa respuesta:
# el planificador lo lee al arrancar para detectar un backup atrasado.
SHA256="$(sha256sum "$DUMP_FILE" | cut -d' ' -f1)"
HEARTBEAT_FILE="${BACKUP_DIR}/last-backup.json"
printf '{"timestamp":"%s","archivo":"%s","bytes":%s,"sha256":"%s","destino":"%s","tablas":%s,"verificado":true}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$DUMP_FILE")" "$BYTES" "$SHA256" "$S3_DEST" "${TABLE_COUNT:-0}" \
  > "$HEARTBEAT_FILE"
if [[ "${BACKUP_LOCAL_ONLY:-0}" != "1" ]]; then
  # Clave FIJA: el monitoreo lee el latido sin listar el bucket entero.
  aws_cp "$HEARTBEAT_FILE" "${BACKUP_S3_BUCKET%/}/last-backup.json"
fi
echo "✓ Evidencia registrada en ${HEARTBEAT_FILE}."

# ── Retención local (el ciclo de vida del bucket maneja la retención remota) ───
find "$BACKUP_DIR" -name 'nortex-*.sql.gz' -type f -mtime "+${BACKUP_KEEP_DAYS}" -delete
echo "✓ Backup completo (${TIMESTAMP})."
