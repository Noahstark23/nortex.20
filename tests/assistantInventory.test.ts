import { Prisma, type PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inventoryBurnRateRow, batchExpiryRow, checkInventoryBurnRate, inspectBatchExpiry } from '../backend/services/assistant/operations/inventory';

const now = new Date('2026-09-05T18:25:00Z');
const product = { productId: 'cemento', name: 'Cemento', unit: 'unidad', quantityStep: '1', saleMode: 'COUNTED', supplierId: 'proveedor',
  physicalStock: '10', reorderPoint: '5', maxStock: '100', requiresBatchTracking: false, cost: '17.25', soldQuantity: '60',
  returnedQuantity: '10', restockedQuantity: '10', quarantinedQuantity: '0', lostQuantity: '0', historyAvailableDays: 30,
  pendingQuantity: '20', unknownRows: '0', batchCount: '2', batchStock: '10', activeStock: '7', negativeBatches: '0',
  warehouseStock: '10', targetStock: '4', targetRows: '1', negativeWarehouses: '0' };
const batch = { batchId: 'lote-a', batchNumber: 'ABC', productId: 'medicina', name: 'Producto lote', unit: 'unidad', quantityStep: '1',
  saleMode: 'COUNTED', supplierId: null, expiryDate: new Date('2026-09-05T00:00:00Z'), physicalStock: '10', productStock: '15',
  allBatchStock: '15', negativeBatches: '0', batchWarehouseLedgerMode: 'ENFORCED', warehouseBatchStock: '10', targetBatchStock: '4',
  productWarehouseBatchStock: '6', productWarehouseStock: '6' };
const burn = (patch = {}, query = {}, financial = true) => inventoryBurnRateRow({ ...product, ...patch }, query, 30, financial);
function harness(role = 'OWNER', rows: any[] = [product]) {
  const principal = { tenantId: 'tenant-a', userId: 'actor-a', role };
  const mocks = {
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'actor-a', role, status: 'ACTIVE' }) },
    assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
    warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'warehouse-a' }) },
    $queryRaw: vi.fn().mockResolvedValue(rows),
  };
  return { principal, mocks, deps: { db: mocks as unknown as PrismaClient, now: () => now } };
}
beforeEach(() => vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('Reposición: cálculo sobre unidades base y evidencia existente', () => {
  it('producto creado hace siete días no recibe promedio ni fecha de agotamiento de treinta días', () => {
    expect(burn({ historyAvailableDays: 7, soldQuantity: '30', returnedQuantity: '0', restockedQuantity: '0', pendingQuantity: '0', reorderPoint: '20' })).toMatchObject({
      historyStatus: 'INSUFFICIENT', historyAvailableDays: 7, historyRequiredDays: 30, dailyAverage: null, estimatedDaysRemaining: null,
      configuredMinimum: '20', configuredMaximum: '100', suggestedQuantity: '10', suggestionBasis: 'CONFIGURED_MINIMUM', status: 'partial',
    });
  });
  it('devoluciones a cuarentena y pérdida no reducen las salidas que deben reponerse', () => {
    expect(burn({ restockedQuantity: '6', quarantinedQuantity: '3', lostQuantity: '1' })).toMatchObject({ returnedBaseQuantity: '10', netBaseQuantity: '50',
      restockedBaseQuantity: '6', quarantinedBaseQuantity: '3', lostBaseQuantity: '1', stockConsumptionBaseQuantity: '54', dailyAverage: '1.8',
    });
  });
  it('falta de cobertura no se supone suficiente ni usa máximo o demanda implícita', () => {
    expect(burn({ historyAvailableDays: null, reorderPoint: '0' })).toMatchObject({ historyStatus: 'INSUFFICIENT', historyAvailableDays: null,
      dailyAverage: null, estimatedDaysRemaining: null, suggestedQuantity: null, suggestionBasis: null, status: 'partial' });
  });
  it('resta devoluciones y saldo de OC; no redondea la media antes de estimar cobertura', () => {
    expect(burn()).toMatchObject({ soldBaseQuantity: '60', returnedBaseQuantity: '10', netBaseQuantity: '50', dailyAverage: '1.6667',
      estimatedDaysRemaining: '6', pendingOrderQuantity: '20', suggestedQuantity: '70', status: 'ok', cost: '17.25' });
  });
  it('un PACK ya expandido en SaleItem.quantity no vuelve a multiplicar la demanda', () => {
    expect(burn({ soldQuantity: '24', returnedQuantity: '0', restockedQuantity: '0', maxStock: '0', pendingQuantity: '0', physicalStock: '2', packSize: 12 })).toMatchObject({ netBaseQuantity: '24', dailyAverage: '0.8', suggestedQuantity: '10', suggestionBasis: 'RECORDED_RATE' });
  });
  it('redondea fraccionables hacia arriba al paso autorizado', () => {
    expect(burn({ saleMode: 'MEASURED', unit: 'kg', quantityStep: '0.25', maxStock: '12.1', physicalStock: '2', pendingQuantity: '0' }).suggestedQuantity).toBe('10.25');
  });
  it('sin máximo usa quince días; las órdenes pendientes pueden cubrir todo', () => {
    expect(burn({ maxStock: '0', pendingQuantity: '20' }).suggestedQuantity).toBe('0');
  });
  it('sin ventas conserva únicamente el mínimo configurado sin multiplicarlo por dos', () => {
    expect(burn({ soldQuantity: '0', returnedQuantity: '0', restockedQuantity: '0', maxStock: '0', pendingQuantity: '0', physicalStock: '2' })).toMatchObject({ dailyAverage: '0', estimatedDaysRemaining: null, suggestedQuantity: '3', suggestionBasis: 'CONFIGURED_MINIMUM' });
  });
  it('devoluciones mayores que ventas mantienen el neto negativo y bloquean proyección', () => {
    expect(burn({ returnedQuantity: '70', restockedQuantity: '70' })).toMatchObject({ netBaseQuantity: '-10', dailyAverage: null, suggestedQuantity: null, status: 'unavailable' });
  });
  it.each([null, 'bad', '-1', '31', '29.5'])('cobertura no acreditable %s no inventa días', historyAvailableDays => {
    expect(burn({ historyAvailableDays, pendingQuantity: '0', reorderPoint: '20' })).toMatchObject({ historyStatus: 'INSUFFICIENT', historyAvailableDays: null,
      dailyAverage: null, estimatedDaysRemaining: null, suggestedQuantity: '10', suggestionBasis: 'CONFIGURED_MINIMUM', status: 'partial' });
  });
  it('sin historia y con OC que cubre el mínimo no sugiere compra al máximo', () => {
    expect(burn({ historyAvailableDays: 7, reorderPoint: '20', pendingQuantity: '30' })).toMatchObject({ suggestedQuantity: '0', suggestionBasis: 'CONFIGURED_MINIMUM', dailyAverage: null });
  });
  it('cuarentena y pérdida conservan visible la devolución comercial aunque el stock consumido sea positivo', () => {
    expect(burn({ soldQuantity: '5', returnedQuantity: '10', restockedQuantity: '2', quarantinedQuantity: '7', lostQuantity: '1' })).toMatchObject({
      netBaseQuantity: '-5', stockConsumptionBaseQuantity: '3', dailyAverage: '0.1', status: 'ok' });
  });
  it.each([{ restockedQuantity: null }, { quarantinedQuantity: '-1' }, { lostQuantity: '2' }])('disposición no conciliada %j bloquea sugerencia incluso con mínimo', patch => {
    expect(burn({ historyAvailableDays: 7, reorderPoint: '20', ...patch })).toMatchObject({ stockConsumptionBaseQuantity: null, dailyAverage: null,
      estimatedDaysRemaining: null, suggestedQuantity: null, suggestionBasis: null, status: 'unavailable' });
  });
  it('devolución histórica sin líneas no se considera cero', () => {
    expect(burn({ unknownRows: '1' })).toMatchObject({ returnedBaseQuantity: null, netBaseQuantity: null, suggestedQuantity: null });
  });
  it('lotes conciliados excluyen vencidos de la cantidad vendible', () => {
    expect(burn({ requiresBatchTracking: true })).toMatchObject({ physicalStock: '10', sellableStock: '7', suggestedQuantity: '73' });
  });
  it.each([{ batchStock: '11' }, { batchStock: null }, { activeStock: null }, { negativeBatches: '1' }])('lotes no conciliados bloquean recomendación %j', patch => {
    expect(burn({ requiresBatchTracking: true, ...patch })).toMatchObject({ sellableStock: null, suggestedQuantity: null, status: 'unavailable' });
  });
  it('stock negativo no se convierte en cero vendible', () => {
    expect(burn({ physicalStock: '-1' })).toMatchObject({ physicalStock: '-1', sellableStock: null, suggestedQuantity: null });
  });
  it('ausencia de fila de bodega no equivale a stock cero', () => {
    expect(burn({targetRows:'0',targetStock:'0'},{warehouseId:'warehouse-a'})).toMatchObject({physicalStock:null,sellableStock:null,status:'unavailable'});
  });
  it('paso de cantidad o modo ausente no se supone para una propuesta', () => {
    expect(burn({quantityStep:null})).toMatchObject({quantityStep:null,suggestedQuantity:null});
    expect(burn({saleMode:null})).toMatchObject({quantityStep:null,suggestedQuantity:null});
  });
  it.each([{ quantityStep: '0' }, { quantityStep: '-1' }, { quantityStep: '0.5' }, { quantityStep: 'bad' }])('paso inválido requiere catálogo %j', patch => {
    expect(burn(patch)).toMatchObject({ suggestedQuantity: null, status: 'unavailable' });
  });
  it('no atribuye velocidad del negocio ni OC a una bodega por suposición', () => {
    expect(burn({}, { warehouseId: 'warehouse-a' })).toMatchObject({ physicalStock: '4', sellableStock: '4', netBaseQuantity: null, pendingOrderQuantity: null, suggestedQuantity: null });
  });
  it('desglose de bodegas incompleto no se rellena al consultar', () => {
    expect(burn({ warehouseStock: '9' }, { warehouseId: 'warehouse-a' }).sellableStock).toBeNull();
  });
  it('bodega con lotes requiere evidencia específica; el agregado no alcanza', () => {
    expect(burn({ requiresBatchTracking: true }, { warehouseId: 'warehouse-a' }).sellableStock).toBeNull();
  });
  it('sin permiso de costos el resultado no contiene la propiedad', () => {
    expect(burn({}, {}, false)).not.toHaveProperty('cost');
  });
});

describe('Vencimientos: fechas civiles, evidencia y acciones existentes', () => {
  it('un lote que vence hoy permanece en el grupo próximo; ayer está vencido', () => {
    expect(batchExpiryRow(batch, {}, '2026-09-05', ['BATCH_WRITEOFF', 'SUPPLIER_RETURN'])).toMatchObject({ state: 'EXPIRING', sellableStock: '10' });
    expect(batchExpiryRow({ ...batch, expiryDate: new Date('2026-09-04T00:00:00Z') }, {}, '2026-09-05', ['BATCH_WRITEOFF', 'SUPPLIER_RETURN'])).toMatchObject({ state: 'EXPIRED', sellableStock: '0' });
  });
  it('lectura autorizada no concede ejecución y no ofrece retener/liberar', () => {
    expect(batchExpiryRow(batch, {}, '2026-09-05', []).allowedActions).toEqual([]);
    expect(batchExpiryRow(batch, {}, '2026-09-05', ['BATCH_WRITEOFF', 'SUPPLIER_RETURN']).allowedActions).toEqual(['BATCH_WRITEOFF', 'SUPPLIER_RETURN']);
  });
  it('bodega con ledger autoritativo y dos conciliaciones muestra su cantidad', () => {
    expect(batchExpiryRow(batch, { warehouseId: 'warehouse-a' }, '2026-09-05', ['BATCH_WRITEOFF', 'SUPPLIER_RETURN'])).toMatchObject({ physicalStock: '4', sellableStock: '4', status: 'ok' });
  });
  it.each([{ batchWarehouseLedgerMode: 'OFF' }, { batchWarehouseLedgerMode: 'SHADOW' }, { warehouseBatchStock: '9' },
    { targetBatchStock: null }, { targetBatchStock: '-1' }, { productWarehouseStock: '7' }])('evidencia insuficiente de bodega %j bloquea acciones', patch => {
    expect(batchExpiryRow({ ...batch, ...patch }, { warehouseId: 'warehouse-a' }, '2026-09-05', ['BATCH_WRITEOFF', 'SUPPLIER_RETURN'])).toMatchObject({ sellableStock: null, allowedActions: [], status: 'unavailable' });
  });
  it('lotes físicos que exceden Product.stock no autorizan merma desde recomendación', () => {
    expect(batchExpiryRow({ ...batch, productStock: '14' }, {}, '2026-09-05', ['BATCH_WRITEOFF', 'SUPPLIER_RETURN'])).toMatchObject({ allowedActions: [], sellableStock: null });
  });
});

describe('Inventario: permiso, SQL acotado y fallos', () => {
  it('consulta SQL parametrizada y ordena antes de LIMIT, sin recuperar catálogo completo', async () => {
    const h = harness(); const result = await checkInventoryBurnRate(h.principal, { productIds: ['cemento'], limit: 10 }, h.deps);
    expect(result.status).toBe('ok'); const sql = h.mocks.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.values).toContain('tenant-a'); expect(sql.values).toContain('cemento'); expect(sql.values).toContain(10);
    expect(sql.sql.indexOf('ORDER BY')).toBeLessThan(sql.sql.indexOf('LIMIT'));
    expect(sql.sql).toContain('quantityClosedShortExact'); expect(sql.sql).not.toContain('presentationQuantityAtSale');
    expect(sql.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
  it('bodeguero obtiene cantidades sin siquiera consultar el costo', async () => {
    const h = harness('BODEGUERO'); const result = await checkInventoryBurnRate(h.principal, {}, h.deps);
    expect(result.rows[0]).not.toHaveProperty('cost');
    expect((h.mocks.$queryRaw.mock.calls[0][0] as Prisma.Sql).sql).not.toContain('p.cost');
  });
  it.each(['CASHIER', 'EMPLOYEE', 'DRIVER'])('rol %s no puede leer inventario', async role => {
    const h = harness(role); await expect(checkInventoryBurnRate(h.principal, {}, h.deps)).rejects.toMatchObject({ statusCode: 403 });
    expect(h.mocks.$queryRaw).not.toHaveBeenCalled();
  });
  it('rechaza bodega ajena antes de leer agregados', async () => {
    const h = harness(); h.mocks.warehouse.findFirst.mockResolvedValue(null);
    await expect(checkInventoryBurnRate(h.principal, { warehouseId: 'foreign' }, h.deps)).rejects.toMatchObject({ statusCode: 404 });
    expect(h.mocks.$queryRaw).not.toHaveBeenCalled();
  });
  it('revocación durante lectura impide devolver resultados', async () => {
    const h = harness(); h.mocks.user.findFirst.mockResolvedValueOnce({ id: 'actor-a', role: 'OWNER', status: 'ACTIVE' }).mockResolvedValue(null);
    await expect(inspectBatchExpiry(h.principal, {}, h.deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });
  it('fallo de base devuelve unavailable, no inventario vacío aprobado', async () => {
    const h = harness(); h.mocks.$queryRaw.mockRejectedValue(new Error('unavailable'));
    expect((await checkInventoryBurnRate(h.principal, {}, h.deps)).status).toBe('unavailable');
    expect((await inspectBatchExpiry(h.principal, {}, h.deps)).status).toBe('unavailable');
  });
  it('un catálogo vacío verificado se distingue del fallo', async () => {
    const h = harness('OWNER', []); expect((await checkInventoryBurnRate(h.principal, {}, h.deps)).status).toBe('ok');
  });
  it('vencimientos incluye hoy y día treinta, más vencidos; no usa hora UTC como fecha local', async () => {
    const h = harness('VIEWER', [batch]); const result = await inspectBatchExpiry(h.principal, {}, h.deps);
    expect(result.period).toMatchObject({ startDate: '2026-09-05', endDate: '2026-10-05' });
    expect((h.mocks.$queryRaw.mock.calls[0][0] as Prisma.Sql).values).toContainEqual(new Date('2026-10-06T00:00:00Z'));
    expect(result.rows[0].allowedActions).toEqual([]);
  });
  it('no finge una foto histórica del stock', async () => {
    const h = harness(); await expect(inspectBatchExpiry(h.principal, { cutoff: '2026-08-01T18:00:00Z' }, h.deps)).rejects.toMatchObject({ code: 'ASSISTANT_CURRENT_STOCK_ONLY' });
  });
  it('la tasa no combina un cutoff histórico con existencias actuales', async () => {
    const h = harness(); await expect(checkInventoryBurnRate(h.principal, { cutoff: '2026-08-01T18:00:00Z' }, h.deps)).rejects.toMatchObject({ code: 'ASSISTANT_CURRENT_STOCK_ONLY' });
    expect(h.mocks.$queryRaw).not.toHaveBeenCalled();
  });
  it('un período anterior declara expresamente que stock y OC corresponden a la consulta actual', async () => {
    const h = harness(); const result = await checkInventoryBurnRate(h.principal, { startDate: '2026-08-01', endDate: '2026-08-30' }, h.deps);
    expect(result.warnings).toContain('Las existencias, lotes y OC son los vigentes al consultar, incluso si el período de ventas elegido es anterior.');
    expect(result.checkedAt).toBe(now.toISOString());
  });
  it.each([
    ['SUPER_ADMIN',['BATCH_WRITEOFF','SUPPLIER_RETURN']],['BODEGUERO',['SUPPLIER_RETURN']],['MANAGER',['SUPPLIER_RETURN']],
  ])('las acciones sugeridas de %s conservan permisos del dominio', async (role, actions) => {
    const h=harness(role as string,[batch]); expect((await inspectBatchExpiry(h.principal,{},h.deps)).rows[0].allowedActions).toEqual(actions);
  });
});
