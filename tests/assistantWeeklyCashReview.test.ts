import { Prisma, type PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewWeeklyCash, weeklyCashReviewQuerySchema } from '../backend/services/assistant/operations/weeklyCashReview';
import { checkedSnapshotCash, summarizeCashReviewRows } from '../backend/services/assistant/operations/weeklyCashReviewSummary';
import { buildShiftCloseReport, hashShiftCloseReport } from '../backend/lib/shiftCloseReport';
import { validateShiftSnapshot } from '../backend/services/shiftSnapshotValidation';
import type { WeeklyCashReviewRow } from '../shared/assistantWeeklyCashReview';

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
    return { id: `report-${id}`, shiftId: id, closedAt, folio: report.folio, businessDate: report.businessDate, version: 1, report,
        reportBytes: Buffer.byteLength(JSON.stringify(report)), contentHash: hashShiftCloseReport(report), createdAt: closedAt };
}
const seal = (value: ReturnType<typeof row>) => ({ ...value, contentHash: hashShiftCloseReport(value.report), reportBytes: Buffer.byteLength(JSON.stringify(value.report)) });
function harness(closed: unknown[] = [row()], opened: unknown[] = [], role = 'OWNER') {
    const principal = { tenantId: 'tenant-qa', userId: 'user-qa', role };
    const queryRaw = vi.fn(async (query: Prisma.Sql) => query.sql.includes("= 'CLOSED'") ? closed : opened);
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

describe('W01 período, autoridad y lecturas limitadas', () => {
    it('usa siete días completos, corte Managua y dos SELECT con límites antes de transmitir JSON', async () => {
        const h = harness(); const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.period).toEqual({ startDate: '2026-09-02', endDate: '2026-09-08', cutoff: '2026-09-09T06:00:00.000Z', timeZone: 'America/Managua', completeDays: true });
        expect(h.queryRaw).toHaveBeenCalledTimes(2);
        expect(h.mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
        for (const [query] of h.queryRaw.mock.calls) { expect(query.sql.trim()).toMatch(/^SELECT/); expect(query.values).toContain('tenant-qa'); expect(query.sql).not.toMatch(/UPDATE|DELETE|INSERT/); }
        const closed = h.queryRaw.mock.calls[0][0];
        expect(closed.sql).toContain('LEFT JOIN `ShiftCloseReport`'); expect(closed.sql).toContain('CASE WHEN OCTET_LENGTH');
        expect(closed.values).toContain(262144); expect(closed.values).toContain(21);
        expect(closed.values.filter(v => v instanceof Date).map(v => (v as Date).toISOString())).toEqual(['2026-09-02T06:00:00.000Z', '2026-09-09T06:00:00.000Z']);
        expect(h.queryRaw.mock.calls[1][0].values).toContain(11);
    });
    it('hoy explícito conserva corte parcial; antes de medianoche Managua aún es el día anterior', async () => {
        const h = harness();
        const result = await reviewWeeklyCash(h.principal, { startDate: '2026-09-08', endDate: '2026-09-08' }, { ...h.deps, now: () => new Date('2026-09-09T05:59:59Z') });
        expect(result.period).toMatchObject({ cutoff: '2026-09-09T05:59:59.000Z', completeDays: false });
        const defaultRange = await reviewWeeklyCash(h.principal, {}, { ...h.deps, now: () => new Date('2026-09-09T05:59:59Z') });
        expect(defaultRange.period).toMatchObject({ startDate: '2026-09-01', endDate: '2026-09-07' });
    });
    it.each([
        { startDate: '2026-09-01' }, { endDate: '2026-09-01' }, { startDate: '2026-09-01', endDate: '2026-09-08' },
        { startDate: '2026-09-10', endDate: '2026-09-10' }, { startDate: '2026-09-08', endDate: '2026-09-07' },
        { startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-02' }, { tenantId: 'foreign' },
    ])('rechaza %j sin consultar cierres', async input => {
        const h = harness(); await expect(reviewWeeklyCash(h.principal, input, h.deps)).rejects.toMatchObject({ code: 'CASH_REVIEW_PERIOD_INVALID', statusCode: 400 });
        expect(h.queryRaw).not.toHaveBeenCalled();
    });
    it('schema estricto exige ambas fechas; acepta un día bisiesto real', () => {
        expect(weeklyCashReviewQuerySchema.safeParse({ startDate: '2024-02-29', endDate: '2024-02-29' }).success).toBe(true);
        expect(weeklyCashReviewQuerySchema.safeParse({ endDate: '2024-02-29' }).success).toBe(false);
    });
    it.each(['CASHIER', 'EMPLOYEE', 'VENDEDOR'])('%s sólo obtiene sus turnos, no los vendidos por él', async role => {
        const h = harness([], [], role); const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.scope).toBe('own-shifts');
        for (const [query] of h.queryRaw.mock.calls) { expect(query.sql).toContain('sh.`userId` = ?'); expect(query.values).toContain('user-qa'); expect(query.sql).not.toContain('soldById'); }
    });
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'])('%s conserva alcance del negocio sin entregar costos o nombres', async role => {
        const h = harness([row()], [], role); const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.scope).toBe('business'); expect(result.status).toBe('ok');
        expect(h.queryRaw.mock.calls[0][0].sql).not.toContain('sh.`userId` = ?');
        const text = JSON.stringify(result); expect(text).not.toMatch(/PRIVATE|IGNORE RULES|auditNotes|taxId|cogs|products|closeMeta/);
    });
    it.each(['BODEGUERO', 'LENDER', 'DRIVER'])('%s no consulta datos de caja', async role => {
        const h = harness([], [], role); await expect(reviewWeeklyCash(h.principal, {}, h.deps)).rejects.toMatchObject({ httpStatus: 403 });
        expect(h.queryRaw).not.toHaveBeenCalled();
    });
    it('revocación posterior impide devolver la información leída', async () => {
        const h = harness(); h.mocks.user.findFirst.mockResolvedValueOnce({ id: 'user-qa', role: 'OWNER', status: 'ACTIVE' }).mockResolvedValue({ id: 'user-qa', role: 'OWNER', status: 'DISABLED' });
        await expect(reviewWeeklyCash(h.principal, {}, h.deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED', statusCode: 403 });
        expect(h.queryRaw).toHaveBeenCalledTimes(2);
    });
    it('fallo de BD es indisponibilidad, no cero cierres', async () => {
        const h = harness(); h.queryRaw.mockRejectedValue(new Error('private DB failure'));
        await expect(reviewWeeklyCash(h.principal, {}, h.deps)).rejects.toMatchObject({ code: 'CASH_REVIEW_UNAVAILABLE', statusCode: 503 });
    });
});

describe('W01 snapshots, diferencias y falta de evidencia', () => {
    it('separa faltantes y sobrantes NIO/USD sin netearlos ni sumar fondos de turnos', async () => {
        const h = harness([row('a', { countedNio: '99.99', differenceNio: '-0.01', countedUsd: '1.0001', differenceUsd: '0.0001' }), row('b', { countedNio: '100.02', differenceNio: '0.02', countedUsd: '0.9998', differenceUsd: '-0.0002' })], [{ shiftId: 'open-1' }]);
        const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.totals).toEqual({ shortageNio: '0.01', surplusNio: '0.02', shortageUsd: '0.0002', surplusUsd: '0.0001' });
        expect(result.counts).toEqual({ closed: 2, verified: 2, differences: 2, missingReports: 0, invalidReports: 0, open: 1 });
        expect(result.rows[2]).toMatchObject({ status: 'OPEN', cash: null, source: null });
        expect(result.rows[2].message).toContain('no reconstruye');
        expect(result.totals).not.toHaveProperty('expectedNio');
    });
    it('cierre verificado en cero sí informa cero; sin cierres no inventa saldos', async () => {
        const h = harness([row('zero', { expectedNio: '0', countedNio: '0', expectedUsd: '0', countedUsd: '0' })]);
        const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.status).toBe('ok'); expect(result.totals).toEqual({ shortageNio: '0.00', surplusNio: '0.00', shortageUsd: '0.0000', surplusUsd: '0.0000' });
        const empty = harness([], [{ shiftId: 'open' }]); const unavailable = await reviewWeeklyCash(empty.principal, {}, empty.deps);
        expect(unavailable.status).toBe('unavailable'); expect(Object.values(unavailable.totals)).toEqual([null, null, null, null]);
    });
    it('snapshot ausente bloquea el total aunque otro cierre esté íntegro', async () => {
        const h = harness([row(), { ...row('missing'), id: null, report: null }]); const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.status).toBe('partial'); expect(result.counts.missingReports).toBe(1); expect(result.rows[1].cash).toBeNull();
        expect(Object.values(result.totals)).toEqual([null, null, null, null]);
    });
    it.each(['hash', 'equation', 'precision', 'closedAt', 'generatedAt', 'date', 'openedAt', 'json', 'version'])('detecta %s inválido sin usar sus importes', async kind => {
        let invalid = row();
        if (kind === 'hash') invalid.contentHash = '0'.repeat(64);
        if (kind === 'equation') { invalid.report.cash.differenceNio = '1.00'; invalid = seal(invalid); }
        if (kind === 'precision') { invalid.report.cash.countedUsd = '1.00001'; invalid.report.cash.differenceUsd = '0.00001'; invalid = seal(invalid); }
        if (kind === 'closedAt') { invalid.report.shift.closedAt = '2026-09-08T18:00:00Z'; invalid = seal(invalid); }
        if (kind === 'generatedAt') { invalid.report.generatedAt = '2026-09-08T18:00:00Z'; invalid = seal(invalid); }
        if (kind === 'date') { invalid.report.businessDate = '2026-09-07'; invalid.businessDate = '2026-09-07'; invalid = seal(invalid); }
        if (kind === 'openedAt') { invalid.report.shift.openedAt = '2026-09-08T18:00:00Z'; invalid = seal(invalid); }
        if (kind === 'json') (invalid as any).report = '{invalid';
        if (kind === 'version') invalid.version = 2;
        const h = harness([invalid]); const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.status).toBe('unavailable'); expect(result.counts.invalidReports).toBe(1);
        expect(result.rows[0]).toMatchObject({ status: 'INVALID_REPORT', cash: null, source: null, folio: null });
    });
    it('rechaza un snapshot excesivo antes de acceder al JSON', async () => {
        const invalid = { ...row(), reportBytes: 262145 };
        Object.defineProperty(invalid, 'report', { get() { throw new Error('JSON should not be read'); } });
        const h = harness([invalid]); const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.rows[0].status).toBe('INVALID_REPORT');
    });
    it.each(['closed', 'open'])('exceso de %s no presenta total parcial como completo', async kind => {
        const h = harness(kind === 'closed' ? Array.from({ length: 21 }, (_, i) => row(`shift-${i}`)) : [row()], kind === 'open' ? Array.from({ length: 11 }, (_, i) => ({ shiftId: `open-${i}` })) : []);
        const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.truncated).toBe(true); expect(result.status).toBe('unavailable'); expect(Object.values(result.totals)).toEqual([null, null, null, null]);
        expect(result.rows.length).toBeLessThanOrEqual(30); expect(result.warnings.join(' ')).toContain('mínimos observados');
    });
    it('salida excesiva por identificadores limita todo el resultado a menos de18000 caracteres', async () => {
        const closed = Array.from({ length: 20 }, (_, i) => row(`${'ñ'.repeat(175)}-${i}`)); const h = harness(closed);
        const result = await reviewWeeklyCash(h.principal, {}, h.deps);
        expect(result.truncated).toBe(true); expect(result.rows).toEqual([]); expect(result.status).toBe('unavailable');
        expect(JSON.stringify(result).length).toBeLessThanOrEqual(18000); expect(Object.values(result.totals)).toEqual([null, null, null, null]);
    });
});

describe('W01 fórmulas puras con magnitudes independientes', () => {
    const cashRow = (nio: string, usd: string, status: WeeklyCashReviewRow['status'] = 'DIFFERENCE'): WeeklyCashReviewRow => ({ shiftId: 'x', status, closedAt: null, businessDate: null, folio: null, source: null,
        cash: { expectedNio: '0', countedNio: '0', differenceNio: nio, expectedUsd: '0', countedUsd: '0', differenceUsd: usd }, message: '' });
    it('suma varios incidentes por signo con precisión superior a Number', () => {
        const result = summarizeCashReviewRows([cashRow('-99999999999999.99', '0.0001'), cashRow('-0.01', '-99999999999999.9999'), cashRow('0.03', '-0.0001'), cashRow('0.04', '0.0002')], 4, 0, false);
        expect(result.totals).toEqual({ shortageNio: '100000000000000.00', surplusNio: '0.07', shortageUsd: '100000000000000.0000', surplusUsd: '0.0003' });
    });
    it('un esperado negativo conserva la incidencia si el conteo físico y ecuación son coherentes', () => {
        const value = row('negative', { expectedNio: '-5.00', countedNio: '0.00', differenceNio: '5.00' });
        expect(checkedSnapshotCash(validateShiftSnapshot(value, value.shiftId), value.closedAt).differenceNio).toBe('5.00');
    });
    it('admite apertura y cierre en el mismo instante sin inventar una duración mínima', () => {
        const value = row(); value.report.shift.openedAt = value.closedAt.toISOString();
        const snapshot = validateShiftSnapshot(seal(value), value.shiftId);
        expect(checkedSnapshotCash(snapshot, value.closedAt)).toEqual({
            expectedNio: '100.00', countedNio: '100.00', differenceNio: '0.00',
            expectedUsd: '1.0000', countedUsd: '1.0000', differenceUsd: '0.0000',
        });
    });
    it('distingue una fecha incoherente de una diferencia aritmética inválida', () => {
        const value = row(); const snapshot = validateShiftSnapshot(value, value.shiftId);
        snapshot.report.shift.openedAt = new Date(value.closedAt.getTime() + 1).toISOString();
        expect(() => checkedSnapshotCash(snapshot, value.closedAt)).toThrow('CASH_REVIEW_SNAPSHOT_DATE');
    });
    it.each([
        { countedNio: '-1.00', differenceNio: '-101.00' }, { countedUsd: '-1.0000', differenceUsd: '-2.0000' },
        { expectedNio: 'NaN' }, { countedUsd: 'Infinity' }, { differenceNio: '0.001' }, { expectedUsd: '1.00001' },
    ])('no acepta aritmética o captura inválida %j', patch => {
        const value = row(); const snapshot = validateShiftSnapshot(value, value.shiftId); Object.assign(snapshot.report.cash, patch);
        expect(() => checkedSnapshotCash(snapshot, value.closedAt)).toThrow('CASH_REVIEW_SNAPSHOT_CASH');
    });
});
