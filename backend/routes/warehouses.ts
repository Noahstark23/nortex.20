/**
 * NORTEX — Multi-bodega (Fase 2: fundación) · CRUD + vista de stock por bodega.
 *
 * Regla de lectura bajo backfill perezoso: si un producto aún no tiene fila
 * ProductStock en la bodega DEFAULT, su stock ahí es implícito:
 *   defaultStock = Product.stock (agregado) − Σ filas explícitas de otras bodegas.
 * En cuanto el producto se mueve por primera vez, la fila explícita lo fija.
 *
 * Aislamiento: TODO query filtra por tenantId (del JWT, nunca del body).
 * Las transferencias entre bodegas llegan en Fase 3.
 */

import express from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { resolveDefaultWarehouseId } from '../services/stockService';

const prisma = new PrismaClient();
const router = express.Router();

const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER'];

// ── GET / — listar bodegas (garantiza que exista la default) ────────────────
router.get('/', authenticate, async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    try {
        await prisma.$transaction((tx) => resolveDefaultWarehouseId(tx, tenantId));
        const warehouses = await prisma.warehouse.findMany({
            where: { tenantId },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            include: { _count: { select: { productStocks: true } } },
        });
        res.json({ success: true, data: warehouses });
    } catch (e: any) {
        console.error('Error listando bodegas:', e.message);
        res.status(500).json({ error: 'Error al listar bodegas' });
    }
});

// ── POST / — crear bodega ────────────────────────────────────────────────────
router.post('/', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { name, address } = req.body ?? {};
    const cleanName = String(name ?? '').trim();
    if (!cleanName) return res.status(400).json({ error: 'El nombre de la bodega es requerido' });

    try {
        // La primera bodega del tenant nace como default.
        const count = await prisma.warehouse.count({ where: { tenantId } });
        const created = await prisma.warehouse.create({
            data: {
                tenantId,
                name: cleanName,
                address: address ? String(address) : null,
                isDefault: count === 0,
            },
        });
        await prisma.auditLog.create({
            data: {
                tenantId, userId: req.userId, action: 'WAREHOUSE_CREATED',
                details: JSON.stringify({ warehouseId: created.id, name: cleanName }),
            },
        });
        res.status(201).json({ success: true, data: created });
    } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return res.status(409).json({ error: 'Ya existe una bodega con ese nombre' });
        }
        console.error('Error creando bodega:', e.message);
        res.status(500).json({ error: 'Error al crear la bodega' });
    }
});

// ── PUT /:id — renombrar / dirección / activar-desactivar ───────────────────
router.put('/:id', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { name, address, isActive } = req.body ?? {};
    try {
        const wh = await prisma.warehouse.findFirst({ where: { id: req.params.id, tenantId } });
        if (!wh) return res.status(404).json({ error: 'Bodega no encontrada' });
        if (isActive === false && wh.isDefault) {
            return res.status(400).json({ error: 'No se puede desactivar la bodega principal. Asigná otra default primero.' });
        }
        const updated = await prisma.warehouse.update({
            where: { id: wh.id },
            data: {
                ...(name !== undefined ? { name: String(name).trim() } : {}),
                ...(address !== undefined ? { address: address ? String(address) : null } : {}),
                ...(typeof isActive === 'boolean' ? { isActive } : {}),
            },
        });
        res.json({ success: true, data: updated });
    } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return res.status(409).json({ error: 'Ya existe una bodega con ese nombre' });
        }
        console.error('Error actualizando bodega:', e.message);
        res.status(500).json({ error: 'Error al actualizar la bodega' });
    }
});

// ── POST /:id/set-default — cambiar la bodega principal (transaccional) ─────
router.post('/:id/set-default', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    try {
        const result = await prisma.$transaction(async (tx) => {
            const wh = await tx.warehouse.findFirst({ where: { id: req.params.id, tenantId, isActive: true } });
            if (!wh) return null;
            await tx.warehouse.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
            return tx.warehouse.update({ where: { id: wh.id }, data: { isDefault: true } });
        });
        if (!result) return res.status(404).json({ error: 'Bodega no encontrada o inactiva' });
        await prisma.auditLog.create({
            data: {
                tenantId, userId: req.userId, action: 'WAREHOUSE_SET_DEFAULT',
                details: JSON.stringify({ warehouseId: result.id, name: result.name }),
            },
        });
        res.json({ success: true, data: result });
    } catch (e: any) {
        console.error('Error cambiando bodega default:', e.message);
        res.status(500).json({ error: 'Error al cambiar la bodega principal' });
    }
});

// ── GET /:id/stock — existencias de una bodega ───────────────────────────────
router.get('/:id/stock', authenticate, async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    try {
        const wh = await prisma.warehouse.findFirst({ where: { id: req.params.id, tenantId } });
        if (!wh) return res.status(404).json({ error: 'Bodega no encontrada' });

        // Filas explícitas de esta bodega.
        const rows = await prisma.productStock.findMany({
            where: { warehouseId: wh.id, tenantId },
            include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        });
        const explicit = rows.map((r) => ({
            productId: r.product.id,
            name: r.product.name,
            sku: r.product.sku,
            unit: r.product.unit,
            stock: Number(r.stock),
            implicit: false,
        }));

        if (!wh.isDefault) {
            return res.json({ success: true, data: { warehouse: { id: wh.id, name: wh.name, isDefault: wh.isDefault }, items: explicit } });
        }

        // Bodega default: sumar el stock IMPLÍCITO de productos aún sin fila aquí
        // (legado bajo backfill perezoso): Product.stock − Σ filas de otras bodegas.
        const explicitIds = new Set(explicit.map((e) => e.productId));
        const products = await prisma.product.findMany({
            where: { tenantId, id: { notIn: [...explicitIds] } },
            select: {
                id: true, name: true, sku: true, unit: true, stock: true,
                productStocks: { select: { stock: true } },
            },
        });
        const implicit = products.map((p) => {
            const others = p.productStocks.reduce((s, r) => s + Number(r.stock), 0);
            return {
                productId: p.id,
                name: p.name,
                sku: p.sku,
                unit: p.unit,
                stock: Number(p.stock) - others,
                implicit: true,
            };
        }).filter((p) => p.stock !== 0);

        res.json({
            success: true,
            data: {
                warehouse: { id: wh.id, name: wh.name, isDefault: wh.isDefault },
                items: [...explicit, ...implicit],
            },
        });
    } catch (e: any) {
        console.error('Error obteniendo stock de bodega:', e.message);
        res.status(500).json({ error: 'Error al obtener el stock de la bodega' });
    }
});

export default router;
