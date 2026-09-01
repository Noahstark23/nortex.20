import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { closeShiftWithReport } from '../backend/services/shiftCloseService';
import { buildShiftCloseReport, hashShiftCloseReport } from '../backend/lib/shiftCloseReport';

const decimal = (value: string) => new Prisma.Decimal(value);
const sqlText = (query: unknown): string => String((query as { sql?: string; text?: string } | null)?.sql ?? (query as { text?: string } | null)?.text ?? '');
const sqlValues = (query: unknown): unknown[] => Array.isArray((query as { values?: unknown[] } | null)?.values)
    ? (query as { values: unknown[] }).values
    : [];

const closeCommand = {
    tenantId: 'tenant-a',
    userId: 'user-a',
    role: 'CASHIER',
    shiftId: 'shift-a',
    declaredCash: '215.00',
    declaredCashUsd: '0.00',
    auditNotes: 'todo bien',
} as const;

const fixedNow = () => new Date('2026-08-31T01:00:00.000Z');

describe('closeShiftWithReport', () => {
    it('filtra devoluciones exclusivamente por processedShiftId y conserva remanente legacy como linea auditable', async () => {
        const queries: unknown[] = [];
        const shiftCloseReportCreate = vi.fn(async ({ data }: any) => ({
            id: 'report-a',
            folio: data.folio,
            businessDate: data.businessDate,
            contentHash: data.contentHash,
            report: data.report,
        }));
        const tx: any = {
            $queryRaw: vi.fn(async (query: unknown) => {
                queries.push(query);
                const sql = sqlText(query);
                if (sql.includes('FROM `Shift`') && sql.includes('FOR UPDATE')) {
                    return [{
                        id: 'shift-a',
                        tenantId: 'tenant-a',
                        userId: 'user-a',
                        employeeId: 'emp-a',
                        initialCash: decimal('100.00'),
                        initialCashUsd: decimal('0.00'),
                        status: 'OPEN',
                        startTime: new Date('2026-08-30T12:00:00.000Z'),
                        endTime: null,
                        finalCashDeclared: null,
                        systemExpectedCash: null,
                        difference: null,
                        finalCashDeclaredUsd: null,
                        systemExpectedUsd: null,
                        differenceUsd: null,
                    }];
                }
                if (sql.includes('AS listGross')) {
                    return [{
                        productId: 'prod-1',
                        productName: 'Arroz',
                        unit: 'lb',
                        saleMode: 'MEASURED',
                        presentation: 'BASE',
                        displayUnit: 'lb',
                        quantity: decimal('1.0000'),
                        amount: decimal('115.00'),
                        cogs: decimal('60.00'),
                        vat: decimal('15.00'),
                        listGross: decimal('115.00'),
                    }];
                }
                if (sql.includes('FROM `ProductReturn` pr')) {
                    if (sql.includes('AS returnCount')) {
                        return [{ returnCount: 1, returnLineCount: 0 }];
                    }
                    return [{
                        id: 'return-a',
                        saleId: 'sale-a',
                        createdAt: new Date('2026-08-31T00:30:00.000Z'),
                        total: decimal('10.00'),
                        items: JSON.stringify([]),
                        reason: 'legacy',
                        paymentMethod: 'CASH',
                        fiscalRegimeAtSale: 'GENERAL',
                        saleTotal: decimal('115.00'),
                        saleExemptTotal: decimal('0.00'),
                        saleVatAmountAtSale: decimal('15.00'),
                    }];
                }
                if (sql.includes('AS vatCollected')) {
                    return [{ vatCollected: decimal('15.00') }];
                }
                if (sql.includes('WHERE si.`id` IN')) return [];
                throw new Error(`Query inesperada: ${sql}`);
            }),
            sale: {
                groupBy: vi.fn(async () => [{
                    paymentMethod: 'CASH',
                    _sum: { total: decimal('115.00') },
                    _count: { _all: 1 },
                }]),
            },
            cashMovement: {
                groupBy: vi.fn(async () => []),
            },
            shift: {
                findFirst: vi.fn()
                    .mockResolvedValueOnce({
                        user: { name: 'Dueña', email: 'duena@nortex.test' },
                        employee: { firstName: 'Maria', lastName: 'Caja' },
                        tenant: {
                            businessName: 'Nortex Market',
                            taxId: 'J0310000000012',
                            address: 'Managua',
                            phone: '2222-2222',
                            theftAlertThreshold: decimal('500.00'),
                        },
                    })
                    .mockResolvedValueOnce({
                        id: 'shift-a',
                        tenantId: 'tenant-a',
                        userId: 'user-a',
                        employee: { id: 'emp-a', firstName: 'Maria', lastName: 'Caja', role: 'CASHIER' },
                    }),
                updateMany: vi.fn(async () => ({ count: 1 })),
            },
            user: {
                findFirst: vi.fn(async () => ({ name: 'Dueña', email: 'duena@nortex.test' })),
            },
            shiftCloseReport: {
                findUnique: vi.fn(),
                create: shiftCloseReportCreate,
            },
            auditLog: {
                create: vi.fn(async () => ({})),
            },
        };
        const client: any = {
            $transaction: async (run: (tx: any) => Promise<unknown>) => run(tx),
        };

        const result: any = await closeShiftWithReport(closeCommand, client, fixedNow);

        const returnQuery = queries.find((query) => sqlText(query).includes('FROM `ProductReturn` pr'));
        expect(returnQuery).toBeTruthy();
        expect(sqlText(returnQuery)).toContain('pr.`processedShiftId` = ?');
        expect(sqlValues(returnQuery)).toEqual(expect.arrayContaining(['tenant-a', 'shift-a']));
        expect(sqlValues(returnQuery)).not.toContain('shift-b');

        expect(result.closeReport.report.summary.returnsTotal).toBe('10.00');
        expect(result.closeReport.report.summary.returnCount).toBe(1);
        expect(result.closeReport.report.products).toEqual(expect.arrayContaining([
            expect.objectContaining({
                productId: 'return-unallocated',
                productName: 'Devolucion no asignable',
                quantityReturned: '0',
                returnsTotal: '10.00',
                netSales: '-10.00',
                displayUnit: 'sin linea exacta',
            }),
        ]));
    });

    it('en replay idempotente devuelve el mismo contrato operativo y la misma alerta', async () => {
        const payload = buildShiftCloseReport({
            folio: 'Z-20260830-shift-a',
            businessDate: '2026-08-30',
            generatedAt: fixedNow(),
            business: { name: 'Nortex Market', taxId: 'J031', address: null, phone: null },
            shift: {
                id: 'shift-a',
                openedAt: new Date('2026-08-30T12:00:00.000Z'),
                closedAt: fixedNow(),
                openedBy: 'Dueña',
                cashierName: 'Maria Caja',
                closedBy: 'Dueña',
                auditNotes: null,
            },
            payments: [{ method: 'CASH', transactionCount: 1, grossSales: '115.00' }],
            soldProducts: [{
                productId: 'prod-1',
                productName: 'Arroz',
                unit: 'lb',
                saleMode: 'MEASURED',
                presentation: 'BASE',
                quantity: '1',
                amount: '115.00',
                cogs: '60.00',
                vat: '15.00',
            }],
            returnedProducts: [],
            returns: { count: 0, total: '0', vat: '0', cogs: '0' },
            fiscal: { vatCollectedBeforeReturns: '15.00', discountTotal: '0.00' },
            cash: {
                openingNio: '100.00',
                expectedNio: '215.00',
                countedNio: '115.00',
                differenceNio: '-100.00',
                openingUsd: '0.00',
                expectedUsd: '0.00',
                countedUsd: '0.00',
                differenceUsd: '0.00',
                cashRefundsNio: '0.00',
            },
            movements: [
                { type: 'IN', currency: 'NIO', category: 'CAMBIO', count: 1, amount: '15.00' },
                { type: 'OUT', currency: 'NIO', category: 'AGENTE_BANCARIO', count: 1, amount: '4.00' },
            ],
        });
        const storedReport = {
            ...payload,
            closeMeta: {
                manualINs: 15,
                manualOUTs: 0,
                agentINs: 0,
                agentOUTs: 4,
                theftAlert: true,
            },
        };
        const tx: any = {
            $queryRaw: vi.fn(async (query: unknown) => {
                const sql = sqlText(query);
                if (sql.includes('FROM `Shift`') && sql.includes('FOR UPDATE')) {
                    return [{
                        id: 'shift-a',
                        tenantId: 'tenant-a',
                        userId: 'user-a',
                        employeeId: 'emp-a',
                        initialCash: decimal('100.00'),
                        initialCashUsd: decimal('0.00'),
                        status: 'CLOSED',
                        startTime: new Date('2026-08-30T12:00:00.000Z'),
                        endTime: fixedNow(),
                        finalCashDeclared: decimal('215.00'),
                        systemExpectedCash: decimal('215.00'),
                        difference: decimal('0.00'),
                        finalCashDeclaredUsd: decimal('0.00'),
                        systemExpectedUsd: decimal('0.00'),
                        differenceUsd: decimal('0.00'),
                    }];
                }
                throw new Error(`Query inesperada: ${sql}`);
            }),
            shiftCloseReport: {
                findUnique: vi.fn(async () => ({
                    id: 'report-a',
                    shiftId: 'shift-a',
                    folio: storedReport.folio,
                    businessDate: storedReport.businessDate,
                    version: storedReport.version,
                    contentHash: hashShiftCloseReport(storedReport),
                    report: storedReport,
                })),
            },
            tenant: {
                findUnique: vi.fn(async () => ({ theftAlertThreshold: decimal('500.00') })),
            },
            shift: {
                findFirst: vi.fn(async () => ({
                    id: 'shift-a',
                    tenantId: 'tenant-a',
                    userId: 'user-a',
                    employee: { id: 'emp-a', firstName: 'Maria', lastName: 'Caja', role: 'CASHIER' },
                })),
            },
        };
        const client: any = {
            $transaction: async (run: (tx: any) => Promise<unknown>) => run(tx),
        };

        const result: any = await closeShiftWithReport(closeCommand, client, fixedNow);

        expect(result).toMatchObject({
            manualINs: 15,
            manualOUTs: 0,
            agentINs: 0,
            agentOUTs: 4,
            theftAlert: true,
            idempotentReplay: true,
            shift: {
                employee: { id: 'emp-a', firstName: 'Maria', lastName: 'Caja' },
            },
        });
    });

    it('falla cerrado si el snapshot de un replay no conserva su hash', async () => {
        const payload = buildShiftCloseReport({
            folio: 'Z-20260830-shift-a',
            businessDate: '2026-08-30',
            generatedAt: fixedNow(),
            business: { name: 'Nortex', taxId: 'J031', address: null, phone: null },
            shift: {
                id: 'shift-a', openedAt: new Date('2026-08-30T12:00:00.000Z'), closedAt: fixedNow(),
                openedBy: 'Dueña', cashierName: 'Caja', closedBy: 'Dueña', auditNotes: null,
            },
            payments: [],
            soldProducts: [],
            returnedProducts: [],
            returns: { count: 0, total: '0', vat: '0', cogs: '0' },
            fiscal: { vatCollectedBeforeReturns: '0', discountTotal: '0' },
            cash: {
                openingNio: '0', expectedNio: '0', countedNio: '215', differenceNio: '215',
                openingUsd: '0', expectedUsd: '0', countedUsd: '0', differenceUsd: '0', cashRefundsNio: '0',
            },
            movements: [],
        });
        const tx: any = {
            $queryRaw: vi.fn(async () => [{
                id: 'shift-a', tenantId: 'tenant-a', userId: 'user-a', employeeId: null,
                initialCash: decimal('0'), initialCashUsd: decimal('0'), status: 'CLOSED',
                startTime: new Date('2026-08-30T12:00:00.000Z'), endTime: fixedNow(),
                finalCashDeclared: decimal('215'), systemExpectedCash: decimal('0'), difference: decimal('215'),
                finalCashDeclaredUsd: decimal('0'), systemExpectedUsd: decimal('0'), differenceUsd: decimal('0'),
            }]),
            shiftCloseReport: {
                findUnique: vi.fn(async () => ({
                    id: 'report-a', shiftId: 'shift-a', folio: payload.folio,
                    businessDate: payload.businessDate, version: payload.version,
                    contentHash: 'a'.repeat(64), report: payload,
                })),
            },
        };
        const client: any = { $transaction: async (run: (clientTx: any) => Promise<unknown>) => run(tx) };

        await expect(closeShiftWithReport(closeCommand, client, fixedNow)).rejects.toMatchObject({
            code: 'SHIFT_REPORT_INTEGRITY_FAILED',
            httpStatus: 409,
        });
    });
});
