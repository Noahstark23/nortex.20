import { Prisma, type PrismaClient } from '@prisma/client';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { AssistantAccessError } from '../access.js';
import { getSupplierReturnEligibleLines } from '../../supplierReturnService.js';
import type { CatalogOption, CatalogOptions, CatalogOptionsQuery } from './catalogOptions.js';

const escapeLike=(value:string)=>value.replace(/[=%_]/g,character=>`=${character}`);
export async function supplierReturnSuppliers(principal:AssistantPrincipal, query:CatalogOptionsQuery, db:PrismaClient):Promise<CatalogOptions> {
  const rows=await db.$queryRaw<Array<{id:string;name:string}>>(Prisma.sql`
    SELECT s.id,s.name FROM Supplier s WHERE s.tenantId=${principal.tenantId}
    AND s.name LIKE ${`%${escapeLike(query.query)}%`} ESCAPE '=' AND (
      EXISTS (SELECT 1 FROM Purchase p JOIN PurchaseItem i ON i.purchaseId=p.id
        WHERE p.tenantId=s.tenantId AND p.supplierId=s.id AND p.documentStatus='POSTED' AND i.productId=${query.productId})
      OR EXISTS (SELECT 1 FROM PurchaseOrder o JOIN GoodsReceipt g ON g.purchaseOrderId=o.id AND g.tenantId=o.tenantId
        JOIN GoodsReceiptItem i ON i.goodsReceiptId=g.id AND i.tenantId=g.tenantId
        WHERE o.tenantId=s.tenantId AND o.supplierId=s.id AND g.status='POSTED' AND i.productId=${query.productId})
    ) ORDER BY s.name,s.id LIMIT ${query.limit}`);
  return {items:rows.map(row=>({id:row.id,label:row.name})),warnings:[]};
}

/** Son referencias para la revisión del dominio, nunca una autorización de salida. */
export async function supplierReturnSources(principal:AssistantPrincipal, query:CatalogOptionsQuery, db:PrismaClient):Promise<CatalogOptions> {
  const supplierId=query.supplierId!, items:CatalogOption[]=[], warnings:string[]=[];
  const pattern=`%${escapeLike(query.query)}%`;
  if (query.purchaseOrderId && !await db.purchaseOrder.findFirst({where:{id:query.purchaseOrderId,tenantId:principal.tenantId,supplierId},select:{id:true}})) {
    throw new AssistantAccessError(404,'PURCHASE_ORDER_NOT_FOUND','Orden no encontrada para este proveedor.');
  }
  if (!query.purchaseOrderId) {
    const direct=await db.$queryRaw<Array<{id:string;productId:string;productName:string;invoiceNumber:string;inventoryWarehouseId:string|null}>>(Prisma.sql`
      SELECT i.id,i.productId,i.productName,p.invoiceNumber,i.inventoryWarehouseId
      FROM Purchase p JOIN PurchaseItem i ON i.purchaseId=p.id
      JOIN Product product ON product.id=i.productId AND product.tenantId=p.tenantId
      WHERE p.tenantId=${principal.tenantId} AND p.supplierId=${supplierId} AND p.documentStatus='POSTED'
        AND p.purchaseOrderId IS NULL AND i.purchaseOrderItemId IS NULL
        ${query.productId?Prisma.sql`AND i.productId=${query.productId}`:Prisma.empty}
        AND (i.productName LIKE ${pattern} ESCAPE '=' OR p.invoiceNumber LIKE ${pattern} ESCAPE '=')
      ORDER BY p.date DESC,i.id ASC LIMIT ${query.limit+1}`);
    for (const row of direct.slice(0,query.limit)) items.push({id:row.id,label:row.productName,detail:`Factura ${row.invoiceNumber} · requiere revisión física`,sourceType:'DIRECT_PURCHASE_ITEM',productId:row.productId,
      ...(row.inventoryWarehouseId?{warehouseId:row.inventoryWarehouseId}:{}),availableQuantity:null,reviewRequired:true});
    if (direct.length>query.limit) warnings.push('Hay más compras directas. Refiná la búsqueda por factura o producto.');
  }
  // Sólo órdenes con recepción del producto; el límite se aplica después del filtro en MySQL.
  const orders=await db.$queryRaw<Array<{id:string;orderNumber:string}>>(Prisma.sql`
    SELECT o.id,o.orderNumber FROM PurchaseOrder o WHERE o.tenantId=${principal.tenantId} AND o.supplierId=${supplierId}
      ${query.purchaseOrderId?Prisma.sql`AND o.id=${query.purchaseOrderId}`:Prisma.empty}
      AND EXISTS (SELECT 1 FROM GoodsReceipt g JOIN GoodsReceiptItem i ON i.goodsReceiptId=g.id AND i.tenantId=g.tenantId
        JOIN Product p ON p.id=i.productId AND p.tenantId=i.tenantId
        WHERE g.tenantId=o.tenantId AND g.purchaseOrderId=o.id AND g.status='POSTED'
          ${query.productId?Prisma.sql`AND i.productId=${query.productId}`:Prisma.empty}
          AND (o.orderNumber LIKE ${pattern} ESCAPE '=' OR p.name LIKE ${pattern} ESCAPE '='))
    ORDER BY o.createdAt DESC,o.id ASC LIMIT 6`);
  if (orders.length>5) warnings.push('Hay más órdenes de origen. Refiná la búsqueda por número de orden.');
  for (const order of orders.slice(0,5)) {
    const context=await getSupplierReturnEligibleLines({db,tenantId:principal.tenantId,supplierId,purchaseOrderId:order.id,take:100});
    if (context.truncated) warnings.push(`La orden ${order.orderNumber} tiene más líneas; completá la selección en su expediente.`);
    for (const line of context.eligibleLines) {
      if (query.productId && line.product.id!==query.productId) continue;
      items.push({id:line.sourceId,label:line.product.name,detail:`${order.orderNumber} · ${line.warehouse.name} · ${line.blockCode?'requiere conciliación':'revisar cantidad'}`,
        sourceType:line.sourceType,productId:line.product.id,warehouseId:line.warehouse.id,purchaseOrderId:order.id,
        sourceRemainingQuantity:line.blockCode?null:line.quantity.availableExact,availableQuantity:null,blockCode:line.blockCode,reviewRequired:true});
    }
  }
  const truncated=items.length>query.limit || warnings.length>0;
  if (items.length>query.limit) warnings.push('Hay más fuentes. Refiná la búsqueda por producto o número de documento.');
  warnings.push('La disponibilidad se vuelve a verificar al revisar y confirmar. Una compra directa requiere conciliación física.');
  return {items:items.slice(0,query.limit),warnings:[...new Set(warnings)],truncated};
}
