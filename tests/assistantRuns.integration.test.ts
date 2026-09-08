import { randomUUID } from 'node:crypto';
import { createServer,type Server } from 'node:http';
import express from 'express';
import { Prisma,type PrismaClient } from '@prisma/client';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { createAssistantConversation,getAssistantConversation,sendAssistantMessage } from '../backend/services/assistant/conversations';
import { createAssistantRun,executeAssistantRun,getAssistantRun,listAssistantRuns,cancelAssistantRun,recoverAssistantRun,processAssistantRun,type RunDependencies } from '../backend/services/assistant/operations/runService';
import { prepareAssistantAction } from '../backend/services/assistant/actions/service';
import { reserveAssistantBudget,settleAssistantBudget } from '../backend/services/assistant/budget';
import { runAssistantOrchestrator } from '../backend/services/assistant/operations/orchestrator';
import * as language from '../backend/services/assistant/language';
import type { AssistantPrincipal } from '../shared/assistant';

const qa=process.env.NORTEX_MYSQL_INTEGRATION==='1'?describe.sequential:describe.skip;
let createAssistantOperationsRouter:typeof import('../backend/routes/assistantOperations')['createAssistantOperationsRouter'];
let signAuthToken:typeof import('../backend/services/secrets')['signAuthToken'];
const result={text:'La consulta fue verificada con fuentes sintéticas.',evidence:[],actionProposalIds:[],degraded:true};
async function fixture() {
  const nonce=randomUUID();
  const tenant=await prisma.tenant.create({data:{businessName:'QA conversación operativa sintética',taxId:`QA-${nonce}`,type:'FERRETERIA'}});
  const user=await prisma.user.create({data:{tenantId:tenant.id,role:'OWNER',name:'QA dueño',password:'not-a-login-account'}});
  await prisma.assistantTenantConfig.create({data:{tenantId:tenant.id,enabled:true,operationsEnabled:true}});
  const principal={tenantId:tenant.id,userId:user.id,role:user.role};
  const conversation=await createAssistantConversation(principal,prisma);
  return{principal,conversation};
}
const input=(text='Compará ventas y existencias')=>({requestId:randomUUID(),text});
const deps=(orchestrate:RunDependencies['orchestrate']=async()=>result):RunDependencies=>({db:prisma,tools:[],orchestrate});

qa('Ejecuciones y chat: transacciones, concurrencia y HTTP en MySQL descartable',()=>{
  beforeAll(async()=>{
    const url=new URL(process.env.DATABASE_URL??'invalid:');
    expect(url.protocol).toBe('mysql:');expect(['127.0.0.1','localhost','[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/);
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');vi.stubEnv('NORTEX_ASSISTANT_OPERATIONS_ENABLED','true');vi.stubEnv('NORTEX_ASSISTANT_LANGUAGE_ENABLED','false');
    ({createAssistantOperationsRouter}=await import('../backend/routes/assistantOperations'));
    ({signAuthToken}=await import('../backend/services/secrets'));
  });
  afterAll(()=>vi.unstubAllEnvs());

  it('dos creaciones concurrentes guardan una sola intención y rechazan texto diferente',async()=>{
    const f=await fixture(),request=input();
    const created=await Promise.all([createAssistantRun(f.principal,f.conversation.id,request,deps()),createAssistantRun(f.principal,f.conversation.id,request,deps())]);
    expect(created[0].id).toBe(created[1].id);
    expect(await prisma.assistantRun.count({where:{conversationId:f.conversation.id}})).toBe(1);
    await expect(createAssistantRun(f.principal,f.conversation.id,{...request,text:'Otra consulta'},deps())).rejects.toMatchObject({code:'RUN_REQUEST_CONFLICT'});
  });

  it('dos trabajadores reclaman una vez y la respuesta perdida se recupera sin repetir',async()=>{
    const f=await fixture(),request=input();let release!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;});
    const orchestrate=vi.fn(async()=>{await blocked;return result;});
    const first=executeAssistantRun(f.principal,f.conversation.id,request,deps(orchestrate));
    await vi.waitFor(()=>expect(orchestrate).toHaveBeenCalledTimes(1));
    const second=await executeAssistantRun(f.principal,f.conversation.id,request,deps(orchestrate));
    expect(second.status).toBe('RUNNING');release();
    const completed=await first;expect(completed.status).toBe('SUCCEEDED');
    expect(await executeAssistantRun(f.principal,f.conversation.id,request,deps(orchestrate))).toEqual(completed);
    expect(orchestrate).toHaveBeenCalledTimes(1);
  });

  it('cancelar durante el proveedor impide publicar el resultado tardío',async()=>{
    const f=await fixture(),request=input();let release!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;});
    const orchestrate=vi.fn(async()=>{await blocked;return result;});
    const pending=executeAssistantRun(f.principal,f.conversation.id,request,deps(orchestrate));
    await vi.waitFor(()=>expect(orchestrate).toHaveBeenCalledTimes(1));
    const row=await prisma.assistantRun.findFirstOrThrow({where:{conversationId:f.conversation.id}});
    expect((await cancelAssistantRun(f.principal,row.id,row.version,deps())).status).toBe('CANCELLED');release();
    expect(await pending).toMatchObject({status:'CANCELLED'});
    expect((await getAssistantRun(f.principal,row.id,deps())).result).toBeUndefined();
  });

  it('recuperar un lease vencido nunca repite una preparación interrumpida',async()=>{
    const f=await fixture(),run=await createAssistantRun(f.principal,f.conversation.id,input(),deps());
    await prisma.assistantRun.update({where:{id:run.id},data:{status:'RUNNING',leaseToken:'abandoned',leaseUntil:new Date(0),iterations:2}});
    const orchestrate=vi.fn(async()=>result);
    expect(await recoverAssistantRun(f.principal,run.id,deps(orchestrate))).toMatchObject({status:'FAILED',errorCode:'RUN_INTERRUPTED',iterations:2});
    await processAssistantRun(f.principal,run.id,deps(orchestrate));expect(orchestrate).not.toHaveBeenCalled();
  });

  it('roles revocados y usuarios ajenos no recuperan historial operativo',async()=>{
    const f=await fixture(),other=await fixture(),run=await createAssistantRun(f.principal,f.conversation.id,input(),deps());
    await expect(getAssistantRun(other.principal,run.id,deps())).rejects.toMatchObject({code:'RUN_NOT_FOUND'});
    await prisma.user.update({where:{id:f.principal.userId},data:{role:'CASHIER'}});
    await expect(getAssistantRun(f.principal,run.id,deps())).rejects.toMatchObject({code:'SESSION_REVOKED'});
    await expect(getAssistantRun({...f.principal,role:'CASHIER'},run.id,deps())).rejects.toMatchObject({code:'RUN_NOT_FOUND'});
  });

  it('el fallback real consulta MySQL sin clave y sin generar consumo de IA',async()=>{
    const f=await fixture();vi.stubEnv('ANTHROPIC_API_KEY','');
    const run=await executeAssistantRun(f.principal,f.conversation.id,input('Cómo va mi negocio'),{db:prisma});
    expect(run).toMatchObject({status:'SUCCEEDED',iterations:0,result:{degraded:true,evidence:[{tool:'audit_business_health',data:{status:'partial',metrics:expect.arrayContaining([
      expect.objectContaining({key:'salesTotal',value:'0',status:'ok'}),expect.objectContaining({key:'averageTicket',value:null,status:'unavailable'}),
    ])}}]}});
    expect(await prisma.assistantUsage.count({where:{tenantId:f.principal.tenantId}})).toBe(0);
    expect(await prisma.assistantActionProposal.count({where:{tenantId:f.principal.tenantId}})).toBe(0);
  });

  it('un solo chat preserva compra pendiente, evita clasificador extra y permite retomarla',async()=>{
    const f=await fixture(),startRun=vi.fn(async()=>undefined);
    const initial=await sendAssistantMessage(f.principal,f.conversation.id,input('Compré 50 bolsas de cemento'),prisma,{startRun});
    expect(initial.purchaseIntake?.summary).toContain('50');
    const before=await prisma.assistantConversation.findUniqueOrThrow({where:{id:f.conversation.id}});
    const interpreter=vi.spyOn(language,'createAssistantLanguage').mockImplementation(()=>async()=>{throw new Error('Clasificador no permitido para una ejecución operativa');});
    let queryReply;
    const request=input('¿Cómo va mi negocio?');
    try {queryReply=await sendAssistantMessage(f.principal,f.conversation.id,request,prisma,{startRun});}
    finally {interpreter.mockRestore();}
    expect(queryReply.operationalRunId).toBeTruthy();expect(startRun).toHaveBeenCalledTimes(1);
    const after=await prisma.assistantConversation.findUniqueOrThrow({where:{id:f.conversation.id}});
    expect(after.metadata).toEqual(before.metadata);expect(after.stateVersion).toBe(before.stateVersion);
    const replay=await sendAssistantMessage(f.principal,f.conversation.id,request,prisma,{startRun});
    expect(replay).toEqual(queryReply);expect(startRun).toHaveBeenCalledTimes(1);
    const reloaded=await getAssistantConversation(f.principal,f.conversation.id,prisma);
    expect(reloaded.purchaseIntake?.summary).toContain('50');expect(reloaded.messages.at(-1)?.operationalRunId).toBe(queryReply.operationalRunId);
    const resumed=await sendAssistantMessage(f.principal,f.conversation.id,input('son 60, no 50'),prisma,{startRun});
    expect(resumed.purchaseIntake?.summary).toContain('60');expect(resumed.operationalRunId).toBeUndefined();
    expect(await prisma.purchase.count({where:{tenantId:f.principal.tenantId}})).toBe(0);
    expect(await prisma.assistantRun.count({where:{conversationId:f.conversation.id}})).toBe(1);
  });

  it('doble envío en chat guarda un solo par y los seguimientos siguen la consulta operativa',async()=>{
    const f=await fixture(),startRun=vi.fn(async()=>undefined);
    await sendAssistantMessage(f.principal,f.conversation.id,input('Compré 50 bolsas de cemento'),prisma,{startRun});
    const before=await prisma.assistantConversation.findUniqueOrThrow({where:{id:f.conversation.id}}),request=input('Cómo va mi negocio');
    const pair=await Promise.all([sendAssistantMessage(f.principal,f.conversation.id,request,prisma,{startRun}),sendAssistantMessage(f.principal,f.conversation.id,request,prisma,{startRun})]);
    expect(pair[0]).toEqual(pair[1]);
    expect(await prisma.assistantMessage.count({where:{conversationId:f.conversation.id,requestId:request.requestId}})).toBe(2);
    expect(await prisma.assistantRun.count({where:{conversationId:f.conversation.id,requestId:request.requestId}})).toBe(1);
    for(const text of ['Mostrame cuáles productos','Prepará la acción'])expect((await sendAssistantMessage(f.principal,f.conversation.id,input(text),prisma,{startRun})).operationalRunId).toBeTruthy();
    expect((await prisma.assistantConversation.findUniqueOrThrow({where:{id:f.conversation.id}})).metadata).toEqual(before.metadata);
    const resume=await sendAssistantMessage(f.principal,f.conversation.id,input('son 60, no 50'),prisma,{startRun});
    expect(resume.purchaseIntake?.summary).toContain('60');expect(resume.operationalRunId).toBeUndefined();
  });

  it('si falla guardar la respuesta, se revierten también mensaje humano y run',async()=>{
    const f=await fixture(),startRun=vi.fn(async()=>undefined);
    const broken=new Proxy(prisma,{get(target,key){
      if(key==='$transaction')return <T>(work:(tx:Prisma.TransactionClient)=>Promise<T>)=>target.$transaction(tx=>work(new Proxy(tx,{get(transaction,part){
        if(part==='assistantMessage')return {...transaction.assistantMessage,create:async(args:Prisma.AssistantMessageCreateArgs)=>{
          if(args.data.role==='assistant')throw new Error('QA paired message failure');
          return transaction.assistantMessage.create(args);
        }};
        return Reflect.get(transaction,part);
      }})));
      return Reflect.get(target,key);
    }}) as PrismaClient;
    await expect(sendAssistantMessage(f.principal,f.conversation.id,input(),broken,{startRun})).rejects.toThrow('QA paired message failure');
    expect(await prisma.assistantRun.count({where:{conversationId:f.conversation.id}})).toBe(0);
    expect(await prisma.assistantMessage.count({where:{conversationId:f.conversation.id}})).toBe(0);expect(startRun).not.toHaveBeenCalled();
  });

  it('HTTP conserva autorización y GET no recupera ni ejecuta leases vencidos',async()=>{
    const f=await fixture(),other=await fixture(),orchestrate=vi.fn(async()=>result);
    const app=express();app.use(express.json());app.use('/api/assistant',createAssistantOperationsRouter(deps(orchestrate)));
    const server:Server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error('Missing local address');
    const url=`http://127.0.0.1:${address.port}/api/assistant`;
    const headers=(principal:AssistantPrincipal)=>({'content-type':'application/json',authorization:`Bearer ${signAuthToken(principal)}`});
    try {
      const run=await createAssistantRun(f.principal,f.conversation.id,input(),deps());
      await prisma.assistantRun.update({where:{id:run.id},data:{status:'RUNNING',leaseToken:'abandoned',leaseUntil:new Date(0)}});
      const get=await fetch(`${url}/runs/${run.id}`,{headers:headers(f.principal)});
      expect(get.status).toBe(200);expect(get.headers.get('cache-control')).toBe('private, no-store');expect(await get.json()).toMatchObject({status:'RUNNING'});
      expect(orchestrate).not.toHaveBeenCalled();
      expect((await fetch(`${url}/runs/${run.id}`,{headers:headers(other.principal)})).status).toBe(404);
      const recovered=await fetch(`${url}/runs/${run.id}/recover`,{method:'POST',headers:headers(f.principal),body:'{}'});
      expect(recovered.status).toBe(200);expect(await recovered.json()).toMatchObject({status:'FAILED',errorCode:'RUN_INTERRUPTED'});
      const invalid=await fetch(`${url}/conversations/${f.conversation.id}/runs`,{method:'POST',headers:headers(f.principal),body:JSON.stringify({...input(),tenantId:other.principal.tenantId})});
      expect(invalid.status).toBe(400);expect(orchestrate).not.toHaveBeenCalled();
    } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });

  async function actionRun() {
    vi.stubEnv('NORTEX_ASSISTANT_ACTIONS_ENABLED','true');
    const f=await fixture();await prisma.assistantTenantConfig.update({where:{tenantId:f.principal.tenantId},data:{actionsEnabled:true}});
    const run=await createAssistantRun(f.principal,f.conversation.id,input(),deps());
    await prisma.assistantRun.update({where:{id:run.id},data:{status:'RUNNING',leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+65000),deadlineAt:new Date(Date.now()+60000)}});
    return{...f,run};
  }

  it('cancelar antes del guard transaccional deja cero borradores',async()=>{
    const f=await actionRun();let release!:()=>void,reached!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{reached=resolve;});
    const delayed=new Proxy(prisma,{get(target,field){
      if(field==='$transaction')return async<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{isolationLevel?:Prisma.TransactionIsolationLevel})=>{reached();await blocked;return target.$transaction(work,options);};
      return Reflect.get(target,field);
    }});
    const pending=prepareAssistantAction(f.principal,'PURCHASE_ORDER_DRAFT',{items:[]},randomUUID(),delayed,{runId:f.run.id});
    const rejected=expect(pending).rejects.toMatchObject({code:'ACTION_RUN_INACTIVE'});
    await entered;await cancelAssistantRun(f.principal,f.run.id,f.run.version,deps());release();await rejected;
    expect(await prisma.assistantActionProposal.count({where:{tenantId:f.principal.tenantId}})).toBe(0);
  });

  it('cancelar al commit conserva el vínculo aunque no exista checkpoint del borrador',async()=>{
    const f=await actionRun();let release!:()=>void,created!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{created=resolve;});
    const delayed=new Proxy(prisma,{get(target,field){
      if(field==='$transaction')return <T>(work:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{isolationLevel?:Prisma.TransactionIsolationLevel})=>target.$transaction(tx=>work(new Proxy(tx,{get(inner,part){
        if(part==='assistantActionProposal')return {...inner.assistantActionProposal,create:async(args:Prisma.AssistantActionProposalCreateArgs)=>{const row=await inner.assistantActionProposal.create(args);created();await blocked;return row;}};
        return Reflect.get(inner,part);
      }})),options);
      return Reflect.get(target,field);
    }});
    const pending=prepareAssistantAction(f.principal,'PURCHASE_ORDER_DRAFT',{items:[]},randomUUID(),delayed,{runId:f.run.id});
    await entered;const cancelled=cancelAssistantRun(f.principal,f.run.id,f.run.version,deps());release();
    const draft=await pending,run=await cancelled;
    expect(run.status).toBe('CANCELLED');expect(run.result?.actionProposalIds).toEqual([draft.id]);
    expect((await getAssistantRun(f.principal,f.run.id,deps())).result?.actionProposalIds).toEqual([draft.id]);
    expect((await listAssistantRuns(f.principal,f.conversation.id,deps()))[0].result?.actionProposalIds).toEqual([draft.id]);
    expect(await prisma.assistantActionProposal.findUnique({where:{id:draft.id},select:{runId:true,status:true}})).toEqual({runId:f.run.id,status:'DRAFT'});
    expect(await prisma.assistantActionCommand.count({where:{tenantId:f.principal.tenantId}})).toBe(0);
  });

  it('timeout posterior a preparar recupera el borrador y revocar acción oculta sus referencias',async()=>{
    const f=await actionRun(),draft=await prepareAssistantAction(f.principal,'PURCHASE_ORDER_DRAFT',{items:[]},randomUUID(),prisma,{runId:f.run.id});
    await prisma.assistantRun.update({where:{id:f.run.id},data:{leaseUntil:new Date(0),deadlineAt:new Date(0)}});
    const run=await recoverAssistantRun(f.principal,f.run.id,deps());
    expect(run).toMatchObject({status:'FAILED',errorCode:'RUN_INTERRUPTED',result:{actionProposalIds:[draft.id]}});
    await expect(prepareAssistantAction(f.principal,'PURCHASE_ORDER_DRAFT',{items:[]},randomUUID(),prisma,{runId:f.run.id})).rejects.toMatchObject({code:'ACTION_RUN_INACTIVE'});
    await prisma.assistantTenantConfig.update({where:{tenantId:f.principal.tenantId},data:{actionsEnabled:false}});
    expect((await getAssistantRun(f.principal,f.run.id,deps())).result).toBeUndefined();
    expect(await prisma.assistantActionProposal.count({where:{runId:f.run.id}})).toBe(1);
  });

  it('reserva real seguida de revocación liquida cero USD y nunca transmite contexto',async()=>{
    const f=await fixture(),provider=vi.fn(async()=>{throw new Error('No debe llamarse al proveedor');}),budgetNow=new Date('2077-06-01T12:00:00Z');
    const orchestrate:RunDependencies['orchestrate']=(input,controls)=>runAssistantOrchestrator(input,{...controls,create:provider,
      reserve:async principal=>{
        const reservation=await reserveAssistantBudget(principal,'0.01',{db:prisma,now:()=>budgetNow,capability:'help'});
        await prisma.user.update({where:{id:principal.userId},data:{status:'DISABLED'}});
        return reservation;
      },settle:(principal,id,usage)=>settleAssistantBudget(principal,id,usage,{db:prisma,capability:'help'}),
    });
    await expect(executeAssistantRun(f.principal,f.conversation.id,input(),deps(orchestrate))).rejects.toMatchObject({code:'SESSION_REVOKED'});
    expect(provider).not.toHaveBeenCalled();
    const usage=await prisma.assistantUsage.findFirstOrThrow({where:{tenantId:f.principal.tenantId}});
    expect(usage.status).toBe('SETTLED');expect(usage.actualUsd?.toFixed(6)).toBe('0.000000');
    const bucket=await prisma.assistantBudget.findFirstOrThrow({where:{scope:`tenant:${f.principal.tenantId}`,month:'2077-06'}});
    expect(bucket.reservedUsd.toFixed(6)).toBe('0.000000');expect(bucket.spentUsd.toFixed(6)).toBe('0.000000');
  });
  it('vincula cada reserva del orquestador real a su run bajo concurrencia y conserva UNKNOWN',async()=>{
    const f=await fixture();
    const runs=await Promise.all([createAssistantRun(f.principal,f.conversation.id,input(),deps()),createAssistantRun(f.principal,f.conversation.id,input(),deps())]);
    const provider=vi.fn(async()=>({id:'qa-linked-response',stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:50},content:[]}));
    await Promise.all(runs.map((run,index)=>runAssistantOrchestrator({principal:f.principal,conversationId:f.conversation.id,runId:run.id,text:'Consulta QA'}, {
      db:prisma,tools:[],enabled:()=>true,assertActive:async()=>{},onCheckpoint:async()=>{},
      create:index===0?provider:async()=>{throw new Error('Respuesta perdida sintética');},
    })));
    const rows=await prisma.assistantUsage.findMany({where:{tenantId:f.principal.tenantId},orderBy:{runId:'asc'}});
    expect(rows).toHaveLength(2);
    const settled=rows.find(row=>row.runId===runs[0].id)!,unknown=rows.find(row=>row.runId===runs[1].id)!;
    expect(settled).toMatchObject({status:'SETTLED',userId:f.principal.userId,providerRequestId:'qa-linked-response'});
    expect(settled.actualUsd?.toFixed(6)).toBe('0.000350');
    expect(unknown).toMatchObject({status:'UNKNOWN',userId:f.principal.userId,actualUsd:null});
    await Promise.all([settleAssistantBudget(f.principal,settled.id,{inputTokens:100,outputTokens:50},{db:prisma}),settleAssistantBudget(f.principal,settled.id,{inputTokens:100,outputTokens:50},{db:prisma})]);
    const bucket=await prisma.assistantBudget.findFirstOrThrow({where:{scope:`tenant:${f.principal.tenantId}`,month:settled.month}});
    expect(bucket.spentUsd.toFixed(6)).toBe('0.000350');expect(bucket.reservedUsd.toFixed(6)).toBe(unknown.reservedUsd.toFixed(6));
    expect(await prisma.assistantUsage.count({where:{runId:runs[0].id}})).toBe(1);
  });

  it('liquidar después del corte mensual conserva el enlace y carga el mes reservado',async()=>{
    const f=await fixture(),run=await createAssistantRun(f.principal,f.conversation.id,input(),deps());
    const reservation=await reserveAssistantBudget(f.principal,'0.01',{db:prisma,capability:'help',runId:run.id,now:()=>new Date('2078-02-01T05:59:59Z')});
    await settleAssistantBudget(f.principal,reservation.id,{inputTokens:100,outputTokens:50,requestId:'qa-boundary'},{db:prisma,now:()=>new Date('2078-02-01T06:00:01Z')});
    expect(await prisma.assistantUsage.findUniqueOrThrow({where:{id:reservation.id}})).toMatchObject({runId:run.id,month:'2078-01',status:'SETTLED'});
    expect(await prisma.assistantBudget.count({where:{scope:`tenant:${f.principal.tenantId}`,month:'2078-02'}})).toBe(0);
  });

});
