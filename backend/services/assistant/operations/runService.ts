import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AssistantRun } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantRunDTO } from '../../../../shared/assistantOperations.js';
import { assertAssistantAccess } from '../access.js';
import { runAssistantOrchestrator, MAX_OPERATION_DURATION_MS } from './orchestrator.js';
import { AssistantRunError, type OperationTool, type RunCheckpoint } from './contracts.js';
import { readRunCheckpoint, runInputSchema, runResultSchema } from './runValidation.js';

type Database=PrismaClient|Prisma.TransactionClient;
export interface RunDependencies { db?:PrismaClient; now?:()=>Date; tools?:OperationTool[]; orchestrate?:typeof runAssistantOrchestrator }
const owner=(principal:AssistantPrincipal)=>({tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role});
const asJson=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function requireConversation(principal:AssistantPrincipal,conversationId:string,db:Database,now:Date) {
  await assertAssistantAccess(principal,'operations',db as PrismaClient);
  const conversation=await db.assistantConversation.findFirst({where:{id:conversationId,...owner(principal),expiresAt:{gt:now}}});
  if(!conversation)throw new AssistantRunError(404,'RUN_CONVERSATION_NOT_FOUND','Esta conversación ya no está disponible.');
  return conversation;
}
function toDTO(row:AssistantRun):AssistantRunDTO {
  const checkpoint=readRunCheckpoint(row.checkpoint);
  return {id:row.id,conversationId:row.conversationId,requestId:row.requestId,status:row.status as AssistantRunDTO['status'],version:row.version,iterations:row.iterations,
    steps:checkpoint.steps,...(row.result?{result:runResultSchema.parse(row.result)}:{}),...(row.errorCode?{errorCode:row.errorCode}:{}),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
async function readableDTO(principal:AssistantPrincipal,row:AssistantRun,db:Database):Promise<AssistantRunDTO> {
  const dto=toDTO(row),checkpoint=readRunCheckpoint(row.checkpoint);
  const {readAssistantRunActionReferences}=await import('../actions/service.js');
  const references=await readAssistantRunActionReferences(principal,row.id,[...new Set([...(dto.result?.actionProposalIds??[]),...checkpoint.actionProposalIds])],db);
  if(dto.result||references.length) {
    const previous=dto.result??{text:'La consulta se interrumpió. Conservé los borradores preparados para revisión; ninguna acción fue confirmada.',evidence:checkpoint.evidence,actionProposalIds:[],degraded:true};
    const allowed=new Set(references);
    dto.result={...previous,actionProposalIds:references,evidence:previous.evidence.filter(item=>!item.tool.startsWith('prepare_')||(item.data&&typeof item.data==='object'&&!Array.isArray(item.data)&&typeof item.data.id==='string'&&allowed.has(item.data.id)))};
  }
  return dto;
}
async function findRun(principal:AssistantPrincipal,id:string,db:PrismaClient,now:Date) {
  await assertAssistantAccess(principal,'operations',db);
  const row=await db.assistantRun.findFirst({where:{id,...owner(principal),expiresAt:{gt:now}}});
  if(!row)throw new AssistantRunError(404,'RUN_NOT_FOUND','No encontramos esa ejecución para tu sesión.');
  await requireConversation(principal,row.conversationId,db,now);return row;
}
export async function getAssistantRun(principal:AssistantPrincipal,id:string,deps:RunDependencies={}):Promise<AssistantRunDTO> {
  const db=deps.db??prisma,row=await findRun(principal,id,db,deps.now?.()??new Date());
  const dto=await readableDTO(principal,row,db);await assertAssistantAccess(principal,'operations',db);return dto;
}
export async function listAssistantRuns(principal:AssistantPrincipal,conversationId:string,deps:RunDependencies={}):Promise<AssistantRunDTO[]> {
  const db=deps.db??prisma,now=deps.now?.()??new Date();await requireConversation(principal,conversationId,db,now);
  const rows=await db.assistantRun.findMany({where:{...owner(principal),conversationId,expiresAt:{gt:now}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:10});
  const results=await Promise.all(rows.map(row=>readableDTO(principal,row,db)));
  await assertAssistantAccess(principal,'operations',db);return results;
}
export async function createAssistantRunInTransaction(principal:AssistantPrincipal,conversationId:string,raw:unknown,tx:Prisma.TransactionClient,now=new Date()):Promise<AssistantRunDTO> {
    const input=runInputSchema.parse(raw),payloadHash=createHash('sha256').update(input.text).digest('hex');
    const lock=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM AssistantConversation WHERE id=${conversationId} AND tenantId=${principal.tenantId} AND userId=${principal.userId} AND roleAtCreation=${principal.role} AND expiresAt>${now} FOR UPDATE`);
    if(!lock.length)throw new AssistantRunError(404,'RUN_CONVERSATION_NOT_FOUND','La conversación ya no está disponible.');
    // En MySQL REPEATABLE READ la primera lectura consistente debe ocurrir después del lock.
    const conversation=await requireConversation(principal,conversationId,tx,now);
    await assertAssistantAccess(principal,'operations',tx as PrismaClient);
    const previous=await tx.assistantRun.findFirst({where:{conversationId,requestId:input.requestId,...owner(principal)}});
    if(previous){if(previous.payloadHash!==payloadHash)throw new AssistantRunError(409,'RUN_REQUEST_CONFLICT','El identificador ya corresponde a otra consulta.');return toDTO(previous);}
    return toDTO(await tx.assistantRun.create({data:{...owner(principal),conversationId,requestId:input.requestId,inputText:input.text,payloadHash,status:'PENDING',expiresAt:conversation.expiresAt}}));
}
export async function createAssistantRun(principal:AssistantPrincipal,conversationId:string,raw:unknown,deps:RunDependencies={}):Promise<AssistantRunDTO> {
  const db=deps.db??prisma,now=deps.now?.()??new Date();await assertAssistantAccess(principal,'operations',db);
  const result=await db.$transaction(tx=>createAssistantRunInTransaction(principal,conversationId,raw,tx,now));
  await assertAssistantAccess(principal,'operations',db);return result.status==='PENDING'?result:getAssistantRun(principal,result.id,deps);
}

export async function executeAssistantRun(principal:AssistantPrincipal,conversationId:string,raw:unknown,deps:RunDependencies={}):Promise<AssistantRunDTO> {
  const db=deps.db??prisma,now=deps.now??(()=>new Date());
  const created=await createAssistantRun(principal,conversationId,raw,deps);
  if(created.status!=='PENDING')return created;
  const leaseToken=randomUUID(),deadlineAt=new Date(now().getTime()+MAX_OPERATION_DURATION_MS);
  const claim=await db.assistantRun.updateMany({where:{id:created.id,...owner(principal),status:'PENDING',version:created.version,expiresAt:{gt:now()}},data:{status:'RUNNING',version:{increment:1},leaseToken,startedAt:now(),deadlineAt,leaseUntil:new Date(deadlineAt.getTime()+5000)}});
  if(claim.count!==1)return getAssistantRun(principal,created.id,deps);
  let version=created.version+1;
  const guard=()=>({id:created.id,...owner(principal),status:'RUNNING',version,leaseToken,expiresAt:{gt:now()}});
  const assertActive=async()=>{
    await requireConversation(principal,conversationId,db,now());
    const active=await db.assistantRun.findFirst({where:{...guard(),leaseUntil:{gt:now()}}});
    if(!active)throw new AssistantRunError(409,'RUN_INACTIVE','La ejecución fue cancelada o cambió.');
  };
  const onCheckpoint=async(checkpoint:RunCheckpoint)=>{
    await assertActive();
    const changed=await db.assistantRun.updateMany({where:guard(),data:{checkpoint:asJson(checkpoint),iterations:checkpoint.iterations,version:{increment:1}}});
    if(changed.count!==1)throw new AssistantRunError(409,'RUN_INACTIVE','La ejecución cambió.');version++;
  };
  try {
    const rows=await db.assistantMessage.findMany({where:{tenantId:principal.tenantId,userId:principal.userId,conversationId,role:'user'},orderBy:{createdAt:'desc'},take:4});
    const history=rows.reverse().flatMap(row=>row.content&&typeof row.content==='object'&&!Array.isArray(row.content)&&typeof row.content.text==='string'?[row.content.text]:[]);
    const tools=deps.tools??await (await import('./tools.js')).createOperationTools(principal,{db});
    const allowed=new Set(tools.map(tool=>tool.name));
    const previousRows=await db.assistantRun.findMany({where:{...owner(principal),conversationId,status:'SUCCEEDED',id:{not:created.id},expiresAt:{gt:now()}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:2});
    const previousResults=previousRows.flatMap(row=>{
      const parsed=runResultSchema.safeParse(row.result);
      if(!parsed.success||parsed.data.evidence.some(item=>!allowed.has(item.tool))||JSON.stringify(parsed.data).length>24000)return [];
      return [{runId:row.id,recordedAt:row.updatedAt.toISOString(),stale:true as const,refreshRequiredBeforePreparation:true as const,result:parsed.data}];
    });
    const result=await (deps.orchestrate??runAssistantOrchestrator)({principal,conversationId,runId:created.id,text:runInputSchema.parse(raw).text,history,previousResults,deadlineAt},{tools,db,now,assertActive,onCheckpoint});
    await assertActive();
    const ended=await db.$transaction(async tx=>{
      await requireConversation(principal,conversationId,tx,now());
      return tx.assistantRun.updateMany({where:guard(),data:{status:'SUCCEEDED',version:{increment:1},result:asJson(result),leaseToken:null,leaseUntil:null}});
    });
    if(ended.count!==1)throw new AssistantRunError(409,'RUN_INACTIVE','La ejecución cambió.');
  } catch(error) {
    await db.assistantRun.updateMany({where:guard(),data:{status:'FAILED',version:{increment:1},errorCode:error instanceof AssistantRunError?error.code:'RUN_FAILED',leaseToken:null,leaseUntil:null}});
    await assertAssistantAccess(principal,'operations',db);
  }
  return getAssistantRun(principal,created.id,deps);
}
export async function cancelAssistantRun(principal:AssistantPrincipal,id:string,expectedVersion:number,deps:RunDependencies={}):Promise<AssistantRunDTO> {
  const db=deps.db??prisma,now=deps.now?.()??new Date(),row=await findRun(principal,id,db,now);
  if(row.status==='CANCELLED')return getAssistantRun(principal,id,deps);
  if(row.version!==expectedVersion||!['PENDING','RUNNING'].includes(row.status))throw new AssistantRunError(409,'RUN_CHANGED','Actualizá la ejecución antes de cancelarla.');
  const changed=await db.assistantRun.updateMany({where:{id,...owner(principal),version:expectedVersion,status:{in:['PENDING','RUNNING']}},data:{status:'CANCELLED',version:{increment:1},leaseToken:null,leaseUntil:null,errorCode:'RUN_CANCELLED'}});
  if(changed.count!==1)throw new AssistantRunError(409,'RUN_CHANGED','La ejecución cambió.');
  return getAssistantRun(principal,id,deps);
}
/** Recupera el resultado durable; un intento abandonado nunca repite herramientas preparatorias. */
export async function recoverAssistantRun(principal:AssistantPrincipal,id:string,deps:RunDependencies={}):Promise<AssistantRunDTO> {
  const db=deps.db??prisma,now=deps.now?.()??new Date(),row=await findRun(principal,id,db,now);
  if(row.status==='RUNNING'&&row.leaseUntil&&row.leaseUntil<=now) {
    await db.assistantRun.updateMany({where:{id,...owner(principal),status:'RUNNING',version:row.version,leaseUntil:{lte:now}},data:{status:'FAILED',version:{increment:1},errorCode:'RUN_INTERRUPTED',leaseToken:null,leaseUntil:null}});
  }
  return getAssistantRun(principal,id,deps);
}

export async function processAssistantRun(principal:AssistantPrincipal,id:string,deps:RunDependencies={}):Promise<AssistantRunDTO> {
  const row=await findRun(principal,id,deps.db??prisma,deps.now?.()??new Date());
  if(row.status!=='PENDING')return recoverAssistantRun(principal,id,deps);
  return executeAssistantRun(principal,row.conversationId,{requestId:row.requestId,text:row.inputText},deps);
}

/** Un trabajo PENDING nunca ejecutó herramientas; los abandonados sólo se marcan interrumpidos. */
export async function runPendingAssistantRunOnce(deps:RunDependencies={}):Promise<boolean> {
  if(process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED!=='true')return false;
  const db=deps.db??prisma,now=deps.now?.()??new Date();
  const row=await db.assistantRun.findFirst({where:{expiresAt:{gt:now},OR:[{status:'PENDING'},{status:'RUNNING',leaseUntil:{lte:now}}]},orderBy:{createdAt:'asc'}});
  if(!row)return false;
  const principal={tenantId:row.tenantId,userId:row.userId,role:row.roleAtCreation};
  try {await processAssistantRun(principal,row.id,deps);}
  catch {
    await db.assistantRun.updateMany({where:{id:row.id,...owner(principal),version:row.version,status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',version:{increment:1},errorCode:'RUN_ACCESS_CHANGED',leaseToken:null,leaseUntil:null}});
  }
  return true;
}
