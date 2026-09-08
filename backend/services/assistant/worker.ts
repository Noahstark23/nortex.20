import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { assertAssistantAccess } from './access.js';
import { AssistantDocumentError, readAssistantAttachment, MAX_ATTACHMENT_BYTES, MAX_INVOICE_PAGES, type AttachmentDependencies } from './attachments.js';
import { validateInvoiceFile } from './extraction.js';
import { createExtractionProvider, type ExtractionProvider } from './provider.js';
import { createPurchaseDocumentContext, parsePurchaseDocumentContext, hasSamePurchaseDocumentFacts, mergePurchaseDocumentContext, type PurchaseDocumentIntake, type PurchaseDocumentContext } from './purchaseDocumentContext.js';
import type { AssistantPrincipal, AssistantJobDTO } from '../../../shared/assistant.js';

const idsSchema=z.array(z.string().min(1).max(191)).min(1).max(10).refine(ids=>new Set(ids).size===ids.length);
export const EXTRACTION_LEASE_MS=180_000;
export const MAX_EXTRACTION_ATTEMPTS=2;
const RETRYABLE=new Set(['PROVIDER_UNAVAILABLE','STORAGE_UNAVAILABLE']);
type IntakeDatabase = typeof prisma | Prisma.TransactionClient;
export interface WorkerDependencies extends AttachmentDependencies {
  /** Identidad emitida por un transporte interno durable; nunca proviene del cuerpo HTTP. */
  jobId?:string;
  provider?:ExtractionProvider;
  createProposal?:typeof import('./proposals.js').createProposalFromExtraction;
  readIntake?:(principal:AssistantPrincipal,conversationId:string,db:IntakeDatabase)=>Promise<PurchaseDocumentIntake|null>;
  attachDocumentProposal?:(principal:AssistantPrincipal,conversationId:string,intakeId:string,proposalId:string,db:Prisma.TransactionClient,expectedStateVersion?:number)=>Promise<unknown>;
}

async function readDocumentIntake(principal:AssistantPrincipal,conversationId:string,db:IntakeDatabase,deps:WorkerDependencies) {
  const read=deps.readIntake??(await import('./purchaseIntake.js')).readPurchaseIntakeForDocument;
  return read(principal,conversationId,db);
}

async function revalidateDocumentContext(principal:AssistantPrincipal,context:PurchaseDocumentContext|null,db:IntakeDatabase,deps:WorkerDependencies) {
  if(!context) return null;
  const current=await readDocumentIntake(principal,context.conversationId,db,deps);
  if(!hasSamePurchaseDocumentFacts(context,current)) throw new AssistantDocumentError('DOCUMENT_CONTEXT_CHANGED','Lo declarado en el chat cambió. Retomá la compra y volvé a leer la factura.',409);
  return current;
}

function jobDTO(row:{id:string;status:string;proposalId?:string|null;errorCode?:string|null}):AssistantJobDTO {
  return {id:row.id,status:row.status as AssistantJobDTO['status'],...(row.proposalId?{proposalId:row.proposalId}:{}),...(row.errorCode?{error:row.errorCode}: {})};
}
export async function enqueueInvoiceExtraction(principal:AssistantPrincipal,attachmentIds:unknown,deps:WorkerDependencies={},conversationId?:string):Promise<AssistantJobDTO> {
  const db=deps.db??prisma, ids=idsSchema.safeParse(attachmentIds);
  if(!ids.success) throw new AssistantDocumentError('DOCUMENT_IDS','Seleccioná entre 1 y 10 archivos de la misma factura.',400);
  await assertAssistantAccess(principal,'invoicePrepare',db);
  const now=deps.now?.()??new Date();
  const attachments=await db.assistantAttachment.findMany({where:{id:{in:ids.data},tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,purchaseId:null,status:{in:['UPLOADED','VALIDATED']},expiresAt:{gt:now}},take:10});
  if(attachments.length!==ids.data.length) throw new AssistantDocumentError('ATTACHMENT_NOT_FOUND','Una de las facturas no está disponible.',404);
  if(new Set(attachments.map(row=>row.sha256)).size!==attachments.length) throw new AssistantDocumentError('DUPLICATE_PAGE','La factura contiene el mismo archivo más de una vez.');
  if(attachments.reduce((sum,row)=>sum+row.bytes,0)>MAX_ATTACHMENT_BYTES || attachments.reduce((sum,row)=>sum+row.pages,0)>MAX_INVOICE_PAGES) throw new AssistantDocumentError('DOCUMENT_LIMIT','La factura excede 10 MB o 10 páginas.');
  const intake=conversationId?await readDocumentIntake(principal,conversationId,db,deps):null;
  const context=intake?createPurchaseDocumentContext(conversationId!,intake):null;
  const job=await db.assistantJob.create({data:{...(deps.jobId?{id:z.string().uuid().parse(deps.jobId)}:{}),tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,attachmentIds:ids.data,availableAt:now,
    ...(context?{intakeContext:JSON.parse(JSON.stringify(context)) as Prisma.InputJsonValue}:{}),
  }});
  return jobDTO(job);
}
export async function getInvoiceExtraction(principal:AssistantPrincipal,id:string,deps:WorkerDependencies={}):Promise<AssistantJobDTO> {
  const db=deps.db??prisma;
  await assertAssistantAccess(principal,'invoiceRead',db);
  const job=await db.assistantJob.findFirst({where:{id,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role}});
  if(!job) throw new AssistantDocumentError('JOB_NOT_FOUND','No se encontró la lectura de factura.',404);
  return jobDTO(job);
}

/** CAS + lease durable. El ejecutable procesa uno a la vez; jamás registra compras. */
export async function runAssistantWorkerOnce(deps:WorkerDependencies={}):Promise<boolean> {
  const db=deps.db??prisma, now=deps.now?.()??new Date();
  const eligible={OR:[{status:'PENDING',availableAt:{lte:now}},{status:'PROCESSING',leaseUntil:{lte:now}}]};
  const candidate=await db.assistantJob.findFirst({where:eligible,orderBy:{availableAt:'asc'}});
  if(!candidate) return false;
  const leaseToken=randomUUID();
  const claim=await db.assistantJob.updateMany({where:{id:candidate.id,tenantId:candidate.tenantId,...eligible},data:{status:'PROCESSING',leaseToken,leaseUntil:new Date(now.getTime()+EXTRACTION_LEASE_MS),attempts:{increment:1}}});
  if(claim.count!==1) return false;
  const principal={tenantId:candidate.tenantId,userId:candidate.userId,role:candidate.roleAtCreation};
  const attempt=candidate.attempts+1;
  try {
    await assertAssistantAccess(principal,'invoicePrepare',db);
    if(attempt>MAX_EXTRACTION_ATTEMPTS) throw new AssistantDocumentError('ATTEMPTS_EXHAUSTED','La lectura agotó sus intentos.');
    const context=parsePurchaseDocumentContext(candidate.intakeContext);
    const ids=idsSchema.parse(candidate.attachmentIds);
    const files=[];
    let totalBytes=0,totalPages=0;
    const hashes=new Set<string>();
    for(const id of ids) {
      const attachment=await readAssistantAttachment(principal,id,deps);
      if(hashes.has(attachment.row.sha256)) throw new AssistantDocumentError('DUPLICATE_PAGE','La factura contiene el mismo archivo más de una vez.');
      hashes.add(attachment.row.sha256);
      const verified=await validateInvoiceFile(attachment.bytes,attachment.row.mediaType);
      totalBytes+=verified.bytes.length;totalPages+=verified.pages;
      if(totalBytes>MAX_ATTACHMENT_BYTES || totalPages>MAX_INVOICE_PAGES) throw new AssistantDocumentError('DOCUMENT_LIMIT','La factura excede 10 MB o 10 páginas.');
      await db.assistantAttachment.updateMany({where:{id,tenantId:principal.tenantId,userId:principal.userId,purchaseId:null,status:{in:['UPLOADED','VALIDATED']}},data:{status:'VALIDATED',pages:verified.pages}});
      files.push(verified);
    }
    await assertAssistantAccess(principal,'invoicePrepare',db);
    await revalidateDocumentContext(principal,context,db,deps);
    const extracted=await (deps.provider??createExtractionProvider({db})).extract(principal,files);
    const draft=mergePurchaseDocumentContext(extracted,context);
    const createProposal=deps.createProposal??(await import('./proposals.js')).createProposalFromExtraction;
    await db.$transaction(async tx=>{
      await assertAssistantAccess(principal,'invoicePrepare',tx as typeof prisma);
      const current=await revalidateDocumentContext(principal,context,tx,deps);
      const active=await tx.assistantJob.updateMany({where:{id:candidate.id,tenantId:principal.tenantId,leaseToken,status:'PROCESSING',leaseUntil:{gt:deps.now?.()??new Date()}},data:{errorCode:null}});
      if(active.count!==1) throw new AssistantDocumentError('LEASE_LOST','Otro intento retomó la lectura.',409);
      const proposal=await createProposal(principal,draft,ids,{db:tx,id:candidate.id,
        ...(context?.draft.paymentMethod?{declaredPaymentMethod:context.draft.paymentMethod}:{}),
      });
      if(context&&current) {
        const attach=deps.attachDocumentProposal??(await import('./purchaseIntake.js')).attachDocumentProposalToIntake;
        await attach(principal,context.conversationId,context.intakeId,proposal.id,tx,current.stateVersion);
      }
      await tx.assistantJob.updateMany({where:{id:candidate.id,tenantId:principal.tenantId,leaseToken,status:'PROCESSING'},data:{status:'SUCCEEDED',proposalId:proposal.id,errorCode:null,leaseToken:null,leaseUntil:null}});
    });
  } catch(error) {
    const code=error instanceof AssistantDocumentError ? error.code : (typeof (error as {code?:unknown})?.code==='string'?(error as {code:string}).code:'EXTRACTION_FAILED');
    const retry=RETRYABLE.has(code) && attempt<MAX_EXTRACTION_ATTEMPTS;
    await db.assistantJob.updateMany({where:{id:candidate.id,tenantId:principal.tenantId,leaseToken,status:'PROCESSING'},data:{status:retry?'PENDING':'FAILED',errorCode:code.slice(0,64),leaseToken:null,leaseUntil:null,availableAt:new Date((deps.now?.()??new Date()).getTime()+attempt*30_000)}});
  }
  return true;
}
