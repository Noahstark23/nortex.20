import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ verify: vi.fn(), user: vi.fn(), tenant: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: authMocks.verify }));
vi.mock('../backend/lib/prisma.js', () => ({ default: {
    user: { findUnique: authMocks.user }, tenant: { findUnique: authMocks.tenant },
} }));
import { createAssistantRouter } from '../backend/routes/assistant';

function harness() {
    const mocks = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' }) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
        assistantConversation: { create: vi.fn().mockResolvedValue({ id: 'conversation-a' }), findFirst: vi.fn().mockResolvedValue(null) },
        $queryRaw: vi.fn(),
    };
    const router = createAssistantRouter(mocks as unknown as PrismaClient);
    async function run(path: string, method: 'get' | 'post', patch: Record<string, unknown> = {}) {
        const route = router.stack.find(layer => {
            const value = layer.route as typeof layer.route & { methods?: Record<string, boolean> };
            return value?.path === path && value.methods?.[method];
        })?.route;
        if (!route) throw new Error('Missing route');
        const req = {
            method: method.toUpperCase(), originalUrl: `/api/assistant${path}`, url: path,
            headers: { authorization: 'Bearer test-token' }, body: {}, query: {}, params: { id: 'conversation-a' }, ...patch,
        };
        const res = {
            statusCode: 200, body: undefined as any,
            status(value: number) { this.statusCode = value; return this; },
            json(value: unknown) { this.body = value; return this; },
        };
        for (const layer of route.stack) {
            let proceed = false;
            await layer.handle(req as unknown as Request, res as unknown as Response, () => { proceed = true; });
            if (!proceed) break;
        }
        return res;
    }
    return { run, mocks };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
    authMocks.verify.mockReturnValue({ tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER' });
    authMocks.user.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'OWNER', status: 'ACTIVE' });
    authMocks.tenant.mockResolvedValue({ subscriptionStatus: 'ACTIVE', trialEndsAt: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('NortexGPT: rutas con autenticación real y DTO acotado', () => {
    it.each([
        ['/capabilities', 'get'], ['/overview', 'get'], ['/conversations', 'post'],
        ['/conversations/:id', 'get'], ['/conversations/:id/messages', 'post'],
    ] as const)('%s requiere autenticación antes de consultar', async (path, method) => {
        const { run, mocks } = harness();
        expect((await run(path, method, { headers: {} })).statusCode).toBe(401);
        expect(mocks.user.findFirst).not.toHaveBeenCalled();
        expect(mocks.$queryRaw).not.toHaveBeenCalled();
    });
    it('capabilities deriva tenant de identidad revalidada, nunca del cuerpo', async () => {
        const { run, mocks } = harness();
        const result = await run('/capabilities', 'get', { tenantId: 'tenant-b', body: { tenantId: 'tenant-b' } });
        expect(result).toMatchObject({ statusCode: 200, body: { enabled: true, help: true } });
        expect(mocks.user.findFirst.mock.calls[0][0].where).toEqual({ id: 'user-a', tenantId: 'tenant-a' });
        expect(mocks.assistantTenantConfig.findUnique.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a' });
    });
    it('sin flag devuelve capacidades apagadas sin tocar tablas nuevas', async () => {
        vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'false');
        const { run, mocks } = harness();
        expect(await run('/capabilities', 'get')).toMatchObject({ statusCode: 200, body: { enabled: false } });
        expect(mocks.assistantTenantConfig.findUnique).not.toHaveBeenCalled();
    });
    it('rechaza contexto o campos inesperados en creación y consulta de fechas', async () => {
        const { run, mocks } = harness();
        expect((await run('/conversations', 'post', { body: { tenantId: 'tenant-b' } })).statusCode).toBe(400);
        expect((await run('/overview', 'get', { query: { startDate: '2026-02-30' } })).statusCode).toBe(400);
        expect(mocks.assistantConversation.create).not.toHaveBeenCalled();
        expect(mocks.$queryRaw).not.toHaveBeenCalled();
    });
    it('historial ajeno retorna 404 sin identificar su dueño', async () => {
        const { run } = harness();
        expect(await run('/conversations/:id', 'get')).toMatchObject({ statusCode: 404, body: { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' } });
    });
    it('un fallo de base se traduce a error genérico sin detalles internos', async () => {
        const { run, mocks } = harness();
        mocks.assistantTenantConfig.findUnique.mockRejectedValue(new Error('private table secret document'));
        const result = await run('/capabilities', 'get');
        expect(result).toMatchObject({ statusCode: 503, body: { code: 'ASSISTANT_UNAVAILABLE' } });
        expect(JSON.stringify(result.body)).not.toContain('private table');
    });
});
