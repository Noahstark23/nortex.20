import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { assertAssistantAccess, AssistantAccessError, ASSISTANT_FINANCIAL_ROLES, ASSISTANT_BUSINESS_SALES_ROLES, ASSISTANT_OWN_SALES_ROLES } from '../access.js';
import { operationsQuerySchema, resolveOperationsPeriods, periodDTO, type ResolvedOperationsPeriod } from './analyticsPeriod.js';
import type { AnalyticsDependencies, BusinessHealthResult, OperationsMetric } from './analyticsTypes.js';

export const auditBusinessHealthQuerySchema = operationsQuerySchema.omit({ warehouseId: true, productIds: true, limit: true });
type Aggregate = Record<string, string | number | bigint | Prisma.Decimal | null>;
const money = (row: Aggregate | null, key: string): Decimal | null => {
  try { const value = row?.[key]; if (value === null || value === undefined) return null;
    const decimal = new Decimal(String(value)); return decimal.isFinite() ? decimal : null;
  } catch { return null; }
};
const clean = (row: Aggregate | null, key: string) => money(row, key)?.isZero() === true;
const metric = (key: string, label: string, value: Decimal | null, source: string, unit: OperationsMetric['unit'] = 'money'): OperationsMetric => ({
  key, label, value: value?.toDecimalPlaces(unit === 'percent' ? 2 : 4).toFixed() ?? null, unit,
  status: value === null ? 'unavailable' : 'ok', source,
});
const difference = (a: Decimal | null, b: Decimal | null) => a !== null && b !== null ? a.minus(b) : null;
const divide = (a: Decimal | null, b: Decimal | null) => a !== null && b !== null && !b.isZero() ? a.div(b) : null;

/** Una fila de agregados; jamás carga ventas completas ni precios/costos actuales. */
export function businessHealthSql(principal: AssistantPrincipal, period: ResolvedOperationsPeriod, asOf: Date, financial: boolean) {
  const own = ASSISTANT_OWN_SALES_ROLES.includes(principal.role) ? Prisma.sql`AND s.soldById = ${principal.userId}` : Prisma.empty;
  const active = Prisma.sql`((s.cancelledAt IS NULL AND s.status NOT IN ('VOIDED','CANCELLED','CANCELED')) OR s.cancelledAt >= ${asOf})`;
  const saleCosts = financial ? Prisma.sql`COALESCE(SUM(CAST(i.quantity AS DECIMAL(24,4)) * i.costAtSale),0)` : Prisma.sql`NULL`;
  const badCosts = financial ? Prisma.sql`COALESCE(SUM(i.costAtSale < 0 OR i.quantity <= 0),0)` : Prisma.sql`0`;
  const returnCosts = financial ? Prisma.sql`COALESCE(SUM(ri.costTotal),0)` : Prisma.sql`NULL`;
  const badReturnCosts = financial ? Prisma.sql`COALESCE(SUM(ri.costTotal<0),0)` : Prisma.sql`0`;
  const expenses = financial ? Prisma.sql`(SELECT COALESCE(SUM(e.amount),0) FROM Expense e WHERE e.tenantId=${principal.tenantId} AND e.createdAt>=${period.start} AND e.createdAt<${period.endExclusive})` : Prisma.sql`NULL`;
  return Prisma.sql`
    WITH issued AS (
      SELECT s.id,s.total,s.vatAmountAtSale FROM Sale s
      WHERE s.tenantId=${principal.tenantId} AND ${active} ${own}
      AND s.createdAt>=${period.start} AND s.createdAt<${period.endExclusive}
    ), returned AS (
      SELECT r.id,r.saleId,r.total,s.total AS originalSaleTotal,s.vatAmountAtSale,s.globalDiscount
      FROM ProductReturn r JOIN Sale s ON s.id=r.saleId AND s.tenantId=r.tenantId
      WHERE r.tenantId=${principal.tenantId} AND ${active} ${own}
      AND r.createdAt>=${period.start} AND r.createdAt<${period.endExclusive}
    ), original_taxable AS (
      SELECT i.saleId, SUM(CASE WHEN i.ivaExento=0 THEN
        CAST(i.quantity AS DECIMAL(24,4))*COALESCE(i.unitPriceExactAtSale,i.priceAtSale)
        *(1-CAST(i.discount AS DECIMAL(10,6))/100) ELSE 0 END) AS amount
      FROM SaleItem i WHERE i.saleId IN (SELECT saleId FROM returned) GROUP BY i.saleId
    ), return_lines AS (
      SELECT r.id, COUNT(ri.id) AS lineCount, COALESCE(SUM(ri.lineTotal),0) AS lineTotal,
        ${returnCosts} AS costTotal, ${badReturnCosts} AS badCosts,
        COALESCE(SUM(CASE WHEN i.ivaExento=0 THEN ri.lineTotal ELSE 0 END),0) AS taxableTotal,
        COALESCE(SUM(i.id IS NULL OR i.saleId<>r.saleId OR i.productId<>ri.productId OR ri.quantity<=0 OR ri.quantity>i.quantity OR ri.lineTotal<0),0) AS badLines
      FROM returned r LEFT JOIN ProductReturnItem ri ON ri.productReturnId=r.id AND ri.tenantId=${principal.tenantId}
      LEFT JOIN SaleItem i ON i.id=ri.saleItemId AND i.saleId=r.saleId GROUP BY r.id
    ), returns_aggregate AS (
      SELECT COALESCE(SUM(r.total),0) AS returnsTotal, COALESCE(SUM(l.costTotal),0) AS returnedCost,
        COALESCE(SUM(CASE WHEN r.vatAmountAtSale=0 THEN 0 ELSE
          r.vatAmountAtSale*l.taxableTotal/NULLIF(t.amount*(1-CAST(r.globalDiscount AS DECIMAL(10,6))/100),0) END),0) AS returnedVat,
        COALESCE(SUM(l.lineCount=0 OR l.badLines>0 OR ABS(l.lineTotal-r.total)>0.0001),0) AS ambiguousReturns,
        COALESCE(SUM(l.badCosts>0),0) AS unknownReturnCost,
        COALESCE(SUM(r.vatAmountAtSale IS NULL OR r.vatAmountAtSale<0 OR r.vatAmountAtSale>r.originalSaleTotal OR (r.vatAmountAtSale>0 AND COALESCE(t.amount,0)*(1-CAST(r.globalDiscount AS DECIMAL(10,6))/100)<=0)),0) AS unknownReturnVat
      FROM returned r JOIN return_lines l ON l.id=r.id LEFT JOIN original_taxable t ON t.saleId=r.saleId
    )
    SELECT (SELECT COUNT(*) FROM issued) AS salesCount,
      (SELECT COALESCE(SUM(total),0) FROM issued) AS salesTotal,
      (SELECT COALESCE(SUM(vatAmountAtSale),0) FROM issued) AS salesVat,
      (SELECT COALESCE(SUM(vatAmountAtSale IS NULL OR vatAmountAtSale<0 OR vatAmountAtSale>total),0) FROM issued) AS unknownVat,
      (SELECT ${saleCosts} FROM SaleItem i JOIN issued s ON s.id=i.saleId) AS soldCost,
      (SELECT ${badCosts} FROM SaleItem i JOIN issued s ON s.id=i.saleId)
        +(SELECT COUNT(*) FROM issued s WHERE NOT EXISTS(SELECT 1 FROM SaleItem i WHERE i.saleId=s.id)) AS unknownCost,
      a.*, ${expenses} AS expensesTotal FROM returns_aggregate a`;
}

export function businessHealthMetrics(row: Aggregate | null, financial: boolean): OperationsMetric[] {
  const total = money(row, 'salesTotal'), returns = money(row, 'returnsTotal'), count = money(row, 'salesCount');
  const vat = clean(row, 'unknownVat') ? money(row, 'salesVat') : null;
  const returnLinesKnown = clean(row, 'ambiguousReturns');
  const returnedVat = returnLinesKnown && clean(row, 'unknownReturnVat') ? money(row, 'returnedVat') : null;
  const net = difference(total, returns), netVat = difference(vat, returnedVat), revenue = difference(net, netVat);
  const result = [
    metric('salesTotal', 'Ventas emitidas con impuestos', total, 'Sale.total histórico; documentos vigentes al corte, antes de devoluciones.'),
    metric('salesCount', 'Tickets emitidos', count, 'Cantidad de documentos vigentes emitidos en el período.', 'count'),
    metric('returnsTotal', 'Devoluciones registradas', returns, 'ProductReturn.total del período, incluso de ventas anteriores; incluye resoluciones sin efectivo.'),
    metric('netSalesTotal', 'Ventas menos devoluciones del período', net, 'Flujo de ventas emitidas menos devoluciones registradas; no representa cobros ni utilidad.'),
    metric('salesVat', 'IVA documentado de ventas', vat, 'Sale.vatAmountAtSale; no reconstruye IVA histórico ausente.'),
    metric('returnsVat', 'IVA atribuido a devoluciones', returnedVat, 'Prorrateo de la foto de IVA original sobre líneas normalizadas y precios/descuentos históricos; no usa catálogo actual.'),
    metric('netSalesExVat', 'Ventas netas sin IVA', revenue, 'Ventas menos devoluciones e IVA histórico atribuible; no disponible si falta evidencia de devolución.'),
    metric('averageTicket', 'Ticket promedio emitido con impuestos', divide(total, count), 'Ventas emitidas divididas por tickets vigentes; no mezcla devoluciones de otras ventas en el denominador.'),
  ];
  if (financial) {
    const cost = clean(row, 'unknownCost') && clean(row, 'unknownReturnCost') && returnLinesKnown ? difference(money(row, 'soldCost'), money(row, 'returnedCost')) : null;
    const margin = difference(revenue, cost);
    result.push(metric('netCostOfGoods', 'Costo histórico neto de mercadería', cost, 'SaleItem.costAtSale × cantidad BASE, menos ProductReturnItem.costTotal. PACK no vuelve a multiplicarse.'),
      metric('grossMargin', 'Margen bruto histórico', margin, 'Ventas netas sin IVA menos costo histórico; no es ganancia neta ni flujo de caja.'),
      metric('grossMarginPercent', 'Margen bruto sobre ventas netas', revenue?.gt(0) ? divide(margin, revenue)?.mul(100) ?? null : null, 'Margen bruto / ventas netas sin IVA positivas.', 'percent'),
      metric('expensesTotal', 'Gastos registrados', money(row, 'expensesTotal'), 'Expense del período; no acredita todos los gastos del negocio.'));
  }
  return result;
}

export async function auditBusinessHealth(principal: AssistantPrincipal, input: unknown = {}, deps: AnalyticsDependencies = {}): Promise<BusinessHealthResult> {
  const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
  await assertAssistantAccess(principal, 'overview', db);
  if (![...ASSISTANT_BUSINESS_SALES_ROLES, ...ASSISTANT_OWN_SALES_ROLES].includes(principal.role)) {
    throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu rol no puede consultar ventas ni salud financiera.');
  }
  const parsed = auditBusinessHealthQuerySchema.parse(input);
  const { period, comparison, asOf } = resolveOperationsPeriods(parsed, now);
  const financial = ASSISTANT_FINANCIAL_ROLES.includes(principal.role);
  const warnings: string[] = [];
  const read = async (range: ResolvedOperationsPeriod) => {
    try { return (await db.$queryRaw<Aggregate[]>(businessHealthSql(principal, range, asOf, financial)))[0] ?? null; }
    catch { warnings.push(`No se pudieron verificar las cifras de ${range.startDate} a ${range.endDate}.`); return null; }
  };
  const [currentRow, previousRow] = await Promise.all([read(period), read(comparison)]);
  const metrics = businessHealthMetrics(currentRow, financial), previousMetrics = businessHealthMetrics(previousRow, financial);
  const changes = metrics.map((current, index) => {
    const previous = previousMetrics[index];
    const a = current.value === null ? null : new Decimal(current.value), b = previous.value === null ? null : new Decimal(previous.value);
    return metric(`${current.key}Change`, `Cambio: ${current.label}`, b?.isZero() ? null : divide(difference(a, b), b?.abs() ?? null)?.mul(100) ?? null,
      'Variación respecto al período comparable con igual duración y corte; base cero significa no comparable.', 'percent');
  });
  if (metrics.some(item => item.status === 'unavailable')) warnings.push('Hay indicadores sin evidencia suficiente; no deben interpretarse como cero.');
  await assertAssistantAccess(principal, 'overview', db);
  const known = metrics.filter(item => item.status === 'ok').length;
  return { kind: 'BUSINESS_HEALTH', status: known === 0 ? 'unavailable' : known === metrics.length ? 'ok' : 'partial', checkedAt: now.toISOString(),
    period: periodDTO(period), comparison: { period: periodDTO(comparison), metrics: previousMetrics, changes }, metrics,
    evidence: ['Agregaciones de MySQL por negocio y vendedor autorizado.', 'Días civiles de Managua; comparación diaria contra el mismo día de la semana anterior.',
      'Los saldos de caja/deuda y cambios de ventas no demuestran causalidad ni pronostican ingresos.'], warnings };
}
