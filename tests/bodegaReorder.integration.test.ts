import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

const baseUrl = process.env.NORTEX_QA_BASE_URL;
const qa = baseUrl ? describe.sequential : describe.skip;
async function fixture() {
  const { signAuthToken } = await import('../backend/services/secrets');
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/.test(url.pathname)) throw new Error('Solo DB local descartable');
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA reposición', taxId: randomUUID(), subscriptionStatus: 'ACTIVE' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, role: 'OWNER', name: 'Dueña QA', password: 'synthetic-no-login' } });
  const supplier = await prisma.supplier.create({ data: { tenantId: tenant.id, name: 'Proveedor QA', category: 'Prueba' } });
  const token = signAuthToken({ tenantId: tenant.id, userId: user.id, role: 'OWNER' });
  const f = { tenantId: tenant.id, userId: user.id, supplierId: supplier.id, token };
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const product = (f: Fixture, values: Record<string, any> = {}) => prisma.product.create({ data: { tenantId: f.tenantId, createdBy: f.userId, defaultSupplierId: f.supplierId, name: 'Producto reposición', sku: randomUUID(), stock: 5, minStock: 0, reorderPoint: 10, maxStock: 30, price: 3, cost: 2, unit: 'unidad', saleMode: 'COUNTED', quantityStep: 1, ...values } });
async function order(f: Fixture, productId: string, status = 'APPROVED', values: Record<string, any> = {}) {
  return prisma.purchaseOrder.create({ data: { tenantId: f.tenantId, supplierId: f.supplierId, orderNumber: randomUUID(), createdBy: f.userId, status, items: { create: { productId, productName: 'Producto QA', quantityOrdered: 20, quantityReceived: 5, quantityOrderedExact: 20, quantityReceivedExact: 5, unitCost: 2, ...values } } } });
}
async function report(f: Fixture, query = '') {
  const response = await fetch(`${baseUrl}/api/inventory/reorder${query}`, { headers: { authorization: `Bearer ${f.token}` } });
  return { status: response.status, body: await response.json() };
}

qa('QA bodega: reposición descuenta lo ya pedido', () => {
  it('descuenta únicamente el saldo entrante de OC aprobadas y parciales', async () => {
    const f = await fixture(); const p = await product(f);
    await order(f, p.id); await order(f, p.id, 'PARTIALLY_RECEIVED', { quantityOrderedExact: 8, quantityReceivedExact: 3 });
    for (const status of ['DRAFT', 'RECEIVED', 'CLOSED_SHORT', 'CANCELLED']) await order(f, p.id, status);
    const result = await report(f); expect(result.status).toBe(200);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ currentStock: 5, incomingQuantity: 20, projectedStock: 25, suggestedQty: 5, suggestedCost: 10 });
  });

  it('usa exactos y saldo cerrado sin leer las sombras Float como autoridad', async () => {
    const f = await fixture(); const p = await product(f, { stock: 0.5, unit: 'metro', saleMode: 'MEASURED', quantityStep: 0.25, maxStock: 20 });
    await order(f, p.id, 'PARTIALLY_RECEIVED', { quantityOrdered: 16, quantityReceived: 6, quantityOrderedExact: '15.5', quantityReceivedExact: '5.25', quantityClosedShortExact: '0.25' });
    const result = await report(f);
    expect(result.body.items[0]).toMatchObject({ incomingQuantity: 10, projectedStock: 10.5, suggestedQty: 9.5, suggestedCost: 19 });
  });

  it('no recomienda otra compra cuando la recepción pendiente cubre la meta', async () => {
    const f = await fixture(); const p = await product(f);
    await order(f, p.id, 'APPROVED', { quantityOrderedExact: 40, quantityReceivedExact: 0 });
    const result = await report(f);
    expect(result.body.items).toEqual([]); expect(result.body.total).toBe(0); expect(result.body.totalEstimatedCost).toBe(0);
  });

  it('conserva mínimo como umbral cuando no se configuró punto de reorden', async () => {
    const f = await fixture(); await product(f, { stock: 2, minStock: 5, reorderPoint: 0, maxStock: 10 });
    const result = await report(f);
    expect(result.body.items).toHaveLength(1); expect(result.body.items[0].suggestedQty).toBe(8);
  });

  it('página y suma global exactas conservan aislamiento y orden estable', async () => {
    const f = await fixture(); await product(f, { stock: 0, reorderPoint: 1, maxStock: 1, cost: 0.1 }); await product(f, { stock: 0, reorderPoint: 1, maxStock: 1, cost: 0.2 });
    const other = await fixture(); await product(other, { maxStock: 1000 });
    const first = await report(f, '?page=1&pageSize=1'); const second = await report(f, '?page=2&pageSize=1');
    expect(first.body).toMatchObject({ total: 2, totalEstimatedCost: 0.3, page: 1, pageSize: 1, hasMore: true });
    expect(second.body).toMatchObject({ total: 2, totalEstimatedCost: 0.3, page: 2, pageSize: 1, hasMore: false });
    expect(first.body.items).toHaveLength(1); expect(second.body.items).toHaveLength(1);
    expect(first.body.items[0].productId).not.toBe(second.body.items[0].productId);
    expect((await report(f, '?page=0')).status).toBe(400);
  });

  it('la venta agregada dispara reposición y redondea cajas heredadas a enteros', async () => {
    const f = await fixture(); const p = await product(f, { stock: 0, reorderPoint: 0, minStock: 0, maxStock: 0, unit: 'cajas', saleMode: null, quantityStep: null });
    await prisma.kardexMovement.create({ data: { tenantId: f.tenantId, userId: f.userId, productId: p.id, type: 'SALE', quantity: -3, stockBefore: 3, stockAfter: 0 } });
    const result = await report(f); expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ suggestedQty: 2, reason: 'VELOCITY' });
  });
});
