---
name: nortex-deploy
description: Despliegue y operaciones de Nortex — Docker, variables de entorno, migraciones en prod, backups, smoke tests post-deploy. Usar al tocar Dockerfile/docker-compose, preparar un release, o diagnosticar un deploy roto.
---

# Deploy y operaciones de Nortex

## Pipeline
`Dockerfile`: `npm install` → `prisma generate` (URL dummy) →
`npm run build:seo` (frontend + prerender 70+ rutas + sitemap) → CMD:
`prisma db push && NODE_ENV=production npm run start` (tsx).
- `db push` aplica el schema como **DDL puro** al arrancar → las migraciones
  aditivas entran solas; los backfills son perezosos en la app (ver nortex-migration).
- ⚠️ El flag `--accept-data-loss` **ya se quitó** (2026-07): un cambio NO aditivo
  (drop/rename/narrow) ahora **falla el arranque** en vez de borrar datos —la
  instancia vieja sigue sirviendo. Gate igual: revisar `git diff
  backend/prisma/schema.prisma` antes de todo release buscando renames/cambios de tipo.
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
1. `npx tsc --noEmit` + `npm run build:seo` verdes en la rama.
2. Diff del schema: solo aditivo.
3. ¿Migración nueva? → verificar su patrón perezoso de backfill si desglosa agregados.
4. Backup ANTES de desplegar cambios de schema: `scripts/backup-db.sh` (debe correr
   diario por cron hacia almacenamiento SEPARADO del Droplet — si no está
   desplegado, alertar al CEO; es la Capa 6 del Security Loop).

## Smoke tests post-deploy
```bash
curl -s https://somosnortex.com/ | grep -c "Tu negocio ya vende"      # landing viva
curl -s https://somosnortex.com/ferreterias | grep -o '<title>[^<]*'  # prerender por-ruta
curl -s https://somosnortex.com/sitemap.xml | grep -c "<loc>"         # sitemap (70+)
# Con token SUPER_ADMIN:
#   GET /api/admin/metrics        → montos como string decimal
#   GET /api/admin/ledger/verify/<tenantId> → { ok: true }
```
Y una venta de prueba en el POS de un tenant de staging: stock baja, Kardex y
AuditLog escriben, recibo imprime.

## Diagnóstico rápido
- Build falla en Docker con error de sintaxis TS → casi siempre `data/blog-posts.ts`
  o un merge apilado (ver nortex-seo §trampas).
- `prisma` se queja del schema con mensajes de v7 → `node_modules` desincronizado.
- Panel admin vacío → revisar `select`+`include` en la misma relación (throw silencioso).
- El bot de WhatsApp no responde → ¿`WHATSAPP_LLM`/`ANTHROPIC_API_KEY`? ¿la
  conversación quedó en `HUMAN` (handoff)?
