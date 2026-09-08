---
name: nortex-deploy
description: Despliegue y operaciones de Nortex — Docker, variables de entorno, migraciones en prod, backups, smoke tests post-deploy. Usar al tocar Dockerfile/docker-compose, preparar un release, o diagnosticar un deploy roto.
---

# Deploy y operaciones de Nortex

Leer `CLAUDE.md`, `AGENTS.md` y `docs/runbooks/release-promotion.md` antes de actuar.
Para respaldos o un cambio de schema, aplicar también `nortex-backup-recovery`.
Revisión documental del 2026-09-08 contra el candidato `484f58a`; comprobar nuevamente
los contratos si los workflows o verificadores cambian.

## Imagen y arranque

`Dockerfile`: `npm ci` → generar Prisma 6.4.1 con URL dummy → `npm run build:seo`
→ `npm prune --omit=dev` → `sh scripts/docker-entrypoint.sh`.
El runtime de desarrollo/CI se fija a Node 22.23.2; la imagen todavía declara
`node:22-slim`, sin fijar el parche. No afirmar que esa imagen garantiza 22.23.2.

El entrypoint espera MySQL, ejecuta preflights DDL acotados y luego `db push
--skip-generate`; inicia el servidor solo si terminan correctamente. Actualmente
usa `npx prisma`, resuelto desde las dependencias instaladas. Los comandos manuales
de QA usan el binario local con `npx --no-install prisma`; nunca descargar otra versión.
`db push` no ejecuta los archivos de migración ni sus backfills.

Nunca usar `--accept-data-loss`. Preflight inseguro, timeout o warning destructivo
cierran el arranque. Esto no garantiza que la instancia anterior siga sirviendo:
comprobar la estrategia real de reemplazo y rollback de Coolify.

## Contrato de promoción vigente

| Etapa | Ruta y condición |
|---|---|
| CI | `ci.yml`: solo verificación, sin staging, producción, webhooks ni secretos de despliegue. |
| Staging | `release-staging.yml`, dispatch manual en `main`, `candidate_sha` completo y `confirmation=STAGE <SHA>`. Exige CI terminal exitoso del candidato y `NORTEX_DEPLOY_ENABLED=true`. |
| Producción | `release-production.yml`, dispatch manual en `main`, `candidate_sha` completo y `confirmation=PROMOTE <SHA>`. Exige `NORTEX_PRODUCTION_DEPLOY_ENABLED=true`, CI terminal exitoso, staging manual exitoso y salud del mismo SHA. |
| Revalidación | Después de aprobar el environment se vuelven a comprobar main, candidato, evidencia y destino antes del webhook. El checkout y el health quedan fijados al SHA. |

Un push, merge o dispatch de CI no promueve ningún entorno. No reutilizar la receta
histórica `production_approved`/`production_sha` dentro de CI. Una autorización de
producto y una aprobación técnica del environment son evidencias distintas.
No solicitar de nuevo autorización para una acción ya cubierta explícitamente por
la sesión; verificar que cubra el candidato y entorno concretos antes de ejecutarla.

El contrato Coolify vive en `scripts/verify-coolify-staging-target.mjs` y
`scripts/verify-coolify-production-target.mjs`. Cada environment debe configurar:

- Origen HTTPS confiable `COOLIFY_*_API_ORIGIN`, UUID `COOLIFY_*_APPLICATION_UUID`
  y webhook del mismo origen/UUID. No derivar la identidad desde el webhook.
- `COOLIFY_*_READ_TOKEN` de solo lectura en su environment. El verificador no sigue
  redirecciones ni imprime respuestas; el token no debe viajar a CI ni al otro entorno.
- `git_commit_sha` exactamente igual al candidato, build desde Git **`dockerfile`
  o `dockercompose`**, y `settings.is_auto_deploy_enabled` booleano `false`.
- Si el webhook exige bearer, un `COOLIFY_*_DEPLOY_TOKEN` separado con permiso
  `deploy`; no mezclar lectura con `write`, `read:sensitive` o `root`.

Los webhooks usan POST explícito; no reintentar automáticamente un resultado
incierto. Coolify 4.1.2 omite `settings` en GET application y no satisface la
compuerta: no interpretar ausencia como Auto Deploy apagado ni elevar permisos.
La fuente 4.3.18 incluye la relación, pero actualizar el panel exige acreditar
su propia recuperación; el respaldo MySQL de Nortex no respalda Coolify.
Ver `docs/releases/2026-09-08-coolify-compatibility.md` antes de ese cambio.

Tokens distintos por environment no prueban aislamiento entre aplicaciones. Comprobar
su equipo y alcance efectivo; registrar vencimiento y responsable de renovación.
Los verificadores leen el pin, nunca lo escriben. Un token existente, una app sana
con otro SHA o un environment aprobado no subsanan identidad/pin incompletos.

## Variables del producto

| Variable | Contrato |
|---|---|
| `DATABASE_URL` | MySQL 8 privado. No leer ni mostrar su valor. |
| `JWT_SECRETS` | Keyring rotable; `JWT_SECRET` sigue siendo compatibilidad legacy. |
| `NORTEX_LEDGER_KEYS` | Habilita firmas. Sin claves, el código conserva movimientos sin firma; no acreditar integridad criptográfica por salud HTTP. |
| `NORTEX_DATA_KEYS` | Cifrado de campos sensibles; verificar presencia sin exponer claves. |
| `ANTHROPIC_API_KEY` | Privada del proceso autorizado. La clave sola no habilita NortexGPT ni acredita evaluación real. |
| `WHATSAPP_LLM` | Selector del brain comercial; separado de los flags del asistente privado. |
| `NORTEX_ASSISTANT_*` / `NORTEX_PROMOTIONS_ENABLED` | Interruptores independientes de capacidades; además rigen configuración de tenant, usuario y permisos. |
| `NORTEX_ASSISTANT_STORAGE_DIR` | Ruta privada absoluta fuera del proyecto; en producción su ausencia bloquea adjuntos. Requiere persistencia y acceso compartido con workers. |

No guardar claves en `.env*` versionados, argumentos, logs, capturas o `VITE_*`.
El despliegue completo del asistente también requiere declarar sus workers, salud,
volumen privado y respaldo SQL+originales; el Compose del repo por sí solo no lo acredita.

## Compuertas y cierre

1. Fijar candidato completo, diff de schema, alcance, responsable y recuperación.
2. Ejecutar Prisma validate/generate, tipos, Vitest, diseño, build/SEO y auditoría
   de dependencias. Dinero/inventario exige integración MySQL descartable sin casos
   omitidos y mutación pertinente; no reducir alcance, pisos ni umbral.
3. Comprobar CI terminal verde del SHA: `verify`, `integration-required`,
   `deploy-schema-smoke`, `backup-restore-smoke`. El smoke de CI usa datos sintéticos.
4. Para schema, exigir respaldo real off-site reciente y restore drill vigente
   conforme a `nortex-backup-recovery`; revisar upgrade, estados parciales y reejecución.
5. Verificar protecciones GitHub vivas, Auto Deploy apagado, identidad y pin Coolify.
   Ejecutar la promoción manual y el smoke autenticado de staging en tenant sintético.
6. Promover producción solo dentro de autorización vigente. Comprobar salud con
   `scripts/verify-deployed-release.mjs`: HTTP, API/base, `Cache-Control: no-store`
   y SHA exacto. Verificar SEO y activos cuando corresponda.
7. Para flujos financieros, conciliar venta/pago/devolución/cierre con stock,
   Kardex, deuda, asiento, auditoría y recibo, sin usar clientes como fixtures.
   Observar al menos 30 minutos tras producción autorizada; reportar omisiones.

Registrar por separado código local, CI, staging, autorización, producción sana y
observación. Un rollback de aplicación conserva la migración aditiva: no borrar
columnas para volver atrás. Los informes de `docs/releases/` son evidencia histórica;
la receta vigente es `docs/runbooks/release-promotion.md`.
