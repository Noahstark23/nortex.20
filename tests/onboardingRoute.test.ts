import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ verifyAuthToken: vi.fn(), userFindUnique: vi.fn(), tenantFindUnique: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: mocks.verifyAuthToken }));
vi.mock('../backend/lib/prisma.js', () => ({ default: {
    user: { findUnique: mocks.userFindUnique }, tenant: { findUnique: mocks.tenantFindUnique },
} }));

import { buildOnboardingRouter } from '../backend/routes/onboarding';
import type { OnboardingStatusResult } from '../backend/services/onboardingStatusService';

const status: OnboardingStatusResult = {
    type: 'FERRETERIA', businessName: 'Norte', steps: [], completed: 0, total: 0, allDone: false,
    salesProgress: { confirmedSales: 0, lastSaleAt: null },
};

function harness() {
    const service = { getStatus: vi.fn< (tenantId: string) => Promise<OnboardingStatusResult | null> >().mockResolvedValue(status) };
    const router = buildOnboardingRouter(service);
    const route = router.stack.find(layer => {
        const candidate = layer.route as typeof layer.route & { methods?: { get?: boolean } };
        return candidate?.path === '/' && candidate.methods?.get;
    })?.route;
    if (!route) throw new Error('No existe GET / del router onboarding');
    const handlers = route.stack.map(layer => layer.handle);
    const request = (patch: Record<string, unknown> = {}) => ({
        method: 'GET', originalUrl: '/api/onboarding', url: '/',
        headers: { authorization: 'Bearer valid-token' }, query: {}, body: {}, ...patch,
    });
    const response = () => {
        const res = {
            statusCode: 200, body: undefined as unknown,
            status(code: number) { this.statusCode = code; return this; },
            json(body: unknown) { this.body = body; return this; },
        };
        return res;
    };
    const run = async (patch: Record<string, unknown> = {}) => {
        const req = request(patch);
        const res = response();
        // Ejecuta authenticate REAL y el handler sin socket, DB ni servidor.
        for (const handler of handlers) {
            let nextCalled = false;
            await handler(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });
            if (!nextCalled) break;
        }
        return res;
    };
    return { service, run };
}

describe('GET /api/onboarding: conserva autenticación y contrato', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyAuthToken.mockReturnValue({ userId: 'user-a', tenantId: 'tenant-a', role: 'OWNER' });
        mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'OWNER', status: 'ACTIVE', email: null });
    });

    it('usa el tenant revalidado e ignora tenant de query/body, manteniendo GET exento de billing', async () => {
        const { service, run } = harness();
        const res = await run({ query: { tenantId: 'tenant-b' }, body: { tenantId: 'tenant-b' }, tenantId: 'tenant-b' });
        expect(service.getStatus).toHaveBeenCalledExactlyOnceWith('tenant-a');
        expect(res).toMatchObject({ statusCode: 200, body: status });
        expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
    });

    it('sin Authorization no ejecuta el servicio', async () => {
        const { service, run } = harness();
        expect((await run({ headers: {} })).statusCode).toBe(401);
        expect(service.getStatus).not.toHaveBeenCalled();
    });

    it('rechaza token inválido antes de consultar progreso', async () => {
        const { service, run } = harness();
        mocks.verifyAuthToken.mockImplementation(() => { throw new Error('invalid'); });
        expect((await run()).statusCode).toBe(403);
        expect(service.getStatus).not.toHaveBeenCalled();
    });

    it.each(['', undefined, 'BODEGUERO'])('rol persistido %s no obtiene onboarding', async (role) => {
        const { service, run } = harness();
        mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role, status: 'ACTIVE' });
        expect((await run()).statusCode).toBe(403);
        expect(service.getStatus).not.toHaveBeenCalled();
    });

    it('conserva el acceso histórico de un cajero autenticado', async () => {
        const { service, run } = harness();
        mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'CASHIER', status: 'ACTIVE' });
        expect((await run()).statusCode).toBe(200);
        expect(service.getStatus).toHaveBeenCalledExactlyOnceWith('tenant-a');
    });

    it('un usuario movido a otro tenant no conserva acceso por el JWT anterior', async () => {
        const { service, run } = harness();
        mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-b', role: 'OWNER', status: 'ACTIVE' });
        expect((await run()).statusCode).toBe(403);
        expect(service.getStatus).not.toHaveBeenCalled();
    });

    it('contexto sin tenant nunca llega al servicio aunque el principal fuera incompleto', async () => {
        const { service, run } = harness();
        mocks.verifyAuthToken.mockReturnValue({ userId: 'user-a', role: 'OWNER' });
        mocks.userFindUnique.mockResolvedValue({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' });
        expect((await run()).statusCode).toBe(401);
        expect(service.getStatus).not.toHaveBeenCalled();
    });

    it('conserva el 404 para negocio inexistente', async () => {
        const { service, run } = harness();
        service.getStatus.mockResolvedValue(null);
        expect(await run()).toMatchObject({ statusCode: 404, body: { error: 'Negocio no encontrado' } });
    });

    it('responde 500 genérico y registra el fallo del servicio', async () => {
        const { service, run } = harness();
        const error = new Error('unavailable');
        service.getStatus.mockRejectedValue(error);
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            expect(await run()).toMatchObject({ statusCode: 500, body: { error: 'Error al calcular el onboarding' } });
            expect(log).toHaveBeenCalledWith('onboarding status error', error);
        } finally { log.mockRestore(); }
    });
});
