import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    foldSalesReportData,
    parseSalesReportRange,
} from '../backend/lib/salesReport';
import {
    buildShiftCloseReport,
    hashShiftCloseReport,
} from '../backend/lib/shiftCloseReport';
import type {
    SalesExportData,
    SalesReportService,
    SalesTransactionRow,
    ShiftReportSnapshotView,
} from '../backend/services/salesReportService';

let createSalesReportsRouter: typeof import('../backend/routes/salesReports')['createSalesReportsRouter'];

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'sales-report-route-contract-secret');
    ({ createSalesReportsRouter } = await import('../backend/routes/salesReports'));
});

afterAll(() => {
    vi.unstubAllEnvs();
});

const AUTHORIZATION = 'Bearer route-contract-token';
const CSP_NONCE = 'route-contract-nonce-123456';

const authenticated: RequestHandler = (req, res, next) => {
    if (req.get('Authorization') !== AUTHORIZATION) {
        res.status(401).json({ error: 'No autorizado.', code: 'UNAUTHORIZED' });
        return;
    }
    Object.assign(req, {
        tenantId: 'tenant-auth',
        userId: 'owner-auth',
        role: 'OWNER',
    });
    next();
};

function reportFixture() {
    return foldSalesReportData({
        range: parseSalesReportRange('2026-08-01', '2026-08-31'),
        business: {
            name: 'Pulpería Norte',
            taxId: 'J0310000000000',
            address: 'Managua',
            phone: '2222-2222',
        },
        sales: {
            grossSales: '115',
            grossVat: '15',
            transactionCount: 1,
            productGrossSales: '115',
            grossCogs: '60',
            discountTotal: '0',
            itemQuantityGross: '1',
        },
        paymentRows: [{ method: 'CASH', transactionCount: 1, grossSales: '115' }],
        productRows: [{
            productId: 'product-1',
            productName: 'Café',
            saleMode: 'COUNTED',
            presentation: 'BASE',
            baseUnit: 'unidad',
            displayUnit: 'unidad',
            quantityGross: '1',
            baseQuantityGross: '1',
            grossSales: '115',
            grossVat: '15',
            cogs: '60',
        }],
        dailyRows: [{
            date: '2026-08-01',
            grossSales: '115',
            grossVat: '15',
            transactionCount: 1,
        }],
        expenseRows: [],
        returnRecords: [{
            id: 'return-1',
            saleId: 'historical-sale-1',
            createdAt: '2026-08-01T12:00:00.000Z',
            total: '0',
            items: [],
            paymentMethod: 'CASH',
            fiscalRegimeAtSale: 'GENERAL',
            saleTotal: '115',
            saleExemptTotal: '0',
            saleVatAmountAtSale: '15',
            reason: 'Sin devolución efectiva',
        }],
    });
}

function transactionFixture(): SalesTransactionRow {
    return {
        id: 'sale-1',
        invoice: 'FAC-1',
        createdAt: '2026-08-01T12:00:00.000Z',
        businessDate: '2026-08-01',
        customer: { id: 'customer-1', name: 'Cliente QA' },
        seller: { id: 'seller-1', name: 'Vendedora QA' },
        cashier: { id: 'cashier-1', name: 'Cajera QA' },
        paymentMethod: 'CASH',
        total: '115.00',
        vatCollected: '15.00',
        returnedTotal: '0.00',
        netTotal: '115.00',
        status: 'COMPLETED',
        items: { lineCount: 1, baseQuantity: '1' },
    };
}

function exportFixture(): SalesExportData {
    const report = reportFixture();
    return {
        report,
        transactions: [transactionFixture()],
        returns: report.returns,
    };
}

function shiftFixture(folio = 'Z-20260830-shift-1'): ShiftReportSnapshotView {
    const report = buildShiftCloseReport({
        folio,
        businessDate: '2026-08-30',
        generatedAt: new Date('2026-08-31T01:00:00.000Z'),
        business: {
            name: 'Pulpería Norte',
            taxId: 'J0310000000000',
            address: 'Managua',
            phone: '2222-2222',
        },
        shift: {
            id: 'shift-1',
            openedAt: new Date('2026-08-30T12:00:00.000Z'),
            closedAt: new Date('2026-08-31T01:00:00.000Z'),
            openedBy: 'Dueña',
            cashierName: 'Cajera',
            closedBy: 'Dueña',
            auditNotes: null,
        },
        payments: [{ method: 'CASH', transactionCount: 1, grossSales: '115' }],
        soldProducts: [{
            productId: 'product-1',
            productName: 'Café',
            unit: 'unidad',
            saleMode: 'COUNTED',
            presentation: 'BASE',
            quantity: '1',
            amount: '115',
            cogs: '60',
            vat: '15',
        }],
        returnedProducts: [],
        returns: { count: 0, total: '0', vat: '0', cogs: '0' },
        fiscal: { vatCollectedBeforeReturns: '15', discountTotal: '0' },
        cash: {
            openingNio: '100',
            expectedNio: '215',
            countedNio: '215',
            differenceNio: '0',
            openingUsd: '0',
            expectedUsd: '0',
            countedUsd: '0',
            differenceUsd: '0',
            cashRefundsNio: '0',
        },
        movements: [],
    });

    return {
        id: 'shift-report-1',
        shiftId: 'shift-1',
        folio,
        businessDate: report.businessDate,
        version: report.version,
        contentHash: hashShiftCloseReport(report),
        createdAt: report.generatedAt,
        documentUrl: '/api/reports/shifts/shift-1/document',
        report,
    };
}

function serviceFixture(overrides: Partial<SalesReportService> = {}): SalesReportService {
    const data = exportFixture();
    return {
        getReport: vi.fn(async () => data.report),
        getTransactions: vi.fn(async () => ({
            page: 1,
            pageSize: 50,
            total: data.transactions.length,
            totalPages: 1,
            items: data.transactions,
        })),
        getDocumentData: vi.fn(async () => ({
            report: data.report,
            transactions: data.transactions,
        })),
        getExportData: vi.fn(async () => data),
        getShiftSnapshot: vi.fn(async () => shiftFixture()),
        ...overrides,
    };
}

async function withReportsServer<T>(
    service: SalesReportService,
    run: (baseUrl: string) => Promise<T>,
): Promise<T> {
    const app = express();
    app.use('/api/reports', createSalesReportsRouter({
        service,
        authenticate: authenticated,
        nonceFactory: () => CSP_NONCE,
        now: () => new Date('2026-08-31T12:00:00.000Z'),
    }));

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    try {
        return await run(`http://127.0.0.1:${address.port}/api/reports`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

const authorizedFetch = (url: string) => fetch(url, {
    headers: { Authorization: AUTHORIZATION },
});

describe('contrato HTTP de documentos y exportaciones de ventas', () => {
    it.each(['/sales/document', '/sales/export.xlsx'])(
        '%s exige autenticación antes de consultar datos del tenant',
        async (path) => {
            const service = serviceFixture();

            await withReportsServer(service, async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}${path}?startDate=2026-08-01&endDate=2026-08-31`,
                );

                expect(response.status).toBe(401);
                await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
            });

            expect(service.getDocumentData).not.toHaveBeenCalled();
            expect(service.getExportData).not.toHaveBeenCalled();
        },
    );

    it('acepta 31 días exactos y rechaza 32 antes de consultar el servicio', async () => {
        const getDocumentData = vi.fn(async (
            _context: Parameters<SalesReportService['getDocumentData']>[0],
            _range: Parameters<SalesReportService['getDocumentData']>[1],
        ) => {
            const data = exportFixture();
            return { report: data.report, transactions: data.transactions };
        });
        const service = serviceFixture({ getDocumentData });

        await withReportsServer(service, async (baseUrl) => {
            const accepted = await authorizedFetch(
                `${baseUrl}/sales/document?startDate=2026-08-01&endDate=2026-08-31`,
            );
            expect(accepted.status).toBe(200);

            const rejected = await authorizedFetch(
                `${baseUrl}/sales/document?startDate=2026-08-01&endDate=2026-09-01`,
            );
            expect(rejected.status).toBe(422);
            await expect(rejected.json()).resolves.toMatchObject({
                code: 'REPORT_RANGE_TOO_LARGE',
            });
        });

        expect(getDocumentData).toHaveBeenCalledTimes(1);
        expect(getDocumentData.mock.calls[0]?.[1]).toMatchObject({
            startDate: '2026-08-01',
            endDate: '2026-08-31',
            days: 31,
        });
    });

    it('emite filenames acotados, sin traversal ni inyección de headers', async () => {
        const hostileFolio = 'Z-"../../\\reporte;\r\nX-Injected: yes';
        const getShiftSnapshot = vi.fn(async () => shiftFixture(hostileFolio));
        const service = serviceFixture({ getShiftSnapshot });

        await withReportsServer(service, async (baseUrl) => {
            const sales = await authorizedFetch(
                `${baseUrl}/sales/export.xlsx?startDate=2026-08-01&endDate=2026-08-31`,
            );
            expect(sales.status).toBe(200);
            expect(sales.headers.get('content-disposition')).toBe(
                'attachment; filename="reporte-ventas-2026-08-01-2026-08-31.xlsx"',
            );

            const shift = await authorizedFetch(`${baseUrl}/shifts/shift-1/document`);
            expect(shift.status).toBe(200);
            const disposition = shift.headers.get('content-disposition') ?? '';
            expect(disposition).toMatch(/^inline; filename="[A-Za-z0-9._-]+\.html"$/);
            expect(disposition).not.toContain('..');
            expect(disposition).not.toContain('/');
            expect(disposition).not.toContain('\\');
            expect(disposition).not.toMatch(/[\r\n]/);
            expect(shift.headers.get('x-injected')).toBeNull();
        });
    });

    it('neutraliza fórmulas aun con espacios o controles antes de = + - @', async () => {
        const data = exportFixture();
        const unsafeCells = [
            ' \t=1+1 [BUSINESS]',
            '\n-2+2 [CUSTOMER]',
            '\r@SUM(A1:A2) [PRODUCT]',
            '\t+cmd [RETURN]',
            '  =HYPERLINK("https://example.invalid") [METHOD]',
        ];
        data.report.business.name = unsafeCells[0];
        data.transactions[0].customer.name = unsafeCells[1];
        data.report.products[0].productName = unsafeCells[2];
        data.report.returns[0].reason = unsafeCells[3];
        data.report.paymentMethods[0].label = unsafeCells[4];
        const service = serviceFixture({ getExportData: vi.fn(async () => data) });

        await withReportsServer(service, async (baseUrl) => {
            const response = await authorizedFetch(
                `${baseUrl}/sales/export.xlsx?startDate=2026-08-01&endDate=2026-08-31`,
            );
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            );

            const XLSX = await import('xlsx');
            const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
            const strings = workbook.SheetNames.flatMap((name) => (
                XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
                    header: 1,
                    raw: true,
                }) as unknown[][]
            )).flat().filter((value): value is string => typeof value === 'string');

            for (const unsafe of unsafeCells) {
                expect(strings, `No se encontró la celda de prueba ${JSON.stringify(unsafe)}`)
                    .toContain(`'${unsafe}`);
                expect(strings).not.toContain(unsafe);
            }
        });
    });
});
