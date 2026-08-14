---
name: nortex-contador
description: Dominio contable/fiscal de Nortex — partida doble NIIF, flujos canónicos (venta/compra/gasto/cierres), reglas DGI tal como viven en el código, invariantes del libro firmado y gotchas reales. Usar SIEMPRE que se toque accounting.ts, nicaTax.ts, depreciation.ts, ledger.ts, los endpoints /api/accounting|/api/fiscal, o cualquier código que genere asientos contables. Complementa nortex-clean-code (cómo se escribe) — esta skill es QUÉ reglas contables/fiscales rigen y dónde viven.
---

# Contabilidad y fiscal en Nortex

Nortex lleva **partida doble NIIF PyMES** con reglas fiscales de Nicaragua (LCT 822,
DGI) para PyMEs en régimen general. Este conocimiento está verificado contra el
código real (archivo:línea). Si una línea citada no coincide, el código se movió:
verificá antes de confiar, pero las reglas de dominio siguen siendo las mismas.

## 1. Mapa del subsistema

| Archivo | Qué hace |
|---|---|
| `backend/services/accounting.ts` (~1260 L) | Motor de partida doble. Catálogo NIIF hardcodeado (`CHART_OF_ACCOUNTS`), `createJournalEntry` = **único punto de escritura del libro**, ~18 funciones `record*`, estados financieros, retenciones DGI, cierre mensual (`fiscalClose`) y anual (`cierreAnual`). |
| `backend/services/nicaTax.ts` (~509 L) | Motor fiscal LCT 822. Funciones **puras** de desglose IVA + `generateMonthlyReport`, `generateDMIReport`, `generateAnnualIR`. |
| `backend/services/depreciation.ts` | Línea recta, catch-up mensual idempotente, `VIDA_UTIL_DEFAULT`, cron `runMonthlyDepreciationAllTenants`. |
| `backend/services/ledger.ts` | Libro firmado de caja (`appendSignedCashMovement`, `verifyTenantLedger`) y wallet del repartidor. |
| `backend/services/crypto.ts` | HMAC-SHA256 con keyring versionado, `canonicalize` con claves ordenadas. |
| `backend/services/salesService.ts` | Venta transaccional: correlativo DGI + `recordSale`. |
| `utils/tasas.ts` | Tasas para el **blog/calculadoras públicas**, NO para el ERP. Duplicado deliberado sin sincronía automática. |

Endpoints: bloque `/api/accounting/*` y `/api/fiscal/*` en `backend/server.ts`
(~L6978-7916, 8341-8432, 9175-9608). Verificación de integridad:
`GET /api/admin/ledger/verify/:tenantId` (solo SUPER_ADMIN, 409 si la cadena está rota).

Modelos clave (`backend/prisma/schema.prisma`): `Account` (`@@unique([tenantId, code])`),
`JournalEntry`/`JournalLine` (debe/haber `Decimal(14,2)`), `TaxReport`
(`@@unique([tenantId, month, year])`), `FiscalRetention` (practicadas a proveedores),
`RetencionSufrida` (las que le hicieron al negocio), `TaxConfig` (tasas por tenant),
`FiscalPeriod` (`CLOSED|OPEN`), `InvoiceSeries` (correlativo DGI con rango),
`FixedAsset`/`DepreciationEntry` (`@@unique([assetId, year, month])`),
`CashMovement` (seq/prevHash/signature + `@@unique([tenantId, seq])`), `LedgerHead`.

## 2. Invariantes inviolables

1. **Σ Debe == Σ Haber, tolerancia 0.0001** (`createJournalEntry`). La tolerancia
   bajó de 0.01 a propósito. Todos los flujos construyen la contrapartida **por
   complemento** (`iva = gravado − neto`, nunca `neto × 0.15`) para cuadrar exacto.
2. **Todo asiento pasa por `createJournalEntry`.** Es el único lugar que valida
   cuadre, resuelve cuentas, escribe `JournalLine` y actualiza `Account.balance`.
   Nunca escribir `journalLine.create` directo.
3. **Cuenta inexistente ⇒ aborta el asiento entero** (no `continue` — eso dejaba
   asientos descuadrados persistidos).
4. **El asiento va en la MISMA `$transaction` que el dinero.** Canónico: la compra
   (sin try/catch — si el asiento falla, la compra se revierte). **Excepción
   conocida:** la venta es *fail-soft* (`salesService.ts`, catch que solo loguea).
5. **`assertPeriodOpen` es guard único y automático** (llamado desde
   `createJournalEntry`). Único bypass legítimo: `cierreAnual` con
   `allowClosedPeriod: true`.
6. **decimal.js siempre** (`Decimal.set({ precision: 20, rounding: ROUND_HALF_UP })`).
7. **Signo por naturaleza de cuenta**: ASSET/EXPENSE deudoras (`debit − credit`),
   LIABILITY/EQUITY/REVENUE acreedoras (`credit − debit`).
8. **Resolución de cuentas SECUENCIAL, no `Promise.all`** — dos
   `seedChartOfAccounts` concurrentes sobre el mismo tenant deadlockean (P2034).
9. **El libro firmado se serializa por row-lock** (`ledgerHead.update({ lastSeq:
   { increment: 1 } })`), nunca `SELECT MAX(seq)`.
10. **Nunca se firma un saldo mutable.** Lo firmado es el libro inmutable; el saldo
    es proyección que se recomputa y verifica.
11. **La anulación NO entra en la firma**: el hecho económico es inmutable; el void
    es anotación posterior cubierta por `AuditLog`.
12. **Correlativo DGI atómico dentro de la tx** — `invoiceSeries.upsert` con
    `increment` + validación de rango → 422 `INVOICE_RANGE_EXHAUSTED`.
13. **AuditLog en toda mutación de dinero**, con `before`/`after` cuando aplica,
    dentro de la misma transacción.
14. **Cerrar/reabrir período: solo OWNER**; el reopen exige `reason` no vacío.

## 3. Flujos canónicos (el asiento de cada operación)

- **Venta** (`salesService.ts` → `buildSaleJournalLines`, pura):
  Debe `1.1.1` Caja (o `1.1.3` CxC si CREDIT) por el total · Haber `4.1.1` Ventas
  por el ingreso neto (gravado neto + exonerado) · Haber `2.1.2` IVA por Pagar ·
  Debe `5.1.1` COGS / Haber `1.1.4` Inventario por el costo. El costo y `ivaExento`
  se leen **de la BD**, nunca del cliente. Idempotencia offline por `offlineId` (P2002
  → devuelve la venta ya creada).
- **Compra** (`server.ts` ~L4530-4790 → `recordPurchase`): Debe `1.1.4` Inventario
  = total − IVA · Debe `1.1.5` IVA Crédito Fiscal · Haber `1.1.1` (CASH) o `2.1.1`
  CxP (CREDIT). El seed del catálogo va **ANTES de la tx** (bajo REPEATABLE READ
  las filas del auto-seed son invisibles dentro de la tx → P2025).
- **Gasto/caja** (`recordCashMovement` → `cashMovementJournalLines`, pura):
  IN `INYECCION_CAPITAL`: Debe 1.1.1 / Haber 3.1.1 · OUT `GASTO_OPERATIVO`: Debe
  5.2.1 / Haber 1.1.1 · OUT `PAGO_PROVEEDOR`: Debe **2.1.1** / Haber 1.1.1 (**NO es
  gasto** — mandarlo a 5.2.1 duplicaría el costo ya capitalizado en la compra) ·
  OUT `RETIRO_PERSONAL`: Debe 3.1.1 / Haber 1.1.1 · `CAMBIO`/`AJUSTE`/
  `AGENTE_BANCARIO` → **`null` a propósito, sin asiento**.
- **Abono a crédito** (`recordPayment`): Debe 1.1.1 / Haber 1.1.3.
- **Cierre de turno**: arqueo **por moneda** (C$ y US$ separados — sumarlos era un
  bug). **NO genera asiento** — es arqueo operativo, no evento económico. Alertas
  `THEFT_ALERT`/`SURPLUS_ALERT` sobre `tenant.theftAlertThreshold`.
- **Cierre fiscal mensual** (`fiscalClose`): reutiliza `generateMonthlyReport` (no
  pone ceros), snapshot before/after, una sola tx: `generateRetentions` →
  `taxReport` → `fiscalPeriod` a CLOSED → AuditLog. Desde ahí ningún asiento puede
  caer en ese mes.
- **Cierre anual** (`cierreAnual`): idempotente por `referenceType: 'ANNUAL_CLOSE'`
  (409 `AÑO_YA_CERRADO`). Cierra REVENUE/EXPENSE contra `3.1.2` Utilidades
  Retenidas, maneja saldos negativos invirtiendo el lado, fecha 31-dic con
  `allowClosedPeriod: true`.
- **Declaración mensual** (`generateMonthlyReport`): IVA cobrado (ventas, excluye
  VOIDED, con exoneración) − crédito fiscal (compras) → `ivaNeto = max(0, …)`, el
  exceso va a `ivaCredito`. Anticipo IR e IMI sobre ventas netas sin IVA; las
  retenciones **sufridas** del mes restan del anticipo.

## 4. Reglas fiscales tal como están en el código

| Concepto | Valor | Configurable |
|---|---|---|
| IVA | **15%** (`IVA_FACTOR = 1.15`, `nicaTax.ts`) | ❌ hardcodeado (también en server.ts y accounting.ts — ver gotcha de duplicación) |
| Anticipo IR / PMD | **1%** default | ✅ `TaxConfig.anticipoIrRate` |
| IMI Alcaldía | **1%** default | ✅ `TaxConfig.imiRate` |
| IR sociedades | **30%** sobre renta neta | ❌ |
| Retención IR practicada | **2%** | ❌ |
| Retención IMI practicada | **1%** | ❌ |

Vidas útiles (línea recta, Ley 822): EDIFICIO 240 m · VEHICULO 60 · MAQUINARIA 120
· MOBILIARIO 60 · COMPUTO 24 · OTRO 60.

Vencimientos: DGI (IVA/Anticipo IR/IMI) **día 15** del mes siguiente · INSS/INATEC
**día 17** · IR laboral **5º día hábil** · IR-1 anual **31 de marzo**.

⚠️ **`utils/tasas.ts` tiene `TASAS_VERIFICADAS_AL = null`** ⇒ NO publicar
calculadoras del blog con esos números sin verificar contra DGI/INSS vigentes. Es
un **duplicado del ERP sin sincronía**: cambiar una tasa exige tocar ambos lados.
**Cuota fija NO existe en el motor** — el ERP asume régimen general; la cuota fija
solo aparece como contenido del blog.

## 5. Gotchas reales (no "arreglar" sin entender)

- **Anular un `CashMovement` NO reversa el asiento** — marca `isVoided` y borra el
  `Expense`, pero el mayor queda movido. Bug real conocido, no diseño.
- **No hay asiento de reversa para ventas VOIDED** — los reportes fiscales las
  filtran, pero el mayor conserva ingreso y COGS.
- **`recordExpense` y `recordCashIn` son código muerto vivo**: importados pero
  nunca llamados (reemplazados por `recordCashMovement`). Llamarlos "para arreglar
  algo" duplica asientos.
- **`libro-ventas` y `vet-export` ignoran `exemptTotal`** (dividen todo entre 1.15)
  mientras `generateMonthlyReport` sí aplica exoneración → para un tenant con
  canasta básica, el Libro de Ventas y el VET no reconcilian con la declaración.
- **Aging CxP usa `p.total` como saldo**, no el pendiente — abonos parciales a
  proveedor no se reflejan.
- **`generateRetentions` es idempotente por CONTEO**: compras registradas después
  del primer cierre del período quedan sin retención para siempre.
- **`FiscalRetention` no genera asiento** — `2.1.7` nunca se acredita por esa vía.
- **Depreciación extemporánea**: si el mes histórico está cerrado, la cuota se
  postea con fecha de hoy (el `DepreciationEntry` conserva el período real). Tope
  de 60 cuotas por corrida.
- **`getEstadoResultados` tiene dos caminos**: sin mes/año lee `Account.balance`
  (all-time); con mes/año agrega desde `JournalLine`. Ambos excluyen
  `ANNUAL_CLOSE`, y la nota Prisma clave: `referenceType: { not: 'ANNUAL_CLOSE' }`
  **sí incluye filas NULL**.
- **Seeds del catálogo dentro de GETs** (`getBalanceGeneral`, `getEstadoResultados`,
  `GET /api/accounting/chart`) — contradice la regla "no sembrar en lecturas" del
  CLAUDE.md; es deuda a remover, no patrón a copiar.
- **`recordPayroll`/`recordLaborProvision`/`recordSettlement` usan
  `Number(...toFixed(2))`** y derivan el total de la suma redondeada *precisamente*
  para que cuadre. **No "optimizar" a un total calculado aparte.**
- **Floats legacy**: `Product.price/cost/wholesalePrice/packPrice` son Float; el
  COGS de cada venta parte de un Float. Deuda declarada (sweep a `Decimal(18,4)`).
  No perpetuar el patrón en campos nuevos.

## 6. Mutation testing (leer antes de mover funciones)

`stryker.config.json` muta lógica pura por **rangos de línea** que se desfasan con
cualquier refactor (un rango inválido da score NaN y sale con éxito —
`scripts/check-mutation-scope.cjs` cubre parte con pisos de mutantes por archivo):

- `nicaTax.ts` → desglose de IVA/exoneración · `accounting.ts` → solo
  `buildSaleJournalLines` · más `utils/calc-laborales.ts`, `utils/pricing.ts`,
  `loanMath.ts`, `stockService.ts` (parte pura).
- **Regla operativa**: si movés esas funciones, actualizá los rangos de
  `stryker.config.json` **en el mismo commit** y corré `npm run test:mutation`.
- Lógica de dinero nueva → **pura** (sin Prisma) para poder entrar a la red.
  `cashMovementJournalLines` ya es pura pero está fuera del scope de Stryker y sin
  test: candidata inmediata al agregar cobertura.
- **Zona ciega declarada**: no hay ningún test de `createJournalEntry`,
  `fiscalClose`, `cierreAnual`, `generateMonthlyReport` ni
  `runDepreciationForTenant` (atados a Prisma).

## 7. Checklist al tocar este subsistema

1. ¿El asiento pasa por `createJournalEntry` y va en la misma tx que el dinero?
2. ¿La contrapartida se construye por complemento (cuadre exacto)?
3. ¿`tenantId` viene del JWT y los updates verifican propiedad primero?
4. ¿AuditLog before/after dentro de la tx?
5. ¿Ningún seed/escritura dentro de un GET nuevo?
6. ¿decimal.js en todo cálculo, Decimal en campos nuevos del schema?
7. Si moviste funciones puras: ¿rangos de Stryker actualizados y
   `npm run test:mutation` verde?
8. ¿Cambio de schema estrictamente aditivo (deploy = `db push` sin
   `--accept-data-loss`)?
