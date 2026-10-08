import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { getAssistantHealthStatus } from '../backend/services/assistant/operations/healthStatus';
const qa=process.env.NORTEX_MYSQL_INTEGRATION==='1'?describe.sequential:describe.skip;
const now=new Date('2026-09-01T04:00:00Z'),createdAt=new Date('2026-08-31T12:00:00Z'),expiresAt=new Date('2026-09-30T00:00:00Z');
const deps={db:prisma,now:()=>now};
const marker='PRIVATE_STATUS_CONTENT_NOT_FOR_RESPONSE';
async function seed(role='OWNER') {
  const tenant=await prisma.tenant.create({data:{businessName:'QA estado sintético',taxId:randomUUID()}});
  const user=await prisma.user.create({data:{tenantId:tenant.id,name:'QA administración',role,password:'NOT_A_LOGIN_ACCOUNT'}});
  await prisma.assistantTenantConfig.create({data:{tenantId:tenant.id,enabled:true,operationsEnabled:true}});
  return {tenantId:tenant.id,userId:user.id,role};
}
type Actor=Awaited<ReturnType<typeof seed>>;
async function run(actor:Actor,status:string,startedAt:Date|null,updatedAt:Date,degraded:boolean|null=false,date=createdAt) {
  await prisma.assistantRun.create({data:{...actor,role:undefined,roleAtCreation:actor.role,conversationId:randomUUID(),requestId:randomUUID(),payloadHash:'a'.repeat(64),inputText:marker,status,startedAt,createdAt:date,updatedAt,expiresAt,
    result:degraded===null?undefined:{text:marker,evidence:[],actionProposalIds:[],degraded}} as any});
}
async function usage(actor:Actor) {
  await prisma.assistantBudget.create({data:{id:`tenant:${actor.tenantId}:2026-08`,scope:`tenant:${actor.tenantId}`,month:'2026-08',limitUsd:'10',spentUsd:'1.25',reservedUsd:'.5'}});
  await prisma.assistantUsage.createMany({data:[
    {tenantId:actor.tenantId,userId:actor.userId,month:'2026-08',reservedUsd:'.25',actualUsd:'1.25',status:'SETTLED',providerRequestId:marker,createdAt},
    {tenantId:actor.tenantId,userId:actor.userId,month:'2026-08',reservedUsd:'.2',status:'UNKNOWN',createdAt},
    {tenantId:actor.tenantId,userId:actor.userId,month:'2026-08',reservedUsd:'.3',status:'RESERVED',createdAt},
  ]});
}
qa('Estado: SQL agregado y HTTP con MySQL descartable',()=>{
  let server:Server,origin:string,sign:(actor:Actor)=>string;
  beforeAll(async()=>{
    const url=new URL(process.env.DATABASE_URL??'invalid:');expect(url.protocol).toBe('mysql:');expect(['127.0.0.1','localhost','[::1]']).toContain(url.hostname);expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/);
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');vi.stubEnv('JWT_SECRETS','synthetic-status-signing-key');
    const [{createAssistantStatusRouter},{signAuthToken}]=await Promise.all([import('../backend/routes/assistantStatus'),import('../backend/services/secrets')]);sign=signAuthToken;
    const app=express();app.use('/api/assistant',createAssistantStatusRouter(deps));server=app.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));vi.unstubAllEnvs();});
  const read=(actor:Actor,suffix='')=>fetch(`${origin}/api/assistant/status${suffix}`,{headers:{Authorization:`Bearer ${sign(actor)}`}});
  it('calcula ventana24h, latencia y consumo sólo del tenant y mes Managua',async()=>{
    const actor=await seed(),foreign=await seed();await usage(actor);await usage(foreign);
    await prisma.assistantBudget.updateMany({where:{scope:`tenant:${foreign.tenantId}`},data:{spentUsd:'999'}});
    await run(actor,'SUCCEEDED',createdAt,new Date(createdAt.getTime()+2000),true);await run(actor,'FAILED',createdAt,new Date(createdAt.getTime()+4000));
    await run(actor,'SUCCEEDED',null,new Date(createdAt.getTime()+5000),false);
    await run(actor,'PENDING',null,createdAt,false,new Date('2026-08-30T00:00:00Z'));await run(foreign,'SUCCEEDED',createdAt,new Date(createdAt.getTime()+99000),true);
    const response=await read(actor);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');const result=await response.json();
    expect(result.month).toBe('2026-08');expect(result.runs).toMatchObject({total:'3',byStatus:{SUCCEEDED:'2',FAILED:'1',PENDING:'0'},degraded:'1',averageLatencyMs:'3000',latencySamples:'2',latencyUnknown:'1'});
    expect(result.budget).toMatchObject({spentUsd:'1.25',reservedUsd:'0.5',unknownReservations:'1',unknownReservedUsd:'0.2',remainingUsd:'8.25',reconciled:true});
    expect(JSON.stringify(result)).not.toContain(marker);expect(JSON.stringify(result)).not.toContain(foreign.tenantId);expect(JSON.stringify(result)).not.toContain('999');
  });
  it('colas cuentan registros retenidos, diferencian listo/vencido sin mostrar documentos o teléfonos',async()=>{
    const actor=await seed(),foreign=await seed();
    await prisma.assistantJob.create({data:{tenantId:actor.tenantId,userId:actor.userId,roleAtCreation:actor.role,attachmentIds:[marker],status:'PENDING',createdAt,availableAt:createdAt}});
    const inbox=await prisma.assistantWaInbox.create({data:{tenantId:actor.tenantId,userId:actor.userId,roleAtReceipt:actor.role,phoneNumberId:'123456',waId:'50599999999',providerMessageId:randomUUID(),kind:'TEXT',payload:{text:marker},status:'PENDING',createdAt,availableAt:createdAt,expiresAt:new Date('2026-08-31T18:00:00Z')}});
    await prisma.assistantWaOutbox.create({data:{tenantId:actor.tenantId,userId:actor.userId,roleAtCreation:actor.role,bindingId:randomUUID(),bindingVersion:1,inboxId:inbox.id,phoneNumberId:'123456',waId:'50599999999',text:marker,status:'UNKNOWN',createdAt,expiresAt}});
    await prisma.assistantJob.create({data:{tenantId:foreign.tenantId,userId:foreign.userId,roleAtCreation:foreign.role,attachmentIds:[],status:'PENDING',createdAt,availableAt:createdAt}});
    const result=await getAssistantHealthStatus(actor,deps);
    expect(result.queues).toMatchObject({extraction:{byStatus:{PENDING:'1'},ready:'1'},whatsappInbox:{byStatus:{PENDING:'1'},ready:'0',expiredOpen:'1'},whatsappOutbox:{byStatus:{UNKNOWN:'1'}}});
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_STATUS_CONTENT|50599999999|123456/);
  });
  it('comandos del asistente no cuentan formulario ni deducen replays',async()=>{
    const actor=await seed(),requestKey=randomUUID();
    await prisma.assistantActionCommand.create({data:{tenantId:actor.tenantId,userId:actor.userId,requestKey:randomUUID(),payloadHash:'a'.repeat(64),proposalId:randomUUID(),proposalVersion:1,kind:'SUPPLIER_RETURN',resultJson:{message:marker},createdAt}});
    await prisma.purchaseCommand.createMany({data:[{tenantId:actor.tenantId,userId:actor.userId,requestKey,payloadHash:'a'.repeat(64),purchaseId:randomUUID(),result:{message:marker},createdAt},
      {tenantId:actor.tenantId,userId:actor.userId,requestKey:randomUUID(),payloadHash:'b'.repeat(64),purchaseId:randomUUID(),result:{message:marker},createdAt}]});
    await prisma.assistantProposal.create({data:{tenantId:actor.tenantId,userId:actor.userId,roleAtCreation:actor.role,attachmentIds:[],draft:{},issues:[],status:'COMMITTED',operationId:requestKey,expiresAt}});
    const result=await getAssistantHealthStatus(actor,deps);
    expect(result.commands).toMatchObject({byKind:{SUPPLIER_RETURN:{recorded:'1',completed:'1'},ASSISTANT_PURCHASE:{recorded:'1',completed:'1'}},replayed:{status:'unavailable',value:null}});
  });
  it('un negocio sin actividad tiene cero observado y ausencia de presupuesto explícita',async()=>{
    const actor=await seed('ADMIN');const result=await getAssistantHealthStatus(actor,deps);
    expect(result.runs).toMatchObject({total:'0',averageLatencyMs:null,latencySamples:'0'});expect(result.budget).toMatchObject({status:'partial',spentUsd:null,remainingUsd:null,usageReservations:'0'});
  });
  it('HTTP rechaza otro rol, filtros de tenant y sesión deshabilitada',async()=>{
    const cashier=await seed('CASHIER'),owner=await seed();expect((await read(cashier)).status).toBe(403);expect((await read(owner,'?tenantId=foreign')).status).toBe(400);
    await prisma.user.update({where:{id:owner.userId},data:{status:'DISABLED'}});expect([401,403]).toContain((await read(owner)).status);
  });
  it('interruptor maestro apagado devuelve disabled con sesión válida',async()=>{
    const actor=await seed('SUPER_ADMIN');vi.stubEnv('NORTEX_ASSISTANT_ENABLED','false');
    try {const response=await read(actor);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'disabled',runs:null,queues:null,capabilities:{enabled:false}});}finally{vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');}
  });
});
