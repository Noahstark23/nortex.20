// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma.js';
import { updateCommercePolicy } from '../backend/services/whatsapp/commerce/policy.js';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
const tenantIds: string[] = [];
let network: ReturnType<typeof vi.spyOn>;

const policy = (eligibleProductIds: string[]) => ({
  eligibleProductIds,
  autoQuote: false,
  ttlHours: 24,
  maxTotal: '5000.00',
  maxLines: 5,
  eligibilityAttested: true,
});

async function seed(type = 'FERRETERIA') {
  const tenantId = `qa-wa-policy-${randomUUID()}`;
  tenantIds.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, businessName: `QA ${type}`, taxId: tenantId, type } });
  const user = await prisma.user.create({ data: { tenantId, email: `qa-${randomUUID()}@example.invalid`, password: 'SYNTHETIC-NOT-A-CREDENTIAL', name: 'QA Policy Owner', role: 'OWNER' } });
  const channel = await prisma.whatsAppChannel.create({ data: { tenantId, phoneNumberId: String(BigInt('100000000000') + BigInt(Math.floor(Math.random() * 900000000000))), accessTokenEnc: 'SYNTHETIC-NO-TOKEN' } });
  const product = await prisma.product.create({ data: { tenantId, name: 'Martillo sintético', sku: `QA-${randomUUID()}`, price: 100, cost: 50, stock: 10, unit: 'unidad', createdBy: user.id, isPublished: true } });
  return { tenantId, principal: { tenantId, userId: user.id, role: 'OWNER' }, channel, product, user };
}

async function cleanup() {
  if (!tenantIds.length) return;
  const where = { tenantId: { in: tenantIds } };
  await prisma.waCommerceReceipt.deleteMany({ where });
  await prisma.waCommerceOutbox.deleteMany({ where });
  await prisma.waCommerceInbox.deleteMany({ where });
  await prisma.waCommerceConsentEvent.deleteMany({ where });
  await prisma.waCommerceQuoteDraft.deleteMany({ where });
  await prisma.waCommerceConversation.deleteMany({ where });
  await prisma.waCommercePolicyVersion.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { ...where, action: 'WHATSAPP_COMMERCE_POLICY' } });
  await prisma.product.deleteMany({ where });
  await prisma.whatsAppChannel.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  tenantIds.length = 0;
}

qa('Política de WhatsApp comercial: límites en MySQL 8 descartable', () => {
  beforeAll(() => {
    expect(process.env.NORTEX_QA_DATABASE_ACK).toBe('disposable-database');
    const url = new URL(process.env.DATABASE_URL!);
    expect(url.protocol).toBe('mysql:');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('QA: red externa bloqueada'));
  });
  afterEach(cleanup);
  afterAll(async () => { try { expect(network).not.toHaveBeenCalled(); } finally { network?.mockRestore(); await prisma.$disconnect(); } });

  it.each(['FARMACIA', 'RETAIL'])('rechaza activar un negocio %s aunque su SKU esté publicado', async type => {
    const fixture = await seed(type);
    await expect(updateCommercePolicy(fixture.principal, fixture.channel.id, { expectedVersion: 0, enabled: true, policy: policy([fixture.product.id]) }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_POLICY', statusCode: 409 });
    expect(await prisma.whatsAppChannel.findUniqueOrThrow({ where: { id: fixture.channel.id }, select: { commerceEnabled: true, commercePolicyVersion: true } })).toEqual({ commerceEnabled: false, commercePolicyVersion: 0 });
    expect(await prisma.waCommercePolicyVersion.count({ where: { channelId: fixture.channel.id } })).toBe(0);
  });

  it('rechaza SKU ajeno, oculto, con lote o serie y acepta solo el publicado elegible', async () => {
    const fixture = await seed();
    const other = await seed();
    const makeProduct = (name: string, flags: Record<string, boolean>) => prisma.product.create({ data: { tenantId: fixture.tenantId, name, sku: `QA-${randomUUID()}`, price: 10, cost: 5, stock: 2, createdBy: fixture.user.id, ...flags } });
    const hidden = await makeProduct('Oculto sintético', { isPublished: false });
    const batch = await makeProduct('Lote sintético', { isPublished: true, requiresBatchTracking: true });
    const serial = await makeProduct('Serie sintética', { isPublished: true, requiresSerialTracking: true });
    for (const productId of [other.product.id, hidden.id, batch.id, serial.id]) {
      await expect(updateCommercePolicy(fixture.principal, fixture.channel.id, { expectedVersion: 0, enabled: true, policy: policy([productId]) }, prisma)).rejects.toMatchObject({ code: 'COMMERCE_PRODUCTS', statusCode: 409 });
    }
    const enabled = await updateCommercePolicy(fixture.principal, fixture.channel.id, { expectedVersion: 0, enabled: true, policy: policy([fixture.product.id]) }, prisma);
    expect(enabled).toMatchObject({ commerceEnabled: true, commercePolicyVersion: 1 });
    const record = await prisma.waCommercePolicyVersion.findUniqueOrThrow({ where: { channelId_version: { channelId: fixture.channel.id, version: 1 } } });
    expect(record).toMatchObject({ tenantId: fixture.tenantId, enabled: true, approvedBy: fixture.user.id });
    expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenantId, action: 'WHATSAPP_COMMERCE_POLICY' } })).toBe(1);
  });

  it('solo una edición concurrente gana la versión esperada', async () => {
    const fixture = await seed();
    const input = { expectedVersion: 0, enabled: true, policy: policy([fixture.product.id]) };
    const outcomes = await Promise.allSettled([
      updateCommercePolicy(fixture.principal, fixture.channel.id, input, prisma),
      updateCommercePolicy(fixture.principal, fixture.channel.id, input, prisma),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'COMMERCE_VERSION', statusCode: 409 } });
    expect(await prisma.waCommercePolicyVersion.count({ where: { channelId: fixture.channel.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenantId, action: 'WHATSAPP_COMMERCE_POLICY' } })).toBe(1);
    expect(await prisma.whatsAppChannel.findUniqueOrThrow({ where: { id: fixture.channel.id }, select: { commerceEnabled: true, commercePolicyVersion: true } })).toEqual({ commerceEnabled: true, commercePolicyVersion: 1 });
  });

  it('deshabilitar cancela salidas pendientes sin reinterpretar un envío ya iniciado', async () => {
    const fixture = await seed();
    await updateCommercePolicy(fixture.principal, fixture.channel.id, { expectedVersion: 0, enabled: true, policy: policy([fixture.product.id]) }, prisma);
    const conversation = await prisma.waCommerceConversation.create({ data: { tenantId: fixture.tenantId, channelId: fixture.channel.id, waId: '50588889999', lastInboundAt: new Date() } });
    const expiry = new Date(Date.now() + 3_600_000);
    const pending = await prisma.waCommerceOutbox.create({ data: { tenantId: fixture.tenantId, channelId: fixture.channel.id, conversationId: conversation.id, waId: conversation.waId, idempotencyKey: randomUUID(), body: 'Respuesta pendiente sintética', policyVersion: 1, expiresAt: expiry } });
    const sending = await prisma.waCommerceOutbox.create({ data: { tenantId: fixture.tenantId, channelId: fixture.channel.id, conversationId: conversation.id, waId: conversation.waId, idempotencyKey: randomUUID(), body: 'Salida incierta sintética', policyVersion: 1, status: 'SENDING', leaseToken: randomUUID(), leaseUntil: expiry, expiresAt: expiry } });
    const disabled = await updateCommercePolicy(fixture.principal, fixture.channel.id, { expectedVersion: 1, enabled: false, policy: policy([fixture.product.id]) }, prisma);
    expect(disabled).toMatchObject({ commerceEnabled: false, commercePolicyVersion: 2 });
    expect(await prisma.waCommerceOutbox.findUniqueOrThrow({ where: { id: pending.id }, select: { status: true, errorCode: true } })).toEqual({ status: 'CANCELLED', errorCode: 'POLICY_CHANGED' });
    expect((await prisma.waCommerceOutbox.findUniqueOrThrow({ where: { id: sending.id }, select: { status: true } })).status).toBe('SENDING');
    expect(await prisma.waCommercePolicyVersion.count({ where: { channelId: fixture.channel.id } })).toBe(2);
  });
});
