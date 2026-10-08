import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import { BatchWarehouseReadinessError } from '../services/batchWarehouseReadinessService.js';
import {
    createPharmacyInventorySettingsService,
    PharmacyInventorySettingsError,
    type PharmacyInventorySettingsService,
} from '../services/pharmacyInventorySettingsService.js';

export const PHARMACY_INVENTORY_ADMIN_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;

export const PharmacyInventoryModeSchema = z.object({
    mode: z.enum(['OFF', 'ENFORCED']),
}).strict();

const validateMode = (req: Request, res: Response, next: NextFunction): void => {
    const parsed = PharmacyInventoryModeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Configuración farmacéutica inválida',
            code: 'PHARMACY_INVENTORY_INVALID_INPUT',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    req.body = parsed.data;
    next();
};

const sendError = (res: Response, error: unknown, operation: string): Response => {
    if (
        error instanceof PharmacyInventorySettingsError
        || error instanceof BatchWarehouseReadinessError
    ) {
        return res.status(error.httpStatus).json({
            error: error.message,
            code: error.code,
            ...('details' in error && error.details ? { details: error.details } : {}),
        });
    }
    console.error(`Configuración farmacéutica: ${operation} falló`, {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : undefined,
    });
    return res.status(500).json({ error: 'No pudimos completar la configuración farmacéutica' });
};

export function buildPharmacyInventorySettingsRouter(
    service: PharmacyInventorySettingsService = createPharmacyInventorySettingsService(),
) {
    const router = express.Router();

    router.get(
        '/',
        authenticate,
        checkRole(PHARMACY_INVENTORY_ADMIN_ROLES),
        async (req: any, res: Response) => {
            try {
                return res.json(await service.getSettings(req.tenantId));
            } catch (error) {
                return sendError(res, error, 'consultar');
            }
        },
    );

    router.put(
        '/',
        authenticate,
        checkRole(PHARMACY_INVENTORY_ADMIN_ROLES),
        validateMode,
        async (req: any, res: Response) => {
            try {
                const result = await service.setMode(req.tenantId, req.userId, req.body.mode);
                return res.json({ success: true, ...result });
            } catch (error) {
                return sendError(res, error, 'actualizar');
            }
        },
    );

    return router;
}

export default buildPharmacyInventorySettingsRouter();
