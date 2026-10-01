import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { syntheticAdminOverview } from './fixtures/adminOverview';
const mocks = vi.hoisted(() => ({ verifyAuthToken: vi.fn(), userFindUnique: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: mocks.verifyAuthToken }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: mocks.userFindUnique } } }));
import { buildAdminOverviewRouter } from '../backend/routes/adminOverview';

function harness(path = '/metrics') {
    const service = { getOverview: vi.fn().mockResolvedValue(syntheticAdminOverview) };
    const route = buildAdminOverviewRouter(service).stack.find(layer => layer.route?.path === path)?.route;
    if (!route) throw new Error('Ruta admin ausente');
    const run = async (patch: Record<string, unknown> = {}) => {
        const req = { method: 'GET', originalUrl: `/api/admin${path}`, headers: { authorization: 'Bearer synthetic' }, query: {}, ...patch };
        const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
            status(code: number) { this.statusCode = code; return this; },
            json(body: unknown) { this.body = body; return this; },
            setHeader(key: string, value: string) { this.headers[key] = value; return this; } };
        for (const layer of route.stack) {
            let next = false;
            await layer.handle(req as unknown as Request, res as unknown as Response, () => { next = true; });
            if (!next) break;
        }
        return res;
    };
    return { run, service };
}
const principal = (patch = {}) => ({ id: 'synthetic-user', tenantId: 'synthetic-admin', role: 'SUPER_ADMIN', status: 'ACTIVE', email: null, ...patch });

describe('admin existente: autoridad real y mínima exposición', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyAuthToken.mockReturnValue({ userId: 'synthetic-user', tenantId: 'synthetic-admin', role: 'SUPER_ADMIN' });
        mocks.userFindUnique.mockResolvedValue(principal());
    });
    it.each(['/metrics', '/tenants'])('protege %s y conserva lectura privada sin caché', async path => {
        const { run, service } = harness(path);
        const res = await run();
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(syntheticAdminOverview);
        expect(res.headers['Cache-Control']).toBe('private, no-store');
        expect(service.getOverview).toHaveBeenCalledExactlyOnceWith({ page: 1 });
        expect(mocks.userFindUnique).toHaveBeenCalledTimes(2);
    });
    it('no ejecuta lecturas globales sin token', async () => {
        const { run, service } = harness();
        expect((await run({ headers: {} })).statusCode).toBe(401);
        expect(service.getOverview).not.toHaveBeenCalled();
    });
    it('rechaza una firma inválida', async () => {
        mocks.verifyAuthToken.mockImplementation(() => { throw new Error('invalid'); });
        const { run, service } = harness();
        expect((await run()).statusCode).toBe(403);
        expect(service.getOverview).not.toHaveBeenCalled();
    });
    it.each(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'VIEWER', 'BODEGUERO'])('rol de comercio %s no accede aunque JWT diga SUPER_ADMIN', async role => {
        mocks.userFindUnique.mockResolvedValue(principal({ role }));
        const { run, service } = harness();
        expect((await run()).statusCode).toBe(403);
        expect(service.getOverview).not.toHaveBeenCalled();
    });
    it.each([{ status: 'DISABLED' }, { tenantId: 'other-tenant' }])('revoca sesiones con principal cambiado %j', async patch => {
        mocks.userFindUnique.mockResolvedValue(principal(patch));
        const { run, service } = harness();
        expect((await run()).statusCode).toBe(403);
        expect(service.getOverview).not.toHaveBeenCalled();
    });
    it('revalida el superadmin antes de la consulta global', async () => {
        mocks.userFindUnique.mockResolvedValueOnce(principal()).mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' });
        const { run, service } = harness();
        expect((await run()).statusCode).toBe(403);
        expect(service.getOverview).not.toHaveBeenCalled();
    });
    it('DB de autorización caída falla cerrada', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.userFindUnique.mockRejectedValue(new Error('synthetic db failure'));
        const { run, service } = harness();
        try {
            expect((await run()).statusCode).toBe(500);
            expect(service.getOverview).not.toHaveBeenCalled();
        } finally { log.mockRestore(); }
    });
    it.each([{ tenantId: 'other' }, { role: 'SUPER_ADMIN' }, { page: '0' }, { page: '1.1' }, { kind: 'PAID' }, { focus: 'BANK' }, { search: 'a'.repeat(81) }])('rechaza override o filtro inválido %j', async query => {
        const { run, service } = harness();
        expect((await run({ query })).statusCode).toBe(400);
        expect(service.getOverview).not.toHaveBeenCalled();
    });
    it('consulta los filtros aceptados sin aceptar identidad del body', async () => {
        const { run, service } = harness();
        expect((await run({ query: { page: '2', kind: 'REAL', focus: 'NO_SALE', search: '  sintético  ' }, body: { tenantId: 'other' } })).statusCode).toBe(200);
        expect(service.getOverview).toHaveBeenCalledExactlyOnceWith({ page: 2, kind: 'REAL', focus: 'NO_SALE', search: 'sintético' });
    });
    it('datos ausentes o esquema pendiente no se muestran como lista vacía ni cero', async () => {
        const { run, service } = harness();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        service.getOverview.mockRejectedValue(Object.assign(new Error('private SQL'), { code: 'P2021' }));
        try {
            const res = await run();
            expect(res.statusCode).toBe(503);
            expect(res.body).toMatchObject({ code: 'ADMIN_EVIDENCE_UNAVAILABLE' });
            expect(JSON.stringify(res.body)).not.toContain('private SQL');
        } finally { log.mockRestore(); }
    });
});
