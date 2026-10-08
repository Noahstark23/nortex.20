import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verifyAuthToken: vi.fn(), userFindUnique: vi.fn(), saleFindMany: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: mocks.verifyAuthToken }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: mocks.userFindUnique }, sale: { findMany: mocks.saleFindMany } } }));
import { buildOfflineSaleEvidenceRouter, offlineEvidenceReferences } from '../backend/routes/offlineSaleEvidence';

const record = { id: 'sale-a', createdAt: new Date('2026-09-01T23:45:00Z'), total: '12.5', status: 'COMPLETED', paymentMethod: 'CASH', invoiceNumber: 7, invoiceSeries: 'A', offlinePayloadHash: 'private-hash' };
const rows = [
    { ...record, tenantId: 'tenant-a', soldById: 'user-a', offlineId: 'raw-a' },
    { ...record, id: 'other-tenant', tenantId: 'tenant-b', soldById: 'user-b', offlineId: 'other-b' },
    { ...record, id: 'other-user', tenantId: 'tenant-a', soldById: 'user-b', offlineId: 'other-user-a' },
    { ...record, id: 'historical', tenantId: 'tenant-a', soldById: null, offlineId: 'historical-a' },
];
function harness() {
    const router = buildOfflineSaleEvidenceRouter();
    const route = router.stack.find(layer => layer.route?.path === '/:offlineId')!.route;
    return async (patch: Record<string, unknown> = {}) => {
        const req = { method: 'GET', originalUrl: '/api/sales/offline-evidence/raw-a', url: '/raw-a',
            headers: { authorization: 'Bearer test' }, params: { offlineId: 'raw-a' }, ...patch };
        const res = { statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
            status(code: number) { this.statusCode = code; return this; },
            json(value: unknown) { this.body = value; return this; },
            setHeader(name: string, value: string) { this.headers[name] = value; return this; } };
        for (const layer of route.stack) {
            let next = false;
            await layer.handle(req as any, res as any, () => { next = true; });
            if (!next) break;
        }
        return res;
    };
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuthToken.mockReturnValue({ userId: 'user-a', tenantId: 'tenant-a', role: 'OWNER' });
    mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'CASHIER', status: 'ACTIVE' });
    mocks.saleFindMany.mockImplementation(async ({ where, take }) => rows.filter(row => row.tenantId === where.tenantId
        && row.soldById === where.soldById && where.offlineId.in.includes(row.offlineId)).slice(0, take));
});

describe('evidencia offline: consulta autenticada, sin mutaciones', () => {
    it('encuentra la referencia propia con proyección mínima e ignora identidad enviada por cliente', async () => {
        const res = await harness()({ tenantId: 'tenant-b', userId: 'user-b', query: { tenantId: 'tenant-b', userId: 'user-b' } });
        expect(res).toMatchObject({ statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: { status: 'recorded', record: { saleId: 'sale-a', total: '12.5', hasReplayFingerprint: true } } });
        expect(mocks.saleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', soldById: 'user-a' }), take: 2 }));
        expect(res.body.record).not.toHaveProperty('offlinePayloadHash');
        expect(res.body.record).not.toHaveProperty('tenantId');
        expect(res.body.record).not.toHaveProperty('customerName');
    });
    it.each(['other-b', 'other-user-a', 'historical-a', 'missing'])('no revela otra identidad o histórico sin autor: %s', async offlineId => {
        const res = await harness()({ params: { offlineId } });
        expect(res).toMatchObject({ statusCode: 200, body: { offlineId, status: 'not_found' } });
        expect(res.body).not.toHaveProperty('record');
    });
    it('busca ID con hash event y el ID legado con la misma semántica de salesService', async () => {
        const expected = `event:${createHash('sha256').update('tenant-a\0raw-a').digest('hex')}`;
        expect(offlineEvidenceReferences('tenant-a', 'raw-a')).toEqual([expected, 'raw-a']);
        mocks.saleFindMany.mockResolvedValue([record]);
        await harness()();
        expect(mocks.saleFindMany.mock.calls[0][0].where.offlineId.in).toEqual([expected, 'raw-a']);
    });
    it('no selecciona arbitrariamente si coexisten dos registros', async () => {
        mocks.saleFindMany.mockResolvedValue([record, { ...record, id: 'second' }]);
        expect(await harness()()).toMatchObject({ body: { status: 'ambiguous' } });
    });
    it.each(['BODEGUERO', 'VIEWER', 'UNKNOWN'])('un rol persistido %s no llega a ventas', async role => {
        mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role, status: 'ACTIVE' });
        expect((await harness()()).statusCode).toBe(403);
        expect(mocks.saleFindMany).not.toHaveBeenCalled();
    });
    it('rechaza sesión ausente, firma inválida y usuario revocado antes de consultar', async () => {
        expect((await harness()({ headers: {} })).statusCode).toBe(401);
        mocks.verifyAuthToken.mockImplementationOnce(() => { throw new Error('invalid'); });
        expect((await harness()()).statusCode).toBe(403);
        mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'CASHIER', status: 'INACTIVE' });
        expect((await harness()()).statusCode).toBe(403);
        expect(mocks.saleFindMany).not.toHaveBeenCalled();
    });
    it.each(['', ' '.repeat(2), 'x'.repeat(192)])('valida referencia sin consultar DB: %j', async offlineId => {
        expect((await harness()({ params: { offlineId } })).statusCode).toBe(400);
        expect(mocks.saleFindMany).not.toHaveBeenCalled();
    });
    it('fallo DB no equivale a no encontrado y no filtra detalles', async () => {
        mocks.saleFindMany.mockRejectedValue(new Error('private details'));
        const res = await harness()();
        expect(res.statusCode).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('private details');
        expect(res.body.status).not.toBe('not_found');
    });
});
