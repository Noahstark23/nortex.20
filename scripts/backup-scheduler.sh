#!/usr/bin/env bash
#
# backup-scheduler.sh — Planificador del backup diario de Nortex (DGI-4, Capa 6
# del Security & Integrity Loop). Es el proceso principal del servicio `backup`
# del docker-compose: se despliega con la app, sin ningún paso manual por SSH.
#
# POR QUÉ UN LOOP PROPIO Y NO CRON:
#
#   1. `cron` DENTRO de un contenedor no hereda las variables de entorno del
#      proceso principal. Las credenciales de la BD y del bucket llegarían
#      VACÍAS y el backup fallaría todas las noches en silencio.
#   2. El crontab del HOST ni siquiera puede alcanzar la base: el servicio `db`
#      del compose no publica puertos (a propósito) y el nombre `db` solo
#      resuelve dentro de la red de compose. `scripts/setup-backup-cron.sh`
#      quedó como opción para un despliegue sin Docker.
#
# ── Variables ──────────────────────────────────────────────────────────────────
#   Las de scripts/backup-db.sh, más:
#     BACKUP_HOUR / BACKUP_MINUTE   hora local del backup (default 03:15)
#     TZ                            zona horaria (default America/Managua)
#     BACKUP_MAX_AGE_HOURS          si el último backup bueno es más viejo que
#                                   esto, corre uno al arrancar (default 26)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_SCRIPT="${REPO_DIR}/scripts/backup-db.sh"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/nortex}"
BACKUP_HOUR="${BACKUP_HOUR:-03}"
BACKUP_MINUTE="${BACKUP_MINUTE:-15}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
HEARTBEAT_FILE="${BACKUP_DIR}/last-backup.json"

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S %Z')] $*"; }

morir() {
  # Config incompleta = el backup NO existe. Se cae ruidosamente en vez de quedar
  # "corriendo" sin respaldar nada: un servicio caído se ve en Coolify, un backup
  # que nunca corre no se ve hasta el día que se necesita restaurar.
  log "❌ $1"
  log "   El servicio de backup NO puede operar así. Revisá las variables de entorno."
  exit 1
}

[[ -f "$BACKUP_SCRIPT" ]] || morir "no encuentro scripts/backup-db.sh en ${REPO_DIR}."
[[ -n "${DATABASE_URL:-}${MYSQL_HOST:-}" ]] || morir "falta DATABASE_URL (o MYSQL_*)."
if [[ "${BACKUP_LOCAL_ONLY:-0}" != "1" ]]; then
  [[ -n "${BACKUP_S3_BUCKET:-}" ]]      || morir "falta BACKUP_S3_BUCKET: sin destino off-site no hay respaldo real."
  [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]     || morir "falta AWS_ACCESS_KEY_ID para el bucket off-site."
  [[ -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || morir "falta AWS_SECRET_ACCESS_KEY para el bucket off-site."
fi

case "${BACKUP_HOUR}:${BACKUP_MINUTE}" in
  [0-9][0-9]:[0-9][0-9]) ;;
  *) morir "BACKUP_HOUR/BACKUP_MINUTE deben ser de dos dígitos (ej. 03 y 15)." ;;
esac
if [[ "$((10#${BACKUP_HOUR}))" -gt 23 || "$((10#${BACKUP_MINUTE}))" -gt 59 ]]; then
  morir "hora inválida: ${BACKUP_HOUR}:${BACKUP_MINUTE}."
fi

mkdir -p "$BACKUP_DIR"

correr_backup() {
  log "→ Ejecutando backup…"
  # Un fallo NO mata el planificador: backup-db.sh ya alerta por webhook, y
  # abandonar el loop convertiría un mal día de red en cero backups para siempre.
  if bash "$BACKUP_SCRIPT"; then
    log "✓ Backup completado."
  else
    log "❌ El backup falló (código $?). Se reintenta en la próxima corrida diaria."
  fi
}

# ── Puesta al día ──────────────────────────────────────────────────────────────
# Sin esto, un deploy justo después de la hora del backup salta el día entero.
# Se corre solo si el último backup bueno está ATRASADO, así una ráfaga de
# reinicios no dispara un dump por reinicio.
edad_del_ultimo_backup_horas() {
  [[ -f "$HEARTBEAT_FILE" ]] || { echo "999999"; return; }
  local mtime ahora
  mtime="$(date -r "$HEARTBEAT_FILE" +%s 2>/dev/null || echo 0)"
  ahora="$(date +%s)"
  echo "$(( (ahora - mtime) / 3600 ))"
}

EDAD="$(edad_del_ultimo_backup_horas)"
if [[ "$EDAD" -ge "$BACKUP_MAX_AGE_HOURS" ]]; then
  log "⚠️  El último backup bueno tiene ${EDAD}h (límite ${BACKUP_MAX_AGE_HOURS}h). Corriendo uno ahora."
  correr_backup
else
  log "✓ Último backup bueno hace ${EDAD}h; no hace falta ponerse al día."
fi

log "🗓  Planificador activo: backup diario a las ${BACKUP_HOUR}:${BACKUP_MINUTE} (${TZ:-hora del sistema})."

while :; do
  AHORA="$(date +%s)"
  PROXIMO="$(date -d "today ${BACKUP_HOUR}:${BACKUP_MINUTE}:00" +%s)"
  [[ "$PROXIMO" -le "$AHORA" ]] && PROXIMO="$(date -d "tomorrow ${BACKUP_HOUR}:${BACKUP_MINUTE}:00" +%s)"
  ESPERA=$((PROXIMO - AHORA))
  log "⏳ Próximo backup: $(date -d "@${PROXIMO}" +'%Y-%m-%d %H:%M:%S %Z') (en ${ESPERA}s)."
  sleep "$ESPERA"
  correr_backup
done
