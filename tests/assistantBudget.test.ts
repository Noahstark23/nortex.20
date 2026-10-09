import { beforeEach,describe,expect,it,vi } from 'vitest';
import Decimal from 'decimal.js';
vi.mock('../backend/services/assistant/access.js',()=>({assertAssistantAccess:vi.fn().mockResolvedValue(undefined)}));
import { assertAssistantAccess } from '../backend/services/assistant/access.js';
import { reserveAssistantBudget,settleAssistantBudget,tokenCostUsd,budgetMonth,MAX_EXTRACTION_RESERVATION_USD } from '../backend/services/assistant/budget.js';
const principal={tenantId:'tenant',userId:'user',role:'OWNER'};
function database() {
  const buckets=new Map<string,any>(),usages=new Map<string,any>();
  const tx={
    $executeRaw:vi.fn(async(query:any)=>{const [id,scope,month,limitUsd]=query.values;if(!buckets.has(id))buckets.set(id,{id,scope,month,limitUsd,reservedUsd:new Decimal(0),spentUsd:new Decimal(0)});else buckets.get(id).limitUsd=limitUsd;return 1;}),
    $queryRaw:vi.fn(async(query:any)=>{const row=buckets.get(query.values[0]);return row?[row]:[];}),
    assistantTenantConfig:{findUnique:vi.fn().mockResolvedValue({monthlyBudgetUsd:new Decimal(10)})},
    assistantBudget:{
      createMany:vi.fn(async({data}:any)=>{for(const row of data)if(!buckets.has(row.id))buckets.set(row.id,{...row,reservedUsd:new Decimal(0),spentUsd:new Decimal(0)});return{count:data.length};}),
      findUniqueOrThrow:vi.fn(async({where}:any)=>buckets.get(where.id)),
      update:vi.fn(async({where,data}:any)=>{const row=buckets.get(where.id);if(data.reservedUsd)row.reservedUsd=new Decimal(row.reservedUsd).add(data.reservedUsd.increment);if(data.limitUsd)row.limitUsd=data.limitUsd;return row;}),
      updateMany:vi.fn(async({where,data}:any)=>{const row=buckets.get(where.id);if(!row||(where.reservedUsd&&new Decimal(row.reservedUsd).lt(where.reservedUsd.gte)))return{count:0};if(data.reservedUsd.increment)row.reservedUsd=new Decimal(row.reservedUsd).add(data.reservedUsd.increment);else {row.reservedUsd=new Decimal(row.reservedUsd).sub(data.reservedUsd.decrement);row.spentUsd=new Decimal(row.spentUsd).add(data.spentUsd.increment);}if(data.blocked)row.blocked=true;return{count:1};}),
    },
    assistantUsage:{create:vi.fn(async({data}:any)=>{const row={...data};usages.set(data.id,row);return row;}),findFirst:vi.fn(async({where}:any)=>{const row=usages.get(where.id);return row?.tenantId===where.tenantId&&row?.userId===where.userId?row:null;}),updateMany:vi.fn(async({where,data}:any)=>{Object.assign(usages.get(where.id),data);return{count:1};})},
  };
  const db={...tx,$transaction:async(fn:any)=>fn(tx)};
  return{db:db as any,buckets,usages,tx};
}
describe('contabilidad exacta del presupuesto IA',()=>{
  it('calcula ambos tipos de token con Decimal y mes civil Managua',()=>{
    expect(tokenCostUsd(1000,1000)).toBe('0.006000');expect(MAX_EXTRACTION_RESERVATION_USD).toBe('0.281920');
    expect(budgetMonth(new Date('2026-10-01T05:59:59Z'))).toBe('2026-09');expect(budgetMonth(new Date('2026-10-01T06:00:00Z'))).toBe('2026-10');
    expect(()=>tokenCostUsd(-1,0)).toThrow();expect(()=>tokenCostUsd(1.5,0)).toThrow();
  });
  it('reserva en ambos buckets y bloquea exceder el límite del tenant',async()=>{
    const {db,buckets}=database();const deps={db,now:()=>new Date('2026-09-05')};
    for(let i=0;i<8;i++)await reserveAssistantBudget(principal,'0.25',deps);
    expect(buckets.get('tenant:tenant:2026-09').reservedUsd.toString()).toBe('2');expect(buckets.get('global:2026-09').reservedUsd.toString()).toBe('2');
    await expect(reserveAssistantBudget(principal,'0.25',deps)).rejects.toMatchObject({code:'BUDGET_EXHAUSTED'});
  });
  it('consumo help de ADMIN no exige gestión ni consulta autoridad de Employee',async()=>{
    const {db,buckets,tx}=database();const actor={...principal,role:'ADMIN'};
    const query=tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation(async(input:any)=>{
      if(input.sql.includes('Employee'))throw new Error('La reserva no depende de RRHH');
      return query(input);
    });
    const usage=await reserveAssistantBudget(actor,'0.25',{db,capability:'help',now:()=>new Date('2026-09-05')});
    expect(usage).toMatchObject({userId:actor.userId,tenantId:actor.tenantId,status:'RESERVED'});
    expect(buckets.get('tenant:tenant:2026-09').reservedUsd.toString()).toBe('0.25');
    expect(assertAssistantAccess).toHaveBeenCalledWith(actor,'help',expect.anything());
  });
  it('settle duplicado registra una sola vez y devuelve sobrante de reserva',async()=>{
    const {db,buckets,usages}=database();const deps={db,now:()=>new Date('2026-09-05')};const row=await reserveAssistantBudget(principal,'0.25',deps);
    await settleAssistantBudget(principal,row.id,{inputTokens:1000,outputTokens:1000},deps);await settleAssistantBudget(principal,row.id,{inputTokens:1000,outputTokens:1000},deps);
    expect(buckets.get('global:2026-09').spentUsd.toString()).toBe('0.006');expect(buckets.get('global:2026-09').reservedUsd.toString()).toBe('0');expect(usages.get(row.id).status).toBe('SETTLED');
  });
  it('resultado desconocido retiene reserva y otro usuario no puede liquidarla',async()=>{
    const {db,buckets,usages}=database();const deps={db,now:()=>new Date('2026-09-05')};const row=await reserveAssistantBudget(principal,'0.25',deps);
    await settleAssistantBudget({...principal,userId:'other'},row.id,{inputTokens:0,outputTokens:0},deps);expect(usages.get(row.id).status).toBe('RESERVED');
    await settleAssistantBudget(principal,row.id,null,deps);expect(buckets.get('global:2026-09').reservedUsd.toString()).toBe('0.25');expect(usages.get(row.id).status).toBe('UNKNOWN');
  });
  it('consumo mayor al límite reservado queda registrado y bloquea nuevas llamadas',async()=>{
    const {db,buckets,usages}=database();const deps={db,now:()=>new Date('2026-09-05')};const row=await reserveAssistantBudget(principal,'0.001',deps);
    await settleAssistantBudget(principal,row.id,{inputTokens:1000,outputTokens:1000},deps);
    expect(buckets.get('global:2026-09').spentUsd.toString()).toBe('0.006');expect(buckets.get('global:2026-09').blocked).toBe(true);expect(usages.get(row.id).actualUsd).toBe('0.006000');
    await expect(reserveAssistantBudget(principal,'0.001',deps)).rejects.toMatchObject({code:'BUDGET_EXHAUSTED'});
  });
});
