import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { enrollProduct, EnrollmentError } from '../services/productEnrollmentService';

const router = express.Router();
const roles = ['OWNER', 'ADMIN'];
router.get('/enrollment/:operationId', authenticate, checkRole(roles), async (req: any, res: any) => {
    const id = z.uuid().safeParse(req.params.operationId);
    if (!id.success) return res.status(400).json({ error: 'Identificador inválido' });
    try {
        const row = await prisma.productEnrollment.findFirst({ where: { tenantId: req.tenantId, userId: req.userId, operationId: id.data } });
        // NOT_OBSERVED no libera el intento: una solicitud anterior todavía puede confirmar.
        res.json(row?.result ?? { outcome: 'NOT_OBSERVED', operationId: id.data });
    } catch { res.status(503).json({ error: 'No pudimos comprobar el guardado. Conservá el intento.' }); }
});
router.post('/enrollment', authenticate, checkRole(roles), async (req: any, res: any) => {
    try { res.json(await enrollProduct(prisma, { tenantId: req.tenantId, userId: req.userId, role: req.role }, req.body)); }
    catch (error) {
        if (error instanceof EnrollmentError) return res.status(error.status).json({ error: error.message });
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Revisá los datos del producto.', details: z.flattenError(error).fieldErrors });
        res.status(503).json({ error: 'No pudimos confirmar el guardado. Conservá este intento y reintentá.' });
    }
});
// Identificador interno reservado al alta; no pretende ser un GTIN comercial.
router.get('/enrollment-code', authenticate, checkRole(roles), (_req, res) => res.json({ sku: `NX-${randomUUID().toUpperCase()}` }));
export default router;
