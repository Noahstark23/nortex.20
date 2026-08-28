/**
 * NORTEX — Transferencias entre bodegas (Fase 3 de multi-bodega).
 *
 * La ruta solo autentica, valida y traduce errores. El servicio reclama un
 * UUID idempotente antes de cualquier efecto, ordena locks y conserva en la
 * misma transacción ProductStock, Kardex, lote+bodega y AuditLog.
 */
import express from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { BODEGUERO_ROLE } from '../security/bodegueroPolicy';
import { validate, StockTransferSchema } from '../validation/schemas';
import {
    executeStockTransferTransaction,
    StockTransferError,
} from '../services/stockTransferService.js';
import { BatchAllocationError } from '../services/saleBatchAllocationService.js';
import { BatchWarehouseLedgerError } from '../services/productBatchWarehouseLedgerService.js';

const router = express.Router();
const ROLES_WRITE = ['OWNER', 'ADMIN', 'MANAGER', BODEGUERO_ROLE];

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
    try {
        const result = await executeStockTransferTransaction({
            db: prisma,
            tenantId: req.tenantId,
            userId: req.userId,
            request: req.body,
        });
        return res.status(result.replay ? 200 : 201).json({
            success: true,
            data: result.transfer,
            replay: result.replay,
        });
    } catch (error: unknown) {
        if (error instanceof StockTransferError
            || error instanceof BatchAllocationError
            || error instanceof BatchWarehouseLedgerError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            return res.status(409).json({
                error: 'Conflicto de concurrencia; reintentá la transferencia',
                code: 'STOCK_TRANSFER_CONCURRENT_WRITE',
            });
        }
        console.error('Error en transferencia', {
            name: error instanceof Error ? error.name : 'UnknownError',
            code: typeof error === 'object' && error !== null && 'code' in error
                ? String((error as { code?: unknown }).code ?? '')
                : undefined,
        });
        return res.status(500).json({ error: 'Error al ejecutar la transferencia' });
    }
});

export default router;
