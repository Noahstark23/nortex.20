import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildRunFinding } from '../scripts/qa/nortexgpt-verify-run';
import { runAssistantOrchestrator } from '../backend/services/assistant/operations/orchestrator';
import type { OperationTool,ToolContext } from '../backend/services/assistant/operations/contracts';

const principal = { tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER' };
const query = { principal, conversationId: 'conversation-a', runId: 'run-a', text: 'Compará ventas y existencias' };
function response(name: string, input: unknown) {
  return { id: 'provider-a', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'call-a', name, input }], usage: { input_tokens: 100, output_tokens: 50 } };
}
function harness() {
  const execute = vi.fn(async (_context:ToolContext,_input:unknown) => ({ data: { sales: '100', source: 'Ventas verificadas' } }));
  const tools: OperationTool[] = [{name:'get_sales',description:'Ventas autorizadas',label:'Ventas',kind:'READ',schema:z.object({}).strict(),execute}];
  const create = vi.fn().mockResolvedValueOnce(response('get_sales', {})).mockResolvedValueOnce(response('respond_with_evidence', {text:'Las ventas fueron 100.',evidenceIds:['e1']}));
  const reserve = vi.fn().mockResolvedValue({id:'usage-a'}), settle = vi.fn().mockResolvedValue(undefined), assertActive = vi.fn().mockResolvedValue(undefined), onCheckpoint = vi.fn().mockResolvedValue(undefined);
  return {execute,create,reserve,settle,assertActive,onCheckpoint,tools,deps:{tools,create,reserve,settle,assertActive,onCheckpoint,enabled:()=>true}};
}
describe('orquestación operativa cerrada',()=>{
  it('envía resultados de herramientas a la siguiente iteración y reserva cada llamada',async()=>{
    const h=harness(),result=await runAssistantOrchestrator(query,h.deps);
    expect(result).toMatchObject({text:'Las ventas fueron 100.',degraded:false,evidence:[{id:'e1',tool:'get_sales'}]});
    expect(h.create).toHaveBeenCalledTimes(2);expect(h.reserve).toHaveBeenCalledTimes(2);expect(h.settle).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.create.mock.calls[1][0].messages)).toContain('tool_result');expect(JSON.stringify(h.create.mock.calls[1][0].messages)).toContain('100');
    expect(h.execute.mock.calls[0][0].principal).toEqual(principal);
  });
  it('apagado no llama modelo ni herramientas',async()=>{
    const h=harness();await expect(runAssistantOrchestrator(query,{...h.deps,enabled:()=>false})).rejects.toMatchObject({code:'OPERATIONS_DISABLED'});
    expect(h.create).not.toHaveBeenCalled();expect(h.reserve).not.toHaveBeenCalled();expect(h.execute).not.toHaveBeenCalled();
  });
  it('rechaza argumentos de identidad y herramientas de confirmación',async()=>{
    const h=harness();h.create.mockReset().mockResolvedValueOnce(response('get_sales',{tenantId:'tenant-b'})).mockResolvedValueOnce(response('confirm_purchase',{}));
    const result=await runAssistantOrchestrator(query,h.deps);expect(result.degraded).toBe(true);expect(h.execute).not.toHaveBeenCalled();
  });
  it('presupuesto agotado devuelve degradación sin proveedor ni preparación',async()=>{
    const h=harness();h.reserve.mockRejectedValue(Object.assign(new Error('budget'),{code:'BUDGET_EXHAUSTED'}));
    const result=await runAssistantOrchestrator(query,h.deps);expect(result.degraded).toBe(true);expect(h.create).not.toHaveBeenCalled();expect(h.execute).not.toHaveBeenCalled();
  });
  it('no publica cifras o referencias inventadas',async()=>{
    const h=harness();h.create.mockReset().mockResolvedValueOnce(response('get_sales',{})).mockResolvedValueOnce(response('respond_with_evidence',{text:'Las ventas fueron 999.',evidenceIds:['e1']}));
    const result=await runAssistantOrchestrator(query,h.deps);expect(result.text).not.toContain('999');expect(result.degraded).toBe(true);
  });
  it('termina tras cuatro llamadas aunque el modelo siga solicitando herramientas',async()=>{
    const h=harness();h.create.mockReset().mockResolvedValue(response('get_sales',{}));
    const result=await runAssistantOrchestrator(query,h.deps);expect(result.degraded).toBe(true);expect(h.create).toHaveBeenCalledTimes(4);expect(h.reserve).toHaveBeenCalledTimes(4);
    expect(h.onCheckpoint.mock.calls.at(-1)?.[0].iterations).toBe(4);
  });
  it('no vuelve a llamar al proveedor al alcanzar el plazo',async()=>{
    const h=harness();let clock=new Date('2026-09-05T16:00:00Z');h.execute.mockImplementation(async()=>{clock=new Date(clock.getTime()+61000);return{data:{sales:'100',source:'Ventas verificadas'}};});
    const result=await runAssistantOrchestrator(query,{...h.deps,now:()=>clock});expect(result.degraded).toBe(true);expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('revocación después del proveedor impide ejecutar la herramienta',async()=>{
    const h=harness();h.assertActive.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('revoked'),{code:'SESSION_REVOKED'}));
    await expect(runAssistantOrchestrator(query,h.deps)).rejects.toMatchObject({code:'SESSION_REVOKED'});expect(h.execute).not.toHaveBeenCalled();expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('fallo de proveedor liquida consumo desconocido sin repetir llamadas',async()=>{
    const h=harness();h.create.mockReset().mockRejectedValue(new Error('timeout'));
    expect((await runAssistantOrchestrator(query,h.deps)).degraded).toBe(true);expect(h.settle).toHaveBeenCalledWith(principal,'usage-a',null);expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('una herramienta que no responde termina al vencer los 60 segundos',async()=>{
    vi.useFakeTimers();
    try {
      const h=harness();h.execute.mockImplementation(()=>new Promise(()=>undefined));
      const pending=runAssistantOrchestrator(query,h.deps);
      await vi.advanceTimersByTimeAsync(60001);
      const result=await pending;
      expect(result.degraded).toBe(true);expect(h.create).toHaveBeenCalledTimes(1);
      expect(h.onCheckpoint.mock.calls.at(-1)?.[0].steps[0]).toMatchObject({status:'FAILED',errorCode:'RUN_TIMEOUT'});
    } finally {vi.useRealTimers();}
  });
  it('contexto anterior no sustituye evidencia actual para preparar una acción',async()=>{
    const h=harness(),prepare=vi.fn(async()=>({data:{id:'draft-a'}}));
    const prior={runId:'prior',recordedAt:'2026-09-04T12:00:00Z',stale:true as const,refreshRequiredBeforePreparation:true as const,result:{text:'Ventas 100',evidence:[{id:'e1',tool:'get_sales',label:'Ventas',data:{sales:'100'}}],actionProposalIds:[],degraded:false}};
    h.create.mockReset().mockResolvedValueOnce(response('prepare_order',{})).mockResolvedValueOnce(response('respond_with_evidence',{text:'Ventas 100',evidenceIds:['e1']}));
    const result=await runAssistantOrchestrator({...query,previousResults:[prior]},{...h.deps,tools:[...h.tools,{name:'prepare_order',label:'Orden',description:'Preparar orden',kind:'PREPARE',schema:z.object({}).strict(),execute:prepare}]});
    expect(JSON.stringify(h.create.mock.calls[0][0].messages)).toContain('refreshRequiredBeforePreparation');
    expect(prepare).not.toHaveBeenCalled();expect(result.evidence).toEqual([]);expect(result.degraded).toBe(true);
  });
  it('sin clave ofrece lectura determinista sin reservar consumo inexistente',async()=>{
    vi.stubEnv('ANTHROPIC_API_KEY','');
    try {
      const h=harness(),read=vi.fn(async()=>({data:{metrics:[{value:'100',status:'ok'}]}}));
      const result=await runAssistantOrchestrator({...query,text:'Cómo va mi negocio'},{...h.deps,create:undefined,tools:[{...h.tools[0],name:'audit_business_health',schema:z.object({startDate:z.string(),endDate:z.string()}).strict(),execute:read}]});
      expect(result).toMatchObject({degraded:true,evidence:[{tool:'audit_business_health',data:{metrics:[{value:'100',status:'ok'}]}}]});
      expect(h.reserve).not.toHaveBeenCalled();expect(h.settle).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(1);
    } finally {vi.unstubAllEnvs();}
  });
  it('presupuesto agotado conserva cifras consultadas sin preparar acciones',async()=>{
    const h=harness(),read=vi.fn(async()=>({data:{metrics:[{key:'salesTotal',value:'100',status:'ok'}]}})),prepare=vi.fn(async()=>({data:{id:'draft'}}));
    h.reserve.mockRejectedValue(new Error('Budget exhausted'));
    const result=await runAssistantOrchestrator({...query,text:'Revisá mi negocio y prepará una acción'},{...h.deps,tools:[{...h.tools[0],name:'audit_business_health',schema:z.object({startDate:z.string(),endDate:z.string()}),execute:read},{...h.tools[0],name:'prepare_order',kind:'PREPARE',execute:prepare}]});
    expect(result.evidence[0]?.data).toEqual({metrics:[{key:'salesTotal',value:'100',status:'ok'}]});expect(prepare).not.toHaveBeenCalled();expect(h.create).not.toHaveBeenCalled();
    const checkpoint=h.onCheckpoint.mock.calls.at(-1)?.[0] as unknown as {iterations:number};
    const finding=buildRunFinding({run:{id:query.runId,tenantId:principal.tenantId,userId:principal.userId,status:'SUCCEEDED',iterations:checkpoint.iterations,result,createdAt:new Date()},usageRows:[]});
    expect(checkpoint.iterations).toBe(1);
    expect(finding.providerCallAttempted).toBeNull();
    expect(finding.note).not.toContain('pagadas y ya liquidadas');
  });
  it('revocar durante la reserva impide enviar historial al proveedor y libera el consumo no usado',async()=>{
    const h=harness();let active=true;
    h.reserve.mockImplementation(async()=>{active=false;return{id:'unused-reservation'};});
    h.assertActive.mockImplementation(async()=>{if(!active)throw Object.assign(new Error('Revoked'),{code:'SESSION_REVOKED'});});
    await expect(runAssistantOrchestrator({...query,history:['Dato privado del turno anterior']},h.deps)).rejects.toMatchObject({code:'SESSION_REVOKED'});
    expect(h.create).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledWith(principal,'unused-reservation',{inputTokens:0,outputTokens:0});
  });
});
