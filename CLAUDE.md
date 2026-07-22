# CLAUDE.md — Guía para agentes en Nortex

Nortex es un **ERP/POS multi-tenant** para PyMEs de Nicaragua (ferreterías, pulperías,
farmacias, distribuidoras/misceláneas, prestamistas). Stack: **React + Vite** (SPA + PWA),
**Express + Prisma** (backend, `backend/server.ts` + `backend/routes/*`), **MySQL 8**
(InnoDB; migraciones con backticks — NO PostgreSQL), **TypeScript** estricto.
Maneja **dinero e inventario reales** → la integridad y la seguridad no son negociables.

- Backend: `tsx backend/server.ts` (sin build). Verificar con `npx tsc --noEmit`.
- Frontend: `npm run build` (Vite + PWA). Producción usa `npm run build:seo`
  (build + prerender por-ruta: 70+ HTML estáticos + sitemap — ver `scripts/prerender.ts`).
- Deploy: Docker + `prisma db push` (aplica **solo DDL**; los backfills de datos van
  en la aplicación con patrón perezoso). Prisma pinneado a **6.4.1** — correr
  `npm install` tras cambiar de rama, o `npx` puede traer prisma 7 y fallar engañosamente.
- Auth: JWT. `authenticate` (`backend/middleware/auth.ts`) pone `req.tenantId`,
  `req.userId` y `req.role`. **Esa es la única fuente confiable del tenant** — nunca
  tomarlo de `req.body`/query. La home `/` de producción se sirve desde
  `public/landing.html` (estático), no desde el SPA.
- Dinero: **`decimal.js`**, nunca `Number`/`parseFloat` para cálculos.
- Stock: **siempre** vía `applyStockDelta` (`backend/services/stockService.ts`) —
  UPDATE condicional atómico + Kardex; acepta `warehouseId` opcional (multi-bodega).

---

## 🧭 Método de trabajo (OBLIGATORIO)

Toda implementación sigue la skill **`nortex-feature`**
(`.claude/skills/nortex-feature/SKILL.md`): recon del código real → rama
`claude/<feature>` desde `origin/main` + `npm install` → diseño aditivo que no toca
el core → schema/migración/backend/frontend → **rondas de QA** (tsc+validate, casos
de lógica pura en `.cjs`, aislamiento por tenant, build+regresión) → **PR en draft**
con la QA documentada. Los hallazgos de QA **se corrigen antes del push**, no se anotan.

Skills especializadas (en `.claude/skills/`): **nortex-qa** (rondas de QA sobre
código existente/diffs) · **nortex-migration** (schema/BD: MySQL + db push aditivo)
· **nortex-security-audit** (barrido por clases de bug reales, hallazgos S-n) ·
**nortex-seo** (landing/blog/prerender) · **nortex-deploy** (release, env vars,
smoke tests) · **nortex-rag** (agente WhatsApp: retrieval, tools, cerebro LLM,
simulador de conversaciones) · **run-nortex** (levantar la app real y probarla).

---

## 🔐 Security & Integrity Loop (OBLIGATORIO antes de entregar código)

Antes de escribir, refactorizar o sugerir código/infra, validá mentalmente estas 6
capas. **Si alguna da NO → reescribir antes de responder.** No mostrar intentos
fallidos; entregar solo el resultado que pasa el loop, y confirmar al final:
`✓ Security & Integrity Loop superado` (con el alcance de lo entregado).

**Datos y finanzas**
1. **Aislamiento multi-tenant.** Toda query Prisma sobre datos de negocio incluye
   `tenantId` (o el scoping correcto, p. ej. `lenderId`) tomado de `req.tenantId`
   (JWT). Cuidado con `update/delete/findUnique` por `id` suelto: verificar
   propiedad con `findFirst({ id, tenantId })` primero.
2. **Persistencia segura.** Soft delete (`deletedAt`) para datos de negocio/históricos;
   borrado físico SOLO para data efímera (caché, sesiones, colas temporales).
3. **Inmutabilidad de auditoría.** Operación que mueve dinero o inventario →
   `AuditLog` con `before`/`after`, `userId`, `tenantId`, **dentro de la misma
   transacción**. Complementos: Kardex (`stockBefore/After` del read-back) y el
   libro firmado (`backend/services/ledger.ts`) para movimientos de caja.
4. **Precisión financiera.** Campos money nuevos en `Decimal`; código con `decimal.js`
   estricto. (`Product.price/cost/wholesale/pack` son Float legacy y migran juntos
   en el sweep a `Decimal(18,4)` — no perpetuar el patrón en campos nuevos no
   relacionados con ellos.)

**Seguridad y brechas**
5. **Auth y entradas.** Validar `req.body` con **Zod** en rutas de dinero. Sin
   secretos hardcodeados (JWT por keyring `JWT_SECRETS`, ver
   `backend/services/secrets.ts`). Auth con **rate limit** (ya activo: login,
   register, reset + limiter global — pero `MemoryStore`, per-proceso: no protege
   con >1 instancia, ver `docs/SCALING_AUDIT.md` A1). Endpoints sensibles con
   `authenticate` + `checkRole`.

**DevOps y resiliencia**
6. **Backups.** Si tocás config de BD/Docker/Coolify, garantizar **backup automático
   diario a almacenamiento SEPARADO** del Droplet (`scripts/backup-db.sh`). Si no
   está desplegado, alertar al CEO.

---

## 🚀 Escalabilidad — guardrails (OBLIGATORIO al tocar backend/BD)

Nortex hoy corre como **UN proceso** (single instance): el rate-limit, el caché de
paywall (`node-cache`) y la cola de WhatsApp (`InMemoryQueue`) viven en memoria y
funcionan solo con 1 instancia. Detalle, ubicaciones y prioridades en
`docs/SCALING_AUDIT.md`. Al escribir código nuevo, respetá estas reglas para no armar
la bomba (revisadas junto al Security Loop):

1. **Un solo cliente Prisma.** NO crear `new PrismaClient()` nuevos (ya hay ~21, uno
   por módulo → agotan conexiones al escalar). Importar el cliente compartido.
   Consolidación a `lib/prisma.ts` pendiente (SCALING_AUDIT A2).
2. **Listados con límite.** Prohibido `findMany` sin `take`/paginación sobre tablas de
   negocio (`Sale`, `KardexMovement`, `AuditLog`, `Product`, `Payment`, `Expense`,
   `JournalEntry`). Reportes/dashboards: agregá en la BD (`groupBy`/`aggregate`), NO
   traigas filas y sumes en JS.
3. **Índices con cada query.** Si agregás una query que filtra u ordena por un campo,
   agregá el `@@index` (compuesto, p. ej. `[tenantId, createdAt]`) en el MISMO cambio.
4. **Transacciones cortas.** Dentro de `$transaction`: nada de N+1 (usá `createMany`/
   `updateMany` + lecturas consolidadas), no tomar el lock del correlativo/hot-row al
   inicio de una tx larga, y CERO llamadas externas (LLM/email/Stripe) dentro de la tx.
5. **Nada pesado síncrono en el handler.** XLSX/PDF/CSV grandes bloquean el event loop
   → background/stream, nunca inline en la request.
6. **No sembrar en lecturas.** Nada de `createMany`/seed en un endpoint GET (p. ej. el
   catálogo contable) — amplificación de escritura.
7. **Estado en memoria = per-proceso.** Rate-limit, caché de paywall y colas NO se
   comparten entre instancias; no asumas multi-instancia sin store compartido
   (Redis/BullMQ).
8. **Schema estrictamente aditivo.** El deploy corre `db push` **sin**
   `--accept-data-loss` (ya se quitó): un cambio NO aditivo (drop/rename/narrow)
   hace **fallar el arranque** (la instancia vieja sigue sirviendo) en vez de
   borrar datos de prod. Igual: nunca introducir cambios destructivos (SCALING_AUDIT C).

---

## ⚠️ Estado actual (ver `docs/SECURITY_AUDIT.md` para seguridad S1–S28 · `docs/SCALING_AUDIT.md` para escalado)

**Ya cumplido (no re-hacer):** hotfixes cross-tenant (S1–S4) · Zod + rate-limits en
rutas de dinero y auth · AuditLog before/after en mutaciones de dinero (S8–S12:
préstamos, abonos, crédito A/R, precios) · concurrencia atómica de stock/wallet ·
libro firmado de caja · keyring JWT rotable.

**Gaps pendientes (NO asumir cumplimiento):**
- **Capa 2:** no hay soft-deletes; ningún modelo tiene `deletedAt`.
- **Capa 4:** `Product.price/cost` (Float) y varios campos `Decimal(12,2)/(10,2)`;
  el sweep a `Decimal(18,4)` es una migración pendiente (los montos del Command
  Center ya están en 18,4).
- **Escalabilidad (ver `docs/SCALING_AUDIT.md`):** hoy single-instance. Ya
  corregido: `--accept-data-loss` fuera del deploy (el `db push` ahora falla ante
  un cambio destructivo en vez de borrar prod) e índices compuestos B1 en
  `Sale`/`AuditLog`/`KardexMovement`/`Expense`/`Purchase`/`Payment`/`StockTransfer`.
  Bombas pendientes: ~21 `new PrismaClient()` (existe el singleton `backend/lib/prisma.ts`
  pero falta migrar los módulos legacy), rate-limit/caché/cola en memoria, N+1 en la
  venta, reportes/XLSX sin paginar. No asumir que escala horizontal sin estos arreglos.
- Al tocar estas áreas: corregí lo que toques al estándar del loop, y no declares
  "superado" a nivel sistema sin respaldo del informe de auditoría.

---

## 🗺️ Mapa de subsistemas (dónde vive cada cosa)

| Subsistema | Dónde |
|---|---|
| Ventas/POS | `components/POS.tsx` (regla pura de precios por cantidad — detalle→mayoreo→empaque — al tope del archivo; el carrito reprecia solo con `basePrice` preservado) · `backend/services/salesService.ts` (`executeSale`: total autoritativo server-side, idempotencia por `offlineId`) |
| Stock | `backend/services/stockService.ts` (atómico, multi-bodega con backfill perezoso) · Kardex · lotes FEFO (`ProductBatch`) · series (`/api/serials`) · conteos (`StockCount`) |
| Compras | `/api/purchases` (factura: costo promedio ponderado + lotes + dinero) · `/api/purchase-orders` (OC: DRAFT→APPROVED→RECEIVED; la recepción es goods-receipt SIN dinero) |
| Multi-bodega | `Warehouse`/`ProductStock` + `/api/warehouses`. `Product.stock` sigue siendo el agregado autoritativo; transferencias = Fase 3 pendiente |
| Mayoreo | `Product.wholesalePrice/wholesaleMinQty` (+ empaques `packUnit/packSize/packPrice`) · `Customer.isWholesale` · regla pura en el POS |
| Préstamos (LENDER) | `backend/routes/loans.ts` (motor dual francés/flat, plan de cuotas, mora; scoping por `lenderId`) |
| WhatsApp/IA | `backend/services/whatsapp/*` — agente tool-use (Claude Haiku) con RAG híbrido FULLTEXT (`rag.ts`) y memoria conversacional; el tenant viaja SIEMPRE server-side en `ToolContext` (inmune a prompt injection) |
| Admin | `components/SuperAdmin.tsx` + `/api/admin/*` (métricas con Decimal, SWR) — solo SUPER_ADMIN |
| Contabilidad/fiscal | `backend/services/accounting.ts` (partida doble NIIF) · `nicaTax.ts` / `nicaLabor.ts` (DGI, Ley 185) · depreciación · cierres |
| SEO/marketing | `public/landing.html` (home de prod) · `scripts/prerender.ts` (HTML por ruta + sitemap dinámico) · blog en `data/blog-posts.ts` + `data/blog-clusters.ts` (el `cluster` referencia por **name** exacto) |
| Delivery | `backend/routes/pedidos|motorizados|driver` (Red Nortex; wallet del repartidor con libro firmado) |

---

## Convenciones del repo

- Ramas: una por feature (`claude/<feature>`) desde `origin/main`; PRs en **draft**;
  fases grandes = PRs secuenciales (mergear la Fase A antes de construir la B).
- Mensajes, UI y comentarios en **español** (variante nicaragüense; voseo en UI).
- Verificación mínima antes de pushear: `npx tsc --noEmit` y (si tocaste frontend)
  `npm run build`. Migración aditiva en `backend/prisma/migrations/` si tocaste el schema.
- No introducir dependencias pesadas sin necesidad; el bundle del SPA ya roza el
  límite de precache del PWA (SWR se eligió sobre react-query por esto).
- Commits: `feat|fix(<área>): <qué>` con el porqué + resumen de QA en el cuerpo.
