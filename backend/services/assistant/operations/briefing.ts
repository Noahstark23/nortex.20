import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantDailyBriefDTO, AssistantJson } from '../../../../shared/assistantOperations.js';
import { assertAssistantAccess, getAssistantCapabilities, ASSISTANT_BUSINESS_SALES_ROLES, ASSISTANT_OWN_SALES_ROLES } from '../access.js';
import type { BusinessHealthResult, InventoryBurnRateResult, BatchExpiryResult } from './analyticsTypes.js';
import { managuaDay } from './analyticsPeriod.js';
import { AssistantRunError } from './contracts.js';

type BriefItem=AssistantDailyBriefDTO['items'][number];
interface BriefSources { health?:BusinessHealthResult; inventory?:InventoryBurnRateResult; expiry?:BatchExpiryResult }
export interface BriefDependencies { db?:PrismaClient; now?:()=>Date; health?:()=>Promise<BusinessHealthResult>; inventory?:()=>Promise<InventoryBurnRateResult>; expiry?:()=>Promise<BatchExpiryResult> }
const json=(value:unknown):AssistantJson=>JSON.parse(JSON.stringify(value));
const itemsSchema=z.array(z.object({id:z.string(),title:z.string(),text:z.string(),area:z.enum(['business','inventory','expiry']),evidence:z.json()}).strict().transform(value=>({...value,evidence:value.evidence??null}))).max(3);
const dismissedSchema=z.array(z.string()).max(3);
const canHealth=(principal:AssistantPrincipal)=>[...ASSISTANT_BUSINESS_SALES_ROLES,...ASSISTANT_OWN_SALES_ROLES].includes(principal.role);
function numeric(value:string|null,compare:(number:Decimal)=>boolean):boolean {try{return value!==null&&compare(new Decimal(value));}catch{return false;}}

export function buildDailyBriefItems(principal:AssistantPrincipal,day:string,sources:BriefSources):BriefItem[] {
  const items:Array<BriefItem&{priority:number}>=[];
  const id=(area:string,resource:string)=>createHash('sha256').update(`${principal.tenantId}:${principal.userId}:${principal.role}:${day}:${area}:${resource}`).digest('hex').slice(0,32);
  for(const row of sources.expiry?.rows??[]) {
    if(row.status!=='ok'||!numeric(row.physicalStock,value=>value.gt(0)))continue;
    items.push({id:id('expiry',row.batchId),title:row.state==='EXPIRED'?'Lote vencido con existencias':'Lote próximo a vencer',text:`${row.name}, lote ${row.batchNumber}: vencimiento ${row.expiryDate}. Revisá las ${row.physicalStock} ${row.unit} físicas antes de decidir una salida.`,area:'expiry',priority:row.state==='EXPIRED'?100:80,evidence:json({checkedAt:sources.expiry!.checkedAt,period:sources.expiry!.period,row,scope:'Hasta 10 lotes con existencias, priorizados por fecha de vencimiento.'})});
  }
  for(const row of sources.inventory?.rows??[]) {
    if(row.status==='unavailable'||!numeric(row.suggestedQuantity,value=>value.gt(0)))continue;
    if(row.suggestionBasis==='CONFIGURED_MINIMUM'&&numeric(row.configuredMinimum,value=>value.gt(0))) {
      items.push({id:id('inventory',row.productId),title:'Existencias bajo el mínimo',text:`${row.name}: disponibles ${row.sellableStock} ${row.unit}, mínimo configurado ${row.configuredMinimum}. Revisá las ${row.pendingOrderQuantity} pendientes en OC. La sugerencia usa el mínimo; no estima una fecha de agotamiento.`,area:'inventory',priority:70,evidence:json({checkedAt:sources.inventory!.checkedAt,period:sources.inventory!.period,row,scope:'Hasta 10 productos priorizados por existencias y mínimos configurados.'})});
      continue;
    }
    if(row.status!=='ok'||!numeric(row.estimatedDaysRemaining,value=>value.lte(7)))continue;
    items.push({id:id('inventory',row.productId),title:'Revisar reposición',text:`${row.name}: cobertura estimada ${row.estimatedDaysRemaining} días según las salidas verificadas. Es una estimación; revisá existencias y órdenes pendientes.`,area:'inventory',priority:70,evidence:json({checkedAt:sources.inventory!.checkedAt,period:sources.inventory!.period,row,scope:'Hasta 10 productos priorizados por stock agotado, punto de reposición y cobertura física.'})});
  }
  if(canHealth(principal)&&sources.health) {
    const changed=sources.health.comparison.changes.find(metric=>metric.key==='netSalesTotalChange'&&metric.status==='ok'&&numeric(metric.value,value=>value.lt(0)));
    if(changed)items.push({id:id('business',changed.key),title:'Revisar variación de ventas',text:`${changed.label}: ${changed.value}%. Compará los períodos y el mismo corte; la variación no demuestra su causa.`,area:'business',priority:60,evidence:json({checkedAt:sources.health.checkedAt,period:sources.health.period,comparison:sources.health.comparison,metric:changed})});
  }
  return items.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)).slice(0,3).map(({priority:_,...item})=>item);
}

export async function getDailyBrief(principal:AssistantPrincipal,deps:BriefDependencies={}):Promise<AssistantDailyBriefDTO> {
  const db=deps.db??prisma,now=deps.now?.()??new Date(),localDay=managuaDay(now),where={tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,localDay,expiresAt:{gt:now}};
  await assertAssistantAccess(principal,'dailyBrief',db);
  const existing=await db.assistantDailyBrief.findFirst({where});
  if(existing){await assertAssistantAccess(principal,'dailyBrief',db);return{id:existing.id,localDay,items:itemsSchema.parse(existing.items),dismissedIds:dismissedSchema.parse(existing.dismissedIds)};}
  const capabilities=await getAssistantCapabilities(principal,db);
  const [health,inventory,expiry]=await Promise.allSettled([
    canHealth(principal)?(deps.health?.()??(await import('./analytics.js')).auditBusinessHealth(principal,{}, {db,now:()=>now})):Promise.resolve(undefined),
    capabilities.inventory?(deps.inventory?.()??(await import('./inventory.js')).checkInventoryBurnRate(principal,{limit:10},{db,now:()=>now})):Promise.resolve(undefined),
    capabilities.inventory?(deps.expiry?.()??(await import('./inventory.js')).inspectBatchExpiry(principal,{limit:10},{db,now:()=>now})):Promise.resolve(undefined),
  ]);
  const items=buildDailyBriefItems(principal,localDay,{health:health.status==='fulfilled'?health.value:undefined,inventory:inventory.status==='fulfilled'?inventory.value:undefined,expiry:expiry.status==='fulfilled'?expiry.value:undefined});
  const limited=[inventory,expiry].some(source=>source.status==='fulfilled'&&source.value&&source.value.rows.length>=10);
  if(limited)for(const item of items)item.text+=' Resumen parcial: revisé hasta 10 productos y 10 lotes priorizados.';
  if(limited&&!items.length)items.push({id:createHash('sha256').update(`${localDay}:${principal.userId}:limited`).digest('hex').slice(0,32),title:'Revisión de alcance limitado',text:'Revisé hasta 10 productos y 10 lotes priorizados. Estos datos no acreditan que el resto del catálogo no tenga pendientes.',area:'inventory',evidence:{checkedAt:now.toISOString(),scope:'limited'}});
  if(!items.length&&[health,inventory,expiry].some(result=>result.status==='rejected'||(result.value&&result.value.status!=='ok')))items.push({id:createHash('sha256').update(`${localDay}:${principal.userId}:unavailable`).digest('hex').slice(0,32),title:'Revisión incompleta',text:'No pude verificar todas las fuentes del resumen. La falta de datos no significa que no haya pendientes.',area:'business',evidence:{checkedAt:now.toISOString(),status:'unavailable'}});
  const row=await db.$transaction(async tx=>{
    // El lock del usuario serializa creación/cambio de rol para este resumen privado.
    const lock=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM User WHERE id=${principal.userId} AND tenantId=${principal.tenantId} AND role=${principal.role} AND status='ACTIVE' FOR UPDATE`);
    if(!lock.length)throw new AssistantRunError(403,'SESSION_REVOKED','Tu sesión cambió. Volvé a ingresar.');
    // La lectura consistente empieza después del lock, también bajo MySQL REPEATABLE READ.
    await assertAssistantAccess(principal,'dailyBrief',tx as PrismaClient);
    const previous=await tx.assistantDailyBrief.findFirst({where});
    if(previous)return previous;
    return tx.assistantDailyBrief.upsert({where:{tenantId_userId_localDay:{tenantId:principal.tenantId,userId:principal.userId,localDay}},create:{tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,localDay,items:json(items),dismissedIds:[],expiresAt:new Date(now.getTime()+2*86400_000)},update:{roleAtCreation:principal.role,items:json(items),dismissedIds:[],expiresAt:new Date(now.getTime()+2*86400_000)}});
  });
  await assertAssistantAccess(principal,'dailyBrief',db);return{id:row.id,localDay,items:itemsSchema.parse(row.items),dismissedIds:dismissedSchema.parse(row.dismissedIds)};
}

export async function dismissDailyBriefItem(principal:AssistantPrincipal,id:string,itemId:string,deps:BriefDependencies={}):Promise<AssistantDailyBriefDTO> {
  const db=deps.db??prisma,now=deps.now?.()??new Date();await assertAssistantAccess(principal,'dailyBrief',db);
  const where={id,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,localDay:managuaDay(now),expiresAt:{gt:now}};
  const row=await db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM AssistantDailyBrief WHERE id=${id} AND tenantId=${principal.tenantId} AND userId=${principal.userId} AND roleAtCreation=${principal.role} FOR UPDATE`);
    await assertAssistantAccess(principal,'dailyBrief',tx as PrismaClient);
    const previous=await tx.assistantDailyBrief.findFirst({where});
    if(!previous)throw new AssistantRunError(404,'BRIEF_NOT_FOUND','Este resumen ya no está disponible.');
    const items=itemsSchema.parse(previous.items);if(!items.some(item=>item.id===itemId))throw new AssistantRunError(404,'BRIEF_ITEM_NOT_FOUND','No encontramos ese aviso en tu resumen.');
    const dismissedIds=[...new Set([...dismissedSchema.parse(previous.dismissedIds),itemId])];
    await tx.assistantDailyBrief.updateMany({where,data:{dismissedIds}});return {...previous,dismissedIds};
  });
  await assertAssistantAccess(principal,'dailyBrief',db);return{id:row.id,localDay:row.localDay,items:itemsSchema.parse(row.items),dismissedIds:dismissedSchema.parse(row.dismissedIds)};
}
