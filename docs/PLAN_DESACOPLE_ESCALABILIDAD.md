# Plan de desacople y escalabilidad de Nortex

**Fecha:** 2026-08-14 · **Verificado contra el código real** (inventario por agentes
con archivo:línea sobre la rama de trabajo; `server.ts` = 9.704 líneas, 175
endpoints). Complementa `docs/SCALING_AUDIT.md` (cuyos hallazgos siguen vigentes
pero con **líneas corridas ~+250**; correcciones de estado en §1).

**Objetivo:** que `server.ts` pase de 9.7k líneas a ~600-800 (imports, config,
montaje de routers, crons, listen) y que el sistema pueda encender una **instancia
#2** sin romper seguridad ni dinero. Todo por **PRs aditivos, mergeables de a uno**,
mismos paths públicos (el frontend no se toca).

---

## 1. Estado real hoy (correcciones a SCALING_AUDIT.md)

| Ítem | Estado real | Evidencia |
|---|---|---|
| C — `--accept-data-loss` | **Corregido de verdad**: `db push` sin el flag, espera TCP + 6 reintentos, `exit 1` si falla | `Dockerfile:34`, `scripts/docker-entrypoint.sh:39-52` |
| A2 — singleton Prisma | **3 consumidores** del singleton (`stockTransfers`, `agentBanking`, `lifecycleEmails`); quedan **21 `new PrismaClient()`** en runtime | `backend/lib/prisma.ts:16` |
| B1 — índices | **Agujero real**: el índice de cobranza `Sale[tenantId, paymentMethod, balance]` existe solo en `migrations/*.sql`, que **nunca se ejecutan en prod** (el deploy usa solo `db push`; no hay `migrate deploy` en ningún lado) → los `.sql` son documentación | `schema.prisma` modelo `Sale` vs `migrations/20260714_b1_composite_indexes/` |
| A1 — rate limiters | Ahora son **10** `MemoryStore` (nuevo: PIN de caja) | §4.2 |
| A4 — crons | Ahora son **3**; el nuevo (`runLifecycleEmails`) **manda emails a clientes reales** con carrera documentada | `server.ts` (bloque final) |
| Nuevo | `accounting.getAccount()` hace queries **fuera de la tx del caller** con su propio cliente → hoy funciona por accidente; si se migra al singleton sin arreglar, **deadlock de pool** | `accounting.ts` (`getAccount` llamado desde `createJournalEntry`) |
| Nuevo | **Ningún `$transaction` fija `timeout`/`maxWait`** → default 5s/2s con la venta haciendo ~100 queries → `P2028` bajo concurrencia | grep en `backend/` = 0 resultados |

Sin `redis`/`bullmq` en `package.json`. `npm start` = `tsx backend/server.ts`, un
proceso, sin cluster.

---

## 2. Inventario de `server.ts` por dominio (175 endpoints)

| # | Dominio | Ep | Rango líneas | Dinero/Inv |
|---|---|---|---|---|
| A | Webhooks raw-body (Stripe, WhatsApp) | 3 | 132-190 | 💰 |
| B | Auth / equipo / invitaciones | 12 | 262-1010 | — |
| C | Onboarding / dashboard | 3 | 1012-1247 | — |
| D | Fintech / capital / B2B | 5 | 1248-1429, 8061-8273 | 💰 |
| E | Clientes / proveedores | 7 | 1430-1609 | — |
| F | Empleados (CRUD) | 3 | 1610-1748 | — |
| G | **Ventas / POS / devoluciones / pagos** | 4 | 1749-2086 | 💰🔥 |
| H | **Turnos / caja / cash movements** | 10 | 2087-2914 | 💰🔥 |
| I | Productos | 9 | 2915-3578 | 📦 |
| J | Inventario / kardex / lotes / conteos | 14 | 3579-4320 | 📦🔥 |
| J2 | Inventario analytics (oracle, reorder) | 2 | 7917-8060 | — |
| K | Reportes | 3 | 4324-4508 | — |
| L | Compras | 4 | 4509-4935 | 💰📦 |
| M | Nómina / aguinaldo / pasivos | 7 | 4936-5591 | 💰 |
| N | Tax report legacy | 3 | 5592-5643, 6912-6925 | — |
| O | Admin / superadmin | 16 | 5644-6208, 6370-6448, 6880-6911 | 💰 |
| P | Billing / Stripe (tenant) | 5 | 6209-6369 | 💰 |
| Q | Cotizaciones | 2 | 6449-6527 | — |
| R | Créditos / cobranza | 5 | 6528-6879 | 💰🔥 |
| S | Tenant settings | 4 | 6926-6977, 8847-8929 | — |
| T | Contabilidad + fiscal interno | 30 | 6978-7916, 8341-8432 | 💰 |
| U | Auditoría (lecturas) | 4 | 8274-8340 | — |
| V | HRM liquidaciones + portal empleado | 9 | 8450-8846 | 💰 |
| W | Público / catálogo / pedidos web | 5 | 8930-9174 | 💰📦 |
| X | Fiscal DGI exports (libros, VET) | 4 | 9175-9608 | — (pesado) |
| Y | Static / SPA / landing | 2 | 9618-9650 | — |

~95 endpoints tocan dinero o inventario. Routers ya extraídos (11): `driver`,
`hr`, `loans`, `motorizados`, `pedidos`, `purchaseOrders`, `serials`, `sync`,
`warehouses`, `agentBanking`, `stockTransfers` — solo los 2 últimos usan el
singleton de Prisma.

**Restricciones de montaje que NO se pueden romper:**
- `express.raw` de Stripe (L132) y WhatsApp (L186) van **antes** de `express.json`
  (L191). Si el webhook de Stripe se monta en el bloque normal de routers, la
  firma se invalida (body ya parseado).
- Los routers se montan en L234-244; `errorTelemetry` va último (L9702).
- Los 3 crons arrancan por side-effect del import → al extraerlos, llamarlos
  explícitamente.

**Helpers definidos dentro de server.ts** (mover junto con su dominio):
`processedItemsCount` (L4810→compras), `computeAguinaldo` (L5437→payroll, cruza
GET+POST), `AdminMetricsResponse` (L5857→admin), `parseBankAccounts`
(L6236→billing), `OBLIGATION_KEYS` (L7614→accounting), `salarioBaseLiquidacion`
(L8433) y `SETTLEMENT_REASONS` (L8447→settlement), `findMyEmployee`
(L8657→mePortal), `MANAGUA_UTC_OFFSET_HOURS`/`fiscalMonthRange`
(L9372-9373→fiscalDates), 7 rate limiters → `middleware/limiters.ts`,
`IVA_RATE` (L4321, duplicado con `'0.15'` literal en L4607) → `config/fiscal.ts`.

---

## 3. Plan A — Extracción de rutas (10 fases, 1 fase = 1 PR mergeable)

**Regla base:** el PR mueve el handler tal cual a `backend/routes/X.ts`, monta
`app.use('/api/<prefix>', router)` en el bloque L234-244, borra el inline. Path
público idéntico. **Toda fase importa `prisma` de `../lib/prisma`** — nunca
instanciar. QA mínima por fase: `npx tsc --noEmit` + smoke test de los paths
movidos + verificación de que ningún handler perdió su middleware de auth.

| Fase | Qué | Riesgo | Guardas específicas |
|---|---|---|---|
| **F0** | Infra sin mover endpoints: `middleware/limiters.ts` (7 limiters), slow-query logger a `lib/prisma.ts`, `lib/fiscalDates.ts`, `config/fiscal.ts` | MUY BAJO | El `$on('query')` exige construir el client con `log: [{emit:'event'}]` en el singleton — si se omite, runtime error al arrancar |
| **F1** | `routes/audit.ts` (U, 4 ep) — el PR-plantilla | MÍNIMO | Smoke de `/api/audit-logs` (dominio H): en Express 4 `app.use('/api/audit')` no captura `/api/audit-logs`, confirmar |
| **F2** | `routes/reports.ts` + `routes/inventoryAnalytics.ts` (K+J2, 5 ep) | BAJO | Aprovechar para H8 (take/groupBy) en L4335/4372 y L7924/7940 |
| **F3** | `routes/quotations.ts` + `routes/tenantSettings.ts` (Q+S, 6 ep) | BAJO | `PUT /api/tenant/slug` llama `invalidateTenantCache` — no perder el import |
| **F4** | `routes/publicCatalog.ts` (W, 5 ep) | MEDIO | Superficie NO autenticada: limiters a nivel `router.use` + smoke de rate-limit real. `convert` (L9092) mueve dinero |
| **F5** | `routes/fiscalExports.ts` (X, 4 ep) | MEDIO | **Regresión obligatoria**: mismo mes antes/después, diff del XLSX. Un cambio de timezone corrompe libros DGI. Aprovechar para H6 |
| **F6** | `routes/admin.ts` (O, 16 ep) | MEDIO-ALTO | **Gate: test que enumera el router stack y asserta `requireSuperAdmin` en los 16** — perder uno = escalada de privilegio |
| **F7** | `routes/hrm.ts` + `routes/mePortal.ts` (V, 9 ep) | MEDIO-ALTO | `/api/hr` ya existe (hrRouter) → usar `/api/hrm` y `/api/me`. El aislamiento del portal depende de `findMyEmployee` (tenantId + userId) |
| **F8** | `routes/accounting/` (T, 30 ep) **en 3 PRs**: `reports` (lecturas) · `masters` (chart, tax-config, activos) · `closing` (periods, cierres, depreciación) | ALTO | `assertPeriodOpen`/`PeriodLockedError` intactos; `annual-close` y `reopen` son irreversibles. Arreglar seed-en-GET (H7) en el PR de masters |
| **F9** | `routes/products.ts` + `routes/inventory.ts` (I+J, 23 ep) | ALTO | **Orden de rutas**: `/categories`, `/publish-bulk`, `/bulk-edit` ANTES de `/:id`. Gate: smoke de `/api/products/categories` que espera array, no 404 |
| **F10** | Una fase por router, **nunca combinadas**: a) `purchases` (+fix H1) · b) `payroll` (+fix H4, H5) · c) `credits` · d) `billing` (**webhook raw montado aparte, antes de `express.json`**) · e) `cash` · f) `shifts` · g) `sales` — **la última**: si falla, el negocio no vende | MÁXIMO | — |

Fases sueltas de bajo riesgo, intercalables entre F3 y F8: B auth (12 ep), C
onboarding, E clientes/proveedores, F empleados, N tax legacy, D fintech.

### Hot-spots a arreglar AL EXTRAER (no en PRs aparte)

- 🔴 **H1 — N+1 en la tx de compras** (`server.ts:4579` + `:4632-4633`): 2 queries
  por ítem con locks tomados (50 ítems = 100+ round-trips). Fix: un `findMany`
  con `id: { in }` + Map antes del loop; el `findUnique` de 4633 es redundante
  (`applyStockDelta` ya relee bajo lock — el comentario del código lo admite).
- 🔴 **H2 — N+1 en devoluciones** (`server.ts:1890`): `createMany` para el kardex.
- 🔴 **H3 — N+1 en cierre de conteo físico** (`server.ts:4117`): ~3 queries por
  SKU con row-locks abiertos hasta el commit (500 SKUs ≈ 1.500 queries) —
  candidato #1 a lock-wait timeout.
- 🔴 **H4 — `$transaction` DENTRO de un `for`: corrida de aguinaldo**
  (`server.ts:5516`): 80 empleados = 80 tx separadas; si la #41 falla, 41 pagados
  y 39 no, sin rollback. Fix: tx envolvente o `runId` de idempotencia.
- 🔴 **H5 — Ruta ensombrecida: el GET de aguinaldo está MUERTO hoy.**
  `GET /api/payroll/:month/:year` (L5213) se registra antes que
  `GET /api/payroll/aguinaldo/:year` (L5456) → `/aguinaldo/2026` entra al genérico
  con `month="aguinaldo"` → `NaN` → 500. Al extraer: paths literales primero +
  guard `isNaN`.
- 🟠 **H6 — XLSX síncrono en el handler** (`server.ts:9434`, `:9522`): CPU-bound
  sobre el mes completo; congela todos los POS. Fix: worker thread o job
  background + 202 con URL de descarga.
- 🟠 **H7 — Seed de escritura dentro de un GET** (`server.ts:7013` chart; también
  L5500 y los GET de `accounting.ts` — balance/estado). Quitar y garantizar el
  seed en onboarding/registro (ya existe `POST /api/accounting/seed`).
- 🟠 **H8 — `findMany` sin `take`: 79 de 101 (78%).** Críticos: L4335 (reporte de
  ventas con `include: items`, el mayor consumo de RAM), L2370 (monitor de cajas
  con todas las ventas de todos los turnos → `groupBy`), L7924/7940 y L7995/8004
  (oracle/reorder: kardex + catálogo completos), L1135/1165 (`/api/dashboard/stats`
  — el endpoint más golpeado), L6532/6586/6657 (cobranza, además sin índice),
  L5894/5902/5980 (**SUPER_ADMIN escanea `Sale` de toda la plataforma**),
  L9394/9462/9550/9557 (exports fiscales). También `accounting.ts:852`
  (`getEstadoResultados` con include anidado), `nicaTax.ts:407`, `audit.ts:246`,
  `scoring.ts:28`.
- 🟡 **H9 — IVA en 3 representaciones** (L4321 `IVA_RATE`, L4607 `'0.15'`, L4358
  `'1.15'`): consolidar en `config/fiscal.ts` en F0.
- 🟡 **H10 — `catch` sin log en contabilidad** (L6983, 6992, 7005, 7019…): pasar
  a `next(error)` para que `errorTelemetry` los vea.

---

## 4. Plan B — Remediación de escalabilidad (fases 0-8, cada una = 1 PR aditivo)

**El corte para "puedo prender la instancia #2" es el final de la Fase B5.**
B0-B1 se pueden mergear hoy sin discusión. Los dos planes (A y B) son
independientes pero comparten F0/B2 (singleton) — coordinarlos.

### B0 — Índice perdido (1 línea, 0 riesgo)
`@@index([tenantId, paymentMethod, balance])` en `Sale` (schema.prisma — el .sql
nunca se aplicó). Bonus: `@@index([tenantId, category])` en `Product`.

### B1 — `getAccount` transaccional (prerequisito puro)
Cambiar `getAccount(tenantId, code)` → `getAccount(tx, tenantId, code)` y
`seedChartOfAccounts(tx, tenantId)`, propagando el `tx` desde
`createJournalEntry`. **Sin esto, B2 introduce un deadlock de pool** (la query
"de afuera" competiría por conexiones del mismo pool que la tx ya bloqueó).

### B2 — Singleton Prisma + `connection_limit`
21 sitios pendientes. Orden por riesgo: **hojas puras** (scoring, audit, nicaTax,
depreciation, stripe + 9 routers legacy: cambio mecánico de import) →
`whatsapp/db.ts` (re-exporta: 1 línea arrastra 5 módulos) → `middleware/auth.ts`
(camino crítico, deploy propio para observar) → `accounting.ts` (**solo tras B1**)
→ `salesService.ts` → `server.ts` (último: mover el slow-query logger al
singleton sin perder telemetría). En el PR final: `?connection_limit=N&
pool_timeout=20` en `DATABASE_URL`. `scripts/*.ts` one-shot se quedan como están.
**Por qué bloquea**: 21 pools × ~9 conexiones ≈ 189 contra `max_connections=151`
de MySQL — la instancia #2 ni arranca sana.

### B3 — Redis: rate limiters + caché de paywall
`ioredis` + `rate-limit-redis`, un store compartido para los **10** limiters, y el
entry de tenant (`middleware/auth.ts`, node-cache TTL 300) a Redis. **Aditivo con
fallback a memoria si `REDIS_URL` no está** → desplegable antes de tener Redis.
Cierra 3 agujeros de seguridad reales (multiplican ×N con instancias): brute-force
de login (keyed por email), **enumeración del PIN de caja de 4 dígitos**
(`/api/shifts/open`) y del PIN de motorizado. Y el bug de dinero del paywall: con
2 instancias, el webhook de Stripe invalida la caché solo en la instancia que lo
recibió — el cliente que acaba de pagar sigue viendo 402 hasta 5 min en la otra.

### B4 — Crons fuera del proceso web
Guard `RUN_JOBS`/`LEADER_ONLY` sobre los 3 crons + servicio `worker` con
`replicas: 1`. El urgente es `runLifecycleEmails`: claim por AuditLog **después**
del `findMany` = carrera clásica; un rolling deploy de N instancias los dispara N
veces en segundos → **emails duplicados a clientes reales**. Aditivo: sin la env,
comportamiento idéntico.

### B5 — Cola de WhatsApp a BullMQ
Sustituir `InMemoryQueue` (`whatsapp/queue.ts`) manteniendo la interfaz
`enqueue(job)` (diseñada para el swap). Hoy los jobs se pierden en cada
deploy/crash (el archivo lo admite); la idempotencia por `waMessageId @unique`
evita duplicados, no pérdidas. **→ A partir de acá el sistema soporta N
instancias.**

### B6 — Acortar la tx de la venta (throughput por tenant)
`salesService.executeSale` hoy: el `invoiceSeries.upsert` con `increment` es lo
**PRIMERO** de la tx → el row-lock del correlativo se retiene ~80-120 queries
hasta el commit → **todas las ventas del tenant se serializan** (POS + WhatsApp +
catálogo + sync compiten por el mismo lock; N instancias solo agrandan la cola).
Fix: mover el increment a justo antes del `sale.create`, `createMany` para
items+kardex, `recordSale` post-commit (ya es fail-soft), `timeout: 15000`
explícito (hoy default 5s → `P2028` bajo concurrencia).

### B7 — Reportes a agregación en DB
`groupBy`/`aggregate` en los ~15 sitios de H8, un endpoint por commit, verificando
contra el resultado viejo. Prioridad: dashboard/stats, reports/sales, panel
SUPER_ADMIN. Nada de esto se arregla con más instancias — es carga sobre la misma
MySQL y empeora ×N.

### B8 — XLSX a background + seeds fuera de lecturas
H6 + H7 si no cayeron ya en las fases A correspondientes.

**Hallazgo negativo verificado (no perder tiempo ahí):** no hay llamadas externas
(LLM/email/Stripe) dentro de ninguna `$transaction` — `whatsapp/inbound.ts` llama
al LLM y al send **antes** de abrir la tx, correcto. Los ~30 `Map`/`Set` del repo
son scratch por-request, ninguno persiste. El correlativo DGI vive en la tabla
(`InvoiceSeries`), correcto para multi-instancia.

---

## 5. Orden de ejecución recomendado (mezclando ambos planes)

```
Hoy mismo, sin discusión:   B0 (índice) · B1 (getAccount tx) · A-F0 (infra)
Semana 1-2:                 A-F1..F3 (plantilla + lecturas) · B2 (singleton, 2-3 PRs)
Semana 3-4:                 B3 (Redis) · A-F4..F5 · B4 (crons)
Mes 2:                      A-F6..F8 · B5 (BullMQ) → ✅ instancia #2 habilitada
Mes 2-3:                    A-F9..F10 (dinero caliente, de a uno) · B6 (tx de venta)
Continuo:                   B7 (un endpoint por commit) · B8
```

Cada PR: rama `claude/<fase>` desde `origin/main`, draft, QA documentada
(`npx tsc --noEmit`, smoke de paths movidos, gates específicos de la fase), y el
Security & Integrity Loop del CLAUDE.md aplicado a lo tocado.
