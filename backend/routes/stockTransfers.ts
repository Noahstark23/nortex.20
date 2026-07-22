/**
 * NORTEX — Transferencias entre bodegas (Fase 3 de multi-bodega).
 *
 * Mueve existencias origen→destino de forma ATÓMICA con SUFICIENCIA POR BODEGA
 * en el origen (primer guard per-warehouse del sistema): el débito es un
 * updateMany condicional (stock >= qty) sobre la fila de origen — guard y
 * escritura en la misma sentencia. Product.stock (agregado) NO cambia: una
 * transferencia no altera el total, solo su distribución (invariante intacto).
 *
 * Kardex: dos asientos por ítem (TRANSFER_OUT / TRANSFER_IN) con warehouseId;
 * en transferencias, stockBefore/After son los de LA FILA DE BODEGA (el
 * warehouseId presente lo hace explícito). AuditLog en la misma transacción.
 *
 * Aislamiento: TODO query filtra por tenantId (del JWT, nunca del body).
 */
import express from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { materializeWarehouseRow } from '../services/stockService';
import { validate, StockTransferSchema } from '../validation/schemas';

const router = express.Router();
const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER'];

/** Error de dominio con código + metadatos (no viaja info en strings con separador). */
class TransferError extends Error {
    constructor(public code: 'WAREHOUSE_NOT_FOUND' | 'PRODUCT_NOT_FOUND' | 'INSUFFICIENT',
                public meta?: { name?: string; available?: number }) {
        super(code);
    }
}

// ── GET / — historial de transferencias ─────────────────────────────────────
router.get('/', authenticate, async (req: any, res: any) => {
    try {
        const transfers = await prisma.stockTransfer.findMany({
            where: { tenantId: req.tenantId },
            include: { fromWarehouse: { select: { name: true } }, toWarehouse: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json({ success: true, data: transfers });
    } catch (e: any) {
        console.error('Error listando transferencias:', e.message);
        res.status(500).json({ error: 'Error al listar transferencias' });
    }
});

// ── POST / — ejecutar transferencia (inmediata, atómica) ────────────────────
router.post('/', authenticate, checkRole(ROLES_WRITE), validate(StockTransferSchema), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const userId: string = req.userId;
    const { fromWarehouseId, toWarehouseId, notes, items } = req.body;

    if (fromWarehouseId === toWarehouseId) {
        return res.status(400).json({ error: 'Origen y destino no pueden ser la misma bodega' });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Ambas bodegas del tenant y activas.
            const [from, to] = await Promise.all([
                tx.warehouse.findFirst({ where: { id: fromWarehouseId, tenantId, isActive: true } }),
                tx.warehouse.findFirst({ where: { id: toWarehouseId, tenantId, isActive: true } }),
            ]);
            if (!from || !to) throw new TransferError('WAREHOUSE_NOT_FOUND');

            // Lectura CONSOLIDADA de productos (una query, no N) — acorta la tx.
            const productIds = items.map((it: { productId: string }) => it.productId);
            const products = await tx.product.findMany({
                where: { id: { in: productIds }, tenantId },
                select: { id: true, name: true },
            });
            const productById = new Map(products.map((p) => [p.id, p]));

            const snapshot: { productId: string; name: string; quantity: number }[] = [];

            for (const it of items) {
                const qty = Number(it.quantity);
                const product = productById.get(it.productId);
                if (!product) throw new TransferError('PRODUCT_NOT_FOUND');

                // Materializar AMBAS filas si su stock era implícito (default
                // perezosa): la de origen para poder aplicar el guard condicional,
                // y la de DESTINO para que un crédito a la default no cree una
                // fila `stock: qty` que borre el stock implícito del desglose
                // (invariante Σ ProductStock == Product.stock).
                await materializeWarehouseRow(tx, { tenantId, productId: product.id, warehouseId: from.id, isDefault: from.isDefault });
                await materializeWarehouseRow(tx, { tenantId, productId: product.id, warehouseId: to.id, isDefault: to.isDefault });

                // DÉBITO con suficiencia POR BODEGA: guard y escritura en el mismo UPDATE.
                const debited = await tx.productStock.updateMany({
                    where: { productId: product.id, warehouseId: from.id, tenantId, stock: { gte: qty } },
                    data: { stock: { decrement: qty } },
                });
                if (debited.count === 0) {
                    const row = await tx.productStock.findFirst({
                        where: { productId: product.id, warehouseId: from.id, tenantId },
                        select: { stock: true },
                    });
                    throw new TransferError('INSUFFICIENT', { name: product.name, available: Number(row?.stock ?? 0) });
                }
                const fromRow = await tx.productStock.findFirstOrThrow({
                    where: { productId: product.id, warehouseId: from.id, tenantId }, select: { stock: true },
                });

                // CRÉDITO al destino (la fila ya existe: materializada arriba).
                const credited = await tx.productStock.updateMany({
                    where: { productId: product.id, warehouseId: to.id, tenantId },
                    data: { stock: { increment: qty } },
                });
                if (credited.count === 0) throw new Error(`CREDIT_ROW_MISSING:${product.id}`);
                const toRow = await tx.productStock.findFirstOrThrow({
                    where: { productId: product.id, warehouseId: to.id, tenantId }, select: { stock: true },
                });

                // Kardex por bodega: before/after de la FILA (warehouseId lo explicita).
                await tx.kardexMovement.createMany({
                    data: [
                        {
                            tenantId, productId: product.id, type: 'TRANSFER_OUT', quantity: -qty,
                            stockBefore: Number(fromRow.stock) + qty, stockAfter: Number(fromRow.stock),
                            referenceType: 'TRANSFER', reason: `Transferencia ${from.name} → ${to.name}`,
                            userId, warehouseId: from.id,
                        },
                        {
                            tenantId, productId: product.id, type: 'TRANSFER_IN', quantity: qty,
                            stockBefore: Number(toRow.stock) - qty, stockAfter: Number(toRow.stock),
                            referenceType: 'TRANSFER', reason: `Transferencia ${from.name} → ${to.name}`,
                            userId, warehouseId: to.id,
                        },
                    ],
                });

                snapshot.push({ productId: product.id, name: product.name, quantity: qty });
            }

            const transfer = await tx.stockTransfer.create({
                data: {
                    tenantId, fromWarehouseId: from.id, toWarehouseId: to.id,
                    notes: notes ? String(notes) : null, items: snapshot, createdBy: userId,
                },
            });

            await tx.auditLog.create({
                data: {
                    tenantId, userId, action: 'STOCK_TRANSFER',
                    details: JSON.stringify({ transferId: transfer.id, from: from.name, to: to.name, items: snapshot }),
                },
            });

            return transfer;
        });

        res.status(201).json({ success: true, data: result });
    } catch (e: any) {
        if (e instanceof TransferError) {
            if (e.code === 'WAREHOUSE_NOT_FOUND') return res.status(404).json({ error: 'Bodega no encontrada o inactiva' });
            if (e.code === 'PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'Producto no encontrado' });
            return res.status(422).json({
                error: `Stock insuficiente en la bodega de origen para "${e.meta?.name}" (disponible: ${e.meta?.available})`,
            });
        }
        // Deadlock InnoDB (transferencias cruzadas A→B y B→A concurrentes toman
        // los row-locks en orden opuesto): la tx perdedora se revierte completa
        // (sin corrupción) — pedimos reintento en vez de un 500 opaco.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
            return res.status(409).json({ error: 'Conflicto de concurrencia; reintentá la transferencia' });
        }
        console.error('Error en transferencia:', e?.message ?? e);
        res.status(500).json({ error: 'Error al ejecutar la transferencia' });
    }
});

export default router;
