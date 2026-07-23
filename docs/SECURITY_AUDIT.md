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

## Acciones del CEO (no las puede hacer un agente)

1. **🔴 ROTAR YA `JWT_SECRET`** (estaba en `.env.backup`/git). Con el keyring se hace sin
   downtime: generar uno nuevo, ponerlo primero en `JWT_SECRETS`, dejar el viejo un tiempo
   para no expulsar sesiones, luego retirarlo.
2. **🔴 ROTAR credenciales de la BD** (`DATABASE_URL`) y el password de `createSuperAdmin.ts`.
3. **Purgar el historial de git** del `.env.backup` (BFG / `git filter-repo` + force-push coordinado).
4. **Configurar el backup off-site** (`scripts/backup-db.sh` + cron + bucket S3-compatible).

Ver el plan por fases en `docs/SECURITY_REMEDIATION_PLAN.md`.
