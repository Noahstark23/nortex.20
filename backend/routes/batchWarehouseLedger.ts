import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
    BatchWarehouseReadinessError,
    canonicalReadinessQuantity,
} from '../lib/batchWarehouseReadiness.js';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import {
    createBatchWarehouseReadinessService,
    type BatchWarehouseReadinessService,
} from '../services/batchWarehouseReadinessService.js';
import { BatchWarehouseLedgerError } from '../services/productBatchWarehouseLedgerService.js';

export const BATCH_WAREHOUSE_ADMIN_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;

const ExactFinalQuantitySchema = z.string().trim().min(1).max(32).transform((value, ctx) => {
    try {
        return canonicalReadinessQuantity(value);
    } catch (error) {
        ctx.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : 'Cantidad final inválida',
        });
        return z.NEVER;
    }
});

export const BatchWarehouseReadinessQuerySchema = z.object({
    cursor: z.string().trim().min(1).max(191).optional(),
    limit: z.preprocess(
        value => value === undefined ? 50 : value,
        z.coerce.number().int().min(1).max(100),
    ),
}).strict();

export const BatchWarehouseReconciliationSchema = z.object({
    clientEventId: z.string().trim().uuid(),
    batchId: z.string().trim().min(1).max(191),
    reason: z.string().trim().min(3).max(1000),
    allocations: z.array(z.object({
        warehouseId: z.string().trim().min(1).max(191),
        quantity: ExactFinalQuantitySchema,
    }).strict()).min(1).max(100),
}).strict();

const parseOrRespond = <T>(schema: z.ZodType<T>, value: unknown, res: Response): T | null => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Datos de readiness lote-bodega inválidos',
            code: 'BATCH_READINESS_INVALID_INPUT',
            details: parsed.error.flatten().fieldErrors,
        });
        return null;
    }
    return parsed.data;
};

const validateReconciliation = (req: Request, res: Response, next: NextFunction): void => {
    const parsed = BatchWarehouseReconciliationSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Datos de reconciliación lote-bodega inválidos',
            code: 'BATCH_READINESS_INVALID_INPUT',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    req.body = parsed.data;
    next();
};

const sendError = (res: Response, error: unknown, operation: string): Response => {
    if (error instanceof BatchWarehouseReadinessError || error instanceof BatchWarehouseLedgerError) {
        return res.status(error.httpStatus).json({
            error: error.message,
            code: error.code,
            ...('details' in error && error.details ? { details: error.details } : {}),
        });
    }
    console.error(`Readiness lote-bodega: ${operation} falló`, {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : undefined,
    });
    return res.status(500).json({ error: 'No pudimos completar el readiness lote-bodega' });
};

export function buildBatchWarehouseLedgerRouter(
    service: BatchWarehouseReadinessService = createBatchWarehouseReadinessService(),
) {
    const router = express.Router();

    router.get(
        '/readiness',
        authenticate,
        checkRole(BATCH_WAREHOUSE_ADMIN_ROLES),
        async (req: any, res: Response) => {
            const query = parseOrRespond(BatchWarehouseReadinessQuerySchema, req.query, res);
            if (!query) return;
            try {
                return res.json(await service.readiness(req.tenantId, query));
            } catch (error) {
                return sendError(res, error, 'evaluar');
            }
        },
    );

    router.post(
        '/reconcile',
        authenticate,
        checkRole(BATCH_WAREHOUSE_ADMIN_ROLES),
        validateReconciliation,
        async (req: any, res: Response) => {
            try {
                const result = await service.reconcile(req.tenantId, req.userId, req.body);
                return res.status(result.replay ? 200 : 201).json({ success: true, ...result });
            } catch (error) {
                return sendError(res, error, 'reconciliar');
            }
        },
    );

    return router;
}

export default buildBatchWarehouseLedgerRouter();
