import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { CommerceError, type CommerceDependencies } from './types.js';
import type { WaChangeValue } from '../types.js';

const waId = z.string().regex(/^[1-9]\d{7,14}$/);
const identifier = z.string().min(1).max(191);
const message = z.object({ id: identifier, from: waId, timestamp: z.string().regex(/^\d{1,12}$/), type: z.string(), text: z.object({ body: z.string().min(1).max(4000) }).optional(), interactive: z.object({ button_reply: z.object({ title: z.string().min(1).max(4000) }).optional(), list_reply: z.object({ title: z.string().min(1).max(4000) }).optional() }).optional() });
const receipt = z.object({ id: identifier, recipient_id: waId, status: z.enum(['sent', 'delivered', 'read', 'failed']) });
const envelope = z.object({ object: z.literal('whatsapp_business_account'), entry: z.array(z.object({ changes: z.array(z.object({ value: z.object({ metadata: z.object({ phone_number_id: z.string().regex(/^\d{5,64}$/) }), messages: z.array(message).max(100).optional(), statuses: z.array(receipt).max(100).optional() }).passthrough() })).max(100) })).max(100) });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const rank: Record<string, number> = { SENDING: 0, UNKNOWN: 0, SENT: 1, FAILED: 1.5, DELIVERED: 2, READ: 3 };

export function verifyCommerceSignature(bytes: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(bytes).digest(), Buffer.from(signature.slice(7), 'hex'));
}

function receiptStatus(status: string): string { return status.toUpperCase(); }

/** Signed status callbacks are retained before ACK, including callbacks preceding the sender's provider ID commit. */
export async function reconcileCommerceReceipts(tx: Prisma.TransactionClient, outbox: { id: string; tenantId: string; channelId: string; waId: string; providerMessageId: string | null; status: string }): Promise<void> {
  if (!outbox.providerMessageId) return;
  // A callback can hold an old snapshot while another receipt commits. Lock a
  // current read before choosing the monotonic transition; do not lose READ to
  // a stale SENT compare-and-set after DELIVERED has already committed.
  const [current] = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT status FROM WaCommerceOutbox
    WHERE id=${outbox.id} AND tenantId=${outbox.tenantId} AND channelId=${outbox.channelId}
      AND waId=${outbox.waId} AND providerMessageId=${outbox.providerMessageId} FOR UPDATE`);
  if (!current) return;
  const receipts = await tx.waCommerceReceipt.findMany({ where: { tenantId: outbox.tenantId, channelId: outbox.channelId, waId: outbox.waId, providerMessageId: outbox.providerMessageId }, orderBy: { createdAt: 'asc' }, take: 100 });
  let next = current.status;
  for (const item of receipts) {
    const candidate = receiptStatus(item.status);
    if ((rank[candidate] ?? -1) > (rank[next] ?? -1)) next = candidate;
  }
  if (next !== current.status) await tx.waCommerceOutbox.updateMany({ where: { id: outbox.id, tenantId: outbox.tenantId, status: current.status }, data: { status: next, errorCode: next === 'FAILED' ? 'META_DELIVERY_FAILED' : null } });
}

/** The caller may acknowledge Meta only after this transaction resolves. */
export async function acceptCommerceWebhook(bytes: Buffer, signature: string | undefined, deps: CommerceDependencies = {}): Promise<{ accepted: number; duplicates: number; receipts: number; legacyValues: WaChangeValue[] }> {
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  const secret = deps.appSecret ?? process.env.WHATSAPP_APP_SECRET ?? '';
  if (!Buffer.isBuffer(bytes) || bytes.length > 256 * 1024) throw new CommerceError('COMMERCE_PAYLOAD', 'Evento excede el límite.', 413);
  if (!verifyCommerceSignature(bytes, signature, secret)) throw new CommerceError('COMMERCE_SIGNATURE', 'Firma inválida.', 401);
  let parsed: z.infer<typeof envelope>;
  try { parsed = envelope.parse(JSON.parse(bytes.toString('utf8'))); } catch { throw new CommerceError('COMMERCE_PAYLOAD', 'Evento inválido.', 400); }
  const values = parsed.entry.flatMap(entry => entry.changes.map(change => change.value));
  if (values.reduce((sum, value) => sum + (value.messages?.length ?? 0) + (value.statuses?.length ?? 0), 0) > 20) throw new CommerceError('COMMERCE_PAYLOAD', 'Demasiados eventos.', 413);
  let accepted = 0, duplicates = 0, receiptCount = 0;
  const legacyValues: WaChangeValue[] = [];
  await db.$transaction(async tx => {
    for (const value of values) {
      const channel = await tx.whatsAppChannel.findUnique({ where: { phoneNumberId: value.metadata.phone_number_id } });
      if (!channel) continue;
      // La versión conserva la propiedad comercial también al pausar la política.
      // Nunca se devuelve ese canal al motor legacy mediante un flag de ejecución.
      const commercial = channel.commerceEnabled || channel.commercePolicyVersion > 0;
      if (!commercial) {
        if (!channel.active) continue;
        legacyValues.push(value as unknown as WaChangeValue);
        for (const item of value.statuses ?? []) {
          await tx.whatsAppMessage.updateMany({ where: { tenantId: channel.tenantId, direction: 'OUT', waMessageId: item.id, conversation: { tenantId: channel.tenantId, waId: item.recipient_id } }, data: { status: item.status } });
        }
        continue;
      }
      // Recibir es durable incluso en pausa; el worker sólo reclama canales habilitados.
      for (const item of channel.active ? value.messages ?? [] : []) {
        const body = item.type === 'text' && item.text?.body ? item.text.body.replace(/\u0000/g, '') : `\u0000UNSUPPORTED:${item.type.slice(0, 40)}`;
        const eventAt = new Date(Number(item.timestamp) * 1000);
        if (!Number.isFinite(eventAt.getTime()) || eventAt.getTime() > now.getTime() + 300_000 || eventAt.getTime() < now.getTime() - 30 * 86_400_000) continue;
        const payloadHash = sha(JSON.stringify([channel.id, item.from, item.id, item.timestamp, item.type, body]));
        const existing = await tx.waCommerceInbox.findUnique({ where: { providerMessageId: item.id } });
        if (existing) {
          if (existing.tenantId !== channel.tenantId || existing.channelId !== channel.id || existing.waId !== item.from || existing.payloadHash !== payloadHash) throw new CommerceError('COMMERCE_MESSAGE_CONFLICT', 'ID externo reutilizado con otro contenido.', 409);
          duplicates++; continue;
        }
        const conversation = await tx.waCommerceConversation.upsert({ where: { channelId_waId: { channelId: channel.id, waId: item.from } }, create: { tenantId: channel.tenantId, channelId: channel.id, waId: item.from, status: channel.defaultMode === 'HUMAN' ? 'HUMAN' : 'BOT', lastInboundAt: eventAt }, update: {} });
        if (conversation.tenantId !== channel.tenantId) throw new CommerceError('COMMERCE_TENANT_MISMATCH', 'La conversación no pertenece al canal actual.', 409);
        await tx.waCommerceConversation.updateMany({ where: { id: conversation.id, tenantId: channel.tenantId, lastInboundAt: { lt: eventAt } }, data: { lastInboundAt: eventAt } });
        try {
          await tx.waCommerceInbox.create({ data: { id: randomUUID(), providerMessageId: item.id, tenantId: channel.tenantId, channelId: channel.id, conversationId: conversation.id, waId: item.from, body, payloadHash, eventAt, availableAt: now } });
          accepted++;
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
          const raced = await tx.waCommerceInbox.findUnique({ where: { providerMessageId: item.id } });
          if (!raced || raced.tenantId !== channel.tenantId || raced.channelId !== channel.id || raced.waId !== item.from || raced.payloadHash !== payloadHash) throw new CommerceError('COMMERCE_MESSAGE_CONFLICT', 'ID externo reutilizado con otro contenido.', 409);
          duplicates++;
        }
      }
      for (const item of value.statuses ?? []) {
        const fingerprint = sha(JSON.stringify([channel.id, item.recipient_id, item.id, item.status]));
        await tx.waCommerceReceipt.createMany({ data: [{ id: randomUUID(), fingerprint, tenantId: channel.tenantId, channelId: channel.id, waId: item.recipient_id, providerMessageId: item.id, status: item.status }], skipDuplicates: true });
        receiptCount++;
        const output = await tx.waCommerceOutbox.findFirst({ where: { tenantId: channel.tenantId, channelId: channel.id, waId: item.recipient_id, providerMessageId: item.id } });
        if (output) await reconcileCommerceReceipts(tx, output);
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return { accepted, duplicates, receipts: receiptCount, legacyValues };
}
