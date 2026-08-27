---
name: nortex-backup-recovery
description: Configura, audita y prueba respaldos MySQL 8 de Nortex en almacenamiento S3/Spaces off-site. Usar al habilitar backups, medir RPO/RTO, ejecutar un restore drill o decidir si un despliegue con cambios de schema puede avanzar.
---

# Backup y recuperación de Nortex

El resultado válido es un respaldo **off-site, reciente y restaurable**, con evidencia
redactada. Un job verde, un dump local o el smoke de CI no prueban que producción esté
respaldada.

## Límites operativos

- Leer primero `CLAUDE.md`, `AGENTS.md`, `docker-compose.yml`,
  `scripts/backup-db.sh`, `scripts/backup-scheduler.sh` y
  `scripts/verify-backup-restore.sh`.
- MySQL 8 es canónico. El destino debe estar separado del Droplet y ser privado;
  preferir una credencial limitada al bucket y una política de retención del proveedor.
- Nunca leer, copiar ni mostrar valores de variables, `.env*`, URLs con credenciales,
  access keys, dumps o datos de clientes. Verificar solo presencia, estado y metadata
  no sensible. No usar `set -x`, `env`, `printenv` ni `docker inspect` sobre producción.
- Si una herramienta no puede crear o cargar una credencial sin devolverla en claro,
  detenerse y pedir que el operador la cargue directamente en el gestor de secretos.
- Provisionar recursos con costo, crear/rotar credenciales, ejecutar jobs contra
  producción, restaurar, mergear y desplegar son mutaciones distintas: confirmar que
  cada una está cubierta por autorización explícita. Nunca restaurar sobre producción.

## Configuración

1. Confirmar bucket privado off-site, región, retención y alertas. Para Spaces usar su
   endpoint S3-compatible; no habilitar publicación/CDN para respaldos.
2. Confirmar que Coolify ya contiene `DB_ROOT_PASSWORD`; Compose deriva con ella la
   `DATABASE_URL` interna del servicio. Cargar allí `BACKUP_S3_BUCKET`,
   `BACKUP_S3_ENDPOINT`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID` y
   `AWS_SECRET_ACCESS_KEY`. Configurar `BACKUP_ALERT_WEBHOOK` cuando exista un canal
   autorizado. No transportar valores por chat, commits o logs.
3. Mantener el servicio `backup` separado de `app`: una falla de respaldo debe verse y
   alertar sin tumbar el POS, pero debe bloquear una promoción de schema.
4. Establecer por escrito RPO, RTO, retención y responsable. Si aún no hay decisión,
   reportarla como pendiente; el umbral técnico actual de frescura es
   `BACKUP_MAX_AGE_HOURS=26`, no una promesa comercial implícita.

## Primera activación y restore drill

1. Verificar primero en CI `backup-restore-smoke` y la imagen `Dockerfile.backup`.
2. Con autorización para la corrida productiva, ejecutar el servicio de backup y exigir
   salida exitosa. Confirmar en el almacenamiento remoto el objeto y
   `last-backup.json`; validar únicamente timestamp UTC, bytes, SHA-256, número de
   tablas y `verificado=true`, sin imprimir el documento completo ni el destino.
3. Descargar el objeto real más reciente a un entorno controlado y efímero. Comparar
   su SHA-256 con la evidencia y ejecutar `scripts/verify-backup-restore.sh` contra una
   base MySQL 8 desechable cuyo nombre contenga `restore`, `test`, `tmp` o `scratch`.
   No usar `BACKUP_RESTORE_FORCE=1`. No apuntar `RESTORE_DATABASE_URL` a producción.
4. Para comparar conteos, usar un origen congelado/coherente con el dump; no comparar
   horas después contra una producción que continúa recibiendo ventas. Registrar
   inicio/fin, tablas, filas y resultado; destruir la copia temporal de forma segura
   cuando la política y la autorización lo permitan.
5. Medir RPO como la antigüedad del último backup recuperable y RTO como el tiempo
   completo desde iniciar la recuperación hasta validar base y aplicación, no solo el
   tiempo de importar el dump. Repetir el drill después de cambiar proveedor, scripts,
   credenciales o versión de MySQL, y con la cadencia operativa aprobada.

## Compuerta de despliegue

Antes de un cambio de schema exigir, para la base real:

- backup off-site posterior al punto de corte acordado y dentro del RPO;
- integridad y presencia remota confirmadas;
- restore drill vigente y exitoso sobre MySQL 8 desechable;
- CI, preflight aditivo y plan de rollback verdes.

Si falta cualquiera, **fail closed**: no marcar listo, no mergear si `main` despliega,
no llamar webhooks y no usar `--accept-data-loss`. Corregir el respaldo y repetir la
verificación. Después del deploy comprobar `/api/health`, commit exacto y smokes según
`nortex-deploy`; conservar la migración aditiva durante un rollback de aplicación.

## Evidencia de cierre

Reportar proveedor/región, bucket identificado de forma no sensible, hora y edad del
último backup, checksum comparado (abreviado), resultado y duración del restore drill,
RPO/RTO observado, retención, alertas y decisión `GO`/`NO-GO`. No afirmar “backup
resuelto” sin objeto remoto y restauración real verificados.
