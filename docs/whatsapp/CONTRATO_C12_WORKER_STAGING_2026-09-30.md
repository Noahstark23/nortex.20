# Contrato C12: worker comercial en staging

Integrador único Codex. Propietario de edición: integrador Compose base/overlay y contrato del candidato. Checkout dirty se preserva; no se sobrescribe su Compose/Dockerfile/server. Revisor sólo lectura.

Resultado: overlay versionado arranca API y worker comercial del mismo checkout y Dockerfile; image ID requiere comprobación en staging, flags fijados a false, sin permitir activación por entorno heredado; requiere overlay y perfil explícitos. DB privada, ningún puerto del worker, dependencia API healthy, SIGTERM y restart persistente. No cambio de schema/dinero/stock. Servicio comercial aditivo en Compose base, ausente del arranque sin perfil. Sin llamadas IA/Meta ni lectura de .env/claves/datos productivos.

Autoridad: implementación C12 y staging aprobados por Noel en la conversación. Push/PR/CI/merge dentro del programa aprobado; promoción valida SHA exacto. Producción, conexión Meta y nuevos mensajes siguen separados.

Verificación: Docker Compose real con --env-file /dev/null y entorno sintético aislado; servicio ausente del arranque base, overlay presente, flags false, dependencia healthy, restart y sin puertos. Types sobre base integrada, revisión y CI remota. Parser no acredita ejecución/heartbeat en staging.

El comando conserva explícitamente Compose base antes del overlay. Build: sh scripts/build-whatsapp-staging.sh. Start equivalente: up -d app assistant-worker whatsapp-commerce-worker. No iniciar backup/debug por este lote; revisar preview antes de guardar.

Recuperación: apagar procesamiento/envío y conservar inbox/outbox/UNKNOWN e identidad; no forzar retorno legacy. Registrar pin y comandos previos. Límite gasto cero IA/Meta en humo apagado; no contratar servicios nuevos. Verificar backups fuera del Droplet antes de promover.

Verificación en UI real: al indicar un -f, Coolify deja de insertar el archivo base. Por tanto custom command incluye una vez -f ./docker-compose.yml y luego -f docker-compose.whatsapp-staging.yml; Coolify sigue agregando --env-file. Confirmar preview de ambos antes de desplegar. Revisor C12 independiente: parser real y controles locales aprobados; image IDs/SHA/heartbeat pendientes de ejecución.

Instalación inicial: los cuatro flags de WhatsApp son literales false en este overlay. Activar requiere un cambio explícito y revisado de configuración después de la autorización separada de Meta/envío.

## Reparación necesaria de procedencia
La primera promoción de API43d8 terminó construcción pero falló la compuerta con COMMIT_MISMATCH. API y DB sanas; cuatro archivos de código coinciden por SHA256 con candidato, mientras health devuelve SOURCE_COMMIT bd67. Es evidencia parcial, no promoción aprobada.

C12 agrega identidad de build: NORTEX_BUILD_COMMIT proviene de git rev-parse HEAD en checkout; Dockerfile genera .nortex-release.json dentro de imagen con commit y hash del servidor. Health valida el marker y prevalece sobre entorno; marker inválido devuelve null. Ausente conserva SOURCE_COMMIT para QA/builds existentes. La identidad no es firma del árbol completo.

Comando build final: sh scripts/build-whatsapp-staging.sh. La validación del formulario Coolify bloquea sustituciones $, por lo que la lectura Git y argumentos Docker viven en un script versionado con argv fijo, no en una cadena inyectada al formulario. El script falla ante Git ausente o SHA inválido, y ejecuta Compose base+overlay con build arg de Git. No lee ni imprime secretos. Coolify debe conservar repositorio para el overlay en start; .git sigue excluido de imagen. Se añade el servicio comercial con perfil al Compose base para que Coolify genere imagen/labels y lo registre; sigue inactivo sin perfil.

Edición: worker C12 identity propietario Dockerfile candidato, scripts/write-release-identity.mjs, backend/lib/releaseIdentity.ts y tests/releaseIdentity.test.ts; integrador único backend/server.ts (sólo import y campo health). Root Dockerfile/server existentes no se sobrescriben. Reviewer sólo lectura.

Propiedad adicional: worker C12 identity edita scripts/build-whatsapp-staging.sh y tests/whatsappStagingBuild.test.ts; integración Compose base/overlay por Codex. Prueba stub de Git/Docker acredita argumentos y fallo cerrado, no ejecución remota.

Runtime: primer contenedor observado Node22.23.3 por tag flotante22-slim. Candidato fija imagen oficial node:22.23.2-slim (manifest remoto existe) al toolchain canónico. Versión ejecutada todavía debe observarse después del despliegue.
