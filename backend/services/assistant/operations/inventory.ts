import Decimal from 'decimal.js';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { SUPPLIER_RETURN_WRITE_ROLES } from '../../../middleware/accessPolicies.js';
import { BATCH_WRITEOFF_ROLES } from '../../batchWriteoffPreparation.js';
import { assertAssistantAccess, AssistantAccessError, ASSISTANT_FINANCIAL_ROLES } from '../access.js';
import { operationsQuerySchema, resolveOperationsPeriods, managuaDay, shiftCivilDay, periodDTO, type OperationsQuery, type ResolvedOperationsPeriod } from './analyticsPeriod.js';
import { inventoryBurnRateSql, batchExpirySql } from './inventoryQueries.js';
import type { AnalyticsDependencies, InventoryBurnRateRow, InventoryBurnRateResult, BatchExpiryRow, BatchExpiryResult } from './analyticsTypes.js';

export const checkInventoryBurnRateQuerySchema = operationsQuerySchema.omit({ comparison: true });
export const inspectBatchExpiryQuerySchema = operationsQuerySchema.omit({ comparison: true });
type Row = Record<string, any>;
const decimal = (value: unknown): Decimal | null => {
  try { if (value === null || value === undefined) return null; const d = new Decimal(String(value)); return d.isFinite() ? d : null; } catch { return null; }
};
const text = (value: Decimal | null) => value?.toDecimalPlaces(4).toFixed() ?? null;
const same = (a: unknown, b: unknown) => decimal(a) !== null && decimal(b) !== null && decimal(a)!.eq(decimal(b)!);
function quantityStep(row: Row): Decimal | null {
  const step = decimal(row.quantityStep);
  return ['COUNTED','MEASURED'].includes(row.saleMode) && step?.gt(0) && step.decimalPlaces() <= 4 && (row.saleMode !== 'COUNTED' || step.isInteger()) ? step : null;
}

export function inventoryBurnRateRow(row: Row, query: Pick<OperationsQuery, 'warehouseId'>, days: number, financial: boolean): InventoryBurnRateRow {
  const warnings: string[] = [];
  const physical = decimal(row.physicalStock), step = quantityStep(row);
  let sellable = physical?.gte(0) ? physical : null;
  if (row.requiresBatchTracking) {
    sellable = same(row.batchStock, row.physicalStock) && decimal(row.negativeBatches)?.isZero() ? decimal(row.activeStock) : null;
    if (sellable === null) warnings.push('Los lotes no concilian con el stock físico; no se puede acreditar existencia vendible.');
  }
  if (query.warehouseId) {
    const reconciled = same(row.warehouseStock, row.physicalStock) && decimal(row.negativeWarehouses)?.isZero() && decimal(row.targetRows)?.gt(0);
    sellable = !row.requiresBatchTracking && reconciled ? decimal(row.targetStock) : null;
    warnings.push('La velocidad y las OC son del negocio completo; no se atribuyen a una bodega sin evidencia histórica.');
  }
  if (sellable === null && !warnings.length) warnings.push('Existencia vendible no verificable.');
  const sold = decimal(row.soldQuantity), returned = decimal(row.returnedQuantity);
  const restocked = decimal(row.restockedQuantity), quarantined = decimal(row.quarantinedQuantity), lost = decimal(row.lostQuantity);
  const known = decimal(row.unknownRows)?.isZero() && sold?.gte(0) && returned?.gte(0) && !query.warehouseId
    && restocked?.gte(0) && quarantined?.gte(0) && lost?.gte(0) && restocked.plus(quarantined).plus(lost).eq(returned);
  const net = known ? sold!.minus(returned!) : null;
  const consumed = known ? sold!.minus(restocked!) : null;
  const available = decimal(row.historyAvailableDays);
  const historyAvailableDays = available?.isInteger() && available.gte(0) && available.lte(days) ? available.toNumber() : null;
  const sufficient = historyAvailableDays === days && days > 0;
  const daily = sufficient && consumed?.gte(0) ? consumed.div(days) : null;
  if (!known) warnings.push('Las devoluciones o su disposición no permiten verificar salidas netas de inventario.');
  else if (consumed?.lt(0)) warnings.push('Los reintegros al stock superan las ventas del período; no se calcula velocidad futura.');
  if (!sufficient) warnings.push(`Historial insuficiente: ${historyAvailableDays === null ? 'no se verificaron días' : `${historyAvailableDays} días completos`} desde el alta para una ventana de ${days} días. No se estima promedio ni agotamiento; sólo puede sugerirse el mínimo configurado.`);
  else warnings.push('La antigüedad del producto cubre la ventana; el promedio de registros no acredita que el historial importado esté completo ni la demanda no atendida.');
  const pending = query.warehouseId ? null : decimal(row.pendingQuantity);
  const max = decimal(row.maxStock), reorder = decimal(row.reorderPoint);
  let suggested: Decimal | null = null;
  let suggestionBasis: InventoryBurnRateRow['suggestionBasis'] = null;
  const valid = sellable !== null && consumed !== null && consumed.gte(0) && step !== null;
  if (valid && pending?.gte(0) && max?.gte(0) && reorder?.gte(0)) {
    let target: Decimal | null = null;
    if (!sufficient) {
      if (reorder.gt(0)) { target = reorder; suggestionBasis = 'CONFIGURED_MINIMUM'; }
    } else if (max.gt(0)) { target = max; suggestionBasis = 'CONFIGURED_MAXIMUM'; }
    else if (daily?.gt(0)) { target = daily.mul(15); suggestionBasis = 'RECORDED_RATE'; }
    else if (reorder.gt(0)) { target = reorder; suggestionBasis = 'CONFIGURED_MINIMUM'; }
    if (target !== null) suggested = Decimal.max(target.minus(sellable).minus(pending), 0).div(step).ceil().mul(step);
  }
  if (!step) warnings.push('El paso de cantidad del catálogo necesita revisión.');
  return { productId: row.productId, name: row.name, unit: row.unit, quantityStep: text(step), supplierId: row.supplierId ?? null,
    physicalStock: text(query.warehouseId ? decimal(row.targetRows)?.gt(0) ? decimal(row.targetStock) : null : physical), sellableStock: text(sellable),
    soldBaseQuantity: text(sold), returnedBaseQuantity: known ? text(returned) : null, netBaseQuantity: text(net), dailyAverage: text(daily),
    restockedBaseQuantity: known ? text(restocked) : null, quarantinedBaseQuantity: known ? text(quarantined) : null,
    lostBaseQuantity: known ? text(lost) : null, stockConsumptionBaseQuantity: text(consumed),
    historyStatus: sufficient ? 'SUFFICIENT' : 'INSUFFICIENT', historyAvailableDays, historyRequiredDays: days,
    configuredMinimum: text(reorder), configuredMaximum: text(max), suggestionBasis,
    estimatedDaysRemaining: sellable !== null && daily?.gt(0) ? text(sellable.div(daily)) : null,
    pendingOrderQuantity: text(pending), suggestedQuantity: text(suggested), ...(financial ? { cost: text(decimal(row.cost)) } : {}),
    status: !valid ? 'unavailable' : sufficient ? 'ok' : 'partial', warnings };
}

async function warehouseAccess(principal: AssistantPrincipal, query: OperationsQuery, db: NonNullable<AnalyticsDependencies['db']>) {
  if (query.warehouseId && !await db.warehouse.findFirst({ where: { id: query.warehouseId, tenantId: principal.tenantId, isActive: true }, select: { id: true } })) {
    throw new AssistantAccessError(404, 'ASSISTANT_WAREHOUSE_UNAVAILABLE', 'La bodega no está disponible en tu negocio.');
  }
}

export async function checkInventoryBurnRate(principal: AssistantPrincipal, input: unknown = {}, deps: AnalyticsDependencies = {}): Promise<InventoryBurnRateResult> {
  const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
  await assertAssistantAccess(principal, 'inventory', db);
  const parsed = checkInventoryBurnRateQuerySchema.parse(input);
  if (parsed.cutoff && new Date(parsed.cutoff).getTime() !== now.getTime()) throw new AssistantAccessError(400, 'ASSISTANT_CURRENT_STOCK_ONLY', 'La reposición consulta existencias actuales; no hay foto histórica de stock para otro corte.');
  const { query, period } = resolveOperationsPeriods(parsed, now, 'inventory');
  await warehouseAccess(principal, query, db);
  const financial = ASSISTANT_FINANCIAL_ROLES.includes(principal.role);
  const warnings = ['Estimación de salidas por venta menos reintegros RESTOCK registrados; excluye merma y traslados. No es un pronóstico ni una hora de agotamiento.',
    'Las existencias, lotes y OC son los vigentes al consultar, incluso si el período de ventas elegido es anterior.',
    'Las OC aprobadas pendientes reducen la sugerencia; su fecha de llegada y cambios posteriores deben revisarse antes de ordenar.'];
  let raw: Row[] = [], failed = false;
  try { raw = await db.$queryRaw<Row[]>(inventoryBurnRateSql(principal, query, period, new Date(`${managuaDay(now)}T00:00:00Z`), financial)); }
  catch { failed = true; warnings.push('No fue posible verificar existencias y salidas.'); }
  const rows = raw.map(row => inventoryBurnRateRow(row, query, period.days, financial));
  await assertAssistantAccess(principal, 'inventory', db);
  return { kind: 'INVENTORY_BURN_RATE', status: failed ? 'unavailable' : rows.some(r => r.status !== 'ok') ? 'partial' : 'ok',
    checkedAt: now.toISOString(), period: periodDTO(period), rows, metrics: [], evidence: ['SaleItem.quantity representa unidades BASE históricas, incluso cuando la presentación fue PACK.',
      'Se excluyen ventas anuladas. Las devoluciones comerciales se desglosan: sólo RESTOCK reduce salidas de inventario; QUARANTINE/LOSS no reponen stock vendible.',
      'La cobertura usa días completos desde Product.createdAt dentro de la ventana; antigüedad suficiente no prueba calidad ni integridad de importaciones.',
      'Product.stock, lotes, ProductStock y saldo pendiente de OC se consultan sin crear filas ni asignar existencias históricas.'], warnings };
}

export function batchExpiryRow(row: Row, query: Pick<OperationsQuery, 'warehouseId'>, today: string, actions: BatchExpiryRow['allowedActions']): BatchExpiryRow {
  const warnings: string[] = [];
  const expiryDate = row.expiryDate instanceof Date ? row.expiryDate.toISOString().slice(0, 10) : String(row.expiryDate).slice(0, 10);
  const state = expiryDate < today ? 'EXPIRED' : 'EXPIRING';
  const reconciled = same(row.allBatchStock, row.productStock) && decimal(row.negativeBatches)?.isZero();
  let physical = decimal(row.physicalStock), valid = reconciled && physical !== null;
  if (query.warehouseId) {
    valid = valid && row.batchWarehouseLedgerMode === 'ENFORCED' && same(row.warehouseBatchStock, row.physicalStock)
      && same(row.productWarehouseBatchStock, row.productWarehouseStock) && decimal(row.targetBatchStock)?.gte(0) === true;
    physical = decimal(row.targetBatchStock);
  }
  if (!valid) warnings.push('La existencia de lote/bodega no está conciliada; revisala en Inventario antes de preparar una acción.');
  return { batchId: row.batchId, batchNumber: row.batchNumber, productId: row.productId, name: row.name, unit: row.unit,
    quantityStep: text(quantityStep(row)), supplierId: row.supplierId ?? null, expiryDate,
    physicalStock: text(physical), warehouseId: query.warehouseId ?? null,
    sellableStock: valid ? state === 'EXPIRED' ? '0' : text(physical) : null, state, status: valid ? 'ok' : 'unavailable',
    allowedActions: valid && quantityStep(row) ? actions : [], warnings };
}

export async function inspectBatchExpiry(principal: AssistantPrincipal, input: unknown = {}, deps: AnalyticsDependencies = {}): Promise<BatchExpiryResult> {
  const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
  await assertAssistantAccess(principal, 'inventory', db);
  const query = inspectBatchExpiryQuerySchema.parse(input);
  if (query.cutoff && new Date(query.cutoff).getTime() !== now.getTime()) throw new AssistantAccessError(400, 'ASSISTANT_CURRENT_STOCK_ONLY', 'Los vencimientos consultan existencias actuales; no hay foto histórica de stock para otro corte.');
  const today = managuaDay(now), endDate = query.endDate ?? shiftCivilDay(today, 30);
  const endExclusive = new Date(`${shiftCivilDay(endDate, 1)}T00:00:00Z`);
  const days = (endExclusive.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400_000;
  if (query.startDate && query.startDate !== today || days < 1 || days > 367) throw new AssistantAccessError(400, 'ASSISTANT_INVALID_PERIOD', 'Consultá vencidos y próximos vencimientos desde hoy, hasta un año.');
  await warehouseAccess(principal, query, db);
  let raw: Row[] = [], failed = false;
  try { raw = await db.$queryRaw<Row[]>(batchExpirySql(principal, query, endExclusive)); } catch { failed = true; }
  const actions:BatchExpiryRow['allowedActions'] = [
    ...(BATCH_WRITEOFF_ROLES.includes(principal.role) ? ['BATCH_WRITEOFF' as const] : []),
    ...(SUPPLIER_RETURN_WRITE_ROLES.includes(principal.role) ? ['SUPPLIER_RETURN' as const] : []),
  ];
  const rows = raw.map(row => batchExpiryRow(row, query, today, actions));
  await assertAssistantAccess(principal, 'inventory', db);
  return { kind: 'BATCH_EXPIRY', status: failed ? 'unavailable' : rows.some(r => r.status === 'unavailable') ? 'partial' : 'ok', checkedAt: now.toISOString(),
    period: { startDate: today, endDate, cutoff: now.toISOString(), timeZone: 'America/Managua', completeDays: false }, rows, metrics: [],
    evidence: ['ProductBatch con stock positivo; vencido si su fecha civil es anterior a hoy en Managua.', 'Incluye vencidos y el último día del horizonte; la elegibilidad final se vuelve a validar en Inventario.'],
    warnings: failed ? ['No fue posible verificar lotes y vencimientos.'] : ['La cuarentena de devoluciones de clientes no es una retención genérica de lotes. No se ofrece retener/liberar ni se ejecuta ninguna acción al consultar.'] };
}
