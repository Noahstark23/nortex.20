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
            include: {
                _count: { select: { productStocks: true } },
                seller: { select: { id: true, name: true, status: true } },
            },
        });
        res.json({ success: true, data: warehouses });
    } catch (e: any) {
        console.error('Error listando bodegas:', e.message);
        res.status(500).json({ error: 'Error al listar bodegas' });
    }
});

// Carga de ruta: el User asignado como dueño de la carga debe ser del MISMO
// tenant y estar activo — sin esto, un sellerId ajeno colgaría la bodega de un
// usuario de otro tenant. El unique [tenantId, sellerId] de la BD garantiza a
// lo sumo una carga por vendedor (P2002 si ya tiene).
async function validarVendedorDeCarga(sellerId: string, tenantId: string): Promise<boolean> {
    const u = await prisma.user.findFirst({
        where: { id: sellerId, tenantId, status: { not: 'DISABLED' } },
        select: { id: true },
    });
    return u !== null;
}

// ── POST / — crear bodega ────────────────────────────────────────────────────
router.post('/', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { name, address, sellerId } = req.body ?? {};
    const cleanName = String(name ?? '').trim();
    if (!cleanName) return res.status(400).json({ error: 'El nombre de la bodega es requerido' });

    try {
        if (sellerId != null && !(await validarVendedorDeCarga(String(sellerId), tenantId))) {
            return res.status(400).json({ error: 'Vendedor inválido' });
        }
        // La primera bodega del tenant nace como default — y una carga de
        // vendedor jamás puede ser la default (recibiría todos los flujos sin
        // bodega explícita del tenant).
        const count = await prisma.warehouse.count({ where: { tenantId } });
        if (sellerId != null && count === 0) {
            return res.status(400).json({ error: 'Creá primero la bodega principal; la carga de un vendedor no puede ser la default.' });
        }
        const created = await prisma.warehouse.create({
            data: {
                tenantId,
                name: cleanName,
                address: address ? String(address) : null,
                isDefault: count === 0,
                sellerId: sellerId != null ? String(sellerId) : null,
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
            return res.status(409).json({ error: 'Ya existe una bodega con ese nombre, o ese vendedor ya tiene su carga asignada' });
        }
        console.error('Error creando bodega:', e.message);
        res.status(500).json({ error: 'Error al crear la bodega' });
    }
});

// ── PUT /:id — renombrar / dirección / activar-desactivar ───────────────────
router.put('/:id', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { name, address, isActive, sellerId } = req.body ?? {};
    try {
        const wh = await prisma.warehouse.findFirst({ where: { id: req.params.id, tenantId } });
        if (!wh) return res.status(404).json({ error: 'Bodega no encontrada' });
        if (sellerId !== undefined && sellerId !== null) {
            if (wh.isDefault) return res.status(400).json({ error: 'La bodega principal no puede ser la carga de un vendedor.' });
            if (!(await validarVendedorDeCarga(String(sellerId), tenantId))) {
                return res.status(400).json({ error: 'Vendedor inválido' });
            }
        }
        if (name !== undefined && !String(name).trim()) {
            return res.status(400).json({ error: 'El nombre no puede estar vacío' });
        }
        if (isActive === false && wh.isDefault) {
            return res.status(400).json({ error: 'No se puede desactivar la bodega principal. Asigná otra default primero.' });
        }
        if (isActive === false) {
            // Bodega con existencias no se desactiva: las transferencias exigen
            // origen activo, así que su stock quedaría varado (invisible para
            // mover, aunque siga vendible por agregado).
            const withStock = await prisma.productStock.aggregate({
                where: { warehouseId: wh.id, tenantId },
                _sum: { stock: true },
            });
            if (Number(withStock._sum.stock ?? 0) > 0) {
                return res.status(409).json({ error: 'La bodega tiene existencias: transferilas antes de desactivarla.' });
            }
        }
        const updated = await prisma.warehouse.update({
            where: { id: wh.id },
            data: {
                ...(name !== undefined ? { name: String(name).trim() } : {}),
                ...(address !== undefined ? { address: address ? String(address) : null } : {}),
                ...(typeof isActive === 'boolean' ? { isActive } : {}),
                ...(sellerId !== undefined ? { sellerId: sellerId != null ? String(sellerId) : null } : {}),
            },
        });
        res.json({ success: true, data: updated });
    } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return res.status(409).json({ error: 'Ya existe una bodega con ese nombre, o ese vendedor ya tiene su carga asignada' });
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
            // La carga de un vendedor no puede ser la principal: la default
            // recibe TODOS los flujos sin bodega explícita del tenant.
            if (wh.sellerId) throw new Error('CARGA_NO_DEFAULT');
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
        if (e.message === 'CARGA_NO_DEFAULT') {
            return res.status(400).json({ error: 'La carga de un vendedor no puede ser la bodega principal.' });
        }
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
