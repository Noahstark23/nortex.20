import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { resolveQuotationItems, legacyQuotationQuantity } from '../../../lib/quotationItems';
import { resolveProductQuantityRules } from '../../../../utils/productQuantityRules';
import { normalizeFiscalRegime } from '../../../../utils/fiscalRegime';
import { calculateQuotationTotals } from '../../../lib/quotationTotals';
import { CommerceError, type CommercePrincipal, type CommerceTx } from './types';
import { parseCommercePolicy, requireCommerceChannel, requireCommercePrincipal } from './policy';

export interface CommerceQuoteItemInput { productId: string; quantity: string; presentation?: 'BASE' }
export interface CommerceQuoteContext { tenantId: string; channelId: string; conversationId: string; waId: string; policyVersion: number }
interface QuoteLine { productId: string; name: string; quantity: string; unitPrice: string; unit: string; saleMode: string; quantityStep: string; ivaExento: boolean; productPriceVersion: number; stockAtReview: string }
interface QuoteSnapshot { lines: QuoteLine[]; subtotal: string; tax: string; total: string; fiscalRegime: string; fiscalRegimeVersion: number; policyVersion: number; expiresAt: string; reviewedAt: string }
const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]))
    : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const safeText=(value:string,max:number)=>value.replace(/[\r\n\t\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const inputItems = (raw: unknown): CommerceQuoteItemInput[] => {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) throw new CommerceError('INVALID_ITEMS', 'Elegí entre 1 y 50 productos.', 400);
  const seen = new Set<string>();
  return raw.map((row: any) => {
    if (!row || typeof row.productId !== 'string' || !row.productId.trim() || typeof row.quantity !== 'string' || row.presentation && row.presentation !== 'BASE') throw new CommerceError('INVALID_ITEMS', 'Producto o cantidad inválida.', 400);
    const productId = row.productId.trim();
    if (seen.has(productId)) throw new CommerceError('DUPLICATE_PRODUCT', 'Un producto figura dos veces.', 400);
    seen.add(productId);
    return { productId, quantity: row.quantity.trim(), presentation: 'BASE' };
  });
};
const readDraft = async (tx: CommerceTx, tenantId: string, draftId: string) => {
  const reference=await tx.waCommerceQuoteDraft.findFirst({where:{id:draftId,tenantId},select:{channelId:true,conversationId:true}});
  if (!reference) throw new CommerceError('DRAFT_NOT_FOUND', 'Borrador no encontrado.', 404);
  const channelRows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM \`WhatsAppChannel\` WHERE id=${reference.channelId} AND tenantId=${tenantId} FOR UPDATE`;
  const conversationRows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM \`WaCommerceConversation\` WHERE id=${reference.conversationId} AND tenantId=${tenantId} AND channelId=${reference.channelId} FOR UPDATE`;
  if (!channelRows.length || !conversationRows.length) throw new CommerceError('DRAFT_NOT_FOUND', 'Borrador no encontrado.', 404);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`WaCommerceQuoteDraft\` WHERE id=${draftId} AND tenantId=${tenantId} AND channelId=${reference.channelId} AND conversationId=${reference.conversationId} FOR UPDATE`;
  if (!rows.length) throw new CommerceError('DRAFT_NOT_FOUND', 'Borrador no encontrado.', 404);
  const draft = await tx.waCommerceQuoteDraft.findFirst({ where: { id: draftId, tenantId } });
  if (!draft) throw new CommerceError('DRAFT_NOT_FOUND', 'Borrador no encontrado.', 404);
  return draft;
};
const assertVersion = (draft: {version:number;status:string}, version:number) => {
  if (!Number.isSafeInteger(version) || draft.version !== version) throw new CommerceError('VERSION_CHANGED', 'El borrador cambió; volvé a revisarlo.', 409);
  if (draft.status === 'ISSUED') throw new CommerceError('ALREADY_ISSUED', 'Esta cotización ya fue emitida.', 409);
  if (!['DRAFT','PENDING_REVIEW','REVIEWED'].includes(draft.status)) throw new CommerceError('DRAFT_UNAVAILABLE','Esta solicitud está cancelada, vencida o fuera del flujo de revisión.',409);
};
const asItems = (value: Prisma.JsonValue) => inputItems(value);
const buildSnapshot = async (tx: CommerceTx, tenantId:string, channelId:string, raw:unknown, now:Date):Promise<QuoteSnapshot> => {
  const channel = await requireCommerceChannel(tx, tenantId, channelId);
  const policy = parseCommercePolicy(channel);
  const items = inputItems(raw);
  if (items.length > policy.maxLines) throw new CommerceError('TOO_MANY_LINES', 'Demasiados productos para esta cotización.', 400);
  const ids = items.map(item => item.productId);
  const [products, tenant] = await Promise.all([
    tx.product.findMany({ where: { tenantId, id: { in: ids }, isPublished: true, requiresBatchTracking: false, requiresSerialTracking: false }, select: { id:true,name:true,price:true,stock:true,unit:true,ivaExento:true,saleMode:true,quantityStep:true,promotionPriceVersion:true } }),
    tx.tenant.findFirst({ where: { id: tenantId }, select: { fiscalRegime:true,fiscalRegimeVersion:true } }),
  ]);
  if (!tenant) throw new CommerceError('TENANT_NOT_FOUND', 'Negocio no encontrado.', 404);
  if (products.length !== ids.length) throw new CommerceError('PRODUCT_UNAVAILABLE', 'Un producto ya no está disponible.', 409);
  const allowed = new Set(policy.eligibleProductIds);
  if (ids.some(id => !allowed.has(id))) throw new CommerceError('PRODUCT_NOT_ELIGIBLE', 'Producto fuera del catálogo habilitado para WhatsApp.', 403);
  const byId = new Map(products.map(product => [product.id,product]));
  const authority = products.map(product => ({...product, ...resolveProductQuantityRules(product)}));
  let resolved;
  try { resolved = resolveQuotationItems(items.map(item => ({productId:item.productId,quantity:item.quantity})), authority); }
  catch (error) { throw new CommerceError('INVALID_QUANTITY', error instanceof Error ? error.message : 'Cantidad inválida.', 400); }
  const lines: QuoteLine[] = resolved.map(item => {
    const product = byId.get(item.productId)!;
    const price = new Decimal(product.price.toString()).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
    if (!price.isFinite() || price.isNegative()) throw new CommerceError('INVALID_PRICE', 'Precio inválido en catálogo.', 409);
    if (new Decimal(product.stock.toString()).lessThan(item.quantityExact)) throw new CommerceError('INSUFFICIENT_STOCK','No hay suficiente existencia visible para cotizar esta cantidad. Pedí atención humana.',409);
    return { productId:item.productId,name:item.name,quantity:item.quantityExact.toFixed(4),unitPrice:price.toFixed(4),unit:item.unit,saleMode:item.saleMode,quantityStep:item.quantityStep,ivaExento:item.ivaExento,productPriceVersion:product.promotionPriceVersion,stockAtReview:new Decimal(product.stock.toString()).toFixed(4) };
  });
  const fiscalRegime = normalizeFiscalRegime(tenant.fiscalRegime);
  const amounts=calculateQuotationTotals(resolved,fiscalRegime);
  if (amounts.total.greaterThan(new Decimal(policy.maxTotal))) throw new CommerceError('TOTAL_LIMIT', 'La cotización supera el límite del canal.', 409);
  const expiresAt = new Date(now.getTime()+policy.ttlHours*3600000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || policy.ttlHours <= 0 || policy.ttlHours > 24*30) throw new CommerceError('INVALID_EXPIRY', 'Vigencia inválida.', 400);
  return {lines,subtotal:amounts.subtotal.toFixed(2),tax:amounts.tax.toFixed(2),total:amounts.total.toFixed(2),fiscalRegime,fiscalRegimeVersion:tenant.fiscalRegimeVersion,policyVersion:channel.commercePolicyVersion,expiresAt:expiresAt.toISOString(),reviewedAt:now.toISOString()};
};
const display = (snapshot: QuoteSnapshot) => {
 const body=[
  'Proforma sujeta a disponibilidad:',
  ...snapshot.lines.map(line => `• ${safeText(line.name,100)}: ${line.quantity} ${safeText(line.unit,24)} × C$${new Decimal(line.unitPrice).toFixed(2)}`),
  `Total C$${snapshot.total}. Vigente hasta ${snapshot.expiresAt}.`,
  'Cotizar no reserva inventario ni registra una venta.',
 ].join('\n');
 if (body.length>4096) throw new CommerceError('QUOTE_TEXT_TOO_LONG','La proforma supera el límite del mensaje; reducí las líneas.',409);
 return body;
};

export async function createCommerceQuoteDraft(tx:CommerceTx, ctx:CommerceQuoteContext, raw:unknown, requestKey:string, now:Date) {
  if (!requestKey || requestKey.length>191) throw new CommerceError('INVALID_REQUEST_KEY','Intento inválido.',400);
  // MySQL RepeatableRead: lock-first avoids a stale snapshot after a concurrent
  // INSERT IGNORE of the same requestKey. Matches worker channel -> conversation.
  const channelLock=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM \`WhatsAppChannel\` WHERE id=${ctx.channelId} AND tenantId=${ctx.tenantId} FOR UPDATE`;
  const conversationLock=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM \`WaCommerceConversation\` WHERE id=${ctx.conversationId} AND tenantId=${ctx.tenantId} AND channelId=${ctx.channelId} AND waId=${ctx.waId} FOR UPDATE`;
  if (!channelLock.length || !conversationLock.length) throw new CommerceError('CONVERSATION_NOT_FOUND','Conversación no encontrada.',404);
  const channel=await requireCommerceChannel(tx,ctx.tenantId,ctx.channelId);
  const policy=parseCommercePolicy(channel);
  const conversation=await tx.waCommerceConversation.findFirst({where:{id:ctx.conversationId,tenantId:ctx.tenantId,channelId:ctx.channelId,waId:ctx.waId}});
  if (!conversation) throw new CommerceError('CONVERSATION_NOT_FOUND','Conversación no encontrada.',404);
  const items=inputItems(raw);
  if (items.length>policy.maxLines) throw new CommerceError('TOO_MANY_LINES','Demasiados productos.',400);
  const key=hash([ctx.tenantId,ctx.channelId,requestKey]);
  const existing=await tx.waCommerceQuoteDraft.findUnique({where:{requestKey:key}});
  if (existing) {
    if (existing.tenantId!==ctx.tenantId || existing.channelId!==ctx.channelId || existing.conversationId!==ctx.conversationId || hash(inputItems(existing.items))!==hash(items)) throw new CommerceError('REQUEST_CONFLICT','El intento ya tiene otro contenido.',409);
    return existing;
  }
  await buildSnapshot(tx,ctx.tenantId,ctx.channelId,items,now);
  await tx.waCommerceQuoteDraft.createMany({data:[{tenantId:ctx.tenantId,channelId:ctx.channelId,conversationId:ctx.conversationId,requestKey:key,policyVersion:channel.commercePolicyVersion,items:items as unknown as Prisma.InputJsonValue,status:'DRAFT',createdAt:now}],skipDuplicates:true});
  const raced=await tx.waCommerceQuoteDraft.findUnique({where:{requestKey:key}});
  if (!raced || raced.tenantId!==ctx.tenantId || raced.channelId!==ctx.channelId || raced.conversationId!==ctx.conversationId || hash(inputItems(raced.items))!==hash(items)) throw new CommerceError('REQUEST_CONFLICT','El intento ya tiene otro contenido.',409);
  return raced;
}
export async function updateCommerceQuote(principal:CommercePrincipal,id:string,version:number,raw:unknown,db:PrismaClient=prisma,now:Date=new Date()) {
  await requireCommercePrincipal(principal,db);
  const items=inputItems(raw);
  // Authorization reads must not pin a RepeatableRead snapshot before waiting
  // on readDraft's locks; every read after the lock sees the committed version.
  return db.$transaction(async tx=>{
    await requireCommercePrincipal(principal,tx);
    const draft=await readDraft(tx,principal.tenantId,id); assertVersion(draft,version);
    await requireCommerceChannel(tx,principal.tenantId,draft.channelId);
    return tx.waCommerceQuoteDraft.update({where:{id},data:{items:items as unknown as Prisma.InputJsonValue,version:{increment:1},snapshot:Prisma.JsonNull,reviewHash:null,reviewedBy:null,status:'DRAFT',updatedAt:now}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
export async function reviewCommerceQuote(principal:CommercePrincipal,draftId:string,version:number,db:PrismaClient=prisma,now:Date=new Date()) {
  await requireCommercePrincipal(principal,db);
  return db.$transaction(async tx=>{
    await requireCommercePrincipal(principal,tx);
    const draft=await readDraft(tx,principal.tenantId,draftId); assertVersion(draft,version);
    const snapshot=await buildSnapshot(tx,principal.tenantId,draft.channelId,asItems(draft.items),now);
    const reviewHash=hash({draftId,version,items:draft.items,snapshot});
    await tx.waCommerceQuoteDraft.update({where:{id:draftId},data:{snapshot:snapshot as unknown as Prisma.InputJsonValue,reviewHash,reviewedBy:principal.userId,status:'REVIEWED',updatedAt:now}});
    return {draftId,version,reviewHash,snapshot,text:display(snapshot)};
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
export async function issueCommerceQuote(principal:CommercePrincipal,draftId:string,version:number,reviewHash:string,db:PrismaClient=prisma,now:Date=new Date()) {
  await requireCommercePrincipal(principal,db);
  return db.$transaction(async tx=>{
    await requireCommercePrincipal(principal,tx);
    const draft=await readDraft(tx,principal.tenantId,draftId);
    if (draft.version===version && draft.status==='ISSUED' && draft.quotationId && draft.reviewHash===reviewHash) {
      const outbox=await tx.waCommerceOutbox.findFirst({where:{tenantId:principal.tenantId,quoteDraftId:draft.id}});
      if (outbox) return {quotationId:draft.quotationId,outboxId:outbox.id};
    }
    assertVersion(draft,version);
    if (draft.status!=='REVIEWED' || !draft.snapshot || draft.reviewHash!==reviewHash || draft.reviewedBy!==principal.userId) throw new CommerceError('REVIEW_REQUIRED','Revisá de nuevo antes de emitir.',409);
    const previous=draft.snapshot as unknown as QuoteSnapshot;
    if (new Date(previous.expiresAt)<=now) throw new CommerceError('EXPIRED','La revisión venció.',409);
    const next=await buildSnapshot(tx,principal.tenantId,draft.channelId,asItems(draft.items),now);
    if (hash({...next,expiresAt:previous.expiresAt,reviewedAt:previous.reviewedAt})!==hash(previous)) throw new CommerceError('REVIEW_CHANGED','Cambió catálogo, precio, stock, política o régimen fiscal. Revisá otra vez.',409);
    const conversation=await tx.waCommerceConversation.findFirst({where:{id:draft.conversationId,tenantId:principal.tenantId,channelId:draft.channelId}});
    if (!conversation || conversation.optedOutAt || conversation.status==='CLOSED' || now.getTime()-conversation.lastInboundAt.getTime()>23*3600000 || conversation.lastInboundAt>now) throw new CommerceError('RECIPIENT_UNAVAILABLE','Destinatario o ventana de atención no habilitados.',409);
    if (conversation.status==='HUMAN' && conversation.assignedUserId!==principal.userId) throw new CommerceError('HANDOFF_OWNER','La atención humana debe estar asignada a tu usuario.',403);
    const quotation=await tx.quotation.create({data:{tenantId:principal.tenantId,customerName:'Cliente WhatsApp',subtotal:previous.subtotal,tax:previous.tax,total:previous.total,fiscalRegimeAtQuote:previous.fiscalRegime,expiresAt:new Date(previous.expiresAt),items:{create:previous.lines.map(line=>({productId:line.productId,name:line.name,quantity:legacyQuotationQuantity(line.quantity),quantityExact:line.quantity,price:new Decimal(line.unitPrice).toFixed(2),unitPriceExact:line.unitPrice,unitAtQuote:line.unit,saleModeAtQuote:line.saleMode,quantityStepAtQuote:line.quantityStep,presentationAtQuote:'BASE',presentationQuantityAtQuote:line.quantity,ivaExentoAtQuote:line.ivaExento}))}}});
    const sendUntil=new Date(Math.min(new Date(previous.expiresAt).getTime(),conversation.lastInboundAt.getTime()+23*3600000));
    const outbox=await tx.waCommerceOutbox.create({data:{idempotencyKey:`quote:${draft.id}:${version}`,tenantId:principal.tenantId,channelId:draft.channelId,conversationId:draft.conversationId,waId:conversation.waId,body:display(previous),policyVersion:previous.policyVersion,actorUserId:principal.userId,quoteDraftId:draft.id,expiresAt:sendUntil}});
    await tx.waCommerceQuoteDraft.update({where:{id:draft.id},data:{status:'ISSUED',quotationId:quotation.id}});
    await tx.auditLog.create({data:{tenantId:principal.tenantId,userId:principal.userId,action:'WHATSAPP_COMMERCE_QUOTE_ISSUED',details:JSON.stringify({draftId:draft.id,quotationId:quotation.id,outboxId:outbox.id,version})}});
    return {quotationId:quotation.id,outboxId:outbox.id};
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}

/** Explicit policy path: no internal user is fabricated and no message is sent in this transaction. */
export async function autoIssueCommerceQuote(tx:CommerceTx,ctx:CommerceQuoteContext,draftId:string,now:Date) {
  const channel=await requireCommerceChannel(tx,ctx.tenantId,ctx.channelId);
  const policy=parseCommercePolicy(channel);
  if (!policy.autoQuote || !policy.eligibilityAttested || channel.commercePolicyVersion!==ctx.policyVersion) throw new CommerceError('AUTO_QUOTE_DISABLED','Cotización automática no habilitada.',403);
  const draft=await readDraft(tx,ctx.tenantId,draftId);
  if (draft.channelId!==ctx.channelId || draft.conversationId!==ctx.conversationId) throw new CommerceError('DRAFT_NOT_FOUND','Borrador no encontrado.',404);
  if (draft.status==='ISSUED' && draft.quotationId) {
    const existing=await tx.waCommerceOutbox.findFirst({where:{tenantId:ctx.tenantId,quoteDraftId:draftId}});
    if (existing) return {quotationId:draft.quotationId,outboxId:existing.id};
  }
  if (draft.status!=='DRAFT') throw new CommerceError('DRAFT_CHANGED','Borrador en otro estado.',409);
  const conversation=await tx.waCommerceConversation.findFirst({where:{id:ctx.conversationId,tenantId:ctx.tenantId,channelId:ctx.channelId,waId:ctx.waId}});
  if (!conversation || conversation.optedOutAt || conversation.status!=='BOT' || conversation.lastInboundAt>now || now.getTime()-conversation.lastInboundAt.getTime()>23*3600000) throw new CommerceError('RECIPIENT_UNAVAILABLE','Destinatario o ventana de atención no habilitados.',409);
  const snapshot=await buildSnapshot(tx,ctx.tenantId,ctx.channelId,asItems(draft.items),now);
  const quotation=await tx.quotation.create({data:{tenantId:ctx.tenantId,customerName:'Cliente WhatsApp',subtotal:snapshot.subtotal,tax:snapshot.tax,total:snapshot.total,fiscalRegimeAtQuote:snapshot.fiscalRegime,expiresAt:new Date(snapshot.expiresAt),items:{create:snapshot.lines.map(line=>({productId:line.productId,name:line.name,quantity:legacyQuotationQuantity(line.quantity),quantityExact:line.quantity,price:new Decimal(line.unitPrice).toFixed(2),unitPriceExact:line.unitPrice,unitAtQuote:line.unit,saleModeAtQuote:line.saleMode,quantityStepAtQuote:line.quantityStep,presentationAtQuote:'BASE',presentationQuantityAtQuote:line.quantity,ivaExentoAtQuote:line.ivaExento}))}}});
  const reviewHash=hash({draftId,version:draft.version,items:draft.items,snapshot});
  const sendUntil=new Date(Math.min(new Date(snapshot.expiresAt).getTime(),conversation.lastInboundAt.getTime()+23*3600000));
  const outbox=await tx.waCommerceOutbox.create({data:{idempotencyKey:`quote:${draft.id}:${draft.version}`,tenantId:ctx.tenantId,channelId:ctx.channelId,conversationId:ctx.conversationId,waId:ctx.waId,body:display(snapshot),policyVersion:snapshot.policyVersion,actorUserId:null,quoteDraftId:draft.id,expiresAt:sendUntil}});
  await tx.waCommerceQuoteDraft.update({where:{id:draft.id},data:{status:'ISSUED',quotationId:quotation.id,snapshot:snapshot as unknown as Prisma.InputJsonValue,reviewHash}});
  return {quotationId:quotation.id,outboxId:outbox.id};
}
