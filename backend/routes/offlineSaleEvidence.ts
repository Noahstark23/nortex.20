import express from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import { POS_SALE_ROLES } from '../middleware/accessPolicies.js';

const paramsSchema = z.object({ offlineId: z.string().min(1).max(191).refine(value => value.trim() === value) }).strict();

/** Misma búsqueda que salesService: ID con scope por hash más formato crudo legado. */
export function offlineEvidenceReferences(tenantId: string, offlineId: string): string[] {
    const scoped = `event:${createHash('sha256').update(tenantId).update('\0').update(offlineId).digest('hex')}`;
    return [scoped, offlineId];
}

export function buildOfflineSaleEvidenceRouter(database = prisma) {
    const router = express.Router();
    router.get('/:offlineId', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); },
        authenticate, checkRole(POS_SALE_ROLES), async (req: express.Request & AuthRequest, res: express.Response) => {
            const parsed = paramsSchema.safeParse(req.params);
            if (!parsed.success) { res.status(400).json({ error: 'Referencia de venta inválida.' }); return; }
            if (!req.tenantId || !req.userId) { res.status(401).json({ error: 'No se pudo verificar la identidad de la sesión.' }); return; }
            try {
                // offlineId tiene índice UNIQUE. Dos candidatos permiten detectar
                // una coexistencia conflictiva sin elegir una venta arbitraria.
                // soldById es inmutable; no atribuir históricos usando Shift.userId.
                const matches = await database.sale.findMany({
                    where: { tenantId: req.tenantId, soldById: req.userId,
                        offlineId: { in: offlineEvidenceReferences(req.tenantId, parsed.data.offlineId) } },
                    take: 2, orderBy: { id: 'asc' },
                    select: { id: true, createdAt: true, total: true, status: true, paymentMethod: true,
                        invoiceNumber: true, invoiceSeries: true, offlinePayloadHash: true },
                });
                const common = { offlineId: parsed.data.offlineId, checkedAt: new Date().toISOString() };
                if (!matches.length) { res.json({ ...common, status: 'not_found' }); return; }
                if (matches.length !== 1) { res.json({ ...common, status: 'ambiguous' }); return; }
                const sale = matches[0];
                res.json({ ...common, status: 'recorded', record: {
                    saleId: sale.id, createdAt: sale.createdAt.toISOString(), total: sale.total.toString(),
                    status: sale.status, paymentMethod: sale.paymentMethod,
                    invoiceNumber: sale.invoiceNumber, invoiceSeries: sale.invoiceSeries,
                    hasReplayFingerprint: Boolean(sale.offlinePayloadHash),
                } });
            } catch {
                res.status(500).json({ error: 'No se pudo consultar la referencia. La venta local debe conservarse.' });
            }
        });
    return router;
}

export default buildOfflineSaleEvidenceRouter();
