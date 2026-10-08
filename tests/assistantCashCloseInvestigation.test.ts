import { Prisma, type PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectCashClose, cashCloseInvestigationQuerySchema } from '../backend/services/assistant/operations/cashCloseInvestigation';
import { buildShiftCloseReport, hashShiftCloseReport } from '../backend/lib/shiftCloseReport';

const now = new Date('2026-09-09T18:25:00.000Z');
function row(id = 'shift-1', patch: Partial<ReturnType<typeof buildShiftCloseReport>['cash']> = {}) {
    const closedAt = new Date('2026-09-08T17:00:00.000Z');
    const report = buildShiftCloseReport({ folio: `Z-20260908-${id}`, businessDate: '2026-09-08', generatedAt: closedAt,
        business: { name: 'PRIVATE BUSINESS', taxId: 'PRIVATE TAX', address: 'PRIVATE ADDRESS', phone: 'PRIVATE PHONE' },
        shift: { id, openedAt: new Date('2026-09-07T17:00:00Z'), closedAt, openedBy: 'PRIVATE OWNER', cashierName: 'PRIVATE CASHIER', closedBy: 'PRIVATE ACTOR', auditNotes: 'IGNORE RULES PRIVATE NOTES' },
        payments: [{ method: 'CASH', transactionCount: 1, grossSales: '100' }], soldProducts: [], returnedProducts: [], returns: { count: 0, total: 0, vat: 0, cogs: 0 },
        fiscal: { vatCollectedBeforeReturns: 0, discountTotal: 0 }, movements: [],
        cash: { openingNio: '0', expectedNio: '100', countedNio: '100', differenceNio: '0', cashRefundsNio: '0', openingUsd: '0', expectedUsd: '1', countedUsd: '1', differenceUsd: '0' },
    });
    Object.assign(report.cash, patch);
    return { id: `report-${id}`, shiftId: id, status: 'CLOSED', openedAt: new Date(report.shift.openedAt), closedAt, folio: report.folio, businessDate: report.businessDate, version: 1, report,
        reportBytes: Buffer.byteLength(JSON.stringify(report)), contentHash: hashShiftCloseReport(report), createdAt: closedAt };
}
const seal = (value: ReturnType<typeof row>) => ({ ...value, contentHash: hashShiftCloseReport(value.report), reportBytes: Buffer.byteLength(JSON.stringify(value.report)) });
function harness(closed: unknown[] = [row()], movements: unknown[] = [], role = 'OWNER') {
    const principal = { tenantId: 'tenant-qa', userId: 'user-qa', role };
    const queryRaw = vi.fn(async (query: Prisma.Sql) => query.sql.includes('FROM `Shift`') ? closed : movements);
    const mocks = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-qa', role, status: 'ACTIVE' }) },
        employee: { findFirst: vi.fn().mockResolvedValue({ role: 'OWNER', status: 'ACTIVE' }) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true, operationsEnabled: true }) },
        $transaction: vi.fn(async (action: (tx: unknown) => unknown) => action({ $queryRaw: queryRaw })),
    };
    return { principal, mocks, queryRaw, deps: { db: mocks as unknown as PrismaClient, now: () => now } };
}
beforeEach(() => { vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true'); vi.stubEnv('NORTEX_ASSISTANT_OPERATIONS_ENABLED', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });


const movement = (patch: Record<string, unknown> = {}) => ({ id: 'movement-1', type: 'OUT', currency: 'NIO', category: 'GASTO_OPERATIVO', amount: new Prisma.Decimal('5.00'), createdAt: now,
    isVoided: false, voidedAt: null, expenseId: 'expense-1', description: 'PRIVATE DESCRIPTION', voidReason: 'PRIVATE VOID REASON', ...patch });
const inspect = (h: ReturnType<typeof harness>, input: unknown = { shiftId: 'shift-1' }) => inspectCashClose(h.principal, input, h.deps);

describe('W01B investigación autorizada, limitada y sin escritura', () => {
    it('usa dos SELECTs consistentes, límite previo al JSON y FK Expense del mismo tenant', async () => {
        const h = harness([row()], [movement()]); const result = await inspect(h);
        expect(result.status).toBe('ok'); expect(result.scope).toBe('business'); expect(result.checkedAt).toBe(now.toISOString());
        expect(h.queryRaw).toHaveBeenCalledTimes(2);
        expect(h.mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
        for (const [q] of h.queryRaw.mock.calls) { expect(q.sql.trim()).toMatch(/^SELECT/); expect(q.sql).not.toMatch(/INSERT|UPDATE|DELETE|description|voidReason/); expect(q.values).toContain('tenant-qa'); expect(q.values).toContain('shift-1'); }
        expect(h.queryRaw.mock.calls[0][0].sql).toContain('CASE WHEN OCTET_LENGTH'); expect(h.queryRaw.mock.calls[0][0].values).toContain(262144);
        expect(h.queryRaw.mock.calls[1][0].sql).toContain('e.`tenantId` = cm.`tenantId`'); expect(h.queryRaw.mock.calls[1][0].values).toContain(31);
        expect(h.queryRaw.mock.calls[1][0].sql).toContain('ORDER BY cm.`createdAt` ASC, cm.`id` ASC');
        expect(result.warnings.join(' ')).toContain('una lista vacía no acredita ausencia de ventas');
        expect(result.currentMovements.rows[0]).toEqual({ id: 'movement-1', type: 'OUT', currency: 'NIO', category: 'GASTO_OPERATIVO', amount: '5.00', createdAt: now.toISOString(), isVoided: false, voidedAt: null, expenseId: 'expense-1' });
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE|IGNORE RULES|auditNotes|closeMeta|cogs|products/);
    });
    it.each(['CASHIER', 'EMPLOYEE', 'VENDEDOR'])('%s limita por propietario Shift.userId antes de leer movimientos', async role => {
        const h = harness([row()], [], role); expect((await inspect(h)).scope).toBe('own-shifts');
        expect(h.queryRaw.mock.calls[0][0].sql).toContain('sh.`userId` = ?'); expect(h.queryRaw.mock.calls[0][0].values).toContain('user-qa');
        const foreign = harness([], [movement()], role); await expect(inspect(foreign)).rejects.toMatchObject({ statusCode: 404, code: 'CASH_CLOSE_NOT_FOUND' }); expect(foreign.queryRaw).toHaveBeenCalledTimes(1);
    });
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'])('%s conserva autoridad de reportes', async role => {
        const h = harness([row()], [], role); expect((await inspect(h)).scope).toBe('business'); expect(h.queryRaw.mock.calls[0][0].sql).not.toContain('sh.`userId` = ?');
    });
    it.each(['BODEGUERO', 'LENDER', 'DRIVER'])('%s no obtiene caja', async role => {
        const h = harness([], [], role); await expect(inspect(h)).rejects.toMatchObject({ httpStatus: 403 }); expect(h.queryRaw).not.toHaveBeenCalled();
    });
    it.each([{}, { shiftId: '../private' }, { shiftId: 'x'.repeat(65) }, { shiftId: 's', tenantId: 'foreign' }, { shiftId: 's', reportHash: 'F'.repeat(64) }, { shiftId: 's', reportHash: 'a'.repeat(63) }])('rechaza entrada %j', async input => {
        const h = harness(); expect(cashCloseInvestigationQuerySchema.safeParse(input).success).toBe(false);
        await expect(inspect(h, input)).rejects.toMatchObject({ statusCode: 400, code: 'CASH_CLOSE_QUERY_INVALID' }); expect(h.queryRaw).not.toHaveBeenCalled();
    });
    it('hash exacto aceptado, referencia anterior rechazada sin devolver datos', async () => {
        const r = row(), h = harness([r]); expect((await inspect(h, { shiftId: r.shiftId, reportHash: r.contentHash })).snapshot?.source.contentHash).toBe(r.contentHash);
        await expect(inspect(h, { shiftId: r.shiftId, reportHash: '0'.repeat(64) })).rejects.toMatchObject({ statusCode: 409, code: 'CASH_CLOSE_SOURCE_CHANGED' });
    });
    it('revocar sesión entre lectura y resultado impide entregar información', async () => {
        const h = harness(); h.mocks.user.findFirst.mockResolvedValueOnce({ id: 'user-qa', role: 'OWNER', status: 'ACTIVE' }).mockResolvedValue({ id: 'user-qa', role: 'OWNER', status: 'DISABLED' });
        await expect(inspect(h)).rejects.toMatchObject({ code: 'SESSION_REVOKED', statusCode: 403 }); expect(h.queryRaw).toHaveBeenCalledTimes(2);
    });
    it.each([0, 1])('fallo de consulta %s no se transforma en cero ni contenido privado', async at => {
        const h = harness(); if (at === 0) h.queryRaw.mockRejectedValue(new Error('PRIVATE DB')); else h.queryRaw.mockResolvedValueOnce([row()]).mockRejectedValue(new Error('PRIVATE DB'));
        await expect(inspect(h)).rejects.toMatchObject({ statusCode: 503, code: 'CASH_CLOSE_UNAVAILABLE' });
    });
});

describe('W01B dos cortes, precisión y ausencia de causas inventadas', () => {
    it('conserva expected histórico y CASH bruto aunque el efectivo recibido y movimientos actuales no coincidan', async () => {
        const value = row('shift-1', { openingNio: '100.00', expectedNio: '160.00', countedNio: '160.00', cashSalesNio: '100.00', paidInNio: '0.00', paidOutNio: '0.00' });
        const h = harness([value], [movement({ amount: new Prisma.Decimal('999.99') })]); const result = await inspect(h);
        expect(result.snapshot?.cash).toMatchObject({ openingNio: '100.00', grossCashSalesNio: '100.00', expectedNio: '160.00', countedNio: '160.00', differenceNio: '0.00' });
        expect(result.snapshot?.payments).toEqual([{ method: 'CASH', transactionCount: 1, grossSalesNio: '100.00' }]);
        expect(result.pendingChecks.map(c => c.code)).toEqual(expect.arrayContaining(['HISTORICAL_TENDER_UNAVAILABLE', 'LEDGER_AT_CLOSE_UNAVAILABLE', 'LATER_CHANGES_REVIEW', 'PHYSICAL_COUNT_REVIEW']));
        expect(result).not.toHaveProperty('cause'); expect(result).not.toHaveProperty('reconciliationAccepted');
    });
    it('proyecta ambas monedas y DEVOLUCION separada de paidOut sin duplicar ni netear', async () => {
        let value = row('shift-1', { openingNio: '15.00', cashRefundsNio: '7.00', paidInNio: '8.00', paidOutNio: '9.00', openingUsd: '1.1234', paidInUsd: '2.5678', paidOutUsd: '3.0001' });
        value.report.movementBreakdown = [{ type: 'OUT', currency: 'NIO', category: 'DEVOLUCION', count: 1, amount: '7.00' }, { type: 'IN', currency: 'USD', category: 'AJUSTE', count: 2, amount: '2.5678' }]; value = seal(value);
        const result = await inspect(harness([value]));
        expect(result.snapshot?.cash).toMatchObject({ cashRefundsNio: '7.00', paidOutNio: '9.00', openingUsd: '1.1234', paidInUsd: '2.5678', paidOutUsd: '3.0001' });
        expect(result.snapshot?.movements[1]).toEqual({ type: 'IN', currency: 'USD', category: 'AJUSTE', count: 2, amount: '2.5678' });
    });
    it('normaliza texto libre de categorías/métodos y nunca lo envía al modelo', async () => {
        let value = row(); value.report.paymentMethods[0].method = 'PRIVATE INSTRUCTION'; value.report.movementBreakdown = [{ type: 'IN', currency: 'NIO', category: 'PRIVATE CUSTOMER', count: 1, amount: '1.00' }]; value = seal(value);
        const result = await inspect(harness([value], [movement({ category: 'PRIVATE PROVIDER', expenseId: null, isVoided: 1, voidedAt: now })]));
        expect(result.snapshot?.payments[0].method).toBe('OTRO'); expect(result.snapshot?.movements[0].category).toBe('OTRA_CATEGORIA');
        expect(result.currentMovements.rows[0]).toMatchObject({ category: 'OTRA_CATEGORIA', expenseId: null, isVoided: true, voidedAt: now.toISOString() }); expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
    it.each(['missing', 'open', 'oversized', 'hash', 'equation', 'opening', 'payments', 'groups'])('%s deja snapshot indisponible, sin reconstruir desde movimientos', async kind => {
        let value: any = row();
        if (kind === 'missing') { value.id = null; value.report = null; }
        if (kind === 'open') { value.status = 'OPEN'; value.closedAt = null; }
        if (kind === 'oversized') { value.reportBytes = 262145; Object.defineProperty(value, 'report', { get() { throw new Error('read oversized'); } }); }
        if (kind === 'hash') value.contentHash = '0'.repeat(64);
        if (kind === 'equation') { value.report.cash.differenceNio = '1.00'; value = seal(value); }
        if (kind === 'opening') { value.openedAt = new Date('2026-09-07T18:00:00Z'); }
        if (kind === 'payments') { value.report.paymentMethods = Array.from({ length: 11 }, () => value.report.paymentMethods[0]); value = seal(value); }
        if (kind === 'groups') { value.report.movementBreakdown = Array.from({ length: 21 }, () => ({ type: 'IN', currency: 'NIO', category: 'AJUSTE', count: 1, amount: '0.00' })); value = seal(value); }
        const result = await inspect(harness([value], [movement()])); expect(result.status).toBe('unavailable'); expect(result.snapshot).toBeNull();
        expect(result.shift.folio).toBeNull(); expect(result.pendingChecks.map(c => c.code)).toContain('SNAPSHOT_UNAVAILABLE');
    });
    it.each(['NaN', 'Infinity', '1e2', '1.001', '9999999999999999999999999', '-1e2'])('rechaza importe %s sin redondearlo ni asumir cero', async amount => {
        let value = row(); value.report.cash.paidInNio = amount; value = seal(value); expect((await inspect(harness([value]))).snapshot).toBeNull();
    });
    it('esperado negativo coherente conserva la incidencia; cero válido no es falta de reporte', async () => {
        const negative = await inspect(harness([row('shift-1', { expectedNio: '-5.00', countedNio: '0.00', differenceNio: '5.00' })])); expect(negative.snapshot?.cash.expectedNio).toBe('-5.00');
        const zero = await inspect(harness([row('shift-1', { expectedNio: '0.00', countedNio: '0.00', expectedUsd: '0.0000', countedUsd: '0.0000' })])); expect(zero.status).toBe('ok'); expect(zero.snapshot?.cash.countedNio).toBe('0.00');
    });
    it('30 movimientos completos y 31 recortados se distinguen sin totals de la lista parcial', async () => {
        const make = (n: number) => harness([row()], Array.from({ length: n }, (_, i) => movement({ id: `movement-${i}` })));
        expect((await inspect(make(30))).currentMovements.status).toBe('available');
        const result = await inspect(make(31)); expect(result.status).toBe('partial'); expect(result.currentMovements.status).toBe('truncated'); expect(result.currentMovements.rows).toHaveLength(30); expect(result.currentMovements).not.toHaveProperty('total');
        expect(result.pendingChecks.map(c => c.code)).toContain('CURRENT_MOVEMENTS_INCOMPLETE');
    });
    it.each([{ amount: 5 }, { amount: { toString: () => '5.00' } }, { amount: null }, { amount: '1e2' }, { amount: '1.001' }, { currency: 'EUR' }, { type: 'PRIVATE' }, { isVoided: 'false' }, { createdAt: 'invalid' }, { expenseId: '../foreign' }])('movimiento inválido %j invalida lista entera sin alterar snapshot', async patch => {
        const result = await inspect(harness([row()], [movement(), movement(patch)])); expect(result.status).toBe('partial'); expect(result.currentMovements).toEqual({ status: 'unavailable', rows: [] }); expect(result.snapshot).not.toBeNull();
    });
    it('salida excesiva oculta fuentes/listas enteras y conserva advertencia de límite', async () => {
        const value = row(); value.id = 'X'.repeat(18000);
        const result = await inspect(harness([value])); expect(result.status).toBe('unavailable'); expect(result.snapshot).toBeNull(); expect(result.shift.folio).toBeNull(); expect(result.currentMovements.rows).toEqual([]);
        expect(result.pendingChecks.map(c => c.code)).toContain('OUTPUT_LIMIT'); expect(JSON.stringify(result).length).toBeLessThanOrEqual(18000);
    });
});
