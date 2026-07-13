# Auditoría de escalado — Monolito Nortex + RAG

**Fecha:** 2026-07-08 · **Método:** análisis estático de código (multi-agente) · **Alcance:** `backend/server.ts` (9.213 líneas), `backend/services/*`, `backend/routes/*`, `backend/middleware/*`, `backend/prisma/schema.prisma`, `Dockerfile`, `docker-compose.yml`, `vite.config.ts`.

> Auditoría **estática**, no de runtime. No se pudo levantar el stack (MySQL + `prisma generate`) en el entorno. Los tiempos/locks descritos son por lectura de código, no medidos. Validar bajo carga antes de dar por resuelto.

---

## Veredicto

**No hay una bomba encendida hoy, pero sí armada.** Producción corre como **un solo proceso** (`tsx backend/server.ts`, un contenedor, sin cluster/PM2, sin Redis), así que todo el estado en memoria funciona *ahora*. Los problemas se agrupan en tres clases:

- **A — Bloqueos de escalado horizontal:** detonan el día que agregás una 2.ª instancia detrás de un balanceador (que es "escalar").
- **B — Bombas de volumen de datos:** detonan a medida que crecen las tablas, **aunque quedes en 1 instancia**.
- **C — Riesgo de pérdida de datos:** independiente de todo lo anterior; es lo más urgente.

Prioridad de arreglo: **C → índices de B → A (antes de multi-instancia) → resto de B.**

---

## C — Riesgo de pérdida de datos (lo más urgente, no depende de escalar)

El `CMD` del `Dockerfile` corre en **cada arranque**:

```
npx prisma db push --schema=... --accept-data-loss && npm run start
```

`db push` es el patrón de deploy elegido del proyecto (DDL aditivo, ver `nortex-migration`). El problema es el flag **`--accept-data-loss`**: si un cambio de schema deja de ser aditivo (drop/rename/narrow de columna), `db push` lo ejecuta **destructivamente y sin aviso** sobre la BD de producción. Con N contenedores arrancando a la vez, además, todos hacen `db push` concurrente sobre la misma BD.

**Fix / guardrail:** mantener el schema **estrictamente aditivo** (nunca drop/rename/narrow); idealmente quitar `--accept-data-loss` del CMD de producción para que un cambio no-aditivo **falle el deploy** en vez de destruir datos. Para un sistema con dinero e inventario reales, este es el primer arreglo.

---

## A — Bloqueos de escalado horizontal (1 → N instancias)

Ninguno está resuelto: no hay `redis`/`ioredis`/`bullmq`/`rate-limit-redis` en `package.json`. Todo el estado compartido es in-process.

| # | Bomba | Ubicación | Qué pasa a N instancias | Clase de fix |
|---|---|---|---|---|
| A1 | **Rate limiters en `MemoryStore`** (7+): login, register, forgot-password, **PIN de caja**, **PIN de motorizado**, público, pedidos | `server.ts:189,199,209,795,2005,8445,8514` · `routes/pedidos.ts:23` · `routes/driver.ts:38,44` | El límite se multiplica ×N; login "5/h" → `5×N/h`. Es **agujero de seguridad** (brute-force de credenciales/PIN), no solo de escala. | `rate-limit-redis` + Redis |
| A2 | **~21 `new PrismaClient()`** (uno por módulo) **sin `connection_limit`** | `server.ts:75`, `middleware/auth.ts:6`, `services/{accounting,audit,depreciation,nicaTax,salesService,scoring,stripe,whatsapp/db}.ts`, `routes/{purchaseOrders,motorizados,hr,loans,driver,sync,serials,pedidos,warehouses}.ts` | `N × 21 × pool` conexiones → **agota `max_connections` de MySQL** enseguida | Singleton `lib/prisma.ts` importado por todos + `connection_limit` en la URL |
| A3 | **Caché de paywall** (`node-cache`) invalidado **solo local** | `middleware/auth.ts:16,55,59` | Tenant suspendido/reactivado queda **inconsistente hasta 5 min** según qué instancia atienda | Caché en Redis o invalidación por pub/sub |
| A4 | **Crons `setInterval` in-process** (suscripciones, depreciación) | `server.ts:9202,9207` | Se ejecutan **duplicados en cada instancia** (trabajo desperdiciado + posible carrera) | Scheduler externo / leader-election; sacar del proceso web |
| A5 | **Cola de WhatsApp en memoria** (`InMemoryQueue`) | `services/whatsapp/queue.ts` · `inbound.ts` · `webhook.ts` | Jobs **se pierden al reiniciar** (deploy/crash) y **no se reparten**; el reintento de Meta puede caer en otra instancia | BullMQ/Redis con la misma interfaz `enqueue` (ya está diseñada para el swap) |

Revisado y **sin hallazgos**: no hay escrituras a disco local (solo `sendFile` de HTML prerenderizado, lectura), no hay WebSockets/socket.io con estado de sesión, y los `Map`/`Set` a nivel handler son scratch por-request (no cachés compartidos). El keyring JWT es per-proceso pero deriva de env idéntica → consistente.

---

## B — Bombas de volumen de datos (crecen con los datos, aun en 1 instancia)

### B1 — Índices faltantes en las tablas más grandes y calientes (barato, alto impacto)

Un solo migration aditivo. Hoy estas tablas solo tienen `@@index([tenantId])` y filtran/ordenan el resto en memoria:

- **`Sale`** → falta `@@index([tenantId, createdAt])` y `@@index([tenantId, paymentMethod, balance])`. Alimenta **todos** los reportes, cobranza, libros DGI y scoring (`server.ts:1060,4097,6124,6178,6249,7324`; `nicaTax.ts:70`; `scoring.ts:27`).
- **`AuditLog`** → la tabla que más rápido crece (1 fila por venta/ajuste/pago/cierre), solo `[tenantId]`/`[userId]`. Falta `@@index([tenantId, createdAt])` y `@@index([tenantId, action, createdAt])` (`server.ts:1107,2382`). Considerar retención/particionado.
- **`KardexMovement`** → índices de **una** columna para queries de dos/tres (`tenantId+type+date`, `tenantId+productId+date`). Falta `@@index([tenantId, type, date])` y `@@index([tenantId, productId, date])` (`server.ts:3386,7488,7559`).
- **`Expense`** → falta `@@index([tenantId, createdAt])` (`server.ts:1090,4134,4231`).
- **`Purchase`** → falta `@@index([tenantId, date])` (`server.ts:8982`; `nicaTax.ts:87`; `accounting.ts:663`).
- **`Payment`** → solo `[saleId]`; el agregado de cobros del día filtra `sale.tenantId + createdAt` (`server.ts:6216`).

### B2 — La venta (ruta más caliente) tiene N+1 + un lock que serializa

- **Hot-row lock del correlativo DGI:** `salesService.ts` toma el row-lock de `InvoiceSeries(tenantId,'A')` con el `increment` al **inicio** del `$transaction` y lo retiene mientras corren ~80–100 queries (stock + kardex + asiento contable **por ítem**). Con varias cajas/canales por tenant (POS + WhatsApp + público), las ventas del mismo tenant **se serializan a ~1 a la vez**.
- **N+1 por ítem:** `saleItem.create` + `applyStockDelta` (~5–7 queries) + `kardexMovement.create` por ítem, más `recordSale`→`createJournalEntry` con `journalLine.create` + `account.update` por línea contable (`salesService.ts:263-317`; `accounting.ts:162-203`).
- **Fix:** mover el `increment` del correlativo justo antes del `sale.create`; `saleItem.createMany`/`kardexMovement.createMany`; consolidar lecturas de cuentas en una `findMany`; sacar el asiento contable a job post-commit (ya es fail-soft). Mismo patrón N+1/tx-por-ítem en nómina (`server.ts:4761`), aguinaldo (`:5202`), compras (`:4319`), OC (`routes/purchaseOrders.ts:60`), sync (`routes/sync.ts:77`) y carga masiva (`:2884`).

### B3 — Reportes/exports que traen tablas enteras a memoria

- `findMany` **sin `take`** que suman en JS: `/api/reports/sales` (`server.ts:4097`), inventario (`:4180`), Oráculo/Reorden (`:7504,7568`), cobranza debtors/worklist/statement/aging (`:6124,6178,6249,7324`), Estado de Resultados por período (`accounting.ts:580`). **Fix:** agregación en DB (`groupBy`/`aggregate`), no traer filas.
- **XLSX síncrono en el event loop:** libros DGI y VET arman y serializan el archivo en el hilo de la request (`server.ts:8949,9037,9087`), tras un `findMany` sin `take` del mes. Un mes grande **congela TODAS las requests**. **Fix:** generar en background/worker y streamear.

### B4 — Amplificación de escritura escondida

`getBalanceGeneral`/`getEstadoResultados` llaman `seedChartOfAccounts` (`createMany` de ~40 cuentas, `accounting.ts:74`) en **cada** carga de dashboard/estado financiero (`server.ts:1118`). **Fix:** sembrar el catálogo contable una sola vez en el onboarding, no en lecturas.

### B5 — Dashboard SUPER_ADMIN

`sale.aggregate` **sin filtro de tenant** sobre `createdAt` (escanea toda la tabla `Sale` de la plataforma, sin índice) + `_count` correlacionado por tenant (`server.ts:5573,5568`). **Fix:** métricas materializadas/rollup.

### B6 — Frontend: bundle inicial pesado

El chunk principal del SPA es **~2.14 MB** (`~594 KB` gzip) y el PWA precachea ~2.3 MB. En POS sobre Android barato (mercado real) la primera carga duele. El blog ya está lazy-loaded (bien); el resto del SPA no está code-split por ruta. **Fix:** `manualChunks`/lazy por módulo pesado (recharts, xlsx del importador).

---

## RAG de ingeniería — sano en el eje de escala

El retriever (`backend/services/whatsapp/rag.ts`) es **búsqueda híbrida por FULLTEXT de MySQL** (`MATCH(name, category) AGAINST(... IN BOOLEAN MODE)`), con el índice **realmente creado** (`@@fulltext([name, category])` en `schema.prisma:815` + migración `20260629_product_fulltext_catalog`), tenant-scoped y parametrizado (`$queryRaw` con `Prisma.sql` → sin inyección). El fallback léxico (`LIKE '%term%'`, `take:100` + re-rank en JS) **solo corre si el FULLTEXT no devuelve nada** → acotado. **No es un scan O(n) oculto.**

Límites reales del RAG (no de escala de búsqueda):
- **Calidad:** es keyword/FULLTEXT, no semántico — no entiende sinónimos/intención. La interfaz `CatalogRetriever` ya está lista para enchufar un vector store (Qdrant/Pinecone) sin tocar al agente.
- **Throughput del LLM:** cada mensaje entrante dispara una llamada al modelo dentro de la `InMemoryQueue` (concurrencia fija = 2/proceso, ver A5). El cuello de botella al escalar WhatsApp es el LLM + la cola, no el retrieval.

---

## Plan priorizado

1. **`Dockerfile` → schema aditivo garantizado** (quitar `--accept-data-loss` o gate). 1 línea, mata el peor riesgo (C).
2. **Migración de índices** (B1): `Sale`, `AuditLog`, `KardexMovement`, `Expense`, `Purchase`, `Payment`. Barato, alto impacto, no cambia lógica.
3. **Antes de la instancia #2** (A): singleton Prisma + `connection_limit`; rate-limit y caché de paywall a Redis; crons fuera del proceso web; cola WhatsApp a BullMQ.
4. **Después** (B2–B6): paginar/agregar reportes, batchear el N+1 de la venta + acortar la tx, XLSX en background, no sembrar el catálogo por lectura, code-split del SPA.

---

## No verificado (requiere entorno con BD)

- Tiempos reales de lock/tx bajo concurrencia (B2).
- `EXPLAIN` de las queries de reporte para confirmar el uso de índices (B1).
- Comportamiento de `db push --accept-data-loss` ante un cambio no-aditivo real (C).
