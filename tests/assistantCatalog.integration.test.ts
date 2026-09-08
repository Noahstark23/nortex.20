import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { applyStockDelta } from '../backend/services/stockService';
import { searchAssistantCatalog, approveAssistantCatalogAlias } from '../backend/services/assistant/operations/catalogSearch';
import { getAssistantCatalogOptions } from '../backend/services/assistant/operations/catalogOptions';

const qa=process.env.NORTEX_MYSQL_INTEGRATION==='1'?describe.sequential:describe.skip;
const deps={db:prisma};
async function seed(role='OWNER') {
  const nonce=randomUUID();
  const tenant=await prisma.tenant.create({data:{businessName:'QA catálogo sintético',taxId:`QA-${nonce}`,type:'FERRETERIA'}});
  const user=await prisma.user.create({data:{tenantId:tenant.id,name:'QA catálogo',role,password:'NOT_A_LOGIN_ACCOUNT'}});
  const supplier=await prisma.supplier.create({data:{tenantId:tenant.id,name:'Proveedor origen QA'}});
  const warehouse=await prisma.warehouse.create({data:{tenantId:tenant.id,name:'Principal QA',isDefault:true}});
  const product=await prisma.product.create({data:{tenantId:tenant.id,createdBy:user.id,name:'Cemento gris 50 kg',sku:nonce,price:20,cost:8,unit:'bolsa',saleMode:'COUNTED',quantityStep:'1'}});
  await prisma.assistantTenantConfig.create({data:{tenantId:tenant.id,enabled:true}});
  await prisma.$transaction(async tx=>{await applyStockDelta(tx,{tenantId:tenant.id,productId:product.id,warehouseId:warehouse.id,delta:10,enforceSufficient:true});await tx.auditLog.create({data:{tenantId:tenant.id,userId:user.id,action:'QA_CATALOG_STOCK',details:'{"quantity":"10"}'}});});
  return {tenantId:tenant.id,userId:user.id,role,productId:product.id,warehouseId:warehouse.id,supplierId:supplier.id};
}
type Fixture=Awaited<ReturnType<typeof seed>>;
async function purchase(f:Fixture, order?:{id:string;itemId:string}) {
  return prisma.purchase.create({data:{tenantId:f.tenantId,supplierId:f.supplierId,invoiceNumber:`QA-${randomUUID()}`,createdBy:f.userId,subtotal:'80',total:'80',paymentMethod:'CREDIT',
    purchaseOrderId:order?.id,items:{create:{productId:f.productId,productName:'Cemento gris 50 kg',quantity:10,quantityExact:'10',unitCost:'8',totalCost:'80',
      purchaseOrderItemId:order?.itemId,inventoryWarehouseId:f.warehouseId,inventoryUnitCostExact:'8'}}},include:{items:true}});
}
async function receipt(f:Fixture) {
  const order=await prisma.purchaseOrder.create({data:{tenantId:f.tenantId,supplierId:f.supplierId,orderNumber:`QA-OC-${randomUUID()}`,status:'RECEIVED',createdBy:f.userId,
    items:{create:{productId:f.productId,productName:'Cemento gris 50 kg',quantityOrdered:10,quantityReceived:10,quantityOrderedExact:'10',quantityReceivedExact:'10',unitCost:'8',unitAtOrder:'bolsa',saleModeAtOrder:'COUNTED',quantityStepAtOrder:'1'}}},include:{items:true}});
  const goods=await prisma.goodsReceipt.create({data:{tenantId:f.tenantId,purchaseOrderId:order.id,warehouseId:f.warehouseId,receiptNumber:`QA-GR-${randomUUID()}`,clientEventId:randomUUID(),payloadHash:'QA_SYNTHETIC',receivedBy:f.userId,
    items:{create:{tenantId:f.tenantId,purchaseOrderItemId:order.items[0].id,productId:f.productId,quantityExact:'10',unitSnapshot:'bolsa',saleModeSnapshot:'COUNTED',unitCostExact:'8'}}},include:{items:true}});
  return {order,goods};
}
qa('Catálogo: MySQL 8 y HTTP autenticado sin proveedor externo',()=>{
  let server:Server, origin:string, sign:(actor:{tenantId:string;userId:string;role:string})=>string;
  beforeAll(async()=>{
    const url=new URL(process.env.DATABASE_URL??'invalid:');expect(url.protocol).toBe('mysql:');expect(['127.0.0.1','localhost','[::1]']).toContain(url.hostname);expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(?:_[a-z0-9_]+)?$/);
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');vi.stubEnv('JWT_SECRETS','synthetic-catalog-test-signing-key');
    const [{createAssistantCatalogRouter},{signAuthToken}]=await Promise.all([import('../backend/routes/assistantCatalog'),import('../backend/services/secrets')]);sign=signAuthToken;
    const app=express();app.use(express.json());app.use('/api/assistant',createAssistantCatalogRouter(deps));server=app.listen(0,'127.0.0.1');await once(server,'listening');
    origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));vi.unstubAllEnvs();});
  const read=async(f:Fixture,path:string)=>fetch(`${origin}/api/assistant/catalog?${path}`,{headers:{Authorization:`Bearer ${sign(f)}`}});
  it('alias aprobado es auditable, recuperable por SQL y aislado por tenant',async()=>{
    const f=await seed(),other=await seed();
    const alias=await approveAssistantCatalogAlias(f,{productId:f.productId,alias:'Portland fuerte'},prisma);
    expect(await searchAssistantCatalog(f,{kind:'products',query:'portland fuerte'},deps)).toMatchObject({rows:[{id:f.productId}]});
    expect((await searchAssistantCatalog(other,{kind:'products',query:'portland fuerte'},deps)).rows).toEqual([]);
    expect(await prisma.auditLog.count({where:{tenantId:f.tenantId,action:'ASSISTANT_CATALOG_ALIAS_APPROVED'}})).toBe(1);
    expect(await approveAssistantCatalogAlias(f,{productId:f.productId,alias:'Portland fuerte'},prisma)).toEqual(alias);
    expect(await prisma.auditLog.count({where:{tenantId:f.tenantId,action:'ASSISTANT_CATALOG_ALIAS_APPROVED'}})).toBe(1);
  });
  it('una auditoría fallida revierte el alias dentro de la misma transacción real',async()=>{
    const f=await seed();
    const failing=new Proxy(prisma,{get(target,key){if(key==='$transaction')return (work:any)=>target.$transaction(tx=>work(new Proxy(tx,{get(inner,property){if(property==='auditLog')return {create:()=>{throw new Error('QA_AUDIT_FAILURE');}};return Reflect.get(inner,property);}})));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as PrismaClient;
    await expect(approveAssistantCatalogAlias(f,{productId:f.productId,alias:'Alias sin auditoría'},failing)).rejects.toThrow('QA_AUDIT_FAILURE');
    expect(await prisma.assistantCatalogAlias.count({where:{tenantId:f.tenantId}})).toBe(0);
  });
  it('un error de letra devuelve candidatos y mantiene la concentración numérica exacta',async()=>{
    const f=await seed();await prisma.product.update({where:{id:f.productId},data:{name:'Amoxicilina 500 mg'}});
    await prisma.product.create({data:{tenantId:f.tenantId,createdBy:f.userId,name:'Amoxicilina 250 mg',sku:randomUUID(),price:20,cost:4}});
    const result=await searchAssistantCatalog(f,{kind:'products',query:'amoxcilina 500 mg'},deps);
    expect(result.rows.map(row=>row.id)).toEqual([f.productId]);expect(result.warnings[0]).toMatch(/aproximadas/);
    expect((await searchAssistantCatalog(f,{kind:'products',query:'amoxicilina 5000 mg'},deps)).rows).toEqual([]);
  });
  it('HTTP bodega lee productos sin costo, mantiene items y cache privado',async()=>{
    const f=await seed('BODEGUERO');const response=await read(f,'kind=products&query=cemento');expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body=await response.json();expect(body.items[0]).toMatchObject({id:f.productId,label:'Cemento gris 50 kg'});expect(JSON.stringify(body)).not.toMatch(/"(cost|price|unitCost|tenantId)"/);
    expect((await read(f,'kind=suppliers')).status).toBe(403);
  });
  it('proveedores para devolución se limitan al origen del producto incluso para bodega',async()=>{
    const f=await seed('BODEGUERO'),other=await seed();await purchase(f);await purchase(other);
    await prisma.supplier.create({data:{tenantId:f.tenantId,name:'Nunca entregó este producto'}});
    const response=await read(f,`kind=returnSuppliers&productId=${f.productId}`);expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([{id:f.supplierId,label:'Proveedor origen QA'}]);
    expect((await read(f,`kind=returnSuppliers&productId=${other.productId}`)).status).toBe(404);
  });
  it('fuente directa conserva procedencia sin afirmar saldo disponible',async()=>{
    const f=await seed('BODEGUERO'),source=await purchase(f);
    const result=await getAssistantCatalogOptions(f,{kind:'supplierReturnSources',supplierId:f.supplierId,productId:f.productId},deps);
    expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({id:source.items[0].id,sourceType:'DIRECT_PURCHASE_ITEM',availableQuantity:null,reviewRequired:true});
    expect(JSON.stringify(result)).not.toMatch(/"(cost|total|unitCost|bookValue)"/);
  });
  it('una recepción sin factura y una asignación de matching preservan identidades distintas',async()=>{
    const f=await seed('BODEGUERO'),{order,goods}=await receipt(f),matched=await purchase(f,{id:order.id,itemId:order.items[0].id});
    const allocation=await prisma.purchaseMatchAllocation.create({data:{tenantId:f.tenantId,purchaseItemId:matched.items[0].id,purchaseOrderItemId:order.items[0].id,goodsReceiptItemId:goods.items[0].id,quantityExact:'4',expectedUnitCostExact:'8',actualUnitCostExact:'8',priceVarianceExact:'0'}});
    const result=await getAssistantCatalogOptions(f,{kind:'supplierReturnSources',supplierId:f.supplierId,productId:f.productId},deps);
    expect(result.items).toHaveLength(2);expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({id:allocation.id,sourceType:'PURCHASE_MATCH_ALLOCATION',sourceRemainingQuantity:'4.0000',availableQuantity:null}),
      expect.objectContaining({id:goods.items[0].id,sourceType:'GOODS_RECEIPT_UNMATCHED',sourceRemainingQuantity:'6.0000',availableQuantity:null}),
    ]));
  });
  it('recepción sin stock reconciliado devuelve un bloqueo, nunca disponibilidad',async()=>{
    const f=await seed('BODEGUERO');await receipt(f);await prisma.productStock.deleteMany({where:{tenantId:f.tenantId}});
    const result=await getAssistantCatalogOptions(f,{kind:'supplierReturnSources',supplierId:f.supplierId,productId:f.productId},deps);
    expect(result.items[0]).toMatchObject({availableQuantity:null,sourceRemainingQuantity:null,blockCode:'STOCK_ROW_MISSING'});
  });
  it('HTTP rechaza IDs de otro negocio y un usuario deshabilitado',async()=>{
    const f=await seed(),other=await seed();
    expect((await read(f,`kind=supplierReturnSources&supplierId=${other.supplierId}&productId=${f.productId}`)).status).toBe(404);
    await prisma.user.update({where:{id:f.userId},data:{status:'DISABLED'}});expect((await read(f,'kind=products')).status).toBeGreaterThanOrEqual(401);
  });
  it('lotes muestran sólo referencias del producto; no asignan bodega por suposición',async()=>{
    const f=await seed();const batch=await prisma.productBatch.create({data:{tenantId:f.tenantId,productId:f.productId,batchNumber:'QA-LOTE',expiryDate:new Date('2026-09-30T00:00:00Z'),stock:10}});
    const result=await getAssistantCatalogOptions(f,{kind:'batches',productId:f.productId},deps);expect(result.items[0]).toMatchObject({id:batch.id,reviewRequired:true});expect(result.items[0]).not.toHaveProperty('warehouseId');
  });
});
