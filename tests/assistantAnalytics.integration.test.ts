import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { auditBusinessHealth } from '../backend/services/assistant/operations/analytics';
const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
type PurchaseFixture = { tenantId: string; userId: string; role: string; productId: string };
async function fixture(): Promise<PurchaseFixture> {
  const nonce = randomUUID();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA analítica sintética', taxId: `QA-${nonce}`, type: 'FERRETERIA' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, role: 'OWNER', name: 'QA dueño', password: 'not-a-login-account' } });
  const product = await prisma.product.create({ data: { tenantId: tenant.id, createdBy: user.id, name: 'Producto sintético', sku: nonce, price: 20, cost: 4, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' } });
  await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true } });
  return { tenantId: tenant.id, userId: user.id, role: user.role, productId: product.id };
}
async function roleActor(f: PurchaseFixture, role: string) {
  const user = await prisma.user.create({ data: { tenantId: f.tenantId, role, name: `QA ${role}`, password: 'not-a-login-account' } });
  return { tenantId: f.tenantId, userId: user.id, role };
}
const deps = { db: prisma, now: () => new Date('2026-09-05T18:25:00Z') };
const query = { startDate: '2026-09-01', endDate: '2026-09-01' };
const values = (result: Awaited<ReturnType<typeof auditBusinessHealth>>) => Object.fromEntries(result.metrics.map(m => [m.key, m.value]));

async function sale(f: PurchaseFixture, input: { total: string; vat: string | null; quantity: number; price: string; cost: string; date?: string; seller?: string; presentation?: 'BASE' | 'PACK'; displayQuantity?: string }) {
  return prisma.sale.create({ data: { tenantId: f.tenantId, soldById: input.seller ?? f.userId, total: input.total,
    vatAmountAtSale: input.vat, fiscalRegimeAtSale: 'GENERAL', status: 'COMPLETED', paymentMethod: 'CASH',
    createdAt: new Date(input.date ?? '2026-09-01T15:00:00Z'), items: { create: { productId: f.productId, quantity: input.quantity,
      priceAtSale: input.price, unitPriceExactAtSale: input.price, costAtSale: input.cost, productNameAtSale: 'Nombre histórico', unitAtSale: 'unidad',
      saleModeAtSale: 'COUNTED', quantityStepAtSale: '1', presentationAtSale: input.presentation ?? 'BASE',
      presentationQuantityAtSale: input.displayQuantity ?? String(input.quantity), ivaExento: false } } }, include: { items: true } });
}

qa('Analítica: consultas verdaderas MySQL y resultados independientes', () => {
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
    expect(url.protocol).toBe('mysql:'); expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/);
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
  });
  afterAll(() => vi.unstubAllEnvs());
  it('reconcilia ventas, devolución normalizada, IVA, costo y comparación sin precios actuales', async () => {
    const f = await fixture();
    const first = await sale(f, { total: '230', vat: '30', quantity: 2, price: '115', cost: '30' });
    await sale(f, { total: '115', vat: '15', quantity: 1, price: '115', cost: '50' });
    await sale(f, { total: '115', vat: '15', quantity: 1, price: '115', cost: '40', date: '2026-08-25T15:00:00Z' });
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: first.id, total: '115', reason: 'Fixture QA parcial', createdBy: f.userId,
      clientEventId: randomUUID(), items: [], createdAt: new Date('2026-09-01T19:00:00Z'), normalizedItems: { create: { tenantId: f.tenantId,
        saleItemId: first.items[0].id, productId: f.productId, quantity: '1', refundUnitPrice: '115', lineTotal: '115', costTotal: '30', disposition: 'RESTOCK' } } } });
    await prisma.product.update({ where: { id: f.productId }, data: { price: 9999, cost: 8888, name: 'Nombre cambiado' } });
    const result = await auditBusinessHealth(f, query, deps);
    expect(values(result)).toMatchObject({ salesTotal: '345', salesCount: '2', returnsTotal: '115', salesVat: '45', returnsVat: '15',
      netSalesTotal: '230', netSalesExVat: '200', netCostOfGoods: '80', grossMargin: '120', grossMarginPercent: '60', averageTicket: '172.5' });
    expect(result.comparison.metrics.find(m => m.key === 'grossMargin')?.value).toBe('60');
    expect(result.comparison.changes.find(m => m.key === 'salesTotalChange')?.value).toBe('200');
  }, 120_000);

  it('PACK usa cantidad base una vez para costo y conserva la foto fiscal', async () => {
    const f = await fixture(); await sale(f, { total: '138', vat: '18', quantity: 12, price: '11.5', cost: '4', presentation: 'PACK', displayQuantity: '1' });
    const result = await auditBusinessHealth(f, query, deps);
    expect(values(result)).toMatchObject({ salesTotal: '138', netSalesExVat: '120', netCostOfGoods: '48', grossMargin: '72', averageTicket: '138' });
  }, 120_000);

  it('devolución de otra fecha se muestra en el flujo actual y no altera ticket emitido', async () => {
    const f = await fixture(); await sale(f, { total: '115', vat: '15', quantity: 1, price: '115', cost: '40' });
    const old = await sale(f, { total: '57.5', vat: '7.5', quantity: 1, price: '57.5', cost: '20', date: '2026-08-01T15:00:00Z' });
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: old.id, total: '57.5', reason: 'Devuelve compra anterior', createdBy: f.userId,
      items: [], createdAt: new Date('2026-09-01T19:00:00Z'), normalizedItems: { create: { tenantId: f.tenantId, saleItemId: old.items[0].id,
        productId: f.productId, quantity: '1', refundUnitPrice: '57.5', lineTotal: '57.5', costTotal: '20', disposition: 'RESTOCK' } } } });
    expect(values(await auditBusinessHealth(f, query, deps))).toMatchObject({ salesCount: '1', averageTicket: '115', returnsTotal: '57.5',
      netSalesExVat: '50', netCostOfGoods: '20', grossMargin: '30' });
  }, 120_000);

  it('históricos sin IVA y devoluciones sin líneas no inventan margen', async () => {
    const f = await fixture(); const original = await sale(f, { total: '115', vat: null, quantity: 1, price: '115', cost: '40' });
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: '23', reason: 'Histórico ambiguo', createdBy: f.userId,
      items: [{ productId: f.productId, quantity: 0.2 }], createdAt: new Date('2026-09-01T19:00:00Z') } });
    expect(values(await auditBusinessHealth(f, query, deps))).toMatchObject({ salesTotal: '115', returnsTotal: '23', netSalesTotal: '92',
      salesVat: null, returnsVat: null, netSalesExVat: null, netCostOfGoods: null, grossMargin: null });
  }, 120_000);

  it('los límites civiles y anulaciones excluyen documentos aunque existan físicamente', async () => {
    const f = await fixture();
    await sale(f, { total: '115', vat: '15', quantity: 1, price: '115', cost: '40', date: '2026-09-01T05:59:59Z' });
    await sale(f, { total: '230', vat: '30', quantity: 2, price: '115', cost: '40', date: '2026-09-02T06:00:00Z' });
    const cancelled = await sale(f, { total: '345', vat: '45', quantity: 3, price: '115', cost: '40' });
    await prisma.sale.update({ where: { id: cancelled.id }, data: { status: 'VOIDED', cancelledAt: new Date('2026-09-02T12:00:00Z') } });
    expect(values(await auditBusinessHealth(f, query, deps))).toMatchObject({ salesTotal: '0', salesCount: '0', grossMargin: '0', averageTicket: null });
  }, 120_000);

  it('otro negocio y otro vendedor no entran en la consulta de caja', async () => {
    const f = await fixture(), other = await fixture(), cashier = await roleActor(f, 'CASHIER');
    await sale(f, { total: '115', vat: '15', quantity: 1, price: '115', cost: '40', seller: cashier.userId });
    await sale(f, { total: '230', vat: '30', quantity: 2, price: '115', cost: '40' });
    await sale(other, { total: '999', vat: '0', quantity: 1, price: '999', cost: '10' });
    const result = await auditBusinessHealth(cashier, query, deps);
    expect(values(result)).toMatchObject({ salesTotal: '115', salesCount: '1' });
    expect(result.metrics.some(m => /margin|Cost|expenses/i.test(m.key))).toBe(false);
  }, 120_000);

  it.each(['-1', '116'])('rechaza IVA histórico inválido %s de una venta fuera del período', async vat => {
    const f = await fixture();
    const original = await sale(f, { total: '115', vat, quantity: 1, price: '115', cost: '40', date: '2026-08-01T15:00:00Z' });
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: '115', reason: 'QA foto fiscal inválida', createdBy: f.userId,
      items: [], createdAt: new Date('2026-09-01T19:00:00Z'), normalizedItems: { create: { tenantId: f.tenantId, saleItemId: original.items[0].id,
        productId: f.productId, quantity: '1', refundUnitPrice: '115', lineTotal: '115', costTotal: '40', disposition: 'RESTOCK' } } } });
    expect(values(await auditBusinessHealth(f, query, deps))).toMatchObject({ returnsTotal: '115', returnsVat: null, netSalesExVat: null, grossMargin: null });
  }, 120_000);

  it('un costo de devolución negativo bloquea margen pero conserva IVA acreditado', async () => {
    const f = await fixture(), original = await sale(f, { total: '115', vat: '15', quantity: 1, price: '115', cost: '40' });
    await prisma.productReturn.create({ data: { tenantId: f.tenantId, saleId: original.id, total: '115', reason: 'QA costo inválido', createdBy: f.userId,
      items: [], createdAt: new Date('2026-09-01T19:00:00Z'), normalizedItems: { create: { tenantId: f.tenantId, saleItemId: original.items[0].id,
        productId: f.productId, quantity: '1', refundUnitPrice: '115', lineTotal: '115', costTotal: '-40', disposition: 'RESTOCK' } } } });
    expect(values(await auditBusinessHealth(f, query, deps))).toMatchObject({ returnsVat: '15', netSalesExVat: '0', netCostOfGoods: null, grossMargin: null });
  }, 120_000);
});
