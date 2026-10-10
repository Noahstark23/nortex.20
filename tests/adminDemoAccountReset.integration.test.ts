// @vitest-environment node
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { api, assertDisposableDatabase, status, type TestActor } from './fixtures/assistant/integrationHelpers';
const run = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
type Actor = TestActor & { email: string; password: string };
async function fixture(role = 'OWNER', active = false): Promise<Actor> {
  const id = randomUUID();
  const tenant = await prisma.tenant.create({ data: { businessName: 'QA Reinicio ' + id, taxId: 'QA-' + id,
    subscriptionStatus: active ? 'ACTIVE' : 'TRIAL', trialEndsAt: new Date(Date.now() + 86400_000),
    subscriptionEndsAt: active ? new Date(Date.now() + 86400_000 * 20) : null } });
  const email = id + '@example.invalid', password = 'Qa-' + randomUUID() + '!';
  const user = await prisma.user.create({ data: { tenantId: tenant.id, email, password: await bcrypt.hash(password, 4), role, assistantBudgetOwner: role === 'OWNER', name: 'QA Dueño' } });
  if (role === 'OWNER') await prisma.employee.create({ data: { tenantId: tenant.id, userId: user.id, firstName: 'QA', lastName: 'Dueño', role: 'OWNER', pin: '9421', baseSalary: 0 } });
  const login = await api('/api/auth/login', undefined, 'POST', { email, password }); status(login, 200);
  return { tenantId: tenant.id, userId: user.id, role, email, password, token: login.body.token };
}
const path = (owner: Actor) => '/api/admin/demo-reset/' + owner.tenantId;
async function preview(admin: Actor, owner: Actor) {
  const r = await api(path(owner) + '/preview', admin, 'POST', { ownerId: owner.userId, requestKey: randomUUID() }); status(r, 200); return r.body;
}
const body = (admin: Actor, owner: Actor, p: any) => ({ ownerId: owner.userId, previewId: p.previewId, requestKey: p.requestKey,
  password: admin.password, confirmation: 'REINICIAR', confirmedTestData: true, confirmedUnpaid: true });
const confirm = (admin: Actor, owner: Actor, p: any) => api(path(owner) + '/confirm', admin, 'POST', body(admin, owner, p));
const receipt = (admin: Actor, owner: Actor, p: any) => api(path(owner) + '/receipts/' + p.requestKey, admin);
const rows = [{ sku: 'CDS001', nombre: 'Pechuga cono', precio: 55, costo: 39, unidad: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', stock: '80.34' }];
const upload = (admin: Actor, owner: Actor, p: any, products = rows, warehouseId?: string) => api(path(owner) + '/receipts/' + p.requestKey + '/products', admin, 'POST', { products, ...(warehouseId ? { warehouseId } : {}) });
run('Reinicio asistido desde administración', () => {
  beforeAll(assertDisposableDatabase);
  it('publica la revisión administrativa con empresa y dueño exactos', async () => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture('OWNER', true);
    const p = await preview(admin, owner); expect(p.ownerEmail).toBe(owner.email); expect(p.counts.products).toBe(0);
  });
  it('archiva 10 ventas y 176 productos, conserva acceso/periodo y audita al administrador real', async () => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture('OWNER', true);
    await prisma.auditLog.create({ data: { tenantId: owner.tenantId, userId: admin.userId, action: 'ADMIN_REACTIVATE' } });
    const channel = await prisma.whatsAppChannel.create({ data: { tenantId: owner.tenantId, phoneNumberId: randomUUID(), accessTokenEnc: 'synthetic-only-not-a-token' } });
    await prisma.product.createMany({ data: Array.from({ length: 176 }, (_, i) => ({ tenantId: owner.tenantId, createdBy: owner.userId, sku: 'QA' + i, name: 'Prueba', price: 1, cost: 0 })) });
    await prisma.sale.createMany({ data: Array.from({ length: 10 }, () => ({ tenantId: owner.tenantId, soldById: owner.userId, total: 0, status: 'COMPLETED', paymentMethod: 'CASH' })) });
    const before = await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } }), p = await preview(admin, owner);
    expect(p.counts).toMatchObject({ products: 176, sales: 10 }); status(await confirm(admin, owner, p), 200);
    const login = await api('/api/auth/login', undefined, 'POST', { email: owner.email, password: owner.password }); status(login, 200);
    const next = await prisma.tenant.findUniqueOrThrow({ where: { id: login.body.tenant.id } });
    expect(next).toMatchObject({ businessName: before.businessName, taxId: before.taxId, subscriptionStatus: 'ACTIVE', trialEndsAt: before.trialEndsAt, subscriptionEndsAt: before.subscriptionEndsAt, demoResetRootId: before.id });
    expect((await prisma.user.findFirstOrThrow({ where: { tenantId: next.id, email: owner.email } })).assistantBudgetOwner).toBe(true);
    expect(await prisma.product.count({ where: { tenantId: next.id } })).toBe(0);
    expect(await prisma.sale.count({ where: { tenantId: owner.tenantId } })).toBe(10);
    expect(await prisma.product.count({ where: { tenantId: owner.tenantId } })).toBe(176);
    expect((await prisma.whatsAppChannel.findUniqueOrThrow({ where: { id: channel.id } })).active).toBe(false);
    expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, userId: admin.userId, action: 'DEMO_ACCOUNT_RESET' } })).toBe(1);
    status(await api('/api/products', owner), 403); status(await api('/api/admin/tenants', admin), 200);
    const r = await receipt(admin, owner, p); status(r, 200); expect(r.cacheControl).toBe('no-store'); expect(r.body.warehouses).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toMatch(/password|token/);
  });
  it.each(['OWNER', 'ADMIN', 'CASHIER'])('rechaza %s incluso con empresa ajena conocida', async role => {
    const actor = await fixture(role), owner = await fixture();
    status(await api(path(owner) + '/preview', actor, 'POST', { requestKey: randomUUID(), ownerId: owner.userId }), 403);
  });
  it.each(['PENDING', 'APPROVED'])('bloquea pago %s y no cambia la cuenta', async paymentStatus => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture('OWNER', true);
    await prisma.manualPayment.create({ data: { tenantId: owner.tenantId, amount: 20, bank: 'QA', referenceNumber: randomUUID(), status: paymentStatus } });
    const r = await api(path(owner) + '/preview', admin, 'POST', { ownerId: owner.userId, requestKey: randomUUID() }); status(r, 409); expect(r.body.code).toBe('DEMO_UNPAID_REQUIRED');
  });
  it.each(['stripe', 'paid-audit', 'wallet'])('bloquea evidencia %s después de revisar', async kind => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture('OWNER', true), p = await preview(admin, owner);
    if (kind === 'stripe') await prisma.tenant.update({ where: { id: owner.tenantId }, data: { stripeCustomerId: 'cus_qa' } });
    if (kind === 'paid-audit') await prisma.auditLog.create({ data: { tenantId: owner.tenantId, userId: admin.userId, action: 'SUBSCRIPTION_ACTIVATED' } });
    if (kind === 'wallet') await prisma.tenant.update({ where: { id: owner.tenantId }, data: { walletBalance: 1 } });
    status(await confirm(admin, owner, p), 409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).email).toBe(owner.email);
  });
  it('requiere la contraseña del administrador, ambas declaraciones y dueño exacto', async () => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture(), other = await fixture(), p = await preview(admin, owner);
    status(await api(path(owner) + '/confirm', admin, 'POST', { ...body(admin, owner, p), password: owner.password }), 403);
    status(await api(path(owner) + '/confirm', admin, 'POST', { ...body(admin, owner, p), confirmedUnpaid: false }), 400);
    status(await api(path(owner) + '/confirm', admin, 'POST', { ...body(admin, owner, p), ownerId: other.userId }), 403);
  });
  it('invalida revisión si cambia dueño, ventas o permisos', async () => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture(), p = await preview(admin, owner);
    await prisma.user.update({ where: { id: owner.userId }, data: { email: randomUUID() + '@example.invalid' } });
    expect((await confirm(admin, owner, p)).body.code).toBe('PREVIEW_CHANGED');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
    status(await confirm(admin, owner, p), 403);
  });
  it('confirmaciones simultáneas aplican una vez; recibos no se comparten con otro administrador', async () => {
    const admin = await fixture('SUPER_ADMIN'), other = await fixture('SUPER_ADMIN'), owner = await fixture(), p = await preview(admin, owner);
    const results = await Promise.all([confirm(admin, owner, p), confirm(admin, owner, p)]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    status(await receipt(admin, owner, p), 200); status(await receipt(other, owner, p), 404);
    expect(await prisma.demoAccountReset.count({ where: { tenantId: owner.tenantId, status: 'APPLIED' } })).toBe(1);
  });
  it('importa por el servicio real y reintentos simultáneos no duplican producto ni stock', async () => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture(), p = await preview(admin, owner); status(await confirm(admin, owner, p), 200);
    const r = await receipt(admin, owner, p), warehouseId = r.body.warehouses[0].id;
    const results = await Promise.all([upload(admin, owner, p, rows, warehouseId), upload(admin, owner, p, rows, warehouseId)]);
    for (const result of results) { status(result, 200); expect(result.body).toMatchObject({ created: 1, errors: [] }); }
    expect(results.reduce((n, r) => n + r.body.alreadyApplied, 0)).toBe(1);
    const reset = await prisma.demoAccountReset.findUniqueOrThrow({ where: { id: p.previewId } });
    const product = await prisma.product.findFirstOrThrow({ where: { tenantId: reset.nextTenantId!, sku: 'CDS001' } });
    expect(product).toMatchObject({ stock: 80.34, price: 55, cost: 39, createdBy: admin.userId }); expect(product.quantityStep!.toString()).toBe('0.01');
    expect(await prisma.kardexMovement.count({ where: { tenantId: reset.nextTenantId!, productId: product.id } })).toBe(1);
    const changed = await upload(admin, owner, p, [{ ...rows[0], stock: '81' }], warehouseId); expect(changed.body.errors).toHaveLength(1);
    expect((await receipt(admin, owner, p)).body.imported).toBe(1);
    expect(await prisma.product.count({ where: { tenantId: admin.tenantId } })).toBe(0);
  });
  it('bloquea importación previa al reinicio y bodega ajena sin cambios parciales', async () => {
    const admin = await fixture('SUPER_ADMIN'), owner = await fixture(), p = await preview(admin, owner);
    expect((await upload(admin, owner, p)).body.errors).toHaveLength(1);
    status(await confirm(admin, owner, p), 200);
    const result = await upload(admin, owner, p, rows, 'bodega-ajena'); expect(result.body.errors).toHaveLength(1);
    const reset = await prisma.demoAccountReset.findUniqueOrThrow({ where: { id: p.previewId } });
    expect(await prisma.product.count({ where: { tenantId: reset.nextTenantId! } })).toBe(0);
    expect(await prisma.demoResetImportRow.count({ where: { resetId: reset.id } })).toBe(0);
  });
});
