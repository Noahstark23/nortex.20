import { Prisma } from '@prisma/client';
import { z } from 'zod';
import Decimal from 'decimal.js';
import prisma from '../../../lib/prisma.js';
import { CommerceError, type CommercePolicy, type CommercePrincipal, type CommerceTx, type CommerceDb } from './types.js';

const policySchema = z.object({
  eligibleProductIds: z.array(z.string().trim().min(1).max(191)).max(500).refine(ids => new Set(ids).size === ids.length),
  autoQuote: z.boolean(), ttlHours: z.number().int().min(1).max(168),
  maxTotal: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/).refine(value => new Decimal(value).greaterThan(0) && new Decimal(value).lessThanOrEqualTo('9999999.99')),
  maxLines: z.number().int().min(1).max(20), eligibilityAttested: z.boolean(),
}).strict();
export function parseCommercePolicy(channel: { commercePolicy: unknown }): CommercePolicy {
  const result = policySchema.safeParse(channel.commercePolicy);
  if (!result.success || !result.data.eligibilityAttested) throw new CommerceError('COMMERCE_POLICY', 'Revisá los productos y la política del canal antes de habilitarlo.', 409);
  return result.data;
}
/** Autorización actual en BD, también cuando un servicio se invoca fuera de HTTP. */
export async function requireCommercePrincipal(principal: CommercePrincipal, db: CommerceDb | CommerceTx = prisma) {
  const user = await db.user.findFirst({where:{id:principal.userId,tenantId:principal.tenantId,status:'ACTIVE'},select:{id:true,tenantId:true,role:true}});
  if (!user || user.role !== principal.role || !['OWNER','ADMIN','MANAGER'].includes(user.role)) throw new CommerceError('COMMERCE_FORBIDDEN','Tu usuario no puede atender este canal.',403);
  return user;
}
export async function requireCommerceChannel(db: CommerceDb | CommerceTx, tenantId: string, channelId: string) {
  const channel = await db.whatsAppChannel.findFirst({where:{id:channelId,tenantId,active:true,commerceEnabled:true}});
  if (!channel) throw new CommerceError('COMMERCE_CHANNEL','El canal no está habilitado para este negocio.',403);
  const tenant = await db.tenant.findFirst({where:{id:tenantId},select:{type:true}});
  if (tenant?.type !== 'FERRETERIA') throw new CommerceError('COMMERCE_VERTICAL','Este piloto está disponible para ferreterías con productos revisados.',403);
  parseCommercePolicy(channel);
  return channel;
}
const publicSelect = {id:true,displayPhone:true,active:true,commerceEnabled:true,commercePolicyVersion:true,commercePolicy:true} as const;
export async function listCommerceChannels(principal: CommercePrincipal, db: CommerceDb = prisma) {
  await requireCommercePrincipal(principal,db);
  return db.whatsAppChannel.findMany({where:{tenantId:principal.tenantId},select:publicSelect,orderBy:{createdAt:'asc'},take:50});
}
export async function updateCommercePolicy(principal: CommercePrincipal, channelId: string, input: {expectedVersion:number;enabled:boolean;policy:unknown}, db: CommerceDb = prisma, now=new Date()) {
  const request = z.object({expectedVersion:z.number().int().nonnegative(),enabled:z.boolean(),policy:policySchema}).strict().parse(input);
  return db.$transaction(async tx => {
    await requireCommercePrincipal(principal,tx);
    if (!['OWNER','ADMIN'].includes(principal.role)) throw new CommerceError('COMMERCE_FORBIDDEN','Solo administración puede configurar el canal.',403);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM WhatsAppChannel WHERE id=${channelId} AND tenantId=${principal.tenantId} FOR UPDATE`);
    const previous = await tx.whatsAppChannel.findFirst({where:{id:channelId,tenantId:principal.tenantId}});
    if (!previous) throw new CommerceError('COMMERCE_CHANNEL','Canal no encontrado.',404);
    if (previous.commercePolicyVersion !== request.expectedVersion) throw new CommerceError('COMMERCE_VERSION','La política cambió; recargá antes de guardar.',409);
    const tenant=await tx.tenant.findFirst({where:{id:principal.tenantId},select:{type:true}});
    if (request.enabled && (!previous.active || tenant?.type !== 'FERRETERIA' || !request.policy.eligibilityAttested || !request.policy.eligibleProductIds.length)) throw new CommerceError('COMMERCE_POLICY','Se requiere canal activo, ferretería y productos revisados.',409);
    if (request.policy.eligibleProductIds.length) {
      const products=await tx.product.findMany({where:{tenantId:principal.tenantId,id:{in:request.policy.eligibleProductIds},isPublished:true,requiresBatchTracking:false,requiresSerialTracking:false},select:{id:true},take:500});
      if (products.length !== request.policy.eligibleProductIds.length) throw new CommerceError('COMMERCE_PRODUCTS','Revisá la publicación y elegibilidad de los productos seleccionados.',409);
    }
    const policy={...request.policy,maxTotal:new Decimal(request.policy.maxTotal).toFixed(2)};
    const version=previous.commercePolicyVersion+1;
    await tx.whatsAppChannel.updateMany({where:{id:channelId,tenantId:principal.tenantId,commercePolicyVersion:request.expectedVersion},data:{commerceEnabled:request.enabled,commercePolicy:policy,commercePolicyVersion:version}});
    await tx.waCommercePolicyVersion.create({data:{tenantId:principal.tenantId,channelId,version,enabled:request.enabled,policy,approvedBy:principal.userId,createdAt:now}});
    await tx.waCommerceOutbox.updateMany({where:{tenantId:principal.tenantId,channelId,status:'PENDING'},data:{status:'CANCELLED',errorCode:'POLICY_CHANGED'}});
    await tx.auditLog.create({data:{tenantId:principal.tenantId,userId:principal.userId,action:'WHATSAPP_COMMERCE_POLICY',details:JSON.stringify({channelId,before:{enabled:previous.commerceEnabled,version:previous.commercePolicyVersion},after:{enabled:request.enabled,version,policy}})}});
    return tx.whatsAppChannel.findFirstOrThrow({where:{id:channelId,tenantId:principal.tenantId},select:publicSelect});
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
