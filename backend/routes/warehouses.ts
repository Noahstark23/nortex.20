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
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { resolveDefaultWarehouseId } from '../services/stockService';
import { assertWarehouseCanDeactivate, lockWarehouseTopology, setDefaultWarehouseSafely, WarehouseTopologyError } from '../services/warehouseTopologyService';
import { readProductWarehouseSnapshot } from '../services/productWarehouseSnapshot';

const router = express.Router();

const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER'];

// ── GET /product/:productId/stock — ubicación física, sin bootstrap ──────────
router.get('/product/:productId/stock', authenticate, async (req: any, res: any) => {
    try {
        const data = await readProductWarehouseSnapshot({ tenantId: req.tenantId, productId: req.params.productId });
        if (!data) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error consultando ubicación del producto:', error.message);
        res.status(500).json({ error: 'No se pudieron consultar las existencias por bodega. Reintentá.' });
    }
});

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
async function validarVendedorDeCarga(sellerId: string, tenantId: string, db: Pick<Prisma.TransactionClient, 'user'> = prisma): Promise<boolean> {
    const u = await db.user.findFirst({
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
        const created = await prisma.$transaction(async (tx) => {
        await lockWarehouseTopology(tx, tenantId);
        if (sellerId != null && !(await validarVendedorDeCarga(String(sellerId), tenantId, tx))) {
            throw new WarehouseTopologyError(400, 'INVALID_WAREHOUSE_SELLER', 'Vendedor inválido');
        }
        // La primera bodega del tenant nace como default — y una carga de
        // vendedor jamás puede ser la default (recibiría todos los flujos sin
        // bodega explícita del tenant).
        const count = await tx.warehouse.count({ where: { tenantId } });
        if (sellerId != null && count === 0) {
            throw new WarehouseTopologyError(400, 'SELLER_WAREHOUSE_NOT_DEFAULT', 'Creá primero la bodega principal; la carga de un vendedor no puede ser la default.');
        }
        const warehouse = await tx.warehouse.create({
            data: {
                tenantId,
                name: cleanName,
                address: address ? String(address) : null,
                isDefault: count === 0,
                sellerId: sellerId != null ? String(sellerId) : null,
            },
        });
        await tx.auditLog.create({
            data: {
                tenantId, userId: req.userId, action: 'WAREHOUSE_CREATED',
                details: JSON.stringify({ before: null, after: { warehouseId: warehouse.id, name: cleanName, isDefault: warehouse.isDefault } }),
            },
        });
        return warehouse;
        }, { maxWait: 5_000, timeout: 30_000 });
        res.status(201).json({ success: true, data: created });
    } catch (e: any) {
        if (e instanceof WarehouseTopologyError) return res.status(e.statusCode).json({ error: e.message, code: e.code });
        if (e?.code === 'P2034') return res.status(409).json({ error: 'Las bodegas cambiaron mientras se creaba la ubicación. Reintentá.', code: 'WAREHOUSE_CONCURRENT_CHANGE' });
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
        const result = await prisma.$transaction(async (tx) => {
        await lockWarehouseTopology(tx, tenantId);
        const wh = await tx.warehouse.findFirst({ where: { id: req.params.id, tenantId } });
        if (!wh) throw new WarehouseTopologyError(404, 'WAREHOUSE_NOT_FOUND', 'Bodega no encontrada');
        if (sellerId !== undefined && sellerId !== null) {
            if (wh.isDefault) throw new WarehouseTopologyError(400, 'SELLER_WAREHOUSE_NOT_DEFAULT', 'La bodega principal no puede ser la carga de un vendedor.');
            if (!(await validarVendedorDeCarga(String(sellerId), tenantId, tx))) {
                throw new WarehouseTopologyError(400, 'INVALID_WAREHOUSE_SELLER', 'Vendedor inválido');
            }
        }
        if (name !== undefined && !String(name).trim()) {
            throw new WarehouseTopologyError(400, 'INVALID_WAREHOUSE_NAME', 'El nombre no puede estar vacío');
        }
        if (isActive === false) {
            await assertWarehouseCanDeactivate(tx, { tenantId, warehouseId: wh.id, isDefault: wh.isDefault });
        }
        const updated = await tx.warehouse.update({
            where: { id: wh.id },
            data: {
                ...(name !== undefined ? { name: String(name).trim() } : {}),
                ...(address !== undefined ? { address: address ? String(address) : null } : {}),
                ...(typeof isActive === 'boolean' ? { isActive } : {}),
                ...(sellerId !== undefined ? { sellerId: sellerId != null ? String(sellerId) : null } : {}),
            },
        });
        await tx.auditLog.create({ data: {
            tenantId, userId: req.userId, action: 'WAREHOUSE_UPDATED',
            details: JSON.stringify({ warehouseId: wh.id, before: { name: wh.name, address: wh.address, isActive: wh.isActive, sellerId: wh.sellerId }, after: { name: updated.name, address: updated.address, isActive: updated.isActive, sellerId: updated.sellerId } }),
        } });
        return updated;
        }, { maxWait: 5_000, timeout: 30_000 });
        res.json({ success: true, data: result });
    } catch (e: any) {
        if (e instanceof WarehouseTopologyError) return res.status(e.statusCode).json({ error: e.message, code: e.code });
        if (e?.code === 'P2034') return res.status(409).json({ error: 'Otro movimiento está usando la bodega. Reintentá el cambio.', code: 'WAREHOUSE_CONCURRENT_CHANGE' });
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
        const result = await prisma.$transaction(tx => setDefaultWarehouseSafely(tx, {
            tenantId, userId: req.userId, warehouseId: req.params.id,
        }), { maxWait: 5_000, timeout: 30_000 });
        res.json({ success: true, data: result });
    } catch (e: any) {
        if (e instanceof WarehouseTopologyError) return res.status(e.statusCode).json({ error: e.message, code: e.code });
        if (e?.code === 'P2034') return res.status(409).json({ error: 'Otro movimiento está usando las bodegas. Reintentá el cambio.', code: 'WAREHOUSE_CONCURRENT_CHANGE' });
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
            include: {
                product: {
                    select: {
                        id: true,
                        name: true, brand: true,
                        sku: true,
                        unit: true,
                        saleMode: true,
                        quantityStep: true,
                    },
                },
            },
        });
        const explicit = rows.map((r) => ({
            productId: r.product.id,
            name: r.product.name, brand: r.product.brand,
            sku: r.product.sku,
            unit: r.product.unit,
            saleMode: r.product.saleMode,
            quantityStep: r.product.quantityStep?.toString() ?? null,
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
                id: true, name: true, brand: true, sku: true, unit: true, stock: true,
                saleMode: true, quantityStep: true,
                productStocks: { select: { stock: true } },
            },
        });
        const implicit = products.map((p) => {
            const others = p.productStocks.reduce((s, r) => s + Number(r.stock), 0);
            return {
                productId: p.id,
                name: p.name, brand: p.brand,
                sku: p.sku,
                unit: p.unit,
                saleMode: p.saleMode,
                quantityStep: p.quantityStep?.toString() ?? null,
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
