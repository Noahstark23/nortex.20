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
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { BODEGUERO_ROLE, redactBodegueroPurchaseOrder } from '../security/bodegueroPolicy';
import {
    applyStockDelta,
    asegurarBodegaPorDefecto,
    resolveOperationalWarehouse,
    StockError,
    weightedAverageCost,
} from '../services/stockService';
import { normalizeCalendarDateInput } from '../lib/calendarDate';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const prisma = new PrismaClient();
const router = express.Router();

const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER'];
const ROLES_RECEIVE = ['OWNER', 'ADMIN', 'MANAGER', BODEGUERO_ROLE];

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

const receiptDateOnly = z.iso.date();
const receiptDateTimeWithOffset = z.iso.datetime({ offset: true });
const parseReceiptExpiryDate = (value: string): Date | null => {
    if (!receiptDateOnly.safeParse(value).success
        && !receiptDateTimeWithOffset.safeParse(value).success) return null;
    return normalizeCalendarDateInput(value);
};

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
    destinationWarehouseId: string,
    lines: { item: { id: string; productId: string; unitCost: Prisma.Decimal }; line: ReceiptLine }[]
): Promise<ReceiptResult[]> {
    const results: ReceiptResult[] = [];
    for (const { item, line } of lines) {
        const recv = line.quantityReceived;

        const product = await tx.product.findFirst({
            where: { id: item.productId, tenantId },
            select: { id: true, name: true, cost: true, requiresBatchTracking: true },
        });
        if (!product) throw new Error(`Producto no encontrado: ${item.productId}`);

        const batchNumber = typeof line.batchNumber === 'string' ? line.batchNumber.trim() : '';
        const expiryDate = typeof line.expiryDate === 'string' ? parseReceiptExpiryDate(line.expiryDate) : null;
        if (product.requiresBatchTracking && (!batchNumber || !line.expiryDate)) {
            throw new Error(`LOTE_REQUERIDO|${product.name}`);
        }
        if (product.requiresBatchTracking && batchNumber.length > 100) {
            throw new Error(`LOTE_INVALIDO|${product.name}`);
        }
        if (product.requiresBatchTracking && !expiryDate) {
            throw new Error(`FECHA_LOTE_INVALIDA|${product.name}`);
        }

        // Stock por applyStockDelta: incremento ATÓMICO + doble escritura del
        // desglose por bodega (invariante multi-bodega: Σ bodegas == agregado).
        // El stockBefore que devuelve (post-lock) es el autoritativo para el costo.
        const { stockBefore, stockAfter, warehouseId } = await applyStockDelta(tx, {
            tenantId,
            productId: product.id,
            delta: recv,
            enforceSufficient: false,
            warehouseId: destinationWarehouseId,
        });

        // Costo promedio ponderado con el costo de la OC.
        const oldStock = new Decimal(stockBefore);
        // C2 — costo re-leído con la fila YA BLOQUEADA por applyStockDelta (FOR
        // UPDATE). El `product.cost` de arriba viene de un findFirst NO-bloqueante
        // ANTES del lock (snapshot REPEATABLE READ): con recepciones concurrentes
        // del mismo producto quedaría STALE y el promedio mezclaría stock nuevo con
        // costo viejo. La lectura locking devuelve el costo comprometido más reciente.
        const lockedCostRows: any[] = await tx.$queryRaw`SELECT cost FROM \`Product\` WHERE id = ${product.id} AND \`tenantId\` = ${tenantId} FOR UPDATE`;
        const oldCost = new Decimal((lockedCostRows[0]?.cost ?? 0).toString());
        const newStock = new Decimal(stockAfter);
        // Promedio ponderado móvil (función pura compartida — regla C1 adentro).
        const newAvgCostD = weightedAverageCost(oldStock, oldCost, recv, item.unitCost.toString());

        await tx.product.update({
            where: { id: product.id },
            data: { cost: newAvgCostD.toNumber() },
        });

        // Control de lotes (FEFO/alertas) si el producto lo requiere y vino lote+vencimiento.
        let batchId: string | null = null;
        if (product.requiresBatchTracking && batchNumber && expiryDate) {
            const batch = await tx.productBatch.upsert({
                where: { productId_batchNumber: { productId: product.id, batchNumber } },
                update: { stock: { increment: recv } },
                create: {
                    tenantId,
                    productId: product.id,
                    batchNumber,
                    expiryDate,
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
                // Bodega real del movimiento (la default hoy): sin esto la
                // reconstrucción del stock por bodega desde Kardex queda coja.
                warehouseId,
            },
        });

        await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { quantityReceived: { increment: recv } },
        });

        results.push({
            productId: product.id,
            quantityReceived: recv,
            unitCost: item.unitCost.toString(),
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
            include: {
                supplier: { select: { name: true } },
                items: { include: { product: { select: { requiresBatchTracking: true } } } },
                receipts: {
                    select: {
                        items: { select: { productId: true, quantity: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        res.json({
            success: true,
            data: req.role === BODEGUERO_ROLE
                ? orders.map(redactBodegueroPurchaseOrder)
                : orders,
        });
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
            include: {
                supplier: true,
                items: { include: { product: { select: { requiresBatchTracking: true } } } },
                receipts: { select: { id: true, invoiceNumber: true, total: true, createdAt: true } },
            },
        });
        if (!order) return res.status(404).json({ error: 'Orden de compra no encontrada' });
        res.json({
            success: true,
            data: req.role === BODEGUERO_ROLE
                ? redactBodegueroPurchaseOrder(order)
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
router.post('/:id/receive', authenticate, checkRole(ROLES_RECEIVE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const userId: string = req.userId;
    const requestedWarehouseId = req.body?.warehouseId;
    const lines: ReceiptLine[] = Array.isArray(req.body?.items) ? req.body.items : [];

    if (requestedWarehouseId !== undefined
        && (typeof requestedWarehouseId !== 'string' || !requestedWarehouseId.trim())) {
        return res.status(400).json({ error: 'La bodega de destino es inválida', code: 'WAREHOUSE_NOT_FOUND' });
    }

    if (lines.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un ítem a recibir' });
    }
    for (const l of lines) {
        if (!l?.itemId || typeof l.itemId !== 'string' || !(Number(l.quantityReceived) > 0)) {
            return res.status(400).json({ error: 'Cada línea requiere itemId y quantityReceived > 0' });
        }
    }

    try {
        await asegurarBodegaPorDefecto(prisma, tenantId);
        const result = await prisma.$transaction(async (tx) => {
            // S38 — lock del header ANTES de cualquier lectura: dos receives
            // concurrentes de la misma OC pasaban ambos el chequeo de estado (el
            // findFirst no bloquea) y entraban el stock 2×. Con el FOR UPDATE el
            // segundo espera el commit del primero, y como esta es la PRIMERA
            // sentencia de la tx, su snapshot se abre después y las lecturas de
            // abajo ya ven el estado y quantityReceived actualizados.
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${req.params.id} AND \`tenantId\` = ${tenantId} FOR UPDATE`;
            const po = await tx.purchaseOrder.findFirst({
                where: { id: req.params.id, tenantId },
                include: { items: true },
            });
            if (!po) throw new Error('NOT_FOUND');
            if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
                throw new Error(`INVALID_STATUS:${po.status}`);
            }

            const destinationWarehouse = await resolveOperationalWarehouse(
                tx,
                tenantId,
                typeof requestedWarehouseId === 'string' ? requestedWarehouseId.trim() : null,
            );

            // Emparejar cada línea con su ítem de la OC (del mismo tenant por construcción).
            const itemById = new Map(po.items.map((i) => [i.id, i]));
            const seenItemIds = new Set<string>();
            const matched: { item: typeof po.items[number]; line: ReceiptLine }[] = [];
            for (const line of lines) {
                const item = itemById.get(line.itemId);
                if (!item) throw new Error(`ITEM_NOT_IN_PO:${line.itemId}`);
                // S46 — un itemId repetido en el payload sumaría stock 2× en la misma recepción.
                if (seenItemIds.has(line.itemId)) throw new Error(`ITEM_REPETIDO:${line.itemId}`);
                seenItemIds.add(line.itemId);
                // S46 — tope: lo recibido acumulado no puede exceder lo pedido. Un
                // sobre-envío real del proveedor se registra como compra directa o
                // ajuste explícito, no inflando la OC.
                const recv = Number(line.quantityReceived);
                const pendiente = new Decimal(item.quantityOrdered.toString()).minus(item.quantityReceived.toString());
                if (new Decimal(recv.toString()).greaterThan(pendiente)) {
                    throw new Error(`SOBRE_RECEPCION|${item.productName}|${pendiente.toString()}`);
                }
                matched.push({ item, line: { ...line, quantityReceived: recv } });
            }

            const receiptResults = await applyGoodsReceipt(
                tx,
                tenantId,
                userId,
                po.id,
                po.orderNumber,
                destinationWarehouse.id,
                matched,
            );

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
                        poId: po.id,
                        orderNumber: po.orderNumber,
                        newStatus,
                        warehouseId: destinationWarehouse.id,
                        warehouseName: destinationWarehouse.name,
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

        res.json({
            success: true,
            data: req.role === BODEGUERO_ROLE ? redactBodegueroPurchaseOrder(result) : result,
        });
    } catch (e: any) {
        if (e instanceof StockError
            && (e.code === 'WAREHOUSE_REQUIRED' || e.code === 'WAREHOUSE_NOT_FOUND')) {
            return res.status(400).json({ error: e.message, code: e.code });
        }
        const msg: string = e?.message ?? '';
        if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'Orden de compra no encontrada' });
        if (msg.startsWith('INVALID_STATUS:')) return res.status(400).json({ error: `No se puede recibir una OC en estado ${msg.split(':')[1]}` });
        if (msg.startsWith('ITEM_NOT_IN_PO:')) return res.status(400).json({ error: 'Una línea no pertenece a esta orden de compra' });
        if (msg.startsWith('ITEM_REPETIDO:')) return res.status(400).json({ error: 'Hay líneas repetidas del mismo ítem en la recepción' });
        if (msg.startsWith('LOTE_REQUERIDO|')) return res.status(400).json({ error: `Ingresá lote y vencimiento para ${msg.slice('LOTE_REQUERIDO|'.length)}` });
        if (msg.startsWith('LOTE_INVALIDO|')) return res.status(400).json({ error: `El lote de ${msg.slice('LOTE_INVALIDO|'.length)} es inválido` });
        if (msg.startsWith('FECHA_LOTE_INVALIDA|')) return res.status(400).json({ error: `La fecha de vencimiento de ${msg.slice('FECHA_LOTE_INVALIDA|'.length)} es inválida` });
        if (msg.startsWith('SOBRE_RECEPCION|')) {
            const [, nombre, pendiente] = msg.split('|');
            return res.status(400).json({ error: `No podés recibir más de lo pedido: a "${nombre}" le quedan ${pendiente} por recibir` });
        }
        console.error('Error recibiendo OC:', msg);
        res.status(500).json({ error: 'Error al recibir la orden de compra' });
    }
});

export default router;
