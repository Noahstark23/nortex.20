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
import { PrismaClient, Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { materializeWarehouseRow } from '../services/stockService';

const prisma = new PrismaClient();
const router = express.Router();
const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER'];

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
router.post('/', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const userId: string = req.userId;
    const { fromWarehouseId, toWarehouseId, notes, items } = req.body ?? {};

    if (!fromWarehouseId || !toWarehouseId || typeof fromWarehouseId !== 'string' || typeof toWarehouseId !== 'string') {
        return res.status(400).json({ error: 'Bodega de origen y destino son requeridas' });
    }
    if (fromWarehouseId === toWarehouseId) {
        return res.status(400).json({ error: 'Origen y destino no pueden ser la misma bodega' });
    }
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un ítem' });
    }
    for (const it of items) {
        if (!it?.productId || typeof it.productId !== 'string' || !(Number(it.quantity) > 0)) {
            return res.status(400).json({ error: 'Cada ítem requiere productId y quantity > 0' });
        }
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Ambas bodegas del tenant y activas.
            const [from, to] = await Promise.all([
                tx.warehouse.findFirst({ where: { id: fromWarehouseId, tenantId, isActive: true } }),
                tx.warehouse.findFirst({ where: { id: toWarehouseId, tenantId, isActive: true } }),
            ]);
            if (!from || !to) throw new Error('WAREHOUSE_NOT_FOUND');

            const snapshot: { productId: string; name: string; quantity: number }[] = [];

            for (const it of items) {
                const qty = Number(it.quantity);
                const product = await tx.product.findFirst({
                    where: { id: String(it.productId), tenantId },
                    select: { id: true, name: true },
                });
                if (!product) throw new Error(`PRODUCT_NOT_FOUND:${it.productId}`);

                // Materializar la fila de origen si su stock era implícito (default
                // perezosa) para poder aplicar el guard condicional sobre ella.
                await materializeWarehouseRow(tx, { tenantId, productId: product.id, warehouseId: from.id, isDefault: from.isDefault });

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
                    throw new Error(`INSUFFICIENT:${product.name}:${Number(row?.stock ?? 0)}`);
                }
                const fromRow = await tx.productStock.findFirstOrThrow({
                    where: { productId: product.id, warehouseId: from.id, tenantId }, select: { stock: true },
                });

                // CRÉDITO al destino (upsert race-safe vía patrón P2002).
                const credited = await tx.productStock.updateMany({
                    where: { productId: product.id, warehouseId: to.id, tenantId },
                    data: { stock: { increment: qty } },
                });
                if (credited.count === 0) {
                    try {
                        await tx.productStock.create({ data: { tenantId, productId: product.id, warehouseId: to.id, stock: qty } });
                    } catch (err) {
                        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                            await tx.productStock.updateMany({
                                where: { productId: product.id, warehouseId: to.id, tenantId },
                                data: { stock: { increment: qty } },
                            });
                        } else throw err;
                    }
                }
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
        const msg: string = e?.message ?? '';
        if (msg === 'WAREHOUSE_NOT_FOUND') return res.status(404).json({ error: 'Bodega no encontrada o inactiva' });
        if (msg.startsWith('PRODUCT_NOT_FOUND:')) return res.status(404).json({ error: 'Producto no encontrado' });
        if (msg.startsWith('INSUFFICIENT:')) {
            const [, name, avail] = msg.split(':');
            return res.status(422).json({ error: `Stock insuficiente en la bodega de origen para "${name}" (disponible: ${avail})` });
        }
        console.error('Error en transferencia:', msg);
        res.status(500).json({ error: 'Error al ejecutar la transferencia' });
    }
});

export default router;
