import express from 'express';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { createAdminOverviewService } from '../services/adminOverviewService.js';

const Query = z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    kind: z.enum(['REAL', 'DEMO', 'INTERNAL', 'UNKNOWN']).optional(),
    focus: z.enum(['NO_CATALOG', 'NO_SALE', 'INACTIVE', 'ERRORS', 'FOUNDER_DATES', 'OPERATIONS']).optional(),
    search: z.string().trim().max(80).optional(),
}).strict();

export function buildAdminOverviewRouter(service = createAdminOverviewService()) {
    const router = express.Router();
    // Conserva la entrada admin existente; cero lectura global sin sesión y rol
    // revalidados en BD. Query estricta: no hay override del tenant/principal.
    const read: express.RequestHandler = async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        const parsed = Query.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Filtro inválido. Usá página, clasificación y búsqueda de negocio.' });
            return;
        }
        try {
            res.json(await service.getOverview(parsed.data as z.infer<typeof Query> & { page: number }));
        } catch (error) {
            // No exponer consultas, nombres de clientes, recibos o datos de DB.
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
            console.error('admin overview unavailable', { code });
            res.status(503).json({ error: 'No se pudo leer la evidencia administrativa. Revisá la conexión y el esquema del candidato.', code: 'ADMIN_EVIDENCE_UNAVAILABLE' });
        }
    };
    router.get('/metrics', authenticate, requireSuperAdmin, read);
    router.get('/tenants', authenticate, requireSuperAdmin, read);
    return router;
}

export default buildAdminOverviewRouter();
