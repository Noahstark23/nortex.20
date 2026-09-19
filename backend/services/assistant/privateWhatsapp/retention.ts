import prisma from '../../../lib/prisma.js';
import type { PrivateWaDependencies } from './types.js';

/** Efímeros acotados; nunca toca propuestas, compras ni los originales conservados como evidencia. */
export async function cleanupPrivateWaHistory(deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma,now=deps.now?.()??new Date();let challenges=0,inbox=0,outbox=0;
  const codes=await db.assistantWaChallenge.findMany({where:{expiresAt:{lte:now},createdAt:{lte:new Date(now.getTime()-86400_000)}},take:100,select:{id:true,tenantId:true}});
  for(const row of codes)challenges+=(await db.assistantWaChallenge.deleteMany({where:{id:row.id,tenantId:row.tenantId,expiresAt:{lte:now}}})).count;
  // Primero salidas para preservar su relación con la entrada mientras son consultables.
  const outputs=await db.assistantWaOutbox.findMany({where:{createdAt:{lte:new Date(now.getTime()-30*86400_000)},status:{not:'SENDING'}},orderBy:{createdAt:'asc'},take:100,select:{id:true,tenantId:true,status:true}});
  for(const row of outputs)outbox+=(await db.assistantWaOutbox.deleteMany({where:{id:row.id,tenantId:row.tenantId,status:row.status,createdAt:{lte:new Date(now.getTime()-30*86400_000)}}})).count;
  const inputs=await db.assistantWaInbox.findMany({where:{expiresAt:{lte:now},OR:[{status:{not:'PROCESSING'}},{leaseUntil:{lte:now}}]},orderBy:{expiresAt:'asc'},take:100,select:{id:true,tenantId:true,status:true}});
  for(const row of inputs){if(await db.assistantWaOutbox.count({where:{inboxId:row.id}}))continue;inbox+=(await db.assistantWaInbox.deleteMany({where:{id:row.id,tenantId:row.tenantId,status:row.status,expiresAt:{lte:now},OR:[{status:{not:'PROCESSING'}},{leaseUntil:{lte:now}}]}})).count;}
  return {challenges,inbox,outbox};
}
