import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { CommerceError, type CommerceDependencies } from './types.js';
import { handleCommerceMessage } from './conversation.js';

export const COMMERCE_INBOX_LEASE_MS = 300_000;

/** One sender head at a time. Later messages never overtake a live lease. */
export async function claimCommerceInbox(deps: CommerceDependencies = {}) {
  const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
  const candidates = await db.$queryRaw<Array<{ id: string; conversationId: string; channelId: string; tenantId: string }>>(Prisma.sql`
    SELECT i.id, i.conversationId, i.channelId, i.tenantId FROM WaCommerceInbox i
    INNER JOIN WhatsAppChannel c ON c.id=i.channelId AND c.tenantId=i.tenantId
    WHERE c.active=true AND c.commerceEnabled=true AND ((i.status='PENDING' AND i.availableAt<=${now}) OR (i.status='PROCESSING' AND i.leaseUntil<=${now}))
      AND NOT EXISTS (SELECT 1 FROM WaCommerceInbox older WHERE older.conversationId=i.conversationId
        AND older.status IN ('PENDING','PROCESSING') AND older.sequence<i.sequence)
    ORDER BY i.sequence ASC LIMIT 20`);
  for (const candidate of candidates) {
    const claimed = await db.$transaction(async tx => {
      // Mismo orden que procesamiento/política: canal antes de inbox. Pausa no consume trabajo.
      const channelLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WhatsAppChannel
        WHERE id=${candidate.channelId} AND tenantId=${candidate.tenantId} FOR UPDATE`);
      if (!channelLock.length || !await tx.whatsAppChannel.findFirst({ where: { id: candidate.channelId, tenantId: candidate.tenantId, active: true, commerceEnabled: true }, select: { id: true } })) return null;
      const first = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WaCommerceInbox
        WHERE conversationId=${candidate.conversationId} AND status IN ('PENDING','PROCESSING')
        ORDER BY sequence ASC LIMIT 1 FOR UPDATE`);
      if (first[0]?.id !== candidate.id) return null;
      const leaseToken = randomUUID();
      const changed = await tx.waCommerceInbox.updateMany({ where: { id: candidate.id, OR: [{ status: 'PENDING', availableAt: { lte: now } }, { status: 'PROCESSING', leaseUntil: { lte: now } }] }, data: { status: 'PROCESSING', leaseToken, leaseUntil: new Date(now.getTime() + COMMERCE_INBOX_LEASE_MS), attempts: { increment: 1 } } });
      return changed.count === 1 ? tx.waCommerceInbox.findUnique({ where: { id: candidate.id } }) : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (claimed) return claimed;
  }
  return null;
}

/** Deterministic domain answer and inbox/outbox commit share a short transaction. */
export async function processCommerceInboxOnce(deps: CommerceDependencies = {}): Promise<boolean> {
  const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
  const row = await claimCommerceInbox(deps);
  if (!row) return false;
  try {
    await db.$transaction(async tx => {
      const channelLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WhatsAppChannel WHERE id=${row.channelId} FOR UPDATE`);
      if (!channelLock.length) throw new CommerceError('COMMERCE_CHANNEL_MISSING', 'Canal inexistente.', 403);
      const channel = await tx.whatsAppChannel.findFirst({ where: { id: row.channelId, tenantId: row.tenantId, active: true, commerceEnabled: true } });
      if (!channel) throw new CommerceError('COMMERCE_CHANNEL_DISABLED', 'Canal deshabilitado.', 403);
      const conversationLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WaCommerceConversation WHERE id=${row.conversationId} AND channelId=${row.channelId} AND tenantId=${row.tenantId} FOR UPDATE`);
      if (!conversationLock.length) throw new CommerceError('COMMERCE_CONVERSATION_MISSING', 'Conversación inexistente.', 403);
      const conversation = await tx.waCommerceConversation.findFirst({ where: { id: row.conversationId, tenantId: row.tenantId, channelId: row.channelId, waId: row.waId } });
      if (!conversation) throw new CommerceError('COMMERCE_CONVERSATION_MISSING', 'Conversación no corresponde.', 403);
      const active = { id: row.id, tenantId: row.tenantId, status: 'PROCESSING', leaseToken: row.leaseToken, leaseUntil: { gt: now } };
      const unsupported = row.body.startsWith('\u0000UNSUPPORTED:');
      if (unsupported) await tx.waCommerceConversation.updateMany({ where: { id: conversation.id, tenantId: row.tenantId }, data: { status: 'HUMAN', version: { increment: 1 } } });
      const answer = deps.answer ?? handleCommerceMessage;
      const result = unsupported ? { text: null } : await answer(tx, row, conversation, channel, now);
      const current = await tx.waCommerceInbox.updateMany({ where: active, data: { status: 'DONE', leaseToken: null, leaseUntil: null, errorCode: null } });
      if (current.count !== 1) throw new CommerceError('COMMERCE_LEASE_LOST', 'Lease vencido.', 409);
      if (result.text) {
        if (result.text.length > 4096) throw new CommerceError('COMMERCE_BODY_TOO_LONG', 'Respuesta supera el límite de WhatsApp.', 422);
        await tx.waCommerceOutbox.create({ data: { id: randomUUID(), idempotencyKey: row.id, tenantId: row.tenantId, channelId: row.channelId, conversationId: row.conversationId, waId: row.waId, body: result.text, policyVersion: channel.commercePolicyVersion, expiresAt: new Date(row.eventAt.getTime() + 23 * 3_600_000) } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 5000 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'COMMERCE_PROCESSING_FAILED';
    const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 503;
    // Puede pausarse entre claim y procesamiento; devolver la misma entrada sin gastar intento.
    const paused = code === 'COMMERCE_CHANNEL_DISABLED';
    const retry = paused || status >= 500 && row.attempts < 3;
    await db.waCommerceInbox.updateMany({ where: { id: row.id, tenantId: row.tenantId, status: 'PROCESSING', leaseToken: row.leaseToken }, data: { status: retry ? 'PENDING' : 'FAILED', leaseToken: null, leaseUntil: null, errorCode: code.slice(0, 64), ...(paused ? { attempts: { decrement: 1 } } : {}), availableAt: new Date(now.getTime() + row.attempts * 30_000) } });
  }
  return true;
}
