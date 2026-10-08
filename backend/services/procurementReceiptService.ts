import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
    assertMatchingProcurementReceiptReplay,
    buildProcurementReceiptPayloadHash,
    normalizeProcurementReceiptLines,
    ProcurementReceiptError,
    sortProcurementReceiptExecutionLines,
    summarizeProcurementReceiptInspection,
    type CanonicalProcurementReceiptLine,
    type ProcurementReceiptRequest,
} from '../lib/procurementReceipts';
import {
    closedShortQuantityForPurchaseOrderItem,
    derivePurchaseOrderFulfillmentStatus,
    PurchaseOrderCloseShortError,
    rejectedQuantityForPurchaseOrderItem,
    remainingOpenQuantityForPurchaseOrderItem,
} from '../lib/purchaseOrderCloseShort';
import { normalizeCalendarDateInput } from '../lib/calendarDate';
import {
    applyStockDelta,
    resolveOperationalWarehouse,
    StockError,
    weightedAverageCost,
} from './stockService';
import {
    applyBatchWarehouseDelta,
    resolveBatchWarehouseLedgerMode,
} from './productBatchWarehouseLedgerService.js';
import {
    normalizePurchaseOrderReceiptLines,
    orderedQuantityForItem,
    purchaseOrderRulesForReceipt,
    PurchaseOrderQuantityError,
    receivedQuantityForItem,
} from '../../utils/purchaseOrderQuantities.js';
import { QuantityValidationError, validateQuantity } from '../../utils/quantity.js';

type PrismaTx = Prisma.TransactionClient;
type DecimalValue = Prisma.Decimal | Decimal | number | string;

interface LockedPurchaseOrderRow {
    id: string;
}

interface PurchaseOrderItemState {
    id: string;
    purchaseOrderId: string;
    productId: string;
    productName: string;
    quantityOrdered: number;
    quantityReceived: number;
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
    requiresBatchTracking: boolean;
}

interface ReceiptInventoryResult {
    itemId: string;
    productId: string;
    warehouseId: string;
    quantity: string;
    unitCost: string;
    stockBefore: string;
    stockAfter: string;
    costBefore: string;
    costAfter: string;
    batchId: string | null;
    batchNumber: string | null;
    expiryDate: string | null;
}

export interface SerializedPurchaseOrderItem {
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

export interface SerializedPurchaseOrder {
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
    items: SerializedPurchaseOrderItem[];
}

export interface SerializedGoodsReceipt {
    id: string;
    purchaseOrderId: string;
    warehouseId: string;
    receiptNumber: string;
    status: string;
    supplierDeliveryRef: string | null;
    clientEventId: string;
    payloadVersion: number;
    inspectionOutcome: string;
    inspectedLineCount: number;
    rejectedLineCount: number;
    hasSupplierFault: boolean;
    receivedBy: string;
    receivedAt: string;
    createdAt: string;
    warehouse: { id: string; name: string };
    receiver: { id: string; name: string };
    items: Array<{
        id: string;
        purchaseOrderItemId: string;
        productId: string;
        quantityExact: string;
        deliveredQuantityExact: string | null;
        rejectedQuantityExact: string | null;
        rejectionReasonCode: string | null;
        rejectionNotes: string | null;
        supplierFault: boolean | null;
        unitSnapshot: string;
        saleModeSnapshot: string | null;
        unitCostExact: string;
        batchId: string | null;
        batchNumber: string | null;
        expiryDate: string | null;
        createdAt: string;
    }>;
}

export interface ProcurementReceiptResult {
    purchaseOrder: SerializedPurchaseOrder;
    receipt: SerializedGoodsReceipt;
    replay: boolean;
}

export interface ExecuteProcurementReceiptInput {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    purchaseOrderId: string;
    request: ProcurementReceiptRequest;
    now?: Date;
}

export interface ExecuteProcurementReceiptTransactionInput
    extends Omit<ExecuteProcurementReceiptInput, 'tx'> {
    db: PrismaClient;
}

const receiptInclude = Prisma.validator<Prisma.GoodsReceiptInclude>()({
    warehouse: { select: { id: true, name: true } },
    receiver: { select: { id: true, name: true } },
    items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    purchaseOrder: { include: { items: true } },
});

type ReceiptWithRelations = Prisma.GoodsReceiptGetPayload<{ include: typeof receiptInclude }>;

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === 'P2002'
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === 'P2002';

const serializePurchaseOrder = (order: PurchaseOrderState): SerializedPurchaseOrder => ({
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
        quantityOrdered: item.quantityOrdered,
        quantityReceived: item.quantityReceived,
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

const serializeGoodsReceipt = (receipt: ReceiptWithRelations): SerializedGoodsReceipt => ({
    id: receipt.id,
    purchaseOrderId: receipt.purchaseOrderId,
    warehouseId: receipt.warehouseId,
    receiptNumber: receipt.receiptNumber,
    status: receipt.status,
    supplierDeliveryRef: receipt.supplierDeliveryRef,
    clientEventId: receipt.clientEventId,
    payloadVersion: receipt.payloadVersion,
    inspectionOutcome: receipt.inspectionOutcome,
    inspectedLineCount: receipt.inspectedLineCount,
    rejectedLineCount: receipt.rejectedLineCount,
    hasSupplierFault: receipt.hasSupplierFault,
    receivedBy: receipt.receivedBy,
    receivedAt: receipt.receivedAt.toISOString(),
    createdAt: receipt.createdAt.toISOString(),
    warehouse: receipt.warehouse,
    receiver: receipt.receiver,
    items: receipt.items.map(item => ({
        id: item.id,
        purchaseOrderItemId: item.purchaseOrderItemId,
        productId: item.productId,
        quantityExact: item.quantityExact.toString(),
        deliveredQuantityExact: item.deliveredQuantityExact?.toString() ?? null,
        rejectedQuantityExact: item.rejectedQuantityExact?.toString() ?? null,
        rejectionReasonCode: item.rejectionReasonCode,
        rejectionNotes: item.rejectionNotes,
        supplierFault: item.supplierFault,
        unitSnapshot: item.unitSnapshot,
        saleModeSnapshot: item.saleModeSnapshot,
        unitCostExact: item.unitCostExact.toString(),
        batchId: item.batchId,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
    })),
});

const findReceiptByClientEvent = async (
    db: Pick<PrismaTx, 'goodsReceipt'> | Pick<PrismaClient, 'goodsReceipt'>,
    tenantId: string,
    clientEventId: string,
): Promise<ReceiptWithRelations | null> => db.goodsReceipt.findFirst({
    where: { tenantId, clientEventId },
    include: receiptInclude,
});

const expectedHashFor = (input: {
    tenantId: string;
    purchaseOrderId: string;
    warehouseId: string;
    supplierDeliveryRef: string | null;
    lines: CanonicalProcurementReceiptLine[];
}): string => buildProcurementReceiptPayloadHash(input);

const serializeReplay = (
    existing: ReceiptWithRelations,
    expectedPayloadHash: string,
): ProcurementReceiptResult => {
    assertMatchingProcurementReceiptReplay(existing, expectedPayloadHash);
    return {
        purchaseOrder: serializePurchaseOrder(existing.purchaseOrder),
        receipt: serializeGoodsReceipt(existing),
        replay: true,
    };
};

const assertValidContext = (input: {
    tenantId: string;
    userId: string;
    purchaseOrderId: string;
    now: Date;
}): void => {
    if (!input.tenantId || !input.userId || !input.purchaseOrderId) {
        throw new ProcurementReceiptError(
            'INVALID_RECEIPT_CONTEXT',
            400,
            'tenantId, userId y purchaseOrderId son obligatorios',
        );
    }
    if (Number.isNaN(input.now.getTime())) {
        throw new ProcurementReceiptError('INVALID_RECEIPT_DATE', 400, 'La fecha de recepción no es válida');
    }
};

const receiptNumberFor = (clientEventId: string): string => `REC-${clientEventId.toUpperCase()}`;

/**
 * Ejecuta la recepción completa en una sola transacción. La primera sentencia
 * de BD es siempre el lock tenant-scoped del header de la OC.
 */
export async function executeProcurementReceipt({
    tx,
    tenantId,
    userId,
    purchaseOrderId,
    request,
    now = new Date(),
}: ExecuteProcurementReceiptInput): Promise<ProcurementReceiptResult> {
    const scopedTenantId = tenantId.trim();
    const scopedUserId = userId.trim();
    const scopedPurchaseOrderId = purchaseOrderId.trim();
    const clientEventId = request.clientEventId.trim().toLowerCase();
    const supplierDeliveryRef = request.supplierDeliveryRef?.trim() || null;
    const canonicalLines = normalizeProcurementReceiptLines(request.items);
    assertValidContext({
        tenantId: scopedTenantId,
        userId: scopedUserId,
        purchaseOrderId: scopedPurchaseOrderId,
        now,
    });

    const lockedRows = await tx.$queryRaw<LockedPurchaseOrderRow[]>(Prisma.sql`
        SELECT \`id\`
        FROM \`PurchaseOrder\`
        WHERE \`id\` = ${scopedPurchaseOrderId}
          AND \`tenantId\` = ${scopedTenantId}
        LIMIT 1
        FOR UPDATE
    `);
    if (lockedRows.length !== 1) {
        throw new ProcurementReceiptError('PURCHASE_ORDER_NOT_FOUND', 404, 'Orden de compra no encontrada');
    }

    const po = await tx.purchaseOrder.findFirst({
        where: { id: scopedPurchaseOrderId, tenantId: scopedTenantId },
        include: { items: true },
    }) as PurchaseOrderState | null;
    if (!po) {
        throw new ProcurementReceiptError('PURCHASE_ORDER_NOT_FOUND', 404, 'Orden de compra no encontrada');
    }

    const receiver = await tx.user.findFirst({
        where: {
            id: scopedUserId,
            tenantId: scopedTenantId,
            status: 'ACTIVE',
        },
        select: { id: true },
    });
    if (!receiver) {
        throw new ProcurementReceiptError(
            'RECEIPT_ACTOR_FORBIDDEN',
            403,
            'El usuario no está activo en este negocio para recibir mercadería',
        );
    }

    // Recheck dentro de la tx y después del lock. Permite replay aun cuando la
    // recepción original dejó la OC en RECEIVED.
    const existing = await findReceiptByClientEvent(tx, scopedTenantId, clientEventId);
    if (existing) {
        const replayWarehouseId = request.warehouseId?.trim() || existing.warehouseId;
        return serializeReplay(existing, expectedHashFor({
            tenantId: scopedTenantId,
            purchaseOrderId: scopedPurchaseOrderId,
            warehouseId: replayWarehouseId,
            supplierDeliveryRef,
            lines: canonicalLines,
        }));
    }

    if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
        throw new ProcurementReceiptError(
            'INVALID_PURCHASE_ORDER_STATUS',
            409,
            `No se puede recibir una OC en estado ${po.status}`,
        );
    }

    const destinationWarehouse = await resolveOperationalWarehouse(
        tx,
        scopedTenantId,
        request.warehouseId?.trim(),
    );
    const payloadHash = expectedHashFor({
        tenantId: scopedTenantId,
        purchaseOrderId: scopedPurchaseOrderId,
        warehouseId: destinationWarehouse.id,
        supplierDeliveryRef,
        lines: canonicalLines,
    });

    const productIds = [...new Set(po.items.map(item => item.productId))].sort();
    const products = await tx.product.findMany({
        where: { tenantId: scopedTenantId, id: { in: productIds } },
        select: {
            id: true,
            name: true,
            unit: true,
            saleMode: true,
            quantityStep: true,
            requiresBatchTracking: true,
        },
    }) as ProductAuthority[];
    const productById = new Map(products.map(product => [product.id, product]));
    const itemById = new Map(po.items.map(item => [item.id, item]));
    // El normalizador legacy sigue siendo autoritativo para accepted>0. Las
    // líneas reject-only omiten esa ruta porque accepted=0 es intencional.
    const normalizedAccepted = normalizePurchaseOrderReceiptLines(
        canonicalLines.filter(line => new Decimal(line.quantity).greaterThan(0)).map(line => ({
            itemId: line.itemId,
            quantityReceived: line.quantity,
        })),
        po.items,
        products,
    );
    const acceptedByItemId = new Map(normalizedAccepted.map(line => [line.item.id, line]));
    const matched = sortProcurementReceiptExecutionLines(canonicalLines.map((canonical) => {
        const item = itemById.get(canonical.itemId);
        if (!item) {
            throw new PurchaseOrderQuantityError(
                'ITEM_NOT_IN_ORDER',
                'Una línea no pertenece a esta orden de compra',
                { itemId: canonical.itemId },
            );
        }
        const product = productById.get(item.productId);
        if (!product) {
            throw new PurchaseOrderQuantityError(
                'PRODUCT_NOT_IN_TENANT',
                'Uno o más productos no pertenecen a tu negocio',
                { productId: item.productId },
            );
        }
        const acceptedNormalized = acceptedByItemId.get(item.id);
        const rules = acceptedNormalized?.rules ?? purchaseOrderRulesForReceipt(item, product);
        const acceptedQuantity = new Decimal(canonical.quantity);
        const rejectedQuantity = new Decimal(canonical.rejectedQuantity ?? 0);
        if (rejectedQuantity.greaterThan(0)) {
            try {
                validateQuantity(rejectedQuantity, rules);
            } catch (error) {
                if (error instanceof QuantityValidationError) {
                    throw new ProcurementReceiptError(error.code, 400, error.message);
                }
                throw error;
            }
        }

        let ordered: Decimal;
        let receivedBefore: Decimal;
        let rejectedBefore: Decimal;
        let closedShortBefore: Decimal;
        let remainingBefore: Decimal;
        try {
            ordered = orderedQuantityForItem(item);
            receivedBefore = receivedQuantityForItem(item);
            rejectedBefore = rejectedQuantityForPurchaseOrderItem(item);
            closedShortBefore = closedShortQuantityForPurchaseOrderItem(item);
            remainingBefore = remainingOpenQuantityForPurchaseOrderItem(item);
        } catch (error) {
            if (error instanceof PurchaseOrderCloseShortError) {
                throw new ProcurementReceiptError(error.code, error.httpStatus, error.message);
            }
            throw error;
        }
        const deliveredQuantity = new Decimal(
            canonical.deliveredQuantity ?? acceptedQuantity.plus(rejectedQuantity),
        );
        if (acceptedQuantity.greaterThan(remainingBefore)) {
            throw new ProcurementReceiptError(
                'OVER_RECEIPT',
                409,
                `No podés aceptar más de lo pendiente: a "${item.productName}" le quedan ${remainingBefore.toString()}`,
            );
        }
        if (deliveredQuantity.greaterThan(remainingBefore)) {
            throw new ProcurementReceiptError(
                'OVER_DELIVERY',
                409,
                `La entrega de "${item.productName}" supera el saldo abierto de ${remainingBefore.toString()}`,
            );
        }

        return {
            ...canonical,
            productId: item.productId,
            item,
            ordered,
            acceptedQuantityDecimal: acceptedQuantity,
            rejectedQuantityDecimal: rejectedQuantity,
            deliveredQuantityDecimal: deliveredQuantity,
            receivedBefore,
            receivedAfter: receivedBefore.plus(acceptedQuantity),
            rejectedBefore,
            rejectedAfter: rejectedBefore.plus(rejectedQuantity),
            closedShortBefore,
            remainingBefore,
            rules,
            unitAtOrder: acceptedNormalized?.unitAtOrder ?? item.unitAtOrder?.trim() ?? product.unit.trim(),
        };
    }));
    const inspection = summarizeProcurementReceiptInspection(canonicalLines);

    // El comprobante nace antes de cualquier efecto. Un P2002 nunca ocurre
    // después de mover stock, costo, lote o Kardex.
    const receiptHeader = await tx.goodsReceipt.create({
        data: {
            tenantId: scopedTenantId,
            purchaseOrderId: po.id,
            warehouseId: destinationWarehouse.id,
            receiptNumber: receiptNumberFor(clientEventId),
            status: 'POSTED',
            supplierDeliveryRef,
            clientEventId,
            payloadHash,
            payloadVersion: inspection.payloadVersion,
            inspectionOutcome: inspection.inspectionOutcome,
            inspectedLineCount: inspection.inspectedLineCount,
            rejectedLineCount: inspection.rejectedLineCount,
            hasSupplierFault: inspection.hasSupplierFault,
            receivedBy: scopedUserId,
            receivedAt: now,
        },
        select: { id: true },
    });

    const inventoryResults: ReceiptInventoryResult[] = [];
    const requiresBatchWarehouseLedger = matched.some(line =>
        line.acceptedQuantityDecimal.greaterThan(0)
        && productById.get(line.productId)?.requiresBatchTracking === true);
    const batchWarehouseLedgerMode = requiresBatchWarehouseLedger
        ? await resolveBatchWarehouseLedgerMode(tx, scopedTenantId)
        : 'OFF' as const;
    for (const line of matched) {
        const product = productById.get(line.productId);
        if (!product) {
            throw new PurchaseOrderQuantityError(
                'PRODUCT_NOT_IN_TENANT',
                'Uno o más productos no pertenecen a tu negocio',
                { productId: line.productId },
            );
        }

        const quantity = line.acceptedQuantityDecimal;
        const quantityLegacy = quantity.toNumber();
        let batchId: string | null = null;
        const expiryDate = line.expiryDate ? normalizeCalendarDateInput(line.expiryDate) : null;
        if (quantity.greaterThan(0)) {
            if (product.requiresBatchTracking && (!line.batchNumber || !line.expiryDate)) {
                throw new ProcurementReceiptError(
                    'BATCH_REQUIRED',
                    400,
                    `Ingresá lote y vencimiento para ${product.name}`,
                );
            }

            // Stock/Kardex siguen en Float legacy; Decimal(18,4) es la autoridad
            // y la conversión ocurre solo en este borde compatible.
            const stock = await applyStockDelta(tx, {
                tenantId: scopedTenantId,
                productId: product.id,
                delta: quantityLegacy,
                enforceSufficient: false,
                warehouseId: destinationWarehouse.id,
            });

            const lockedCostRows = await tx.$queryRaw<Array<{ cost: DecimalValue }>>(Prisma.sql`
                SELECT \`cost\`
                FROM \`Product\`
                WHERE \`id\` = ${product.id}
                  AND \`tenantId\` = ${scopedTenantId}
                FOR UPDATE
            `);
            if (lockedCostRows.length !== 1) {
                throw new StockError('PRODUCT_NOT_FOUND', `Producto ${product.id} no encontrado`);
            }
            const costBefore = new Decimal(lockedCostRows[0].cost.toString());
            const costAfter = weightedAverageCost(
                stock.stockBefore,
                costBefore,
                quantity,
                (line.item.unitCostExact ?? line.item.unitCost).toString(),
            );
            const costUpdate = await tx.product.updateMany({
                where: { id: product.id, tenantId: scopedTenantId },
                data: { cost: costAfter.toNumber() },
            });
            if (costUpdate.count !== 1) {
                throw new StockError('PRODUCT_NOT_FOUND', `Producto ${product.id} no encontrado`);
            }

            if (product.requiresBatchTracking && line.batchNumber && expiryDate) {
                const existingBatch = await tx.productBatch.findFirst({
                    where: {
                        tenantId: scopedTenantId,
                        productId: product.id,
                        batchNumber: line.batchNumber,
                    },
                    select: { id: true, expiryDate: true },
                });
                if (existingBatch && existingBatch.expiryDate.toISOString().slice(0, 10) !== line.expiryDate) {
                    throw new ProcurementReceiptError(
                        'BATCH_EXPIRY_CONFLICT',
                        409,
                        `El lote ${line.batchNumber} de ${product.name} ya tiene otro vencimiento`,
                    );
                }
                if (existingBatch) {
                    const batchUpdate = await tx.productBatch.updateMany({
                        where: {
                            id: existingBatch.id,
                            tenantId: scopedTenantId,
                            productId: product.id,
                        },
                        data: { stock: { increment: quantityLegacy } },
                    });
                    if (batchUpdate.count !== 1) {
                        throw new ProcurementReceiptError('BATCH_UPDATE_FAILED', 409, 'No se pudo actualizar el lote');
                    }
                    batchId = existingBatch.id;
                } else {
                    const createdBatch = await tx.productBatch.create({
                        data: {
                            tenantId: scopedTenantId,
                            productId: product.id,
                            batchNumber: line.batchNumber,
                            expiryDate,
                            stock: quantityLegacy,
                        },
                        select: { id: true },
                    });
                    batchId = createdBatch.id;
                }
            }

            if (batchId) {
                await applyBatchWarehouseDelta({
                    tx,
                    mode: batchWarehouseLedgerMode,
                    tenantId: scopedTenantId,
                    productId: product.id,
                    batchId,
                    warehouseId: destinationWarehouse.id,
                    delta: quantity.toString(),
                    movementType: 'GOODS_RECEIPT',
                    referenceId: receiptHeader.id,
                    referenceType: 'GOODS_RECEIPT',
                    userId: scopedUserId,
                    reason: null,
                    sourceKey: `goods-receipt:${receiptHeader.id}:po-item:${line.item.id}`,
                    allowNegative: false,
                });
            }

            await tx.kardexMovement.create({
                data: {
                    tenantId: scopedTenantId,
                    productId: product.id,
                    type: 'IN_PURCHASE',
                    quantity: quantityLegacy,
                    stockBefore: stock.stockBefore,
                    stockAfter: stock.stockAfter,
                    referenceId: receiptHeader.id,
                    referenceType: 'GOODS_RECEIPT',
                    reason: `Recepción ${receiptNumberFor(clientEventId)} de OC ${po.orderNumber}`,
                    userId: scopedUserId,
                    batchId,
                    warehouseId: stock.warehouseId,
                },
            });

            inventoryResults.push({
                itemId: line.item.id,
                productId: product.id,
                warehouseId: stock.warehouseId,
                quantity: quantity.toString(),
                unitCost: (line.item.unitCostExact ?? line.item.unitCost).toString(),
                stockBefore: new Decimal(stock.stockBefore).toString(),
                stockAfter: new Decimal(stock.stockAfter).toString(),
                costBefore: costBefore.toString(),
                costAfter: costAfter.toString(),
                batchId,
                batchNumber: line.batchNumber,
                expiryDate: line.expiryDate,
            });
        }

        const itemUpdate = await tx.purchaseOrderItem.updateMany({
            where: {
                id: line.item.id,
                purchaseOrderId: po.id,
            },
            data: {
                quantityReceived: { increment: quantityLegacy },
                quantityOrderedExact: line.ordered.toString(),
                quantityReceivedExact: line.receivedAfter.toString(),
                quantityRejectedExact: line.rejectedAfter.toString(),
                quantityClosedShortExact: line.closedShortBefore.toString(),
                unitAtOrder: line.unitAtOrder,
                saleModeAtOrder: line.rules.saleMode,
                quantityStepAtOrder: line.rules.quantityStep,
            },
        });
        if (itemUpdate.count !== 1) {
            throw new ProcurementReceiptError(
                'PURCHASE_ORDER_ITEM_UPDATE_FAILED',
                409,
                'No se pudo actualizar una línea bloqueada de la orden',
            );
        }

        await tx.goodsReceiptItem.create({
            data: {
                tenantId: scopedTenantId,
                goodsReceiptId: receiptHeader.id,
                purchaseOrderItemId: line.item.id,
                productId: product.id,
                quantityExact: quantity.toString(),
                deliveredQuantityExact: line.deliveredQuantityDecimal.toString(),
                rejectedQuantityExact: line.rejectedQuantityDecimal.toString(),
                rejectionReasonCode: line.rejectionReasonCode ?? null,
                rejectionNotes: line.rejectionNotes ?? null,
                supplierFault: line.supplierFault ?? null,
                unitSnapshot: line.unitAtOrder,
                saleModeSnapshot: line.rules.saleMode,
                unitCostExact: (line.item.unitCostExact ?? line.item.unitCost).toString(),
                batchId,
                batchNumber: line.batchNumber,
                expiryDate,
            },
        });
    }

    const fresh = await tx.purchaseOrder.findFirstOrThrow({
        where: { id: po.id, tenantId: scopedTenantId },
        include: { items: true },
    }) as PurchaseOrderState;
    let newStatus: ReturnType<typeof derivePurchaseOrderFulfillmentStatus>;
    try {
        newStatus = derivePurchaseOrderFulfillmentStatus(fresh.items);
    } catch (error) {
        if (error instanceof PurchaseOrderCloseShortError) {
            throw new ProcurementReceiptError(error.code, error.httpStatus, error.message);
        }
        throw error;
    }
    const statusUpdate = await tx.purchaseOrder.updateMany({
        where: { id: po.id, tenantId: scopedTenantId },
        data: { status: newStatus },
    });
    if (statusUpdate.count !== 1) {
        throw new ProcurementReceiptError(
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
            action: 'GOODS_RECEIPT_POSTED',
            details: JSON.stringify({
                receiptId: receiptHeader.id,
                receiptNumber: receiptNumberFor(clientEventId),
                purchaseOrderId: po.id,
                orderNumber: po.orderNumber,
                warehouseId: destinationWarehouse.id,
                inspection,
                before: {
                    status: po.status,
                    items: matched.map(line => ({
                        itemId: line.item.id,
                        accepted: line.receivedBefore.toString(),
                        rejected: line.rejectedBefore.toString(),
                        closedShort: line.closedShortBefore.toString(),
                        open: line.remainingBefore.toString(),
                    })),
                },
                after: {
                    status: newStatus,
                    items: matched.map(line => ({
                        itemId: line.item.id,
                        deliveredIncrement: line.deliveredQuantityDecimal.toString(),
                        accepted: line.receivedAfter.toString(),
                        rejected: line.rejectedAfter.toString(),
                        closedShort: line.closedShortBefore.toString(),
                        open: line.remainingBefore.minus(line.acceptedQuantityDecimal).toString(),
                        rejectionReasonCode: line.rejectionReasonCode ?? null,
                        supplierFault: line.supplierFault ?? null,
                    })),
                    inventory: inventoryResults,
                },
            }),
        },
    });

    const receipt = await tx.goodsReceipt.findFirstOrThrow({
        where: { id: receiptHeader.id, tenantId: scopedTenantId },
        include: receiptInclude,
    });
    return {
        purchaseOrder: serializePurchaseOrder(updated),
        receipt: serializeGoodsReceipt(receipt),
        replay: false,
    };
}

/**
 * Un P2002 concurrente se relee fuera de la transacción abortada para abrir un
 * snapshot fresco y distinguir replay exacto de reutilización conflictiva.
 */
export async function executeProcurementReceiptTransaction({
    db,
    tenantId,
    userId,
    purchaseOrderId,
    request,
    now,
}: ExecuteProcurementReceiptTransactionInput): Promise<ProcurementReceiptResult> {
    const scopedTenantId = tenantId.trim();
    const scopedPurchaseOrderId = purchaseOrderId.trim();
    const clientEventId = request.clientEventId.trim().toLowerCase();
    const canonicalLines = normalizeProcurementReceiptLines(request.items);

    try {
        return await db.$transaction(
            tx => executeProcurementReceipt({
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

        const existing = await findReceiptByClientEvent(db, scopedTenantId, clientEventId);
        if (!existing) throw error;

        return serializeReplay(existing, expectedHashFor({
            tenantId: scopedTenantId,
            purchaseOrderId: scopedPurchaseOrderId,
            warehouseId: request.warehouseId?.trim() || existing.warehouseId,
            supplierDeliveryRef: request.supplierDeliveryRef?.trim() || null,
            lines: canonicalLines,
        }));
    }
}

export { StockError };
