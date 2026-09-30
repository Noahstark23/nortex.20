# Contrato C12: worker comercial en staging

Integrador único Codex. Propietario de edición: docker-compose.whatsapp-staging.yml y este contrato. Compose general y checkout dirty se preservan. Revisor sólo lectura.

Resultado: overlay versionado arranca API y worker comercial del mismo checkout y Dockerfile; image ID requiere comprobación en staging, flags fijados a false, sin permitir activación por entorno heredado; requiere overlay y perfil explícitos. DB privada, ningún puerto del worker, dependencia API healthy, SIGTERM y restart persistente. No cambio de schema/dinero/stock. Sin llamadas IA/Meta ni lectura de .env/claves/datos productivos.

Autoridad: implementación C12 y staging aprobados por Noel en la conversación. Push/PR/CI/merge dentro del programa aprobado; promoción valida SHA exacto. Producción, conexión Meta y nuevos mensajes siguen separados.

Verificación: Docker Compose real con --env-file /dev/null y entorno sintético aislado; servicio ausente del arranque base, overlay presente, flags false, dependencia healthy, restart y sin puertos. Types sobre base integrada, revisión y CI remota. Parser no acredita ejecución/heartbeat en staging.

Coolify conserva Compose base. Build: docker compose -f docker-compose.whatsapp-staging.yml --profile assistant-worker --profile whatsapp-commerce-worker build app assistant-worker whatsapp-commerce-worker. Start equivalente: up -d app assistant-worker whatsapp-commerce-worker. No iniciar backup/debug por este lote; revisar preview antes de guardar.

Recuperación: apagar procesamiento/envío y conservar inbox/outbox/UNKNOWN e identidad; no forzar retorno legacy. Registrar pin y comandos previos. Límite gasto cero IA/Meta en humo apagado; no contratar servicios nuevos. Verificar backups fuera del Droplet antes de promover.

Coolify añade por su cuenta el primer -f ./docker-compose.yml y --env-file. El custom command sólo agrega el overlay, sin repetir base; confirmar preview con ambos archivos antes del subcomando. Revisor C12 independiente: parser real y controles locales aprobados; image IDs/SHA/heartbeat pendientes de ejecución.

Instalación inicial: los cuatro flags de WhatsApp son literales false en este overlay. Activar requiere un cambio explícito y revisado de configuración después de la autorización separada de Meta/envío.

## Reparación necesaria de procedencia
La primera promoción de API43d8 terminó construcción pero falló la compuerta con COMMIT_MISMATCH. API y DB sanas; cuatro archivos de código coinciden por SHA256 con candidato, mientras health devuelve SOURCE_COMMIT bd67. Es evidencia parcial, no promoción aprobada.

C12 agrega identidad de build: NORTEX_BUILD_COMMIT proviene de git rev-parse HEAD en checkout; Dockerfile genera .nortex-release.json dentro de imagen con commit y hash del servidor. Health valida el marker y prevalece sobre entorno; marker inválido devuelve null. Ausente conserva SOURCE_COMMIT para QA/builds existentes. La identidad no es firma del árbol completo.

Comando build actualizado: docker compose -f docker-compose.whatsapp-staging.yml --profile assistant-worker --profile whatsapp-commerce-worker build --build-arg NORTEX_BUILD_COMMIT="$(git rev-parse --verify HEAD || printf invalid)" app assistant-worker whatsapp-commerce-worker. Si no hay Git, invalid hace fallar la generación. Coolify debe conservar repositorio durante despliegue para que overlay esté presente al ejecutar start; .git permanece excluido del contexto Docker.

Edición: worker C12 identity propietario Dockerfile candidato, scripts/write-release-identity.mjs, backend/lib/releaseIdentity.ts y tests/releaseIdentity.test.ts; integrador único backend/server.ts (sólo import y campo health). Root Dockerfile/server existentes no se sobrescriben. Reviewer sólo lectura.
