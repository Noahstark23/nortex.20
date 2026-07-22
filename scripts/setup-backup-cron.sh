#!/usr/bin/env bash
# NORTEX — instala el cron del backup diario (Capa 6 del Security Loop).
# Correr UNA VEZ en el servidor de producción (como root):
#   bash scripts/setup-backup-cron.sh
# Requiere: scripts/backup-db.sh configurado (destino SEPARADO del Droplet).
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRON_LINE="15 3 * * * bash $REPO_DIR/scripts/backup-db.sh >> /var/log/nortex-backup.log 2>&1"

if crontab -l 2>/dev/null | grep -qF "backup-db.sh"; then
    echo "✓ El cron del backup ya está instalado:"
    crontab -l | grep backup-db.sh
    exit 0
fi
( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
echo "✓ Backup diario instalado (03:15): $CRON_LINE"
echo "→ Verificá HOY con una corrida manual:  bash $REPO_DIR/scripts/backup-db.sh"
echo "→ Y probá la RESTAURACIÓN en una BD vacía — un backup no probado no existe."
