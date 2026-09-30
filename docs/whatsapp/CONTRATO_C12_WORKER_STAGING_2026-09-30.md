# Contrato C12: worker comercial en staging

Integrador único Codex. Propietario de edición: docker-compose.whatsapp-staging.yml y este contrato. Compose general y checkout dirty se preservan. Revisor sólo lectura.

Resultado: overlay versionado arranca API y worker comercial del mismo checkout y Dockerfile; image ID requiere comprobación en staging, flags fijados a false, sin permitir activación por entorno heredado; requiere overlay y perfil explícitos. DB privada, ningún puerto del worker, dependencia API healthy, SIGTERM y restart persistente. No cambio de schema/dinero/stock. Sin llamadas IA/Meta ni lectura de .env/claves/datos productivos.

Autoridad: implementación C12 y staging aprobados por Noel en la conversación. Push/PR/CI/merge dentro del programa aprobado; promoción valida SHA exacto. Producción, conexión Meta y nuevos mensajes siguen separados.

Verificación: Docker Compose real con --env-file /dev/null y entorno sintético aislado; servicio ausente del arranque base, overlay presente, flags false, dependencia healthy, restart y sin puertos. Types sobre base integrada, revisión y CI remota. Parser no acredita ejecución/heartbeat en staging.

Coolify conserva Compose base. Build: docker compose -f docker-compose.whatsapp-staging.yml --profile assistant-worker --profile whatsapp-commerce-worker build app assistant-worker whatsapp-commerce-worker. Start equivalente: up -d app assistant-worker whatsapp-commerce-worker. No iniciar backup/debug por este lote; revisar preview antes de guardar.

Recuperación: apagar procesamiento/envío y conservar inbox/outbox/UNKNOWN e identidad; no forzar retorno legacy. Registrar pin y comandos previos. Límite gasto cero IA/Meta en humo apagado; no contratar servicios nuevos. Verificar backups fuera del Droplet antes de promover.

Coolify añade por su cuenta el primer -f ./docker-compose.yml y --env-file. El custom command sólo agrega el overlay, sin repetir base; confirmar preview con ambos archivos antes del subcomando. Revisor C12 independiente: parser real y controles locales aprobados; image IDs/SHA/heartbeat pendientes de ejecución.

Instalación inicial: los cuatro flags de WhatsApp son literales false en este overlay. Activar requiere un cambio explícito y revisado de configuración después de la autorización separada de Meta/envío.
