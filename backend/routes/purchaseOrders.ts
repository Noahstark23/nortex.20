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
import { PrismaClient, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { applyStockDelta } from '../services/stockService';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const prisma = new PrismaClient();
const router = express.Router();

const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER'];

interface ReceiptLine {
    itemId: string;
    quantityReceived: number;
    batchNumber?: string | null;
    expiryDate?: string | null;
}

// Resumen before/after por producto de una recepción, para el AuditLog inmutable.
interface ReceiptResult {
    productId: string;
    quantityReceived: number;
    unitCost: string;
    stockBefore: string;
    stockAfter: string;
    costBefore: string;
    costAfter: string;
}

/**
 * Aplica la entrada física de una recepción dentro de una transacción:
 * stock (incremento atómico) + costo promedio + lote (FEFO) + Kardex, y suma a
 * quantityReceived del ítem de la OC. Devuelve el resumen por producto.
 */
async function applyGoodsReceipt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    poId: string,
    poNumber: string,
    lines: { item: { id: string; productId: string; unitCost: Prisma.Decimal }; line: ReceiptLine }[]
): Promise<ReceiptResult[]> {
    const results: ReceiptResult[] = [];
    for (const { item, line } of lines) {
        const recv = line.quantityReceived;

        const product = await tx.product.findFirst({
            where: { id: item.productId, tenantId },
            select: { id: true, cost: true, requiresBatchTracking: true },
        });
        if (!product) throw new Error(`Producto no encontrado: ${item.productId}`);

        // Stock por applyStockDelta: incremento ATÓMICO + doble escritura del
        // desglose por bodega (invariante multi-bodega: Σ bodegas == agregado).
        // El stockBefore que devuelve (post-lock) es el autoritativo para el costo.
        const { stockBefore, stockAfter } = await applyStockDelta(tx, {
            tenantId,
            productId: product.id,
            delta: recv,
            enforceSufficient: false,
        });

        // Costo promedio ponderado con el costo de la OC.
        const oldStock = new Decimal(stockBefore);
        const oldCost = new Decimal(product.cost.toString());
        const unitCost = new Decimal(item.unitCost.toString());
        const recvD = new Decimal(recv);
        const newStock = new Decimal(stockAfter);
        const newAvgCostD = newStock.gt(0)
            ? oldStock.mul(oldCost).plus(recvD.mul(unitCost)).dividedBy(newStock).toDecimalPlaces(4)
            : unitCost;

        await tx.product.update({
            where: { id: product.id },
            data: { cost: newAvgCostD.toNumber() },
        });

        // Control de lotes (FEFO/alertas) si el producto lo requiere y vino lote+vencimiento.
        let batchId: string | null = null;
        if (product.requiresBatchTracking && line.batchNumber && line.expiryDate) {
            const batch = await tx.productBatch.upsert({
                where: { productId_batchNumber: { productId: product.id, batchNumber: line.batchNumber } },
                update: { stock: { increment: recv } },
                create: {
                    tenantId,
                    productId: product.id,
                    batchNumber: line.batchNumber,
                    expiryDate: new Date(line.expiryDate),
                    stock: recv,
                },
            });
            batchId = batch.id;
        }

        await tx.kardexMovement.create({
            data: {
                tenantId,
                productId: product.id,
                type: 'IN_PURCHASE',
                quantity: recv,
                stockBefore,
                stockAfter,
                referenceId: poId,
                referenceType: 'PURCHASE_ORDER',
                reason: `Recepción de Orden de Compra ${poNumber}`,
                userId,
                batchId,
            },
        });

        await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { quantityReceived: { increment: recv } },
        });

        results.push({
            productId: product.id,
            quantityReceived: recv,
            unitCost: unitCost.toString(),
            stockBefore: oldStock.toString(),
            stockAfter: newStock.toString(),
            costBefore: oldCost.toString(),
            costAfter: newAvgCostD.toString(),
        });
    }
    return results;
}

// ── GET / — listar órdenes de compra del tenant ─────────────────────────────
router.get('/', authenticate, async (req: any, res: any) => {
    try {
        const orders = await prisma.purchaseOrder.findMany({
            where: { tenantId: req.tenantId },
            include: { supplier: { select: { name: true } }, items: true },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        res.json({ success: true, data: orders });
    } catch (e: any) {
        console.error('Error listando OC:', e.message);
        res.status(500).json({ error: 'Error al listar órdenes de compra' });
    }
});

// ── GET /:id — detalle ──────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req: any, res: any) => {
    try {
        const order = await prisma.purchaseOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId },
            include: { supplier: true, items: true, receipts: { select: { id: true, invoiceNumber: true, total: true, createdAt: true } } },
        });
        if (!order) return res.status(404).json({ error: 'Orden de compra no encontrada' });
        res.json({ success: true, data: order });
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
    for (const it of items) {
        if (!it?.productId || typeof it.productId !== 'string' ||
            !(Number(it.quantity) > 0) || !(Number(it.unitCost) >= 0)) {
            return res.status(400).json({ error: 'Cada ítem requiere productId, quantity > 0 y unitCost ≥ 0' });
        }
    }

    try {
        // Validar proveedor y productos pertenecientes al tenant.
        const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId } });
        if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });

        const productIds = [...new Set(items.map((i: any) => String(i.productId)))];
        const products = await prisma.product.findMany({
            where: { id: { in: productIds }, tenantId },
            select: { id: true, name: true },
        });
        const nameById = new Map(products.map((p) => [p.id, p.name]));
        if (nameById.size !== productIds.length) {
            return res.status(400).json({ error: 'Uno o más productos no pertenecen a tu negocio' });
        }

        // Correlativo por tenant. El @@unique([tenantId, orderNumber]) protege la integridad.
        const count = await prisma.purchaseOrder.count({ where: { tenantId } });
        const orderNumber = `OC-${String(count + 1).padStart(4, '0')}`;

        const created = await prisma.purchaseOrder.create({
            data: {
                tenantId,
                supplierId,
                orderNumber,
                status: 'DRAFT',
                notes: notes ? String(notes) : null,
                expectedDate: expectedDate ? new Date(expectedDate) : null,
                createdBy: req.userId,
                items: {
                    create: items.map((it: any) => ({
                        productId: String(it.productId),
                        productName: nameById.get(String(it.productId))!,
                        quantityOrdered: Number(it.quantity),
                        unitCost: new Decimal(it.unitCost).toDecimalPlaces(2).toNumber(),
                    })),
                },
            },
            include: { items: true },
        });

        res.status(201).json({ success: true, data: created });
    } catch (e: any) {
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
        const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, tenantId } });
        if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
        if (po.status !== 'DRAFT') {
            return res.status(400).json({ error: `No se puede aprobar una OC en estado ${po.status}` });
        }
        const updated = await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { status: 'APPROVED', approvedBy: req.userId, approvedAt: new Date() },
        });
        await prisma.auditLog.create({
            data: { tenantId, userId: req.userId, action: 'PO_APPROVED', details: JSON.stringify({ poId: po.id, orderNumber: po.orderNumber }) },
        });
        res.json({ success: true, data: updated });
    } catch (e: any) {
        console.error('Error aprobando OC:', e.message);
        res.status(500).json({ error: 'Error al aprobar la orden de compra' });
    }
});

// ── POST /:id/cancel — → CANCELLED (no si ya está RECEIVED) ──────────────────
router.post('/:id/cancel', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    try {
        const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, tenantId } });
        if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
        if (po.status === 'RECEIVED' || po.status === 'CANCELLED') {
            return res.status(400).json({ error: `No se puede cancelar una OC en estado ${po.status}` });
        }
        const updated = await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CANCELLED' } });
        res.json({ success: true, data: updated });
    } catch (e: any) {
        console.error('Error cancelando OC:', e.message);
        res.status(500).json({ error: 'Error al cancelar la orden de compra' });
    }
});

// ── POST /:id/receive — recepción de mercadería (goods receipt) ─────────────
router.post('/:id/receive', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const userId: string = req.userId;
    const lines: ReceiptLine[] = Array.isArray(req.body?.items) ? req.body.items : [];

    if (lines.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un ítem a recibir' });
    }
    for (const l of lines) {
        if (!l?.itemId || typeof l.itemId !== 'string' || !(Number(l.quantityReceived) > 0)) {
            return res.status(400).json({ error: 'Cada línea requiere itemId y quantityReceived > 0' });
        }
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const po = await tx.purchaseOrder.findFirst({
                where: { id: req.params.id, tenantId },
                include: { items: true },
            });
            if (!po) throw new Error('NOT_FOUND');
            if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
                throw new Error(`INVALID_STATUS:${po.status}`);
            }

            // Emparejar cada línea con su ítem de la OC (del mismo tenant por construcción).
            const itemById = new Map(po.items.map((i) => [i.id, i]));
            const matched: { item: typeof po.items[number]; line: ReceiptLine }[] = [];
            for (const line of lines) {
                const item = itemById.get(line.itemId);
                if (!item) throw new Error(`ITEM_NOT_IN_PO:${line.itemId}`);
                matched.push({ item, line: { ...line, quantityReceived: Number(line.quantityReceived) } });
            }

            const receiptResults = await applyGoodsReceipt(tx, tenantId, userId, po.id, po.orderNumber, matched);

            // Recalcular estado: RECEIVED si todo lo pedido fue recibido, si no PARTIALLY_RECEIVED.
            const fresh = await tx.purchaseOrder.findUniqueOrThrow({
                where: { id: po.id }, include: { items: true },
            });
            const fullyReceived = fresh.items.every((i) => Number(i.quantityReceived) >= Number(i.quantityOrdered));
            const newStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

            const updated = await tx.purchaseOrder.update({
                where: { id: po.id },
                data: { status: newStatus },
                include: { items: true },
            });

            await tx.auditLog.create({
                data: {
                    tenantId, userId, action: 'PO_RECEIVED',
                    details: JSON.stringify({
                        poId: po.id, orderNumber: po.orderNumber, newStatus,
                        received: matched.map((m, idx) => {
                            const r = receiptResults[idx];
                            return {
                                itemId: m.item.id,
                                productId: r.productId,
                                qty: m.line.quantityReceived,
                                unitCost: r.unitCost,
                                stockBefore: r.stockBefore,
                                stockAfter: r.stockAfter,
                                costBefore: r.costBefore,
                                costAfter: r.costAfter,
                            };
                        }),
                    }),
                },
            });

            return updated;
        });

        res.json({ success: true, data: result });
    } catch (e: any) {
        const msg: string = e?.message ?? '';
        if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'Orden de compra no encontrada' });
        if (msg.startsWith('INVALID_STATUS:')) return res.status(400).json({ error: `No se puede recibir una OC en estado ${msg.split(':')[1]}` });
        if (msg.startsWith('ITEM_NOT_IN_PO:')) return res.status(400).json({ error: 'Una línea no pertenece a esta orden de compra' });
        console.error('Error recibiendo OC:', msg);
        res.status(500).json({ error: 'Error al recibir la orden de compra' });
    }
});

export default router;
