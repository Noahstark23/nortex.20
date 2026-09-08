import type { PrismaClient } from '@prisma/client';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { getAssistantHealthStatus } from '../backend/services/assistant/operations/healthStatus';
const now=new Date('2026-09-01T04:00:00Z');
const emptyBudget={bucketCount:0,reservations:0,unknownCount:0,unknownUsd:'0',activeReservationsUsd:'0',settledUsd:'0',missingSettledCost:0,spentUsd:null,reservedUsd:null,limitUsd:null,blocked:null};
function fixture(role='OWNER') {
  const actor={tenantId:'tenant-a',userId:'user-a',role};
  const db={user:{findFirst:vi.fn().mockResolvedValue({id:actor.userId,role,status:'ACTIVE'})},assistantTenantConfig:{findUnique:vi.fn().mockResolvedValue({enabled:true})},
    $queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([emptyBudget]).mockResolvedValueOnce([]).mockResolvedValueOnce([])};
  return {actor,db,deps:{db:db as unknown as PrismaClient,now:()=>now}};
}
beforeEach(()=>vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true'));afterEach(()=>vi.unstubAllEnvs());

describe('Estado administrativo: evidencia agregada y privacidad',()=>{
  it.each(['MANAGER','ACCOUNTANT','CASHIER','BODEGUERO','VIEWER'])('%s no recibe indicadores administrativos',async role=>{
    const {actor,db,deps}=fixture(role);await expect(getAssistantHealthStatus(actor,deps)).rejects.toMatchObject({statusCode:403});expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('apagado valida sesión pero no toca tablas nuevas',async()=>{
    const {actor,db,deps}=fixture();vi.stubEnv('NORTEX_ASSISTANT_ENABLED','false');
    const result=await getAssistantHealthStatus(actor,deps);expect(result).toMatchObject({status:'disabled',capabilities:{enabled:false},runs:null,budget:null});
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);expect(db.assistantTenantConfig.findUnique).not.toHaveBeenCalled();expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('un usuario revocado tampoco recibe estado disabled',async()=>{
    const {actor,db,deps}=fixture();vi.stubEnv('NORTEX_ASSISTANT_ENABLED','false');db.user.findFirst.mockResolvedValue(null);
    await expect(getAssistantHealthStatus(actor,deps)).rejects.toMatchObject({code:'SESSION_REVOKED'});
  });
  it('un negocio deshabilitado omite consultas operativas',async()=>{
    const {actor,db,deps}=fixture();db.assistantTenantConfig.findUnique.mockResolvedValue({enabled:false});expect((await getAssistantHealthStatus(actor,deps)).status).toBe('disabled');expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('sin actividad verificada hay conteos cero pero no latencia ni saldo inventado',async()=>{
    const {actor,deps}=fixture();const result=await getAssistantHealthStatus(actor,deps);
    expect(result).toMatchObject({month:'2026-08',window:{start:'2026-08-31T04:00:00.000Z',end:'2026-09-01T04:00:00.000Z'},runs:{total:'0',averageLatencyMs:null,latencySamples:'0'},budget:{spentUsd:null,remainingUsd:null,usageReservations:'0'},queues:{extraction:{byStatus:{PENDING:'0'},ready:'0'}}});
  });
  it('sólo devuelve agregados, cuatro consultas acotadas al negocio y nada de texto',async()=>{
    const {actor,db,deps}=fixture();await getAssistantHealthStatus(actor,deps);expect(db.$queryRaw).toHaveBeenCalledTimes(4);
    for(const [query] of db.$queryRaw.mock.calls){expect(query.values).toContain(actor.tenantId);expect(query.sql).not.toMatch(/SELECT \*|inputText|checkpoint|providerRequestId|payload|attachmentIds|\btext\b|INSERT|UPDATE|DELETE/);}
    const budget=db.$queryRaw.mock.calls[1][0];expect(budget.values).toContain('tenant:tenant-a');expect(budget.values).not.toContain('global');
  });
  it('latencia usa muestras reales y conserva falta de timestamps',async()=>{
    const {actor,db,deps}=fixture();db.$queryRaw.mockReset().mockResolvedValueOnce([{status:'SUCCEEDED',count:3,degraded:1,degradedUnknown:0,latencySamples:2,latencyUnknown:1,latencyMs:'5000',firstStartedAt:new Date('2026-08-31T12:00:00Z'),lastFinishedAt:new Date('2026-08-31T12:00:05Z')}]).mockResolvedValueOnce([emptyBudget]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect((await getAssistantHealthStatus(actor,deps)).runs).toMatchObject({status:'partial',total:'3',degraded:'1',averageLatencyMs:'2500',latencySamples:'2',latencyUnknown:'1'});
  });
  it('una latencia observada de cero no se confunde con falta de muestra',async()=>{
    const {actor,db,deps}=fixture();db.$queryRaw.mockReset().mockResolvedValueOnce([{status:'SUCCEEDED',count:1,degraded:0,degradedUnknown:0,latencySamples:1,latencyUnknown:0,latencyMs:'0'}]).mockResolvedValueOnce([emptyBudget]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect((await getAssistantHealthStatus(actor,deps)).runs.averageLatencyMs).toBe('0');
  });
  it('UNKNOWN se muestra como reserva incierta del tenant y no gasto confirmado',async()=>{
    const {actor,db,deps}=fixture();db.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{...emptyBudget,bucketCount:1,reservations:3,unknownCount:1,unknownUsd:'.2',activeReservationsUsd:'.5',settledUsd:'1.25',spentUsd:'1.25',reservedUsd:'.5',limitUsd:'10',blocked:0}]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect((await getAssistantHealthStatus(actor,deps)).budget).toMatchObject({status:'ok',scope:'TENANT_ONLY',spentUsd:'1.25',reservedUsd:'0.5',unknownReservedUsd:'0.2',remainingUsd:'8.25',reconciled:true});
  });
  it('no deduce replays a partir de comandos guardados',async()=>{
    const {actor,deps}=fixture();expect((await getAssistantHealthStatus(actor,deps)).commands.replayed).toMatchObject({status:'unavailable',value:null});
  });
  it('falla de un agregado produce partial y no aparenta un contador cero',async()=>{
    const {actor,db,deps}=fixture();db.$queryRaw.mockReset().mockRejectedValueOnce(new Error('private-database-detail')).mockResolvedValueOnce([emptyBudget]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result=await getAssistantHealthStatus(actor,deps);expect(result.status).toBe('partial');expect(result.runs.total).toBeNull();expect(JSON.stringify(result)).not.toContain('private-database-detail');
  });
  it('si no se pudo consultar ningún agregado informa unavailable',async()=>{
    const {actor,db,deps}=fixture();db.$queryRaw.mockReset().mockRejectedValue(new Error('fail'));expect((await getAssistantHealthStatus(actor,deps)).status).toBe('unavailable');
  });
  it('permisos revocados durante la lectura impiden retornar datos',async()=>{
    const {actor,db,deps}=fixture();db.user.findFirst.mockResolvedValueOnce({id:actor.userId,role:'OWNER',status:'ACTIVE'}).mockResolvedValueOnce(null);await expect(getAssistantHealthStatus(actor,deps)).rejects.toMatchObject({code:'SESSION_REVOKED'});
  });
  it('apagado durante la lectura oculta los agregados ya leídos',async()=>{
    const {actor,db,deps}=fixture();db.assistantTenantConfig.findUnique.mockResolvedValueOnce({enabled:true}).mockResolvedValueOnce({enabled:false});expect(await getAssistantHealthStatus(actor,deps)).toMatchObject({status:'disabled',runs:null,budget:null});
  });
});
