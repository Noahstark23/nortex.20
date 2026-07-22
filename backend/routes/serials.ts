/**
 * NORTEX — Control de series (números de serie por unidad: IMEI / VIN / S/N).
 *
 * Capa de trazabilidad a nivel UNIDAD (complementa el lote, que es a nivel grupo).
 * Ciclo: IN_STOCK → SOLD (con saleId) → RETURNED  |  VOID.
 *
 * Alcance Fase 1: registrar, listar, TRAZAR una unidad por su serie y mover su
 * estado. Es una capa de trazabilidad: NO maneja la cantidad de stock (eso sigue
 * en el flujo de Kardex/recepción). La captura automática en POS/recepción es un
 * incremento posterior (Fase 1b).
 *
 * Aislamiento: TODO query filtra por tenantId (del JWT, nunca del body).
 */

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';

const prisma = new PrismaClient();
const router = express.Router();

const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER'];
const VALID_STATUS = ['IN_STOCK', 'SOLD', 'RETURNED', 'VOID'];

// ── POST / — registrar series de un producto (auto-activa el tracking) ──────
router.post('/', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { productId, serials, purchaseId, notes } = req.body ?? {};

    if (!productId || typeof productId !== 'string') {
        return res.status(400).json({ error: 'productId es requerido' });
    }
    if (!Array.isArray(serials) || serials.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos una serie' });
    }
    // Sanear + deduplicar la entrada.
    const clean = [...new Set(
        serials.map((s: unknown) => String(s ?? '').trim()).filter((s: string) => s.length > 0)
    )];
    if (clean.length === 0) {
        return res.status(400).json({ error: 'Ninguna serie válida' });
    }

    try {
        const product = await prisma.product.findFirst({
            where: { id: productId, tenantId },
            select: { id: true, requiresSerialTracking: true },
        });
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

        // Si la recepción viene con purchaseId, validar que la compra sea del tenant.
        if (purchaseId) {
            const purchase = await prisma.purchase.findFirst({ where: { id: String(purchaseId), tenantId }, select: { id: true } });
            if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
        }

        // Auto-activar el control de series (como el patrón de lotes/FEFO).
        if (!product.requiresSerialTracking) {
            await prisma.product.update({ where: { id: product.id }, data: { requiresSerialTracking: true } });
        }

        // createMany con skipDuplicates: las series ya existentes (unique productId+serial) se ignoran.
        const created = await prisma.serialNumber.createMany({
            data: clean.map((serial) => ({
                tenantId,
                productId: product.id,
                serial,
                status: 'IN_STOCK',
                purchaseId: purchaseId ? String(purchaseId) : null,
                notes: notes ? String(notes) : null,
            })),
            skipDuplicates: true,
        });

        await prisma.auditLog.create({
            data: {
                tenantId, userId: req.userId, action: 'SERIALS_REGISTERED',
                details: JSON.stringify({ productId: product.id, registered: created.count, skipped: clean.length - created.count }),
            },
        });

        res.status(201).json({ success: true, registered: created.count, skipped: clean.length - created.count });
    } catch (e: any) {
        console.error('Error registrando series:', e.message);
        res.status(500).json({ error: 'Error al registrar las series' });
    }
});

// ── GET / — listar series (filtros: productId, status, q) ───────────────────
router.get('/', authenticate, async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { productId, status, q } = req.query;
    try {
        const serials = await prisma.serialNumber.findMany({
            where: {
                tenantId,
                ...(productId ? { productId: String(productId) } : {}),
                ...(status && VALID_STATUS.includes(String(status)) ? { status: String(status) } : {}),
                ...(q ? { serial: { contains: String(q) } } : {}),
            },
            include: { product: { select: { name: true, sku: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
        res.json({ success: true, data: serials });
    } catch (e: any) {
        console.error('Error listando series:', e.message);
        res.status(500).json({ error: 'Error al listar las series' });
    }
});

// ── GET /lookup/:serial — trazar una unidad por su número de serie ──────────
router.get('/lookup/:serial', authenticate, async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    try {
        const unit = await prisma.serialNumber.findFirst({
            where: { tenantId, serial: req.params.serial },
            include: {
                product: { select: { id: true, name: true, sku: true } },
                sale: { select: { id: true, createdAt: true, total: true } },
                purchase: { select: { id: true, invoiceNumber: true, createdAt: true } },
            },
        });
        if (!unit) return res.status(404).json({ error: 'Serie no encontrada' });
        res.json({ success: true, data: unit });
    } catch (e: any) {
        console.error('Error buscando serie:', e.message);
        res.status(500).json({ error: 'Error al buscar la serie' });
    }
});

// ── POST /:id/status — mover el estado de una unidad ────────────────────────
router.post('/:id/status', authenticate, checkRole(ROLES_WRITE), async (req: any, res: any) => {
    const tenantId: string = req.tenantId;
    const { status, saleId, notes } = req.body ?? {};

    if (!VALID_STATUS.includes(status)) {
        return res.status(400).json({ error: `status debe ser uno de: ${VALID_STATUS.join(', ')}` });
    }

    try {
        const unit = await prisma.serialNumber.findFirst({ where: { id: req.params.id, tenantId } });
        if (!unit) return res.status(404).json({ error: 'Serie no encontrada' });

        // Si se marca SOLD con saleId, validar que la venta sea del tenant.
        let linkedSaleId: string | null = unit.saleId;
        if (status === 'SOLD') {
            if (saleId) {
                const sale = await prisma.sale.findFirst({ where: { id: String(saleId), tenantId }, select: { id: true } });
                if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
                linkedSaleId = String(saleId);
            }
        } else if (status === 'IN_STOCK' || status === 'RETURNED') {
            linkedSaleId = null; // vuelve al inventario / devuelta → se desliga de la venta
        }

        const updated = await prisma.serialNumber.update({
            where: { id: unit.id },
            data: { status, saleId: linkedSaleId, notes: notes !== undefined ? String(notes) : unit.notes },
        });

        await prisma.auditLog.create({
            data: {
                tenantId, userId: req.userId, action: 'SERIAL_STATUS_CHANGED',
                details: JSON.stringify({ serialId: unit.id, serial: unit.serial, from: unit.status, to: status }),
            },
        });

        res.json({ success: true, data: updated });
    } catch (e: any) {
        console.error('Error cambiando estado de serie:', e.message);
        res.status(500).json({ error: 'Error al cambiar el estado de la serie' });
    }
});

export default router;
