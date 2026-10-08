import { Prisma } from '@prisma/client';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { OperationsQuery, ResolvedOperationsPeriod } from './analyticsPeriod.js';

export function inventoryBurnRateSql(principal: AssistantPrincipal, query: OperationsQuery, period: ResolvedOperationsPeriod, today: Date, financial: boolean) {
  const productFilter = query.productIds?.length ? Prisma.sql`AND p.id IN (${Prisma.join(query.productIds)})` : Prisma.empty;
  const cost = financial ? Prisma.sql`CAST(p.cost AS DECIMAL(18,4))` : Prisma.sql`NULL`;
  return Prisma.sql`
    WITH sold AS (
      SELECT i.productId, SUM(CAST(i.quantity AS DECIMAL(24,4))) AS quantity
      FROM Sale s JOIN SaleItem i ON i.saleId=s.id
      WHERE s.tenantId=${principal.tenantId} AND s.cancelledAt IS NULL AND s.status NOT IN ('VOIDED','CANCELLED','CANCELED')
      AND s.createdAt>=${period.start} AND s.createdAt<${period.endExclusive} GROUP BY i.productId
    ), returns_window AS (
      SELECT r.id,r.saleId,r.total FROM ProductReturn r JOIN Sale s ON s.id=r.saleId AND s.tenantId=r.tenantId
      WHERE r.tenantId=${principal.tenantId} AND s.cancelledAt IS NULL AND s.status NOT IN ('VOIDED','CANCELLED','CANCELED')
      AND r.createdAt>=${period.start} AND r.createdAt<${period.endExclusive}
    ), returned AS (
      SELECT ri.productId,SUM(ri.quantity) AS quantity,
        SUM(CASE WHEN ri.disposition='RESTOCK' THEN ri.quantity ELSE 0 END) AS restockedQuantity,
        SUM(CASE WHEN ri.disposition='QUARANTINE' THEN ri.quantity ELSE 0 END) AS quarantinedQuantity,
        SUM(CASE WHEN ri.disposition='LOSS' THEN ri.quantity ELSE 0 END) AS lostQuantity
      FROM ProductReturnItem ri
      JOIN returns_window r ON r.id=ri.productReturnId
      JOIN SaleItem i ON i.id=ri.saleItemId AND i.saleId=r.saleId AND i.productId=ri.productId
      WHERE ri.tenantId=${principal.tenantId} GROUP BY ri.productId
    ), ambiguous_returns AS (
      SELECT COUNT(*) AS unknownRows FROM returns_window r WHERE
        ABS(r.total-COALESCE((SELECT SUM(ri.lineTotal) FROM ProductReturnItem ri WHERE ri.productReturnId=r.id AND ri.tenantId=${principal.tenantId}),-1))>0.0001
        OR EXISTS (SELECT 1 FROM ProductReturnItem ri LEFT JOIN SaleItem i ON i.id=ri.saleItemId AND i.saleId=r.saleId
          WHERE ri.productReturnId=r.id AND ri.tenantId=${principal.tenantId}
          AND (i.id IS NULL OR i.productId<>ri.productId OR ri.quantity<=0 OR ri.quantity>i.quantity OR ri.lineTotal<0
            OR ri.disposition IS NULL OR ri.disposition NOT IN ('RESTOCK','QUARANTINE','LOSS')))
    ), pending AS (
      SELECT i.productId,SUM(GREATEST(COALESCE(i.quantityOrderedExact,CAST(i.quantityOrdered AS DECIMAL(24,4)))
        -COALESCE(i.quantityReceivedExact,CAST(i.quantityReceived AS DECIMAL(24,4)))-COALESCE(i.quantityClosedShortExact,0),0)) AS quantity
      FROM PurchaseOrder o JOIN PurchaseOrderItem i ON i.purchaseOrderId=o.id
      WHERE o.tenantId=${principal.tenantId} AND o.status IN ('APPROVED','PARTIALLY_RECEIVED') GROUP BY i.productId
    ), batches AS (
      SELECT productId,COUNT(*) AS batchCount,SUM(CAST(stock AS DECIMAL(24,4))) AS allStock,
        SUM(CASE WHEN expiryDate>=${today} THEN GREATEST(CAST(stock AS DECIMAL(24,4)),0) ELSE 0 END) AS activeStock,
        SUM(stock<0) AS negativeRows FROM ProductBatch WHERE tenantId=${principal.tenantId} GROUP BY productId
    ), warehouses AS (
      SELECT productId,SUM(CAST(stock AS DECIMAL(24,4))) AS allStock,
        SUM(CASE WHEN warehouseId=${query.warehouseId ?? ''} THEN CAST(stock AS DECIMAL(24,4)) ELSE 0 END) AS targetStock,
        SUM(CASE WHEN warehouseId=${query.warehouseId ?? ''} THEN 1 ELSE 0 END) AS targetRows,
        SUM(stock<0) AS negativeRows FROM ProductStock WHERE tenantId=${principal.tenantId} GROUP BY productId
    )
    SELECT p.id AS productId,p.name,p.unit,p.quantityStep,p.saleMode,p.defaultSupplierId AS supplierId,
      CAST(p.stock AS DECIMAL(24,4)) AS physicalStock,CAST(p.reorderPoint AS DECIMAL(24,4)) AS reorderPoint,
      CAST(p.maxStock AS DECIMAL(24,4)) AS maxStock,p.requiresBatchTracking,${cost} AS cost,
      GREATEST(TIMESTAMPDIFF(DAY,GREATEST(p.createdAt,${period.start}),${period.endExclusive}),0) AS historyAvailableDays,
      COALESCE(s.quantity,0) AS soldQuantity,COALESCE(r.quantity,0) AS returnedQuantity,
      COALESCE(r.restockedQuantity,0) AS restockedQuantity,COALESCE(r.quarantinedQuantity,0) AS quarantinedQuantity,
      COALESCE(r.lostQuantity,0) AS lostQuantity,
      COALESCE(o.quantity,0) AS pendingQuantity,a.unknownRows,
      b.batchCount,b.allStock AS batchStock,b.activeStock,b.negativeRows AS negativeBatches,
      w.allStock AS warehouseStock,w.targetStock,w.targetRows,w.negativeRows AS negativeWarehouses
    FROM Product p LEFT JOIN sold s ON s.productId=p.id LEFT JOIN returned r ON r.productId=p.id
    LEFT JOIN pending o ON o.productId=p.id LEFT JOIN batches b ON b.productId=p.id
    LEFT JOIN warehouses w ON w.productId=p.id CROSS JOIN ambiguous_returns a
    WHERE p.tenantId=${principal.tenantId} ${productFilter}
    ORDER BY (p.stock<=0) DESC,(p.reorderPoint>0 AND p.stock<=p.reorderPoint) DESC,
      CASE WHEN COALESCE(s.quantity,0)>COALESCE(r.restockedQuantity,0) THEN p.stock/(s.quantity-COALESCE(r.restockedQuantity,0)) ELSE 999999999 END ASC,p.id ASC
    LIMIT ${query.limit}`;
}

export function batchExpirySql(principal: AssistantPrincipal, query: OperationsQuery, endExclusive: Date) {
  const products = query.productIds?.length ? Prisma.sql`AND p.id IN (${Prisma.join(query.productIds)})` : Prisma.empty;
  return Prisma.sql`
    SELECT b.id AS batchId,b.batchNumber,b.productId,p.name,p.unit,p.quantityStep,p.saleMode,p.defaultSupplierId AS supplierId,
      b.expiryDate,CAST(b.stock AS DECIMAL(24,4)) AS physicalStock,
      CAST(p.stock AS DECIMAL(24,4)) AS productStock,t.batchWarehouseLedgerMode,
      (SELECT COALESCE(SUM(CAST(x.stock AS DECIMAL(24,4))),0) FROM ProductBatch x WHERE x.tenantId=${principal.tenantId} AND x.productId=b.productId) AS allBatchStock,
      (SELECT COALESCE(SUM(x.stock<0),0) FROM ProductBatch x WHERE x.tenantId=${principal.tenantId} AND x.productId=b.productId) AS negativeBatches,
      (SELECT SUM(x.stock) FROM ProductBatchWarehouseStock x WHERE x.tenantId=${principal.tenantId} AND x.batchId=b.id) AS warehouseBatchStock,
      (SELECT SUM(x.stock) FROM ProductBatchWarehouseStock x WHERE x.tenantId=${principal.tenantId} AND x.productId=b.productId AND x.warehouseId=${query.warehouseId ?? ''}) AS productWarehouseBatchStock,
      (SELECT SUM(CAST(x.stock AS DECIMAL(24,4))) FROM ProductStock x WHERE x.tenantId=${principal.tenantId} AND x.productId=b.productId AND x.warehouseId=${query.warehouseId ?? ''}) AS productWarehouseStock,
      (SELECT SUM(x.stock) FROM ProductBatchWarehouseStock x WHERE x.tenantId=${principal.tenantId} AND x.batchId=b.id AND x.warehouseId=${query.warehouseId ?? ''}) AS targetBatchStock
    FROM ProductBatch b JOIN Product p ON p.id=b.productId AND p.tenantId=b.tenantId JOIN Tenant t ON t.id=b.tenantId
    WHERE b.tenantId=${principal.tenantId} AND b.stock>0 AND b.expiryDate<${endExclusive} ${products}
    ORDER BY b.expiryDate ASC,b.id ASC LIMIT ${query.limit}`;
}
