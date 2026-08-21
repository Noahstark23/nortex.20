# Auditoría de Seguridad e Integridad — Nortex POS

Auditoría de las **6 capas** del Security & Integrity Loop sobre todo el backend
(`backend/server.ts`, `backend/routes/*`, `backend/services/*`, `backend/prisma/schema.prisma`),
realizada por 3 auditorías en paralelo + verificación manual. Fecha: 2026-06.
**Re-auditoría 2026-07-14** (3 frentes en paralelo + verificación adversarial manual):
hallazgos nuevos S29–S31 abajo; estados de S1–S28 refrescados en las tablas.
**Re-auditoría 2026-07-23** (2 red-teams adversariales — acceso/auth/inyección +
dinero/integridad — sobre el módulo Agente Bancario y código nuevo): S32–S34 abajo,
los 3 corregidos en el PR; el carril de aislamiento/inyección salió limpio.

**Estado:** los hallazgos **CRÍTICOS de bajo riesgo ya están corregidos** en este PR
(marcados `✅ FIXED`). El resto, que requiere migraciones o cambios amplios, está en
`docs/SECURITY_REMEDIATION_PLAN.md` (marcado `📋 PLAN`).

---

## Resumen ejecutivo

**Lo que está BIEN (confirmado, no perder tiempo aquí):**
- **JWT fail-closed:** `services/secrets.ts` lanza si no hay `JWT_SECRET(S)`; **sin fallback
  hardcodeado**. Keyring con rotación sin downtime (`verifyAuthToken`).
- **Sin secretos vivos en el código** de runtime (Stripe/Resend/Anthropic leen de `process.env`).
- **El POS está bien aislado:** ~128 queries scoped por `tenantId`; el patrón correcto
  (`findFirst({where:{id,tenantId}})` → 404 → mutar) se usa de forma consistente en
  `server.ts` y en los routers `driver/hr/sync/pedidos/motorizados`.
- **Auditoría inmutable** en ventas, caja (entra/sale/anula), cambio de rol, merma de
  inventario; el libro de caja además está encadenado con HMAC.

**Lo CRÍTICO encontrado:** 4 brechas de escritura **cross-tenant** (corregidas), endpoints
de auth sin rate-limit ni validación, montos negativos que aumentaban saldos (corregido),
y dos **secretos en el historial de git**. Más una deuda estructural grande en precisión
financiera (`Float` en precios), soft-deletes (inexistentes) y cobertura de auditoría.

---

## Capa 1 — Aislamiento multi-tenant

| ID | Hallazgo | Ubicación | Sev | Estado |
|----|----------|-----------|-----|--------|
| S1 | `POST /loans/:id/repayments`: abonar a préstamo ajeno, bajar saldo, forzar PAID_OFF | `routes/loans.ts:92` | 🔴 CRÍTICO | ✅ FIXED (guard `lenderId`) |
| S2 | `PATCH /loans/clients/:clientId`: bloquear / cambiar cupo de cliente ajeno | `routes/loans.ts:225` | 🔴 CRÍTICO | ✅ FIXED (`updateMany`+`tenantId`) |
| S3 | `POST /loans/:id/refinance`: leer PII y cerrar préstamo ajeno | `routes/loans.ts:279` | 🔴 CRÍTICO | ✅ FIXED (`findFirst`+`lenderId`) |
| S4 | `POST /api/credits/payment`: abonar a venta ajena (`findUnique` por `saleId` sin tenant) | `server.ts:5248` | 🔴 CRÍTICO | ✅ FIXED (`findFirst`+`tenantId`) |
| — | Resto de `server.ts` y routers: correctamente scoped (verificado) | — | — | OK |
| — | `GET /api/v1/pedidos/:id/tracking`: link público expone nombre cliente + tel. motorizado (IDs UUIDv4) | `routes/pedidos.ts:205` | 🟡 MED | 📋 PLAN |

## Capa 2 — Persistencia / soft-delete

**Ningún modelo tiene `deletedAt`** (verificado en los 67 modelos). Todo borrado es físico.

| ID | Hallazgo | Ubicación | Sev | Estado |
|----|----------|-----------|-----|--------|
| S5 | `product.delete` (catálogo; FK de SaleItem/Kardex) — huérfana históricos | `server.ts:2623` | 🟠 HIGH | 📋 PLAN |
| S6 | `supplier.delete` (maestro de proveedor) | `server.ts:1244` | 🟡 MED | 📋 PLAN |
| S7 | `holiday.deleteMany` (calendario que afecta nómina) | `routes/hr.ts:604` | 🟡 MED | 📋 PLAN |
| — | `invitation.delete` (efímero) — borrado físico aceptable | `server.ts:700` | 🟢 LOW | OK |
| — | No existen `sale/loan/payment/expense.delete` (bien), pero tampoco `deletedAt` | — | — | 📋 PLAN |

## Capa 3 — Inmutabilidad de auditoría

**Estructural (🟠 HIGH):** `AuditLog` (`schema:668`) solo tiene `action` + `details String?`
libre; **sin columnas `before`/`after` ni inmutabilidad** a nivel BD (filas editables/borrables).

| ID | Mutación sin auditoría | Ubicación | Sev | Estado |
|----|------------------------|-----------|-----|--------|
| S8 | Desembolso de préstamo | `routes/loans.ts:64` | 🔴 CRÍTICO | ✅ FIXED (`LOAN_DISBURSED`) |
| S9 | Pago/abono de préstamo (cambia saldo) | `routes/loans.ts:115` | 🔴 CRÍTICO | ✅ FIXED (`LOAN_PAYMENT` before/after) |
| S10 | Abono a crédito (A/R) — muta `Sale.balance` | `server.ts:5248` | 🔴 CRÍTICO | ✅ FIXED (`CREDIT_PAYMENT` before/after) |
| S11 | Penalidad / refinanciamiento / depósito a bóveda | `routes/loans.ts:355,279,461` | 🟠 HIGH | ✅ FIXED (3 acciones) |
| S12 | Cambio de precio/costo (solo stock escribe Kardex) | `server.ts:2445` | 🟠 HIGH | ✅ FIXED (`PRICE_CHANGED`) |
| S13 | Desembolso de capital (tiene firma+asiento, sin AuditLog) | `server.ts:6425` | 🟠 HIGH | 📋 PLAN |
| S14 | Anticipos de nómina / deducciones judiciales; wallet de motorizado | `routes/hr.ts:197`, `routes/driver.ts:312` | 🟡 MED | 📋 PLAN |

## Capa 4 — Precisión financiera

| ID | Hallazgo | Ubicación | Sev | Estado |
|----|----------|-----------|-----|--------|
| S15 | **`Product.price` y `Product.cost` son `Float`** — raíz de todo: priceAtSale, COGS, valuación | `schema:698-699` | 🔴 CRÍTICO | 📋 PLAN |
| S16 | Todos los `@db.Decimal` monetarios son escala 2 (no 18,4): IVA/interés redondean a centavo | `schema` (ver plan) | 🟠 HIGH | 📋 PLAN |
| S17 | `Sale.globalDiscount` / `SaleItem.discount` como `Float` | `schema:453,482` | 🟠 HIGH | 📋 PLAN |
| S18 | ~16 cálculos que se ALMACENAN bypassean Decimal (nómina, retornos, arqueo, cotización, originación de préstamo cluster) | `server.ts:1434,1631,2533,3902-3961,5003,6378…`, `routes/loans.ts:96,361`, `routes/hr.ts:188,202`, `services/accounting.ts:195,406` | 🟠 HIGH | 📋 PLAN |
| — | El núcleo (ventas/IVA, costo promedio, valuación) **sí** usa `decimal.js` correctamente | — | — | OK |

## Capa 5 — Auth y brechas

| ID | Hallazgo | Ubicación | Sev | Estado |
|----|----------|-----------|-----|--------|
| S19 | `.env.backup` **commiteado** (DATABASE_URL + JWT_SECRET) — en historial git | repo / commit `abba226` | 🔴 CRÍTICO | ✅ untrack + 📋 ROTAR |
| S20 | `reset-password` y `register` **sin rate-limit** (fuerza bruta del token = ATO) | `server.ts` | 🔴 CRÍTICO | ✅ FIXED (limiters) |
| S21 | Endpoints de auth (register/login/reset) **sin validación Zod** | `server.ts:204,279,815` | 🔴 CRÍTICO | 📋 PLAN |
| S22 | `req.body` sin validar en ~55 de ~70 handlers (los críticos: credits/payment, kardex, sales, loans, finance-purchase) | varios | 🟠 HIGH | parcial ✅ / 📋 PLAN |
| S23 | Monto negativo en `credits/payment` aumentaba saldo | `server.ts:5248` | 🔴 CRÍTICO | ✅ FIXED |
| S24 | `loginLimiter` solo por IP y 10/h (laxo) | `server.ts:173` | 🟠 HIGH | 📋 PLAN |
| S25 | Password de super-admin hardcodeado | `scripts/createSuperAdmin.ts:12` | 🟡 MED | 📋 ROTAR |

## Capa 6 — DevOps / resiliencia

| ID | Hallazgo | Ubicación | Sev | Estado |
|----|----------|-----------|-----|--------|
| S26 | `db` + `app` en el mismo stack/volumen local; **sin backup off-site** | `docker-compose.yml` | 🔴 CRÍTICO | ✅ script + 📋 desplegar cron |
| S27 | MySQL expuesto `3306:3306` con `MYSQL_ROOT_PASSWORD` default `root` | `docker-compose.yml:8,11` | 🟠 HIGH | 📋 PLAN |
| S28 | `phpmyadmin` en el stack de producción (superficie extra) | `docker-compose.yml:15` | 🟡 MED | 📋 PLAN |

---

## Re-auditoría 2026-07-14 — hallazgos nuevos (S29–S31)

Barrido de bugs **no catalogados** sobre `server.ts` + `routes/*` + `services/*`, más
auditoría del código mergeado en PRs #72–#76 (transferencias, observabilidad, CI).

| ID | Hallazgo | Ubicación | Sev | Estado |
|----|----------|-----------|-----|--------|
| S29 | **`POST /api/b2b/order`: total del cliente sin validar + sin `checkRole` + débito no atómico.** Un `total` negativo pasaba el chequeo `saldo < total` y el `decrement` **aumentaba** el wallet (crédito ilimitado auto-otorgado); dos órdenes concurrentes sobregiraban (TOCTOU); sin AuditLog | `server.ts:1255` | 🔴 CRÍTICO | ✅ FIXED (Zod `B2BOrderSchema` total>0/finito · `checkRole(OWNER,ADMIN)` · débito `updateMany` condicional `gte` · `B2B_ORDER` before/after) |
| S30 | **`PATCH /pedidos/:id/estado`: carrera de doble facturación.** El guard `!facturaId` se leía fuera de la tx → dos requests `entregado` concurrentes creaban 2 `Sale`+`Payment`+asiento | `routes/pedidos.ts:255` | 🟠 HIGH | ✅ FIXED (claim atómico `updateMany({estado:{not:'entregado'}})` → 409 si `count===0`) |
| S31 | **`uncaughtException` sin `process.exit`.** Tras un uncaught el proceso seguía vivo en estado indefinido y Docker (`restart: always`) nunca reiniciaba → app de dinero atendiendo requests corrupta | `services/observability.ts:33` | 🟠 HIGH | ✅ FIXED (`flush(2000)`→`exit(1)`; `errorTelemetry` respeta `err.status` y no reporta 4xx) |

Otros arreglos de integridad/escala aplicados en el mismo PR (sin ID de seguridad):
transferencias de stock (`routes/stockTransfers.ts`) — Zod + cap de 50 ítems, `findMany`
consolidado (no N+1), materialización de la fila **destino** para no perder stock
implícito del desglose, error como objeto (no `split(':')`), retry ante deadlock
InnoDB (P2034), y `new PrismaClient()` reemplazado por el singleton nuevo
`backend/lib/prisma.ts` (primer paso del sweep A2); `warehouseId` propagado al Kardex
de compras y recepción de OC; `PUT /warehouses/:id` rechaza nombre vacío y desactivar
bodega con existencias; índices compuestos B1 (ver SCALING_AUDIT).

### Estados de S1–S28 refrescados (2026-07-14, verificado en HEAD)

**Ya corregidos desde la auditoría original** (los docs los tenían como 📋 PLAN):
S13 (desembolso de capital ya escribe AuditLog), S21 (register/login/reset con Zod),
S25 (password de super-admin exige env ≥12 chars), S27 (MySQL sin `ports`, root sin
default), S28 (phpMyAdmin bajo perfil `debug`), y el flag **`--accept-data-loss`
quitado del Dockerfile** (bomba C del SCALING_AUDIT). S5 pasó a PARCIAL (product.delete
con guard `stock>0`+AuditLog, aún físico). S14 PARCIAL (wallet motorizado ✅; anticipos
de nómina en `routes/hr.ts` **siguen sin AuditLog** — abierto). S24 PARCIAL (login 5/h
pero solo por IP + MemoryStore).

**Siguen ABIERTOS (📋 PLAN):** S6, S7, S15–S18 (Float en dinero), S19 (rotación/purga
—acción del CEO), S22 (rutas sin Zod restantes), soft-deletes globales (Capa 2), y el
tracking público de pedidos con PII (`routes/pedidos.ts` `GET /:id/tracking`).

---

## Re-auditoría 2026-07-23 — red-team adversarial (S32–S34)

Dos red-teams en paralelo (carril **acceso/auth/inyección** + carril **dinero/integridad**)
sobre el código NUEVO sin auditar desde el 2026-07-14: módulo **Agente Bancario**
completo (`routes/agentBanking.ts`, PRs Fase A–D), Préstamos Fase 2 y el rediseño.

**Resultado del carril acceso/auth/inyección:** **sin brechas nuevas.** El aislamiento
multi-tenant, el patrón `findFirst({id, tenantId})→404→mutar`, los `updateMany`
condicionales, el raw SQL parametrizado y el tenant server-side del agente WhatsApp
(ninguna tool acepta ids del LLM) están **sólidos**. No hay IDOR, SQLi, spoofing de
tenant/rol ni prompt-injection cross-tenant en la superficie nueva.

**Resultado del carril dinero/integridad:** 3 bugs de integridad **intra-tenant** en
código nuevo (ninguno cruza tenants). **Los 3 corregidos en este PR.**

| ID | Hallazgo | Ubicación | Sev | Estado |
|----|----------|-----------|-----|--------|
| S32 | **`POST /agent-banking/transactions`: `commission` del cliente confiada, sin tope ni relación con `amount`.** Un cajero enviaba `amount:1, commission:50M` → `commissionAccrued` inflado → devengaba ingreso (4.1.4)/CxC (1.1.7) ficticios que luego se liquidaban como caja bancaria fantasma (1.1.2). Fraude de estados financieros disparable por rol bajo | `routes/agentBanking.ts:320` · `validation/schemas.ts:414` | 🟠 HIGH | ✅ FIXED (cota `commission ≤ amountNio` → 400) |
| S33 | **Reversa de agente decrementaba `commissionAccrued` sin guarda de suficiencia.** Si la comisión ya se había liquidado, la reversa la restaba igual → saldo **negativo** + doble-conteo del asiento 1.1.7 (banco sobrevaluado); además bloqueaba liquidaciones legítimas futuras. Disparable por manager o **por accidente** al reversar tras el cierre de mes | `routes/agentBanking.ts:543` | 🟡 MED | ✅ FIXED (lock `FOR UPDATE` del convenio + acote al remanente devengado; el principal se revierte completo) |
| S34 | **`installments` sin cota superior** (originar/refinanciar préstamo) → construcción síncrona de un arreglo gigante + `createMany` que bloquea el event loop del **proceso único** → **DoS multi-tenant** con un solo request de cualquier OWNER (registro abierto) | `routes/loans.ts:118,563` · `validation/schemas.ts:277,306` | 🟡 MED | ✅ FIXED (tope `1–600` cuotas en Zod) |

**Endurecimiento adicional (misma clase, sin ID):** el validador base `moneyAmount`
(`validation/schemas.ts:21`) aceptaba `"Infinity"`/`"1e400"` (`parseFloat` los pasa como
`>= 0`); ahora exige `Number.isFinite` en la frontera para TODOS los campos de dinero
(antes solo `SaleSchema.total` tenía el refine puntual).

**Verificado OK (zonas de dinero de alto riesgo, confirmadas sanas):** `executeSale`
(total autoritativo server-side + idempotencia `offlineId`), `applyStockDelta` (suficiencia
+ escritura en el mismo `updateMany` condicional), reversa anti-doble (claim atómico
`status COMPLETED`), `settle-commissions` (decremento atómico `gte`), gaveta OUT
(`assertGavetaAlcanza` con `FOR UPDATE` + recálculo fresco), `exchangeRate` (1–1000,
obligatorio en USD), y `loans` repayment (anti-sobrepago atómico).

**Observación descartada (por diseño):** `POST /agent-banking/transactions` sin
`checkRole` es **consistente** con `/api/cash-movements` (patrón "cajero de mostrador");
los traslados `LIQUIDACION_*` sí exigen manager. No es bug.

**QA de los fixes:** `npx tsc --noEmit` limpio · `npm test` (vitest) 20/20 · suite de
lógica pura 24/24 (predicados de validación + álgebra del clamp: `commissionAccrued`
resultante ≥ 0 en barrido; comisión ≤ monto; installments 1–600; `Infinity`/`NaN`
rechazados).

---

## Re-auditoría 2026-08-01 — barrido de módulos de dinero (S35–S75)

Seis auditores en paralelo, uno por clúster de dinero: **Ventas/POS** (`salesService.ts`,
`sync.ts`, `serials.ts`), **Stock/Inventario** (`stockService.ts`, `stockTransfers.ts`,
`warehouses.ts`, lotes/FEFO, conteos), **Compras** (`/api/purchases`, `purchaseOrders.ts`),
**Préstamos LENDER** (`loans.ts`, `scoring.ts`, `ledger.ts`), **Agente Bancario**
(`agentBanking.ts` + asientos) y **Delivery/Red Nortex** (`driver.ts`, `pedidos.ts`,
`motorizados.ts`, payout del wallet). Billing/Stripe **excluido a pedido del CEO**
("el pago déjalo así"). Solo lectura; **ningún hallazgo corregido aún** (PENDIENTE).

**41 hallazgos.** Cada fila trae el ID original del agente (V*/S*/C*/L*/AB*/D*) para
trazabilidad. Confianza: CONFIRMADO salvo donde se anota PLAUSIBLE.

### 🔑 Dos patrones sistémicos (transversales)
- **Idempotencia ausente en escrituras de dinero.** S37, S39, S41, S52, S44 son la
  MISMA falla en módulos distintos: ningún endpoint de escritura de dinero deduplica
  reintentos, salvo la venta *offline* (`executeSale`+`offlineId`). Conviene atacarlo
  como patrón único (clave `offlineId`/`clientTxId` + `@@unique` compuesto + catch P2002).
- **Desincronización de inventario.** S42, S43, S45 hacen que stock/valuación/Kardex
  diverjan por tres caminos distintos (entrega driver sin `applyStockDelta`, venta online
  sin consumo de lote, doble ingreso OC→factura).

### 🔴 Altos (S35–S43) — pérdida de dinero/stock o feature muerta

| ID | orig | Hallazgo | Ubicación | Estado |
|----|------|----------|-----------|--------|
| S35 | S1 | Raw query con comillas dobles estilo **PostgreSQL** en MySQL → el **cierre de toma física** revienta con error 1064 (y rompe un path de crédito/AR): la reconciliación de inventario queda muerta | `server.ts:4038-4041,1928-1929` | ✅ CORREGIDO (2026-08-19): backticks MySQL en ambas queries (`FOR UPDATE` del cierre de toma y del lock de `/api/payments`); `/api/payments` además quedó marcada DEPRECADA — sin consumidores en el SPA, los abonos van por `/api/credits/payment` |
| S36 | V1 | Descuento por ítem **sin tope de 100%** en venta online → `total` negativo y, a crédito, **condona deuda** del cliente (CxC negativo, salta el límite). Explotable por cualquier cajero vía API cruda | `salesService.ts:56-64,144-146` | 🔴 PENDIENTE |
| S37 | V2 | Venta **online sin `offlineId`** → sin idempotencia; doble-click/reintento **duplica la venta** (doble stock, factura, deuda, asiento) | `POS.tsx:1302-1314` · `salesService.ts:120-125` | 🔴 PENDIENTE |
| S38 | C3 | **Doble recepción de OC** por concurrencia (lectura no bloqueante, sin guard atómico de estado) → stock ingresado 2× + promedio ponderado corrido 2× | `purchaseOrders.ts:307-339` | ✅ CORREGIDO (2026-08-19): `FOR UPDATE` del header de la OC como PRIMERA sentencia de la tx — el receive concurrente serializa y re-lee estado/`quantityReceived` post-commit |
| S39 | C4 | `/api/purchases` **sin idempotencia ni `@@unique([tenantId, invoiceNumber])`** → factura, inventario y CxP duplicados en doble-submit | `server.ts:4432-4693` · `schema.prisma:215-246` | ✅ CORREGIDO a nivel app (2026-08-19): lock del proveedor (`FOR UPDATE`, primera sentencia de la tx) + dup-check `[tenantId, supplierId, invoiceNumber]` → 409. El `@@unique` de refuerzo (por proveedor, no por tenant: cada proveedor numera sus propias facturas) queda para el lote DDL post-dump |
| S40 | L1 | **Refinanciar no liquida el préstamo viejo**: `balanceRemaining` fantasma + cuotas PENDING → cartera inflada por doble conteo + mora eterna sobre préstamo cerrado | `loans.ts:489-492` | ✅ CORREGIDO (2026-08-19): al refinanciar, el viejo queda `PAID_OFF` con `balanceRemaining: 0` y sus cuotas no pagadas pasan a `REFINANCED` (excluidas de mora/imputación/cartera en los 3 lectores); guard: solo se refinancia ACTIVE/DEFAULTED, bajo `FOR UPDATE` (doble refinance concurrente rebota). Datos históricos ya inflados → fase de saneamiento |
| S41 | L2 | **Abonos sin idempotencia** → reintento offline decrementa el saldo 2× (cliente acreditado de más, caja del cobrador descuadra) | `loans.ts:156-266` · `schema.prisma:1811` | ✅ CORREGIDO (2026-08-19): `FOR UPDATE` del Loan (primera sentencia de la tx) + dedupe: offline por `(loanId, paymentDate=timestamp de captura, monto 2dp)` → devuelve el abono existente como éxito idempotente (la cola deja de reintentar); online sin llave → mismo monto+cobrador en 10s = 409. Guard de tolerancia ahora en Decimal |
| S42 | D1 | **Entrega vía Driver App crea la venta pero nunca descuenta inventario** (no llama `applyStockDelta`) → stock fantasma, sobreventa, Kardex descuadrado | `driver.ts:296-364` | 🔴 PENDIENTE |
| S43 | S2 | **Venta online no descuenta lotes** (`ProductBatch`) → el writeoff da de baja unidades ya vendidas = **merma contable fantasma** + stock agregado negativo (crítico en farmacia) | `salesService.ts` (executeSale) vs `server.ts:3766` | 🔴 PENDIENTE |

### 🟠 Medios (S44–S55)

| ID | orig | Hallazgo | Ubicación | Estado |
|----|------|----------|-----------|--------|
| S44 | D2 | Payout al repartidor valida sobregiro con lectura **no bloqueante** (TOCTOU) + sin idempotencia → wallet puede quedar **negativo** (se paga de más); sin `NORTEX_LEDGER_KEYS` no hay ningún lock | `server.ts:5707-5719` | ✅ CORREGIDO el sobregiro (2026-08-19): read-back autoritativo POST-débito (la proyección debita con increment atómico y row-lock hasta commit; saldo resultante < 0 → rollback), con y sin firma del libro. Dedupe de doble-click: payout idéntico en 10s → 409 (cubre el reintento secuencial; el concurrente estricto se cierra con llave + unique en el lote DDL post-dump) |
| S45 | C5 | Link OC→factura existe en schema (`purchaseOrderId`) pero **nunca se usa**: seguir el flujo documentado (recibir OC + registrar factura) **suma stock 2×** | `purchaseOrders.ts:52-150` · `server.ts:4535-4617` (PLAUSIBLE) | ✅ CORREGIDO (2026-08-19): `/api/purchases` acepta `purchaseOrderId` (validado: mismo tenant, mismo proveedor, no DRAFT/CANCELLED) y con OC vinculada **omite** stock/Kardex/costo/lotes — la factura registra solo el dinero; el asiento contable no se duplica porque la recepción nunca posteó ninguno. UI: selector de OC en Compras con prefill del carrito |
| S46 | C6 | Recepción de OC **sin tope** (`quantityReceived > quantityOrdered`) ni dedupe de `itemId` repetido en el payload | `purchaseOrders.ts:300-324` | ✅ CORREGIDO (2026-08-19): dedupe de `itemId` en el payload (400) + tope `recibido acumulado ≤ pedido` con Decimal (400 con lo pendiente); el sobre-envío real se registra como compra directa o ajuste explícito |
| S47 | V4 | El **sync offline no valida el rango DGI** (`rangeEnd`) → correlativos de factura fuera del rango autorizado (incumplimiento fiscal); el online sí bloquea | `sync.ts:181-194` | ✅ CORREGIDO (2026-08-19): mismo guard que el online (`lastNumber > rangeEnd` → throw); la tx revierte (el correlativo no se consume) y la venta queda `failed` en el lote para reintentar con rango nuevo |
| S48 | V5 | El "total autoritativo" **confía en el `price` del cliente** (no revalida catálogo/tier); riesgo real en canales **WhatsApp/PUBLIC_ORDER** (comprador no confiable) | `salesService.ts:142-150` (impacto PLAUSIBLE) | 🟠 PENDIENTE |
| S49 | L3 | Un **COLLECTOR puede abonar a préstamos de rutas ajenas** (scoping solo por `lenderId`, no por `assignedToId`) | `loans.ts:156,182-184` | 🟠 PENDIENTE |
| S50 | L4 | Se puede **penalizar un préstamo ya liquidado**; la multa no crea cuota y entra como `Repayment` negativo que contamina el arqueo | `loans.ts:583-638` | ✅ CORREGIDO (2026-08-19): guard solo ACTIVE/DEFAULTED (400 en liquidado) bajo `FOR UPDATE`; la multa ahora es una CUOTA extra (vence hoy, entra a imputación y mora) y el `Repayment` negativo se eliminó (ya no resta del "cobrado hoy"); monto en Decimal, no parseFloat |
| S51 | L5 | El **efectivo del módulo de préstamos** (el que más dinero físico mueve) **no pasa por el libro firmado** tamper-evident | `ledger.ts` vs `loans.ts` | 🟠 PENDIENTE |
| S52 | AB1 | Agente bancario **sin idempotencia**: doble-submit duplica la operación + `settlementBalance` 2× → descuadra la deuda con el banco y el arqueo | `agentBanking.ts:280-471` | ✅ CORREGIDO (2026-08-19): `FOR UPDATE` del convenio hoisted a PRIMERA sentencia de la tx (serializa todas las ops del convenio, no solo las con límite diario) + dedupe race-safe: con folio del banco (`externalRef`) → misma referencia+operación jamás 2× (sin ventana; REVERSED no bloquea); sin folio → misma operación+monto+caja en 10s → 409 |
| S53 | V3 | El sync crea `Payment` para ventas de **contado** → infla "cobrado hoy" en el reporte de CxC (asimétrico: online no lo crea) | `sync.ts:240-249` | ✅ CORREGIDO (2026-08-19): el sync ya no crea `Payment` (paridad con `executeSale`): el contado vive en `Sale` y el arqueo del turno; `Payment` queda exclusivo de cobros de crédito. Filas históricas → fase de saneamiento |
| S54 | D3 | `costoEntrega` = `Tenant.deliveryFee` **sin tope** se vuelve pasivo de payout de **Nortex** para flota NORTEX (el fee lo fija una parte, lo paga otra) | `pedidos.ts:98` · `driver.ts:371-380` (PLAUSIBLE) | 🟠 PENDIENTE |
| S55 | S3 | **Sobreventa/stock negativo por bodega**: la suficiencia solo se valida sobre el agregado, no sobre `ProductStock`. Latente hasta que un canal de venta pase `warehouseId` | `stockService.ts:268-304` (PLAUSIBLE) | 🟠 PENDIENTE |

### 🟡 Bajos (S56–S75) — endurecimiento

| ID | orig | Hallazgo | Ubicación | Estado |
|----|------|----------|-----------|--------|
| S56 | L6 | Imputación a cuotas **no atómica** (findMany+update sin lock) → plan desincronizado del saldo bajo abonos concurrentes | `loans.ts:242-263` (PLAUSIBLE) | 🟡 PENDIENTE |
| S57 | L7 | `moneyAmount` sin techo + `interestRate ≤ 1000` **desborda** `Decimal(5,2)`/`Decimal(12,2)` → 500/rollback | `schemas.ts:24-34,276` · `schema.prisma:1761-1767` | 🟡 PENDIENTE |
| S58 | L8 | `collectedBy` es **texto libre del body**, falsificable (mitigado: el AuditLog sí guarda `userId` real) | `loans.ts:159,199,237` | 🟡 PENDIENTE |
| S59 | L9 | `parseFloat` sobre dinero persistido + `scoring.ts` con `Number`/`findMany` sin `take`/`new PrismaClient()` propio | `loans.ts:408,433,589,726` · `scoring.ts:5,28,58` | 🟡 PENDIENTE |
| S60 | L10 | La firma del ledger **omite `expenseId`** (económicamente relevante) → re-vínculo no rompe la cadena | `ledger.ts:43-63` | 🟡 PENDIENTE |
| S61 | L11 | Refinance **pierde el `customerId`** → préstamo nuevo huérfano del CRM | `loans.ts:523-540` | ✅ CORREGIDO (2026-08-19): el préstamo nuevo hereda `customerId`, `assignedToId` (ruta de cobro) y `tenantId` del viejo |
| S62 | AB2 | El `before/after` del AuditLog se lee **fuera de la tx** → bajo concurrencia el rastro miente sobre el saldo | `agentBanking.ts:428,464-465,565,598-599` | 🟡 PENDIENTE |
| S63 | AB3 | El reporte de conciliación **suma C$ + US$** como la misma unidad (`_sum: amount` sin `currency`/`amountNio`) | `agentBanking.ts:772-787` | 🟡 PENDIENTE |
| S64 | AB4 | Comisión ya liquidada queda como ingreso reconocido al reversar la operación (tradeoff contable a confirmar) | `agentBanking.ts:561-582` (observación) | 🟡 PENDIENTE |
| S65 | C7 | `/approve` y `/cancel` de OC: guard de estado **no atómico** (TOCTOU) + AuditLog fuera de tx | `purchaseOrders.ts:252-289` | 🟡 PENDIENTE |
| S66 | C8 | `/api/purchases/pending`: `findMany` **sin `take`** + suma en JS (guardrail escalabilidad) | `server.ts:4813-4817` | 🟡 PENDIENTE |
| S67 | C9 | Crear OC **sin Zod**: permite `unitCost=0` y `quantity` fraccional | `purchaseOrders.ts:194-199,234` | 🟡 PENDIENTE |
| S68 | D4 | `pedidos.ts` muta ventas/contabilidad bajo `authenticate` **sin `checkRole` ni Zod**, y permite transiciones de estado hacia atrás | `pedidos.ts:236,502` | 🟡 PENDIENTE |
| S69 | D5 | `verifyDriverLedger` **suma dinero con float** → falso positivo/negativo de "proyección manipulada" | `ledger.ts:319-321` | 🟡 PENDIENTE |
| S70 | D6 | `lat/lng` sin validar → `NaN` persistido; `if (lat && lng)` descarta la coordenada `0` | `driver.ts:274,279` · `pedidos.ts:285,337` | 🟡 PENDIENTE |
| S71 | D7 | `motorizados.ts` crea driver **sin el chequeo de teléfono único** que sí tiene `/registro` → login ambiguo | `motorizados.ts:62-75` | 🟡 PENDIENTE |
| S72 | D8 | El tracking público filtra **nombre y teléfono** del motorizado (id UUID, no enumerable) | `pedidos.ts:206-224` | 🟡 PENDIENTE |
| S73 | S4 | "Set absolute" de stock en edición usa base **stale** bajo concurrencia (relativo, no corrompe, pero el final ≠ tecleado) | `server.ts:3221-3231` (PLAUSIBLE) | 🟡 PENDIENTE |
| S74 | S5 | Stock inicial en alta de producto **sin Kardex génesis** (existencia inicial sin traza) | `server.ts:2953` | 🟡 PENDIENTE |
| S75 | V6 | `offlineId` es `@unique` **global** en vez de `@@unique([tenantId, offlineId])` (colisión cross-tenant → venta descartada en silencio; riesgo despreciable con UUID) | `schema.prisma:534` | 🟡 PENDIENTE |

**Zonas verificadas SANAS (para no re-trabajar):** aislamiento multi-tenant en los 6
módulos (tenant/lenderId del JWT, `findFirst({id, tenantId})` antes de mutar, sin
`req.body.tenantId`); `applyStockDelta` (UPDATE condicional atómico, sin TOCTOU);
`weightedAverageCost` (decimal.js, división guardada, C1/C2); transferencias de bodega;
libro firmado del wallet driver y del POS (seq/prevHash/HMAC con row-lock); reversa
anti-doble y `settle-commissions` del agente bancario (claim atómico); motor de préstamos
francés/flat (decimal.js, última cuota absorbe residuo, tope 600); idempotencia del sync
offline; asientos espejo exactos. Ver detalle por módulo en la corrida de agentes.

---

## Hallazgo 2026-08-18 — recon del módulo Vendedores (S76)

| # | Clase | Hallazgo | Dónde | Severidad | Estado |
|---|---|---|---|---|---|
| S76 | Integridad/FK | **Transacción de entrega del driver ROTA en runtime cuando el pedido no tiene `facturaId`.** `driver.ts` escribe `Payment.collectedBy = motorizadoId ?? null`, pero `motorizadoId` es un `Motorizado.id` (`req.driver.id`), NO un `User.id`, y la columna es `String` NOT NULL con FK real a `User`. Con la FK activa en MySQL el `payment.create` viola la restricción y **aborta toda la transacción de entrega** — no es solo un dato mal atribuido, es que ese camino probablemente no puede completarse hoy. Detectado por el recon de Vendedores; el reporte nuevo (`/api/reports/sellers`) es inmune porque filtra `sale.paymentMethod='CREDIT'` y esas ventas son CASH. Verificar contra BD real antes del fix (¿la FK está aplicada en prod?); el arreglo de fondo (¿quién "cobra" una entrega: el motorizado no-User?) es decisión de diseño de la Fase E de Vendedores. | `backend/routes/driver.ts:330` | 🟠 HIGH | 🟡 PENDIENTE |

## Hallazgo 2026-08-20 — recon del plan UX (S77)

| # | Clase | Hallazgo | Dónde | Severidad | Estado |
|---|---|---|---|---|---|
| S77 | Integridad de política | La exención de billing "nunca bloquear el POS" protegía `/api/cash-registers` — **ruta del frontend que no existe en la API** — mientras las rutas reales de caja (`/api/shifts/*`, `/api/cash-movements`) y de cobro de fiado (`/api/credits/payment`) quedaban tras el paywall: al vencer el trial, abrir caja daba 402 → **el POS sí se bloqueaba**, contradiciendo la promesa textual de los emails de trial. El test fijaba la ruta fantasma (CI verde, prod rota) | `billingExempt.ts:17` · `tests/billingExempt.test.ts:16` | 🔴 Alta (retención: expulsa al usuario activado justo el día 30) | ✅ CORREGIDO (2026-08-20): prefijos reales `/api/shifts` + `/api/cash-movements` + `/api/credits`; el test ahora fija las rutas reales del backend |

## Acciones del CEO (no las puede hacer un agente)

1. **🔴 ROTAR YA `JWT_SECRET`** (estaba en `.env.backup`/git). Con el keyring se hace sin
   downtime: generar uno nuevo, ponerlo primero en `JWT_SECRETS`, dejar el viejo un tiempo
   para no expulsar sesiones, luego retirarlo.
2. **🔴 ROTAR credenciales de la BD** (`DATABASE_URL`) y el password de `createSuperAdmin.ts`.
3. **Purgar el historial de git** del `.env.backup` (BFG / `git filter-repo` + force-push coordinado).
4. **Configurar el backup off-site** (`scripts/backup-db.sh` + cron + bucket S3-compatible).

Ver el plan por fases en `docs/SECURITY_REMEDIATION_PLAN.md`.
