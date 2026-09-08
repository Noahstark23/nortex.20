/** Fixture reproducible exclusivamente en nortex_quality_operativo; jamás usa un modelo. */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import prisma from '../backend/lib/prisma.js';
import { registerPurchase } from '../backend/services/purchaseRegistrationService.js';
import { applyStockDelta } from '../backend/services/stockService.js';
import { applyBatchWarehouseDelta } from '../backend/services/productBatchWarehouseLedgerService.js';
import { prepareAssistantAction,previewAssistantAction,confirmAssistantAction } from '../backend/services/assistant/actions/service.js';
import { auditBusinessHealth } from '../backend/services/assistant/operations/analytics.js';
import { checkInventoryBurnRate,inspectBatchExpiry } from '../backend/services/assistant/operations/inventory.js';
import { createAssistantConversation } from '../backend/services/assistant/conversations.js';
import { createAssistantRun } from '../backend/services/assistant/operations/runService.js';
import { managuaDay,shiftCivilDay } from '../backend/services/assistant/operations/analyticsPeriod.js';
import type { AssistantPrincipal } from '../shared/assistant.js';
import type { AssistantActionKind } from '../shared/assistantOperations.js';

const marker='operativo-demo-20260905',password='NortexDemo-2026!';
const now=new Date(),today=managuaDay(now),expires=new Date(now.getTime()+30*86400_000);
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const flags=['NORTEX_ASSISTANT_ENABLED','NORTEX_ASSISTANT_OPERATIONS_ENABLED','NORTEX_ASSISTANT_ACTIONS_ENABLED','NORTEX_ASSISTANT_EXECUTION_ENABLED','NORTEX_PROMOTIONS_ENABLED'];
type Item={id:string;name:string;unit:string;price:number;cost:number;quantity:number;packSize:number;packUnit:string;tracked:boolean;expired?:boolean;exempt?:boolean};

async function seedVertical(vertical:'FERRETERIA'|'FARMACIA') {
  const slug=vertical.toLowerCase(),tenantId=`${marker}-${slug}`,email=`${slug}.demo@nortex.invalid`;
  const prior=await prisma.tenant.findUnique({where:{id:tenantId}});
  if(prior) {
    const user=await prisma.user.findUniqueOrThrow({where:{email}});
    const demoRun=await prisma.assistantRun.findFirst({where:{tenantId,userId:user.id,inputText:{startsWith:'Datos sintéticos de QA, sin modelo.'},status:'SUCCEEDED'},orderBy:{createdAt:'asc'}});
    if(!demoRun)throw new Error('Existe una fixture parcial de demo; no se duplicarán efectos al reintentar.');
    return{businessName:prior.businessName,email,conversationId:demoRun.conversationId,tenantId};
  }
  const tenant=await prisma.tenant.create({data:{id:tenantId,businessName:`${vertical==='FERRETERIA'?'Ferretería':'Farmacia'} Nortex Demo QA`,taxId:`QA-${tenantId}`,type:vertical,subscriptionStatus:'ACTIVE',trialEndsAt:expires,batchWarehouseLedgerMode:'ENFORCED'}});
  const user=await prisma.user.create({data:{id:`${tenantId}-owner`,tenantId,email,password:await bcrypt.hash(password,10),name:'Dueño de demostración QA',role:'OWNER'}});
  const principal:AssistantPrincipal={tenantId,userId:user.id,role:'OWNER'};
  await prisma.assistantTenantConfig.create({data:{tenantId,enabled:true,operationsEnabled:true,actionsEnabled:true,executionEnabled:true,promotionsEnabled:true,extractionEnabled:false,monthlyBudgetUsd:'10'}});
  const supplier=await prisma.supplier.create({data:{tenantId,name:vertical==='FERRETERIA'?'Distribuidora de Materiales Demo':'Distribuidora Salud Demo'}});
  const warehouse=await prisma.warehouse.create({data:{tenantId,name:'Principal',isDefault:true}});
  const definitions:Omit<Item,'id'>[]=vertical==='FERRETERIA'?[
    {name:'Cemento Holcim 42.5',unit:'bolsa',price:265,cost:200,quantity:50,packSize:20,packUnit:'pallet',tracked:false},
    {name:'Tornillos galvanizados',unit:'unidad',price:5,cost:2,quantity:250,packSize:100,packUnit:'caja',tracked:false},
    {name:'Pintura látex blanca QA',unit:'litro',price:110,cost:60,quantity:12,packSize:4,packUnit:'galón',tracked:true,expired:true},
  ]:[
    {name:'Acetaminofén 500 mg QA',unit:'tableta',price:3,cost:1,quantity:50,packSize:10,packUnit:'blíster',tracked:true,exempt:true},
    {name:'Sales de rehidratación QA',unit:'sobre',price:25,cost:12,quantity:80,packSize:10,packUnit:'caja',tracked:true,exempt:true},
    {name:'Alcohol antiséptico QA',unit:'frasco',price:45,cost:30,quantity:12,packSize:6,packUnit:'caja',tracked:true,expired:true},
  ];
  const items:Item[]=[];
  for(const [index,item]of definitions.entries()) {
    const product=await prisma.product.create({data:{tenantId,createdBy:user.id,name:item.name,sku:`DEMO-${slug}-${index}`,price:item.price,cost:item.cost,unit:item.unit,saleMode:'COUNTED',quantityStep:'1',packSize:item.packSize,packUnit:item.packUnit,packPrice:item.price*item.packSize,stock:0,minStock:10,reorderPoint:10,maxStock:60,defaultSupplierId:supplier.id,requiresBatchTracking:item.tracked,ivaExento:item.exempt??false}});
    items.push({...item,id:product.id});
    await registerPurchase({principal,idempotencyKey:`${marker}:${slug}:stock:${index}`,input:{supplierId:supplier.id,warehouseId:warehouse.id,invoiceNumber:`QA-INICIAL-${slug}-${index}`,date:shiftCivilDay(today,-35),postingDate:shiftCivilDay(today,-35),dueDate:shiftCivilDay(today,30),paymentMethod:'CREDIT',notes:'Datos sintéticos de QA. Compra inicial para demostración.',items:[{productId:product.id,quantity:String(item.quantity),unitCost:String(item.cost),purchaseUnit:'BASE',...(item.tracked?{batchNumber:`QA-${slug}-${index}`,expiryDate:shiftCivilDay(today,item.expired?-1:180)}:{})}]}},prisma);
  }
  // Históricos sintéticos, con IVA/COGS congelados y movimientos físicos/auditoría atómicos.
  const item=items[0],batch=item.tracked?await prisma.productBatch.findFirstOrThrow({where:{tenantId,productId:item.id}}):null;
  for(const [offset,quantity]of [[-14,15],[-7,20],[0,10]] as const) {
    const at=new Date(`${shiftCivilDay(today,offset)}T06:01:00Z`),saleId=`${tenantId}-sale-${Math.abs(offset)}`;
    await prisma.$transaction(async tx=>{
      const total=new Decimal(item.price).mul(quantity),vat=item.exempt?new Decimal(0):total.minus(total.div('1.15'));
      await tx.sale.create({data:{id:saleId,tenantId,total:total.toFixed(4),vatAmountAtSale:vat.toFixed(4),exemptTotal:item.exempt?total.toFixed(4):'0',status:'COMPLETED',paymentMethod:'CASH',soldById:user.id,createdAt:at,items:{create:{productId:item.id,quantity,priceAtSale:String(item.price),unitPriceExactAtSale:String(item.price),costAtSale:String(item.cost),productNameAtSale:item.name,unitAtSale:item.unit,saleModeAtSale:'COUNTED',quantityStepAtSale:'1',presentationAtSale:'BASE',presentationQuantityAtSale:String(quantity),ivaExento:item.exempt??false}}}});
      const movement=await applyStockDelta(tx,{tenantId,productId:item.id,warehouseId:warehouse.id,delta:-quantity,enforceSufficient:true});
      if(batch) {
        await tx.productBatch.update({where:{id:batch.id},data:{stock:{decrement:quantity}}});
        await applyBatchWarehouseDelta({tx,tenantId,productId:item.id,batchId:batch.id,warehouseId:warehouse.id,userId:user.id,delta:String(-quantity),movementType:'SALE',referenceType:'SALE',referenceId:saleId,sourceKey:`qa-demo:sale:${saleId}`,reason:'Venta histórica sintética de QA'});
      }
      await tx.kardexMovement.create({data:{tenantId,productId:item.id,warehouseId:warehouse.id,batchId:batch?.id,userId:user.id,type:'SALE',quantity:-quantity,stockBefore:movement.stockBefore,stockAfter:movement.stockAfter,referenceId:saleId,referenceType:'SALE',date:at,reason:'Histórico sintético QA'}});
      await tx.auditLog.create({data:{tenantId,userId:user.id,action:'QA_DEMO_SALE_SEEDED',details:`Venta sintética ${saleId}`,createdAt:at}});
    });
  }
  const expired=await prisma.productBatch.findFirstOrThrow({where:{tenantId,productId:items[2].id}});
  const purchaseLine=await prisma.purchaseItem.findFirstOrThrow({where:{productId:items[1].id,purchase:{tenantId}},select:{id:true}});
  const drafts:Array<[AssistantActionKind,object]>=[
    ['PURCHASE_ORDER_DRAFT',{supplierId:supplier.id,items:[{productId:items[0].id,quantity:'40',unitCost:String(items[0].cost)}],notes:'Reposición sintética para revisar, sin enviar al proveedor.'}],
    ['BATCH_WRITEOFF',{batchId:expired.id,warehouseId:warehouse.id,quantity:'2',reason:'Lote vencido sintético para revisar.',physicalRemovalConfirmed:false}],
    ['SUPPLIER_RETURN',{supplierId:supplier.id,reasonCode:'DAMAGE',reason:'Mercadería sintética para revisar.',physicalShipmentConfirmed:false,lines:[{sourceType:'DIRECT_PURCHASE_ITEM',purchaseItemId:purchaseLine.id,quantity:'1'}]}],
    ['PROMOTION',{name:'Promoción de revisión QA',percent:'5',productIds:[items[0].id],startsAt:new Date(now.getTime()-60000).toISOString(),endsAt:expires.toISOString()}],
  ];
  const proposals=[];
  for(const [kind,draft]of drafts) {
    const prepared=await prepareAssistantAction(principal,kind,draft,`${marker}:${slug}:${kind}`,prisma);
    proposals.push(await previewAssistantAction(principal,prepared.id,prepared.version,prisma));
  }
  const promo=await prepareAssistantAction(principal,'PROMOTION',{name:'Promo activa sintética QA',percent:'10',productIds:[items[1].id],startsAt:new Date(now.getTime()-60000).toISOString(),endsAt:expires.toISOString()},`${marker}:${slug}:published`,prisma);
  const ready=await previewAssistantAction(principal,promo.id,promo.version,prisma);
  if(ready.status!=='READY')throw new Error('La promoción sintética requiere revisión de fixture.');
  await confirmAssistantAction(principal,ready.id,ready.version,`${marker}:${slug}:publish`,prisma);
  const conversation=await createAssistantConversation(principal,prisma),requestId=randomUUID();
  const label='Datos sintéticos de QA, sin modelo. Revisión de cuatro acciones preparadas por servicios; ninguna compra, baja o devolución se confirma desde el chat.';
  const run=await createAssistantRun(principal,conversation.id,{requestId,text:label},{db:prisma});
  const evidence=[];
  for(const [tool,read]of [['audit_business_health',()=>auditBusinessHealth(principal,{}, {db:prisma})],['check_inventory_burn_rate',()=>checkInventoryBurnRate(principal,{}, {db:prisma})],['inspect_batch_expiry',()=>inspectBatchExpiry(principal,{}, {db:prisma})]] as const)evidence.push({id:`e${evidence.length+1}`,tool,label:tool,data:await read()});
  await prisma.$transaction(async tx=>{
    await tx.assistantRun.update({where:{id:run.id},data:{status:'SUCCEEDED',version:1,iterations:0,result:json({text:label,evidence,actionProposalIds:proposals.map(proposal=>proposal.id),degraded:true})}});
    await tx.assistantMessage.create({data:{tenantId,userId:user.id,conversationId:conversation.id,requestId,role:'user',content:{text:'Abrir la demostración sintética de QA; no se usó un modelo.'}}});
    await tx.assistantMessage.create({data:{tenantId,userId:user.id,conversationId:conversation.id,requestId,role:'assistant',content:{text:label,operationalRunId:run.id},createdAt:new Date(Date.now()+1)}});
  });
  return{businessName:tenant.businessName,email,tenantId,conversationId:conversation.id};
}

async function main() {
  const url=new URL(process.env.DATABASE_URL??'invalid:');
  if(url.protocol!=='mysql:'||url.hostname!=='127.0.0.1'||url.pathname!=='/nortex_quality_operativo'||process.env.NORTEX_QA_DATABASE_ACK!=='disposable-database')throw new Error('Demo permitida sólo en MySQL descartable identificado.');
  for(const flag of flags)process.env[flag]='true';
  process.env.NORTEX_ASSISTANT_LANGUAGE_ENABLED='false';process.env.WHATSAPP_ENABLED='false';process.env.NORTEX_PRIVATE_WA_SENDING_ENABLED='false';
  const businesses=[];for(const vertical of ['FERRETERIA','FARMACIA'] as const)businesses.push(await seedVertical(vertical));
  await writeFile('reports/assistant-operations-demo.json',JSON.stringify({fixture:marker,modelUsed:false,createdAt:new Date().toISOString(),businesses},null,2));
  console.log(JSON.stringify({fixture:marker,businesses:businesses.map(({businessName,conversationId})=>({businessName,conversationId}))}));
}
main().catch(()=>{console.error('No se completó la fixture local; revisar el caso con datos de QA.');process.exitCode=1;}).finally(()=>prisma.$disconnect());
