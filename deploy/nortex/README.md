# Release reproducible del hotfix de crédito

## Estado del paquete en main — auditoría 2026-10-06

Esta carpeta existe en main desde la integración del empaquetado. Los commits
C′/B′ del hotfix conservan sus contratos inmutables de 143 modelos. El schema
actual de main genera 153 modelos y 1.855 columnas escalares: sus contratos de
cliente y el manifiesto de fuentes deben coincidir con ese checkout, aunque un
CI anterior del hotfix estuviera verde.

`tests/nortexDeployment.test.mjs` comprueba fuentes, cliente generado, versión y
conteos reales. CI también ejecuta el sellador sobre los assets y SEO construidos;
un cliente o manifiesto desactualizado debe fallar antes de llegar a Coolify.

Actualizar el contrato del cliente **no acredita la base remota**. Se mantienen
sin cambios los fingerprints de staging y producción, la identidad, confirmación,
preflight de sólo lectura y rechazo de DDL. El contrato histórico de producción
no acredita las diez tablas comerciales que main ahora utiliza: antes de promover
main se necesita comprobar la compatibilidad y, si falta esa expansión, preparar
una migración aditiva con backup y restauración verificados. No cambiar hashes de
la base ni quitar el gate para conseguir un arranque. Ver la
[auditoría y evidencia](../../docs/releases/2026-10-06-deployment-audit.md).

Preparación local: estos archivos no autorizan push, cambios del panel ni release.
Los candidatos nuevos requieren revisión, CI propio y el controlador acotado nuevo.
No reutilizar el CI ni receipts de despliegue de C/B como evidencia de C′/B′.

## Configuración única del recurso existente

Conservar UUID, repo, rama, base `/`, Compose `/docker-compose.yml`, red, labels,
slots y Auto Deploy=false. Guardar General primero y Source fresco al final.

Staging Build: `sh scripts/nortex-release.sh staging prepare`

Staging Start: `sh scripts/nortex-release.sh staging start`

Producción usa los mismos dos comandos con `production`. No usar Deploy del panel:
la solicitud sigue exclusivamente los workflows canónicos desde main/controlador.
No cambiar Preserve repository: ambos caminos del proveedor están contemplados.

El helper contiene los scripts/overlays del checkout, aunque Coolify elimine `.git`.
Build usa el Compose **generado**, `/artifacts/build-time.env` y el overlay Git;
Start usa ese Compose, `.env` del workdir y el mismo overlay Git. Los comandos UI
no necesitan `-f`, redirecciones, variables ni operadores inline. El wrapper
gestiona explícitamente flags/env/build-args. El verbo externo `prepare` evita
que Coolify v4.3.18 agregue argumentos al encontrar ` build`; el wrapper mantiene
exactamente dos argumentos y ejecuta `docker compose build` internamente. Los nombres ARG del Dockerfile se
resuelven desde el env-file por Compose, sin evaluar ni imprimir valores.
La base Node 22.23.2 se fija por digest; npm usa el lockfile.

Los identificadores públicos `NORTEX_ROLLBACK_DATABASE`, `NORTEX_ROLLBACK_MYSQL_UUID`
y `NORTEX_ROLLBACK_CONFIRMATION` deben estar disponibles para resolver Compose en
build y runtime. La confirmación es `PRESERVE_SCHEMA <SHA NUEVO> <database>`.
Conservar todas las claves existentes; no copiar valores secretos a Git ni imágenes.
El perfil staging/production lo fija el overlay. No se selecciona schema por conteo.

El tag generado `<UUID>_app:<SHA>` vincula el receipt nuevo al checkout. Dockerfile
incluye scripts/contratos y sella los bytes del build tras generar cliente/assets.
Runtime exige SOURCE_COMMIT exactamente igual, identidad DB/UUID, fingerprint,
visibilidad, preflight íntegro sólo SELECT y cliente exacto antes de iniciar app.
El receipt es evidencia de construcción, no firma independiente ni aprobación.

## Corte y recuperación

Antes de dispatch, el operador/owner debe acreditar backup vigente y restore
aplicable (incluidos originales si existen), G efectivo y trabajo en vuelo,
variables resolubles, mismas imágenes/volúmenes disponibles y Compose efectivo.
Build inspecciona pins/volúmenes antes de que Coolify pueda limpiar contenedores.
Start exige volúmenes externos, no build/pull, y recrea sólo los servicios previstos.
El volumen anónimo actual de backup se conserva por su nombre exacto externo.
Estos pins son específicos de los dos recursos observados: una actualización
legítima requiere delta revisado, nunca sustitución por un tag flotante.

Coolify detiene/recrea el stack; no se promete despliegue sin interrupción.
Staging C′→B′→C′ debe conservar volúmenes/datos y superar health SHA, smoke aislado,
replay, assets/PWA y recuperación. Sólo después considerar producción y 30 min de
observación con autorización explícita para los nuevos SHAs. B′ recupera código;
no restaura SQL. Si la integridad falla, parar y usar el restore acreditado.

Persisten precondiciones no verificadas del servidor: código instalado/Compose
efectivo, disponibilidad actual de imágenes/volúmenes, variables de build/runtime,
backup/RPO/restauración, grace/inflight y capacidad. La terminal remota fue denegada;
ninguna prueba local sustituye esas comprobaciones. No usar otro canal para eludirla.

## Próximas entregas

Mantener comandos UI estables. Versionar el delta de código, contratos exactos y
pins cuando cambien; generar receipt en cada build; publicar SHA+digest de imagen,
resultado de CI y cadena de staging. Un schema nuevo exige su contrato/migración
revisada; este launcher falla cerrado y nunca aplica DDL automáticamente.
