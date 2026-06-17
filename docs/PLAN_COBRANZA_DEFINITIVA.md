# Plan — «Cobranza Definitiva» (CxC retail + Préstamos)

Cuarto rol del arco (tras Contador, RRHH, Bodeguero): **el cobrador / gestor de
cartera**. Auditoría (3 agentes) sobre lo que ya existe. Como en los planes
anteriores, NO se construye de cero: se **quita fricción y se cierran huecos**,
y se cubren **las dos cobranzas** que tiene la plataforma.

**Confirmado por el usuario:** (1) **ambas** cobranzas — crédito/fiado del POS y
préstamos del modo prestamista; (2) recordatorios como **worklist + 1-tap
manual** (lista diaria de a-quién-cobrar + recordatorio manual por `wa.me`), **sin
envío automático** (no depende de tener la API de WhatsApp conectada).

## Ya existe (capitalizar, no tocar)

**Crédito/fiado (retail):** venta a crédito con **límite de crédito** y bloqueo
(`salesService.ts`), `Sale.dueDate` (+30 d), `Sale.balance`, `Customer.currentDebt`,
abonos parciales (`POST /api/credits/payment`), lista de deudores
(`GET /api/credits/debtors`), **reporte de aging 30/60/90** (`GET /api/accounting/aging`),
contabilidad (CxC 1.1.3 al vender, abono al cobrar). Recordatorio de WhatsApp
**manual** (botón `wa.me`) en `AccountsReceivable.tsx`.

**Préstamos (prestamista):** modelos `Loan` / `Repayment` / `RouteExpense`,
endpoints (`POST /api/loans`, `/repayments`, `GET /api/loans`, `/refinance`,
`/penalty`, `/route-expenses`, `/collectors`), `LenderDashboard` **completo pero
huérfano** (no enrutado), rol `COLLECTOR` con layout móvil **vacío**.

**Infra reusable:** lógica de aging (buckets), `createJournalEntry` + period-lock,
`setInterval` para jobs, `window.print()` / XLSX, polling de 30 s, cliente de
WhatsApp Cloud API (`sendText`, queda para el futuro automático).

## Los huecos que duelen

- **Visibilidad:** el aging solo se ve en Contabilidad, no hay panel de cobranza
  con KPIs (por cobrar, vencido, DSO, % cobrado) ni **worklist "cobrar hoy"**.
- **Cliente:** no hay **estado de cuenta** (factura por factura + abonos).
- **Prestamista:** el `LenderDashboard` no está enrutado; faltan endpoints
  `PATCH /api/loans/:id/assign` y `POST /api/loans/vault/deposit` (botones que
  hoy fallan); **no hay plan de cuotas** ni cálculo de mora; el **cobrador no
  tiene vista móvil** de su ruta diaria.
- **Contabilidad:** no hay **castigo de incobrables** (ni cuenta, ni asiento).
- **Calle:** sin **recibo/voucher** de abono.

## Fase A — «Ver y cobrar» (sin fricción)  *(recomendada primero)*

| RF | Qué | Detalle técnico |
|---|---|---|
| **A1** | Panel de Cobranza + worklist | Vista de cobranza (CxC) con **aging** (reusa `/api/accounting/aging`) + KPIs (por cobrar, vencido, DSO, % cobrado del mes) + **"cobrar hoy"**: vencidos + por vencer ≤ N días, ordenados por urgencia, con **abono inline** y **recordatorio WhatsApp 1-tap** (`wa.me`). Nuevo `GET /api/collections/worklist` que arma la lista. |
| **A2** | Estado de cuenta del cliente | `GET /api/customers/:id/statement` → ventas a crédito (factura, fecha, vencimiento, saldo) + abonos + saldo total con aging. UI imprimible; botón desde Clientes y desde la worklist. |
| **A3** | Enrutar prestamista + endpoints faltantes | Detectar `tenant.type === 'LENDER'` y enrutar `LenderDashboard` (hoy huérfano). Implementar `PATCH /api/loans/:id/assign` (asignar cobrador, persistente) y `POST /api/loans/vault/deposit` (entrega/depósito de caja del cobrador). Arregla los botones rotos del dashboard. |

## Fase B — «Cuadrar la cartera» (control + contabilidad)

| RF | Qué | Detalle técnico |
|---|---|---|
| **B1** | Castigo de incobrables (CxC) | Estado `UNCOLLECTIBLE` en `Sale` + **asiento** Debe `5.2.7 Cuentas Incobrables` (nueva, auto-sanable) / Haber `1.1.3 CxC`, valuado al saldo, con period-lock; baja `currentDebt` del cliente. Reusa el patrón de `recordStockCountAdjustment`. |
| **B2** | Plan de cuotas + mora (préstamos) | Modelo `LoanInstallment { loanId, nº, dueDate, amountDue, amountPaid, status }` **auto-generado** al crear el préstamo (según `frequency`/`installments`); "próxima cuota" + **días en mora** en la cartera; el abono salda cuotas en orden. |
| **B3** | Recibo / voucher de abono | Comprobante imprimible (`window.print`) para abonos de fiado y de préstamo (cliente, saldo anterior/nuevo, fecha, cobrador). |

## Fase C — «Operación de calle» (el cobrador)

| RF | Qué | Detalle técnico |
|---|---|---|
| **C1** | Vista móvil del cobrador | `CollectorView` (llena el layout móvil hoy vacío del rol `COLLECTOR`): **ruta del día** (cuotas vencidas/de hoy de los préstamos asignados), registrar abono, marcar visitado/no-pagó, recibo. Agregar `COLLECTOR` a permisos. |
| **C2** | Cobrador para fiado + reconciliación | Asignar un cobrador a clientes de fiado (`Customer.assignedCollectorId`), worklist del cobrador para CxC, y reconciliación/entrega de caja (reusa A3 vault). |
| **C3** | Export / estado de cuenta público *(nice-to-have)* | Export del aging/cartera a Excel y estado de cuenta por link público. |

## Lo que NO se hace
- **Envío automático** de recordatorios (se eligió worklist + 1-tap manual). El
  cliente de WhatsApp Cloud API queda listo para un futuro job, pero apagado.
- **Pasarela de pago en línea** para CxC (Stripe es solo para suscripción).

## Archivos clave
- `backend/server.ts` (CxC: `/api/credits/*`, `/api/accounting/aging`, nuevos
  `/api/collections/worklist`, `/api/customers/:id/statement`, castigo incobrable),
  `backend/routes/loans.ts` (assign, vault/deposit, installments),
  `backend/services/accounting.ts` (cuenta 5.2.7 + asiento de incobrable),
  `backend/prisma/schema.prisma` (Sale.status UNCOLLECTIBLE, `LoanInstallment`,
  `Customer.assignedCollectorId`).
- `components/AccountsReceivable.tsx` (panel + worklist + estado de cuenta),
  `components/LenderMode/LenderDashboard.tsx` (enrutar), nuevo `CollectorView.tsx`,
  `App.tsx` / `Dashboard.tsx` / `Layout.tsx` (ruteo LENDER + COLLECTOR).

## Verificación (tras cada chunk, "en loop")
- `prisma validate` (B1/B2/C2), `tsc --noEmit` → **0 errores**, `vite build` OK.
- A1: la worklist lista los vencidos/por-vencer correctos; el abono inline baja saldo y `currentDebt`.
- A3: asignar cobrador persiste; el depósito de caja se registra; el dashboard prestamista carga.
- B1: el asiento de incobrable cuadra (Σdebe=Σhaber) y respeta el period-lock.
- B2: la suma de cuotas == `totalToRepay`; la mora se calcula bien.
- C1: el cobrador ve solo su ruta del día y registra abonos con recibo.

## Ejecución
Mismo patrón del arco: primero este `docs/PLAN_COBRANZA_DEFINITIVA.md`, luego
**Fase A por partes** (PRs a `main`, verificando tras cada cambio), seguir con B y
C, y cerrar con una **pasada de QA en loop**. Empezar por **Fase A** (visibilidad +
worklist + arreglar el prestamista huérfano: lo que más se siente).
