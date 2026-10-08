// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma.js';
import { acceptCommerceWebhook } from '../backend/services/whatsapp/commerce/inbox.js';
import { claimCommerceInbox, processCommerceInboxOnce } from '../backend/services/whatsapp/commerce/worker.js';
import { dispatchCommerceOutboxOnce, recoverCommerceSending } from '../backend/services/whatsapp/commerce/outbox.js';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
const secret = 'synthetic-commerce-integration-secret';
const waId = '50588889999';
const tenants: string[] = [];
const channels: string[] = [];
let blockedNetwork: ReturnType<typeof vi.spyOn>;

async function seed() {
  const tenantId = `qa-commerce-${randomUUID()}`;
  tenants.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, businessName: 'QA WhatsApp comercial', taxId: tenantId } });
  const channel = await prisma.whatsAppChannel.create({ data: { tenantId, phoneNumberId: String(Math.floor(Math.random() * 9e11 + 1e11)), accessTokenEnc: 'synthetic-never-used', active: true, commerceEnabled: true, commercePolicyVersion: 1, commercePolicy: { eligibleProductIds: [], autoQuote: false, ttlHours: 24, maxTotal: '1000', maxLines: 3, eligibilityAttested: true } } });
  channels.push(channel.id);
  return channel;
}
function payload(phoneNumberId: string, text: string, id = randomUUID(), eventAt = new Date(), from = waId): Buffer {
  return Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id, from, timestamp: String(Math.floor(eventAt.getTime() / 1000)), type: 'text', text: { body: text } }] } }] }] }));
}
function receipts(phoneNumberId: string, messageId: string, status: string, from = waId): Buffer {
  return Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: messageId, recipient_id: from, status }] } }] }] }));
}
async function accept(bytes: Buffer) {
  return acceptCommerceWebhook(bytes, `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`, { db: prisma, appSecret: secret });
}
async function cleanup() {
  await prisma.waCommerceReceipt.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.waCommerceOutbox.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.waCommerceInbox.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.waCommerceConsentEvent.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.waCommerceQuoteDraft.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.waCommerceConversation.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.whatsAppChannel.deleteMany({ where: { id: { in: channels } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  tenants.length = 0; channels.length = 0;
}

qa('WhatsApp comercial durable en MySQL 8 descartable', () => {
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(url.protocol).toBe('mysql:');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    blockedNetwork = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('QA: proveedor externo bloqueado'));
  });
  afterAll(async () => { try { await cleanup(); expect(blockedNetwork).not.toHaveBeenCalled(); } finally { blockedNetwork?.mockRestore(); await prisma.$disconnect(); } });

  it('dedupe estricto, contenido conflictivo, orden del remitente y lastInboundAt monotónico', async () => {
    const channel = await seed();
    const id = randomUUID(), newer = new Date(), older = new Date(newer.getTime() - 10_000);
    const first = payload(channel.phoneNumberId, 'uno', id, newer);
    expect(await accept(first)).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(await accept(first)).toMatchObject({ accepted: 0, duplicates: 1 });
    await expect(accept(payload(channel.phoneNumberId, 'otro', id, newer))).rejects.toMatchObject({ code: 'COMMERCE_MESSAGE_CONFLICT', statusCode: 409 });
    await accept(payload(channel.phoneNumberId, 'anterior', randomUUID(), older));
    const conversation = await prisma.waCommerceConversation.findUniqueOrThrow({ where: { channelId_waId: { channelId: channel.id, waId } } });
    expect(conversation.lastInboundAt.getTime()).toBe(Math.floor(newer.getTime() / 1000) * 1000);
    const claimed = await claimCommerceInbox({ db: prisma });
    expect(claimed?.providerMessageId).toBe(id);
    expect(await claimCommerceInbox({ db: prisma })).toBeNull();
  });

  it('procesa una vez y crea la salida en el mismo commit; timeout de Meta queda UNKNOWN', async () => {
    await cleanup();
    const channel = await seed();
    await accept(payload(channel.phoneNumberId, 'hola'));
    const answer = vi.fn(async () => ({ text: 'Respuesta sintética' }));
    expect(await processCommerceInboxOnce({ db: prisma, answer })).toBe(true);
    expect(answer).toHaveBeenCalledTimes(1);
    const output = await prisma.waCommerceOutbox.findFirstOrThrow({ where: { tenantId: channel.tenantId } });
    expect(output).toMatchObject({ status: 'PENDING', body: 'Respuesta sintética' });
    const sender = vi.fn(async () => { throw new Error('timeout luego de aceptar'); });
    expect(await dispatchCommerceOutboxOnce({ db: prisma, sendingEnabled: true, sender })).toBe(true);
    expect(sender).toHaveBeenCalledTimes(1);
    expect((await prisma.waCommerceOutbox.findUniqueOrThrow({ where: { id: output.id } })).status).toBe('UNKNOWN');
    expect(await dispatchCommerceOutboxOnce({ db: prisma, sendingEnabled: true, sender })).toBe(false);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('receipt anterior al commit de provider ID se reconcilia; FAILED tardío no degrada READ', async () => {
    await cleanup();
    const channel = await seed();
    await accept(payload(channel.phoneNumberId, 'consulta'));
    await processCommerceInboxOnce({ db: prisma, answer: async () => ({ text: 'Respuesta' }) });
    const messageId = `wamid.${randomUUID()}`;
    await accept(receipts(channel.phoneNumberId, messageId, 'read'));
    const sender = vi.fn(async () => messageId);
    expect(await dispatchCommerceOutboxOnce({ db: prisma, sendingEnabled: true, sender })).toBe(true);
    const output = await prisma.waCommerceOutbox.findFirstOrThrow({ where: { tenantId: channel.tenantId } });
    expect(output.status).toBe('READ');
    await accept(receipts(channel.phoneNumberId, messageId, 'failed'));
    expect((await prisma.waCommerceOutbox.findUniqueOrThrow({ where: { id: output.id } })).status).toBe('READ');
    expect(await recoverCommerceSending({ db: prisma })).toBe(0);
  });

  it('un adjunto no soportado queda durable y pasa a atención humana sin consultar catálogo', async () => {
    await cleanup();
    const channel = await seed();
    const bytes = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: channel.phoneNumberId }, messages: [{ id: randomUUID(), from: waId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'image' }] } }] }] }));
    await accept(bytes);
    const answer = vi.fn(async () => ({ text: 'Respuesta prohibida' }));
    expect(await processCommerceInboxOnce({ db: prisma, answer })).toBe(true);
    expect(answer).not.toHaveBeenCalled();
    expect((await prisma.waCommerceConversation.findUniqueOrThrow({ where: { channelId_waId: { channelId: channel.id, waId } } })).status).toBe('HUMAN');
    expect(await prisma.waCommerceInbox.count({ where: { tenantId: channel.tenantId, status: 'DONE' } })).toBe(1);
    expect(await prisma.waCommerceOutbox.count({ where: { tenantId: channel.tenantId } })).toBe(0);
  });

  it('BAJA genera solo su acuse vinculado y cancela otra salida posterior al opt-out', async () => {
    await cleanup();
    const channel = await seed();
    await accept(payload(channel.phoneNumberId, 'BAJA'));
    expect(await processCommerceInboxOnce({ db: prisma })).toBe(true);
    const output = await prisma.waCommerceOutbox.findFirstOrThrow({ where: { tenantId: channel.tenantId } });
    const sender = vi.fn(async () => `wamid.${randomUUID()}`);
    expect(await dispatchCommerceOutboxOnce({ db: prisma, sendingEnabled: true, sender })).toBe(true);
    expect(sender).toHaveBeenCalledTimes(1);
    expect((await prisma.waCommerceOutbox.findUniqueOrThrow({ where: { id: output.id } })).status).toBe('SENT');
    await prisma.waCommerceOutbox.create({ data: { tenantId: channel.tenantId, channelId: channel.id, conversationId: output.conversationId, waId, idempotencyKey: randomUUID(), body: 'Promoción prohibida', policyVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) } });
    expect(await dispatchCommerceOutboxOnce({ db: prisma, sendingEnabled: true, sender })).toBe(true);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(await prisma.waCommerceOutbox.count({ where: { tenantId: channel.tenantId, status: 'CANCELLED' } })).toBe(1);
  });

  it('reasignar el mismo número a otro tenant no reutiliza conversación ni inbox previo', async () => {
    await cleanup();
    const channel = await seed();
    const firstId = randomUUID();
    await accept(payload(channel.phoneNumberId, 'primero', firstId));
    const other = `qa-commerce-${randomUUID()}`;
    tenants.push(other);
    await prisma.tenant.create({ data: { id: other, businessName: 'QA segundo tenant', taxId: other } });
    await prisma.whatsAppChannel.update({ where: { id: channel.id }, data: { tenantId: other } });
    await expect(accept(payload(channel.phoneNumberId, 'segundo'))).rejects.toMatchObject({ code: 'COMMERCE_TENANT_MISMATCH', statusCode: 409 });
    await expect(accept(payload(channel.phoneNumberId, 'primero', firstId))).rejects.toMatchObject({ code: 'COMMERCE_MESSAGE_CONFLICT', statusCode: 409 });
    expect(await prisma.waCommerceInbox.count({ where: { tenantId: other } })).toBe(0);
  });

  it('respuesta genérica vencida se cancela antes de invocar Meta aunque llegue nuevo inbound', async () => {
    await cleanup();
    const channel = await seed();
    await accept(payload(channel.phoneNumberId, 'consulta'));
    await processCommerceInboxOnce({ db: prisma, answer: async () => ({ text: 'Respuesta vieja' }) });
    const output = await prisma.waCommerceOutbox.findFirstOrThrow({ where: { tenantId: channel.tenantId } });
    await prisma.waCommerceOutbox.update({ where: { id: output.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await accept(payload(channel.phoneNumberId, 'consulta nueva'));
    const sender = vi.fn(async () => `wamid.${randomUUID()}`);
    expect(await dispatchCommerceOutboxOnce({ db: prisma, sendingEnabled: true, sender })).toBe(true);
    expect(sender).not.toHaveBeenCalled();
    expect((await prisma.waCommerceOutbox.findUniqueOrThrow({ where: { id: output.id } })).status).toBe('CANCELLED');
  });

  it('respuesta de más de 4096 caracteres nunca se persiste truncada', async () => {
    await cleanup();
    const channel = await seed();
    await accept(payload(channel.phoneNumberId, 'consulta'));
    await processCommerceInboxOnce({ db: prisma, answer: async () => ({ text: 'x'.repeat(4097) }) });
    expect(await prisma.waCommerceOutbox.count({ where: { tenantId: channel.tenantId } })).toBe(0);
    expect(await prisma.waCommerceInbox.count({ where: { tenantId: channel.tenantId, status: 'FAILED', errorCode: 'COMMERCE_BODY_TOO_LONG' } })).toBe(1);
  });

  it('una salida huérfana cancela su PENDING y deja avanzar al sender', async () => {
    await cleanup();
    const channel = await seed();
    const orphan = await prisma.waCommerceOutbox.create({ data: { tenantId: channel.tenantId, channelId: 'missing-channel', conversationId: 'missing-conversation', waId, idempotencyKey: randomUUID(), body: 'No enviar', policyVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) } });
    const sender = vi.fn();
    expect(await dispatchCommerceOutboxOnce({ db: prisma, sendingEnabled: true, sender })).toBe(false);
    expect((await prisma.waCommerceOutbox.findUniqueOrThrow({ where: { id: orphan.id } })).status).toBe('CANCELLED');
    expect(sender).not.toHaveBeenCalled();
  });
  it('callback mixto retorna sólo legacy tras commit y rollback revierte inbox nuevo', async () => {
    await cleanup();
    const commercial=await seed(), legacy=await seed();
    await prisma.whatsAppChannel.update({where:{id:legacy.id},data:{commerceEnabled:false,commercePolicyVersion:0}});
    const merge=(...buffers:Buffer[])=>Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:buffers.flatMap(b=>JSON.parse(b.toString()).entry)}));
    const commercialId=randomUUID();
    const result=await accept(merge(payload(legacy.phoneNumberId,'legacy'),payload(commercial.phoneNumberId,'comercial',commercialId)));
    expect(result.legacyValues).toHaveLength(1);
    expect(result.legacyValues[0].metadata.phone_number_id).toBe(legacy.phoneNumberId);
    expect(await prisma.waCommerceInbox.count({where:{tenantId:legacy.tenantId}})).toBe(0);
    expect(await prisma.waCommerceInbox.count({where:{tenantId:commercial.tenantId}})).toBe(1);
    const freshId=randomUUID();
    await expect(accept(merge(payload(legacy.phoneNumberId,'legacy'),payload(commercial.phoneNumberId,'nuevo',freshId),payload(commercial.phoneNumberId,'contenido cambiado',commercialId)))).rejects.toMatchObject({code:'COMMERCE_MESSAGE_CONFLICT'});
    expect(await prisma.waCommerceInbox.count({where:{providerMessageId:freshId}})).toBe(0);
    expect(await prisma.waCommerceInbox.count({where:{tenantId:commercial.tenantId}})).toBe(1);
  });

  it('canal pausado conserva consulta y receipt durante desactivación sin legacy', async () => {
    await cleanup();
    const channel=await seed();
    await prisma.whatsAppChannel.update({where:{id:channel.id},data:{commerceEnabled:false}});
    const result=await accept(payload(channel.phoneNumberId,'consulta en pausa'));
    expect(result.legacyValues).toHaveLength(0);
    const inbox=await prisma.waCommerceInbox.findFirstOrThrow({where:{tenantId:channel.tenantId}});
    expect(inbox.status).toBe('PENDING');
    const providerMessageId='wamid.'+randomUUID();
    const output=await prisma.waCommerceOutbox.create({data:{tenantId:channel.tenantId,channelId:channel.id,conversationId:inbox.conversationId,waId,idempotencyKey:randomUUID(),body:'respuesta ya aceptada',status:'SENT',providerMessageId,policyVersion:1,expiresAt:new Date(Date.now()+3600000)}});
    await prisma.whatsAppChannel.update({where:{id:channel.id},data:{active:false}});
    await accept(receipts(channel.phoneNumberId,providerMessageId,'delivered'));
    expect((await prisma.waCommerceOutbox.findUniqueOrThrow({where:{id:output.id}})).status).toBe('DELIVERED');
    expect(await prisma.waCommerceReceipt.count({where:{tenantId:channel.tenantId,providerMessageId}})).toBe(1);
  });

});
