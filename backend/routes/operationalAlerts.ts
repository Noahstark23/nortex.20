import express from 'express';
import type { Request, Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import {
    createOperationalAlertsService, OperationalAlertsAccessError, OPERATIONAL_ALERT_READ_ROLES,
} from '../services/operationalAlertsService.js';

export function buildOperationalAlertsRouter(service = createOperationalAlertsService()) {
    const router = express.Router();
    router.get('/', (_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    }, authenticate, checkRole(OPERATIONAL_ALERT_READ_ROLES), async (req: Request & AuthRequest, res: Response) => {
        if (!req.tenantId) {
            res.status(401).json({ error: 'No se pudo identificar el negocio.' });
            return;
        }
        try {
            const summary = await service.getSummary(req.tenantId, req.role!);
            if (!summary) {
                res.status(404).json({ error: 'Negocio no encontrado.' });
                return;
            }
            res.json(summary);
        } catch (error) {
            if (error instanceof OperationalAlertsAccessError) {
                res.status(error.status).json({ error: error.message });
                return;
            }
            res.status(500).json({ error: 'No se pudieron verificar las alertas. Intentá de nuevo.' });
        }
    });
    return router;
}

export default buildOperationalAlertsRouter();
