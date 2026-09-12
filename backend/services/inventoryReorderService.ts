import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';

type ReorderRow = {
  productId: string; name: string; sku: string; category: string | null;
  unit: string; saleMode: string | null; quantityStep: Prisma.Decimal | null;
  currentStock: Prisma.Decimal; reorderPoint: Prisma.Decimal; maxStock: Prisma.Decimal;
  cost: Prisma.Decimal; supplierId: string | null; supplierName: string | null;
  incomingQuantity: Prisma.Decimal; projectedStock: Prisma.Decimal;
  vpd: Prisma.Decimal; daysRemaining: Prisma.Decimal | null; reason: string;
  suggestedQty: Prisma.Decimal; suggestedCost: Prisma.Decimal;
};

/**
 * Posición de inventario = existencia física + saldo aprobado por recibir.
 * Se suma en MySQL, no trayendo cada movimiento/orden al proceso. Cerradas,
 * canceladas, borradores y recepciones completas no son abastecimiento futuro.
 */
export async function getInventoryReorder(tenantId: string, options: { page: number; pageSize: number }, db: PrismaClient = prisma) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cte = Prisma.sql`
    WITH sold AS (
      SELECT productId, SUM(ABS(CAST(quantity AS DECIMAL(30,4)))) AS soldQuantity
      FROM KardexMovement
      WHERE tenantId = ${tenantId} AND type = 'SALE' AND date >= ${since}
      GROUP BY productId
    ), arriving AS (
      SELECT i.productId,
        SUM(GREATEST(
          COALESCE(i.quantityOrderedExact, CAST(i.quantityOrdered AS DECIMAL(30,4)))
          - COALESCE(i.quantityReceivedExact, CAST(i.quantityReceived AS DECIMAL(30,4)))
          - COALESCE(i.quantityClosedShortExact, 0), 0)) AS incomingQuantity
      FROM PurchaseOrderItem i
      INNER JOIN PurchaseOrder o ON o.id = i.purchaseOrderId
      WHERE o.tenantId = ${tenantId} AND o.status IN ('APPROVED', 'PARTIALLY_RECEIVED')
      GROUP BY i.productId
    ), catalog AS (
      SELECT p.id AS productId, p.name, p.sku, p.category, p.unit, p.saleMode, p.quantityStep,
        CAST(p.stock AS DECIMAL(30,4)) AS currentStock,
        CAST(p.reorderPoint AS DECIMAL(30,4)) AS reorderPoint,
        CAST(p.maxStock AS DECIMAL(30,4)) AS maxStock,
        GREATEST(CAST(p.cost AS DECIMAL(36,16)), 0) AS cost,
        CASE WHEN p.reorderPoint > 0 THEN CAST(p.reorderPoint AS DECIMAL(30,4))
          ELSE CAST(p.minStock AS DECIMAL(30,4)) END AS thresholdQuantity,
        s.id AS supplierId, s.name AS supplierName,
        COALESCE(sold.soldQuantity, 0) AS soldQuantity,
        COALESCE(arriving.incomingQuantity, 0) AS incomingQuantity,
        CASE WHEN p.saleMode = 'COUNTED' OR
          (p.saleMode IS NULL AND p.quantityStep IS NULL AND LOWER(TRIM(p.unit)) IN ('unidad','unidades','caja','cajas'))
          THEN 1 ELSE 0 END AS isCounted
      FROM Product p
      LEFT JOIN Supplier s ON s.id = p.defaultSupplierId AND s.tenantId = p.tenantId AND s.deletedAt IS NULL
      LEFT JOIN sold ON sold.productId = p.id
      LEFT JOIN arriving ON arriving.productId = p.id
      WHERE p.tenantId = ${tenantId}
    ), planning AS (
      SELECT catalog.*, currentStock + incomingQuantity AS projectedStock,
        CASE WHEN maxStock > 0 THEN maxStock WHEN soldQuantity > 0 THEN soldQuantity / 2
          ELSE thresholdQuantity * 2 END AS targetQuantity,
        CASE WHEN quantityStep > 0 AND (isCounted = 0 OR MOD(quantityStep, 1) = 0) THEN quantityStep
          WHEN isCounted = 1 THEN 1 ELSE 0.0001 END AS stepQuantity,
        (thresholdQuantity > 0 AND currentStock <= thresholdQuantity) AS belowReorder,
        (soldQuantity > 0 AND currentStock * 30 <= soldQuantity * 7) AS fastMoving
      FROM catalog
    ), quantities AS (
      SELECT planning.*,
        CEIL(GREATEST(targetQuantity - projectedStock, 0) / stepQuantity) * stepQuantity AS suggestedQty
      FROM planning WHERE belowReorder OR fastMoving
    ), suggestions AS (
      SELECT productId, name, sku, category, unit, saleMode, quantityStep,
        currentStock, reorderPoint, maxStock, cost, supplierId, supplierName,
        incomingQuantity, projectedStock,
        ROUND(soldQuantity / 30, 2) AS vpd,
        CASE WHEN soldQuantity > 0 THEN ROUND(currentStock * 30 / soldQuantity, 1) ELSE NULL END AS daysRemaining,
        CASE WHEN belowReorder AND fastMoving THEN 'BOTH' WHEN belowReorder THEN 'REORDER_POINT' ELSE 'VELOCITY' END AS reason,
        suggestedQty, ROUND(suggestedQty * cost, 2) AS suggestedCost
      FROM quantities WHERE suggestedQty > 0
    )`;
  const offset = (options.page - 1) * options.pageSize;
  // Ambas lecturas comparten snapshot: total/importe no divergen de la página
  // si una recepción confirma existencias mientras se arma la respuesta.
  return db.$transaction(async tx => {
    const summary = await tx.$queryRaw<Array<{ total: bigint; totalEstimatedCost: Prisma.Decimal | null }>>(Prisma.sql`
      ${cte} SELECT COUNT(*) AS total, SUM(suggestedCost) AS totalEstimatedCost FROM suggestions`);
    const rows = await tx.$queryRaw<ReorderRow[]>(Prisma.sql`
      ${cte} SELECT * FROM suggestions
      ORDER BY daysRemaining IS NULL, daysRemaining, name, productId
      LIMIT ${options.pageSize} OFFSET ${offset}`);
    const total = Number(summary[0]?.total ?? 0);
    const items = rows.map(row => ({ ...row,
      quantityStep: row.quantityStep?.toString() ?? null,
      currentStock: Number(row.currentStock), reorderPoint: Number(row.reorderPoint), maxStock: Number(row.maxStock), cost: Number(row.cost),
      incomingQuantity: Number(row.incomingQuantity), projectedStock: Number(row.projectedStock),
      vpd: Number(row.vpd), daysRemaining: row.daysRemaining === null ? null : Number(row.daysRemaining),
      suggestedQty: Number(row.suggestedQty), suggestedCost: Number(row.suggestedCost),
    }));
    return { items, total, totalEstimatedCost: Number(summary[0]?.totalEstimatedCost ?? 0), ...options, hasMore: offset + rows.length < total };
  }, { isolationLevel: 'RepeatableRead' });
}
