import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { searchAssistantCatalog, normalizeCatalogQuery, approximateCatalogPatterns, approveAssistantCatalogAlias } from '../backend/services/assistant/operations/catalogSearch';
import { getAssistantCatalogOptions, assistantCatalogOptionsSchema } from '../backend/services/assistant/operations/catalogOptions';
function fixture(role='OWNER') {
  const actor={tenantId:'tenant-a',userId:'user-a',role};
  const db={user:{findFirst:vi.fn().mockResolvedValue({id:actor.userId,role,status:'ACTIVE'})},assistantTenantConfig:{findUnique:vi.fn().mockResolvedValue({enabled:true})},
    product:{findFirst:vi.fn().mockResolvedValue({id:'product-a'})},supplier:{findFirst:vi.fn().mockResolvedValue({id:'supplier-a'})},
    warehouse:{findMany:vi.fn().mockResolvedValue([{id:'warehouse-a',name:'Principal'}])}, productBatch:{findMany:vi.fn().mockResolvedValue([])},
    $queryRaw:vi.fn().mockResolvedValue([]),$transaction:vi.fn()};
  return {actor,db,deps:{db:db as unknown as PrismaClient}};
}
beforeEach(()=>vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true'));
afterEach(()=>vi.unstubAllEnvs());

describe('Catálogo autorizado: candidatos sin equivalencias supuestas',()=>{
  it('normaliza tildes y espacios conservando concentración decimal',()=>{
    expect(normalizeCatalogQuery('  Ácido FÓLICO 0.5 mg / tableta  ')).toBe('acido folico 0.5 mg tableta');
  });
  it('tolera una letra sustituida, insertada, omitida o traspuesta sólo en texto',()=>{
    const patterns=approximateCatalogPatterns('cemento');
    expect(patterns).toEqual(expect.arrayContaining(['%_emento%','%_cemento%','%emento%','%ecmento%']));
  });
  it.each(['500','5mg','abc','amoxi500'])('nunca difumina números ni token inseguro %s',token=>expect(approximateCatalogPatterns(token)).toEqual([]));
  it('mantiene todos los términos del medicamento, también después del quinto',async()=>{
    const {actor,db,deps}=fixture();
    await searchAssistantCatalog(actor,{kind:'products',query:'uno dos tres cuatro cinco 500 mg'},deps);
    expect(db.$queryRaw.mock.calls[0][0].values).toContain('%500%');
  });
  it('escapa comodines y mantiene tenant en parámetros de SQL',async()=>{
    const {actor,db,deps}=fixture(); await searchAssistantCatalog(actor,{kind:'products',query:'SKU_1% x'},deps);
    const sql=db.$queryRaw.mock.calls[0][0]; expect(sql.values).toContain(actor.tenantId); expect(sql.sql).not.toContain(actor.tenantId);
    expect(sql.sql).toMatch(/ORDER BY[\s\S]*LIMIT/); expect(sql.sql).not.toMatch(/UPDATE|INSERT|DELETE/);
  });
  it('no consulta costos ni completa una unidad histórica faltante',async()=>{
    const {actor,db,deps}=fixture('BODEGUERO'); db.$queryRaw.mockResolvedValue([{id:'p',name:'Producto',quantityStep:null,saleMode:null}]);
    const result=await searchAssistantCatalog(actor,{kind:'products',query:'Producto'},deps);
    expect(result.rows[0]).toMatchObject({quantityStep:null,saleMode:null}); expect(result.rows[0]).not.toHaveProperty('cost');
    expect(db.$queryRaw.mock.calls[0][0].sql).not.toMatch(/p\.(cost|price)/);
  });
  it('marca resultado aproximado sin elegirlo automáticamente',async()=>{
    const {actor,db,deps}=fixture(); db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'p',name:'Cemento'}]);
    const result=await searchAssistantCatalog(actor,{kind:'products',query:'cemneto'},deps); expect(result.warnings[0]).toMatch(/aproximadas/); expect(result.rows).toHaveLength(1);
  });
  it('no hace fuzzy si una coincidencia exacta o alias aprobado ya resolvió candidatos',async()=>{
    const {actor,db,deps}=fixture(); db.$queryRaw.mockResolvedValue([{id:'p',name:'Cemento'}]);
    await searchAssistantCatalog(actor,{kind:'products',query:'cemento'},deps); expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('rechaza catálogo general de proveedores para bodega antes de leer datos',async()=>{
    const {actor,db,deps}=fixture('BODEGUERO'); await expect(searchAssistantCatalog(actor,{kind:'suppliers',query:''},deps)).rejects.toMatchObject({statusCode:403}); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('revalida una revocación ocurrida durante la lectura',async()=>{
    const {actor,db,deps}=fixture(); db.user.findFirst.mockResolvedValueOnce({id:actor.userId,role:'OWNER',status:'ACTIVE'}).mockResolvedValueOnce(null);
    await expect(searchAssistantCatalog(actor,{kind:'products',query:'cemento'},deps)).rejects.toMatchObject({code:'SESSION_REVOKED'});
  });
  it('no convierte una falla de MySQL en catálogo vacío',async()=>{
    const {actor,db,deps}=fixture(); db.$queryRaw.mockRejectedValue(new Error('unavailable')); await expect(searchAssistantCatalog(actor,{kind:'products',query:'cemento'},deps)).rejects.toThrow('unavailable');
  });
  it('el lector sin inventario no puede abrir lotes',async()=>{
    const {actor,db,deps}=fixture('CASHIER'); await expect(getAssistantCatalogOptions(actor,{kind:'batches',productId:'p'},deps)).rejects.toMatchObject({statusCode:403}); expect(db.product.findFirst).not.toHaveBeenCalled();
  });
  it('producto de otro tenant no sirve como llave para encontrar proveedor',async()=>{
    const {actor,db,deps}=fixture(); db.product.findFirst.mockResolvedValue(null); await expect(getAssistantCatalogOptions(actor,{kind:'returnSuppliers',productId:'foreign'},deps)).rejects.toMatchObject({statusCode:404}); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('bodega recibe almacenes activos y la forma legacy items',async()=>{
    const {actor,db,deps}=fixture('BODEGUERO'); expect(await getAssistantCatalogOptions(actor,{kind:'warehouses'},deps)).toEqual({items:[{id:'warehouse-a',label:'Principal'}],warnings:[]});
    expect(db.warehouse.findMany.mock.calls[0][0].where).toMatchObject({tenantId:actor.tenantId,isActive:true});
  });
  it.each([{kind:'batches'},{kind:'returnSuppliers'},{kind:'supplierReturnSources'},{kind:'products',tenantId:'foreign'},{kind:'products',limit:21}])('rechaza contexto incompleto o no autorizado %j',input=>expect(()=>assistantCatalogOptionsSchema.parse(input)).toThrow());
  it('gerencia no aprueba alias ni inicia transacción',async()=>{
    const {actor,db,deps}=fixture('MANAGER'); await expect(approveAssistantCatalogAlias(actor,{productId:'p',alias:'cementazo'},deps.db)).rejects.toMatchObject({statusCode:403}); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('no acepta alias compuesto sólo de signos',async()=>{
    const {actor,deps}=fixture(); await expect(approveAssistantCatalogAlias(actor,{productId:'p',alias:'%%%??'},deps.db)).rejects.toMatchObject({code:'ALIAS_INVALID'});
  });
});
