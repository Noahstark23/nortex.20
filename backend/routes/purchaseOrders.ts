/**
 * NORTEX — Órdenes de Compra (procurement: pedido → aprobación → recepción).
 *
 * Modelo de procurement de 3 estados de avance:
 *   DRAFT → APPROVED → (PARTIALLY_RECEIVED) → RECEIVED   (o CANCELLED)
 *
 * La recepción es un GOODS RECEIPT (entrada física): incrementa stock, recalcula
 * el costo promedio ponderado, abre/actualiza lotes y deja Kardex + AuditLog.
 * NO toca dinero ni contabilidad: la factura del proveedor (cuenta por pagar) se
 * registra aparte por /api/purchases y puede enlazarse a la OC (purchaseOrderId).
 *
 * Aislamiento: TODO query filtra por tenantId (del JWT, nunca del body).
 */

import express from 'express';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import {
    PURCHASE_ORDER_READ_ROLES,
    PURCHASE_ORDER_RECEIVE_ROLES,
    PURCHASE_WRITE_ROLES,
} from '../middleware/accessPolicies';
import { BODEGUERO_ROLE, redactBodegueroPurchaseOrder } from '../security/bodegueroPolicy';
import { asegurarBodegaPorDefecto } from '../services/stockService';
import {
    procurementReceiptRequestSchema,
    ProcurementReceiptError,
} from '../lib/procurementReceipts';
import {
    executeProcurementReceiptTransaction,
    StockError,
    type SerializedGoodsReceipt,
} from '../services/procurementReceiptService';
import {
    purchaseOrderCloseShortRequestSchema,
    PurchaseOrderCloseShortError,
} from '../lib/purchaseOrderCloseShort';
import { executePurchaseOrderCloseShortTransaction } from '../services/purchaseOrderCloseShortService';
import {
    extractPurchaseOrderProductIds,
    normalizePurchaseOrderLines,
    PurchaseOrderQuantityError,
} from '../../utils/purchaseOrderQuantities.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const router = express.Router();

const ROLES_WRITE = PURCHASE_WRITE_ROLES;
const ROLES_RECEIVE = PURCHASE_ORDER_RECEIVE_ROLES;

const redactBodegueroGoodsReceipt = (
    receipt: Record<string, any> | SerializedGoodsReceipt,
): Record<string, any> => ({
    id: receipt.id,
    purchaseOrderId: receipt.purchaseOrderId,
    warehouseId: receipt.warehouseId,
    receiptNumber: receipt.receiptNumber,
    status: receipt.status,
    supplierDeliveryRef: receipt.supplierDeliveryRef ?? null,
    payloadVersion: receipt.payloadVersion ?? 1,
    inspectionOutcome: receipt.inspectionOutcome ?? 'FULL_ACCEPT',
    inspectedLineCount: receipt.inspectedLineCount ?? 0,
    rejectedLineCount: receipt.rejectedLineCount ?? 0,
    hasSupplierFault: receipt.hasSupplierFault ?? false,
    receivedAt: receipt.receivedAt,
    createdAt: receipt.createdAt,
    warehouse: receipt.warehouse ?? null,
    ...('_count' in receipt ? { _count: receipt._count } : {}),
    ...(Array.isArray(receipt.items) ? {
        items: receipt.items.map((item: Record<string, any>) => ({
            id: item.id,
            purchaseOrderItemId: item.purchaseOrderItemId,
            productId: item.productId,
            quantityExact: item.quantityExact?.toString() ?? null,
            deliveredQuantityExact: item.deliveredQuantityExact?.toString() ?? null,
            rejectedQuantityExact: item.rejectedQuantityExact?.toString() ?? null,
            rejectionReasonCode: item.rejectionReasonCode ?? null,
            supplierFault: item.supplierFault ?? null,
            unitSnapshot: item.unitSnapshot,
            saleModeSnapshot: item.saleModeSnapshot ?? null,
            batchId: item.batchId ?? null,
            batchNumber: item.batchNumber ?? null,
            expiryDate: item.expiryDate ?? null,
            createdAt: item.createdAt,
        })),
    } : {}),
});

/**
 * Mantiene la redacción financiera del rol BODEGUERO, pero conserva el
 * snapshot físico necesario para recibir productos medidos sin degradarlos a
 * la sombra Float ni depender de la configuración actual del producto.
 */
const redactBodegueroMeasuredOrder = (order: Record<string, any>): Record<string, any> => {
    const redacted = redactBodegueroPurchaseOrder(order);
    const sourceItems = new Map<string, Record<string, any>>(
        Array.isArray(order.items) ? order.items.map((item: Record<string, any>) => [item.id, item]) : [],
    );

    return {
        ...redacted,
        goodsReceipts: Array.isArray(order.goodsReceipts)
            ? order.goodsReceipts.map(redactBodegueroGoodsReceipt)
            : [],
        // Cierre corto es una decisión administrativa; BODEGUERO solo ve sus
        // cantidades proyectadas en la línea, nunca autor ni notas del evento.
        closeShorts: [],
        items: Array.isArray(redacted.items)
            ? redacted.items.map((item: Record<string, any>) => {
                const source = sourceItems.get(item.id);
                if (!source) return item;
                return {
                    ...item,
                    quantityOrderedExact: source.quantityOrderedExact?.toString() ?? null,
                    quantityReceivedExact: source.quantityReceivedExact?.toString() ?? null,
                    quantityRejectedExact: source.quantityRejectedExact?.toString() ?? null,
                    quantityClosedShortExact: source.quantityClosedShortExact?.toString() ?? null,
                    unitAtOrder: source.unitAtOrder ?? null,
                    saleModeAtOrder: source.saleModeAtOrder ?? null,
                    quantityStepAtOrder: source.quantityStepAtOrder?.toString() ?? null,
                    ...(source.product ? {
                        product: {
                            requiresBatchTracking: Boolean(source.product.requiresBatchTracking),
                            unit: source.product.unit,
                            saleMode: source.product.saleMode,
                            quantityStep: source.product.quantityStep?.toString() ?? null,
                        },
                    } : {}),
                };
            })
            : [],
    };
};

interface PurchaseOrderCancellationItem {
    quantityReceived: Prisma.Decimal | number | string;
    quantityReceivedExact?: Prisma.Decimal | number | string | null;
    quantityRejectedExact?: Prisma.Decimal | number | string | null;
    quantityClosedShortExact?: Prisma.Decimal | number | string | null;
}

interface PurchaseOrderCancellationState {
    status: string;
    items: PurchaseOrderCancellationItem[];
    goodsReceipts?: unknown[];
    closeShorts?: unknown[];
    _count?: {
        goodsReceipts?: number;
        closeShorts?: number;
    };
}

export interface PurchaseOrderCancellationRejection {
    status: 409;
    code: 'PO_HAS_RECEIPTS' | 'PO_FINAL_STATUS' | 'PO_INVALID_STATUS';
    error: string;
}

/**
 * Decide si una OC puede cancelarse sin revertir inventario. Se validan ambas
 * columnas de cantidad para cubrir filas legacy y evitar que una sombra Float
 * desincronizada permita cancelar mercadería que ya ingresó físicamente.
 */
export const getPurchaseOrderCancellationRejection = (
    order: PurchaseOrderCancellationState,
): PurchaseOrderCancellationRejection | null => {
    const hasProjectedEvidence = order.items.some((item) => {
        const legacyReceived = new Decimal(item.quantityReceived.toString());
        const exactReceived = item.quantityReceivedExact == null
            ? legacyReceived
            : new Decimal(item.quantityReceivedExact.toString());
        const rejected = new Decimal(item.quantityRejectedExact?.toString() ?? 0);
        const closedShort = new Decimal(item.quantityClosedShortExact?.toString() ?? 0);
        // Cualquier proyección no-cero (incluso una fila corrupta negativa)
        // falla cerrada: cancelar no debe borrar evidencia que requeriría ajuste.
        return !legacyReceived.isZero()
            || !exactReceived.isZero()
            || !rejected.isZero()
            || !closedShort.isZero();
    });
    const hasReceiptEvent = (order._count?.goodsReceipts ?? order.goodsReceipts?.length ?? 0) > 0;
    const hasCloseShortEvent = (order._count?.closeShorts ?? order.closeShorts?.length ?? 0) > 0;

    if (order.status === 'PARTIALLY_RECEIVED' || hasProjectedEvidence || hasReceiptEvent || hasCloseShortEvent) {
        return {
            status: 409,
            code: 'PO_HAS_RECEIPTS',
            error: 'No se puede cancelar una orden con evidencia de recepción, rechazo o cierre corto',
        };
    }
    if (order.status === 'RECEIVED' || order.status === 'CLOSED_SHORT' || order.status === 'CANCELLED') {
        return {
            status: 409,
            code: 'PO_FINAL_STATUS',
            error: `No se puede cancelar una OC en estado ${order.status}`,
        };
    }
    if (order.status !== 'DRAFT' && order.status !== 'APPROVED') {
        return {
            status: 409,
            code: 'PO_INVALID_STATUS',
            error: `No se puede cancelar una OC en estado ${order.status}`,
        };
    }
    return null;
};

const purchaseOrderTransitionSnapshot = (order: {
    status: string;
    approvedBy: string | null;
    approvedAt: Date | null;
}) => ({
    status: order.status,
    approvedBy: order.approvedBy,
    approvedAt: order.approvedAt?.toISOString() ?? null,
});

// ── GET / — listar órdenes de compra del tenant ─────────────────────────────
router.get('/', authenticate, checkRole(PURCHASE_ORDER_READ_ROLES), async (req: any, res: any) => {
    try {
        const orders = await prisma.purchaseOrder.findMany({
            where: { tenantId: req.tenantId },
            include: {
                // BODEGUERO usa el id para la devolución física anidada; la
                // redacción posterior conserva solo id+name y nunca RUC/CxP.
                supplier: { select: { id: true, name: true } },
                items: {
                    include: {
                        product: {
                            select: {
                                requiresBatchTracking: true,
                                unit: true,
                                saleMode: true,
                                quantityStep: true,
                            },
                        },
                    },
                },
                receipts: {
                    select: {
                        items: {
                            select: {
                                productId: true,
                                purchaseOrderItemId: true,
                                quantity: true,
                                quantityExact: true,
                            },
                        },
                    },
                },
                goodsReceipts: {
                    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
                    take: 20,
                    select: {
                        id: true,
                        purchaseOrderId: true,
                        warehouseId: true,
                        receiptNumber: true,
                        status: true,
                        supplierDeliveryRef: true,
                        payloadVersion: true,
                        inspectionOutcome: true,
                        inspectedLineCount: true,
                        rejectedLineCount: true,
                        hasSupplierFault: true,
                        receivedBy: true,
                        receivedAt: true,
                        createdAt: true,
                        warehouse: { select: { id: true, name: true } },
                        receiver: { select: { id: true, name: true } },
                        _count: { select: { items: true } },
                    },
                },
                closeShorts: {
                    orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
                    take: 20,
                    select: {
                        id: true,
                        purchaseOrderId: true,
                        status: true,
                        clientEventId: true,
                        closedBy: true,
                        closedAt: true,
                        createdAt: true,
                        lineCount: true,
                        closedLineCount: true,
                        hasSupplierFault: true,
                        reasonSummaryCode: true,
                        note: true,
                        creator: { select: { id: true, name: true } },
                        _count: { select: { items: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        res.json({
            success: true,
            data: req.role === BODEGUERO_ROLE
                ? orders.map(redactBodegueroMeasuredOrder)
                : orders,
        });
    } catch (e: any) {
        console.error('Error listando OC:', e.message);
        res.status(500).json({ error: 'Error al listar órdenes de compra' });
    }
});

// ── GET /:id — detalle ──────────────────────────────────────────────────────
router.get('/:id', authenticate, checkRole(PURCHASE_ORDER_READ_ROLES), async (req: any, res: any) => {
    try {
        const order = await prisma.purchaseOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId },
            include: {
                supplier: true,
                items: {
                    include: {
                        product: {
                            select: {
                                requiresBatchTracking: true,
                                unit: true,
                                saleMode: true,
                                quantityStep: true,
                            },
                        },
                    },
                },
                receipts: { select: { id: true, invoiceNumber: true, total: true, createdAt: true } },
                goodsReceipts: {
                    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
                    take: 200,
                    select: {
                        id: true,
                        purchaseOrderId: true,
                        warehouseId: true,
                        receiptNumber: true,
                        status: true,
                        supplierDeliveryRef: true,
                        payloadVersion: true,
                        inspectionOutcome: true,
                        inspectedLineCount: true,
                        rejectedLineCount: true,
                        hasSupplierFault: true,
                        receivedBy: true,
                        receivedAt: true,
                        createdAt: true,
                        warehouse: { select: { id: true, name: true } },
                        receiver: { select: { id: true, name: true } },
                        items: {
                            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                            select: {
                                id: true,
                                purchaseOrderItemId: true,
                                productId: true,
                                quantityExact: true,
                                deliveredQuantityExact: true,
                                rejectedQuantityExact: true,
                                rejectionReasonCode: true,
                                rejectionNotes: true,
                                supplierFault: true,
                                unitSnapshot: true,
                                saleModeSnapshot: true,
                                unitCostExact: true,
                                batchId: true,
                                batchNumber: true,
                                expiryDate: true,
                                createdAt: true,
                            },
                        },
                    },
                },
                closeShorts: {
                    orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
                    take: 200,
                    select: {
                        id: true,
                        purchaseOrderId: true,
                        status: true,
                        clientEventId: true,
                        closedBy: true,
                        closedAt: true,
                        createdAt: true,
                        lineCount: true,
                        closedLineCount: true,
                        hasSupplierFault: true,
                        reasonSummaryCode: true,
                        note: true,
                        creator: { select: { id: true, name: true } },
                        items: {
                            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                            select: {
                                id: true,
                                purchaseOrderItemId: true,
                                quantityExact: true,
                                reasonCode: true,
                                supplierFault: true,
                                note: true,
                                orderedQuantitySnapshotExact: true,
                                acceptedQuantitySnapshotExact: true,
                                rejectedQuantitySnapshotExact: true,
                                remainingBeforeExact: true,
                                remainingAfterExact: true,
                                unitSnapshot: true,
                                saleModeSnapshot: true,
                                quantityStepSnapshot: true,
                                createdAt: true,
                            },
                        },
                    },
                },
            },
        });
        if (!order) return res.status(404).json({ error: 'Orden de compra no encontrada' });
        res.json({
            success: true,
            data: req.role === BODEGUERO_ROLE
                ? redactBodegueroMeasuredOrder(order)
                : order,
        });
    } catch (e: any) {
        console.error('Error obteniendo OC:', e.message);
        res.status(500).json({ error: 'Error al obtener la orden de compra' });
    }
});

// ── POST / — crear borrador ─────────────────────────────────────────────────
router.post('/', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { supplierId, notes, expectedDate, items } = req.body ?? {};

    if (!supplierId || typeof supplierId !== 'string') {
        return res.status(400).json({ error: 'supplierId es requerido' });
    }
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un ítem' });
    }

    try {
        // Estructura y duplicados se validan antes de consultar. Después, cada
        // producto se vuelve a cargar con tenantId: el cliente no decide modo,
        // paso, unidad, nombre ni pertenencia.
        const productIds = extractPurchaseOrderProductIds(items);
        const result = await prisma.$transaction(async (tx) => {
            // Primera lectura de la tx: serializa crear OC con bloquear,
            // suspender o eliminar lógicamente al proveedor.
            const supplierRows = await tx.$queryRaw<Array<{
                id: string;
                status: string;
                deletedAt: Date | null;
            }>>`
                SELECT id, \`status\`, \`deletedAt\` FROM \`Supplier\`
                WHERE id = ${supplierId} AND \`tenantId\` = ${tenantId}
                FOR UPDATE`;
            const supplier = supplierRows[0];
            if (!supplier) return { outcome: 'SUPPLIER_NOT_FOUND' as const };
            if (supplier.status !== 'ACTIVE' || supplier.deletedAt !== null) {
                return { outcome: 'SUPPLIER_NOT_ACTIVE' as const };
            }

            const products = await tx.product.findMany({
                where: { id: { in: productIds }, tenantId },
                select: { id: true, name: true, unit: true, saleMode: true, quantityStep: true },
            });
            const normalizedItems = normalizePurchaseOrderLines(items, products);

            // Correlativo por tenant. El @@unique([tenantId, orderNumber]) protege la integridad.
            const count = await tx.purchaseOrder.count({ where: { tenantId } });
            const orderNumber = `OC-${String(count + 1).padStart(4, '0')}`;

            const created = await tx.purchaseOrder.create({
                data: {
                    tenantId,
                    supplierId,
                    orderNumber,
                    status: 'DRAFT',
                    notes: notes ? String(notes) : null,
                    expectedDate: expectedDate ? new Date(expectedDate) : null,
                    createdBy: req.userId,
                    items: {
                        create: normalizedItems.map((item) => ({
                            productId: item.productId,
                            productName: item.productName,
                            // Float queda como sombra para clientes históricos; el
                            // Decimal nullable es la autoridad en toda fila nueva.
                            quantityOrdered: item.quantity.toNumber(),
                            quantityOrderedExact: item.quantity.toString(),
                            quantityReceivedExact: '0',
                            unitAtOrder: item.unitAtOrder,
                            saleModeAtOrder: item.saleModeAtOrder,
                            quantityStepAtOrder: item.quantityStepAtOrder,
                            unitCost: item.unitCost.toFixed(2),
                            unitCostExact: item.unitCost.toString(),
                        })),
                    },
                },
                include: { items: true },
            });

            await tx.auditLog.create({
                data: {
                    tenantId,
                    userId: req.userId,
                    action: 'PO_CREATED',
                    details: JSON.stringify({
                        poId: created.id,
                        orderNumber: created.orderNumber,
                        before: null,
                        after: {
                            status: created.status,
                            supplierId: created.supplierId,
                            itemCount: created.items.length,
                        },
                    }),
                },
            });
            return { outcome: 'CREATED' as const, data: created };
        });

        if (result.outcome === 'SUPPLIER_NOT_FOUND') {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }
        if (result.outcome === 'SUPPLIER_NOT_ACTIVE') {
            return res.status(409).json({
                error: 'El proveedor no está activo para nuevas órdenes de compra',
                code: 'SUPPLIER_NOT_ACTIVE',
            });
        }
        res.status(201).json({ success: true, data: result.data });
    } catch (e: any) {
        if (e instanceof PurchaseOrderQuantityError) {
            return res.status(400).json({ error: e.message, code: e.code });
        }
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return res.status(409).json({ error: 'Número de orden duplicado, reintentá.' });
        }
        console.error('Error creando OC:', e.message);
        res.status(500).json({ error: 'Error al crear la orden de compra' });
    }
});

// ── POST /:id/approve — DRAFT → APPROVED ────────────────────────────────────
router.post('/:id/approve', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    try {
        const result = await prisma.$transaction(async (tx) => {
            // El lock debe ser la primera lectura de la transacción: serializa
            // approve/receive/cancel sobre la misma OC y elimina el TOCTOU.
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${req.params.id} AND \`tenantId\` = ${tenantId} FOR UPDATE`;
            const po = await tx.purchaseOrder.findFirst({ where: { id: req.params.id, tenantId } });
            if (!po) return { outcome: 'NOT_FOUND' as const };
            if (po.status !== 'DRAFT') {
                return { outcome: 'INVALID_STATUS' as const, status: po.status };
            }

            // Bloquea también al proveedor: una suspensión concurrente no
            // puede cruzarse con la aprobación y dejar una OC utilizable.
            const activeSupplierRows = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM \`Supplier\`
                WHERE id = ${po.supplierId}
                  AND \`tenantId\` = ${tenantId}
                  AND \`deletedAt\` IS NULL
                  AND \`status\` = ${'ACTIVE'}
                FOR UPDATE`;
            if (activeSupplierRows.length === 0) {
                return { outcome: 'SUPPLIER_NOT_ACTIVE' as const };
            }

            const approvedAt = new Date();
            const updated = await tx.purchaseOrder.update({
                where: { id: po.id },
                data: { status: 'APPROVED', approvedBy: req.userId, approvedAt },
            });
            await tx.auditLog.create({
                data: {
                    tenantId,
                    userId: req.userId,
                    action: 'PO_APPROVED',
                    details: JSON.stringify({
                        poId: po.id,
                        orderNumber: po.orderNumber,
                        before: purchaseOrderTransitionSnapshot(po),
                        after: purchaseOrderTransitionSnapshot(updated),
                    }),
                },
            });
            return { outcome: 'UPDATED' as const, data: updated };
        });

        if (result.outcome === 'NOT_FOUND') {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }
        if (result.outcome === 'INVALID_STATUS') {
            return res.status(400).json({ error: `No se puede aprobar una OC en estado ${result.status}` });
        }
        if (result.outcome === 'SUPPLIER_NOT_ACTIVE') {
            return res.status(409).json({
                error: 'El proveedor no está activo para aprobar esta orden de compra',
                code: 'SUPPLIER_NOT_ACTIVE',
            });
        }
        res.json({ success: true, data: result.data });
    } catch (e: any) {
        console.error('Error aprobando OC:', e.message);
        res.status(500).json({ error: 'Error al aprobar la orden de compra' });
    }
});

// ── POST /:id/cancel — DRAFT|APPROVED sin recepción → CANCELLED ──────────────
router.post('/:id/cancel', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Comparte el mismo lock que receive: si una recepción gana la
            // carrera, cancel verá sus cantidades; si cancel gana, receive verá
            // CANCELLED. Nunca se revierten existencias de forma implícita.
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${req.params.id} AND \`tenantId\` = ${tenantId} FOR UPDATE`;
            const po = await tx.purchaseOrder.findFirst({
                where: { id: req.params.id, tenantId },
                include: {
                    items: true,
                    _count: { select: { goodsReceipts: true, closeShorts: true } },
                },
            });
            if (!po) return { outcome: 'NOT_FOUND' as const };

            const rejection = getPurchaseOrderCancellationRejection(po);
            if (rejection) return { outcome: 'REJECTED' as const, rejection };

            const updated = await tx.purchaseOrder.update({
                where: { id: po.id },
                data: { status: 'CANCELLED' },
            });
            await tx.auditLog.create({
                data: {
                    tenantId,
                    userId: req.userId,
                    action: 'PO_CANCELLED',
                    details: JSON.stringify({
                        poId: po.id,
                        orderNumber: po.orderNumber,
                        before: purchaseOrderTransitionSnapshot(po),
                        after: purchaseOrderTransitionSnapshot(updated),
                    }),
                },
            });
            return { outcome: 'UPDATED' as const, data: updated };
        });

        if (result.outcome === 'NOT_FOUND') {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }
        if (result.outcome === 'REJECTED') {
            return res.status(result.rejection.status).json({
                error: result.rejection.error,
                code: result.rejection.code,
            });
        }
        res.json({ success: true, data: result.data });
    } catch (e: any) {
        console.error('Error cancelando OC:', e.message);
        res.status(500).json({ error: 'Error al cancelar la orden de compra' });
    }
});

// ── POST /:id/receive — recepción de mercadería (goods receipt) ─────────────
router.post('/:id/receive', authenticate, checkRole(ROLES_RECEIVE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const userId: string = req.userId;
    const parsed = procurementReceiptRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({
            error: 'La recepción no tiene un formato válido',
            code: 'INVALID_RECEIPT_PAYLOAD',
            details: parsed.error.flatten().fieldErrors,
        });
    }

    try {
        // Compatibilidad con clientes anteriores: sin bodega explícita solo se
        // materializa Principal cuando el tenant todavía no tiene ubicaciones.
        if (!parsed.data.warehouseId) {
            await asegurarBodegaPorDefecto(prisma, tenantId);
        }
        const result = await executeProcurementReceiptTransaction({
            db: prisma,
            tenantId,
            userId,
            purchaseOrderId: req.params.id,
            request: parsed.data,
        });

        res.json({
            success: true,
            data: req.role === BODEGUERO_ROLE
                ? redactBodegueroMeasuredOrder(result.purchaseOrder)
                : result.purchaseOrder,
            receipt: req.role === BODEGUERO_ROLE
                ? redactBodegueroGoodsReceipt(result.receipt)
                : result.receipt,
            replay: result.replay,
        });
    } catch (e: any) {
        if (e instanceof ProcurementReceiptError) {
            return res.status(e.httpStatus).json({ error: e.message, code: e.code });
        }
        if (e instanceof PurchaseOrderQuantityError) {
            return res.status(400).json({ error: e.message, code: e.code });
        }
        if (e instanceof StockError && e.code === 'WAREHOUSE_REQUIRED') {
            return res.status(400).json({ error: 'Seleccioná la bodega destino para recibir esta orden de compra', code: e.code });
        }
        if (e instanceof StockError && e.code === 'WAREHOUSE_NOT_FOUND') {
            return res.status(404).json({ error: 'La bodega destino no existe, está inactiva o no pertenece a tu negocio', code: e.code });
        }
        console.error('Error recibiendo OC:', e?.message ?? 'Error desconocido');
        res.status(500).json({ error: 'Error al recibir la orden de compra' });
    }
});

// ── POST /:id/close-short — cierre administrativo de saldo no entregable ────
router.post('/:id/close-short', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const parsed = purchaseOrderCloseShortRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({
            error: 'El cierre corto no tiene un formato válido',
            code: 'INVALID_CLOSE_SHORT_PAYLOAD',
            details: parsed.error.flatten().fieldErrors,
        });
    }

    try {
        const result = await executePurchaseOrderCloseShortTransaction({
            db: prisma,
            tenantId: req.tenantId,
            userId: req.userId,
            purchaseOrderId: req.params.id,
            request: parsed.data,
        });
        res.json({
            success: true,
            data: result.purchaseOrder,
            closeShort: result.closeShort,
            replay: result.replay,
        });
    } catch (e: any) {
        if (e instanceof PurchaseOrderCloseShortError) {
            return res.status(e.httpStatus).json({ error: e.message, code: e.code });
        }
        if (e instanceof PurchaseOrderQuantityError) {
            return res.status(400).json({ error: e.message, code: e.code });
        }
        console.error('Error cerrando corto OC:', e?.message ?? 'Error desconocido');
        res.status(500).json({ error: 'Error al cerrar el saldo de la orden de compra' });
    }
});

export default router;
