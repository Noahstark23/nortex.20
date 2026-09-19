import { randomUUID } from 'node:crypto';
import { Prisma,type PrismaClient,type AssistantWaInbox } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { assertAssistantAccess } from '../access.js';
import { saveAssistantAttachment } from '../attachments.js';
import { enqueueInvoiceExtraction } from '../worker.js';
import { sendAssistantMessage } from '../conversations.js';
import { claimPrivateWaInbox } from './inbox.js';
import { consumePrivateWaChallenge,requirePrivateWaBinding } from './identity.js';
import { authenticatedReviewLink,privateWhatsappConfig,PrivateWhatsappError } from './config.js';
import { createPrivateWaMediaDownloader } from './transport.js';
import type { PrivateWaDependencies,WaMessagePayload,WaDatabase } from './types.js';
import { resolvePrivateWaOperationalRun,renderPrivateWaOperationalReply,renderPrivateWaReply } from './operations.js';
export { renderPrivateWaReply } from './operations.js';

const expiry=(payload:WaMessagePayload)=>new Date(Number(payload.timestamp)*1000+23*60*60_000);
const activeLease=(row:AssistantWaInbox,now:Date)=>({id:row.id,status:'PROCESSING',leaseToken:row.leaseToken,leaseUntil:{gt:now}});
function checkSource(row:AssistantWaInbox,binding:{id:string;tenantId:string;userId:string;roleAtBinding:string;phoneNumberId:string;waId:string}) {
  if(row.bindingId!==binding.id||row.tenantId!==binding.tenantId||row.userId!==binding.userId||row.roleAtReceipt!==binding.roleAtBinding||row.phoneNumberId!==binding.phoneNumberId||row.waId!==binding.waId)throw new PrivateWhatsappError('PRIVATE_WA_REVOKED','La identidad del mensaje ya no está vigente.',403);
}
async function ensureConversation(binding:{id:string;version:number;conversationId:string|null},principal:AssistantPrincipal,db:PrismaClient,now:Date,requireExisting=false) {
  return db.$transaction(async tx=>{
    await requirePrivateWaBinding(binding.id,binding.version,tx);
    const existing=binding.conversationId?await tx.assistantConversation.findFirst({where:{id:binding.conversationId,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,expiresAt:{gt:now}}}):null;
    if(existing)return existing.id;
    if(requireExisting)throw new PrivateWhatsappError('PRIVATE_WA_CONVERSATION_EXPIRED','La conversación anterior venció. No se repetirá su consulta en otro historial.',404);
    const created=await tx.assistantConversation.create({data:{tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,expiresAt:new Date(now.getTime()+30*86400_000)}});
    const changed=await tx.assistantWaBinding.updateMany({where:{id:binding.id,version:binding.version,active:true},data:{conversationId:created.id}});
    if(changed.count!==1)throw new PrivateWhatsappError('PRIVATE_WA_REVOKED','El vínculo cambió.',403);
    return created.id;
  });
}

async function finishInbox(row:AssistantWaInbox,text:string,db:WaDatabase,now:Date,binding:{id:string;version:number;tenantId:string;userId:string;roleAtBinding:string;phoneNumberId:string;waId:string}) {
  await requirePrivateWaBinding(binding.id,binding.version,db);
  const done=await db.assistantWaInbox.updateMany({where:activeLease(row,now),data:{status:'DONE',leaseToken:null,leaseUntil:null,errorCode:null,bindingId:binding.id,bindingVersion:binding.version,tenantId:binding.tenantId,userId:binding.userId,roleAtReceipt:binding.roleAtBinding}});
  if(done.count!==1)throw new PrivateWhatsappError('PRIVATE_WA_LEASE_LOST','Otro intento retomó el mensaje.',409);
  await db.assistantWaOutbox.create({data:{id:randomUUID(),inboxId:row.id,bindingId:binding.id,bindingVersion:binding.version,tenantId:binding.tenantId,userId:binding.userId,roleAtCreation:binding.roleAtBinding,phoneNumberId:binding.phoneNumberId,waId:binding.waId,text,status:'PENDING',expiresAt:expiry(row.payload as unknown as WaMessagePayload)}});
}

export async function processPrivateWaInboxOnce(deps:PrivateWaDependencies={}) {
  const config=deps.config??privateWhatsappConfig();if(!config.enabled)return false;
  const db=deps.db??prisma,now=deps.now?.()??new Date(),row=await claimPrivateWaInbox(deps);
  if(!row)return false;
  try {
    if(row.attempts>3)throw new PrivateWhatsappError('PRIVATE_WA_ATTEMPTS','El mensaje agotó los intentos.',422);
    const payload=row.payload as unknown as WaMessagePayload;
    if(expiry(payload)<=now)throw new PrivateWhatsappError('PRIVATE_WA_REPLY_EXPIRED','El mensaje ya no admite respuesta automática.',422);
    if(row.kind==='LINK') {
      await db.$transaction(async tx=>{
        const current=await tx.assistantWaInbox.updateMany({where:activeLease(row,deps.now?.()??new Date()),data:{errorCode:null}});
        if(current.count!==1)throw new PrivateWhatsappError('PRIVATE_WA_LEASE_LOST','Otro intento retomó el mensaje.',409);
        const {binding}=await consumePrivateWaChallenge(payload.codeHash!,row.phoneNumberId,row.waId,tx,now);
        await finishInbox(row,`Tu WhatsApp quedó vinculado a tu usuario de Nortex. Los permisos de tu rol siguen vigentes. Revisá y confirmá operaciones en tu sesión: ${authenticatedReviewLink(config,binding.conversationId!)}`,tx,deps.now?.()??new Date(),binding);
      });
    } else {
      if(!row.bindingId||!row.bindingVersion)throw new PrivateWhatsappError('PRIVATE_WA_REVOKED','Vinculá primero tu usuario desde Nortex.',403);
      const {binding,principal}=await requirePrivateWaBinding(row.bindingId,row.bindingVersion,db);checkSource(row,binding);
      const conversationId=await ensureConversation(binding,principal,db,now,row.kind==='TEXT'&&(row.attempts>1||row.errorCode==='PRIVATE_WA_WAITING_RUN'));
      let text:string;
      if(row.kind==='TEXT') {
        const reply=await (deps.answer??sendAssistantMessage)(principal,conversationId,{text:payload.text!,requestId:row.id},db);
        if(reply.operationalRunId) {
          await requirePrivateWaBinding(binding.id,binding.version,db);
          const run=await (deps.resolveRun??resolvePrivateWaOperationalRun)(principal,reply.operationalRunId,db);
          if(run.id!==reply.operationalRunId||run.conversationId!==conversationId||run.requestId!==row.id)throw new PrivateWhatsappError('PRIVATE_WA_RUN_MISMATCH','La consulta no corresponde a este mensaje.',409);
          if(run.status==='PENDING'||run.status==='RUNNING') {
            await db.$transaction(async tx=>{
              const current=await requirePrivateWaBinding(binding.id,binding.version,tx);checkSource(row,current.binding);
              const updated=await tx.assistantWaInbox.updateMany({where:{...activeLease(row,deps.now?.()??new Date()),tenantId:principal.tenantId,userId:principal.userId,bindingVersion:binding.version},data:{status:'PENDING',leaseToken:null,leaseUntil:null,availableAt:new Date((deps.now?.()??new Date()).getTime()+2000),attempts:{decrement:1},errorCode:'PRIVATE_WA_WAITING_RUN'}});
              if(updated.count!==1)throw new PrivateWhatsappError('PRIVATE_WA_LEASE_LOST','Otro intento retomó el mensaje.',409);
            });
            return true;
          }
          text=renderPrivateWaOperationalReply(run,authenticatedReviewLink(config,conversationId));
        } else text=renderPrivateWaReply(reply,authenticatedReviewLink(config,conversationId));
      } else if(row.kind==='MEDIA') {
        await assertAssistantAccess(principal,'invoicePrepare',db);
        let attachmentId=row.attachmentId;
        if(!attachmentId) {
          const file=await (deps.download??createPrivateWaMediaDownloader(config))(payload.mediaId!);
          if(file.mediaType!==payload.mediaType)throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_METADATA','El formato recibido no coincide con el documento.',422);
          await requirePrivateWaBinding(binding.id,binding.version,db);
          const saved=await saveAssistantAttachment(principal,file.bytes,file.mediaType,payload.name??file.name,{db,storageRoot:deps.storageRoot,now:deps.now});
          const updated=await db.assistantWaInbox.updateMany({where:activeLease(row,deps.now?.()??new Date()),data:{attachmentId:saved.id}});
          if(updated.count!==1)throw new PrivateWhatsappError('PRIVATE_WA_LEASE_LOST','Otro intento retomó el documento.',409);
          attachmentId=saved.id;
        }
        // Identidad estable: reiniciar después de crear el job no duplica extracción ni gasto.
        let job=await db.assistantJob.findFirst({where:{id:row.id,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role}});
        if(!job){await enqueueInvoiceExtraction(principal,[attachmentId],{db,jobId:row.id,now:deps.now},conversationId);job=await db.assistantJob.findFirst({where:{id:row.id,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role}});}
        if(!job)throw new PrivateWhatsappError('PRIVATE_WA_JOB','No se pudo recuperar la lectura.',503);
        await db.assistantWaInbox.updateMany({where:activeLease(row,deps.now?.()??new Date()),data:{extractionJobId:job.id}});
        const url=new URL(authenticatedReviewLink(config,conversationId));url.searchParams.set('assistantExtraction',job.id);
        text=`Recibí el documento y preparé su lectura. Esto todavía no registra la compra, recepción ni pago. Revisá el resultado y los datos pendientes desde tu sesión: ${url.toString()}`;
      } else throw new PrivateWhatsappError('PRIVATE_WA_UNSUPPORTED','Ese tipo de mensaje no está disponible.',422);
      await db.$transaction(async tx=>{const current=await requirePrivateWaBinding(binding.id,binding.version,tx);checkSource(row,current.binding);await finishInbox(row,text,tx,deps.now?.()??new Date(),current.binding);});
    }
  } catch(error) {
    const code=error&&typeof error==='object'&&'code'in error?String(error.code):'PRIVATE_WA_PROCESSING_FAILED';
    const status=error&&typeof error==='object'&&'statusCode'in error?Number(error.statusCode):503;
    const retry=status>=500&&row.attempts<3;
    await db.assistantWaInbox.updateMany({where:{id:row.id,status:'PROCESSING',leaseToken:row.leaseToken},data:{status:retry?'PENDING':'FAILED',leaseToken:null,leaseUntil:null,errorCode:code.slice(0,64),availableAt:new Date((deps.now?.()??new Date()).getTime()+row.attempts*30_000)}});
  }
  return true;
}
