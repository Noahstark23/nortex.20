import type { Express } from 'express';
import { prisma as sharedPrisma } from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { ACCOUNTING_READ_ROLES } from '../middleware/accessPolicies';
import {
    DEFAULT_SALE_INVOICE_SERIES,
    InvoiceSeriesConfigError,
    InvoiceSeriesConfigSchema,
    resolveInvoiceSeriesRange,
    SALE_INVOICE_SERIES,
} from '../services/invoiceNumberingService';

/**
 * H3 — Serie de facturación DGI por tenant (A/B) y rango autorizado.
 * El tenant sale SIEMPRE del JWT. La serie elegida queda como la única activa
 * para ventas nuevas; la otra conserva su contador (sus números nunca se
 * reutilizan). Cambiar el rango no retrocede el contador.
 */

export function registerInvoiceSeriesRoutes(app: Pick<Express, 'get' | 'put'>, prisma = sharedPrisma) {
    app.get('/api/invoice-series', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
        const authReq = req as AuthRequest;
        try {
            const series = await prisma.invoiceSeries.findMany({
                where: { tenantId: authReq.tenantId!, series: { in: [...SALE_INVOICE_SERIES] } },
                orderBy: { series: 'asc' },
                take: SALE_INVOICE_SERIES.length,
                select: { series: true, lastNumber: true, rangeStart: true, rangeEnd: true, isActive: true },
            });
            res.json({ series, defaultSeries: DEFAULT_SALE_INVOICE_SERIES });
        } catch (error) {
            console.error('Invoice series read error:', error);
            res.status(500).json({ error: 'Error al obtener las series de facturación.' });
        }
    });

    app.put('/api/invoice-series', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
        const authReq = req as AuthRequest;
        const parsed = InvoiceSeriesConfigSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues.map(issue => issue.message).join(' ') });
        }
        const tenantId = authReq.tenantId!;
        const input = parsed.data;
        try {
            const result = await prisma.$transaction(async (tx: any) => {
                // Mismo lock que usa la venta al numerar: ninguna venta toma número
                // mientras cambia la serie activa o su rango.
                await tx.$queryRaw`
                    SELECT id FROM \`InvoiceSeries\`
                    WHERE tenantId = ${tenantId} AND series IN (${SALE_INVOICE_SERIES[0]}, ${SALE_INVOICE_SERIES[1]})
                    ORDER BY series ASC FOR UPDATE`;
                const before = await tx.invoiceSeries.findMany({
                    where: { tenantId, series: { in: [...SALE_INVOICE_SERIES] } },
                    orderBy: { series: 'asc' },
                    take: SALE_INVOICE_SERIES.length,
                    select: { series: true, lastNumber: true, rangeStart: true, rangeEnd: true, isActive: true },
                });
                const current = before.find((row: { series: string }) => row.series === input.series) ?? null;
                const range = resolveInvoiceSeriesRange(current, input);
                await tx.invoiceSeries.updateMany({
                    where: { tenantId, series: { in: [...SALE_INVOICE_SERIES] }, NOT: { series: input.series } },
                    data: { isActive: false },
                });
                const saved = await tx.invoiceSeries.upsert({
                    where: { tenantId_series: { tenantId, series: input.series } },
                    create: { tenantId, series: input.series, lastNumber: 0, ...range, isActive: true },
                    update: { ...range, isActive: true },
                    select: { series: true, lastNumber: true, rangeStart: true, rangeEnd: true, isActive: true },
                });
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId: authReq.userId!,
                        action: 'INVOICE_SERIES_CONFIGURED',
                        details: JSON.stringify({ before, after: saved }),
                    },
                });
                return saved;
            });
            res.json({ message: `Serie ${result.series} activa para las ventas nuevas.`, series: result });
        } catch (error) {
            if (error instanceof InvoiceSeriesConfigError) return res.status(409).json({ error: error.message });
            console.error('Invoice series config error:', error);
            res.status(500).json({ error: 'Error al configurar la serie de facturación.' });
        }
    });
}
