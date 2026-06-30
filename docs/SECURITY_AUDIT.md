# Auditoría de Seguridad e Integridad — Nortex POS

Auditoría de las **6 capas** del Security & Integrity Loop sobre todo el backend
(`backend/server.ts`, `backend/routes/*`, `backend/services/*`, `backend/prisma/schema.prisma`),
realizada por 3 auditorías en paralelo + verificación manual. Fecha: 2026-06.

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

## Acciones del CEO (no las puede hacer un agente)

1. **🔴 ROTAR YA `JWT_SECRET`** (estaba en `.env.backup`/git). Con el keyring se hace sin
   downtime: generar uno nuevo, ponerlo primero en `JWT_SECRETS`, dejar el viejo un tiempo
   para no expulsar sesiones, luego retirarlo.
2. **🔴 ROTAR credenciales de la BD** (`DATABASE_URL`) y el password de `createSuperAdmin.ts`.
3. **Purgar el historial de git** del `.env.backup` (BFG / `git filter-repo` + force-push coordinado).
4. **Configurar el backup off-site** (`scripts/backup-db.sh` + cron + bucket S3-compatible).

Ver el plan por fases en `docs/SECURITY_REMEDIATION_PLAN.md`.
