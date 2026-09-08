import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AssistantRun } from '@prisma/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createAssistantRun,createAssistantRunInTransaction,executeAssistantRun,getAssistantRun,cancelAssistantRun,recoverAssistantRun } from '../backend/services/assistant/operations/runService';
import { z } from 'zod';
import type { RunCheckpoint } from '../backend/services/assistant/operations/contracts';
const principal={tenantId:'tenant-a',userId:'user-a',role:'OWNER'},requestId=randomUUID(),now=new Date('2026-09-05T16:00:00Z');
const input={requestId,text:'Revisá mi negocio'};
function harness() {
  const rows:AssistantRun[]=[];
  const conversation={id:'conversation-a',...principal,roleAtCreation:principal.role,expiresAt:new Date(now.getTime()+86400_000),metadata:{purchaseIntake:{pending:'conservar'}}};
  const matches=(row:AssistantRun,where:Record<string,unknown>)=>Object.entries(where).every(([key,value])=>{
    const actual=row[key as keyof AssistantRun];
    if(value&&typeof value==='object'&&!Array.isArray(value)){
      if('in'in value)return (value.in as unknown[]).includes(actual);
      if('gt'in value)return actual instanceof Date&&actual>(value.gt as Date);
      if('lte'in value)return actual instanceof Date&&actual<=(value.lte as Date);
    }return actual===value;
  });
  const mocks={
    user:{findFirst:vi.fn().mockResolvedValue({id:principal.userId,status:'ACTIVE',role:principal.role})},
    assistantTenantConfig:{findUnique:vi.fn().mockResolvedValue({enabled:true,operationsEnabled:true})},
    assistantConversation:{findFirst:vi.fn().mockResolvedValue(conversation)},
    assistantMessage:{findMany:vi.fn().mockResolvedValue([])},
    assistantRun:{
      findFirst:vi.fn(async({where}:{where:Record<string,unknown>})=>rows.find(row=>matches(row,where))??null),
      findMany:vi.fn().mockResolvedValue([]),
      create:vi.fn(async({data}:{data:Partial<AssistantRun>})=>{const row={id:`run-${rows.length}`,...principal,roleAtCreation:principal.role,conversationId:conversation.id,requestId,payloadHash:'',inputText:'',status:'PENDING',version:0,iterations:0,leaseToken:null,leaseUntil:null,startedAt:null,deadlineAt:null,checkpoint:null,result:null,errorCode:null,createdAt:now,updatedAt:now,expiresAt:conversation.expiresAt,...data} satisfies AssistantRun;rows.push(row);return {...row};}),
      updateMany:vi.fn(async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{const row=rows.find(value=>matches(value,where));if(!row)return {count:0};for(const [key,value]of Object.entries(data)){if(key==='version')row.version+=(value as{increment:number}).increment;else Object.assign(row,{[key]:structuredClone(value)});}return{count:1};}),
    },
    $queryRaw:vi.fn().mockResolvedValue([{id:conversation.id}]),
    $transaction:vi.fn(),
  };
  mocks.$transaction.mockImplementation(async(fn:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>fn(mocks as unknown as Prisma.TransactionClient));
  return{rows,mocks,conversation,db:mocks as unknown as PrismaClient};
}
beforeEach(()=>{vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');vi.stubEnv('NORTEX_ASSISTANT_OPERATIONS_ENABLED','true');});
afterEach(()=>vi.unstubAllEnvs());
describe('ejecuciones durables del asistente operativo',()=>{
  it('crea PENDING idempotente y no cambia la captura activa',async()=>{
    const h=harness(),deps={db:h.db,now:()=>now};
    const first=await createAssistantRun(principal,'conversation-a',input,deps),again=await createAssistantRun(principal,'conversation-a',input,deps);
    expect(first.id).toBe(again.id);expect(h.rows).toHaveLength(1);expect(first.status).toBe('PENDING');
    expect(h.conversation.metadata).toEqual({purchaseIntake:{pending:'conservar'}});
    await expect(createAssistantRun(principal,'conversation-a',{...input,text:'otra consulta'},deps)).rejects.toMatchObject({code:'RUN_REQUEST_CONFLICT'});
  });
  it('claim y checkpoints persisten el resultado; respuesta perdida no repite ejecución',async()=>{
    const h=harness(),checkpoint:RunCheckpoint={iterations:1,messages:[],steps:[],evidence:[],actionProposalIds:[]};
    const orchestrate=vi.fn(async(_input,controls)=>{await controls.onCheckpoint(checkpoint);return {text:'Sin cifras disponibles',evidence:[],actionProposalIds:[],degraded:true};});
    const deps={db:h.db,now:()=>now,tools:[],orchestrate};
    const first=await executeAssistantRun(principal,'conversation-a',input,deps);
    expect(first).toMatchObject({status:'SUCCEEDED',iterations:1,result:{degraded:true}});expect(h.rows[0].leaseToken).toBeNull();
    expect(await executeAssistantRun(principal,'conversation-a',input,deps)).toEqual(first);expect(orchestrate).toHaveBeenCalledTimes(1);
  });
  it('cancelación invalida la versión y el orquestador no sobrescribe CANCELLED',async()=>{
    const h=harness(),deps={db:h.db,now:()=>now,tools:[]};
    const result=await executeAssistantRun(principal,'conversation-a',input,{...deps,orchestrate:async(_input,controls)=>{
      await cancelAssistantRun(principal,h.rows[0].id,h.rows[0].version,deps);
      await controls.assertActive();return {text:'no permitido',evidence:[],actionProposalIds:[],degraded:false};
    }});
    expect(result.status).toBe('CANCELLED');expect(result.result).toBeUndefined();
  });
  it('recupera lease vencido como interrupción sin ejecutar herramientas',async()=>{
    const h=harness(),deps={db:h.db,now:()=>now},created=await createAssistantRun(principal,'conversation-a',input,deps);
    Object.assign(h.rows[0],{status:'RUNNING',leaseToken:'stale',leaseUntil:new Date(now.getTime()-1)});
    expect(await recoverAssistantRun(principal,created.id,deps)).toMatchObject({status:'FAILED',errorCode:'RUN_INTERRUPTED'});
  });
  it('otra identidad o permiso revocado no recupera resultados',async()=>{
    const h=harness(),deps={db:h.db,now:()=>now},created=await createAssistantRun(principal,'conversation-a',input,deps);
    await expect(getAssistantRun({...principal,userId:'other'},created.id,deps)).rejects.toMatchObject({code:'RUN_NOT_FOUND'});
    h.mocks.user.findFirst.mockResolvedValue(null);
    await expect(getAssistantRun(principal,created.id,deps)).rejects.toMatchObject({code:'SESSION_REVOKED'});
  });
  it('el helper compone dentro de una transacción existente sin abrir otra',async()=>{
    const h=harness();
    const result=await createAssistantRunInTransaction(principal,'conversation-a',input,h.db as Prisma.TransactionClient,now);
    expect(result.status).toBe('PENDING');expect(h.mocks.$transaction).not.toHaveBeenCalled();
  });
  it('sólo resultados anteriores cuyas herramientas siguen autorizadas entran al contexto',async()=>{
    const h=harness(),deps={db:h.db,now:()=>now};
    await createAssistantRun(principal,'conversation-a',input,deps);
    const priorResult={text:'Ventas 100',evidence:[{id:'e1',tool:'get_sales',label:'Ventas',data:{sales:'100'}}],actionProposalIds:[],degraded:false};
    const valid={...h.rows[0],id:'prior',status:'SUCCEEDED',result:priorResult};
    h.mocks.assistantRun.findMany.mockResolvedValue([valid,{...valid,id:'forbidden',result:{...priorResult,evidence:[{...priorResult.evidence[0],tool:'private_removed_tool'}]}}]);
    const orchestrate=vi.fn(async()=>({text:'Resultado',evidence:[],actionProposalIds:[],degraded:true}));
    await executeAssistantRun(principal,'conversation-a',input,{...deps,orchestrate,tools:[{name:'get_sales',kind:'READ',label:'Ventas',description:'Ventas autorizadas',schema:z.object({}),execute:async()=>({data:null})}]});
    const call=orchestrate.mock.calls[0] as unknown as [{previousResults:unknown[]},unknown];
    expect(call[0].previousResults).toEqual([{runId:'prior',recordedAt:now.toISOString(),stale:true,refreshRequiredBeforePreparation:true,result:priorResult}]);
    expect(h.mocks.assistantRun.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,conversationId:'conversation-a',status:'SUCCEEDED'}),take:2}));
  });
});
