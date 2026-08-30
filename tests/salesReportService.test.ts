import { describe, expect, it, vi } from 'vitest';
import { createSalesReportService } from '../backend/services/salesReportService';
import {
    SalesReportError,
    parseSalesReportRange,
    type SalesReportContext,
} from '../backend/lib/salesReport';
import {
    buildShiftCloseReport,
    hashShiftCloseReport,
} from '../backend/lib/shiftCloseReport';

const sqlText = (query: any): string => String(query?.sql ?? query?.text ?? '');
const sqlValues = (query: any): unknown[] => Array.isArray(query?.values) ? query.values : [];

const emptyReportDb = (returnBudget = { returnCount: 0, returnLineCount: 0 }) => {
    const queries: any[] = [];
    const queryRaw = vi.fn(async (query: any) => {
        queries.push(query);
        const sql = sqlText(query);
        if (sql.includes('AS productGrossSales')) {
            return [{
                productGrossSales: '0', grossCogs: '0', discountTotal: '0', itemQuantityGross: '0',
            }];
        }
        if (sql.includes('GROUP BY s.`paymentMethod`')) return [];
        if (sql.includes('GROUP BY') && sql.includes('usedFallbackUnit')) return [];
        if (sql.includes("DATE_FORMAT(DATE_SUB(s.`createdAt`")) return [];
        if (sql.includes('FROM `Expense`')) return [];
        if (sql.includes('AS returnCount') && sql.includes('FROM `ProductReturn`')) return [returnBudget];
        if (sql.includes('FROM `ProductReturn`')) return [];
        if (sql.includes('FROM `Tenant`')) {
            return [{ businessName: 'Negocio', taxId: 'J031', address: null, phone: null }];
        }
        if (sql.includes('COUNT(*) AS transactionCount')) {
            return [{ grossSales: '0', grossVat: '0', transactionCount: 0 }];
        }
        throw new Error(`Query inesperada: ${sql}`);
    });
    return { db: { $queryRaw: queryRaw }, queryRaw, queries };
};

const context = (scope: SalesReportContext['scope']): SalesReportContext => ({
    tenantId: 'tenant-auth',
    scope,
});

describe('aislamiento del servicio de reportes sin BD externa', () => {
    it('aplica tenant + vendedor autenticado a cada agregado y excluye VOIDED', async () => {
        const fake = emptyReportDb();
        const service = createSalesReportService(fake.db as any);

        await service.getReport(
            context({ kind: 'seller', userId: 'seller-auth' }),
            parseSalesReportRange('2026-08-30', '2026-08-31'),
        );

        const businessQueries = fake.queries.filter((query) => !sqlText(query).includes('FROM `Tenant`'));
        expect(businessQueries.length).toBeGreaterThanOrEqual(6);
        for (const query of businessQueries) {
            const sql = sqlText(query);
            const values = sqlValues(query);
            expect(values).toContain('tenant-auth');
            expect(sql).toContain('s.`status` <> \'VOIDED\'');
            expect(sql).toContain('s.`soldById` = ?');
            expect(values).toContain('seller-auth');
            expect(values).not.toContain('tenant-atacante');
        }
        expect(fake.queries.some((query) => sqlText(query).includes('FROM `Expense`'))).toBe(false);
    });

    it('aplica dueño de turno al cajero y nunca lo confunde con soldById', async () => {
        const fake = emptyReportDb();
        const service = createSalesReportService(fake.db as any);

        await service.getReport(
            context({ kind: 'shift-owner', userId: 'cashier-auth' }),
            parseSalesReportRange('2026-08-30', '2026-08-30'),
        );

        const businessQueries = fake.queries.filter((query) => !sqlText(query).includes('FROM `Tenant`'));
        for (const query of businessQueries) {
            const sql = sqlText(query);
            expect(sql).toContain('sh.`userId` = ?');
            expect(sql).not.toContain('s.`soldById` = ?');
            expect(sqlValues(query)).toContain('cashier-auth');
        }
    });

    it('el alcance gerencial incluye gastos, siempre con tenant y rango exclusivo', async () => {
        const fake = emptyReportDb();
        const service = createSalesReportService(fake.db as any);
        const range = parseSalesReportRange('2026-08-30', '2026-08-31');

        await service.getReport(context({ kind: 'tenant' }), range);

        const expense = fake.queries.find((query) => sqlText(query).includes('FROM `Expense`'));
        expect(expense).toBeTruthy();
        expect(sqlText(expense)).toContain('e.`tenantId` = ?');
        expect(sqlText(expense)).toContain('e.`createdAt` < ?');
        expect(sqlValues(expense)).toContain('tenant-auth');
        expect(sqlValues(expense).some((value) => value instanceof Date
            && value.toISOString() === '2026-09-01T06:00:00.000Z')).toBe(true);
    });

    it('incluye una devolucion emitida en rango aunque la venta original sea historica', async () => {
        const fake = emptyReportDb();
        const service = createSalesReportService(fake.db as any);
        await service.getReport(
            context({ kind: 'tenant' }),
            parseSalesReportRange('2026-08-30', '2026-08-31'),
        );

        const returnsQuery = fake.queries.find((query) => sqlText(query).includes('FROM `ProductReturn` pr'));
        const sql = sqlText(returnsQuery);
        expect(sql).toContain('pr.`createdAt` >= ?');
        expect(sql).toContain('pr.`createdAt` < ?');
        expect(sql).not.toContain('s.`createdAt` >= ?');
        expect(sql).not.toContain('s.`createdAt` < ?');
        expect(sql).toContain("s.`status` <> 'VOIDED'");
        expect(sqlValues(returnsQuery)).toContain('tenant-auth');
    });

    it('rechaza el detalle antes de cargar JSON cuando supera el presupuesto total de líneas', async () => {
        const fake = emptyReportDb({ returnCount: 21, returnLineCount: 20_001 });
        const service = createSalesReportService(fake.db as any);

        await expect(service.getReport(
            context({ kind: 'tenant' }),
            parseSalesReportRange('2026-08-30', '2026-08-30'),
        )).rejects.toMatchObject({
            code: 'REPORT_RETURN_LINE_LIMIT_EXCEEDED',
            httpStatus: 422,
        });

        const returnQueries = fake.queries.filter((query) => sqlText(query).includes('FROM `ProductReturn`'));
        expect(returnQueries).toHaveLength(1);
        expect(sqlText(returnQueries[0])).toContain('JSON_LENGTH');
    });

    it('valida pagina antes de ejecutar una sola query', async () => {
        const fake = emptyReportDb();
        const service = createSalesReportService(fake.db as any);
        const range = parseSalesReportRange('2026-08-30', '2026-08-30');

        await expect(service.getTransactions(context({ kind: 'tenant' }), range, 0, 50))
            .rejects.toMatchObject({ code: 'REPORT_PAGE_INVALID', httpStatus: 400 });
        await expect(service.getTransactions(context({ kind: 'tenant' }), range, 1, 101))
            .rejects.toMatchObject({ code: 'REPORT_PAGE_SIZE_INVALID', httpStatus: 400 });
        expect(fake.queryRaw).not.toHaveBeenCalled();
    });
});

const validShiftPayload = () => buildShiftCloseReport({
    folio: 'Z-20260830-shift-1', businessDate: '2026-08-30',
    generatedAt: new Date('2026-08-31T01:00:00.000Z'),
    business: { name: 'Negocio', taxId: 'J031', address: null, phone: null },
    shift: {
        id: 'shift-1', openedAt: new Date('2026-08-30T12:00:00.000Z'),
        closedAt: new Date('2026-08-31T01:00:00.000Z'), openedBy: 'Duena',
        cashierName: 'Caja', closedBy: 'Duena', auditNotes: null,
    },
    payments: [{ method: 'CASH', transactionCount: 1, grossSales: '115' }],
    soldProducts: [{
        productId: 'p1', productName: 'Arroz', unit: 'lb', saleMode: 'MEASURED',
        presentation: 'BASE', quantity: '1', amount: '115', cogs: '60', vat: '15',
    }],
    returnedProducts: [], returns: { count: 0, total: '0', vat: '0', cogs: '0' },
    fiscal: { vatCollectedBeforeReturns: '15', discountTotal: '0' },
    cash: {
        openingNio: '100', expectedNio: '215', countedNio: '215', differenceNio: '0',
        openingUsd: '0', expectedUsd: '0', countedUsd: '0', differenceUsd: '0', cashRefundsNio: '0',
    },
    movements: [],
});

describe('lectura íntegra del snapshot de cierre', () => {
    const rowFor = (payload = validShiftPayload()) => ({
        id: 'report-1', shiftId: 'shift-1', folio: payload.folio,
        businessDate: payload.businessDate, version: payload.version,
        report: payload, contentHash: hashShiftCloseReport(payload),
        createdAt: new Date('2026-08-31T01:00:00.000Z'),
    });

    it('cajero solo lee su turno; verifica hash y genera URL relativa', async () => {
        const queryRaw = vi.fn().mockResolvedValue([rowFor()]);
        const service = createSalesReportService({ $queryRaw: queryRaw } as any);

        const snapshot = await service.getShiftSnapshot({
            tenantId: 'tenant-auth', userId: 'cashier-auth', role: 'CASHIER',
        }, 'shift-1');

        const query = queryRaw.mock.calls[0][0];
        expect(sqlText(query)).toContain('scr.`tenantId` = ?');
        expect(sqlText(query)).toContain('sh.`userId` = ?');
        expect(sqlValues(query)).toEqual(expect.arrayContaining([
            'tenant-auth', 'shift-1', 'cashier-auth',
        ]));
        expect(snapshot).toMatchObject({
            shiftId: 'shift-1', folio: 'Z-20260830-shift-1',
            documentUrl: '/api/reports/shifts/shift-1/document',
        });
    });

    it('gerencia conserva tenant scope sin restriccion por usuario', async () => {
        const queryRaw = vi.fn().mockResolvedValue([rowFor()]);
        const service = createSalesReportService({ $queryRaw: queryRaw } as any);

        await service.getShiftSnapshot({
            tenantId: 'tenant-auth', userId: 'owner-auth', role: 'OWNER',
        }, 'shift-1');

        const query = queryRaw.mock.calls[0][0];
        expect(sqlText(query)).not.toContain('sh.`userId` = ?');
        expect(sqlValues(query)).toContain('tenant-auth');
        expect(sqlValues(query)).not.toContain('owner-auth');
    });

    it('falla cerrado si el hash o el JSON persistido no coincide', async () => {
        const tampered = rowFor();
        tampered.report.summary.netSales = '999.00';
        const service = createSalesReportService({
            $queryRaw: vi.fn().mockResolvedValue([tampered]),
        } as any);

        await expect(service.getShiftSnapshot({
            tenantId: 'tenant-auth', userId: 'owner-auth', role: 'OWNER',
        }, 'shift-1')).rejects.toMatchObject({
            code: 'SHIFT_REPORT_INTEGRITY_FAILED', httpStatus: 409,
        });
    });

    it('no revela si un shift pertenece a otro tenant o a otro cajero', async () => {
        const service = createSalesReportService({
            $queryRaw: vi.fn().mockResolvedValue([]),
        } as any);

        await expect(service.getShiftSnapshot({
            tenantId: 'tenant-auth', userId: 'cashier-auth', role: 'CASHIER',
        }, 'shift-ajeno')).rejects.toMatchObject({
            code: 'SHIFT_REPORT_NOT_FOUND', httpStatus: 404,
        });
    });

    it('deniega roles desconocidos antes de consultar', async () => {
        const queryRaw = vi.fn();
        const service = createSalesReportService({ $queryRaw: queryRaw } as any);

        await expect(service.getShiftSnapshot({
            tenantId: 'tenant-auth', userId: 'bodega-auth', role: 'BODEGUERO',
        }, 'shift-1')).rejects.toBeInstanceOf(SalesReportError);
        expect(queryRaw).not.toHaveBeenCalled();
    });
});
