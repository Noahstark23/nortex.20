import { createHmac,timingSafeEqual,randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { hashLinkCode } from './identity.js';
import { PrivateWhatsappError,privateWhatsappConfig,requirePrivateWhatsapp } from './config.js';
import type { PrivateWaDependencies,WaMessagePayload } from './types.js';

export const WA_LEASE_MS=300_000;
const id=z.string().min(1).max(191),waId=z.string().regex(/^[1-9]\d{7,14}$/);
const media=z.object({id:z.string().regex(/^\d{1,40}$/),mime_type:z.enum(['application/pdf','image/jpeg','image/png']),filename:z.string().max(180).optional()});
const message=z.object({id,from:waId,timestamp:z.string().regex(/^\d{1,12}$/),type:z.string(),text:z.object({body:z.string().min(1).max(4000)}).optional(),image:media.optional(),document:media.optional()});
const status=z.object({id,status:z.enum(['sent','delivered','read','failed']),recipient_id:waId});
const envelope=z.object({object:z.literal('whatsapp_business_account'),entry:z.array(z.object({changes:z.array(z.object({value:z.object({metadata:z.object({phone_number_id:z.string().regex(/^\d{5,30}$/)}),messages:z.array(message).max(100).optional(),statuses:z.array(status).max(100).optional()})})).max(100)})).max(100)});
const canonicalPayload=(value:unknown)=>JSON.stringify(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)));

export function verifyPrivateWaSignature(bytes:Buffer,signature:string|undefined,secret:string) {
  if(!secret||!signature||!/^sha256=[0-9a-f]{64}$/.test(signature))return false;
  return timingSafeEqual(createHmac('sha256',secret).update(bytes).digest(),Buffer.from(signature.slice(7),'hex'));
}

/** Retorna sólo después de persistir todas las entradas; un error de BD nunca produce ACK positivo. */
export async function acceptPrivateWaWebhook(bytes:Buffer,signature:string|undefined,deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma,config=deps.config??privateWhatsappConfig(),now=deps.now?.()??new Date();
  requirePrivateWhatsapp(config);
  if(bytes.length>256*1024)throw new PrivateWhatsappError('PRIVATE_WA_PAYLOAD','El evento excede el límite.',413);
  if(!verifyPrivateWaSignature(bytes,signature,config.appSecret))throw new PrivateWhatsappError('PRIVATE_WA_SIGNATURE','Firma inválida.',401);
  let parsed:z.infer<typeof envelope>;
  try {parsed=envelope.parse(JSON.parse(bytes.toString('utf8')));}catch {throw new PrivateWhatsappError('PRIVATE_WA_PAYLOAD','Evento inválido.',400);}
  const values=parsed.entry.flatMap(entry=>entry.changes.map(change=>change.value));
  if(values.some(value=>value.metadata.phone_number_id!==config.phoneNumberId))throw new PrivateWhatsappError('PRIVATE_WA_CHANNEL','Canal no autorizado.',403);
  if(values.reduce((sum,value)=>sum+(value.messages?.length??0)+(value.statuses?.length??0),0)>100)throw new PrivateWhatsappError('PRIVATE_WA_PAYLOAD','Demasiados eventos.',413);
  let accepted=0;
  await db.$transaction(async tx=>{
    for(const value of values) {
      for(const msg of value.messages??[]) {
        const age=now.getTime()-Number(msg.timestamp)*1000;
        if(!Number.isFinite(age)||age< -300_000||age>30*86400_000)continue;
        const binding=await tx.assistantWaBinding.findFirst({where:{phoneNumberId:config.phoneNumberId,waId:msg.from,active:true}});
        const code=msg.type==='text'?/^VINCULAR\s+([A-F0-9]{24})$/i.exec(msg.text?.body.trim()??''):null;
        const file=msg.type==='image'?msg.image:msg.type==='document'?msg.document:null;
        const kind=code?'LINK':!binding?'UNLINKED':msg.type==='text'&&msg.text?'TEXT':file?'MEDIA':'UNSUPPORTED';
        // El código crudo y el texto de remitentes no vinculados nunca llegan al historial ni al modelo.
        const payload:WaMessagePayload={timestamp:msg.timestamp,...(code?{codeHash:hashLinkCode(code[1])}:kind==='TEXT'?{text:msg.text!.body}:kind==='MEDIA'?{mediaId:file!.id,mediaType:file!.mime_type,name:file!.filename}: {})};
        const json=JSON.parse(JSON.stringify(payload));
        await tx.assistantWaInbox.createMany({data:[{id:randomUUID(),providerMessageId:msg.id,phoneNumberId:config.phoneNumberId,waId:msg.from,kind,payload:json,
          ...(binding?{bindingId:binding.id,bindingVersion:binding.version,tenantId:binding.tenantId,userId:binding.userId,roleAtReceipt:binding.roleAtBinding}:{}),
          status:['UNLINKED','UNSUPPORTED'].includes(kind)?'FAILED':'PENDING',errorCode:['UNLINKED','UNSUPPORTED'].includes(kind)?`PRIVATE_WA_${kind}`:null,
          expiresAt:new Date(now.getTime()+30*86400_000),availableAt:now,createdAt:now}],skipDuplicates:true});
        const stored=await tx.assistantWaInbox.findUnique({where:{providerMessageId:msg.id}});
        // Un ID externo no puede cambiar de emisor/canal o convertirse en otro contenido.
        if(!stored||stored.phoneNumberId!==config.phoneNumberId||stored.waId!==msg.from||canonicalPayload(stored.payload)!==canonicalPayload(json))throw new PrivateWhatsappError('PRIVATE_WA_MESSAGE_CONFLICT','El evento no coincide con su referencia.',409);
        accepted++;
      }
      for(const receipt of value.statuses??[]) {
        // Estado firmado sólo sobre una salida del mismo número y destinatario; no autoriza reenvíos.
        await tx.assistantWaOutbox.updateMany({where:{providerMessageId:receipt.id,phoneNumberId:config.phoneNumberId,waId:receipt.recipient_id,status:{in:['SENDING','UNKNOWN','SENT']}},data:{status:receipt.status==='failed'?'FAILED':'SENT',errorCode:receipt.status==='failed'?'META_DELIVERY_FAILED':null}});
      }
    }
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  return {accepted};
}

/** Bloquea el primer pendiente del remitente. Una entrada posterior no adelanta un lease vivo. */
export async function claimPrivateWaInbox(deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma,now=deps.now?.()??new Date();
  // Sólo cabezas elegibles: veinte seguidores de un remitente bloqueado no ocultan a los demás.
  const candidates=await db.$queryRaw<Array<{id:string;phoneNumberId:string;waId:string}>>(Prisma.sql`
    SELECT i.id,i.phoneNumberId,i.waId FROM AssistantWaInbox i WHERE i.expiresAt>${now}
    AND ((i.status='PENDING' AND i.availableAt<=${now}) OR (i.status='PROCESSING' AND i.leaseUntil<=${now}))
    AND NOT EXISTS(SELECT 1 FROM AssistantWaInbox older WHERE older.phoneNumberId=i.phoneNumberId AND older.waId=i.waId
      AND older.status IN ('PENDING','PROCESSING') AND older.expiresAt>${now} AND older.sequence<i.sequence)
    ORDER BY i.sequence ASC LIMIT 20`);
  for(const candidate of candidates) {
    const claimed=await db.$transaction(async tx=>{
      const first=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM AssistantWaInbox
        WHERE phoneNumberId=${candidate.phoneNumberId} AND waId=${candidate.waId} AND status IN ('PENDING','PROCESSING') AND expiresAt>${now}
        ORDER BY sequence ASC LIMIT 1 FOR UPDATE`);
      if(first[0]?.id!==candidate.id)return null;
      const leaseToken=randomUUID();
      const changed=await tx.assistantWaInbox.updateMany({where:{id:candidate.id,expiresAt:{gt:now},OR:[{status:'PENDING',availableAt:{lte:now}},{status:'PROCESSING',leaseUntil:{lte:now}}]},data:{status:'PROCESSING',leaseToken,leaseUntil:new Date(now.getTime()+WA_LEASE_MS),attempts:{increment:1}}});
      return changed.count===1?await tx.assistantWaInbox.findUnique({where:{id:candidate.id}}):null;
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    if(claimed)return claimed;
  }
  return null;
}
