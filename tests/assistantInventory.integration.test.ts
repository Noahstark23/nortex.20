import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { applyStockDelta } from '../backend/services/stockService';
import { checkInventoryBurnRate, inspectBatchExpiry } from '../backend/services/assistant/operations/inventory';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
const deps = { db: prisma, now: () => new Date('2026-09-05T18:25:00Z') };
async function fixture(tracked = false) {
  const nonce = randomUUID();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA inventario sintético', taxId: `QA-${nonce}`, type: tracked ? 'FARMACIA' : 'FERRETERIA' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'QA dueño', role: 'OWNER', password: 'not-a-login-account' } });
  const supplier = await prisma.supplier.create({ data: { tenantId: tenant.id, name: 'Proveedor sintético' } });
  const warehouse = await prisma.warehouse.create({ data: { tenantId: tenant.id, name: 'Principal QA', isDefault: true } });
  const product = await prisma.product.create({ data: { tenantId: tenant.id, createdBy: user.id, name: 'Artículo sintético', sku: nonce, price: 20,
    cost: 17.25, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', reorderPoint: 5, maxStock: 100, defaultSupplierId: supplier.id,
    requiresBatchTracking: tracked, packSize: 12, packUnit: 'caja', createdAt: new Date('2026-07-01T06:00:00Z') } });
  await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true } });
  await prisma.$transaction(async tx => {
    const result = await applyStockDelta(tx, { tenantId: tenant.id, productId: product.id, warehouseId: warehouse.id, delta: 10, enforceSufficient: true });
    await tx.auditLog.create({ data: { tenantId: tenant.id, userId: user.id, action: 'QA_INITIAL_STOCK', details: JSON.stringify(result) } });
  });
  return { tenantId: tenant.id, userId: user.id, role: user.role, productId: product.id, warehouseId: warehouse.id, supplierId: supplier.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function demand(f: Fixture, quantity = 60, date = '2026-08-20T15:00:00Z') {
  return prisma.sale.create({ data: { tenantId: f.tenantId, soldById: f.userId, total: '690', vatAmountAtSale: '90', status: 'COMPLETED', paymentMethod: 'CASH',
    createdAt: new Date(date), items: { create: { productId: f.productId, quantity, priceAtSale: '11.5', unitPriceExactAtSale: '11.5', costAtSale: '4',
      presentationAtSale: 'PACK', presentationQuantityAtSale: '5', unitAtSale: 'unidad', saleModeAtSale: 'COUNTED', quantityStepAtSale: '1' } } }, include: { items: true } });
}
async function order(f: Fixture, status: string, ordered: string, received = '0', closed = '0') {
  return prisma.purchaseOrder.create({ data: { tenantId: f.tenantId, supplierId: f.supplierId, createdBy: f.userId, orderNumber: randomUUID(), status,
    items: { create: { productId: f.productId, productName: 'Artículo OC', quantityOrdered: Number(ordered), quantityReceived: Number(received),
      quantityOrderedExact: ordered, quantityReceivedExact: received, quantityClosedShortExact: closed, unitCost: '4', unitAtOrder: 'unidad',
      saleModeAtOrder: 'COUNTED', quantityStepAtOrder: '1' } } } });
}

qa('Inventario: agregaciones reales MySQL sin sembrar al consultar', () => {
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
    expect(url.protocol).toBe('mysql:'); expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/); vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
  });
  afterAll(() => vi.unstubAllEnvs());

  it('producto creado hace siete días con treinta ventas no aparenta treinta días observados', async () => {
    const f = await fixture();
    await prisma.product.update({ where: { id: f.productId }, data: { createdAt: new Date('2026-08-29T06:00:00Z'), reorderPoint: 20 } });
    await demand(f, 30, '2026-08-30T15:00:00Z');
    const result = await checkInventoryBurnRate(f, {}, deps);
    expect(result.status).toBe('partial');
    expect(result.rows[0]).toMatchObject({ historyStatus: 'INSUFFICIENT', historyAvailableDays: 7, historyRequiredDays: 30,
      soldBaseQuantity: '30', dailyAverage: null, estimatedDaysRemaining: null, configuredMinimum: '20', configuredMaximum: '100',
      suggestedQuantity: '10', suggestionBasis: 'CONFIGURED_MINIMUM', status: 'partial' });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.productId } })).stock).toBe(10);
  }, 120_000);

  it.each([
    ['2026-08-06T06:00:00Z', 30, 'SUFFICIENT'],
    ['2026-08-06T06:00:00.001Z', 29, 'INSUFFICIENT'],
    ['2026-09-05T06:00:00Z', 0, 'INSUFFICIENT'],
  ])('cobertura excluye días parciales de Managua desde %s', async (createdAt, available, historyStatus) => {
    const f = await fixture(); await prisma.product.update({ where: { id: f.productId }, data: { createdAt: new Date(createdAt) } });
    const result = await checkInventoryBurnRate(f, {}, deps);
    expect(result.rows[0]).toMatchObject({ historyAvailableDays: available, historyRequiredDays: 30, historyStatus,
      dailyAverage: historyStatus === 'SUFFICIENT' ? '0' : null, estimatedDaysRemaining: null });
  }, 120_000);

  it('desglosa RESTOCK, QUARANTINE y LOSS sin restar cuarentena o pérdida a las salidas', async () => {
    const f = await fixture(), original = await demand(f);
    for (const [disposition, quantity] of [['RESTOCK', 6], ['QUARANTINE', 3], ['LOSS', 1]] as const) {
      await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: String(quantity * 11.5), reason: 'QA disposición', createdBy: f.userId,
        items: [], createdAt: new Date('2026-08-21T15:00:00Z'), normalizedItems: { create: { tenantId: f.tenantId, productId: f.productId,
          saleItemId: original.items[0].id, quantity: String(quantity), refundUnitPrice: '11.5', lineTotal: String(quantity * 11.5), costTotal: String(quantity * 4), disposition } } } });
    }
    expect((await checkInventoryBurnRate(f, {}, deps)).rows[0]).toMatchObject({ soldBaseQuantity: '60', returnedBaseQuantity: '10', netBaseQuantity: '50',
      restockedBaseQuantity: '6', quarantinedBaseQuantity: '3', lostBaseQuantity: '1', stockConsumptionBaseQuantity: '54', dailyAverage: '1.8', historyStatus: 'SUFFICIENT', status: 'ok' });
  }, 120_000);

  it('disposición desconocida bloquea proyección y sugerencia aun con stock conciliado', async () => {
    const f = await fixture(), original = await demand(f);
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: '11.5', reason: 'QA disposición desconocida', createdBy: f.userId,
      items: [], createdAt: new Date('2026-08-21T15:00:00Z'), normalizedItems: { create: { tenantId: f.tenantId, productId: f.productId,
        saleItemId: original.items[0].id, quantity: '1', refundUnitPrice: '11.5', lineTotal: '11.5', costTotal: '4', disposition: 'UNKNOWN_LEGACY' } } } });
    expect((await checkInventoryBurnRate(f, {}, deps)).rows[0]).toMatchObject({ sellableStock: '10', dailyAverage: null, estimatedDaysRemaining: null,
      restockedBaseQuantity: null, suggestedQuantity: null, status: 'unavailable' });
  }, 120_000);

  it('rechaza corte histórico para reposición y mantiene rango anterior con stock actual explícito', async () => {
    const f = await fixture();
    await expect(checkInventoryBurnRate(f, { cutoff: '2026-08-01T18:00:00Z' }, deps)).rejects.toMatchObject({ code: 'ASSISTANT_CURRENT_STOCK_ONLY' });
    const result = await checkInventoryBurnRate(f, { startDate: '2026-08-01', endDate: '2026-08-30' }, deps);
    expect(result.rows[0]).toMatchObject({ physicalStock: '10', historyAvailableDays: 30, historyRequiredDays: 30 });
    expect(result.warnings).toContain('Las existencias, lotes y OC son los vigentes al consultar, incluso si el período de ventas elegido es anterior.');
  }, 120_000);

  it('demanda BASE, devolución y OC parcial/cierre concilian antes de sugerir', async () => {
    const f = await fixture(), original = await demand(f);
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: '115', reason: 'QA parcial', createdBy: f.userId,
      items: [], createdAt: new Date('2026-08-21T15:00:00Z'), normalizedItems: { create: { tenantId: f.tenantId, productId: f.productId,
        saleItemId: original.items[0].id, quantity: '10', refundUnitPrice: '11.5', lineTotal: '115', costTotal: '40', disposition: 'RESTOCK' } } } });
    await order(f, 'PARTIALLY_RECEIVED', '50', '20', '10');
    await order(f, 'DRAFT', '999'); await order(f, 'CANCELLED', '777');
    const result = await checkInventoryBurnRate(f, {}, deps);
    expect(result.status).toBe('ok'); expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ soldBaseQuantity: '60', returnedBaseQuantity: '10', netBaseQuantity: '50', dailyAverage: '1.6667',
      physicalStock: '10', sellableStock: '10', pendingOrderQuantity: '20', estimatedDaysRemaining: '6', suggestedQuantity: '70' });
  }, 120_000);

  it('salidas anuladas, anteriores y del día incompleto no inflan velocidad', async () => {
    const f = await fixture(); const cancelled = await demand(f, 300);
    await prisma.sale.update({ where: { id: cancelled.id }, data: { status: 'VOIDED', cancelledAt: new Date('2026-08-22T15:00:00Z') } });
    await demand(f, 600, '2026-08-06T05:59:59Z'); await demand(f, 900, '2026-09-05T06:00:00Z');
    await demand(f, 30, '2026-08-06T06:00:00Z');
    const result = await checkInventoryBurnRate(f, {}, deps);
    expect(result.rows[0]).toMatchObject({ soldBaseQuantity: '30', dailyAverage: '1', estimatedDaysRemaining: '10' });
  }, 120_000);

  it('farmacia: separa lote vencido de vendible y usa fecha civil', async () => {
    const f = await fixture(true); await demand(f, 30);
    const expired = await prisma.productBatch.create({ data: { tenantId: f.tenantId, productId: f.productId, batchNumber: 'VENCIDO', stock: 3, expiryDate: new Date('2026-09-04T00:00:00Z') } });
    await prisma.productBatch.create({ data: { tenantId: f.tenantId, productId: f.productId, batchNumber: 'HOY', stock: 7, expiryDate: new Date('2026-09-05T00:00:00Z') } });
    const burn = await checkInventoryBurnRate(f, {}, deps);
    expect(burn.rows[0]).toMatchObject({ physicalStock: '10', sellableStock: '7', dailyAverage: '1', estimatedDaysRemaining: '7' });
    const lots = await inspectBatchExpiry(f, {}, deps);
    expect(lots.rows).toHaveLength(2); expect(lots.rows[0]).toMatchObject({ batchId: expired.id, state: 'EXPIRED', sellableStock: '0' });
    expect(lots.rows[1]).toMatchObject({ state: 'EXPIRING', sellableStock: '7' });
  }, 120_000);

  it('inconsistencia de lotes y devolución antigua quedan unavailable sin reparar datos', async () => {
    const f = await fixture(true), original = await demand(f, 30);
    await prisma.productBatch.create({ data: { tenantId: f.tenantId, productId: f.productId, batchNumber: 'INCOMPLETO', stock: 7, expiryDate: new Date('2026-09-08T00:00:00Z') } });
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: '11.5', reason: 'QA legado', createdBy: f.userId,
      items: [{ productId: f.productId, quantity: 1 }], createdAt: new Date('2026-08-21T15:00:00Z') } });
    const before = await prisma.productStock.count({ where: { tenantId: f.tenantId } });
    expect((await checkInventoryBurnRate(f, {}, deps)).rows[0]).toMatchObject({ sellableStock: null, netBaseQuantity: null, suggestedQuantity: null });
    expect((await inspectBatchExpiry(f, {}, deps)).rows[0]).toMatchObject({ sellableStock: null, allowedActions: [] });
    expect(await prisma.productStock.count({ where: { tenantId: f.tenantId } })).toBe(before);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.productId } })).stock).toBe(10);
  }, 120_000);

  it('filtra tenant y permiso; bodeguero no recibe costos ni acciones de escritura', async () => {
    const own = await fixture(), other = await fixture(); await demand(other, 300);
    const warehouseUser = await prisma.user.create({ data: { tenantId: own.tenantId, name: 'QA bodega', role: 'BODEGUERO', password: 'not-a-login-account' } });
    const actor = { tenantId: own.tenantId, userId: warehouseUser.id, role: warehouseUser.role };
    expect((await checkInventoryBurnRate(actor, { productIds: [other.productId] }, deps)).rows).toEqual([]);
    const result = await checkInventoryBurnRate(actor, {}, deps); expect(result.rows).toHaveLength(1); expect(result.rows[0]).not.toHaveProperty('cost');
    await expect(inspectBatchExpiry(actor, { warehouseId: other.warehouseId }, deps)).rejects.toMatchObject({ statusCode: 404 });
  }, 120_000);

  it('ledger de lote/bodega requiere modo autoritativo y conciliación con ProductStock', async () => {
    const f = await fixture(true);
    const lot = await prisma.productBatch.create({ data: { tenantId: f.tenantId, productId: f.productId, batchNumber: 'POR-BODEGA', stock: 10, expiryDate: new Date('2026-09-08T00:00:00Z') } });
    await prisma.productBatchWarehouseStock.create({ data: { tenantId: f.tenantId, productId: f.productId, batchId: lot.id, warehouseId: f.warehouseId, stock: '10' } });
    expect((await inspectBatchExpiry(f, { warehouseId: f.warehouseId }, deps)).rows[0].sellableStock).toBeNull();
    await prisma.tenant.update({ where: { id: f.tenantId }, data: { batchWarehouseLedgerMode: 'ENFORCED' } });
    expect((await inspectBatchExpiry(f, { warehouseId: f.warehouseId }, deps)).rows[0]).toMatchObject({ sellableStock: '10', status: 'ok' });
    await prisma.productBatchWarehouseStock.updateMany({ where: { tenantId: f.tenantId, batchId: lot.id }, data: { stock: '9' } });
    expect((await inspectBatchExpiry(f, { warehouseId: f.warehouseId }, deps)).rows[0]).toMatchObject({ sellableStock: null, allowedActions: [] });
  }, 120_000);

  it.each(['wrong-product', 'negative-offset'])('no pronostica con devolución normalizada inválida: %s', async corruption => {
    const f = await fixture(), original = await demand(f, 30);
    const other = await prisma.product.create({ data: { tenantId: f.tenantId, createdBy: f.userId, name: 'Otro producto QA', sku: randomUUID(), price: 20, cost: 4 } });
    const entries = corruption === 'wrong-product'
      ? [{ productId: other.id, quantity: '1', lineTotal: '11.5' }]
      : [{ productId: f.productId, quantity: '-1', lineTotal: '0' }, { productId: f.productId, quantity: '2', lineTotal: '11.5' }];
    for (const entry of entries) await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: entry.lineTotal, reason: 'QA normalización inválida', createdBy: f.userId,
      items: [], createdAt: new Date('2026-08-21T15:00:00Z'), normalizedItems: { create: { ...entry, tenantId: f.tenantId,
        saleItemId: original.items[0].id, refundUnitPrice: '11.5', costTotal: '4', disposition: 'RESTOCK' } } } });
    const result = await checkInventoryBurnRate(f, { productIds: [f.productId] }, deps);
    expect(result.rows[0]).toMatchObject({ netBaseQuantity: null, dailyAverage: null, estimatedDaysRemaining: null, suggestedQuantity: null });
  }, 120_000);
});
