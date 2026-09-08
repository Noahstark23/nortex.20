import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { OperationalAlertsResponse } from '../utils/operationalAlerts';

const mocks = vi.hoisted(() => ({ verifyAuthToken: vi.fn(), userFindUnique: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: mocks.verifyAuthToken }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: mocks.userFindUnique } } }));
import { buildOperationalAlertsRouter } from '../backend/routes/operationalAlerts';

const summary: OperationalAlertsResponse = {
    checkedAt: '2026-09-04T18:00:00.000Z', sections: [{ id: 'pending_orders', status: 'ok', count: 4 }],
};

function harness() {
    const service = { getSummary: vi.fn<(tenantId: string, role: string) => Promise<OperationalAlertsResponse | null>>().mockResolvedValue(summary) };
    const router = buildOperationalAlertsRouter(service);
    const route = router.stack.find(layer => layer.route?.path === '/')?.route;
    if (!route) throw new Error('Falta ruta de alertas');
    const run = async (patch: Record<string, unknown> = {}) => {
        const req = { method: 'GET', originalUrl: '/api/operational-alerts', url: '/', headers: { authorization: 'Bearer test' }, ...patch };
        const res = {
            statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
            status(code: number) { this.statusCode = code; return this; },
            json(body: unknown) { this.body = body; return this; },
            setHeader(name: string, value: string) { this.headers[name] = value; return this; },
        };
        // Cadena de middleware real, sin socket ni servidor; Prisma y firma inyectados.
        for (const layer of route.stack) {
            let nextCalled = false;
            await layer.handle(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });
            if (!nextCalled) break;
        }
        return res;
    };
    return { service, run };
}

describe('GET operational-alerts: identidad persistida y caché privada', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyAuthToken.mockReturnValue({ userId: 'u', tenantId: 'a', role: 'OWNER' });
        mocks.userFindUnique.mockResolvedValue({ id: 'u', tenantId: 'a', role: 'OWNER', status: 'ACTIVE', email: null });
    });

    it('ignora tenant/role de cliente y consume el rol degradado en BD', async () => {
        const { service, run } = harness();
        mocks.userFindUnique.mockResolvedValue({ id: 'u', tenantId: 'a', role: 'CASHIER', status: 'ACTIVE' });
        const res = await run({ tenantId: 'b', role: 'OWNER', query: { tenantId: 'b', role: 'OWNER' }, body: { tenantId: 'b' } });
        expect(service.getSummary).toHaveBeenCalledExactlyOnceWith('a', 'CASHIER');
        expect(res).toMatchObject({ statusCode: 200, body: summary, headers: { 'Cache-Control': 'no-store' } });
    });

    it('sin autorización rechaza antes de datos de negocio y conserva no-store', async () => {
        const { service, run } = harness();
        expect(await run({ headers: {} })).toMatchObject({ statusCode: 401, headers: { 'Cache-Control': 'no-store' } });
        expect(service.getSummary).not.toHaveBeenCalled();
    });

    it.each(['BODEGUERO', 'UNKNOWN', '', undefined])('rol %s no accede al servicio', async role => {
        const { service, run } = harness();
        mocks.userFindUnique.mockResolvedValue({ id: 'u', tenantId: 'a', role, status: 'ACTIVE' });
        expect((await run()).statusCode).toBe(403);
        expect(service.getSummary).not.toHaveBeenCalled();
    });

    it.each([{ tenantId: 'b' }, { status: 'INACTIVE' }])('un principal revocado no llega al servicio: %j', async override => {
        const { service, run } = harness();
        mocks.userFindUnique.mockResolvedValue({ id: 'u', tenantId: 'a', role: 'OWNER', status: 'ACTIVE', ...override });
        expect((await run()).statusCode).toBe(403);
        expect(service.getSummary).not.toHaveBeenCalled();
    });

    it('sin tenant efectivo no consulta datos', async () => {
        const { service, run } = harness();
        mocks.verifyAuthToken.mockReturnValue({ userId: 'u', role: 'OWNER' });
        mocks.userFindUnique.mockResolvedValue({ id: 'u', role: 'OWNER', status: 'ACTIVE' });
        expect((await run()).statusCode).toBe(401);
        expect(service.getSummary).not.toHaveBeenCalled();
    });

    it('informa negocio inexistente y fallo genérico sin revelar detalles de BD', async () => {
        const { service, run } = harness();
        service.getSummary.mockResolvedValue(null);
        expect((await run()).statusCode).toBe(404);
        service.getSummary.mockRejectedValue(new Error('private query details'));
        expect(await run()).toMatchObject({ statusCode: 500, body: { error: 'No se pudieron verificar las alertas. Intentá de nuevo.' } });
    });

    it('preserva la respuesta parcial sin convertir errores en ceros', async () => {
        const { service, run } = harness();
        const partial: OperationalAlertsResponse = { ...summary, sections: [{ id: 'pending_orders', status: 'error', count: null }] };
        service.getSummary.mockResolvedValue(partial);
        expect(await run()).toMatchObject({ statusCode: 200, body: partial });
    });
});
