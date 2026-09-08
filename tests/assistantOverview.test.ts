import { Prisma, type PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssistantOverview, getAssistantPeriod } from '../backend/services/assistant/overview';

function harness(role = 'OWNER') {
    const principal = { tenantId: 'tenant-a', userId: 'user-a', role };
    const queries: Prisma.Sql[] = [];
    const mocks = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a', role, status: 'ACTIVE' }) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
        $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
            queries.push(sql);
            if (sql.sql.includes('FROM Sale') && sql.sql.includes('unknownVat')) return [{ total: '115.1234', count: 2n, vat: '15.1234', unknownVat: 0n }];
            if (sql.sql.includes('FROM ProductReturn')) return [{ total: '23.00' }];
            if (sql.sql.includes('FROM ProductBatch')) return [{ expired: 1n, expiring: 2n }];
            if (sql.sql.includes('FROM Product ')) return [{ count: 3n, outOfStock: 1n, low: 2n }];
            if (sql.sql.includes('unknownBalance')) return [{ total: '40.10', unknownBalance: 0n }];
            return [{ total: '10.20' }];
        }),
    };
    return { principal, mocks, queries, db: mocks as unknown as PrismaClient };
}

beforeEach(() => vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('NortexGPT: período e indicadores verificables', () => {
    it('usa medianoche Managua y límite superior exclusivo', () => {
        expect(getAssistantPeriod({ startDate: '2026-09-01', endDate: '2026-09-05' })).toMatchObject({
            start: new Date('2026-09-01T06:00:00Z'), endExclusive: new Date('2026-09-06T06:00:00Z'),
        });
        expect(getAssistantPeriod({}, new Date('2026-09-01T03:00:00Z'))).toMatchObject({ startDate: '2026-08-01', endDate: '2026-08-31' });
    });
    it.each([
        { startDate: '2026-02-30' }, { endDate: '2026-13-01' }, { startDate: '2026-09-05', endDate: '2026-09-01' },
        { startDate: '2020-01-01', endDate: '2026-09-01' }, { tenantId: 'other' },
    ])('rechaza período inválido o contexto inyectado %j', input => {
        expect(() => getAssistantPeriod(input)).toThrow();
    });
    it('devuelve decimales exactos y devoluciones por separado con procedencia', async () => {
        const { principal, db, queries } = harness();
        const result = await getAssistantOverview(principal, { startDate: '2026-09-01', endDate: '2026-09-05' }, db);
        expect(result.metrics.find(m => m.key === 'salesTotal')).toMatchObject({ value: '115.1234', status: 'ok', source: expect.stringContaining('no es utilidad') });
        expect(result.metrics.find(m => m.key === 'returnsTotal')).toMatchObject({ value: '23', source: expect.stringContaining('ventas anteriores') });
        expect(result.metrics.find(m => m.key === 'receivables')?.label).toContain('ahora');
        for (const query of queries) {
            expect(query.values).toContain('tenant-a');
            expect(query.sql).not.toContain('tenant-a');
            expect(query.sql).not.toMatch(/INSERT|UPDATE|DELETE/);
        }
        const saleQuery = queries.find(query => query.sql.includes('unknownVat'));
        expect(saleQuery?.sql).toContain('cancelledAt IS NULL');
        expect(saleQuery?.sql).toContain("'VOIDED', 'CANCELLED'");
    });
    it('cajero y vendedor solo consultan sus ventas, sin cuentas ni costos', async () => {
        for (const role of ['CASHIER', 'VENDEDOR', 'EMPLOYEE']) {
            const { principal, db, queries } = harness(role);
            const result = await getAssistantOverview(principal, {}, db);
            expect(result.metrics.map(m => m.key)).toEqual(['salesTotal', 'salesCount', 'salesVat', 'returnsTotal']);
            expect(queries).toHaveLength(2);
            for (const query of queries) {
                expect(query.sql).toContain('s.soldById = ?');
                expect(query.values).toContain('user-a');
            }
        }
    });
    it('bodeguero solo recibe cantidades actuales; no se consulta dinero', async () => {
        const { principal, db, queries } = harness('BODEGUERO');
        const result = await getAssistantOverview(principal, {}, db, 'all', new Date('2026-09-01T03:00:00Z'));
        expect(result.metrics.every(m => m.unit === 'count')).toBe(true);
        expect(result.metrics.find(m => m.key === 'productCount')).toMatchObject({ value: '3', status: 'ok' });
        expect(result.metrics.find(m => m.key === 'outOfStockCount')).toMatchObject({ value: '1', status: 'ok' });
        expect(result.metrics.find(m => m.key === 'lowStockCount')).toMatchObject({ value: '2', status: 'ok' });
        expect(queries).toHaveLength(2);
        expect(queries.some(query => /Sale|Expense|Purchase/.test(query.sql))).toBe(false);
        const batches = queries.find(query => query.sql.includes('ProductBatch'));
        expect(batches?.values).toContainEqual(new Date('2026-08-31T00:00:00Z'));
        expect(batches?.values).toContainEqual(new Date('2026-10-01T00:00:00Z'));
    });
    it('gerencia ve ventas/compras pero no contabilidad global', async () => {
        const { principal, db } = harness('MANAGER');
        const result = await getAssistantOverview(principal, {}, db);
        expect(result.metrics.map(m => m.key)).toContain('purchasesTotal');
        expect(result.metrics.map(m => m.key)).not.toEqual(expect.arrayContaining(['expensesTotal', 'receivables', 'payables']));
        await expect(getAssistantOverview(principal, {}, db, 'balances')).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    });
    it('facturas usan días civiles que incluyen registros históricos a medianoche', async () => {
        const { principal, db, queries } = harness();
        await getAssistantOverview(principal, { startDate: '2026-09-01', endDate: '2026-09-05' }, db);
        const purchases = queries.find(query => query.sql.includes('FROM Purchase') && !query.sql.includes('unknownBalance'));
        expect(purchases?.values).toContainEqual(new Date('2026-09-01T00:00:00Z'));
        expect(purchases?.values).toContainEqual(new Date('2026-09-06T00:00:00Z'));
    });
    it('sumas vacías verificadas son cero; fallos y fotos fiscales ausentes nunca se vuelven cero', async () => {
        const { principal, db, mocks } = harness();
        mocks.$queryRaw.mockResolvedValue([{ total: '0', count: 0n, vat: '0', unknownVat: 1n }] as any);
        const result = await getAssistantOverview(principal, {}, db, 'sales');
        expect(result.metrics.find(m => m.key === 'salesTotal')).toMatchObject({ value: '0', status: 'ok' });
        expect(result.metrics.find(m => m.key === 'salesVat')).toMatchObject({ value: null, status: 'unavailable' });
        mocks.$queryRaw.mockRejectedValue(new Error('not available'));
        expect((await getAssistantOverview(principal, {}, db, 'sales')).metrics.every(m => m.status === 'unavailable' && m.value === null)).toBe(true);
    });
    it('un saldo histórico no materializado deja CxP como no disponible', async () => {
        const { principal, db, mocks } = harness();
        mocks.$queryRaw.mockResolvedValue([{ total: '999', unknownBalance: 1n }] as any);
        const result = await getAssistantOverview(principal, {}, db, 'balances');
        expect(result.metrics.find(m => m.key === 'payables')).toMatchObject({ value: null, status: 'unavailable' });
    });
    it('rol revocado durante la lectura impide devolver los agregados', async () => {
        const { principal, db, mocks } = harness();
        mocks.user.findFirst.mockResolvedValueOnce({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' }).mockResolvedValue({ id: 'user-a', role: 'CASHIER', status: 'ACTIVE' });
        await expect(getAssistantOverview(principal, {}, db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    });
});
