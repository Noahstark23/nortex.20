import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { requirePrivateWaBinding } from './identity.js';
import { PrivateWhatsappError,privateWhatsappConfig } from './config.js';
import { createPrivateWaSender } from './transport.js';
import type { PrivateWaDependencies } from './types.js';

/** Un proceso caído después de SENDING deja incertidumbre, nunca vuelve a PENDING. */
export async function recoverPrivateWaSending(deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma,now=deps.now?.()??new Date();
  const rows=await db.assistantWaOutbox.findMany({where:{status:'SENDING',leaseUntil:{lte:now}},orderBy:{createdAt:'asc'},take:100,select:{id:true,tenantId:true,leaseToken:true}});
  let count=0;for(const row of rows){const result=await db.assistantWaOutbox.updateMany({where:{id:row.id,tenantId:row.tenantId,status:'SENDING',leaseToken:row.leaseToken,leaseUntil:{lte:now}},data:{status:'UNKNOWN',errorCode:'SEND_INTERRUPTED',leaseToken:null,leaseUntil:null}});count+=result.count;}return count;
}

export async function dispatchPrivateWaOutboxOnce(deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma,config=deps.config??privateWhatsappConfig(),now=deps.now?.()??new Date();
  if(!config.enabled||!config.sendingEnabled)return false;
  await recoverPrivateWaSending(deps);
  const candidates=await db.$queryRaw<Array<{id:string;phoneNumberId:string;waId:string}>>(Prisma.sql`
    SELECT o.id,o.phoneNumberId,o.waId FROM AssistantWaOutbox o WHERE o.status='PENDING'
    AND NOT EXISTS(SELECT 1 FROM AssistantWaOutbox older WHERE older.phoneNumberId=o.phoneNumberId AND older.waId=o.waId
      AND older.status IN ('PENDING','SENDING') AND older.sequence<o.sequence)
    ORDER BY o.sequence ASC LIMIT 20`);
  for(const candidate of candidates) {
    const row=await db.$transaction(async tx=>{
      const first=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM AssistantWaOutbox WHERE phoneNumberId=${candidate.phoneNumberId} AND waId=${candidate.waId} AND status IN ('PENDING','SENDING') ORDER BY sequence ASC LIMIT 1 FOR UPDATE`);
      if(first[0]?.id!==candidate.id)return null;
      const leaseToken=randomUUID();
      const changed=await tx.assistantWaOutbox.updateMany({where:{id:candidate.id,status:'PENDING'},data:{status:'SENDING',leaseToken,leaseUntil:new Date(now.getTime()+60_000),attempts:{increment:1}}});
      return changed.count===1?await tx.assistantWaOutbox.findUnique({where:{id:candidate.id}}):null;
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    if(!row)continue;
    let invoked=false;
    try {
      if(row.expiresAt<=now)throw new PrivateWhatsappError('PRIVATE_WA_REPLY_EXPIRED','La respuesta venció.',422);
      const {binding}=await requirePrivateWaBinding(row.bindingId,row.bindingVersion,db);
      if(binding.tenantId!==row.tenantId||binding.userId!==row.userId||binding.roleAtBinding!==row.roleAtCreation||binding.waId!==row.waId||binding.phoneNumberId!==row.phoneNumberId||row.phoneNumberId!==config.phoneNumberId)throw new PrivateWhatsappError('PRIVATE_WA_REVOKED','El vínculo cambió.',403);
      const sender=deps.sender??createPrivateWaSender(config);
      invoked=true;
      const result=await sender.send(row.waId,row.text);
      if(!result.messageId||result.messageId.length>191)throw new PrivateWhatsappError('PRIVATE_WA_SEND_UNKNOWN','Falta comprobar el envío.',503);
      await db.assistantWaOutbox.updateMany({where:{id:row.id,tenantId:row.tenantId,status:'SENDING',leaseToken:row.leaseToken},data:{status:'SENT',providerMessageId:result.messageId,errorCode:null,leaseToken:null,leaseUntil:null}});
    } catch {
      // Incluso HTTP 5xx o timeout puede ocurrir después de que Meta haya aceptado el mensaje.
      await db.assistantWaOutbox.updateMany({where:{id:row.id,tenantId:row.tenantId,status:'SENDING',leaseToken:row.leaseToken},data:{status:invoked?'UNKNOWN':'CANCELLED',errorCode:invoked?'SEND_UNCERTAIN':'SEND_NOT_AUTHORIZED',leaseToken:null,leaseUntil:null}});
    }
    return true;
  }
  return false;
}
