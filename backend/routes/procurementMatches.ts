import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { PROCUREMENT_MATCH_STATUSES, ProcurementMatchError } from '../lib/procurementMatch.js';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import {
    PROCUREMENT_MATCH_READ_ROLES,
    PROCUREMENT_MATCH_RESOLVE_ROLES,
} from '../middleware/accessPolicies.js';
import { createProcurementMatchService } from '../services/procurementMatchService.js';

export const ProcurementMatchListQuerySchema = z.object({
    status: z.enum(PROCUREMENT_MATCH_STATUSES).optional(),
    supplierId: z.string().trim().min(1).max(191).optional(),
    purchaseOrderId: z.string().trim().min(1).max(191).optional(),
    paymentHold: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.preprocess(
        (value) => value === undefined ? 50 : value,
        z.coerce.number().int().min(1).max(100),
    ),
}).strict();

export const ProcurementMatchPurchaseParamsSchema = z.object({
    purchaseId: z.string().trim().min(1).max(191),
}).strict();

export const ProcurementMatchResolutionSchema = z.object({
    clientEventId: z.string().trim().uuid(),
    reason: z.string().trim().min(3).max(1000),
}).strict();

const validateBody = (schema: typeof ProcurementMatchResolutionSchema) =>
    (req: Request, res: Response, next: NextFunction): void => {
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'Datos de resolución inválidos',
                code: 'INVALID_MATCH_RESOLUTION',
                details: parsed.error.flatten().fieldErrors,
            });
            return;
        }
        req.body = parsed.data;
        next();
    };

const parseOrRespond = <T>(
    schema: z.ZodType<T>,
    value: unknown,
    res: Response,
): T | null => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Parámetros de conciliación inválidos',
            code: 'INVALID_MATCH_QUERY',
            details: parsed.error.flatten().fieldErrors,
        });
        return null;
    }
    return parsed.data;
};

const sendError = (res: Response, error: unknown, operation: string): Response => {
    if (error instanceof ProcurementMatchError) {
        return res.status(error.httpStatus).json({
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    // Prisma puede incorporar valores del documento en Error.message; solo se
    // registra el nombre/clase y se devuelve un texto estable al cliente.
    console.error(`Conciliación de compras: ${operation} falló`, {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : undefined,
    });
    return res.status(500).json({ error: 'No pudimos completar la conciliación de la compra' });
};

export function buildProcurementMatchesRouter(
    service = createProcurementMatchService(),
) {
    const router = express.Router();

    router.get(
        '/',
        authenticate,
        checkRole(PROCUREMENT_MATCH_READ_ROLES),
        async (req: any, res: Response) => {
            const query = parseOrRespond(ProcurementMatchListQuerySchema, req.query, res);
            if (!query) return;
            try {
                return res.json(await service.list(req.tenantId, query));
            } catch (error) {
                return sendError(res, error, 'listar');
            }
        },
    );

    router.get(
        '/:purchaseId',
        authenticate,
        checkRole(PROCUREMENT_MATCH_READ_ROLES),
        async (req: any, res: Response) => {
            const params = parseOrRespond(ProcurementMatchPurchaseParamsSchema, req.params, res);
            if (!params) return;
            try {
                return res.json({ data: await service.detail(req.tenantId, params.purchaseId) });
            } catch (error) {
                return sendError(res, error, 'consultar detalle');
            }
        },
    );

    router.post(
        '/:purchaseId/resolve',
        authenticate,
        checkRole(PROCUREMENT_MATCH_RESOLVE_ROLES),
        validateBody(ProcurementMatchResolutionSchema),
        async (req: any, res: Response) => {
            const params = parseOrRespond(ProcurementMatchPurchaseParamsSchema, req.params, res);
            if (!params) return;
            try {
                return res.json(await service.resolve(
                    req.tenantId,
                    req.userId,
                    params.purchaseId,
                    req.body,
                ));
            } catch (error) {
                return sendError(res, error, 'resolver');
            }
        },
    );

    return router;
}

export default buildProcurementMatchesRouter();

