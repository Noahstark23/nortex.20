import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { PURCHASE_READ_ROLES, SUPPLIER_RETURN_READ_ROLES } from '../../../middleware/accessPolicies.js';
import { AssistantAccessError, getAssistantCapabilities } from '../access.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { searchAssistantCatalog } from './catalogSearch.js';
import { supplierReturnSources, supplierReturnSuppliers } from './catalogSources.js';

const id = z.string().trim().min(1).max(191);
export const assistantCatalogOptionsSchema = z.object({
  kind: z.enum(['products','suppliers','warehouses','purchaseOrders','batches','returnSuppliers','supplierReturnSources']),
  query: z.string().trim().max(100).default(''), limit: z.coerce.number().int().min(1).max(20).default(20),
  productId: id.optional(), supplierId: id.optional(), purchaseOrderId: id.optional(),
}).strict().superRefine((query, ctx) => {
  if (['batches','returnSuppliers'].includes(query.kind) && !query.productId) ctx.addIssue({code:'custom',path:['productId'],message:'Seleccioná el producto.'});
  if (query.kind === 'supplierReturnSources' && !query.supplierId) ctx.addIssue({code:'custom',path:['supplierId'],message:'Seleccioná el proveedor.'});
});
export type CatalogOptionsQuery = z.infer<typeof assistantCatalogOptionsSchema>;
export interface CatalogOption { id:string; label:string; detail?:string; productId?:string; warehouseId?:string; supplierId?:string; [key:string]:unknown }
export interface CatalogOptions { items:CatalogOption[]; warnings:string[]; truncated?:boolean }
export interface CatalogOptionsDependencies { db?:PrismaClient; now?:()=>Date }

async function authorize(principal:AssistantPrincipal, kind:CatalogOptionsQuery['kind'], db:PrismaClient) {
  const caps = await getAssistantCapabilities(principal,db);
  const allowed = kind === 'purchaseOrders' ? PURCHASE_READ_ROLES.includes(principal.role)
    : ['returnSuppliers','supplierReturnSources'].includes(kind) ? SUPPLIER_RETURN_READ_ROLES.includes(principal.role)
    : caps.inventory;
  if (!caps.enabled || !allowed) throw new AssistantAccessError(403,'ASSISTANT_FORBIDDEN','Tu rol no puede consultar estas opciones.');
}
export async function getAssistantCatalogOptions(principal:AssistantPrincipal, raw:unknown, deps:CatalogOptionsDependencies={}):Promise<CatalogOptions> {
  const query=assistantCatalogOptionsSchema.parse(raw), db=deps.db ?? prisma;
  if (query.kind === 'products' || query.kind === 'suppliers') {
    const result=await searchAssistantCatalog(principal,{kind:query.kind,query:query.query,limit:query.limit},deps);
    return {items:result.rows,warnings:result.warnings};
  }
  await authorize(principal,query.kind,db);
  if (query.productId && !await db.product.findFirst({where:{id:query.productId,tenantId:principal.tenantId},select:{id:true}})) {
    throw new AssistantAccessError(404,'PRODUCT_NOT_FOUND','Producto no encontrado.');
  }
  if (query.supplierId && !await db.supplier.findFirst({where:{id:query.supplierId,tenantId:principal.tenantId},select:{id:true}})) {
    throw new AssistantAccessError(404,'SUPPLIER_NOT_FOUND','Proveedor no encontrado.');
  }
  let result:CatalogOptions;
  if (query.kind === 'warehouses') {
    const rows=await db.warehouse.findMany({where:{tenantId:principal.tenantId,isActive:true,...(query.query?{name:{contains:query.query}}:{})},select:{id:true,name:true},orderBy:[{name:'asc'},{id:'asc'}],take:query.limit});
    result={items:rows.map(row=>({id:row.id,label:row.name})),warnings:[]};
  } else if (query.kind === 'batches') {
    const rows=await db.productBatch.findMany({where:{tenantId:principal.tenantId,productId:query.productId,stock:{gt:0},...(query.query?{batchNumber:{contains:query.query}}:{})},select:{id:true,batchNumber:true,expiryDate:true,productId:true},orderBy:[{expiryDate:'asc'},{id:'asc'}],take:query.limit});
    result={items:rows.map(row=>({id:row.id,label:row.batchNumber,productId:row.productId,detail:`Vence ${row.expiryDate.toISOString().slice(0,10)} · revisar bodega y cantidad`,reviewRequired:true})),warnings:['El lote es una referencia del catálogo. Revisá la bodega y la cantidad antes de calcular la baja.']};
  } else if (query.kind === 'purchaseOrders') {
    const rows=await db.purchaseOrder.findMany({where:{tenantId:principal.tenantId,status:{in:['RECEIVED','PARTIALLY_RECEIVED']},...(query.supplierId?{supplierId:query.supplierId}:{}),...(query.query?{orderNumber:{contains:query.query}}:{})},select:{id:true,orderNumber:true,supplierId:true,items:{take:200,select:{id:true,productId:true,productName:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:query.limit});
    result={items:rows.map(row=>({id:row.id,label:row.orderNumber,supplierId:row.supplierId,items:row.items.map(item=>({id:item.id,productId:item.productId,label:item.productName}))})),warnings:[]};
  } else if (query.kind === 'returnSuppliers') result=await supplierReturnSuppliers(principal,query,db);
  else result=await supplierReturnSources(principal,query,db);
  await authorize(principal,query.kind,db);
  return result;
}
