import { createHash,randomBytes } from 'node:crypto';
import { Prisma,type PrismaClient } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { assertAssistantAccess } from '../access.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { PrivateWhatsappError,privateWhatsappConfig,requirePrivateWhatsapp } from './config.js';
import type { PrivateWaDependencies,WaDatabase } from './types.js';

export const hashLinkCode=(code:string)=>createHash('sha256').update(code.toUpperCase()).digest('hex');
const actor=(binding:{tenantId:string;userId:string;roleAtBinding:string}):AssistantPrincipal=>({tenantId:binding.tenantId,userId:binding.userId,role:binding.roleAtBinding});

export async function issuePrivateWaChallenge(principal:AssistantPrincipal,deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma,config=deps.config??privateWhatsappConfig(),now=deps.now?.()??new Date();
  requirePrivateWhatsapp(config);await assertAssistantAccess(principal,'privateWhatsapp',db);
  const code=randomBytes(12).toString('hex').toUpperCase(),expiresAt=new Date(now.getTime()+10*60_000);
  await db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM User WHERE id=${principal.userId} AND tenantId=${principal.tenantId} FOR UPDATE`);
    await assertAssistantAccess(principal,'privateWhatsapp',tx as PrismaClient);
    const recent=await tx.assistantWaChallenge.count({where:{tenantId:principal.tenantId,userId:principal.userId,createdAt:{gte:new Date(now.getTime()-10*60_000)}}});
    if(recent>=5)throw new PrivateWhatsappError('PRIVATE_WA_RATE_LIMIT','Esperá unos minutos antes de pedir otro código.',429);
    await tx.assistantWaChallenge.updateMany({where:{tenantId:principal.tenantId,userId:principal.userId,consumedAt:null},data:{expiresAt:now}});
    await tx.assistantWaChallenge.create({data:{tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,codeHash:hashLinkCode(code),expiresAt,createdAt:now}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  const phone=config.displayPhone&&/^\+[1-9]\d{7,14}$/.test(config.displayPhone)?config.displayPhone:undefined;
  return {code,expiresAt:expiresAt.toISOString(),...(phone?{phone}:{}),instruction:`Desde tu WhatsApp personal, enviá VINCULAR ${code} ${phone?`al ${phone}`:'al número privado de Nortex configurado por tu administrador'}.`};
}

/** Vínculo server-side vigente; no convierte Customer, waId o un rol del texto en permisos. */
export async function requirePrivateWaBinding(id:string,version:number,db:WaDatabase=prisma) {
  const row=await db.assistantWaBinding.findFirst({where:{id,version,active:true}});
  if(!row)throw new PrivateWhatsappError('PRIVATE_WA_REVOKED','El vínculo privado ya no está disponible.',403);
  const principal=actor(row);await assertAssistantAccess(principal,'privateWhatsapp',db as PrismaClient);
  return {binding:row,principal};
}

/** La prueba combina código emitido por JWT con remitente de webhook firmado. El código crudo no se persiste. */
export async function consumePrivateWaChallenge(codeHash:string,phoneNumberId:string,waId:string,db:WaDatabase,now:Date) {
  const challenge=await db.assistantWaChallenge.findFirst({where:{codeHash,consumedAt:null,expiresAt:{gt:now}}});
  if(!challenge)throw new PrivateWhatsappError('PRIVATE_WA_CODE_INVALID','El código venció o ya fue utilizado.',403);
  const principal={tenantId:challenge.tenantId,userId:challenge.userId,role:challenge.roleAtCreation};
  await db.$queryRaw(Prisma.sql`SELECT id FROM User WHERE id=${principal.userId} AND tenantId=${principal.tenantId} FOR UPDATE`);
  await assertAssistantAccess(principal,'privateWhatsapp',db as PrismaClient);
  const used=await db.assistantWaChallenge.updateMany({where:{id:challenge.id,codeHash,consumedAt:null,expiresAt:{gt:now}},data:{consumedAt:now}});
  if(used.count!==1)throw new PrivateWhatsappError('PRIVATE_WA_CODE_INVALID','El código ya fue utilizado.',403);
  const occupied=await db.assistantWaBinding.findFirst({where:{phoneNumberId,waId}});
  if(occupied&&occupied.userId!==principal.userId)throw new PrivateWhatsappError('PRIVATE_WA_PHONE_BOUND','Ese número requiere revisión del administrador para cambiar de usuario.',409);
  const existing=await db.assistantWaBinding.findUnique({where:{userId:principal.userId}});
  // Siempre inicia conversación nueva; nunca recupera historial de otro vínculo o del canal comercial.
  const conversation=await db.assistantConversation.create({data:{tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,expiresAt:new Date(now.getTime()+30*86400_000)}});
  const data={tenantId:principal.tenantId,userId:principal.userId,roleAtBinding:principal.role,waId,phoneNumberId,active:true,revokedAt:null,conversationId:conversation.id};
  const binding=existing?await db.assistantWaBinding.update({where:{id:existing.id},data:{...data,version:{increment:1}}}):await db.assistantWaBinding.create({data});
  return {binding,principal};
}

export async function revokePrivateWaBinding(principal:AssistantPrincipal,deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma;
  const now=deps.now?.()??new Date();
  await db.$transaction(async tx=>{
    // Desvincular sigue disponible aunque se haya pausado el asistente.
    const actors=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM User WHERE id=${principal.userId} AND tenantId=${principal.tenantId} AND role=${principal.role} AND status='ACTIVE' FOR UPDATE`);
    if(!actors.length)throw new PrivateWhatsappError('PRIVATE_WA_REVOKED','Tu sesión cambió. Volvé a ingresar.',403);
    await tx.assistantWaChallenge.updateMany({where:{tenantId:principal.tenantId,userId:principal.userId,consumedAt:null},data:{expiresAt:now}});
    await tx.assistantWaBinding.updateMany({where:{tenantId:principal.tenantId,userId:principal.userId,active:true},data:{active:false,revokedAt:now,version:{increment:1}}});
    await tx.assistantWaOutbox.updateMany({where:{tenantId:principal.tenantId,userId:principal.userId,status:'PENDING'},data:{status:'CANCELLED',errorCode:'PRIVATE_WA_REVOKED'}});
  });
  return {revoked:true};
}

export async function getPrivateWaBinding(principal:AssistantPrincipal,deps:PrivateWaDependencies={}) {
  const db=deps.db??prisma;await assertAssistantAccess(principal,'help',db);
  const row=await db.assistantWaBinding.findFirst({where:{tenantId:principal.tenantId,userId:principal.userId,active:true,roleAtBinding:principal.role}});
  return {linked:!!row,...(row?{phoneSuffix:row.waId.slice(-4),linkedAt:row.updatedAt.toISOString()}: {})};
}
