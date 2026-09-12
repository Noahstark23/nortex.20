import type { PrismaClient } from '@prisma/client';
import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
import { createOperationTools } from '../backend/services/assistant/operations/tools';
const principal={tenantId:'tenant-a',userId:'user-a',role:'OWNER'};
function harness(role='OWNER'){
  const mocks={user:{findFirst:vi.fn().mockResolvedValue({id:'user-a',role,status:'ACTIVE'})},employee:{findFirst:vi.fn().mockResolvedValue(null)},assistantTenantConfig:{findUnique:vi.fn().mockResolvedValue({enabled:true,operationsEnabled:true})}};
  return{mocks,db:mocks as unknown as PrismaClient};
}
beforeEach(()=>{vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');vi.stubEnv('NORTEX_ASSISTANT_OPERATIONS_ENABLED','true');});
afterEach(()=>vi.unstubAllEnvs());
describe('registro autorizado de herramientas operativas',()=>{
  it('lista lecturas de dueño sin incluir confirmaciones ni SQL',async()=>{
    const h=harness(),tools=await createOperationTools(principal,{db:h.db});
    expect(tools.map(tool=>tool.name)).toEqual(expect.arrayContaining(['get_business_overview','audit_business_health','check_inventory_burn_rate','inspect_batch_expiry','search_catalog','search_help','read_daily_brief']));
    expect(tools.some(tool=>/confirm|execute|sql/.test(tool.name))).toBe(false);
  });
  it('bodega no recibe herramienta de salud financiera',async()=>{
    const h=harness('BODEGUERO'),tools=await createOperationTools({...principal,role:'BODEGUERO'},{db:h.db});
    expect(tools.some(tool=>tool.name==='audit_business_health')).toBe(false);expect(tools.some(tool=>tool.name==='inspect_batch_expiry')).toBe(true);
    expect(tools.some(tool=>tool.name==='review_weekly_cash')).toBe(false);
    expect(tools.some(tool=>tool.name==='inspect_cash_close')).toBe(false);
  });
  it.each(['OWNER','ADMIN','SUPER_ADMIN','MANAGER','ACCOUNTANT','VIEWER','CASHIER','EMPLOYEE','VENDEDOR'])('ofrece revisión de caja de solo lectura al rol %s', async role => {
    const h=harness(role),tools=await createOperationTools({...principal,role},{db:h.db});
    expect(tools.find(tool=>tool.name==='review_weekly_cash')).toMatchObject({kind:'READ'});
    expect(tools.find(tool=>tool.name==='inspect_cash_close')).toMatchObject({kind:'READ'});
  });
  it('la función real valida argumentos y principal antes de devolver ayuda',async()=>{
    const h=harness(),tools=await createOperationTools(principal,{db:h.db}),tool=tools.find(tool=>tool.name==='search_help')!;
    const ctx={principal,conversationId:'conversation-a',runId:'run-a',toolCallId:'call-a',assertActive:vi.fn().mockResolvedValue(undefined)};
    await expect(tool.execute(ctx,{query:'compras',tenantId:'tenant-b'})).rejects.toThrow();
    await expect(tool.execute({...ctx,principal:{...principal,tenantId:'tenant-b'}},{query:'compras'})).rejects.toMatchObject({code:'TOOL_PRINCIPAL_CHANGED'});
    expect(await tool.execute(ctx,{query:'compras'})).toMatchObject({data:{citations:expect.arrayContaining([expect.objectContaining({id:'compras'})])}});
  });
  it('revocar al usuario después de crear el registro impide reutilizarlo',async()=>{
    const h=harness(),tool=(await createOperationTools(principal,{db:h.db}))[0];h.mocks.user.findFirst.mockResolvedValue(null);
    await expect(tool.execute({principal,conversationId:'c',runId:'r',toolCallId:'t',assertActive:async()=>{}},{query:'compras'})).rejects.toMatchObject({code:'SESSION_REVOKED'});
  });
  it.each([
    ['BODEGUERO',['prepare_supplier_return']],
    ['MANAGER',['prepare_purchase_order','prepare_supplier_return']],
    ['OWNER',['prepare_purchase_order','prepare_batch_writeoff','prepare_supplier_return']],
  ])('el modelo sólo recibe preparaciones permitidas para %s',async(role,names)=>{
    vi.stubEnv('NORTEX_ASSISTANT_ACTIONS_ENABLED','true');
    const h=harness(role as string);h.mocks.assistantTenantConfig.findUnique.mockResolvedValue({enabled:true,operationsEnabled:true,actionsEnabled:true});
    const tools=await createOperationTools({...principal,role:role as string},{db:h.db});
    expect(tools.filter(tool=>tool.kind==='PREPARE').map(tool=>tool.name)).toEqual(names);
  });
  it('promoción sólo se anuncia con su permiso específico y no acepta publicar por sí misma',async()=>{
    vi.stubEnv('NORTEX_ASSISTANT_ACTIONS_ENABLED','true');vi.stubEnv('NORTEX_PROMOTIONS_ENABLED','true');
    const h=harness();h.mocks.assistantTenantConfig.findUnique.mockResolvedValue({enabled:true,operationsEnabled:true,actionsEnabled:true,promotionsEnabled:true});
    const tools=await createOperationTools(principal,{db:h.db}),promotion=tools.find(tool=>tool.name==='prepare_promotion');
    expect(promotion?.kind).toBe('PREPARE');
    expect(promotion?.schema.safeParse({name:'Prueba',percent:'10',productIds:['p1']}).success).toBe(true);
    expect(promotion?.schema.safeParse({name:'Prueba',confirmed:true}).success).toBe(false);
  });
});
