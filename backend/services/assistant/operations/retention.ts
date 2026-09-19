import type { PrismaClient } from '@prisma/client';
import prisma from '../../../lib/prisma.js';

/** Borra trabajo efímero en lotes acotados; nunca elimina comprobantes financieros. */
export async function cleanupAssistantOperations(db: PrismaClient = prisma, now = new Date()) {
  const runs = await db.assistantRun.findMany({where:{expiresAt:{lte:now}},orderBy:{expiresAt:'asc'},select:{id:true,tenantId:true},take:100});
  let deletedRuns=0,deletedBriefs=0,deletedProposals=0;
  for(const row of runs) deletedRuns+=(await db.assistantRun.deleteMany({where:{id:row.id,tenantId:row.tenantId,expiresAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]}})).count;
  const briefs=await db.assistantDailyBrief.findMany({where:{expiresAt:{lte:now}},orderBy:{expiresAt:'asc'},select:{id:true,tenantId:true},take:100});
  for(const row of briefs) deletedBriefs+=(await db.assistantDailyBrief.deleteMany({where:{id:row.id,tenantId:row.tenantId,expiresAt:{lte:now}}})).count;
  const proposals=await db.assistantActionProposal.findMany({where:{expiresAt:{lte:now},status:{in:['DRAFT','READY','CANCELLED','EXPIRED']},operationId:null},orderBy:{expiresAt:'asc'},select:{id:true,tenantId:true},take:100});
  for(const row of proposals) deletedProposals+=(await db.assistantActionProposal.deleteMany({where:{id:row.id,tenantId:row.tenantId,expiresAt:{lte:now},status:{in:['DRAFT','READY','CANCELLED','EXPIRED']},operationId:null}})).count;
  return {runs:deletedRuns,briefs:deletedBriefs,proposals:deletedProposals};
}
