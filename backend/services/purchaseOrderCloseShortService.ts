import { Prisma, type PrismaClient } from '@prisma/client';
import {
    assertMatchingPurchaseOrderCloseShortReplay,
    buildPurchaseOrderCloseShortPayloadHash,
    derivePurchaseOrderFulfillmentStatus,
    normalizePurchaseOrderCloseShortLines,
    normalizePurchaseOrderCloseShortRequest,
    PurchaseOrderCloseShortError,
    type CloseShortPurchaseOrderItemAuthority,
    type PurchaseOrderCloseShortRequest,
} from '../lib/purchaseOrderCloseShort';

type PrismaTx = Prisma.TransactionClient;
type DecimalValue = Prisma.Decimal | number | string;

interface LockedPurchaseOrderRow {
    id: string;
}

interface PurchaseOrderItemState extends CloseShortPurchaseOrderItemAuthority {
    purchaseOrderId: string;
    quantityOrdered: DecimalValue;
    quantityReceived: DecimalValue;
    quantityOrderedExact: DecimalValue | null;
    quantityReceivedExact: DecimalValue | null;
    quantityRejectedExact: DecimalValue | null;
    quantityClosedShortExact: DecimalValue | null;
    unitAtOrder: string | null;
    saleModeAtOrder: string | null;
    quantityStepAtOrder: DecimalValue | null;
    unitCost: DecimalValue;
    unitCostExact: DecimalValue | null;
}

interface PurchaseOrderState {
    id: string;
    tenantId: string;
    supplierId: string;
    orderNumber: string;
    status: string;
    notes: string | null;
    expectedDate: Date | null;
    createdBy: string;
    approvedBy: string | null;
    approvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    items: PurchaseOrderItemState[];
}

interface ProductAuthority {
    id: string;
    name: string;
    unit: string;
    saleMode: string | null;
    quantityStep: DecimalValue | null;
}

export interface SerializedCloseShortPurchaseOrderItem {
    id: string;
    purchaseOrderId: string;
    productId: string;
    productName: string;
    quantityOrdered: number;
    quantityReceived: number;
    quantityOrderedExact: string | null;
    quantityReceivedExact: string | null;
    quantityRejectedExact: string | null;
    quantityClosedShortExact: string | null;
    unitAtOrder: string | null;
    saleModeAtOrder: string | null;
    quantityStepAtOrder: string | null;
    unitCost: string;
    unitCostExact: string | null;
}

export interface SerializedCloseShortPurchaseOrder {
    id: string;
    tenantId: string;
    supplierId: string;
    orderNumber: string;
    status: string;
    notes: string | null;
    expectedDate: string | null;
    createdBy: string;
    approvedBy: string | null;
    approvedAt: string | null;
    createdAt: string;
    updatedAt: string;
    items: SerializedCloseShortPurchaseOrderItem[];
}

export interface SerializedPurchaseOrderCloseShort {
    id: string;
    purchaseOrderId: string;
    status: string;
    clientEventId: string;
    closedBy: string;
    closedAt: string;
    createdAt: string;
    lineCount: number;
    closedLineCount: number;
    hasSupplierFault: boolean;
    reasonSummaryCode: string | null;
    note: string | null;
    creator: { id: string; name: string };
    items: Array<{
        id: string;
        purchaseOrderItemId: string;
        quantityExact: string;
        reasonCode: string;
        supplierFault: boolean | null;
        note: string | null;
        orderedQuantitySnapshotExact: string;
        acceptedQuantitySnapshotExact: string;
        rejectedQuantitySnapshotExact: string;
        remainingBeforeExact: string;
        remainingAfterExact: string;
        unitSnapshot: string;
        saleModeSnapshot: string | null;
        quantityStepSnapshot: string | null;
        createdAt: string;
    }>;
}

export interface PurchaseOrderCloseShortResult {
    purchaseOrder: SerializedCloseShortPurchaseOrder;
    closeShort: SerializedPurchaseOrderCloseShort;
    replay: boolean;
}

export interface ExecutePurchaseOrderCloseShortInput {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    purchaseOrderId: string;
    request: PurchaseOrderCloseShortRequest;
    now?: Date;
}

export interface ExecutePurchaseOrderCloseShortTransactionInput
    extends Omit<ExecutePurchaseOrderCloseShortInput, 'tx'> {
    db: PrismaClient;
}

const closeShortInclude = Prisma.validator<Prisma.PurchaseOrderCloseShortInclude>()({
    creator: { select: { id: true, name: true } },
    items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    purchaseOrder: { include: { items: true } },
});

type CloseShortWithRelations = Prisma.PurchaseOrderCloseShortGetPayload<{
    include: typeof closeShortInclude;
}>;

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === 'P2002'
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === 'P2002';

const serializePurchaseOrder = (order: PurchaseOrderState): SerializedCloseShortPurchaseOrder => ({
    id: order.id,
    tenantId: order.tenantId,
    supplierId: order.supplierId,
    orderNumber: order.orderNumber,
    status: order.status,
    notes: order.notes,
    expectedDate: order.expectedDate?.toISOString() ?? null,
    createdBy: order.createdBy,
    approvedBy: order.approvedBy,
    approvedAt: order.approvedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map(item => ({
        id: item.id,
        purchaseOrderId: item.purchaseOrderId,
        productId: item.productId,
        productName: item.productName,
        quantityOrdered: Number(item.quantityOrdered),
        quantityReceived: Number(item.quantityReceived),
        quantityOrderedExact: item.quantityOrderedExact?.toString() ?? null,
        quantityReceivedExact: item.quantityReceivedExact?.toString() ?? null,
        quantityRejectedExact: item.quantityRejectedExact?.toString() ?? null,
        quantityClosedShortExact: item.quantityClosedShortExact?.toString() ?? null,
        unitAtOrder: item.unitAtOrder,
        saleModeAtOrder: item.saleModeAtOrder,
        quantityStepAtOrder: item.quantityStepAtOrder?.toString() ?? null,
        unitCost: item.unitCost.toString(),
        unitCostExact: item.unitCostExact?.toString() ?? null,
    })),
});

const serializeCloseShort = (closeShort: CloseShortWithRelations): SerializedPurchaseOrderCloseShort => ({
    id: closeShort.id,
    purchaseOrderId: closeShort.purchaseOrderId,
    status: closeShort.status,
    clientEventId: closeShort.clientEventId,
    closedBy: closeShort.closedBy,
    closedAt: closeShort.closedAt.toISOString(),
    createdAt: closeShort.createdAt.toISOString(),
    lineCount: closeShort.lineCount,
    closedLineCount: closeShort.closedLineCount,
    hasSupplierFault: closeShort.hasSupplierFault,
    reasonSummaryCode: closeShort.reasonSummaryCode,
    note: closeShort.note,
    creator: closeShort.creator,
    items: closeShort.items.map(item => ({
        id: item.id,
        purchaseOrderItemId: item.purchaseOrderItemId,
        quantityExact: item.quantityExact.toString(),
        reasonCode: item.reasonCode,
        supplierFault: item.supplierFault,
        note: item.note,
        orderedQuantitySnapshotExact: item.orderedQuantitySnapshotExact.toString(),
        acceptedQuantitySnapshotExact: item.acceptedQuantitySnapshotExact.toString(),
        rejectedQuantitySnapshotExact: item.rejectedQuantitySnapshotExact.toString(),
        remainingBeforeExact: item.remainingBeforeExact.toString(),
        remainingAfterExact: item.remainingAfterExact.toString(),
        unitSnapshot: item.unitSnapshot,
        saleModeSnapshot: item.saleModeSnapshot,
        quantityStepSnapshot: item.quantityStepSnapshot?.toString() ?? null,
        createdAt: item.createdAt.toISOString(),
    })),
});

const findCloseShortByClientEvent = async (
    db: Pick<PrismaTx, 'purchaseOrderCloseShort'> | Pick<PrismaClient, 'purchaseOrderCloseShort'>,
    tenantId: string,
    clientEventId: string,
): Promise<CloseShortWithRelations | null> => db.purchaseOrderCloseShort.findFirst({
    where: { tenantId, clientEventId },
    include: closeShortInclude,
});

const expectedPayloadHash = (input: {
    tenantId: string;
    purchaseOrderId: string;
    canonical: ReturnType<typeof normalizePurchaseOrderCloseShortRequest>;
}): string => buildPurchaseOrderCloseShortPayloadHash({
    tenantId: input.tenantId,
    purchaseOrderId: input.purchaseOrderId,
    reasonSummaryCode: input.canonical.reasonSummaryCode,
    note: input.canonical.note,
    lines: input.canonical.lines,
});

const serializeReplay = (
    existing: CloseShortWithRelations,
    payloadHash: string,
): PurchaseOrderCloseShortResult => {
    assertMatchingPurchaseOrderCloseShortReplay(existing, payloadHash);
    return {
        purchaseOrder: serializePurchaseOrder(existing.purchaseOrder as PurchaseOrderState),
        closeShort: serializeCloseShort(existing),
        replay: true,
    };
};

const assertContext = (input: {
    tenantId: string;
    userId: string;
    purchaseOrderId: string;
    now: Date;
}): void => {
    if (!input.tenantId || !input.userId || !input.purchaseOrderId) {
        throw new PurchaseOrderCloseShortError(
            'INVALID_CLOSE_SHORT_CONTEXT',
            400,
            'tenantId, userId y purchaseOrderId son obligatorios',
        );
    }
    if (Number.isNaN(input.now.getTime())) {
        throw new PurchaseOrderCloseShortError(
            'INVALID_CLOSE_SHORT_DATE',
            400,
            'La fecha del cierre corto no es válida',
        );
    }
};

/** Cierra saldos de la OC sin tocar existencias, costo, matching ni dinero. */
export async function executePurchaseOrderCloseShort({
    tx,
    tenantId,
    userId,
    purchaseOrderId,
    request,
    now = new Date(),
}: ExecutePurchaseOrderCloseShortInput): Promise<PurchaseOrderCloseShortResult> {
    const scopedTenantId = tenantId.trim();
    const scopedUserId = userId.trim();
    const scopedPurchaseOrderId = purchaseOrderId.trim();
    const canonical = normalizePurchaseOrderCloseShortRequest(request);
    assertContext({
        tenantId: scopedTenantId,
        userId: scopedUserId,
        purchaseOrderId: scopedPurchaseOrderId,
        now,
    });

    // Primera sentencia de la tx: comparte lock con approve/cancel/receive.
    const lockedRows = await tx.$queryRaw<LockedPurchaseOrderRow[]>(Prisma.sql`
        SELECT \`id\`
        FROM \`PurchaseOrder\`
        WHERE \`id\` = ${scopedPurchaseOrderId}
          AND \`tenantId\` = ${scopedTenantId}
        LIMIT 1
        FOR UPDATE
    `);
    if (lockedRows.length !== 1) {
        throw new PurchaseOrderCloseShortError(
            'PURCHASE_ORDER_NOT_FOUND',
            404,
            'Orden de compra no encontrada',
        );
    }

    const po = await tx.purchaseOrder.findFirst({
        where: { id: scopedPurchaseOrderId, tenantId: scopedTenantId },
        include: { items: true },
    }) as PurchaseOrderState | null;
    if (!po) {
        throw new PurchaseOrderCloseShortError(
            'PURCHASE_ORDER_NOT_FOUND',
            404,
            'Orden de compra no encontrada',
        );
    }

    const actor = await tx.user.findFirst({
        where: {
            id: scopedUserId,
            tenantId: scopedTenantId,
            status: 'ACTIVE',
        },
        select: { id: true },
    });
    if (!actor) {
        throw new PurchaseOrderCloseShortError(
            'CLOSE_SHORT_ACTOR_FORBIDDEN',
            403,
            'El usuario no está activo en este negocio para cerrar la orden',
        );
    }

    const payloadHash = expectedPayloadHash({
        tenantId: scopedTenantId,
        purchaseOrderId: scopedPurchaseOrderId,
        canonical,
    });
    const existing = await findCloseShortByClientEvent(tx, scopedTenantId, canonical.clientEventId);
    if (existing) return serializeReplay(existing, payloadHash);

    if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
        throw new PurchaseOrderCloseShortError(
            'INVALID_PURCHASE_ORDER_STATUS',
            409,
            `No se puede cerrar corto una OC en estado ${po.status}`,
        );
    }

    const productIds = [...new Set(po.items.map(item => item.productId))].sort();
    const products = await tx.product.findMany({
        where: { tenantId: scopedTenantId, id: { in: productIds } },
        select: { id: true, name: true, unit: true, saleMode: true, quantityStep: true },
    }) as ProductAuthority[];
    const normalized = normalizePurchaseOrderCloseShortLines(canonical.lines, po.items, products);

    // El header reclama la idempotencia antes de cualquier proyección de línea.
    const header = await tx.purchaseOrderCloseShort.create({
        data: {
            tenantId: scopedTenantId,
            purchaseOrderId: po.id,
            status: 'POSTED',
            clientEventId: canonical.clientEventId,
            payloadHash,
            closedBy: scopedUserId,
            closedAt: now,
            lineCount: po.items.length,
            closedLineCount: normalized.length,
            hasSupplierFault: normalized.some(line => line.supplierFault === true),
            reasonSummaryCode: canonical.reasonSummaryCode,
            note: canonical.note,
        },
        select: { id: true },
    });

    for (const line of normalized) {
        await tx.purchaseOrderCloseShortItem.create({
            data: {
                tenantId: scopedTenantId,
                closeShortId: header.id,
                purchaseOrderItemId: line.item.id,
                quantityExact: line.quantity,
                reasonCode: line.reasonCode,
                supplierFault: line.supplierFault,
                note: line.note,
                orderedQuantitySnapshotExact: line.ordered.toString(),
                acceptedQuantitySnapshotExact: line.acceptedBefore.toString(),
                rejectedQuantitySnapshotExact: line.rejectedBefore.toString(),
                remainingBeforeExact: line.remainingBefore.toString(),
                remainingAfterExact: line.remainingAfter.toString(),
                unitSnapshot: line.unitSnapshot,
                saleModeSnapshot: line.saleModeSnapshot,
                quantityStepSnapshot: line.quantityStepSnapshot,
            },
        });
        const update = await tx.purchaseOrderItem.updateMany({
            where: { id: line.item.id, purchaseOrderId: po.id },
            data: { quantityClosedShortExact: line.closedShortAfter.toString() },
        });
        if (update.count !== 1) {
            throw new PurchaseOrderCloseShortError(
                'PURCHASE_ORDER_ITEM_UPDATE_FAILED',
                409,
                'No se pudo actualizar una línea bloqueada de la orden',
            );
        }
    }

    const projectedItems = po.items.map((item) => {
        const closed = normalized.find(line => line.item.id === item.id);
        return closed
            ? { ...item, quantityClosedShortExact: closed.closedShortAfter.toString() }
            : item;
    });
    const newStatus = derivePurchaseOrderFulfillmentStatus(projectedItems);
    const statusUpdate = await tx.purchaseOrder.updateMany({
        where: { id: po.id, tenantId: scopedTenantId },
        data: { status: newStatus },
    });
    if (statusUpdate.count !== 1) {
        throw new PurchaseOrderCloseShortError(
            'PURCHASE_ORDER_UPDATE_FAILED',
            409,
            'No se pudo actualizar la orden bloqueada',
        );
    }

    const updated = await tx.purchaseOrder.findFirstOrThrow({
        where: { id: po.id, tenantId: scopedTenantId },
        include: { items: true },
    }) as PurchaseOrderState;

    await tx.auditLog.create({
        data: {
            tenantId: scopedTenantId,
            userId: scopedUserId,
            action: 'PO_CLOSE_SHORT_POSTED',
            details: JSON.stringify({
                purchaseOrderId: po.id,
                orderNumber: po.orderNumber,
                closeShortId: header.id,
                before: {
                    status: po.status,
                    items: normalized.map(line => ({
                        itemId: line.item.id,
                        accepted: line.acceptedBefore.toString(),
                        rejected: line.rejectedBefore.toString(),
                        closedShort: line.closedShortBefore.toString(),
                        remaining: line.remainingBefore.toString(),
                    })),
                },
                after: {
                    status: newStatus,
                    reasonSummaryCode: canonical.reasonSummaryCode,
                    items: normalized.map(line => ({
                        itemId: line.item.id,
                        accepted: line.acceptedBefore.toString(),
                        rejected: line.rejectedBefore.toString(),
                        closedShort: line.closedShortAfter.toString(),
                        remaining: line.remainingAfter.toString(),
                        reasonCode: line.reasonCode,
                        supplierFault: line.supplierFault,
                    })),
                },
            }),
        },
    });

    const closeShort = await tx.purchaseOrderCloseShort.findFirstOrThrow({
        where: { id: header.id, tenantId: scopedTenantId },
        include: closeShortInclude,
    });
    return {
        purchaseOrder: serializePurchaseOrder(updated),
        closeShort: serializeCloseShort(closeShort),
        replay: false,
    };
}

export async function executePurchaseOrderCloseShortTransaction({
    db,
    tenantId,
    userId,
    purchaseOrderId,
    request,
    now,
}: ExecutePurchaseOrderCloseShortTransactionInput): Promise<PurchaseOrderCloseShortResult> {
    const scopedTenantId = tenantId.trim();
    const scopedPurchaseOrderId = purchaseOrderId.trim();
    const canonical = normalizePurchaseOrderCloseShortRequest(request);
    const payloadHash = expectedPayloadHash({
        tenantId: scopedTenantId,
        purchaseOrderId: scopedPurchaseOrderId,
        canonical,
    });

    try {
        return await db.$transaction(
            tx => executePurchaseOrderCloseShort({
                tx,
                tenantId,
                userId,
                purchaseOrderId,
                request,
                now,
            }),
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await findCloseShortByClientEvent(
            db,
            scopedTenantId,
            canonical.clientEventId,
        );
        if (!existing) throw error;
        return serializeReplay(existing, payloadHash);
    }
}
