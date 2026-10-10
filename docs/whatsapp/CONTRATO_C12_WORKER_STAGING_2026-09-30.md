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

C12 agrega identidad de build: el script obtiene HEAD del checkout local cuando hay .git, o valida la etiqueta de services.app generada por Coolify cuando sólo hay un archivo de código. Conserva la entrada explícita verificada del controlador de release. Dockerfile genera .nortex-release.json dentro de imagen con commit y hash del servidor. Health valida el marker y prevalece sobre entorno; marker inválido devuelve null. Ausente conserva SOURCE_COMMIT para QA/builds existentes. La identidad no es firma del árbol completo.

Comando build: sh scripts/build-whatsapp-staging.sh [SHA-verificado]. La entrada también puede ser NORTEX_BUILD_COMMIT, entregada explícitamente por el controlador que comprobó el pin solicitado y el código importado; no derivarla del SOURCE_COMMIT personalizado. Ambas entradas, si existen, deben ser SHA completos de 40 hex minúsculos y coincidir; con .git local deben coincidir con HEAD. Git usa --git-dir=./.git y --work-tree=. bajo un entorno acotado: no descubre ancestros ni hereda overrides GIT_*. Un worktree con .git archivo sigue válido. Metadata Git rota o identidad ausente, inválida o contradictoria detiene el build antes de construir imágenes. La consulta de Compose no interpola variables ni resuelve env_file y usa --env-file /dev/null; valida sólo image directo de services.app en su YAML canónico. Requiere <uuid de 24 alfanuméricos minúsculos>_app:<40 hex minúsculos> (también library/ o docker.io/library/); rechaza otro servicio con imagen _app, ambigüedad y desacuerdo con HEAD o entradas explícitas. El script conserva Compose base+overlay, /artifacts/build-time.env y el build arg de los tres servicios al construir, sin imprimir variables. .git sigue excluido de imagen y los flags de pausa no cambian.

La inspección del 2026-10-01 reprodujo que Coolify importó el SHA solicitado pero el build recibió un contexto sin .git. El comando sin argumento ni NORTEX_BUILD_COMMIT puede usar la etiqueta que Coolify escribe en el Compose generado antes del custom build. Esa procedencia depende del controlador: el archive no demuestra por sí solo sus bytes contra el árbol Git; etiqueta o entrada explícita deben corresponder al SHA solicitado/importado. El SHA de un futuro merge debe comprobarse nuevamente. Este delta no cambia configuración de Coolify ni acredita una imagen/contenedor/health remotos.

Edición: worker C12 identity propietario Dockerfile candidato, scripts/write-release-identity.mjs, backend/lib/releaseIdentity.ts y tests/releaseIdentity.test.ts; integrador único backend/server.ts (sólo import y campo health). Root Dockerfile/server existentes no se sobrescriben. Reviewer sólo lectura.

Propiedad adicional: worker C12 identity edita scripts/build-whatsapp-staging.sh y tests/whatsappStagingBuild.test.ts; integración Compose base/overlay por Codex. Pruebas con Git real, Docker stub y Compose real sobre archivos sintéticos acreditan selección/argumentos y fallo cerrado, no ejecución remota. No requieren Node ni jq en el helper de build.

Runtime: primer contenedor observado Node22.23.3 por tag flotante22-slim. Candidato fija imagen oficial node:22.23.2-slim (manifest remoto existe) al toolchain canónico. Versión ejecutada todavía debe observarse después del despliegue.
