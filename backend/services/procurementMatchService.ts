import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import {
    calculateProcurementMatch,
    normalizeProcurementResolution,
    ProcurementMatchError,
    summarizePostedProcurementAmounts,
    type ProcurementMatchPlan,
    type ProcurementMatchStatus,
    type ProcurementResolutionRequest,
} from '../lib/procurementMatch.js';

type PrismaTx = Prisma.TransactionClient;
type DecimalInput = Prisma.Decimal | string | number;

interface LockedPurchaseRow {
    id: string;
    tenantId: string;
    supplierId: string;
    purchaseOrderId: string | null;
    paymentMethod: string;
    documentStatus: string;
    matchStatus: string;
    paymentHold: boolean | number;
    matchResolvedBy: string | null;
    matchResolvedAt: Date | null;
    matchResolutionNote: string | null;
    matchResolutionClientEventId: string | null;
    matchResolutionPayloadHash: string | null;
}

interface LockedOrderRow {
    id: string;
    supplierId: string;
}

interface LockedOrderLineRow {
    id: string;
    productId: string;
    quantityOrdered: DecimalInput;
    quantityOrderedExact: DecimalInput | null;
    quantityReceived: DecimalInput;
    quantityReceivedExact: DecimalInput | null;
    unitCost: DecimalInput;
    unitCostExact: DecimalInput | null;
}

interface LockedPurchaseItemRow {
    id: string;
    productId: string;
    quantity: DecimalInput;
    quantityExact: DecimalInput | null;
    unitCost: DecimalInput;
    unitCostExact: DecimalInput | null;
    purchaseOrderItemId: string | null;
}

interface LockedReceiptItemRow {
    id: string;
    purchaseOrderItemId: string;
    quantityExact: DecimalInput;
    receivedAt: Date;
}

interface LockedAllocationRow {
    goodsReceiptItemId: string | null;
    purchaseOrderItemId: string;
    source: string;
    quantityExact: DecimalInput;
}

interface LockedPolicyRow {
    priceTolerancePct: DecimalInput;
}

export interface ProcurementMatchExecutionResult {
    purchaseId: string;
    matchStatus: Extract<ProcurementMatchStatus, 'NOT_REQUIRED' | 'MATCHED' | 'EXCEPTION'>;
    paymentHold: boolean;
    priceTolerancePct: string;
    allocationCount: number;
    exceptionCount: number;
    plan: ProcurementMatchPlan;
}

const asDecimalString = (value: DecimalInput): string => value.toString();

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === 'P2002'
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === 'P2002';

const bool = (value: boolean | number): boolean => value === true || value === 1;

const postedAmountsFromPurchaseItems = (items: Array<{
    quantity: DecimalInput;
    quantityExact: DecimalInput | null;
    unitCost: DecimalInput;
    unitCostExact: DecimalInput | null;
    expectedUnitCostExact: DecimalInput | null;
}>) => summarizePostedProcurementAmounts(items.map((item) => {
    const itemQuantity = new Decimal(asDecimalString(item.quantityExact ?? item.quantity));
    const actualUnitCost = new Decimal(asDecimalString(item.unitCostExact ?? item.unitCost));
    const expectedUnitCost = item.expectedUnitCostExact == null
        ? actualUnitCost
        : new Decimal(asDecimalString(item.expectedUnitCostExact));
    return {
        expectedAmount: itemQuantity.mul(expectedUnitCost),
        invoiceAmount: itemQuantity.mul(actualUnitCost),
    };
}));

const requireSinglePurchase = (rows: LockedPurchaseRow[]): LockedPurchaseRow => {
    if (rows.length !== 1) {
        throw new ProcurementMatchError(
            'PURCHASE_NOT_FOUND',
            404,
            'Compra no encontrada',
        );
    }
    return rows[0];
};

/**
 * Resuelve filas legacy solo cuando productId determina una única línea de OC.
 * El resultado materializado y todo el cálculo posterior usan exclusivamente
 * PurchaseOrderItem.id; ante dos líneas del mismo SKU se falla cerrado.
 */
const resolvePurchaseOrderItemIdentity = (
    purchaseItem: LockedPurchaseItemRow,
    orderLines: LockedOrderLineRow[],
): string => {
    if (purchaseItem.purchaseOrderItemId) {
        const referenced = orderLines.find((line) => line.id === purchaseItem.purchaseOrderItemId);
        if (!referenced || referenced.productId !== purchaseItem.productId) {
            throw new ProcurementMatchError(
                'PURCHASE_ORDER_LINE_MISMATCH',
                409,
                'La línea indicada no pertenece a la orden o al producto facturado',
                {
                    purchaseItemId: purchaseItem.id,
                    purchaseOrderItemId: purchaseItem.purchaseOrderItemId,
                },
            );
        }
        return referenced.id;
    }

    const candidates = orderLines.filter((line) => line.productId === purchaseItem.productId);
    if (candidates.length === 0) {
        throw new ProcurementMatchError(
            'INVOICE_LINE_OUTSIDE_PURCHASE_ORDER',
            409,
            'Una línea de factura no pertenece a esta orden de compra',
            { purchaseItemId: purchaseItem.id },
        );
    }
    if (candidates.length > 1) {
        throw new ProcurementMatchError(
            'AMBIGUOUS_PURCHASE_ORDER_LINE',
            409,
            'La factura debe indicar la línea exacta de la OC porque el producto aparece más de una vez',
            { purchaseItemId: purchaseItem.id },
        );
    }
    return candidates[0].id;
};

/**
 * Ejecuta el matching dentro de la MISMA transacción que crea la compra. El
 * caller debe invocarlo antes de billetera, Expense, asiento o cualquier otro
 * efecto. CASH fuera de tolerancia lanza 409 y revierte la factura completa.
 */
export async function executeProcurementMatch({
    tx,
    tenantId,
    userId,
    purchaseId,
}: {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    purchaseId: string;
}): Promise<ProcurementMatchExecutionResult> {
    const scopedTenantId = tenantId.trim();
    const scopedUserId = userId.trim();
    const scopedPurchaseId = purchaseId.trim();
    if (!scopedTenantId || !scopedUserId || !scopedPurchaseId) {
        throw new ProcurementMatchError(
            'INVALID_MATCH_CONTEXT',
            400,
            'tenantId, userId y purchaseId son obligatorios para conciliar',
        );
    }

    // El primer lock del servicio es la factura. Resolución y matching respetan
    // el mismo orden para no introducir un ciclo de deadlocks.
    const purchaseRows = await tx.$queryRaw<LockedPurchaseRow[]>(Prisma.sql`
        SELECT
            p.\`id\`, p.\`tenantId\`, p.\`supplierId\`, p.\`purchaseOrderId\`,
            p.\`paymentMethod\`, p.\`documentStatus\`, p.\`matchStatus\`, p.\`paymentHold\`,
            p.\`matchResolvedBy\`, p.\`matchResolvedAt\`, p.\`matchResolutionNote\`,
            p.\`matchResolutionClientEventId\`, p.\`matchResolutionPayloadHash\`
        FROM \`Purchase\` p
        WHERE p.\`id\` = ${scopedPurchaseId}
          AND p.\`tenantId\` = ${scopedTenantId}
        LIMIT 1
        FOR UPDATE
    `);
    const purchase = requireSinglePurchase(purchaseRows);

    if (purchase.documentStatus !== 'POSTED') {
        throw new ProcurementMatchError(
            'PURCHASE_DOCUMENT_NOT_POSTED',
            409,
            'Solo una factura posteada puede conciliarse',
        );
    }

    if (!purchase.purchaseOrderId) {
        const plan = calculateProcurementMatch({
            purchaseOrderId: null,
            paymentMethod: purchase.paymentMethod,
            priceTolerancePercent: '0',
            orderLines: [],
            receiptLines: [],
            invoiceLines: [],
        });
        return {
            purchaseId: purchase.id,
            matchStatus: 'NOT_REQUIRED',
            paymentHold: false,
            priceTolerancePct: plan.priceTolerancePercent,
            allocationCount: 0,
            exceptionCount: 0,
            plan,
        };
    }
    if (purchase.matchStatus !== 'NOT_REQUIRED') {
        throw new ProcurementMatchError(
            'MATCH_ALREADY_EXECUTED',
            409,
            'La factura ya tiene un resultado de conciliación',
        );
    }

    // Una sola fila de OC serializa todas las facturas concurrentes que compiten
    // por sus recepciones, incluso cuando cada factura tiene un id diferente.
    const orderRows = await tx.$queryRaw<LockedOrderRow[]>(Prisma.sql`
        SELECT po.\`id\`, po.\`supplierId\`
        FROM \`PurchaseOrder\` po
        WHERE po.\`id\` = ${purchase.purchaseOrderId}
          AND po.\`tenantId\` = ${scopedTenantId}
        LIMIT 1
        FOR UPDATE
    `);
    const order = orderRows[0];
    if (!order) {
        throw new ProcurementMatchError(
            'PURCHASE_ORDER_NOT_FOUND',
            404,
            'Orden de compra no encontrada para la conciliación',
        );
    }
    if (order.supplierId !== purchase.supplierId) {
        throw new ProcurementMatchError(
            'PURCHASE_ORDER_SUPPLIER_MISMATCH',
            409,
            'La factura y la orden pertenecen a proveedores distintos',
        );
    }

    const purchaseItems = await tx.$queryRaw<LockedPurchaseItemRow[]>(Prisma.sql`
        SELECT
            pi.\`id\`, pi.\`productId\`, pi.\`quantity\`, pi.\`quantityExact\`,
            pi.\`unitCost\`, pi.\`unitCostExact\`, pi.\`purchaseOrderItemId\`
        FROM \`PurchaseItem\` pi
        WHERE pi.\`purchaseId\` = ${purchase.id}
        ORDER BY pi.\`id\` ASC
        FOR UPDATE
    `);
    if (purchaseItems.length === 0) {
        throw new ProcurementMatchError(
            'EMPTY_MATCH_LINES',
            400,
            'La conciliación requiere líneas de factura',
        );
    }

    const orderLines = await tx.$queryRaw<LockedOrderLineRow[]>(Prisma.sql`
        SELECT
            poi.\`id\`, poi.\`productId\`, poi.\`quantityOrdered\`,
            poi.\`quantityOrderedExact\`, poi.\`quantityReceived\`,
            poi.\`quantityReceivedExact\`, poi.\`unitCost\`, poi.\`unitCostExact\`
        FROM \`PurchaseOrderItem\` poi
        WHERE poi.\`purchaseOrderId\` = ${order.id}
        ORDER BY poi.\`id\` ASC
        FOR UPDATE
    `);
    if (orderLines.length === 0) {
        throw new ProcurementMatchError(
            'EMPTY_PURCHASE_ORDER',
            409,
            'La orden de compra no contiene líneas conciliables',
        );
    }

    const resolvedOrderLineByPurchaseItem = new Map<string, string>();
    const purchaseItemHadExplicitOrderLine = new Map<string, boolean>();
    for (const item of purchaseItems) {
        purchaseItemHadExplicitOrderLine.set(item.id, item.purchaseOrderItemId !== null);
        resolvedOrderLineByPurchaseItem.set(
            item.id,
            resolvePurchaseOrderItemIdentity(item, orderLines),
        );
    }

    const receiptItems = await tx.$queryRaw<LockedReceiptItemRow[]>(Prisma.sql`
        SELECT
            gri.\`id\`, gri.\`purchaseOrderItemId\`, gri.\`quantityExact\`,
            gr.\`receivedAt\`
        FROM \`GoodsReceiptItem\` gri
        INNER JOIN \`GoodsReceipt\` gr
            ON gr.\`id\` = gri.\`goodsReceiptId\`
           AND gr.\`tenantId\` = ${scopedTenantId}
           AND gr.\`status\` = 'POSTED'
        WHERE gri.\`tenantId\` = ${scopedTenantId}
          AND gr.\`purchaseOrderId\` = ${order.id}
        ORDER BY gr.\`receivedAt\` ASC, gri.\`id\` ASC
        FOR UPDATE
    `);

    const orderLineIds = orderLines.map((line) => line.id);
    const priorAllocations = await tx.$queryRaw<LockedAllocationRow[]>(Prisma.sql`
        SELECT
            pma.\`goodsReceiptItemId\`, pma.\`purchaseOrderItemId\`,
            pma.\`source\`, pma.\`quantityExact\`
        FROM \`PurchaseMatchAllocation\` pma
        WHERE pma.\`tenantId\` = ${scopedTenantId}
          AND pma.\`purchaseOrderItemId\` IN (${Prisma.join(orderLineIds)})
        ORDER BY pma.\`id\` ASC
        FOR UPDATE
    `);
    const allocatedByReceipt = new Map<string, Decimal>();
    const legacyAllocatedByOrderLine = new Map<string, Decimal>();
    for (const allocation of priorAllocations) {
        if (allocation.source === 'LEGACY_PROJECTION' || allocation.goodsReceiptItemId === null) {
            legacyAllocatedByOrderLine.set(
                allocation.purchaseOrderItemId,
                (legacyAllocatedByOrderLine.get(allocation.purchaseOrderItemId) ?? new Decimal(0))
                    .plus(asDecimalString(allocation.quantityExact)),
            );
        } else {
            allocatedByReceipt.set(
                allocation.goodsReceiptItemId,
                (allocatedByReceipt.get(allocation.goodsReceiptItemId) ?? new Decimal(0))
                    .plus(asDecimalString(allocation.quantityExact)),
            );
        }
    }

    const formalReceivedByOrderLine = new Map<string, Decimal>();
    for (const receipt of receiptItems) {
        formalReceivedByOrderLine.set(
            receipt.purchaseOrderItemId,
            (formalReceivedByOrderLine.get(receipt.purchaseOrderItemId) ?? new Decimal(0))
                .plus(asDecimalString(receipt.quantityExact)),
        );
    }
    const legacyProjectionByOrderLine = new Map<string, Decimal>();
    for (const line of orderLines) {
        const receivedShadow = new Decimal(asDecimalString(
            line.quantityReceivedExact ?? line.quantityReceived,
        ));
        const formalReceived = formalReceivedByOrderLine.get(line.id) ?? new Decimal(0);
        if (formalReceived.greaterThan(receivedShadow)) {
            throw new ProcurementMatchError(
                'RECEIPT_PROJECTION_MISMATCH',
                409,
                'Las recepciones formales exceden el acumulado de la orden y requieren conciliación',
                { purchaseOrderItemId: line.id },
            );
        }
        const legacyProjection = receivedShadow.minus(formalReceived);
        if (legacyProjection.greaterThan(0)) legacyProjectionByOrderLine.set(line.id, legacyProjection);
    }
    for (const item of purchaseItems) {
        const orderLineId = resolvedOrderLineByPurchaseItem.get(item.id)!;
        if (legacyProjectionByOrderLine.has(orderLineId)
            && !purchaseItemHadExplicitOrderLine.get(item.id)) {
            throw new ProcurementMatchError(
                'LEGACY_RECEIPT_REQUIRES_ORDER_LINE_ID',
                409,
                'La factura debe indicar la línea exacta de la OC para usar una recepción histórica',
                { purchaseItemId: item.id },
            );
        }
    }

    const policyRows = await tx.$queryRaw<LockedPolicyRow[]>(Prisma.sql`
        SELECT pp.\`priceTolerancePct\`
        FROM \`ProcurementPolicy\` pp
        WHERE pp.\`tenantId\` = ${scopedTenantId}
        LIMIT 1
        FOR UPDATE
    `);
    // Ausencia de política = tolerancia cero (fail-closed, sin sembrar en lectura).
    const priceTolerancePct = policyRows[0]?.priceTolerancePct ?? '0';

    const plan = calculateProcurementMatch({
        purchaseOrderId: order.id,
        paymentMethod: purchase.paymentMethod,
        priceTolerancePercent: asDecimalString(priceTolerancePct),
        orderLines: orderLines.map((line) => ({
            id: line.id,
            orderedQuantity: asDecimalString(line.quantityOrderedExact ?? line.quantityOrdered),
            orderedUnitCost: asDecimalString(line.unitCostExact ?? line.unitCost),
        })),
        receiptLines: [
            ...receiptItems.map((line) => ({
                id: line.id,
                goodsReceiptItemId: line.id,
                source: 'FORMAL_RECEIPT' as const,
                purchaseOrderItemId: line.purchaseOrderItemId,
                acceptedQuantity: asDecimalString(line.quantityExact),
                allocatedQuantity: allocatedByReceipt.get(line.id)?.toString() ?? '0',
                receivedAt: line.receivedAt,
            })),
            ...orderLines.flatMap((line) => {
                const projected = legacyProjectionByOrderLine.get(line.id);
                if (!projected) return [];
                return [{
                    id: `legacy:${line.id}`,
                    goodsReceiptItemId: null,
                    source: 'LEGACY_PROJECTION' as const,
                    purchaseOrderItemId: line.id,
                    acceptedQuantity: projected.toString(),
                    allocatedQuantity: legacyAllocatedByOrderLine.get(line.id)?.toString() ?? '0',
                    // La proyección precede a toda recepción formal del rollout.
                    receivedAt: new Date(0),
                }];
            }),
        ],
        invoiceLines: purchaseItems.map((line) => ({
            key: line.id,
            purchaseOrderItemId: resolvedOrderLineByPurchaseItem.get(line.id)!,
            quantity: asDecimalString(line.quantityExact ?? line.quantity),
            unitCost: asDecimalString(line.unitCostExact ?? line.unitCost),
        })),
    });

    const identityCases = plan.lines.map((line) =>
        Prisma.sql`WHEN ${line.invoiceLineKey} THEN ${line.purchaseOrderItemId}`);
    const expectedCostCases = plan.lines.map((line) =>
        Prisma.sql`WHEN ${line.invoiceLineKey} THEN ${line.orderedUnitCost}`);
    const actualCostCases = plan.lines.map((line) =>
        Prisma.sql`WHEN ${line.invoiceLineKey} THEN ${line.invoiceUnitCost}`);
    const varianceCases = plan.lines.map((line) =>
        Prisma.sql`WHEN ${line.invoiceLineKey} THEN ${line.priceVarianceExact}`);
    const purchaseItemIds = plan.lines.map((line) => line.invoiceLineKey);
    const updatedItems = await tx.$executeRaw(Prisma.sql`
        UPDATE \`PurchaseItem\`
        SET
            \`purchaseOrderItemId\` = CASE \`id\`
                ${Prisma.join(identityCases, ' ')}
                ELSE \`purchaseOrderItemId\`
            END,
            \`expectedUnitCostExact\` = CASE \`id\`
                ${Prisma.join(expectedCostCases, ' ')}
                ELSE \`expectedUnitCostExact\`
            END,
            \`unitCostExact\` = CASE \`id\`
                ${Prisma.join(actualCostCases, ' ')}
                ELSE \`unitCostExact\`
            END,
            \`priceVarianceExact\` = CASE \`id\`
                ${Prisma.join(varianceCases, ' ')}
                ELSE \`priceVarianceExact\`
            END
        WHERE \`purchaseId\` = ${purchase.id}
          AND \`id\` IN (${Prisma.join(purchaseItemIds)})
    `);
    if (updatedItems !== purchaseItems.length) {
        throw new ProcurementMatchError(
            'PURCHASE_ITEM_CONCURRENT_UPDATE_FAILED',
            409,
            'No se pudieron congelar todas las líneas de conciliación',
        );
    }

    if (plan.allocations.length > 0) {
        await tx.purchaseMatchAllocation.createMany({
            data: plan.allocations.map((allocation) => ({
                tenantId: scopedTenantId,
                purchaseItemId: allocation.invoiceLineKey,
                purchaseOrderItemId: allocation.purchaseOrderItemId,
                goodsReceiptItemId: allocation.goodsReceiptItemId,
                source: allocation.source,
                quantityExact: allocation.quantity,
                expectedUnitCostExact: allocation.expectedUnitCostExact,
                actualUnitCostExact: allocation.actualUnitCostExact,
                priceVarianceExact: allocation.priceVarianceExact,
            })),
        });
    }

    const priceExceptionLines = plan.lines.filter((line) => !line.withinPriceTolerance);
    const legacyExceptionLines = plan.lines.filter((line) => line.usesLegacyProjection);
    const exceptionData = [
        ...priceExceptionLines.map((line) => ({
            tenantId: scopedTenantId,
            purchaseId: purchase.id,
            purchaseItemId: line.invoiceLineKey,
            type: 'PRICE_VARIANCE',
            status: 'OPEN',
            expectedValueExact: line.orderedUnitCost,
            actualValueExact: line.invoiceUnitCost,
            varianceExact: line.unitCostVariance,
            toleranceExact: line.allowedUnitCostVariance,
        })),
        ...legacyExceptionLines.map((line) => ({
            tenantId: scopedTenantId,
            purchaseId: purchase.id,
            purchaseItemId: line.invoiceLineKey,
            type: 'LEGACY_RECEIPT_TRACE',
            status: 'OPEN',
            expectedValueExact: line.requestedQuantity,
            actualValueExact: line.allocations
                .filter((allocation) => allocation.source === 'LEGACY_PROJECTION')
                .reduce((sum, allocation) => sum.plus(allocation.quantity), new Decimal(0))
                .toFixed(4),
            varianceExact: null,
            toleranceExact: null,
        })),
    ];
    if (exceptionData.length > 0) {
        await tx.purchaseMatchException.createMany({
            data: exceptionData,
        });
    }

    const purchaseUpdate = await tx.purchase.updateMany({
        where: {
            id: purchase.id,
            tenantId: scopedTenantId,
            matchStatus: 'NOT_REQUIRED',
        },
        data: {
            matchStatus: plan.status,
            // El contrato F2 retiene siempre una excepción de precio a crédito.
            paymentHold: plan.paymentHold,
        },
    });
    if (purchaseUpdate.count !== 1) {
        throw new ProcurementMatchError(
            'PURCHASE_MATCH_CONCURRENT_UPDATE_FAILED',
            409,
            'La factura cambió durante la conciliación',
        );
    }

    await tx.auditLog.create({
        data: {
            tenantId: scopedTenantId,
            userId: scopedUserId,
            action: plan.status === 'MATCHED'
                ? 'PURCHASE_THREE_WAY_MATCHED'
                : 'PURCHASE_MATCH_EXCEPTION_CREATED',
            details: JSON.stringify({
                purchaseId: purchase.id,
                purchaseOrderId: order.id,
                before: {
                    matchStatus: purchase.matchStatus,
                    paymentHold: bool(purchase.paymentHold),
                },
                after: {
                    matchStatus: plan.status,
                    paymentHold: plan.paymentHold,
                },
                priceTolerancePct: plan.priceTolerancePercent,
                expectedAmount: plan.expectedAmount,
                invoiceAmount: plan.invoiceAmount,
                varianceAmount: plan.varianceAmount,
                allocationCount: plan.allocations.length,
                exceptionCount: exceptionData.length,
            }),
        },
    });

    return {
        purchaseId: purchase.id,
        matchStatus: plan.status,
        paymentHold: plan.paymentHold,
        priceTolerancePct: plan.priceTolerancePercent,
        allocationCount: plan.allocations.length,
        exceptionCount: exceptionData.length,
        plan,
    };
}

export interface ProcurementMatchListQuery {
    status?: ProcurementMatchStatus;
    supplierId?: string;
    purchaseOrderId?: string;
    paymentHold?: boolean;
    cursor?: string;
    limit?: number;
}

interface MatchCursor {
    date: string;
    id: string;
}

const encodeCursor = (cursor: MatchCursor): string =>
    Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeProcurementMatchCursor = (cursor: string): MatchCursor => {
    try {
        if (cursor.length > 512) throw new Error('cursor demasiado largo');
        const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null) throw new Error('cursor inválido');
        const candidate = parsed as Partial<MatchCursor>;
        if (typeof candidate.id !== 'string' || !candidate.id.trim()
            || typeof candidate.date !== 'string') throw new Error('cursor inválido');
        const date = new Date(candidate.date);
        if (Number.isNaN(date.getTime())) throw new Error('fecha inválida');
        return { id: candidate.id, date: date.toISOString() };
    } catch {
        throw new ProcurementMatchError(
            'INVALID_MATCH_CURSOR',
            400,
            'El cursor de conciliación no es válido',
        );
    }
};

const serializeListPurchase = (purchase: {
    id: string;
    invoiceNumber: string;
    date: Date;
    postingDate: Date | null;
    documentStatus: string;
    matchStatus: string;
    paymentHold: boolean;
    total: DecimalInput;
    balanceDue: DecimalInput | null;
    supplier: { id: string; name: string };
    purchaseOrder: { id: string; orderNumber: string } | null;
    items: Array<{
        quantity: DecimalInput;
        quantityExact: DecimalInput | null;
        unitCost: DecimalInput;
        unitCostExact: DecimalInput | null;
        expectedUnitCostExact: DecimalInput | null;
    }>;
    _count: { matchExceptions: number };
}) => {
    const postedAmounts = postedAmountsFromPurchaseItems(purchase.items);
    return ({
        id: purchase.id,
        invoiceNumber: purchase.invoiceNumber,
        date: purchase.date.toISOString(),
        postingDate: purchase.postingDate?.toISOString() ?? null,
        documentStatus: purchase.documentStatus,
        matchStatus: purchase.matchStatus,
        paymentHold: purchase.paymentHold,
        total: asDecimalString(purchase.total),
        balanceDue: purchase.balanceDue == null ? null : asDecimalString(purchase.balanceDue),
        supplier: purchase.supplier,
        purchaseOrder: purchase.purchaseOrder,
        openExceptionCount: purchase._count.matchExceptions,
        varianceAmount: postedAmounts.varianceAmount,
    });
};

export async function listProcurementMatches(
    db: PrismaClient,
    tenantId: string,
    query: ProcurementMatchListQuery,
) {
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? decodeProcurementMatchCursor(query.cursor) : null;
    const cursorDate = cursor ? new Date(cursor.date) : null;
    const where: Prisma.PurchaseWhereInput = {
        tenantId,
        documentStatus: 'POSTED',
        ...(query.status ? { matchStatus: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
        ...(query.paymentHold === undefined ? {} : { paymentHold: query.paymentHold }),
        ...(cursor && cursorDate ? {
            OR: [
                { date: { lt: cursorDate } },
                { date: cursorDate, id: { lt: cursor.id } },
            ],
        } : {}),
    };
    const rows = await db.purchase.findMany({
        where,
        select: {
            id: true,
            invoiceNumber: true,
            date: true,
            postingDate: true,
            documentStatus: true,
            matchStatus: true,
            paymentHold: true,
            total: true,
            balanceDue: true,
            supplier: { select: { id: true, name: true } },
            purchaseOrder: { select: { id: true, orderNumber: true } },
            items: {
                select: {
                    quantity: true,
                    quantityExact: true,
                    unitCost: true,
                    unitCostExact: true,
                    expectedUnitCostExact: true,
                },
            },
            _count: {
                select: { matchExceptions: { where: { status: 'OPEN' } } },
            },
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
        data: pageRows.map(serializeListPurchase),
        pageInfo: {
            nextCursor: hasMore && last
                ? encodeCursor({ date: last.date.toISOString(), id: last.id })
                : null,
        },
    };
}

export async function getProcurementMatchDetail(
    db: PrismaClient,
    tenantId: string,
    purchaseId: string,
) {
    const purchase = await db.purchase.findFirst({
        where: { id: purchaseId, tenantId, documentStatus: 'POSTED' },
        select: {
            id: true,
            invoiceNumber: true,
            date: true,
            postingDate: true,
            documentStatus: true,
            matchStatus: true,
            paymentHold: true,
            total: true,
            balanceDue: true,
            matchResolvedBy: true,
            matchResolvedAt: true,
            matchResolutionNote: true,
            supplier: { select: { id: true, name: true } },
            purchaseOrder: { select: { id: true, orderNumber: true } },
            items: {
                select: {
                    id: true,
                    productId: true,
                    productName: true,
                    purchaseOrderItemId: true,
                    quantity: true,
                    quantityExact: true,
                    unitCost: true,
                    unitCostExact: true,
                    expectedUnitCostExact: true,
                    priceVarianceExact: true,
                },
                orderBy: { id: 'asc' },
            },
        },
    });
    if (!purchase) {
        throw new ProcurementMatchError('PURCHASE_NOT_FOUND', 404, 'Compra no encontrada');
    }

    const purchaseItemIds = purchase.items.map((item) => item.id);
    const allocations = purchaseItemIds.length === 0
        ? []
        : await db.purchaseMatchAllocation.findMany({
            where: { tenantId, purchaseItemId: { in: purchaseItemIds } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
    const exceptions = await db.purchaseMatchException.findMany({
        where: { tenantId, purchaseId: purchase.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const allocationsByItem = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
        const current = allocationsByItem.get(allocation.purchaseItemId) ?? [];
        current.push(allocation);
        allocationsByItem.set(allocation.purchaseItemId, current);
    }

    // Los importes posteados se derivan por línea de factura, no por allocation:
    // una sola línea puede repartirse entre varias recepciones y solo se redondea
    // una vez, igual que PurchaseItem.totalCost y el asiento.
    const postedAmounts = postedAmountsFromPurchaseItems(purchase.items);

    return {
        purchase: {
            id: purchase.id,
            invoiceNumber: purchase.invoiceNumber,
            date: purchase.date.toISOString(),
            postingDate: purchase.postingDate?.toISOString() ?? null,
            documentStatus: purchase.documentStatus,
            matchStatus: purchase.matchStatus,
            paymentHold: purchase.paymentHold,
            total: purchase.total.toString(),
            balanceDue: purchase.balanceDue?.toString() ?? null,
            matchResolvedBy: purchase.matchResolvedBy,
            matchResolvedAt: purchase.matchResolvedAt?.toISOString() ?? null,
            matchResolutionNote: purchase.matchResolutionNote,
            supplier: purchase.supplier,
            purchaseOrder: purchase.purchaseOrder,
        },
        lines: purchase.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            purchaseOrderItemId: item.purchaseOrderItemId,
            quantityExact: (item.quantityExact ?? item.quantity).toString(),
            unitCostExact: (item.unitCostExact ?? item.unitCost).toString(),
            expectedUnitCostExact: item.expectedUnitCostExact?.toString() ?? null,
            priceVarianceExact: item.priceVarianceExact?.toString() ?? null,
            allocations: (allocationsByItem.get(item.id) ?? []).map((allocation) => ({
                id: allocation.id,
                goodsReceiptItemId: allocation.goodsReceiptItemId,
                source: allocation.source,
                purchaseOrderItemId: allocation.purchaseOrderItemId,
                quantityExact: allocation.quantityExact.toString(),
                expectedUnitCostExact: allocation.expectedUnitCostExact.toString(),
                actualUnitCostExact: allocation.actualUnitCostExact.toString(),
                priceVarianceExact: allocation.priceVarianceExact.toString(),
                createdAt: allocation.createdAt.toISOString(),
            })),
        })),
        exceptions: exceptions.map((exception) => ({
            id: exception.id,
            purchaseItemId: exception.purchaseItemId,
            type: exception.type,
            status: exception.status,
            expectedValueExact: exception.expectedValueExact?.toString() ?? null,
            actualValueExact: exception.actualValueExact?.toString() ?? null,
            varianceExact: exception.varianceExact?.toString() ?? null,
            toleranceExact: exception.toleranceExact?.toString() ?? null,
            resolutionNote: exception.resolutionNote,
            resolvedBy: exception.resolvedBy,
            resolvedAt: exception.resolvedAt?.toISOString() ?? null,
            createdAt: exception.createdAt.toISOString(),
        })),
        totals: {
            ...postedAmounts,
        },
    };
}

export interface ProcurementMatchResolutionResult {
    data: {
        purchaseId: string;
        matchStatus: 'RESOLVED';
        paymentHold: false;
        matchResolvedBy: string;
        matchResolvedAt: string;
        matchResolutionNote: string;
    };
    replay: boolean;
}

const serializeResolution = (
    purchase: {
        id: string;
        matchResolvedBy: string | null;
        matchResolvedAt: Date | null;
        matchResolutionNote: string | null;
    },
    replay: boolean,
): ProcurementMatchResolutionResult => {
    if (!purchase.matchResolvedBy || !purchase.matchResolvedAt || !purchase.matchResolutionNote) {
        throw new ProcurementMatchError(
            'INVALID_RESOLUTION_STATE',
            409,
            'La resolución guardada está incompleta y requiere conciliación',
        );
    }
    return {
        data: {
            purchaseId: purchase.id,
            matchStatus: 'RESOLVED',
            paymentHold: false,
            matchResolvedBy: purchase.matchResolvedBy,
            matchResolvedAt: purchase.matchResolvedAt.toISOString(),
            matchResolutionNote: purchase.matchResolutionNote,
        },
        replay,
    };
};

const resolutionConflict = (): never => {
    throw new ProcurementMatchError(
        'MATCH_RESOLUTION_IDEMPOTENCY_CONFLICT',
        409,
        'clientEventId ya fue usado para una resolución distinta',
    );
};

export async function executeProcurementMatchResolution({
    tx,
    tenantId,
    userId,
    purchaseId,
    request,
    now = new Date(),
}: {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    purchaseId: string;
    request: ProcurementResolutionRequest;
    now?: Date;
}): Promise<ProcurementMatchResolutionResult> {
    const normalized = normalizeProcurementResolution(purchaseId, request);
    if (Number.isNaN(now.getTime())) {
        throw new ProcurementMatchError('INVALID_RESOLUTION_DATE', 400, 'La fecha de resolución no es válida');
    }

    // Requisito de concurrencia: Purchase es SIEMPRE el primer lock.
    const purchaseRows = await tx.$queryRaw<LockedPurchaseRow[]>(Prisma.sql`
        SELECT
            p.\`id\`, p.\`tenantId\`, p.\`supplierId\`, p.\`purchaseOrderId\`,
            p.\`paymentMethod\`, p.\`documentStatus\`, p.\`matchStatus\`, p.\`paymentHold\`,
            p.\`matchResolvedBy\`, p.\`matchResolvedAt\`, p.\`matchResolutionNote\`,
            p.\`matchResolutionClientEventId\`, p.\`matchResolutionPayloadHash\`
        FROM \`Purchase\` p
        WHERE p.\`id\` = ${purchaseId.trim()}
          AND p.\`tenantId\` = ${tenantId.trim()}
        LIMIT 1
        FOR UPDATE
    `);
    const purchase = requireSinglePurchase(purchaseRows);

    if (purchase.documentStatus !== 'POSTED') {
        throw new ProcurementMatchError(
            'PURCHASE_DOCUMENT_NOT_POSTED',
            409,
            'Solo una factura posteada puede liberar una retención de conciliación',
        );
    }

    if (purchase.matchResolutionClientEventId === normalized.clientEventId) {
        if (purchase.matchResolutionPayloadHash !== normalized.payloadHash) resolutionConflict();
        return serializeResolution(purchase, true);
    }
    if (purchase.matchResolutionClientEventId || purchase.matchStatus === 'RESOLVED') {
        resolutionConflict();
    }
    if (purchase.matchStatus !== 'EXCEPTION' || !bool(purchase.paymentHold)) {
        throw new ProcurementMatchError(
            'PURCHASE_MATCH_NOT_RESOLVABLE',
            409,
            'La factura no tiene una excepción de conciliación retenida',
        );
    }

    const usedEvent = await tx.purchase.findFirst({
        where: {
            tenantId: tenantId.trim(),
            matchResolutionClientEventId: normalized.clientEventId,
        },
        select: { id: true, matchResolutionPayloadHash: true },
    });
    if (usedEvent) resolutionConflict();

    const openExceptions = await tx.purchaseMatchException.findMany({
        where: { tenantId: tenantId.trim(), purchaseId: purchase.id, status: 'OPEN' },
        select: { id: true },
        take: 500,
    });
    if (openExceptions.length === 0) {
        throw new ProcurementMatchError(
            'MATCH_EXCEPTION_NOT_FOUND',
            409,
            'La factura retenida no tiene excepciones abiertas verificables',
        );
    }

    const resolvedExceptions = await tx.purchaseMatchException.updateMany({
        where: { tenantId: tenantId.trim(), purchaseId: purchase.id, status: 'OPEN' },
        data: {
            status: 'RESOLVED',
            resolutionNote: normalized.reason,
            resolvedBy: userId.trim(),
            resolvedAt: now,
        },
    });
    if (resolvedExceptions.count !== openExceptions.length) {
        throw new ProcurementMatchError(
            'MATCH_RESOLUTION_CONCURRENT_UPDATE_FAILED',
            409,
            'Las excepciones cambiaron durante la resolución',
        );
    }

    const updated = await tx.purchase.updateMany({
        where: {
            id: purchase.id,
            tenantId: tenantId.trim(),
            matchStatus: 'EXCEPTION',
            paymentHold: true,
            matchResolutionClientEventId: null,
        },
        data: {
            matchStatus: 'RESOLVED',
            paymentHold: false,
            matchResolvedBy: userId.trim(),
            matchResolvedAt: now,
            matchResolutionNote: normalized.reason,
            matchResolutionClientEventId: normalized.clientEventId,
            matchResolutionPayloadHash: normalized.payloadHash,
        },
    });
    if (updated.count !== 1) {
        throw new ProcurementMatchError(
            'MATCH_RESOLUTION_CONCURRENT_UPDATE_FAILED',
            409,
            'La factura cambió durante la resolución',
        );
    }

    await tx.auditLog.create({
        data: {
            tenantId: tenantId.trim(),
            userId: userId.trim(),
            action: 'PURCHASE_MATCH_RESOLVED',
            details: JSON.stringify({
                purchaseId: purchase.id,
                before: { matchStatus: purchase.matchStatus, paymentHold: true },
                after: { matchStatus: 'RESOLVED', paymentHold: false },
                reason: normalized.reason,
                resolvedExceptionCount: resolvedExceptions.count,
                clientEventId: normalized.clientEventId,
            }),
        },
    });

    return serializeResolution({
        id: purchase.id,
        matchResolvedBy: userId.trim(),
        matchResolvedAt: now,
        matchResolutionNote: normalized.reason,
    }, false);
}

export async function resolveProcurementMatchTransaction({
    db,
    tenantId,
    userId,
    purchaseId,
    request,
}: {
    db: PrismaClient;
    tenantId: string;
    userId: string;
    purchaseId: string;
    request: ProcurementResolutionRequest;
}): Promise<ProcurementMatchResolutionResult> {
    const normalized = normalizeProcurementResolution(purchaseId, request);
    try {
        return await db.$transaction((tx) => executeProcurementMatchResolution({
            tx,
            tenantId,
            userId,
            purchaseId,
            request,
        }));
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await db.purchase.findFirst({
            where: {
                tenantId: tenantId.trim(),
                matchResolutionClientEventId: normalized.clientEventId,
            },
            select: {
                id: true,
                matchResolvedBy: true,
                matchResolvedAt: true,
                matchResolutionNote: true,
                matchResolutionPayloadHash: true,
            },
        });
        if (!existing
            || existing.id !== purchaseId.trim()
            || existing.matchResolutionPayloadHash !== normalized.payloadHash) {
            resolutionConflict();
        }
        return serializeResolution(existing, true);
    }
}

export function createProcurementMatchService(db: PrismaClient = prisma) {
    return {
        list: (tenantId: string, query: ProcurementMatchListQuery) =>
            listProcurementMatches(db, tenantId, query),
        detail: (tenantId: string, purchaseId: string) =>
            getProcurementMatchDetail(db, tenantId, purchaseId),
        resolve: (
            tenantId: string,
            userId: string,
            purchaseId: string,
            request: ProcurementResolutionRequest,
        ) => resolveProcurementMatchTransaction({
            db,
            tenantId,
            userId,
            purchaseId,
            request,
        }),
    };
}
