---
name: nortex-deploy
description: Despliegue y operaciones de Nortex — Docker, variables de entorno, migraciones en prod, backups, smoke tests post-deploy. Usar al tocar Dockerfile/docker-compose, preparar un release, o diagnosticar un deploy roto.
---

# Deploy y operaciones de Nortex

Para configurar o auditar el respaldo off-site, medir RPO/RTO o ejecutar una prueba
de restauración, cargar primero `nortex-backup-recovery`; esa skill define la compuerta.

## Pipeline
`Dockerfile`: `npm ci` → Prisma local 6.4.1 (URL dummy para generar tipos) →
`npm run build:seo` (frontend + prerender por ruta + sitemap) →
`npm prune --omit=dev` → `CMD ["sh", "scripts/docker-entrypoint.sh"]`.
- El entrypoint espera conectividad MySQL, ejecuta preflights DDL acotados y luego
  `prisma db push --skip-generate`. Arranca `NODE_ENV=production npm run start`
  solo al terminar correctamente. `db push` no ejecuta los archivos de migración
  ni sus backfills; revisar por separado el DDL y la migración de datos.
- Nunca usar `--accept-data-loss`. Preflights inseguros, timeouts y advertencias
  destructivas detienen el arranque. Esto protege datos, pero **no garantiza que
  la instancia vieja siga sirviendo**: la disponibilidad depende de la estrategia
  real de reemplazo de Coolify. Verificar rollback y recuperación antes de promover.
- `NODE_ENV=production` activa el serving: `/` → `landing.html`; rutas de
  marketing → `dist/<ruta>/index.html` prerenderizado; resto → shell del SPA;
  assets con hash → cache 1 año.

## Variables de entorno críticas
| Var | Rol |
|---|---|
| `DATABASE_URL` | MySQL 8. Rotar si se expuso (estuvo commiteada en el historial) |
| `JWT_SECRETS` | Keyring `"nuevo,viejo"` — el 1º firma, todos verifican → rotación sin desloguear. (`JWT_SECRET` legacy funciona) |
| `NORTEX_LEDGER_KEYS` | `"v1:<clave>"` activa el libro firmado de caja; sin ella el sistema opera igual (gate suave) |
| `NORTEX_DATA_KEYS` | Cifrado field-level AES-GCM (tokens WhatsApp) |
| `ANTHROPIC_API_KEY` + `WHATSAPP_LLM=claude` | Activan el brain LLM del bot (default: MenuBot sin LLM) |
| `STRIPE_*` | Suscripciones |

**Jamás** commitear `.env*` (ya pasó: `.env.backup` con JWT_SECRET en el
historial → por eso la política de rotación).

## Checklist de release
1. Identificar el SHA completo candidato, base `main`, alcance autorizado y diff.
   Preservar cambios locales; preparar en un candidato aislado cuando corresponda.
2. Ejecutar Prisma generate, TypeScript, Vitest, diseño, auditoría de dependencias,
   mutación sin bajar umbrales y `npm run build:seo`. Para dinero/inventario,
   `npm run test:integration:required` exige MySQL descartable y cero omitidos.
3. Exigir CI terminado y verde para el mismo SHA: `verify`, `integration-required`,
   `deploy-schema-smoke` y `backup-restore-smoke`. Verificación local no equivale a CI.
4. Revisar diff de schema aditivo y probar upgrade con datos, estados parciales y
   reejecución. Verificar backfills si desglosa agregados.
5. Backup ANTES de desplegar cambios de schema: aplicar la compuerta de
   `nortex-backup-recovery` y exigir evidencia off-site restaurable de la base real.
6. Verificar staging: HTTP correcto, `ok=true`, `db=up` y `commit` igual al SHA.
   Ejecutar el smoke autenticado de negocio en un tenant sintético.
7. Producción requiere autorización explícita y trazable para ese SHA, distinta
   de merge o staging. En el workflow preparado el 2026-09-04, un `push` jamás
   habilita producción. Solo `workflow_dispatch` con `production_approved=true`
   y `production_sha` completo igual al SHA del workflow puede solicitar la
   aprobación del environment `production`. Los valores por defecto no promueven.
8. Después de esa aprobación, `authorize-production-release.mjs` vuelve a comprobar
   staging y el HEAD remoto de main antes del webhook. Luego consulta, solo por
   GET, la aplicación Coolify indicada por un único UUID del webhook HTTPS:
   `git_commit_sha` debe coincidir exactamente, `build_pack` debe ser `dockerfile`
   y `settings.is_auto_deploy_enabled` debe ser el booleano `false`. Exige token
   API; no sigue redirecciones ni imprime la respuesta. Ausencia, error de red,
   pin `HEAD`/rama, SHA distinto o configuración incompleta cierran la compuerta.
9. Inspeccionar también las protecciones vivas de GitHub y la configuración de
   Coolify: auto deploy apagado, aprobación de production, ramas permitidas y
   fijación probada por SHA. El operador debe fijar el commit de la aplicación con
   autorización para el candidato concreto; esta compuerta nunca lo modifica.
   Hasta verificar el pin, el bloqueo es ejecutable, no solo una regla documental.
   No cambiar configuración de Coolify durante la promoción; una lectura no impide
   escrituras administrativas concurrentes. Verificar el SHA servido al terminar.
   Estado y pruebas del parche: `docs/releases/2026-09-04-production-gate.md`.

Este runbook no autoriza push, merge, dispatch, aprobación de environment,
webhook, configuración remota ni despliegue. Registrar preparación local, CI,
staging y producción como estados separados. Un cambio de compuerta requiere
pruebas negativas del YAML real y del comando ejecutado antes del webhook.

## Smoke tests post-deploy
Solo dentro de un despliegue autorizado. Primero usar
`node scripts/verify-deployed-release.mjs <URL> <SHA-completo>`: una home sana no
demuestra versión ni integridad de negocio. Para SEO, comprobar contenido, assets
y marcadores `data-prerender="seo"` / `nx-public-prerender` en las rutas generadas.
```bash
curl -s https://somosnortex.com/ | grep -c "Tu negocio ya vende"      # landing viva
curl -s https://somosnortex.com/ferreterias | grep -o '<title>[^<]*'  # prerender por-ruta
curl -s https://somosnortex.com/sitemap.xml | grep -c "<loc>"         # sitemap (70+)
# Con token SUPER_ADMIN:
#   GET /api/admin/metrics        → montos como string decimal
#   GET /api/admin/ledger/verify/<tenantId> → { ok: true }
```
Para releases financieras: venta, pago, devolución, reportes, cierre, aislamiento
tenant e idempotencia en un tenant sintético autorizado; reconciliar stock,
Kardex, asiento, auditoría y recibo. En producción autorizada, observar al menos
30 minutos. Un 503 transitorio solo se acepta después de recuperar salud y SHA
con reintentos acotados. Reportar omisiones; no usar datos de clientes como fixtures.

## Diagnóstico rápido
- Build falla en Docker con error de sintaxis TS → casi siempre `data/blog-posts.ts`
  o un merge apilado (ver nortex-seo §trampas).
- `prisma` se queja del schema con mensajes de v7 → `node_modules` desincronizado.
- Panel admin vacío → revisar `select`+`include` en la misma relación (throw silencioso).
- El bot de WhatsApp no responde → ¿`WHATSAPP_LLM`/`ANTHROPIC_API_KEY`? ¿la
  conversación quedó en `HUMAN` (handoff)?
