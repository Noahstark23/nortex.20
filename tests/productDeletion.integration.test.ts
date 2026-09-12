// @vitest-environment node
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { applyStockDelta, asegurarBodegaPorDefecto } from '../backend/services/stockService';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
let base: string;
type Actor = {tenantId: string; userId: string; token: string};
async function actor(tenantId?: string, role = 'OWNER'): Promise<Actor> {
  assertDisposableDatabase();
  const tenant = tenantId ? {id: tenantId} : await prisma.tenant.create({data: {businessName: 'QA Eliminación', taxId: randomUUID(), subscriptionStatus: 'ACTIVE'}});
  const password = `QA-${randomUUID()}`;
  const user = await prisma.user.create({data: {tenantId: tenant.id, role, name: 'Eliminación QA', email: `delete-${randomUUID()}@example.invalid`, password: await bcrypt.hash(password, 4)}});
  const response = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: user.email, password})});
  expect(response.status).toBe(200);
  const body = await response.json();
  return {tenantId: tenant.id, userId: user.id, token: body.token};
}
async function fixture(stock = 0) {
  const principal = await actor();
  const product = await prisma.product.create({data: {tenantId: principal.tenantId, createdBy: principal.userId, sku: randomUUID(), name: 'Conservar producto', price: 12, cost: 7, stock}});
  return {principal, product};
}
async function remove(principal: Actor, productId: string) {
  const response = await fetch(`${base}/api/products/${productId}`, {method: 'DELETE', headers: {authorization: `Bearer ${principal.token}`}});
  return {status: response.status, body: await response.json()};
}

qa('eliminación de productos: preservación HTTP real + MySQL8', () => {
  beforeAll(() => {
    assertDisposableDatabase();
    const url = new URL(process.env.NORTEX_QA_BASE_URL ?? 'invalid:');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Se requiere backend local descartable.');
    base = url.origin;
  });

  it('la ficha sin actividad se conserva y explica cómo corregirla sin fingir un archivo', async () => {
    const f = await fixture();
    expect(await remove(f.principal, f.product.id)).toEqual({status: 409, body: {
      code: 'PRODUCT_DELETION_DISABLED',
      error: 'Los productos se conservan para proteger su historial. Podés corregir su ficha u ocultarlo del catálogo público.',
    }});
    expect(await prisma.product.findUnique({where: {id: f.product.id}})).toMatchObject({name: f.product.name, stock: 0});
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_DELETED'}})).toBe(0);
  });

  it('reproducción: el saldo negativo también bloquea el borrado', async () => {
    const f = await fixture(-2);
    const result = await remove(f.principal, f.product.id);
    expect(result.status).toBe(409);
    expect(await prisma.product.findUnique({where: {id: f.product.id}})).toMatchObject({stock: -2});
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_DELETED'}})).toBe(0);
  });

  it('reproducción: Kardex, lotes y toma física con saldo cero no desaparecen por cascada', async () => {
    const f = await fixture();
    const batch = await prisma.productBatch.create({data: {tenantId: f.principal.tenantId, productId: f.product.id, batchNumber: 'LOTE-HISTORICO', expiryDate: new Date('2030-01-01'), stock: 0}});
    const count = await prisma.stockCount.create({data: {tenantId: f.principal.tenantId, createdBy: f.principal.userId, status: 'CLOSED', items: {create: {productId: f.product.id, expected: 0, counted: 0}}}});
    await prisma.kardexMovement.create({data: {tenantId: f.principal.tenantId, productId: f.product.id, userId: f.principal.userId, type: 'OUT', quantity: -1, stockBefore: 1, stockAfter: 0, batchId: batch.id}});
    const response = await remove(f.principal, f.product.id);
    expect({product: await prisma.product.count({where: {id: f.product.id}}),
      batch: await prisma.productBatch.count({where: {id: batch.id, tenantId: f.principal.tenantId}}),
      countItem: await prisma.stockCountItem.count({where: {countId: count.id, productId: f.product.id}}),
      kardex: await prisma.kardexMovement.count({where: {tenantId: f.principal.tenantId, productId: f.product.id}}),
    }).toEqual({product: 1, batch: 1, countItem: 1, kardex: 1});
    expect(response.status).toBe(409);
  });

  it('reproducción: ventas históricas sin FK conservan el producto aun sin Kardex', async () => {
    const f = await fixture();
    await prisma.sale.create({data: {tenantId: f.principal.tenantId, total: 12, status: 'COMPLETED', paymentMethod: 'CASH', items: {create: {productId: f.product.id, quantity: 1, priceAtSale: 12, costAtSale: 7}}}});
    expect((await remove(f.principal, f.product.id)).status).toBe(409);
    expect(await prisma.product.findUnique({where: {id: f.product.id}})).not.toBeNull();
  });

  it('reproducción: cotizaciones sin FK y pedidos públicos JSON bloquean', async () => {
    const first = await fixture(), second = await fixture();
    await prisma.quotation.create({data: {tenantId: first.principal.tenantId, customerName: 'Cliente QA', subtotal: 12, tax: 0, total: 12, expiresAt: new Date('2030-01-01'), items: {create: {productId: first.product.id, name: first.product.name, quantity: 1, price: 12}}}});
    await prisma.publicOrder.create({data: {tenantId: second.principal.tenantId, customerName: 'Cliente QA', items: [{productId: second.product.id, quantity: 1, price: 12}]}});
    for (const f of [first, second]) {
      expect((await remove(f.principal, f.product.id)).status).toBe(409);
      expect(await prisma.product.findUnique({where: {id: f.product.id}})).not.toBeNull();
    }
  });

  it('costo/precio editados y desglose de bodega no se pierden aunque el agregado sea cero', async () => {
    const first = await fixture(), second = await fixture();
    await prisma.auditLog.create({data: {tenantId: first.principal.tenantId, userId: first.principal.userId, action: 'PRICE_CHANGED', details: JSON.stringify({productId: first.product.id, priceBefore: '10', priceAfter: '12'})}});
    const warehouse = await prisma.warehouse.create({data: {tenantId: second.principal.tenantId, name: 'Saldo desconectado'}});
    await prisma.productStock.create({data: {tenantId: second.principal.tenantId, productId: second.product.id, warehouseId: warehouse.id, stock: 2}});
    for (const f of [first, second]) {
      expect((await remove(f.principal, f.product.id)).status).toBe(409);
      expect(await prisma.product.findUnique({where: {id: f.product.id}})).not.toBeNull();
    }
  });

  it('la sesión no permite borrar productos ajenos ni a roles no autorizados', async () => {
    const first = await fixture(), second = await fixture();
    expect((await remove(first.principal, second.product.id)).status).toBe(404);
    for (const role of ['BODEGUERO', 'MANAGER', 'CASHIER']) expect((await remove(await actor(first.principal.tenantId, role), first.product.id)).status).toBe(403);
    expect(await prisma.product.findUnique({where: {id: first.product.id}})).not.toBeNull();
    expect(await prisma.product.findUnique({where: {id: second.product.id}})).not.toBeNull();
  });

  it('rechazos concurrentes no borran un ingreso físico que ocurre a la vez', async () => {
    const f = await fixture();
    await asegurarBodegaPorDefecto(prisma, f.principal.tenantId);
    const [response] = await Promise.all([
      remove(f.principal, f.product.id),
      prisma.$transaction(async tx => {
        const stock = await applyStockDelta(tx, {tenantId: f.principal.tenantId, productId: f.product.id, delta: 3, enforceSufficient: false});
        await tx.kardexMovement.create({data: {tenantId: f.principal.tenantId, productId: f.product.id, userId: f.principal.userId, type: 'IN', quantity: 3, stockBefore: stock.stockBefore, stockAfter: stock.stockAfter, warehouseId: stock.warehouseId}});
        await tx.auditLog.create({data: {tenantId: f.principal.tenantId, userId: f.principal.userId, action: 'QA_STOCK_IN', details: JSON.stringify({productId: f.product.id, before: 0, after: 3})}});
      }),
    ]);
    expect(response.status).toBe(409);
    expect(await prisma.product.findUnique({where: {id: f.product.id}})).toMatchObject({stock: 3});
    expect(await prisma.productStock.findFirst({where: {tenantId: f.principal.tenantId, productId: f.product.id}})).toMatchObject({stock: 3});
    expect(await prisma.kardexMovement.count({where: {tenantId: f.principal.tenantId, productId: f.product.id}})).toBe(1);
    expect(await prisma.auditLog.count({where: {tenantId: f.principal.tenantId, action: 'PRODUCT_DELETED'}})).toBe(0);
  });
});
