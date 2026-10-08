import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { api, baseUrl, fixture, invoiceEffects, purchaseInput, roleActor, status, type PurchaseFixture } from './fixtures/assistant/integrationHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
let owner: PurchaseFixture;
let other: PurchaseFixture;
function schemaStatement(sql: string) {
  // MySQL no admite CREATE TRIGGER en protocolo prepared: el CLI local usa script SQL.
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'backend/prisma/schema.prisma'],
    { input: sql, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(`No se pudo configurar fallo QA de auditoría: ${result.stderr}`);
}
qa('Compras: autoridad compartida, HTTP y MySQL descartable', () => {
  beforeAll(async () => { owner = await fixture(); other = await fixture(); }, 120_000);

  it('reintentar tras perder respuesta recupera una sola compra, stock, asiento y auditoría', async () => {
    const body = purchaseInput(owner); const key = randomUUID();
    const before = await invoiceEffects(owner, body.invoiceNumber);
    const first = await api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': key }); status(first, 200);
    const replay = await api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': key }); status(replay, 200);
    expect(replay.body.purchase.id).toBe(first.body.purchase.id);
    const effects = await invoiceEffects(owner, body.invoiceNumber);
    expect(effects.purchases).toHaveLength(1); expect(effects.stock - before.stock).toBe(2);
    expect(effects.kardex - before.kardex).toBe(1); expect(effects.commands).toBe(1);
    expect(effects.purchases[0].total.toFixed(2)).toBe('23.00');
    expect(effects.purchases[0].balanceDue.toFixed(2)).toBe('23.00');
    expect(await prisma.journalEntry.count({ where: { tenantId: owner.tenantId, referenceId: first.body.purchase.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, details: { contains: first.body.purchase.id } } })).toBe(1);
  });

  it('dos confirmaciones concurrentes retornan el mismo comprobante', async () => {
    const body = purchaseInput(owner); const key = randomUUID(); const before = await invoiceEffects(owner, body.invoiceNumber);
    const requests = await Promise.all([1, 2].map(() => api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': key })));
    requests.forEach(result => status(result, 200));
    expect(requests[0].body.purchase.id).toBe(requests[1].body.purchase.id);
    const effects = await invoiceEffects(owner, body.invoiceNumber);
    expect(effects.stock - before.stock).toBe(2); expect(effects.purchases).toHaveLength(1);
  });

  it('recibir seis y cerrar cuatro permite facturar seis sin duplicar existencias', async () => {
    const draft = await api('/api/purchase-orders', owner, 'POST', { supplierId: owner.supplierId,
      items: [{ productId: owner.productId, quantity: '10', unitCost: '1.234567' }] }, { 'Idempotency-Key': randomUUID() });
    status(draft, 201); const po = draft.body.data; const itemId = po.items[0].id;
    status(await api(`/api/purchase-orders/${po.id}/approve`, owner, 'POST'), 200);
    status(await api(`/api/purchase-orders/${po.id}/receive`, owner, 'POST', { clientEventId: randomUUID(), warehouseId: owner.warehouseId,
      items: [{ itemId, quantityReceived: '6' }] }), 200);
    const closed = await api(`/api/purchase-orders/${po.id}/close-short`, owner, 'POST', { clientEventId: randomUUID(),
      items: [{ itemId, quantity: '4', reasonCode: 'SUPPLIER_SHORTAGE', supplierFault: true }] });
    status(closed, 200);
    expect((await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: owner.tenantId, id: po.id } })).status).toBe('CLOSED_SHORT');
    const body = purchaseInput(owner, { purchaseOrderId: po.id, items: [{ productId: owner.productId, purchaseOrderItemId: itemId, quantity: '6', unitCost: '1.234567', purchaseUnit: 'BASE' }] });
    const before = await invoiceEffects(owner, body.invoiceNumber);
    const invoice = await api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': randomUUID() }); status(invoice, 200);
    const after = await invoiceEffects(owner, body.invoiceNumber);
    expect(after.stock).toBe(before.stock); expect(after.kardex).toBe(before.kardex);
    expect(after.purchases).toHaveLength(1); expect(after.purchases[0].total.toFixed(2)).toBe('8.52');
    const persisted = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: invoice.body.purchase.id, purchase: { tenantId: owner.tenantId } } });
    expect(persisted.unitCostExact?.toFixed(6)).toBe('1.234567');
    expect(persisted.quantityExact?.toFixed(4)).toBe('6.0000');
    status(await api('/api/purchases', owner, 'POST', { ...body, invoiceNumber: `OVER-${randomUUID()}` }), 400);
  });

  it('una clave reutilizada con otro contenido y otra clave con la misma factura no duplican', async () => {
    const body = purchaseInput(owner); const key = randomUUID();
    status(await api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': key }), 200);
    status(await api('/api/purchases', owner, 'POST', { ...body, notes: 'contenido distinto' }, { 'Idempotency-Key': key }), 409);
    status(await api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': randomUUID() }), 409);
    expect((await invoiceEffects(owner, body.invoiceNumber)).purchases).toHaveLength(1);
  });

  it('impide proveedor/producto ajeno, caja sin permisos y sesión revocada', async () => {
    const cashier = await roleActor(owner, 'CASHIER'); const body = purchaseInput(owner);
    status(await api('/api/purchases', cashier, 'POST', body), 403);
    status(await api('/api/purchases', owner, 'POST', { ...body, supplierId: other.supplierId }), 404);
    status(await api('/api/purchases', owner, 'POST', { ...body, items: [{ productId: other.productId, quantity: '2', unitCost: '10' }] }), 404);
    const manager = await roleActor(owner, 'MANAGER');
    await prisma.user.update({ where: { id: manager.userId }, data: { status: 'DISABLED' } });
    expect([401, 403]).toContain((await api('/api/purchases', manager, 'POST', body)).status);
    expect((await invoiceEffects(owner, body.invoiceNumber)).purchases).toHaveLength(0);
  });

  it('período fiscal cerrado revierte compra, stock, Kardex y reserva idempotente', async () => {
    const body = purchaseInput(owner, { postingDate: '2031-01-05' }); const key = randomUUID();
    const before = await invoiceEffects(owner, body.invoiceNumber);
    await prisma.fiscalPeriod.create({ data: { tenantId: owner.tenantId, year: 2031, month: 1, status: 'CLOSED' } });
    status(await api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': key }), 423);
    const after = await invoiceEffects(owner, body.invoiceNumber);
    expect(after.stock).toBe(before.stock); expect(after.kardex).toBe(before.kardex); expect(after.purchases).toHaveLength(0);
    expect(await prisma.purchaseCommand.count({ where: { tenantId: owner.tenantId, requestKey: key } })).toBe(0);
  });

  it('fallo real de auditoría en MySQL revierte todos los efectos antes de responder', async () => {
    const body = purchaseInput(owner); const key = randomUUID(); const before = await invoiceEffects(owner, body.invoiceNumber);
    const trigger = `qa_assistant_audit_${randomUUID().replaceAll('-', '')}`;
    // Sólo IDs generados por la fixture; la guardia de DB corre antes de crear el tenant.
    schemaStatement(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`AuditLog\` FOR EACH ROW SET NEW.action = IF(NEW.tenantId = '${owner.tenantId}', NULL, NEW.action);`);
    try {
      status(await api('/api/purchases', owner, 'POST', body, { 'Idempotency-Key': key }), 500);
      const after = await invoiceEffects(owner, body.invoiceNumber);
      expect(after.stock).toBe(before.stock); expect(after.kardex).toBe(before.kardex); expect(after.purchases).toHaveLength(0);
      expect(await prisma.purchaseCommand.count({ where: { tenantId: owner.tenantId, requestKey: key } })).toBe(0);
    } finally { schemaStatement(`DROP TRIGGER IF EXISTS \`${trigger}\`;`); }
  });
});
