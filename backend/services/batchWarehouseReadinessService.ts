import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
    assertBatchReconciliationReplay,
    assertFinalAllocationTotal,
    BatchWarehouseReadinessError,
    buildBatchReconciliationCommandId,
    buildBatchReconciliationPayloadHash,
    buildBatchReconciliationResultId,
    buildBatchReconciliationSourceKey,
    calculateBatchBalanceReadiness,
    canonicalReadinessQuantity,
    evaluateBatchWarehouseReadiness,
    normalizeBatchReconciliationCommand,
    parseBatchReconciliationClaim,
    parseBatchReconciliationResult,
    RECONCILIATION_COMMAND,
    type CanonicalBatchReconciliationCommand,
    type FinalWarehouseAllocation,
} from '../lib/batchWarehouseReadiness.js';
import { normalizeBatchWarehouseLedgerMode } from '../lib/batchWarehouseLedger.js';
import prisma from '../lib/prisma.js';
import {
    applyBatchWarehouseDelta,
    BatchWarehouseLedgerError,
} from './productBatchWarehouseLedgerService.js';

type PrismaTx = Prisma.TransactionClient;
type Database = PrismaClient;
type DbCount = bigint | number | string | Decimal;

const READINESS_PAGE_DEFAULT = 50;
const READINESS_PAGE_MAX = 100;
const READINESS_EXAMPLE_LIMIT = 10;

export interface BatchWarehouseReadinessQuery {
    cursor?: string;
    limit?: number;
}

export interface BatchWarehouseReconciliationRequest {
    clientEventId: string;
    batchId: string;
    reason: string;
    allocations: Array<{ warehouseId: string; quantity: string }>;
}

interface BatchSummaryRow {
    totalBatchCount: DbCount;
    activeBatchCount: DbCount;
    mismatchedBatchCount: DbCount;
    aggregateStock: Decimal.Value;
    localStock: Decimal.Value;
}

interface BatchPageRow {
    batchId: string;
    productId: string;
    batchNumber: string;
    expiryDate: Date;
    aggregateStock: Decimal.Value;
    localStock: Decimal.Value;
}

interface ProductWarehouseMismatchSummaryRow {
    mismatchCount: DbCount;
    requiredDelta: Decimal.Value;
}

interface ProductWarehouseMismatchExampleRow {
    productId: string;
    warehouseId: string;
    productStock: Decimal.Value;
    lotStock: Decimal.Value;
    difference: Decimal.Value;
}

interface ShadowGapSummaryRow {
    gapCount: DbCount;
    quantityDelta: Decimal.Value;
    requiredDelta: Decimal.Value;
}

interface IncompleteTrackedSaleSummaryRow {
    itemCount: DbCount;
    requiredDelta: Decimal.Value;
}

interface IncompleteTrackedSaleExampleRow {
    saleItemId: string;
    saleId: string;
    productId: string;
    soldQuantity: Decimal.Value;
    allocatedQuantity: Decimal.Value;
    difference: Decimal.Value;
}

interface IncompletePedidoReservationSummaryRow {
    reservationCount: DbCount;
}

interface IncompletePedidoReservationExampleRow {
    id: string;
    referenceId: string | null;
    productId: string;
    batchId: string | null;
    warehouseId: string | null;
    quantity: Decimal.Value;
    date: Date;
}

interface LockedBatchRow {
    id: string;
    productId: string;
    aggregateStock: Decimal.Value;
}

interface LockedBalanceRow {
    warehouseId: string;
    productId: string;
    stock: Decimal.Value;
}

interface LockedProductWarehouseRow {
    warehouseId: string;
    productStock: Decimal.Value;
    lotStockExcludingBatch: Decimal.Value;
}

export interface BatchWarehouseReconciliationData {
    commandId: string;
    batchId: string;
    productId: string;
    modeObserved: 'OFF' | 'SHADOW';
    aggregateStock: string;
    allocationTotal: string;
    allocations: Array<{
        warehouseId: string;
        before: string;
        after: string;
        delta: string;
        ledgerStatus: 'APPLIED' | 'UNCHANGED';
    }>;
}

export interface BatchWarehouseReconciliationResult {
    data: BatchWarehouseReconciliationData;
    replay: boolean;
}

const countAsNumber = (value: DbCount | null | undefined, field: string): number => {
    const text = value == null ? '0' : value.toString();
    let parsed: Decimal;
    try {
        parsed = new Decimal(text);
    } catch {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_COMMAND_CORRUPT',
            500,
            `${field} no es un conteo válido`,
        );
    }
    if (!parsed.isInteger() || parsed.isNegative() || parsed.greaterThan(Number.MAX_SAFE_INTEGER)) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_COMMAND_CORRUPT',
            500,
            `${field} excede el rango seguro`,
        );
    }
    return parsed.toNumber();
};

const exactQuantity = (value: Decimal.Value | null | undefined): string =>
    canonicalReadinessQuantity(value == null ? '0' : value.toString(), { allowNegative: true });

const isPrismaCode = (error: unknown, code: string): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === code
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === code;

const normalizeReadinessQuery = (query: BatchWarehouseReadinessQuery): {
    cursor?: string;
    limit: number;
} => {
    const limit = query.limit ?? READINESS_PAGE_DEFAULT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > READINESS_PAGE_MAX) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_INVALID_INPUT',
            400,
            `limit debe estar entre 1 y ${READINESS_PAGE_MAX}`,
        );
    }
    const cursor = query.cursor?.trim();
    if (cursor !== undefined && (!cursor || cursor.length > 191)) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_INVALID_INPUT',
            400,
            'cursor no es válido',
        );
    }
    return { ...(cursor ? { cursor } : {}), limit };
};

const assertActiveActor = async (
    database: Pick<Database, 'user'> | Pick<PrismaTx, 'user'>,
    input: { tenantId: string; userId: string },
): Promise<void> => {
    const actor = await database.user.findFirst({
        where: { id: input.userId, tenantId: input.tenantId, status: 'ACTIVE' },
        select: { id: true },
    });
    if (!actor) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_USER_NOT_ACTIVE',
            403,
            'El usuario ya no está activo en este negocio',
        );
    }
};

const loadReconciliationReplay = async (
    database: Pick<Database, 'auditLog'> | Pick<PrismaTx, 'auditLog'>,
    input: {
        tenantId: string;
        commandId: string;
        payloadHash: string;
        batchId: string;
    },
): Promise<BatchWarehouseReconciliationResult | null> => {
    const claimRow = await database.auditLog.findFirst({
        where: { id: input.commandId, tenantId: input.tenantId },
        select: { action: true, details: true },
    });
    if (!claimRow) return null;
    if (claimRow.action !== 'BATCH_WAREHOUSE_RECONCILIATION_COMMAND') {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_COMMAND_CORRUPT',
            500,
            'El identificador idempotente colisionó con otra auditoría',
        );
    }
    const claim = parseBatchReconciliationClaim(claimRow.details);
    assertBatchReconciliationReplay(claim, input);
    const resultRow = await database.auditLog.findFirst({
        where: { id: claim.resultAuditId, tenantId: input.tenantId },
        select: { action: true, details: true },
    });
    if (!resultRow || resultRow.action !== 'BATCH_WAREHOUSE_RECONCILED') {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_COMMAND_INCOMPLETE',
            500,
            'La reconciliación reclamada no tiene resultado inmutable',
        );
    }
    const stored = parseBatchReconciliationResult(resultRow.details, input);
    return {
        data: stored.response,
        replay: true,
    };
};

const summaryQuery = (tenantId: string) => Prisma.sql`
    SELECT
        COUNT(*) AS totalBatchCount,
        COALESCE(SUM(CASE WHEN CAST(pb.stock AS DECIMAL(18, 4)) > 0 THEN 1 ELSE 0 END), 0) AS activeBatchCount,
        COALESCE(SUM(CASE
            WHEN CAST(pb.stock AS DECIMAL(18, 4)) <> COALESCE(local.localStock, 0) THEN 1
            ELSE 0
        END), 0) AS mismatchedBatchCount,
        CAST(COALESCE(SUM(CAST(pb.stock AS DECIMAL(18, 4))), 0) AS CHAR) AS aggregateStock,
        CAST(COALESCE(SUM(COALESCE(local.localStock, 0)), 0) AS CHAR) AS localStock
    FROM ProductBatch pb
    LEFT JOIN (
        SELECT batchId, SUM(stock) AS localStock
        FROM ProductBatchWarehouseStock
        WHERE tenantId = ${tenantId}
        GROUP BY batchId
    ) local ON local.batchId = pb.id
    WHERE pb.tenantId = ${tenantId}
`;

const pageQuery = (tenantId: string, cursor: string | undefined, take: number) => Prisma.sql`
    SELECT
        pb.id AS batchId,
        pb.productId,
        pb.batchNumber,
        pb.expiryDate,
        CAST(CAST(pb.stock AS DECIMAL(18, 4)) AS CHAR) AS aggregateStock,
        CAST(COALESCE(SUM(pws.stock), 0) AS CHAR) AS localStock
    FROM ProductBatch pb
    LEFT JOIN ProductBatchWarehouseStock pws
      ON pws.tenantId = ${tenantId}
     AND pws.batchId = pb.id
    WHERE pb.tenantId = ${tenantId}
      ${cursor ? Prisma.sql`AND pb.id > ${cursor}` : Prisma.empty}
    GROUP BY pb.id, pb.productId, pb.batchNumber, pb.expiryDate, pb.stock
    ORDER BY pb.id ASC
    LIMIT ${take}
`;

const productWarehouseMismatchBaseQuery = (tenantId: string) => Prisma.sql`
    SELECT
        pairs.productId,
        pairs.warehouseId,
        CAST(COALESCE(ps.stock, 0) AS DECIMAL(18, 4)) AS productStock,
        COALESCE(SUM(pws.stock), 0) AS lotStock,
        CAST(COALESCE(ps.stock, 0) AS DECIMAL(18, 4)) - COALESCE(SUM(pws.stock), 0) AS difference
    FROM (
        SELECT productId, warehouseId
        FROM ProductStock
        WHERE tenantId = ${tenantId}
        UNION
        SELECT productId, warehouseId
        FROM ProductBatchWarehouseStock
        WHERE tenantId = ${tenantId}
    ) pairs
    INNER JOIN Product p
      ON p.id = pairs.productId
     AND p.tenantId = ${tenantId}
     AND (
        p.requiresBatchTracking = TRUE
        OR EXISTS (
            SELECT 1
            FROM ProductBatch historicalBatch
            WHERE historicalBatch.tenantId = ${tenantId}
              AND historicalBatch.productId = pairs.productId
        )
     )
    LEFT JOIN ProductStock ps
      ON ps.tenantId = ${tenantId}
     AND ps.productId = pairs.productId
     AND ps.warehouseId = pairs.warehouseId
    LEFT JOIN ProductBatchWarehouseStock pws
      ON pws.tenantId = ${tenantId}
     AND pws.productId = pairs.productId
     AND pws.warehouseId = pairs.warehouseId
    GROUP BY pairs.productId, pairs.warehouseId, ps.stock
    HAVING CAST(COALESCE(ps.stock, 0) AS DECIMAL(18, 4)) <> COALESCE(SUM(pws.stock), 0)
`;

const productWarehouseMismatchSummaryQuery = (tenantId: string) => Prisma.sql`
    SELECT
        COUNT(*) AS mismatchCount,
        CAST(COALESCE(SUM(ABS(mismatch.difference)), 0) AS CHAR) AS requiredDelta
    FROM (${productWarehouseMismatchBaseQuery(tenantId)}) mismatch
`;

const productWarehouseMismatchExamplesQuery = (tenantId: string) => Prisma.sql`
    SELECT
        mismatch.productId,
        mismatch.warehouseId,
        CAST(mismatch.productStock AS CHAR) AS productStock,
        CAST(mismatch.lotStock AS CHAR) AS lotStock,
        CAST(mismatch.difference AS CHAR) AS difference
    FROM (${productWarehouseMismatchBaseQuery(tenantId)}) mismatch
    ORDER BY mismatch.productId ASC, mismatch.warehouseId ASC
    LIMIT ${READINESS_EXAMPLE_LIMIT}
`;

const gapSummaryQuery = (tenantId: string, since: Date) => Prisma.sql`
    SELECT
        COUNT(*) AS gapCount,
        CAST(COALESCE(SUM(quantityDelta), 0) AS CHAR) AS quantityDelta,
        CAST(COALESCE(SUM(CASE
            WHEN stockBefore + quantityDelta < 0 THEN -(stockBefore + quantityDelta)
            ELSE 0
        END), 0) AS CHAR) AS requiredDelta
    FROM ProductBatchLedgerEntry
    WHERE tenantId = ${tenantId}
      AND status = 'SHADOW_GAP'
      AND createdAt >= ${since}
`;

const incompleteTrackedSaleBaseQuery = (tenantId: string) => Prisma.sql`
    SELECT
        si.id AS saleItemId,
        si.saleId,
        si.productId,
        CAST(si.quantity AS DECIMAL(18, 4)) AS soldQuantity,
        COALESCE(SUM(siba.quantity), 0) AS allocatedQuantity,
        CAST(si.quantity AS DECIMAL(18, 4)) - COALESCE(SUM(siba.quantity), 0) AS difference
    FROM SaleItem si
    INNER JOIN Sale s
      ON s.id = si.saleId
     AND s.tenantId = ${tenantId}
    INNER JOIN Product p
      ON p.id = si.productId
     AND p.tenantId = ${tenantId}
    LEFT JOIN SaleItemBatchAllocation siba
      ON siba.saleItemId = si.id
     AND siba.tenantId = ${tenantId}
    WHERE s.tenantId = ${tenantId}
      AND s.status <> 'VOIDED'
      AND s.cancelledAt IS NULL
      AND (
          p.requiresBatchTracking = TRUE
          OR EXISTS (
              SELECT 1
              FROM ProductBatch historicalBatch
              WHERE historicalBatch.tenantId = ${tenantId}
                AND historicalBatch.productId = si.productId
          )
      )
    GROUP BY si.id, si.saleId, si.productId, si.quantity
    HAVING CAST(si.quantity AS DECIMAL(18, 4)) <> COALESCE(SUM(siba.quantity), 0)
`;

const incompleteTrackedSaleSummaryQuery = (tenantId: string) => Prisma.sql`
    SELECT
        COUNT(*) AS itemCount,
        CAST(COALESCE(SUM(ABS(incomplete.difference)), 0) AS CHAR) AS requiredDelta
    FROM (${incompleteTrackedSaleBaseQuery(tenantId)}) incomplete
`;

const incompleteTrackedSaleExamplesQuery = (tenantId: string) => Prisma.sql`
    SELECT
        incomplete.saleItemId,
        incomplete.saleId,
        incomplete.productId,
        CAST(incomplete.soldQuantity AS CHAR) AS soldQuantity,
        CAST(incomplete.allocatedQuantity AS CHAR) AS allocatedQuantity,
        CAST(incomplete.difference AS CHAR) AS difference
    FROM (${incompleteTrackedSaleBaseQuery(tenantId)}) incomplete
    ORDER BY incomplete.saleItemId ASC
    LIMIT ${READINESS_EXAMPLE_LIMIT}
`;

const incompletePedidoReservationBaseQuery = (tenantId: string) => Prisma.sql`
    SELECT
        km.id,
        km.referenceId,
        km.productId,
        km.batchId,
        km.warehouseId,
        CAST(CAST(km.quantity AS DECIMAL(18, 4)) AS CHAR) AS quantity,
        km.date
    FROM KardexMovement km
    INNER JOIN Product p
      ON p.id = km.productId
     AND p.tenantId = ${tenantId}
    WHERE km.tenantId = ${tenantId}
      AND km.referenceType = 'PEDIDO_RESERVA'
      AND (km.batchId IS NULL OR km.warehouseId IS NULL)
      AND (
          p.requiresBatchTracking = TRUE
          OR EXISTS (
              SELECT 1
              FROM ProductBatch historicalBatch
              WHERE historicalBatch.tenantId = ${tenantId}
                AND historicalBatch.productId = km.productId
          )
      )
`;

const incompletePedidoReservationSummaryQuery = (tenantId: string) => Prisma.sql`
    SELECT COUNT(*) AS reservationCount
    FROM (${incompletePedidoReservationBaseQuery(tenantId)}) incompleteReservation
`;

const incompletePedidoReservationExamplesQuery = (tenantId: string) => Prisma.sql`
    SELECT
        incompleteReservation.id,
        incompleteReservation.referenceId,
        incompleteReservation.productId,
        incompleteReservation.batchId,
        incompleteReservation.warehouseId,
        incompleteReservation.quantity,
        incompleteReservation.date
    FROM (${incompletePedidoReservationBaseQuery(tenantId)}) incompleteReservation
    ORDER BY incompleteReservation.date DESC, incompleteReservation.id DESC
    LIMIT ${READINESS_EXAMPLE_LIMIT}
`;

const buildReadinessReport = async (
    tx: PrismaTx,
    tenantId: string,
    rawQuery: BatchWarehouseReadinessQuery,
) => {
    const query = normalizeReadinessQuery(rawQuery);
    const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: {
            id: true,
            batchWarehouseLedgerMode: true,
            batchWarehouseLedgerActivatedAt: true,
            createdAt: true,
        },
    });
    if (!tenant) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_TENANT_NOT_FOUND',
            404,
            'El negocio no existe para evaluar el subledger lote-bodega',
        );
    }

    const summaryRows = await tx.$queryRaw<BatchSummaryRow[]>(summaryQuery(tenantId));
    const summary = summaryRows[0] ?? {
        totalBatchCount: 0,
        activeBatchCount: 0,
        mismatchedBatchCount: 0,
        aggregateStock: '0',
        localStock: '0',
    };
    const pageRows = await tx.$queryRaw<BatchPageRow[]>(pageQuery(tenantId, query.cursor, query.limit + 1));
    const hasNextPage = pageRows.length > query.limit;
    const visibleRows = hasNextPage ? pageRows.slice(0, query.limit) : pageRows;
    const gapSince = tenant.batchWarehouseLedgerActivatedAt ?? tenant.createdAt;
    const gapRows = await tx.$queryRaw<ShadowGapSummaryRow[]>(gapSummaryQuery(tenantId, gapSince));
    const gapSummary = gapRows[0] ?? { gapCount: 0, quantityDelta: '0', requiredDelta: '0' };
    const productWarehouseMismatchRows = await tx.$queryRaw<ProductWarehouseMismatchSummaryRow[]>(
        productWarehouseMismatchSummaryQuery(tenantId),
    );
    const productWarehouseMismatchSummary = productWarehouseMismatchRows[0] ?? {
        mismatchCount: 0,
        requiredDelta: '0',
    };
    const productWarehouseMismatchExamples = await tx.$queryRaw<ProductWarehouseMismatchExampleRow[]>(
        productWarehouseMismatchExamplesQuery(tenantId),
    );
    const trackedSaleRows = await tx.$queryRaw<IncompleteTrackedSaleSummaryRow[]>(
        incompleteTrackedSaleSummaryQuery(tenantId),
    );
    const trackedSaleSummary = trackedSaleRows[0] ?? { itemCount: 0, requiredDelta: '0' };
    const incompleteTrackedSaleExamples = await tx.$queryRaw<IncompleteTrackedSaleExampleRow[]>(
        incompleteTrackedSaleExamplesQuery(tenantId),
    );
    const incompletePedidoReservationRows = await tx.$queryRaw<IncompletePedidoReservationSummaryRow[]>(
        incompletePedidoReservationSummaryQuery(tenantId),
    );
    const incompletePedidoBatchReservationCount = countAsNumber(
        incompletePedidoReservationRows[0]?.reservationCount,
        'incompletePedidoReservationCount',
    );
    const incompletePedidoBatchReservationExamples = await tx.$queryRaw<IncompletePedidoReservationExampleRow[]>(
        incompletePedidoReservationExamplesQuery(tenantId),
    );

    const legacyAllocationCount = await tx.saleItemBatchAllocation.count({
        where: { tenantId, warehouseId: null },
    });
    const legacyAllocationExamples = await tx.saleItemBatchAllocation.findMany({
        where: { tenantId, warehouseId: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: READINESS_EXAMPLE_LIMIT,
        select: { id: true, saleItemId: true, batchId: true, quantity: true, createdAt: true },
    });
    const shadowGapExamples = await tx.productBatchLedgerEntry.findMany({
        where: { tenantId, status: 'SHADOW_GAP', createdAt: { gte: gapSince } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: READINESS_EXAMPLE_LIMIT,
        select: {
            id: true,
            batchId: true,
            warehouseId: true,
            quantityDelta: true,
            stockBefore: true,
            stockAfter: true,
            sourceKey: true,
            createdAt: true,
        },
    });

    const totalBalance = calculateBatchBalanceReadiness({
        aggregateStock: exactQuantity(summary.aggregateStock),
        localStock: exactQuantity(summary.localStock),
    });
    const decision = evaluateBatchWarehouseReadiness({
        mode: tenant.batchWarehouseLedgerMode,
        activatedAt: tenant.batchWarehouseLedgerActivatedAt,
        mismatchedBatchCount: countAsNumber(summary.mismatchedBatchCount, 'mismatchedBatchCount'),
        totalDifference: totalBalance.difference,
        mismatchedProductWarehouseCount: countAsNumber(
            productWarehouseMismatchSummary.mismatchCount,
            'mismatchedProductWarehouseCount',
        ),
        mismatchedProductWarehouseDelta: exactQuantity(productWarehouseMismatchSummary.requiredDelta),
        legacyAllocationCount,
        incompleteTrackedSaleItemCount: countAsNumber(trackedSaleSummary.itemCount, 'itemCount'),
        incompleteTrackedSaleAllocationDelta: exactQuantity(trackedSaleSummary.requiredDelta),
        incompletePedidoBatchReservationCount,
        unresolvedShadowGapCount: countAsNumber(gapSummary.gapCount, 'gapCount'),
        unresolvedShadowGapDelta: exactQuantity(gapSummary.requiredDelta),
    });

    return {
        data: {
            mode: decision.mode,
            activatedAt: tenant.batchWarehouseLedgerActivatedAt,
            gapScanSince: gapSince,
            canEnterShadow: decision.canEnterShadow,
            canEnforce: decision.canEnforce,
            blockers: decision.blockers,
            shadowBlockers: decision.shadowBlockers,
            enforcementBlockers: decision.enforcementBlockers,
            summary: {
                totalBatchCount: countAsNumber(summary.totalBatchCount, 'totalBatchCount'),
                activeBatchCount: countAsNumber(summary.activeBatchCount, 'activeBatchCount'),
                mismatchedBatchCount: countAsNumber(summary.mismatchedBatchCount, 'mismatchedBatchCount'),
                aggregateStock: totalBalance.aggregateStock,
                localStock: totalBalance.localStock,
                difference: totalBalance.difference,
                mismatchedProductWarehouseCount: countAsNumber(
                    productWarehouseMismatchSummary.mismatchCount,
                    'mismatchedProductWarehouseCount',
                ),
                mismatchedProductWarehouseDelta: exactQuantity(productWarehouseMismatchSummary.requiredDelta),
                legacyAllocationCount,
                incompleteTrackedSaleItemCount: countAsNumber(
                    trackedSaleSummary.itemCount,
                    'itemCount',
                ),
                incompleteTrackedSaleAllocationDelta: exactQuantity(trackedSaleSummary.requiredDelta),
                incompletePedidoBatchReservationCount,
                unresolvedShadowGapCount: countAsNumber(gapSummary.gapCount, 'gapCount'),
                unresolvedShadowGapQuantityDelta: exactQuantity(gapSummary.quantityDelta),
                unresolvedShadowGapDeltaRequired: exactQuantity(gapSummary.requiredDelta),
            },
            batches: visibleRows.map(row => ({
                batchId: row.batchId,
                productId: row.productId,
                batchNumber: row.batchNumber,
                expiryDate: row.expiryDate,
                ...calculateBatchBalanceReadiness({
                    aggregateStock: exactQuantity(row.aggregateStock),
                    localStock: exactQuantity(row.localStock),
                }),
            })),
            legacyAllocationExamples: legacyAllocationExamples.map(row => ({
                ...row,
                quantity: exactQuantity(row.quantity),
            })),
            incompleteTrackedSaleExamples: incompleteTrackedSaleExamples.map(row => ({
                ...row,
                soldQuantity: exactQuantity(row.soldQuantity),
                allocatedQuantity: exactQuantity(row.allocatedQuantity),
                difference: exactQuantity(row.difference),
            })),
            productWarehouseMismatchExamples: productWarehouseMismatchExamples.map(row => ({
                ...row,
                productStock: exactQuantity(row.productStock),
                lotStock: exactQuantity(row.lotStock),
                difference: exactQuantity(row.difference),
            })),
            incompletePedidoBatchReservationExamples: incompletePedidoBatchReservationExamples.map(row => ({
                ...row,
                quantity: exactQuantity(row.quantity),
            })),
            shadowGapExamples: shadowGapExamples.map(row => ({
                ...row,
                quantityDelta: exactQuantity(row.quantityDelta),
                stockBefore: exactQuantity(row.stockBefore),
                stockAfter: exactQuantity(row.stockAfter),
            })),
        },
        pageInfo: {
            limit: query.limit,
            nextCursor: hasNextPage ? visibleRows.at(-1)?.batchId ?? null : null,
        },
    };
};

const executeReconciliation = async (
    tx: PrismaTx,
    command: CanonicalBatchReconciliationCommand,
    commandId: string,
    payloadHash: string,
): Promise<BatchWarehouseReconciliationData> => {
    const batchPreview = await tx.productBatch.findFirst({
        where: { id: command.batchId, tenantId: command.tenantId },
        select: { id: true, productId: true },
    });
    if (!batchPreview) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_BATCH_NOT_FOUND',
            404,
            'El lote no existe en este negocio',
        );
    }
    const tenant = await tx.tenant.findFirst({
        where: { id: command.tenantId },
        select: { batchWarehouseLedgerMode: true },
    });
    if (!tenant) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_TENANT_NOT_FOUND',
            404,
            'El negocio no existe para reconciliar el subledger',
        );
    }
    const mode = normalizeBatchWarehouseLedgerMode(tenant.batchWarehouseLedgerMode);
    if (mode !== 'OFF' && mode !== 'SHADOW') {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_MODE_NOT_RECONCILABLE',
            409,
            'La reconciliación explícita solo está disponible en OFF o SHADOW',
        );
    }
    await assertActiveActor(tx, command);
    const warehouseIds = command.allocations.map(allocation => allocation.warehouseId);

    // Una reconciliación acepta también allocations sin delta. Se bloquean y
    // revalidan TODAS las bodegas para que ninguna pueda desactivarse entre el
    // preview y el claim atómico.
    const lockedWarehouses = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM Warehouse
        WHERE tenantId = ${command.tenantId}
          AND isActive = TRUE
          AND id IN (${Prisma.join(warehouseIds)})
        ORDER BY id ASC
        FOR UPDATE
    `);
    if (
        lockedWarehouses.length !== warehouseIds.length
        || lockedWarehouses.some((warehouse, index) => warehouse.id !== warehouseIds[index])
    ) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_WAREHOUSE_NOT_ACTIVE',
            404,
            'Una o más bodegas no existen, están inactivas o pertenecen a otro negocio',
        );
    }

    // Orden canónico: Warehouses -> Product -> ProductBatch -> balances.
    const lockedProducts = await tx.$queryRaw<Array<{ id: string; requiresBatchTracking: boolean | number }>>(Prisma.sql`
        SELECT id, requiresBatchTracking
        FROM Product
        WHERE id = ${batchPreview.productId}
          AND tenantId = ${command.tenantId}
        FOR UPDATE
    `);
    const lockedProduct = lockedProducts[0];
    if (!lockedProduct || lockedProducts.length !== 1) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_BATCH_NOT_FOUND',
            404,
            'El producto del lote no existe en este negocio',
        );
    }
    const lockedBatches = await tx.$queryRaw<LockedBatchRow[]>(Prisma.sql`
        SELECT id, productId, CAST(CAST(stock AS DECIMAL(18, 4)) AS CHAR) AS aggregateStock
        FROM ProductBatch
        WHERE id = ${command.batchId}
          AND tenantId = ${command.tenantId}
          AND productId = ${batchPreview.productId}
        FOR UPDATE
    `);
    const batch = lockedBatches[0];
    if (!batch) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_BATCH_NOT_FOUND',
            404,
            'El lote cambió mientras se preparaba la reconciliación',
        );
    }
    const currentRows = await tx.$queryRaw<LockedBalanceRow[]>(Prisma.sql`
        SELECT warehouseId, productId, stock
        FROM ProductBatchWarehouseStock
        WHERE tenantId = ${command.tenantId}
          AND batchId = ${command.batchId}
        ORDER BY warehouseId ASC
        FOR UPDATE
    `);
    if (currentRows.some(row => row.productId !== batch.productId)) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_COMMAND_CORRUPT',
            500,
            'Un saldo lote-bodega está enlazado a otro producto',
        );
    }
    const requestedWarehouseIds = new Set(warehouseIds);
    const omittedNonZero = currentRows.filter(row => (
        !requestedWarehouseIds.has(row.warehouseId)
        && !new Decimal(exactQuantity(row.stock)).isZero()
    ));
    if (omittedNonZero.length > 0) {
        throw new BatchWarehouseReadinessError(
            'BATCH_READINESS_FINAL_STATE_INCOMPLETE',
            409,
            'El payload final debe declarar toda bodega que ya tenga saldo en el lote',
            { omittedWarehouseIds: omittedNonZero.map(row => row.warehouseId) },
        );
    }
    const totals = assertFinalAllocationTotal(command.allocations, exactQuantity(batch.aggregateStock));
    const affectedWarehouseIds = [...new Set([
        ...currentRows.map(row => row.warehouseId),
        ...warehouseIds,
    ])].sort((left, right) => left.localeCompare(right));
    // El ProductBatch bloqueado es por sí mismo evidencia histórica de
    // tracking, incluso si el flag actual del producto fue apagado y este lote
    // todavía no tiene ninguna fila sidecar. Toda reconciliación de un batch
    // debe, por tanto, respetar la capacidad real de ProductStock.
    if (affectedWarehouseIds.length > 0) {
        const productStockRows = await tx.$queryRaw<LockedProductWarehouseRow[]>(Prisma.sql`
            SELECT
                pairs.warehouseId,
                CAST(COALESCE(ps.stock, 0) AS DECIMAL(18, 4)) AS productStock,
                COALESCE(SUM(CASE
                    WHEN pws.batchId <> ${command.batchId} THEN pws.stock
                    ELSE 0
                END), 0) AS lotStockExcludingBatch
            FROM (
                SELECT warehouseId
                FROM ProductStock
                WHERE tenantId = ${command.tenantId}
                  AND productId = ${batch.productId}
                  AND warehouseId IN (${Prisma.join(affectedWarehouseIds)})
                UNION
                SELECT warehouseId
                FROM ProductBatchWarehouseStock
                WHERE tenantId = ${command.tenantId}
                  AND productId = ${batch.productId}
                  AND warehouseId IN (${Prisma.join(affectedWarehouseIds)})
            ) pairs
            LEFT JOIN ProductStock ps
              ON ps.tenantId = ${command.tenantId}
             AND ps.productId = ${batch.productId}
             AND ps.warehouseId = pairs.warehouseId
            LEFT JOIN ProductBatchWarehouseStock pws
              ON pws.tenantId = ${command.tenantId}
             AND pws.productId = ${batch.productId}
             AND pws.warehouseId = pairs.warehouseId
            GROUP BY pairs.warehouseId, ps.stock
            ORDER BY pairs.warehouseId ASC
            FOR UPDATE
        `);
        const productStockByWarehouse = new Map(productStockRows.map(row => [row.warehouseId, row]));
        const projectionByWarehouse = new Map(command.allocations.map(allocation => [
            allocation.warehouseId,
            allocation.quantity,
        ]));
        const mismatches = affectedWarehouseIds.flatMap(warehouseId => {
            const row = productStockByWarehouse.get(warehouseId);
            const finalBatchAllocation = projectionByWarehouse.get(warehouseId) ?? '0.0000';
            const projectedLotStock = new Decimal(exactQuantity(row?.lotStockExcludingBatch ?? '0'))
                .plus(finalBatchAllocation)
                .toFixed(4);
            const productStock = exactQuantity(row?.productStock ?? '0');
            const overflow = new Decimal(projectedLotStock).minus(productStock).toFixed(4);
            return new Decimal(overflow).lessThanOrEqualTo(0)
                ? []
                : [{
                    warehouseId,
                    productStock,
                    projectedLotStock,
                    overflow,
                }];
        });
        if (mismatches.length > 0) {
            throw new BatchWarehouseReadinessError(
                'BATCH_READINESS_PRODUCT_WAREHOUSE_MISMATCH',
                409,
                'La reconciliación excede ProductStock para este producto por bodega',
                { productId: batch.productId, mismatches },
            );
        }
    }
    const resultAuditId = buildBatchReconciliationResultId(commandId);

    // Claim inmutable antes de todo efecto. La PK determinística resuelve carreras.
    await tx.auditLog.create({
        data: {
            id: commandId,
            tenantId: command.tenantId,
            userId: command.userId,
            action: 'BATCH_WAREHOUSE_RECONCILIATION_COMMAND',
            details: JSON.stringify({
                version: 1,
                commandType: RECONCILIATION_COMMAND,
                payloadHash,
                resultAuditId,
                batchId: command.batchId,
            }),
        },
    });

    const currentByWarehouse = new Map(currentRows.map(row => [
        row.warehouseId,
        exactQuantity(row.stock),
    ]));
    const allocationResults: BatchWarehouseReconciliationData['allocations'] = [];
    for (const allocation of command.allocations) {
        const before = currentByWarehouse.get(allocation.warehouseId) ?? '0.0000';
        const delta = new Decimal(allocation.quantity).minus(before).toFixed(4);
        if (new Decimal(delta).isZero()) {
            allocationResults.push({
                warehouseId: allocation.warehouseId,
                before,
                after: allocation.quantity,
                delta,
                ledgerStatus: 'UNCHANGED',
            });
            continue;
        }
        let ledgerResult: Awaited<ReturnType<typeof applyBatchWarehouseDelta>>;
        try {
            ledgerResult = await applyBatchWarehouseDelta({
                tx,
                // OFF bootstrap is an explicit, audited SHADOW write; the tenant
                // mode itself remains unchanged until a separate future command.
                mode: 'SHADOW',
                tenantId: command.tenantId,
                productId: batch.productId,
                batchId: command.batchId,
                warehouseId: allocation.warehouseId,
                delta,
                movementType: 'RECONCILIATION',
                referenceId: commandId,
                referenceType: 'BATCH_RECONCILIATION',
                userId: command.userId,
                reason: command.reason,
                sourceKey: buildBatchReconciliationSourceKey(commandId, allocation.warehouseId),
                allowNegative: false,
            });
        } catch (error) {
            if (
                error instanceof BatchWarehouseLedgerError
                && (error.code === 'BATCH_WAREHOUSE_INSUFFICIENT_STOCK'
                    || error.code === 'BATCH_WAREHOUSE_CONCURRENT_WRITE')
            ) {
                throw new BatchWarehouseReadinessError(
                    'BATCH_READINESS_CONCURRENT_WRITE',
                    409,
                    'El saldo lote-bodega cambió; volvé a cargar el readiness',
                );
            }
            throw error;
        }
        if (ledgerResult.status !== 'APPLIED') {
            throw new BatchWarehouseReadinessError(
                'BATCH_READINESS_CONCURRENT_WRITE',
                409,
                'La reconciliación no pudo aplicar el saldo final solicitado',
            );
        }
        allocationResults.push({
            warehouseId: allocation.warehouseId,
            before,
            after: allocation.quantity,
            delta,
            ledgerStatus: 'APPLIED',
        });
    }

    const data: BatchWarehouseReconciliationData = {
        commandId,
        batchId: command.batchId,
        productId: batch.productId,
        modeObserved: mode,
        aggregateStock: totals.aggregateStock,
        allocationTotal: totals.allocationTotal,
        allocations: allocationResults,
    };
    await tx.auditLog.create({
        data: {
            id: resultAuditId,
            tenantId: command.tenantId,
            userId: command.userId,
            action: 'BATCH_WAREHOUSE_RECONCILED',
            details: JSON.stringify({ version: 1, commandId, payloadHash, response: data }),
        },
    });
    return data;
};

export function createBatchWarehouseReadinessService(database: Database = prisma) {
    return {
        async readiness(tenantId: string, query: BatchWarehouseReadinessQuery = {}) {
            const scopedTenantId = tenantId.trim();
            if (!scopedTenantId || scopedTenantId.length > 191) {
                throw new BatchWarehouseReadinessError(
                    'BATCH_READINESS_INVALID_INPUT',
                    400,
                    'tenantId autenticado no es válido',
                );
            }
            return database.$transaction(
                tx => buildReadinessReport(tx, scopedTenantId, query),
                { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
            );
        },

        async reconcile(
            tenantId: string,
            userId: string,
            request: BatchWarehouseReconciliationRequest,
        ): Promise<BatchWarehouseReconciliationResult> {
            const command = normalizeBatchReconciliationCommand({ tenantId, userId, ...request });
            const commandId = buildBatchReconciliationCommandId(command);
            const payloadHash = buildBatchReconciliationPayloadHash(command);
            // Un replay sigue siendo una operación administrativa: no se
            // revela ni devuelve a un actor revocado.
            await assertActiveActor(database, command);
            const replay = await loadReconciliationReplay(database, {
                tenantId: command.tenantId,
                commandId,
                payloadHash,
                batchId: command.batchId,
            });
            if (replay) return replay;

            try {
                const data = await database.$transaction(
                    tx => executeReconciliation(tx, command, commandId, payloadHash),
                    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
                );
                return { data, replay: false };
            } catch (error) {
                if (isPrismaCode(error, 'P2002')) {
                    await assertActiveActor(database, command);
                    const racedReplay = await loadReconciliationReplay(database, {
                        tenantId: command.tenantId,
                        commandId,
                        payloadHash,
                        batchId: command.batchId,
                    });
                    if (racedReplay) return racedReplay;
                    throw new BatchWarehouseReadinessError(
                        'BATCH_READINESS_CONCURRENT_WRITE',
                        409,
                        'La reconciliación compitió con otro comando; reintentá',
                    );
                }
                if (isPrismaCode(error, 'P2034')) {
                    throw new BatchWarehouseReadinessError(
                        'BATCH_READINESS_CONCURRENT_WRITE',
                        409,
                        'La reconciliación encontró una escritura concurrente; reintentá',
                    );
                }
                throw error;
            }
        },
    };
}

export type BatchWarehouseReadinessService = ReturnType<typeof createBatchWarehouseReadinessService>;
export { BatchWarehouseReadinessError };
