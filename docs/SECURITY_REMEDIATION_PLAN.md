# Plan de Remediación — Security & Integrity Loop

Plan por fases para llevar Nortex al estándar del **Security & Integrity Loop** (ver
`CLAUDE.md`). Cada hallazgo `Sx` referencia `docs/SECURITY_AUDIT.md`. Las fases están
ordenadas por **riesgo/esfuerzo**: primero lo crítico-barato, al final lo grande con migración.

---

## Fase 0 — ✅ HECHO en este PR (crítico, bajo riesgo)

- **S1–S4** Brechas de escritura cross-tenant cerradas (loans repayments/clients/refinance,
  credits/payment) con el patrón de propiedad `findFirst({where:{id,tenantId|lenderId}})`.
- **S20** Rate-limit en `register` (10/h) y `reset-password` (5/15min).
- **S23** Validación de monto `> 0` en `credits/payment` y `loans/:id/repayments`.
- Bug `req.user` → `req.userId/role/email` en loans.ts (crash en `/vault/deposit` + fuga intra-tenant a COLLECTOR).
- **S19** `.env.backup` removido del tracking.
- **S26** `scripts/backup-db.sh` (backup MySQL off-site).
- `CLAUDE.md` con el loop como gobernanza.

---

## Fase 1 — Urgente, SIN migración (1–3 días)

### 1a. Rotación de secretos comprometidos (CEO) — S19, S25
- `JWT_SECRET`: generar nuevo. Gracias al **keyring** (`services/secrets.ts`), poné el nuevo
  como primero en `JWT_SECRETS` (CSV) y mantené el viejo unas horas para no expulsar
  sesiones; luego retiralo. **Sin downtime.**
- `DATABASE_URL`: rotar credenciales de MySQL.
- `createSuperAdmin.ts`: mover el password a env (`SUPERADMIN_PASSWORD`) y rotarlo.
- **Purga de historial:** `git filter-repo --path .env.backup --invert-paths` (o BFG) +
  force-push coordinado con el equipo.

### 1b. Endurecer infraestructura — S26, S27, S28
- `docker-compose.yml`: **no publicar** `3306:3306` (quitar el `ports` del servicio `db`;
  el `app` lo alcanza por la red interna). Exigir `DB_ROOT_PASSWORD` fuerte (sin default `root`).
- Sacar `phpmyadmin` del compose de producción (o protegerlo tras VPN/red interna).
- Desplegar el backup: cron diario de `scripts/backup-db.sh` a un bucket S3-compatible
  (DigitalOcean Spaces) con ciclo de vida (retención 30–90 días) y `BACKUP_ALERT_WEBHOOK`.
  Probar **una restauración** antes de declarar resuelto.

### 1c. Validación Zod en endpoints críticos — S21, S22 (parcial)
- Crear `RegisterSchema` (email válido, password `min(8)`) y `LoginSchema` (email válido,
  password presente — **sin** `min` para no bloquear cuentas viejas). Aplicar con el
  middleware `validate()` existente.
- Cablear los schemas que **ya existen** pero no se usan: `CreateSaleSchema` en `/api/sales`,
  `CreateExpenseSchema`. Agregar schemas money para loans (`z.number().positive()`) y
  `credits/payment`, `kardex/record`, `finance-purchase`.

### 1d. Endurecer login — S24
- `loginLimiter`: bajar a ~5, agregar llaveo por email/cuenta (no solo IP) o lockout tras N fallos.

**Verificación Fase 1:** `tsc --noEmit`; smoke test de login/registro/reset; restauración de
backup; confirmar `3306` no accesible desde fuera.

---

## Fase 2 — Precisión financiera (migración) — S15, S16, S17, S18 (1–2 semanas)

> **La raíz es `Product.price`/`Product.cost` como `Float`.** De ahí derivan precio de venta,
> COGS y valuación. Es el cambio de mayor impacto y el de mayor cuidado.

**Estrategia:**
1. **Inventario de columnas:** migrar TODAS las columnas monetarias a `@db.Decimal(18,4)`
   (precios, costos, totales, IVA, saldos, nómina, wallet, ledger). Las tasas que necesiten
   más decimales (`interestRate`) → `Decimal(9,4)` o `(18,6)`.
2. **Migración Prisma** con backfill: `FLOAT → DECIMAL(18,4)` (MySQL convierte; revisar
   redondeos). Hacerlo en ventana de bajo tráfico, con backup previo (Fase 1b).
3. **Sweep de código:** tras el cambio, Prisma devuelve `Decimal` (no `number`) para esos
   campos. Auditar cada lectura: las que ya hacen `new Decimal(x.toString())` o `Number(x)`
   siguen bien; las que hacían aritmética cruda (los ~16 puntos de **S18**) deben pasar por
   `decimal.js` y `.toNumber()` solo al persistir.
4. **Tests** de los motores de cálculo (nómina nicaLabor/nicaTax, originación de préstamos,
   arqueo de caja, cotizaciones) comparando antes/después con casos conocidos.

**Riesgo:** alto si se hace a medias (mezclar Float y Decimal). Hacerlo como una sola
migración + sweep, no por partes.

---

## Fase 3 — Soft-deletes — S5, S6, S7 (3–5 días)

1. Agregar `deletedAt DateTime?` a los modelos de negocio/históricos (Product, Supplier,
   Customer, Sale, Loan, Employee, Invoice, Expense, Holiday…).
2. **Middleware Prisma** (`$extends`/`$use`) que: en `findMany/findFirst/findUnique` agregue
   `deletedAt: null` por defecto, y convierta `delete`/`deleteMany` de modelos de negocio en
   `update({ deletedAt: now })`.
3. Convertir `product.delete` (S5) y `supplier.delete` (S6) a soft-delete; decidir `holiday` (S7).
4. Cuidar los `@unique` (p. ej. SKU/email): un registro “borrado” no debe bloquear recrear.

**Verificación:** borrar y re-listar (no aparece); históricos (SaleItem→Product) siguen resolviendo.

---

## Fase 4 — Auditoría robusta — S8–S14 (1 semana)

1. **Estructura:** agregar a `AuditLog` columnas `before Json?` / `after Json?` (además del
   `details`), y **inmutabilidad** a nivel BD: revocar `UPDATE`/`DELETE` al rol de la app, o
   trigger “append-only”, o encadenado por hash como ya hace el libro de caja (`ledger.ts`).
2. **Cobertura:** envolver en su transacción un `AuditLog.create` con before/after+userId+tenantId
   para: desembolso de préstamo (S8), pago de préstamo (S9), abono a crédito (S10),
   penalidad/refinanciamiento/bóveda (S11), desembolso de capital (S13), **cambio de precio**
   (S12), y las de nómina/wallet (S14).

**Verificación:** cada mutación de dinero deja exactamente un asiento con estados antes/después.

---

## Fase 5 — Validación sistémica y enforcement (continuo)

- **S22:** completar el rollout de Zod a todos los handlers que leen `req.body`.
- **S1 (MED) pedidos tracking:** quitar el teléfono del motorizado de la proyección pública
  o ponerlo tras un token opaco.
- **Enforcement automatizable** (lint/CI — esto SÍ puede ser un hook real):
  - Falla si un query Prisma de un modelo de negocio no incluye `tenantId`/`lenderId`.
  - Falla si aparece `Number(`/`parseFloat(` sobre campos monetarios.
  - Falla si un endpoint que lee `req.body` no pasa por `validate(...)`.

---

## Orden sugerido

`Fase 1 (rotar secretos + infra + Zod auth)` → `Fase 4 (auditoría money)` →
`Fase 2 (Decimal)` → `Fase 3 (soft-delete)` → `Fase 5 (sistémico)`.

Las Fases 0–1 cierran lo explotable hoy. Las 2–4 son deuda estructural con migración: una
por PR, con backup previo y verificación, nunca a medias.
