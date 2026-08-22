import express from 'express';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { POS_SALE_ROLES } from '../middleware/accessPolicies';
import { executeSaleWithResult, SaleError } from '../services/salesService.js';
import {
    normalizeOfflineSalePayload,
    offlineSyncFailureStatus,
    syncBodySchema,
} from './syncPayload';

const router = express.Router();

router.post('/', authenticate, checkRole(POS_SALE_ROLES), async (req: any, res: any) => {
    const parsed = syncBodySchema.safeParse(req.body);
    if (!parsed.success) {
        const message = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(' | ');
        return res.status(400).json({ error: message || 'Datos de sincronización inválidos' });
    }

    const tenantId = req.tenantId as string;
    const userId = req.userId as string;
    const results: Array<{
        offlineId: string;
        saleId?: string;
        status: 'created' | 'skipped' | 'failed' | 'reconciliation_required';
        code?: string;
        error?: string;
    }> = [];

    for (const sale of parsed.data.sales) {
        if (sale.tenantId !== tenantId) {
            results.push({
                offlineId: sale.offlineId,
                status: 'failed',
                code: 'TENANT_MISMATCH',
                error: 'tenant mismatch',
            });
            continue;
        }

        try {
            const result = await executeSaleWithResult(
                tenantId,
                userId,
                sale.shiftId ?? null,
                normalizeOfflineSalePayload(sale),
                { offlineSync: true, createdAt: sale.createdAt },
            );

            results.push({
                offlineId: sale.offlineId,
                saleId: result.sale.id,
                status: result.idempotentReplay ? 'skipped' : 'created',
            });
        } catch (error) {
            const saleErrorCode = error instanceof SaleError ? error.code : undefined;
            if (offlineSyncFailureStatus(saleErrorCode) === 'reconciliation_required') {
                results.push({
                    offlineId: sale.offlineId,
                    status: 'reconciliation_required',
                    code: saleErrorCode,
                    error: error instanceof SaleError
                        ? error.message
                        : 'Error interno al sincronizar la venta',
                });
                continue;
            }
            results.push({
                offlineId: sale.offlineId,
                status: 'failed',
                code: error instanceof SaleError ? error.code : 'SYNC_INTERNAL_ERROR',
                error: error instanceof SaleError ? error.message : 'Error interno al sincronizar la venta',
            });
            if (!(error instanceof SaleError)) console.error('Error sincronizando venta offline:', error);
        }
    }

    const processed = results.filter((result) => result.status === 'created').length;
    const skipped = results.filter((result) => result.status === 'skipped').length;
    const reconciliationRequired = results.filter((result) => result.status === 'reconciliation_required').length;
    const failed = results.filter((result) => result.status === 'failed').length;

    return res.json({ processed, skipped, reconciliationRequired, failed, results });
});

export default router;
