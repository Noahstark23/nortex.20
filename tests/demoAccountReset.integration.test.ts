// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { api, assertDisposableDatabase, status, type TestActor } from './fixtures/assistant/integrationHelpers';
import { assistantBudgetTenantId } from '../backend/services/assistant/budgetIdentity';
import { reserveAssistantBudget, settleAssistantBudget, budgetMonth } from '../backend/services/assistant/budget';

const run = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
type Owner = TestActor & { email: string; password: string };
const endpoint = '/api/billing/demo-reset';
async function fixture(role = 'OWNER', ownerProfile = true): Promise<Owner> {
  assertDisposableDatabase();
  const id = randomUUID();
  const tenant = await prisma.tenant.create({ data: {
    businessName: 'QA Demo ' + id, taxId: 'QA-' + id, slug: 'qa-demo-' + id, type: 'RETAIL',
    subscriptionStatus: 'TRIAL', trialEndsAt: new Date(Date.now() + 10 * 86400_000),
    requireCashierPin: true, allowNegativeStock: true, phone: '88880000', address: 'Dirección sintética',
  } });
  const email = 'demo-' + id + '@example.invalid', password = 'Qa-' + randomUUID() + '!';
  const user = await prisma.user.create({ data: { tenantId: tenant.id, email, password: await bcrypt.hash(password, 4), name: 'Dueño QA', role } });
  if (ownerProfile) await prisma.employee.create({ data: { tenantId: tenant.id, userId: user.id, firstName: 'Dueño', lastName: 'QA', role: 'OWNER', pin: '9384', baseSalary: 0 } });
  const login = await api('/api/auth/login', undefined, 'POST', { email, password });
  status(login, 200);
  return { tenantId: tenant.id, userId: user.id, token: login.body.token, role, email, password };
}
async function preview(owner: Owner) {
  const requestKey = randomUUID(), result = await api(endpoint + '/preview', owner, 'POST', { requestKey });
  status(result, 200);
  return result.body as { previewId: string; requestKey: string; counts: any };
}
const confirmation = (owner: Owner, review: any) => ({
  previewId: review.previewId, requestKey: review.requestKey, password: owner.password,
  confirmation: 'REINICIAR', confirmedTestData: true,
});
async function reset(owner: Owner, review: any) { return api(endpoint + '/confirm', owner, 'POST', confirmation(owner, review)); }
async function loginAgain(owner: Owner) {
  const login = await api('/api/auth/login', undefined, 'POST', { email: owner.email, password: owner.password });
  status(login, 200); return login.body;
}
async function ddl(sql: string) {
  assertDisposableDatabase();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema=backend/prisma/schema.prisma'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Falló DDL de QA')));
    child.stdin.end(sql);
  });
}
run('reiniciar demo: HTTP y MySQL descartables', () => {
  beforeAll(assertDisposableDatabase);
  it('el dueño registrado ADMIN tiene la opción; un administrador invitado no', async () => {
    const owner = await fixture('ADMIN');
    expect((await api(endpoint, owner)).body.eligible).toBe(true);
    const invited = await fixture('ADMIN', false);
    expect((await api(endpoint, invited)).body).toMatchObject({ eligible: false, code: 'OWNER_REQUIRED' });
  });
  it.each(['ACTIVE', 'PAST_DUE', 'CANCELLED'])('bloquea la cuenta %s sin tocar sus datos', async subscriptionStatus => {
    const owner = await fixture();
    await prisma.tenant.update({ where: { id: owner.tenantId }, data: { subscriptionStatus } });
    const result = await api(endpoint + '/preview', owner, 'POST', { requestKey: randomUUID() });
    status(result, 409); expect(result.body.code).toBe('DEMO_UNPAID_REQUIRED');
    expect((await prisma.user.findFirstOrThrow({ where: { id: owner.userId, tenantId: owner.tenantId } })).status).toBe('ACTIVE');
  });
  it.each(['PENDING', 'APPROVED'])('bloquea un pago manual %s aunque el estado todavía diga TRIAL', async paymentStatus => {
    const owner = await fixture();
    await prisma.manualPayment.create({ data: { tenantId: owner.tenantId, amount: 20, bank: 'QA', referenceNumber: randomUUID(), status: paymentStatus } });
    expect((await api(endpoint, owner)).body).toMatchObject({ eligible: false, code: 'DEMO_UNPAID_REQUIRED' });
  });
  it('bloquea Stripe y la evidencia de un pago histórico', async () => {
    const stripe = await fixture();
    await prisma.tenant.update({ where: { id: stripe.tenantId }, data: { stripeCustomerId: 'cus_qa_no_real' } });
    expect((await api(endpoint, stripe)).body.eligible).toBe(false);
    const historical = await fixture();
    await prisma.auditLog.create({ data: { tenantId: historical.tenantId, userId: historical.userId, action: 'SUBSCRIPTION_RENEWED' } });
    expect((await api(endpoint, historical)).body.eligible).toBe(false);
  });
  it('revalida un pago registrado después de la revisión', async () => {
    const owner = await fixture(), review = await preview(owner);
    await prisma.manualPayment.create({ data: { tenantId: owner.tenantId, amount: 20, bank: 'QA', referenceNumber: randomUUID(), status: 'APPROVED' } });
    status(await reset(owner, review), 409);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).demoResetArchivedAt).toBeNull();
  });
  it('exige contraseña, declaración de prueba y confirmación exacta', async () => {
    const owner = await fixture(), review = await preview(owner), input = confirmation(owner, review);
    status(await api(endpoint + '/confirm', owner, 'POST', { ...input, confirmedTestData: false }), 400);
    status(await api(endpoint + '/confirm', owner, 'POST', { ...input, confirmation: 'reiniciar' }), 400);
    status(await api(endpoint + '/confirm', owner, 'POST', { ...input, password: 'incorrecta' }), 403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe('ACTIVE');
  });
  it('no acepta tenant del navegador ni permite revisar cuentas ajenas', async () => {
    const owner = await fixture(), other = await fixture(), review = await preview(owner);
    status(await api(endpoint + '/preview', owner, 'POST', { requestKey: randomUUID(), tenantId: other.tenantId }), 400);
    status(await reset(other, { ...review }), 409);
    status(await api(endpoint + '/receipts/' + review.requestKey, other), 404);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).demoResetArchivedAt).toBeNull();
  });
  it('revocación de rol y empleados sin autoridad no pueden reiniciar', async () => {
    const owner = await fixture(), review = await preview(owner);
    await prisma.user.update({ where: { id: owner.userId, tenantId: owner.tenantId }, data: { role: 'CASHIER' } });
    status(await reset(owner, review), 403);
    const employee = await fixture('EMPLOYEE', false);
    status(await api(endpoint, employee), 403);
  });
  it('revisiones vencidas y datos cambiados requieren otra revisión', async () => {
    const owner = await fixture(), review = await preview(owner);
    await prisma.product.create({ data: { tenantId: owner.tenantId, createdBy: owner.userId, name: 'Nuevo', sku: 'QA', price: 1, cost: 0 } });
    const changed = await reset(owner, review); status(changed, 409); expect(changed.body.code).toBe('PREVIEW_CHANGED');
    const other = await fixture(), expired = await preview(other);
    await prisma.demoAccountReset.update({ where: { id: expired.previewId }, data: { expiresAt: new Date(0) } });
    expect((await reset(other, expired)).body.code).toBe('PREVIEW_EXPIRED');
    expect((await api(endpoint + '/receipts/' + expired.requestKey, other)).body.status).toBe('EXPIRED');
  });
  it('reinicia 9 ventas, 176 productos, compras y empleados; conserva acceso, configuración y fecha de prueba', async () => {
    const owner = await fixture(), before = await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } });
    await prisma.product.createMany({ data: Array.from({ length: 176 }, (_, index) => ({ tenantId: owner.tenantId, createdBy: owner.userId, name: 'QA Producto ' + index, sku: 'CDS' + index, price: 55, cost: 39, stock: 80.34, unit: 'lb', saleMode: 'MEASURED', quantityStep: 0.01 })) });
    await prisma.sale.createMany({ data: Array.from({ length: 9 }, () => ({ tenantId: owner.tenantId, soldById: owner.userId, total: 55, status: 'COMPLETED', paymentMethod: 'CASH' })) });
    const supplier = await prisma.supplier.create({ data: { tenantId: owner.tenantId, name: 'QA Proveedor' } });
    await prisma.purchase.create({ data: { tenantId: owner.tenantId, supplierId: supplier.id, invoiceNumber: 'QA', subtotal: 39, total: 39, paymentMethod: 'CASH', createdBy: owner.userId } });
    await prisma.employee.create({ data: { tenantId: owner.tenantId, firstName: 'Empleado', lastName: 'Prueba', role: 'CASHIER', pin: '9284', baseSalary: 0 } });
    const review = await preview(owner); expect(review.counts).toMatchObject({ products: 176, sales: 9, purchases: 1, employees: 2 });
    const applied = await reset(owner, review); status(applied, 200); expect(applied.body).toMatchObject({ status: 'APPLIED', requestKey: review.requestKey, loginRequired: true });
    status(await api('/api/products', owner), 403);
    const login = await loginAgain(owner), next = login.tenant;
    expect(next.id).not.toBe(owner.tenantId);
    const stored = await prisma.tenant.findUniqueOrThrow({ where: { id: next.id } });
    expect(stored).toMatchObject({ businessName: before.businessName, taxId: before.taxId, slug: before.slug, phone: before.phone, address: before.address, requireCashierPin: true, allowNegativeStock: true, trialEndsAt: before.trialEndsAt, createdAt: before.createdAt });
    for (const table of [prisma.sale, prisma.product, prisma.purchase, prisma.supplier, prisma.productStock, prisma.kardexMovement] as any[]) expect(await table.count({ where: { tenantId: next.id } })).toBe(0);
    expect(await prisma.employee.count({ where: { tenantId: next.id } })).toBe(1);
    expect(await prisma.product.count({ where: { tenantId: owner.tenantId } })).toBe(176);
    expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, action: 'DEMO_ACCOUNT_RESET' } })).toBe(1);
    const actor = { ...owner, token: login.token, userId: login.user.id, tenantId: next.id };
    const imported = await api('/api/products/bulk', actor, 'POST', { products: [{ sku: 'CDS001', nombre: 'Pechuga cono', precio: 55, costo: 39, unidad: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', stock: '80.34' }] });
    status(imported, 200); expect(imported.body).toMatchObject({ created: 1, errors: [] });
    expect((await prisma.product.findFirstOrThrow({ where: { tenantId: next.id, sku: 'CDS001' } })).stock).toBe(80.34);
    // Un resultado viejo que termina tarde solo afecta el espacio desactivado.
    await prisma.product.create({ data: { tenantId: owner.tenantId, createdBy: owner.userId, sku: 'TARDIO', name: 'Trabajo anterior', price: 1, cost: 0 } });
    expect(await prisma.product.count({ where: { tenantId: next.id } })).toBe(1);
    // Incluso un alta tardía o una reactivación aislada no abre el espacio archivado.
    await prisma.user.update({ where: { id: owner.userId }, data: { status: 'ACTIVE' } });
    status(await api('/api/products', owner), 403);
    const lateEmail = 'late-' + randomUUID() + '@example.invalid';
    await prisma.user.create({ data: { tenantId: owner.tenantId, email: lateEmail, password: await bcrypt.hash(owner.password, 4), name: 'Invitación en vuelo', role: 'ADMIN' } });
    status(await api('/api/auth/login', undefined, 'POST', { email: lateEmail, password: owner.password }), 403);
  });
  it('dos confirmaciones concurrentes dejan un solo reinicio y un comprobante recuperable', async () => {
    const owner = await fixture(), review = await preview(owner);
    const results = await Promise.all([reset(owner, review), reset(owner, review)]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(await prisma.demoAccountReset.count({ where: { tenantId: owner.tenantId, status: 'APPLIED' } })).toBe(1);
    const receipt = await api(endpoint + '/receipts/' + review.requestKey, owner);
    status(receipt, 200); expect(receipt.body).toMatchObject({ status: 'APPLIED', requestKey: review.requestKey }); expect(receipt.cacheControl).toBe('no-store');
    expect(JSON.stringify(receipt.body)).not.toMatch(/token|password|nextUser/);
  });
  it('desactiva flota propia y enlaces de seguimiento del espacio anterior', async () => {
    const { signPedidoTrackingToken } = await import('../backend/services/secrets');
    const owner = await fixture();
    const driver = await prisma.motorizado.create({ data: { tenantId: owner.tenantId, nombre: 'Repartidor QA', telefono: '89990000', zonaCobertura: 'QA', tipoFlota: 'PROPIA' } });
    const pedido = await prisma.pedido.create({ data: { tenantId: owner.tenantId, motorizadoId: driver.id, clienteNombre: 'Cliente QA', clienteTelefono: '80000000', direccionEntrega: 'QA', total: 0, costoEntrega: 0 } });
    const token = signPedidoTrackingToken(pedido.id, owner.tenantId), path = '/api/v1/pedidos/' + pedido.id + '/tracking';
    status(await api(path, undefined, 'GET', undefined, { 'x-pedido-tracking-token': token }), 200);
    status(await reset(owner, await preview(owner)), 200);
    expect((await prisma.motorizado.findUniqueOrThrow({ where: { id: driver.id } })).activo).toBe(false);
    status(await api(path, undefined, 'GET', undefined, { 'x-pedido-tracking-token': token }), 404);
  });
  it('un pedido de la red de Nortex requiere revisión de plataforma', async () => {
    const owner = await fixture();
    const driver = await prisma.motorizado.create({ data: { nombre: 'Red QA', telefono: '89990001', zonaCobertura: 'QA', tipoFlota: 'NORTEX' } });
    await prisma.pedido.create({ data: { tenantId: owner.tenantId, motorizadoId: driver.id, clienteNombre: 'Cliente QA', clienteTelefono: '80000000', direccionEntrega: 'QA', total: 0, costoEntrega: 0 } });
    expect((await api(endpoint, owner)).body.code).toBe('EXTERNAL_FINANCE_EXISTS');
  });
  it('fallo de auditoría revierte el espacio nuevo, los accesos y el comprobante juntos', async () => {
    const owner = await fixture(), review = await preview(owner), trigger = 'qa_reset_' + randomUUID().replaceAll('-', '');
    await ddl(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.tenantId='${owner.tenantId}' AND NEW.action='DEMO_ACCOUNT_RESET' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='QA rollback'; END IF; END`);
    try {
      status(await reset(owner, review), 500);
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).demoResetArchivedAt).toBeNull();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } }))).toMatchObject({ email: owner.email, status: 'ACTIVE' });
      expect((await prisma.demoAccountReset.findUniqueOrThrow({ where: { id: review.previewId } }))).toMatchObject({ status: 'PREVIEWED', nextTenantId: null });
      status(await api('/api/products', owner), 200);
    } finally { await ddl(`DROP TRIGGER \`${trigger}\``); }
  });
  it('mantiene el presupuesto de IA al reiniciar y en reinicios sucesivos', async () => {
    const owner = await fixture();
    await prisma.assistantTenantConfig.create({ data: { tenantId: owner.tenantId, enabled: true, monthlyBudgetUsd: 2 } });
    const month = budgetMonth(new Date());
    await prisma.assistantBudget.create({ data: { id: 'tenant:' + owner.tenantId + ':' + month, scope: 'tenant:' + owner.tenantId, month, limitUsd: 2, spentUsd: '1.75' } });
    status(await reset(owner, await preview(owner)), 200);
    const login = await loginAgain(owner), principal = { tenantId: login.tenant.id, userId: login.user.id, role: login.user.role };
    expect(await assistantBudgetTenantId(prisma, principal.tenantId)).toBe(owner.tenantId);
    const usage = await reserveAssistantBudget(principal, '0.20', { capability: 'help' });
    await expect(reserveAssistantBudget(principal, '0.20', { capability: 'help' })).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    await settleAssistantBudget(principal, usage.id, { inputTokens: 1000, outputTokens: 1000 });
    expect((await prisma.assistantBudget.findUniqueOrThrow({ where: { id: 'tenant:' + owner.tenantId + ':' + month } })).spentUsd.toString()).toBe('1.756');
    expect(await prisma.assistantBudget.count({ where: { scope: 'tenant:' + principal.tenantId } })).toBe(0);
    const actor = { ...owner, ...principal, token: login.token };
    status(await reset(actor, await preview(actor)), 200);
    expect(await assistantBudgetTenantId(prisma, (await loginAgain(owner)).tenant.id)).toBe(owner.tenantId);
  });
  it('reportar un pago y reiniciar al mismo tiempo no deja una cuenta nueva después de un pago pendiente', async () => {
    const owner = await fixture(), review = await preview(owner);
    const [resetResult, payment] = await Promise.all([
      reset(owner, review),
      api('/api/billing/report-manual', owner, 'POST', { amount: '20', currency: 'USD', bank: 'QA', referenceNumber: randomUUID() }),
    ]);
    expect([resetResult.status, payment.status].filter(code => code === 200)).toHaveLength(1);
    if (resetResult.status === 200) {
      expect([403, 409]).toContain(payment.status);
      expect(await prisma.manualPayment.count({ where: { tenantId: owner.tenantId } })).toBe(0);
    } else {
      status(payment, 200); status(resetResult, 409);
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).demoResetArchivedAt).toBeNull();
    }
  });
  it('cancela invitaciones anteriores y bloquea saldos financieros de plataforma', async () => {
    const owner = await fixture();
    const invitation = await prisma.invitation.create({ data: { tenantId: owner.tenantId, email: 'inv-' + randomUUID() + '@example.invalid', role: 'CASHIER', token: randomUUID(), invitedBy: owner.userId, expiresAt: new Date(Date.now() + 86400_000) } });
    status(await reset(owner, await preview(owner)), 200);
    expect((await prisma.invitation.findFirstOrThrow({ where: { id: invitation.id, tenantId: owner.tenantId } })).status).toBe('CANCELLED');
    const financial = await fixture();
    await prisma.tenant.update({ where: { id: financial.tenantId }, data: { walletBalance: 1 } });
    expect((await api(endpoint, financial)).body).toMatchObject({ eligible: false, code: 'EXTERNAL_FINANCE_EXISTS' });
  });
  it.each(['actual', 'raíz'])('recibo conciliado en cuenta %s impide elegibilidad y preview sin archivar', async location => {
    const owner = await fixture(), root = location === 'raíz' ? await fixture() : owner;
    if (root !== owner) await prisma.tenant.update({ where: { id: owner.tenantId }, data: { demoResetRootId: root.tenantId } });
    await prisma.platformPaymentEvidence.create({ data: { tenantId: root.tenantId, amount: '20.0000', currency: 'USD',
      paidAt: new Date(Date.now() - 2000), reconciledAt: new Date(Date.now() - 1000), evidenceReference: 'QA-' + randomUUID() } });
    expect((await api(endpoint, owner)).body).toMatchObject({ eligible: false, code: 'DEMO_UNPAID_REQUIRED' });
    const response = await api(endpoint + '/preview', owner, 'POST', { requestKey: randomUUID() });
    status(response, 409); expect(response.body.code).toBe('DEMO_UNPAID_REQUIRED');
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).demoResetArchivedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe('ACTIVE');
    expect(await prisma.demoAccountReset.count({ where: { tenantId: owner.tenantId } })).toBe(0);
  });
  it('revalida recibo conciliado que aparece después del preview; confirm no modifica cuenta ni comprobante', async () => {
    const owner = await fixture(), review = await preview(owner);
    await prisma.platformPaymentEvidence.create({ data: { tenantId: owner.tenantId, amount: '20', currency: 'NIO',
      paidAt: new Date(Date.now() - 2000), reconciledAt: new Date(Date.now() - 1000), evidenceReference: 'QA-' + randomUUID() } });
    const response = await reset(owner, review); status(response, 409); expect(response.body.code).toBe('DEMO_UNPAID_REQUIRED');
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).demoResetArchivedAt).toBeNull();
    expect((await prisma.demoAccountReset.findUniqueOrThrow({ where: { id: review.previewId } })).status).toBe('PREVIEWED');
    expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, action: 'DEMO_ACCOUNT_RESET' } })).toBe(0);
  });
  it.each(['referencia vacía', 'pago futuro', 'conciliación futura', 'importe cero'])('no convierte %s en evidencia de cobro', async variant => {
    const owner = await fixture(), past = new Date(Date.now() - 2000), future = new Date(Date.now() + 86400_000);
    await prisma.platformPaymentEvidence.create({ data: { tenantId: owner.tenantId,
      amount: variant === 'importe cero' ? '0' : '20', currency: 'USD', paidAt: variant === 'pago futuro' ? future : past,
      reconciledAt: variant === 'conciliación futura' ? future : past,
      evidenceReference: variant === 'referencia vacía' ? '  ' : 'QA-' + randomUUID() } });
    expect((await api(endpoint, owner)).body.eligible).toBe(true);
    expect((await preview(owner)).previewId).toEqual(expect.any(String));
  });

});
