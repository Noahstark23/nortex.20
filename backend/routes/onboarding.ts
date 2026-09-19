import express from 'express';
import type { Request, Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { createOnboardingStatusService } from '../services/onboardingStatusService.js';

export function buildOnboardingRouter(service = createOnboardingStatusService()) {
    const router = express.Router();
    // Conserva la política histórica: authenticate aplica identidad, roles y
    // exención de lectura usando originalUrl, incluso con el router montado.
    router.get('/', authenticate, async (req: Request & AuthRequest, res: Response) => {
        if (!req.tenantId) {
            res.status(401).json({ error: 'Acceso Denegado: No se pudo identificar el negocio.' });
            return;
        }
        try {
            const status = await service.getStatus(req.tenantId);
            if (!status) {
                res.status(404).json({ error: 'Negocio no encontrado' });
                return;
            }
            res.json(status);
        } catch (error) {
            console.error('onboarding status error', error);
            res.status(500).json({ error: 'Error al calcular el onboarding' });
        }
    });
    return router;
}

export default buildOnboardingRouter();
