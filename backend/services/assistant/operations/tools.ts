import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { assertAssistantAccess,getAssistantCapabilities,ASSISTANT_BUSINESS_SALES_ROLES,ASSISTANT_OWN_SALES_ROLES } from '../access.js';
import { getAssistantOverview,assistantPeriodSchema } from '../overview.js';
import { retrieveAssistantHelp } from '../knowledge.js';
import { auditBusinessHealth,auditBusinessHealthQuerySchema } from './analytics.js';
import { checkInventoryBurnRate,checkInventoryBurnRateQuerySchema,inspectBatchExpiry,inspectBatchExpiryQuerySchema } from './inventory.js';
import { getDailyBrief } from './briefing.js';
import type { JsonValue,OperationTool,ToolContext } from './contracts.js';
import { AssistantRunError } from './contracts.js';
import { actionOrderDraftSchema,actionWriteoffDraftSchema,actionSupplierReturnDraftSchema,purchaseOrderAdapter,batchWriteoffAdapter,supplierReturnAdapter } from '../actions/adapters.js';
import { promotionDraftSchema } from '../../promotions/management.js';
import { prepareAssistantAction } from '../actions/service.js';
import type { AssistantActionKind } from '../../../../shared/assistantOperations.js';

interface ToolDependencies {db?:PrismaClient;now?:()=>Date;extraTools?:OperationTool[]}
const asJson=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value));
export async function createOperationTools(principal:AssistantPrincipal,deps:ToolDependencies={}):Promise<OperationTool[]> {
  const db=deps.db??prisma,caps=await getAssistantCapabilities(principal,db);
  await assertAssistantAccess(principal,'operations',db);
  const authorize=async(ctx:ToolContext)=>{if(ctx.principal.tenantId!==principal.tenantId||ctx.principal.userId!==principal.userId||ctx.principal.role!==principal.role)throw new AssistantRunError(403,'TOOL_PRINCIPAL_CHANGED','La identidad de la consulta cambió.');await ctx.assertActive();await assertAssistantAccess(principal,'operations',db);};
  const registry:OperationTool[]=[{name:'search_help',label:'Ayuda revisada',description:'Recuperar ayuda aprobada de Nortex con referencias; no consultar datos operativos aquí.',kind:'READ',schema:z.object({query:z.string().trim().min(1).max(500)}).strict(),async execute(ctx,args){await authorize(ctx);const {query}=z.object({query:z.string()}).parse(args);return{data:asJson(retrieveAssistantHelp(query,principal.role))};}}];
  if(caps.overview)registry.push({name:'get_business_overview',label:'Datos del negocio',description:'Consultar cifras autorizadas de ventas, gastos, saldos y existencias. Los saldos son actuales, no históricos.',kind:'READ',schema:assistantPeriodSchema,async execute(ctx,args){await authorize(ctx);return{data:asJson(await getAssistantOverview(principal,args,db))};}});
  if([...ASSISTANT_BUSINESS_SALES_ROLES,...ASSISTANT_OWN_SALES_ROLES].includes(principal.role))registry.push({name:'audit_business_health',label:'Comparación del negocio',description:'Comparar ventas y métricas autorizadas con un período equivalente y el mismo corte; no atribuir causas automáticamente.',kind:'READ',schema:auditBusinessHealthQuerySchema,async execute(ctx,args){await authorize(ctx);return{data:asJson(await auditBusinessHealth(principal,args,{db,now:deps.now}))};}});
  if(caps.inventory){
    registry.push({name:'check_inventory_burn_rate',label:'Cobertura de inventario',description:'Calcular cobertura estimada, existencias vendibles, órdenes pendientes y propuesta de reposición usando días completos.',kind:'READ',schema:checkInventoryBurnRateQuerySchema,async execute(ctx,args){await authorize(ctx);return{data:asJson(await checkInventoryBurnRate(principal,args,{db,now:deps.now}))};}});
    registry.push({name:'inspect_batch_expiry',label:'Lotes y vencimientos',description:'Revisar lotes vencidos o próximos a vencer; mostrar evidencia y acciones admisibles sin realizar una salida.',kind:'READ',schema:inspectBatchExpiryQuerySchema,async execute(ctx,args){await authorize(ctx);return{data:asJson(await inspectBatchExpiry(principal,args,{db,now:deps.now}))};}});
  }
  if(caps.dailyBrief)registry.push({name:'read_daily_brief',label:'Resumen del día',description:'Leer avisos del resumen privado del usuario. Un itemId permite explicar su evidencia; siempre reconsultar datos actuales antes de preparar una acción.',kind:'READ',schema:z.object({itemId:z.string().min(1).max(64).optional()}).strict(),async execute(ctx,args){await authorize(ctx);const {itemId}=z.object({itemId:z.string().optional()}).parse(args);const brief=await getDailyBrief(principal,{db,now:deps.now});if(itemId&&!brief.items.some(item=>item.id===itemId))throw new AssistantRunError(404,'BRIEF_ITEM_NOT_FOUND','El aviso ya no está disponible.');return{data:asJson({...brief,items:brief.items.filter(item=>itemId?item.id===itemId:!brief.dismissedIds.includes(item.id))})};}});
  if(caps.inventory||caps.purchasePrepare)registry.push({name:'search_catalog',label:'Catálogo del negocio',description:'Resolver productos o proveedores existentes mediante búsqueda del catálogo privado. Nunca crear identidades ni adivinar equivalencias de unidad.',kind:'READ',schema:z.object({kind:z.enum(['products','suppliers']),query:z.string().trim().min(1).max(100),limit:z.number().int().min(1).max(20).optional()}).strict(),async execute(ctx,args){await authorize(ctx);return{data:asJson(await(await import('./catalogSearch.js')).searchAssistantCatalog(principal,args,{db}))};}});
  const prepareTool=(kind:AssistantActionKind,name:string,label:string,schema:z.ZodType):OperationTool=>({name,label,description:`Preparar un borrador de ${label.toLowerCase()} con datos ya resueltos. No confirma, no modifica existencias, caja o deuda. No suponer hechos físicos.`,kind:'PREPARE',schema,async execute(ctx,args){
    await authorize(ctx);await assertAssistantAccess(principal,'actionPrepare',db);
    const key=createHash('sha256').update(`tool:${ctx.runId}:${ctx.toolCallId}`).digest('hex');
    const proposal=await prepareAssistantAction(principal,kind,args,key,db,{runId:ctx.runId});
    return {data:asJson({id:proposal.id,kind:proposal.kind,status:proposal.status,version:proposal.version,issues:proposal.issues,expiresAt:proposal.expiresAt,message:'Borrador preparado. Requiere revisión humana para decidir sus efectos.'}),actionProposalIds:[proposal.id]};
  }});
  if(caps.actionPrepare) {
    if(purchaseOrderAdapter.roles.includes(principal.role))registry.push(prepareTool('PURCHASE_ORDER_DRAFT','prepare_purchase_order','Orden de compra',actionOrderDraftSchema));
    if(batchWriteoffAdapter.roles.includes(principal.role))registry.push(prepareTool('BATCH_WRITEOFF','prepare_batch_writeoff','Baja de lote',actionWriteoffDraftSchema.omit({physicalRemovalConfirmed:true})));
    if(supplierReturnAdapter.roles.includes(principal.role))registry.push(prepareTool('SUPPLIER_RETURN','prepare_supplier_return','Devolución al proveedor',actionSupplierReturnDraftSchema.omit({physicalShipmentConfirmed:true})));
    if(caps.promotionManage)registry.push(prepareTool('PROMOTION','prepare_promotion','Promoción',promotionDraftSchema));
  }
  // Las extensiones deben ser registros tipados del servidor, jamás nombres o endpoints enviados por el modelo.
  return [...registry,...(deps.extraTools??[])].map(tool=>({...tool,async execute(ctx,input){
    const parsed=tool.schema.parse(input);await authorize(ctx);const result=await tool.execute(ctx,parsed);await authorize(ctx);return result;
  }}));
}
