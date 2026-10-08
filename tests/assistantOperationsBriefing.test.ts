import { Prisma,type PrismaClient } from '@prisma/client';
import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
import { buildDailyBriefItems,getDailyBrief,dismissDailyBriefItem } from '../backend/services/assistant/operations/briefing';
import type { BusinessHealthResult,BatchExpiryResult,InventoryBurnRateResult } from '../backend/services/assistant/operations/analyticsTypes';
const principal={tenantId:'tenant-a',userId:'user-a',role:'OWNER'},now=new Date('2026-09-05T16:00:00Z');
const period={startDate:'2026-09-05',endDate:'2026-09-05',cutoff:now.toISOString(),timeZone:'America/Managua' as const,completeDays:false};
const health:BusinessHealthResult={kind:'BUSINESS_HEALTH',status:'ok',checkedAt:now.toISOString(),period,metrics:[],evidence:[],warnings:[],comparison:{period,metrics:[],changes:[{key:'netSalesTotalChange',label:'Cambio de ventas netas',value:'-10',unit:'percent',status:'ok',source:'Ventas verificadas'}]}};
const inventory:InventoryBurnRateResult={kind:'INVENTORY_BURN_RATE',status:'ok',checkedAt:now.toISOString(),period,metrics:[],evidence:[],warnings:[],rows:[]};
const expiry:BatchExpiryResult={kind:'BATCH_EXPIRY',status:'ok',checkedAt:now.toISOString(),period,metrics:[],evidence:[],warnings:[],rows:Array.from({length:4},(_,i)=>({batchId:`batch-${i}`,batchNumber:`B-${i}`,productId:`product-${i}`,name:'Medicina',unit:'unidad',quantityStep:'1',supplierId:null,expiryDate:'2026-09-01',physicalStock:'2',warehouseId:null,sellableStock:'0',state:'EXPIRED',status:'ok',allowedActions:[],warnings:[]}))};
function harness(){
  let saved:{id:string;tenantId:string;userId:string;roleAtCreation:string;localDay:string;items:unknown;dismissedIds:unknown;expiresAt:Date}|undefined;
  const mocks={user:{findFirst:vi.fn().mockResolvedValue({id:principal.userId,role:principal.role,status:'ACTIVE'})},assistantTenantConfig:{findUnique:vi.fn().mockResolvedValue({enabled:true,operationsEnabled:true})},assistantDailyBrief:{
    findFirst:vi.fn(async({where}:{where:Record<string,unknown>})=>saved&&where.roleAtCreation===saved.roleAtCreation&&where.userId===saved.userId&&where.tenantId===saved.tenantId?saved:null),
    upsert:vi.fn(async({create}:{create:Omit<NonNullable<typeof saved>,'id'>})=>{saved={id:'brief-a',...create};return saved;}),
    updateMany:vi.fn(async({data}:{data:{dismissedIds:string[]}})=>{if(!saved)return{count:0};saved.dismissedIds=data.dismissedIds;return{count:1};}),
  },$queryRaw:vi.fn().mockResolvedValue([{id:principal.userId}]),$transaction:vi.fn()};
  mocks.$transaction.mockImplementation(async(fn:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>fn(mocks as unknown as Prisma.TransactionClient));
  const healthRead=vi.fn(async()=>health),inventoryRead=vi.fn(async()=>inventory),expiryRead=vi.fn(async()=>expiry);
  return{mocks,deps:{db:mocks as unknown as PrismaClient,now:()=>now,health:healthRead,inventory:inventoryRead,expiry:expiryRead},healthRead,inventoryRead,expiryRead};
}
beforeEach(()=>{vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');vi.stubEnv('NORTEX_ASSISTANT_OPERATIONS_ENABLED','true');});
afterEach(()=>vi.unstubAllEnvs());
describe('resumen diario determinista y privado',()=>{
  it('prioriza hasta tres avisos y sus identidades permanecen estables',()=>{
    const first=buildDailyBriefItems(principal,'2026-09-05',{health,expiry,inventory});
    expect(first).toHaveLength(3);expect(first.every(item=>item.area==='expiry')).toBe(true);
    expect(buildDailyBriefItems(principal,'2026-09-05',{health,expiry,inventory})).toEqual(first);
    expect(buildDailyBriefItems({...principal,userId:'another'},'2026-09-05',{expiry})[0].id).not.toBe(first[0].id);
  });
  it('bodega no recibe comparación financiera ni se ejecuta esa consulta',async()=>{
    const h=harness(),bodega={...principal,role:'BODEGUERO'};h.mocks.user.findFirst.mockResolvedValue({...bodega,id:bodega.userId,status:'ACTIVE'});
    expect(buildDailyBriefItems(bodega,'2026-09-05',{health})).toEqual([]);
    const result=await getDailyBrief(bodega,h.deps);expect(result.items.every(item=>item.area==='expiry')).toBe(true);expect(h.healthRead).not.toHaveBeenCalled();
  });
  it('recargar reutiliza snapshot y conserva descartes',async()=>{
    const h=harness(),first=await getDailyBrief(principal,h.deps);
    const dismissed=await dismissDailyBriefItem(principal,first.id,first.items[0].id,h.deps);
    expect(dismissed.dismissedIds).toEqual([first.items[0].id]);
    expect(await getDailyBrief(principal,h.deps)).toEqual(dismissed);
    expect(h.healthRead).toHaveBeenCalledTimes(1);expect(h.mocks.assistantDailyBrief.upsert).toHaveBeenCalledTimes(1);
    await expect(dismissDailyBriefItem(principal,first.id,'foreign-item',h.deps)).rejects.toMatchObject({code:'BRIEF_ITEM_NOT_FOUND'});
  });
  it('un fallo se presenta como falta de datos, no como cero pendientes',async()=>{
    const h=harness();h.healthRead.mockRejectedValue(new Error('query failed'));h.expiryRead.mockResolvedValue({...expiry,rows:[]});
    const result=await getDailyBrief(principal,h.deps);expect(result.items[0].title).toBe('Revisión incompleta');expect(result.items[0].text).toContain('no significa');
  });
  it('usuario deshabilitado no lee fuentes ni resumen',async()=>{
    const h=harness();h.mocks.user.findFirst.mockResolvedValue(null);
    await expect(getDailyBrief(principal,h.deps)).rejects.toMatchObject({code:'SESSION_REVOKED'});expect(h.healthRead).not.toHaveBeenCalled();
  });
  it('una fuente no disponible sin excepción tampoco implica cero pendientes',async()=>{
    const h=harness();h.healthRead.mockResolvedValue({...health,status:'unavailable',comparison:{...health.comparison,changes:[]}});h.expiryRead.mockResolvedValue({...expiry,rows:[]});
    const result=await getDailyBrief(principal,h.deps);
    expect(result.items[0]?.title).toBe('Revisión incompleta');
  });
  it('un catálogo recortado revela el alcance incluso sin avisos accionables',async()=>{
    const h=harness();h.healthRead.mockResolvedValue({...health,comparison:{...health.comparison,changes:[]}});
    h.expiryRead.mockResolvedValue({...expiry,rows:Array.from({length:10},(_,i)=>({...expiry.rows[0],batchId:`b${i}`,status:'unavailable'}))});
    const result=await getDailyBrief(principal,h.deps);
    expect(result.items[0]?.title).toBe('Revisión de alcance limitado');expect(result.items[0]?.text).toContain('10 productos y 10 lotes');
  });
});


describe('resumen diario con historial insuficiente',()=>{
  const row:InventoryBurnRateResult['rows'][number]={productId:'nuevo',name:'Cemento nuevo',unit:'bolsa',quantityStep:'1',supplierId:null,
    physicalStock:'2',sellableStock:'2',soldBaseQuantity:'30',returnedBaseQuantity:'0',netBaseQuantity:'30',dailyAverage:null,
    estimatedDaysRemaining:null,pendingOrderQuantity:'1',suggestedQuantity:'2',status:'partial',warnings:['Historial insuficiente.'],
    historyStatus:'INSUFFICIENT',historyAvailableDays:7,historyRequiredDays:30,configuredMinimum:'5',configuredMaximum:'100',suggestionBasis:'CONFIGURED_MINIMUM',
    restockedBaseQuantity:'0',quarantinedBaseQuantity:'0',lostBaseQuantity:'0',stockConsumptionBaseQuantity:'30'};
  it('avisa el mínimo configurado sin inventar consumo o días de agotamiento',()=>{
    const items=buildDailyBriefItems(principal,'2026-09-05',{inventory:{...inventory,status:'partial',rows:[row]}});
    expect(items).toHaveLength(1);expect(items[0].title).toBe('Existencias bajo el mínimo');
    expect(items[0].text).toContain('mínimo configurado 5');expect(items[0].text).toContain('no estima una fecha');
    expect(items[0].text).not.toContain('cobertura estimada');
  });
  it('no recomienda ante datos inconsistentes o mínimos cubiertos por OC',()=>{
    for(const patch of [{status:'unavailable' as const},{suggestedQuantity:'0'},{suggestedQuantity:null}])
      expect(buildDailyBriefItems(principal,'2026-09-05',{inventory:{...inventory,rows:[{...row,...patch}]}})).toEqual([]);
  });
});
