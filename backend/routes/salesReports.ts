import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
    SALES_DOCUMENT_MAX_DAYS,
    SALES_EXPORT_MAX_DAYS,
    SalesReportError,
    defaultSalesReportRange,
    parseSalesReportRange,
    resolveSalesReportScope,
    type SalesReportContext,
    type SalesReportRange,
} from '../lib/salesReport.js';
import { fiscalPreviewCsp } from '../lib/htmlSecurity.js';
import {
    renderSalesReportHtml,
    renderShiftCloseReportHtml,
} from '../lib/salesReportHtml.js';
import {
    createSalesReportService,
    type SalesExportData,
    type SalesReportPrincipal,
    type SalesReportService,
} from '../services/salesReportService.js';

interface AuthenticatedReportRequest extends Request {
    tenantId?: string;
    userId?: string;
    role?: string;
}

export interface SalesReportsRouterDependencies {
    service?: SalesReportService;
    authenticate?: RequestHandler;
    nonceFactory?: () => string;
    now?: () => Date;
}

const asyncRoute = (
    handler: (req: AuthenticatedReportRequest, res: Response) => Promise<void>,
): RequestHandler => (req, res, next) => {
    handler(req as AuthenticatedReportRequest, res).catch(next);
};

function principal(req: AuthenticatedReportRequest): SalesReportPrincipal {
    if (!req.tenantId || !req.userId || !req.role) {
        throw new SalesReportError(
            'REPORT_PRINCIPAL_INVALID',
            401,
            'La sesión no contiene una identidad válida.',
        );
    }
    return { tenantId: req.tenantId, userId: req.userId, role: req.role };
}

function reportContext(req: AuthenticatedReportRequest): SalesReportContext {
    const current = principal(req);
    return {
        tenantId: current.tenantId,
        scope: resolveSalesReportScope(current.role, current.userId),
    };
}

function reportRange(
    req: AuthenticatedReportRequest,
    now: () => Date,
    maxDays?: number,
): SalesReportRange {
    const start = req.query.startDate;
    const end = req.query.endDate;
    if (start === undefined && end === undefined) {
        const range = defaultSalesReportRange(now());
        return maxDays === undefined
            ? range
            : parseSalesReportRange(range.startDate, range.endDate, { maxDays });
    }
    return parseSalesReportRange(start, end, maxDays === undefined ? {} : { maxDays });
}

function positiveInteger(value: unknown, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return Number.NaN;
    return Number(value);
}

function routeParam(value: string | string[]): string {
    return Array.isArray(value) ? value[0] ?? '' : value;
}

function nonce(): string {
    return randomBytes(18).toString('base64url');
}

function setNoStore(res: Response): void {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
}

function setHtmlHeaders(res: Response, cspNonce: string, filename: string): void {
    setNoStore(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', fiscalPreviewCsp(cspNonce));
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const safeStem = filename
        .replace(/\.html$/i, '')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '')
        .slice(0, 170);
    // El stem no admite puntos ni separadores: `../`, `..\\` y sus variantes
    // quedan imposibilitados, no solo sustituidos parcialmente.
    const safeFilename = `${safeStem || 'reporte'}.html`;
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
}

function spreadsheetText(value: unknown): string {
    const result = String(value ?? '');
    // Excel ignora espacios y controles iniciales antes de interpretar una
    // fórmula. Preservamos el texto completo, pero lo forzamos a literal.
    return /^[\u0000-\u0020]*[=+\-@]/.test(result) ? `'${result}` : result;
}

function asNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function buildSalesWorkbook(data: SalesExportData): Promise<Buffer> {
    const XLSX = await import('xlsx');
    const summary = data.report.summary;
    const summaryRows: Array<Record<string, string | number>> = [
        { Campo: 'Negocio', Valor: spreadsheetText(data.report.business.name) },
        { Campo: 'RUC', Valor: spreadsheetText(data.report.business.taxId) },
        { Campo: 'Desde', Valor: data.report.period.startDate },
        { Campo: 'Hasta', Valor: data.report.period.endDate },
        { Campo: 'Ventas brutas C$', Valor: asNumber(summary.grossSales) },
        { Campo: 'Devoluciones C$', Valor: asNumber(summary.returnsTotal) },
        { Campo: 'Ventas netas C$', Valor: asNumber(summary.netSales) },
        { Campo: 'IVA recaudado C$', Valor: asNumber(summary.vatCollected) },
        { Campo: 'Ingreso sin IVA C$', Valor: asNumber(summary.netRevenue) },
        { Campo: 'Costo de ventas C$', Valor: asNumber(summary.cogs) },
        { Campo: 'Utilidad bruta C$', Valor: asNumber(summary.grossProfit) },
        { Campo: 'Transacciones', Valor: summary.transactionCount },
        { Campo: 'Devoluciones emitidas', Valor: summary.returnCount },
        { Campo: 'Ticket promedio C$', Valor: asNumber(summary.averageTicket) },
        { Campo: 'Descuentos C$', Valor: asNumber(summary.discountTotal) },
        { Campo: 'Cantidad vendida base', Valor: asNumber(summary.itemQuantityGross) },
        { Campo: 'Cantidad devuelta base', Valor: asNumber(summary.itemQuantityReturned) },
        { Campo: 'Cantidad neta base', Valor: asNumber(summary.itemQuantityNet) },
        { Campo: 'Ajuste de redondeo C$', Valor: asNumber(summary.roundingAdjustment) },
    ];
    const salesRows = data.transactions.map((row) => ({
        Factura: spreadsheetText(row.invoice),
        Fecha: row.createdAt,
        'Día Managua': row.businessDate,
        Cliente: spreadsheetText(row.customer.name),
        Vendedor: spreadsheetText(row.seller.name),
        Cajero: spreadsheetText(row.cashier.name),
        Método: spreadsheetText(row.paymentMethod),
        Estado: spreadsheetText(row.status),
        'Total C$': asNumber(row.total),
        'IVA C$': asNumber(row.vatCollected),
        'Devuelto en período C$': asNumber(row.returnedTotal),
        'Neto del período C$': asNumber(row.netTotal),
        'Líneas': row.items.lineCount,
        'Cantidad base': asNumber(row.items.baseQuantity),
    }));
    const productRows = data.report.products.map((row) => ({
        Producto: spreadsheetText(row.productName),
        'ID producto': spreadsheetText(row.productId),
        Modo: spreadsheetText(row.saleMode),
        Presentación: spreadsheetText(row.presentation),
        'Unidad histórica': spreadsheetText(row.displayUnit),
        'Cantidad vendida': asNumber(row.quantitySold),
        'Cantidad devuelta': asNumber(row.quantityReturned),
        'Cantidad neta': asNumber(row.quantityNet),
        'Ventas brutas C$': asNumber(row.grossSales),
        'Devoluciones C$': asNumber(row.returnsTotal),
        'Ventas netas C$': asNumber(row.netSales),
        'IVA C$': asNumber(row.vatCollected),
        'Costo neto C$': asNumber(row.cogs),
        'Utilidad bruta C$': asNumber(row.grossProfit),
    }));
    const methodRows = data.report.paymentMethods.map((row) => ({
        Método: spreadsheetText(row.label),
        Transacciones: row.transactionCount,
        Devoluciones: row.returnCount,
        'Ventas brutas C$': asNumber(row.grossSales),
        'Devoluciones atribuidas C$': asNumber(row.returnsTotal),
        'Ventas netas C$': asNumber(row.netSales),
        'Criterio devolución': 'Método de la venta original',
    }));
    const returnRows = data.returns.map((row) => ({
        'ID devolución': spreadsheetText(row.id),
        'ID venta': spreadsheetText(row.saleId),
        Fecha: row.createdAt,
        'Día Managua': row.businessDate,
        'Método venta original': spreadsheetText(row.paymentMethod),
        Motivo: spreadsheetText(row.reason),
        'Total C$': asNumber(row.total),
        'IVA revertido C$': asNumber(row.vat),
        'Costo revertido C$': asNumber(row.cogs),
        'Líneas inválidas': row.invalidItemCount,
        'Monto sin asignar C$': asNumber(row.unallocatedTotal),
    }));

    const workbook = XLSX.utils.book_new();
    for (const [name, rows] of [
        ['Resumen', summaryRows],
        ['Ventas', salesRows],
        ['Productos', productRows],
        ['Métodos', methodRows],
        ['Devoluciones', returnRows],
    ] as const) {
        const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Estado: 'Sin registros' }]);
        worksheet['!cols'] = Array.from({ length: 16 }, () => ({ wch: 20 }));
        XLSX.utils.book_append_sheet(workbook, worksheet, name);
    }
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

export function createSalesReportsRouter(
    dependencies: SalesReportsRouterDependencies = {},
): Router {
    const router = Router();
    const service = dependencies.service ?? createSalesReportService();
    const auth = dependencies.authenticate ?? authenticate as RequestHandler;
    const nonceFactory = dependencies.nonceFactory ?? nonce;
    const now = dependencies.now ?? (() => new Date());
    const noStoreMiddleware: RequestHandler = (_req, res, next) => {
        setNoStore(res);
        next();
    };

    router.get('/sales/transactions', auth, noStoreMiddleware, asyncRoute(async (req, res) => {
        const range = reportRange(req, now);
        const page = positiveInteger(req.query.page, 1);
        const pageSize = positiveInteger(req.query.pageSize, 50);
        const result = await service.getTransactions(reportContext(req), range, page, pageSize);
        res.json(result);
    }));

    router.get('/sales/document', auth, noStoreMiddleware, asyncRoute(async (req, res) => {
        const range = reportRange(req, now, SALES_DOCUMENT_MAX_DAYS);
        const data = await service.getDocumentData(reportContext(req), range);
        const cspNonce = nonceFactory();
        const html = renderSalesReportHtml(data, { nonce: cspNonce });
        setHtmlHeaders(
            res,
            cspNonce,
            `reporte-ventas-${range.startDate}-${range.endDate}.html`,
        );
        res.send(html);
    }));

    router.get('/sales/export.xlsx', auth, noStoreMiddleware, asyncRoute(async (req, res) => {
        const range = reportRange(req, now, SALES_EXPORT_MAX_DAYS);
        const data = await service.getExportData(reportContext(req), range);
        const workbook = await buildSalesWorkbook(data);
        setNoStore(res);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="reporte-ventas-${range.startDate}-${range.endDate}.xlsx"`,
        );
        res.send(workbook);
    }));

    router.get('/sales', auth, noStoreMiddleware, asyncRoute(async (req, res) => {
        const range = reportRange(req, now);
        const report = await service.getReport(reportContext(req), range);
        res.json(report);
    }));

    router.get('/shifts/:shiftId/document', auth, noStoreMiddleware, asyncRoute(async (req, res) => {
        const snapshot = await service.getShiftSnapshot(principal(req), routeParam(req.params.shiftId));
        const cspNonce = nonceFactory();
        const html = renderShiftCloseReportHtml(snapshot, { nonce: cspNonce });
        setHtmlHeaders(res, cspNonce, `reporte-z-${snapshot.businessDate}-${snapshot.folio}.html`);
        res.send(html);
    }));

    router.get('/shifts/:shiftId', auth, noStoreMiddleware, asyncRoute(async (req, res) => {
        const snapshot = await service.getShiftSnapshot(principal(req), routeParam(req.params.shiftId));
        res.json(snapshot);
    }));

    router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (error instanceof SalesReportError) {
            res.status(error.httpStatus).json({ error: error.message, code: error.code });
            return;
        }
        console.error('Error generando reporte de ventas:', error);
        res.status(500).json({
            error: 'No se pudo generar el reporte de ventas.',
            code: 'SALES_REPORT_FAILED',
        });
    });

    return router;
}

const salesReportsRouter = createSalesReportsRouter();
export default salesReportsRouter;
