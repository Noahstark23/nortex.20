import { escapeHtml, fiscalPreviewCsp } from './htmlSecurity.js';
import type {
    SalesDocumentData,
    ShiftReportSnapshotView,
} from '../services/salesReportService.js';

export interface SalesReportHtmlOptions {
    nonce: string;
}

const e = (value: unknown): string => escapeHtml(value);
const money = (value: unknown): string => `C$ ${e(value)}`;
const movementMoney = (currency: unknown, value: unknown): string =>
    `${currency === 'USD' ? 'US$' : 'C$'} ${e(value)}`;
const usd = (value: unknown): string => `US$ ${e(value)}`;

function documentShell(input: {
    title: string;
    subtitle: string;
    nonce: string;
    body: string;
}): string {
    const csp = fiscalPreviewCsp(input.nonce);
    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${e(csp)}">
  <title>${e(input.title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; color: #172033; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2f7; font-size: 12px; }
    .toolbar { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 24px; color: white; background: #111827; }
    .toolbar strong { font-size: 14px; }
    .toolbar button { border: 0; border-radius: 8px; padding: 9px 14px; color: white; background: #0f766e; font-weight: 700; cursor: pointer; }
    main { width: min(1180px, calc(100% - 32px)); margin: 20px auto; padding: 28px; background: white; box-shadow: 0 8px 28px rgba(15, 23, 42, .12); }
    header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 18px; border-bottom: 3px solid #0f766e; }
    h1 { margin: 0; font-size: 25px; color: #0f172a; }
    h2 { margin: 24px 0 10px; font-size: 16px; color: #0f766e; }
    p { margin: 4px 0; }
    .muted { color: #64748b; }
    .right { text-align: right; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
    .card { min-height: 72px; padding: 12px; border: 1px solid #dbe3ed; border-radius: 9px; background: #f8fafc; }
    .card span { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    .card strong { display: block; margin-top: 5px; font-size: 17px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    th, td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; text-align: left; }
    th { color: #475569; background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tbody tr:nth-child(even) { background: #fbfdff; }
    .negative { color: #b91c1c; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 10px; overflow-wrap: anywhere; }
    @page { size: auto; margin: 11mm; }
    @media (max-width: 760px) { .cards { grid-template-columns: repeat(2, 1fr); } main { width: 100%; margin: 0; padding: 16px; } .toolbar { position: static; } }
    @media print { body { background: white; } .toolbar { display: none; } main { width: 100%; margin: 0; padding: 0; box-shadow: none; } h2 { break-after: avoid; } table { break-inside: auto; } tr { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="toolbar"><strong>${e(input.subtitle)}</strong><button id="print-report" type="button">Imprimir / Guardar PDF</button></div>
  <main>${input.body}</main>
  <script nonce="${e(input.nonce)}">document.getElementById('print-report').addEventListener('click',function(){window.print();});</script>
</body>
</html>`;
}

function card(label: string, value: unknown): string {
    return `<div class="card"><span>${e(label)}</span><strong>${e(value)}</strong></div>`;
}

export function renderSalesReportHtml(
    data: SalesDocumentData,
    options: SalesReportHtmlOptions,
): string {
    const { report, transactions } = data;
    const s = report.summary;
    const paymentRows = report.paymentMethods.map((row) => `<tr>
      <td>${e(row.label)}</td><td class="num">${e(row.transactionCount)}</td>
      <td class="num">${money(row.grossSales)}</td><td class="num">${money(row.returnsTotal)}</td>
      <td class="num">${money(row.netSales)}</td>
    </tr>`).join('');
    const productRows = report.products.map((row) => `<tr>
      <td>${e(row.productName)}</td><td>${e(row.presentation)}</td><td>${e(row.displayUnit)}</td>
      <td class="num">${e(row.quantitySold)}</td><td class="num">${e(row.quantityReturned)}</td>
      <td class="num">${e(row.quantityNet)}</td><td class="num">${money(row.netSales)}</td>
      <td class="num">${money(row.vatCollected)}</td><td class="num">${money(row.cogs)}</td>
      <td class="num">${money(row.grossProfit)}</td>
    </tr>`).join('');
    const transactionRows = transactions.map((row) => `<tr>
      <td>${e(row.invoice)}</td><td>${e(row.createdAt)}</td><td>${e(row.customer.name)}</td>
      <td>${e(row.seller.name)}</td><td>${e(row.cashier.name)}</td><td>${e(row.paymentMethod)}</td>
      <td class="num">${money(row.total)}</td><td class="num">${money(row.vatCollected)}</td>
      <td class="num">${money(row.returnedTotal)}</td><td class="num">${money(row.netTotal)}</td>
      <td>${e(row.status)}</td><td class="num">${e(row.items.lineCount)} / ${e(row.items.baseQuantity)}</td>
    </tr>`).join('');
    const returnRows = report.returns.map((row) => `<tr>
      <td>${e(row.businessDate)}</td><td>${e(row.id)}</td><td>${e(row.saleId)}</td>
      <td>${e(row.paymentMethod)}</td><td>${e(row.reason)}</td>
      <td class="num">${money(row.total)}</td><td class="num">${money(row.vat)}</td>
      <td class="num">${money(row.cogs)}</td><td class="num">${e(row.invalidItemCount)}</td>
      <td class="num">${money(row.unallocatedTotal)}</td>
    </tr>`).join('');

    const body = `
      <header>
        <div>
          <h1>Reporte integral de ventas</h1>
          <p><strong>${e(report.business.name)}</strong></p>
          <p class="muted">RUC: ${e(report.business.taxId || 'No registrado')}</p>
          <p class="muted">${e(report.business.address)} ${e(report.business.phone)}</p>
        </div>
        <div class="right">
          <p><strong>${e(report.period.startDate)} — ${e(report.period.endDate)}</strong></p>
          <p class="muted">Día civil: ${e(report.period.timeZone)}</p>
          <p class="muted">Fin exclusivo: ${e(report.period.endExclusive)}</p>
        </div>
      </header>
      <section class="cards">
        ${card('Ventas brutas', `C$ ${s.grossSales}`)}
        ${card('Devoluciones', `C$ ${s.returnsTotal}`)}
        ${card('Ventas netas', `C$ ${s.netSales}`)}
        ${card('IVA recaudado', `C$ ${s.vatCollected}`)}
        ${card('Ingreso sin IVA', `C$ ${s.netRevenue}`)}
        ${card('Costo de ventas', `C$ ${s.cogs}`)}
        ${card('Utilidad bruta', `C$ ${s.grossProfit}`)}
        ${card('Ticket promedio', `C$ ${s.averageTicket}`)}
        ${card('Transacciones', s.transactionCount)}
        ${card('Devoluciones emitidas', s.returnCount)}
        ${card('Cantidad neta', s.itemQuantityNet)}
        ${card('Descuentos', `C$ ${s.discountTotal}`)}
      </section>
      <h2>Métodos de pago</h2>
      <p class="muted">Las devoluciones se atribuyen al método de la venta original; no representan necesariamente el canal físico del reembolso.</p>
      <table><thead><tr><th>Método</th><th class="num">Ventas</th><th class="num">Bruto</th><th class="num">Devuelto</th><th class="num">Neto</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="5">Sin movimientos</td></tr>'}</tbody></table>
      <h2>Productos vendidos y devueltos</h2>
      <table><thead><tr><th>Producto</th><th>Presentación</th><th>Unidad histórica</th><th class="num">Vendido</th><th class="num">Devuelto</th><th class="num">Neto</th><th class="num">Venta neta</th><th class="num">IVA</th><th class="num">Costo neto</th><th class="num">Utilidad</th></tr></thead><tbody>${productRows || '<tr><td colspan="10">Sin productos</td></tr>'}</tbody></table>
      <h2>Ventas del período</h2>
      <table><thead><tr><th>Factura</th><th>Fecha UTC</th><th>Cliente</th><th>Vendedor</th><th>Cajero</th><th>Método</th><th class="num">Total</th><th class="num">IVA</th><th class="num">Devuelto</th><th class="num">Neto</th><th>Estado</th><th class="num">Líneas / cantidad base</th></tr></thead><tbody>${transactionRows || '<tr><td colspan="12">Sin ventas</td></tr>'}</tbody></table>
      <h2>Devoluciones del período</h2>
      <table><thead><tr><th>Fecha</th><th>ID devolución</th><th>ID venta</th><th>Método original</th><th>Motivo</th><th class="num">Total</th><th class="num">IVA</th><th class="num">Costo</th><th class="num">Líneas ilegibles</th><th class="num">Sin asignar</th></tr></thead><tbody>${returnRows || '<tr><td colspan="10">Sin devoluciones</td></tr>'}</tbody></table>
      <div class="footer">Documento generado desde registros tenant-scoped. Diferencia producto/documento por conciliar: ${money(s.roundingAdjustment)}.</div>`;

    return documentShell({
        title: `Reporte de ventas ${report.period.startDate} a ${report.period.endDate}`,
        subtitle: 'Reporte integral de ventas',
        nonce: options.nonce,
        body,
    });
}

export function renderShiftCloseReportHtml(
    snapshot: ShiftReportSnapshotView,
    options: SalesReportHtmlOptions,
): string {
    const report = snapshot.report;
    const s = report.summary;
    const paymentRows = report.paymentMethods.map((row) => `<tr>
      <td>${e(row.label)}</td><td class="num">${e(row.transactionCount)}</td><td class="num">${money(row.grossSales)}</td>
    </tr>`).join('');
    const productRows = report.products.map((row) => `<tr>
      <td>${e(row.productName)}</td><td>${e(row.presentation)}</td><td>${e(row.displayUnit)}</td>
      <td class="num">${e(row.quantitySold)}</td><td class="num">${e(row.quantityReturned)}</td>
      <td class="num">${e(row.quantityNet)}</td><td class="num">${money(row.netSales)}</td>
      <td class="num">${money(row.vatCollected)}</td><td class="num">${money(row.cogs)}</td>
      <td class="num">${money(row.grossProfit)}</td>
    </tr>`).join('');
    const movementRows = report.movementBreakdown.map((row) => `<tr>
      <td>${e(row.currency)}</td><td>${e(row.type)}</td><td>${e(row.category)}</td>
      <td class="num">${e(row.count)}</td><td class="num">${movementMoney(row.currency, row.amount)}</td>
    </tr>`).join('');
    const c = report.cash;
    const body = `
      <header>
        <div>
          <h1>Reporte Z · ${e(report.folio)}</h1>
          <p><strong>${e(report.business.name)}</strong></p>
          <p class="muted">RUC: ${e(report.business.taxId)}</p>
          <p class="muted">${e(report.business.address)} ${e(report.business.phone)}</p>
        </div>
        <div class="right">
          <p><strong>Día de negocio: ${e(report.businessDate)}</strong></p>
          <p class="muted">Apertura: ${e(report.shift.openedAt)}</p>
          <p class="muted">Cierre: ${e(report.shift.closedAt)}</p>
          <p class="muted">Cajero: ${e(report.shift.cashierName)}</p>
        </div>
      </header>
      <section class="cards">
        ${card('Ventas brutas', `C$ ${s.grossSales}`)}
        ${card('Devoluciones', `C$ ${s.returnsTotal}`)}
        ${card('Ventas netas', `C$ ${s.netSales}`)}
        ${card('IVA recaudado', `C$ ${s.vatCollected}`)}
        ${card('Costo neto', `C$ ${s.cogs}`)}
        ${card('Utilidad bruta', `C$ ${s.grossProfit}`)}
        ${card('Transacciones', s.transactionCount)}
        ${card('Ticket promedio', `C$ ${s.averageTicket}`)}
      </section>
      <h2>Responsabilidad del turno</h2>
      <table><tbody>
        <tr><th>Abrió</th><td>${e(report.shift.openedBy)}</td><th>Cerró</th><td>${e(report.shift.closedBy)}</td></tr>
        <tr><th>Cajero</th><td>${e(report.shift.cashierName)}</td><th>Notas de auditoría</th><td>${e(report.shift.auditNotes || 'Sin notas')}</td></tr>
      </tbody></table>
      <h2>Arqueo de caja</h2>
      <table><thead><tr><th>Moneda</th><th class="num">Apertura</th><th class="num">Ventas efectivo</th><th class="num">Reembolsos</th><th class="num">Entradas</th><th class="num">Salidas</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead><tbody>
        <tr><td>NIO</td><td class="num">${money(c.openingNio)}</td><td class="num">${money(c.cashSalesNio)}</td><td class="num">${money(c.cashRefundsNio)}</td><td class="num">${money(c.paidInNio)}</td><td class="num">${money(c.paidOutNio)}</td><td class="num">${money(c.expectedNio)}</td><td class="num">${money(c.countedNio)}</td><td class="num">${money(c.differenceNio)}</td></tr>
        <tr><td>USD</td><td class="num">${usd(c.openingUsd)}</td><td class="num">—</td><td class="num">—</td><td class="num">${usd(c.paidInUsd)}</td><td class="num">${usd(c.paidOutUsd)}</td><td class="num">${usd(c.expectedUsd)}</td><td class="num">${usd(c.countedUsd)}</td><td class="num">${usd(c.differenceUsd)}</td></tr>
      </tbody></table>
      <h2>Métodos de pago</h2>
      <table><thead><tr><th>Método</th><th class="num">Transacciones</th><th class="num">Venta bruta</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="3">Sin ventas</td></tr>'}</tbody></table>
      <h2>Productos</h2>
      <table><thead><tr><th>Producto</th><th>Presentación</th><th>Unidad</th><th class="num">Vendido</th><th class="num">Devuelto</th><th class="num">Neto</th><th class="num">Venta neta</th><th class="num">IVA</th><th class="num">Costo</th><th class="num">Utilidad</th></tr></thead><tbody>${productRows || '<tr><td colspan="10">Sin productos</td></tr>'}</tbody></table>
      <h2>Movimientos de gaveta</h2>
      <table><thead><tr><th>Moneda</th><th>Tipo</th><th>Categoría</th><th class="num">Cantidad</th><th class="num">Monto</th></tr></thead><tbody>${movementRows || '<tr><td colspan="5">Sin movimientos</td></tr>'}</tbody></table>
      <div class="footer">Versión ${e(snapshot.version)} · Hash de integridad SHA-256: ${e(snapshot.contentHash)} · Snapshot ${e(snapshot.id)}</div>`;

    return documentShell({
        title: `Reporte Z ${report.folio}`,
        subtitle: `Cierre de caja ${report.folio}`,
        nonce: options.nonce,
        body,
    });
}
