import { randomUUID } from 'node:crypto';
import { Prisma, type WhatsAppChannel } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../../../lib/prisma.js';
import { decryptField } from '../../crypto.js';
import { CommerceError, type CommerceDependencies } from './types.js';
import { reconcileCommerceReceipts } from './inbox.js';
import { parseCommercePolicy, requireCommerceChannel } from './policy.js';
import { resolveProductQuantityRules } from '../../../../utils/productQuantityRules.js';
import { normalizeFiscalRegime } from '../../../../utils/fiscalRegime.js';

// Only application-owned codes enter the evidence ledger; provider/driver errors
// can contain request data and must never be copied into persistent fields.
const sendErrorCodes=new Set(['COMMERCE_BODY_TOO_LONG','META_SEND_UNCERTAIN','COMMERCE_SEND_UNKNOWN','COMMERCE_CHANNEL','COMMERCE_VERTICAL','COMMERCE_POLICY','COMMERCE_POLICY_CHANGED','COMMERCE_OPT_OUT','COMMERCE_HANDOFF','COMMERCE_ACTOR_REVOKED','COMMERCE_ASSIGNMENT_CHANGED','COMMERCE_WINDOW_EXPIRED','COMMERCE_RESPONSE_EXPIRED','COMMERCE_QUOTE_STALE','COMMERCE_QUOTE_EXPIRED','COMMERCE_QUOTE_PRODUCT_CHANGED','COMMERCE_QUOTE_FISCAL_CHANGED','COMMERCE_SEND_LEASE_CHANGED']);
const sendErrorCode=(error:unknown)=>error instanceof CommerceError && sendErrorCodes.has(error.code)?error.code:'COMMERCE_SEND_FAILED';

async function sendViaMeta(channel: WhatsAppChannel, waId: string, body: string): Promise<string | null> {
  if (body.length > 4096) throw new CommerceError('COMMERCE_BODY_TOO_LONG', 'Respuesta supera el límite de WhatsApp.', 422);
  const token = decryptField(channel.accessTokenEnc);
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${channel.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: waId, type: 'text', text: { preview_url: false, body } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new CommerceError('META_SEND_UNCERTAIN', 'Meta no confirmó el envío.', 503);
  const data = await response.json() as { messages?: Array<{ id?: string }> };
  return data.messages?.[0]?.id ?? null;
}

export async function recoverCommerceSending(deps: CommerceDependencies = {}): Promise<number> {
  const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
  const rows = await db.waCommerceOutbox.findMany({ where: { status: 'SENDING', leaseUntil: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, tenantId: true, leaseToken: true } });
  let recovered = 0;
  for (const row of rows) {
    recovered += await db.$transaction(async tx=>{
      const changed=await tx.waCommerceOutbox.updateMany({ where: { id: row.id, tenantId: row.tenantId, status: 'SENDING', leaseToken: row.leaseToken, leaseUntil: { lte: now } }, data: { status: 'UNKNOWN', leaseToken: null, leaseUntil: null, errorCode: 'SEND_INTERRUPTED' } });
      if(changed.count && row.leaseToken) await tx.waCommerceOutboxAttempt.updateMany({where:{id:row.leaseToken,tenantId:row.tenantId,outboxId:row.id,status:{in:['CLAIMED','SENDING']}},data:{status:'UNKNOWN',settledAt:now,errorCode:'SEND_INTERRUPTED'}});
      return changed.count;
    });
  }
  return recovered;
}

/** Returns one invocation. An ambiguous send is NEVER returned to PENDING. */
export async function dispatchCommerceOutboxOnce(deps: CommerceDependencies = {}): Promise<boolean> {
  const db = deps.db ?? prisma, now = deps.now?.() ?? new Date();
  if (!(deps.sendingEnabled ?? process.env.WHATSAPP_COMMERCE_SENDING_ENABLED === 'true')) return false;
  await recoverCommerceSending(deps);
  const candidates = await db.$queryRaw<Array<{ id: string; conversationId: string }>>(Prisma.sql`
    SELECT o.id,o.conversationId FROM WaCommerceOutbox o WHERE o.status='PENDING'
      AND NOT EXISTS (SELECT 1 FROM WaCommerceOutbox older WHERE older.conversationId=o.conversationId
        AND older.status IN ('PENDING','SENDING') AND older.sequence<o.sequence)
    ORDER BY o.sequence ASC LIMIT 20`);
  for (const candidate of candidates) {
    const row = await db.$transaction(async tx => {
      const output = await tx.waCommerceOutbox.findUnique({ where: { id: candidate.id } });
      if (!output || output.status !== 'PENDING') return null;
      // Always acquire locks in channel -> conversation -> outbox order.
      const channelLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WhatsAppChannel WHERE id=${output.channelId} FOR UPDATE`);
      if (!channelLock.length) {
        await tx.waCommerceOutbox.updateMany({ where: { id: output.id, tenantId: output.tenantId, status: 'PENDING' }, data: { status: 'CANCELLED', errorCode: 'COMMERCE_CHANNEL_MISSING' } });
        return null;
      }
      const conversationLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WaCommerceConversation WHERE id=${output.conversationId} AND channelId=${output.channelId} FOR UPDATE`);
      if (!conversationLock.length) {
        await tx.waCommerceOutbox.updateMany({ where: { id: output.id, tenantId: output.tenantId, status: 'PENDING' }, data: { status: 'CANCELLED', errorCode: 'COMMERCE_CONVERSATION_MISSING' } });
        return null;
      }
      const first = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WaCommerceOutbox
        WHERE conversationId=${output.conversationId} AND status IN ('PENDING','SENDING') ORDER BY sequence ASC LIMIT 1 FOR UPDATE`);
      if (first[0]?.id !== output.id) return null;
      const leaseToken = randomUUID();
      const changed = await tx.waCommerceOutbox.updateMany({ where: { id: output.id, tenantId: output.tenantId, status: 'PENDING' }, data: { status: 'SENDING', leaseToken, leaseUntil: new Date(now.getTime() + 60_000) } });
      if(changed.count!==1)return null;
      await tx.waCommerceOutboxAttempt.create({data:{id:leaseToken,tenantId:output.tenantId,outboxId:output.id,channelId:output.channelId,claimedAt:now,status:'CLAIMED'}});
      return tx.waCommerceOutbox.findUnique({ where: { id: output.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (!row) continue;
    let invoked = false;
    let knownMessageId:string|null=null;
    try {
      // Validation is repeated after the claim, immediately before the network boundary.
      const channel = await requireCommerceChannel(db, row.tenantId, row.channelId);
      const conversation = await db.waCommerceConversation.findFirst({ where: { id: row.conversationId, tenantId: row.tenantId, channelId: row.channelId, waId: row.waId } });
      if (!conversation || channel.commercePolicyVersion !== row.policyVersion) throw new CommerceError('COMMERCE_POLICY_CHANGED', 'La política o el canal cambió.', 403);
      const origin = !row.actorUserId && !row.quoteDraftId ? await db.waCommerceInbox.findFirst({ where: { id: row.idempotencyKey, tenantId: row.tenantId, channelId: row.channelId, conversationId: row.conversationId, waId: row.waId } }) : null;
      const command = origin?.body.trim().toUpperCase() ?? '';
      // Only the one response tied to the exact control inbound may cross its own state transition.
      const optOutAck = command === 'BAJA';
      const handoffAck = command === 'ASESOR';
      if (conversation.optedOutAt && (!conversation.optedInAt || conversation.optedOutAt > conversation.optedInAt) && !optOutAck) throw new CommerceError('COMMERCE_OPT_OUT', 'Cliente solicitó no recibir mensajes.', 403);
      if (!row.actorUserId && conversation.status !== 'BOT' && !handoffAck && !optOutAck) throw new CommerceError('COMMERCE_HANDOFF', 'La conversación pasó a atención humana.', 403);
      if (row.actorUserId) {
        const actor = await db.user.findFirst({ where: { id: row.actorUserId, tenantId: row.tenantId, status: 'ACTIVE' } });
        if (!actor || !['OWNER', 'ADMIN', 'MANAGER'].includes(actor.role)) throw new CommerceError('COMMERCE_ACTOR_REVOKED', 'Operador sin acceso vigente.', 403);
        if (conversation.status === 'HUMAN' && conversation.assignedUserId !== actor.id) throw new CommerceError('COMMERCE_ASSIGNMENT_CHANGED', 'Asignación humana cambió.', 403);
      }
      if (conversation.lastInboundAt.getTime() + 23 * 3_600_000 <= now.getTime()) throw new CommerceError('COMMERCE_WINDOW_EXPIRED', 'La ventana de respuesta venció.', 422);
      if (row.expiresAt <= now) throw new CommerceError('COMMERCE_RESPONSE_EXPIRED', 'La respuesta venció.', 422);
      if (row.body.length > 4096) throw new CommerceError('COMMERCE_BODY_TOO_LONG', 'Respuesta supera el límite de WhatsApp.', 422);
      if (row.quoteDraftId) {
        const draft = await db.waCommerceQuoteDraft.findFirst({ where: { id: row.quoteDraftId, tenantId: row.tenantId, channelId: row.channelId, conversationId: row.conversationId } });
        if (!draft || draft.status !== 'ISSUED' || !draft.quotationId || draft.policyVersion !== row.policyVersion || draft.reviewedBy !== row.actorUserId) throw new CommerceError('COMMERCE_QUOTE_STALE', 'Cotización ya no es válida.', 409);
        const snapshot = draft.snapshot && typeof draft.snapshot === 'object' && !Array.isArray(draft.snapshot) ? draft.snapshot as Record<string, unknown> : null;
        const expiry = snapshot && typeof snapshot.expiresAt === 'string' ? new Date(snapshot.expiresAt) : null;
        if (!expiry || !Number.isFinite(expiry.getTime()) || expiry <= now) throw new CommerceError('COMMERCE_QUOTE_EXPIRED', 'Cotización vencida.', 409);
        const lines = snapshot && Array.isArray(snapshot.lines) ? snapshot.lines as Array<Record<string, unknown>> : [];
        const eligible = new Set(parseCommercePolicy(channel).eligibleProductIds);
        const ids = lines.map(line => String(line.productId ?? ''));
        if (!ids.length || ids.some(id => !eligible.has(id))) throw new CommerceError('COMMERCE_QUOTE_PRODUCT_CHANGED', 'El producto dejó de ser elegible.', 409);
        const products = await db.product.findMany({ where: { tenantId: row.tenantId, id: { in: ids }, isPublished: true, requiresBatchTracking: false, requiresSerialTracking: false }, select: { id: true, price: true, promotionPriceVersion: true, stock: true, unit: true, ivaExento: true, saleMode: true, quantityStep: true } });
        const byId = new Map(products.map(product => [product.id, product]));
        for (const line of lines) {
          const product = byId.get(String(line.productId ?? ''));
          if (!product) throw new CommerceError('COMMERCE_QUOTE_PRODUCT_CHANGED', 'Producto ya no disponible.', 409);
          const quantityRules = resolveProductQuantityRules(product);
          if (product.promotionPriceVersion !== line.productPriceVersion || !new Decimal(product.price.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(String(line.unitPrice ?? 'NaN')) || new Decimal(product.stock.toString()).lt(String(line.quantity ?? 'NaN')) || product.unit !== line.unit || product.ivaExento !== line.ivaExento || quantityRules.saleMode !== line.saleMode || quantityRules.quantityStep !== line.quantityStep) throw new CommerceError('COMMERCE_QUOTE_PRODUCT_CHANGED', 'Precio, unidad, impuestos o disponibilidad cambió.', 409);
        }
        const tenant = await db.tenant.findFirst({ where: { id: row.tenantId }, select: { type: true, fiscalRegime: true, fiscalRegimeVersion: true } });
        if (!tenant || tenant.type !== 'FERRETERIA' || tenant.fiscalRegimeVersion !== snapshot.fiscalRegimeVersion || normalizeFiscalRegime(tenant.fiscalRegime) !== snapshot.fiscalRegime) throw new CommerceError('COMMERCE_QUOTE_FISCAL_CHANGED', 'Régimen fiscal cambió.', 409);
      }
      const sender = deps.sender ?? sendViaMeta;
      // Commit invocation evidence before crossing the network boundary. Failure
      // here cannot send, and a crash afterward is conservatively UNKNOWN.
      const invokedAt=deps.now?.()??new Date();
      await db.$transaction(async tx=>{
        const locked=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM WaCommerceOutbox WHERE id=${row.id} AND tenantId=${row.tenantId} AND status='SENDING' AND leaseToken=${row.leaseToken} FOR UPDATE`);
        if(!locked.length)throw new CommerceError('COMMERCE_SEND_LEASE_CHANGED','El intento cambió antes de enviar.',409);
        const attempt=await tx.waCommerceOutboxAttempt.updateMany({where:{id:row.leaseToken!,tenantId:row.tenantId,outboxId:row.id,status:'CLAIMED'},data:{status:'SENDING',invokedAt}});
        if(attempt.count!==1)throw new CommerceError('COMMERCE_SEND_LEASE_CHANGED','El intento cambió antes de enviar.',409);
      });
      invoked = true;
      const messageId = await sender(channel, row.waId, row.body);
      if (!messageId || !/^[^\u0000-\u001f]{1,191}$/.test(messageId)) throw new CommerceError('COMMERCE_SEND_UNKNOWN', 'Meta no confirmó un ID.', 503);
      knownMessageId=messageId;
      const settledAt=deps.now?.()??new Date();
      await db.$transaction(async tx => {
        const updated = await tx.waCommerceOutbox.updateMany({ where: { id: row.id, tenantId: row.tenantId, status: 'SENDING', leaseToken: row.leaseToken }, data: { status: 'SENT', providerMessageId: messageId, leaseToken: null, leaseUntil: null, errorCode: null } });
        await tx.waCommerceOutboxAttempt.updateMany({where:{id:row.leaseToken!,tenantId:row.tenantId,outboxId:row.id,status:{in:['CLAIMED','SENDING','UNKNOWN']}},data:{status:updated.count===1?'ACCEPTED':'UNKNOWN',providerMessageId:messageId,settledAt,errorCode:updated.count===1?null:'SEND_INTERRUPTED'}});
        if (updated.count !== 1) {
          // Recovery may have expired this exact attempt while Meta answered.
          // Keep its known ID without claiming acceptance on the output.
          await tx.waCommerceOutbox.updateMany({where:{id:row.id,tenantId:row.tenantId,status:'UNKNOWN',providerMessageId:null},data:{providerMessageId:messageId}});
          const recovered = await tx.waCommerceOutbox.findUnique({ where: { id: row.id } });
          if (recovered) await reconcileCommerceReceipts(tx, recovered);
          return;
        }
        const output = await tx.waCommerceOutbox.findUnique({ where: { id: row.id } });
        if (output) await reconcileCommerceReceipts(tx, output);
      });
    } catch (error) {
      const code=sendErrorCode(error);
      const settledAt=deps.now?.()??new Date();
      try {
        await db.$transaction(async tx=>{
          const changed=await tx.waCommerceOutbox.updateMany({ where: { id: row.id, tenantId: row.tenantId, status: 'SENDING', leaseToken: row.leaseToken }, data: { status: invoked ? 'UNKNOWN' : 'CANCELLED', errorCode: code, providerMessageId:knownMessageId, leaseToken: null, leaseUntil: null } });
          // A committed ACCEPTED attempt is preserved if only its response was
          // lost. Otherwise retain the exact ID even when the first commit failed.
          await tx.waCommerceOutboxAttempt.updateMany({where:{id:row.leaseToken!,tenantId:row.tenantId,outboxId:row.id,status:{in:['CLAIMED','SENDING','UNKNOWN']}},data:{status:invoked?'UNKNOWN':'CANCELLED',providerMessageId:knownMessageId,settledAt,errorCode:code}});
          if(!changed.count && knownMessageId)await tx.waCommerceOutbox.updateMany({where:{id:row.id,tenantId:row.tenantId,status:'UNKNOWN',providerMessageId:null},data:{providerMessageId:knownMessageId}});
          if (knownMessageId) {
            const recovered = await tx.waCommerceOutbox.findUnique({ where: { id: row.id } });
            if (recovered) await reconcileCommerceReceipts(tx, recovered);
          }
        });
      } catch {
        // No attempt identity is discarded while DB is unavailable. Recovery
        // will settle the persisted SENDING lease; no automatic resend is safe.
        throw new CommerceError('COMMERCE_SEND_EVIDENCE_UNAVAILABLE','No se pudo guardar evidencia del envío; requiere recuperación.',503);
      }
    }
    return true;
  }
  return false;
}
