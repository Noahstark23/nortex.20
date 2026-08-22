import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyAuthToken } = vi.hoisted(() => ({ verifyAuthToken: vi.fn() }));

vi.mock('../backend/services/secrets', () => ({ verifyAuthToken }));
vi.mock('@prisma/client', () => ({
    PrismaClient: class {
        user = { findUnique: vi.fn() };
        tenant = { findUnique: vi.fn() };
    },
}));

import { authenticate } from '../backend/middleware/auth';

function request(method: string, originalUrl: string) {
    return {
        method,
        originalUrl,
        headers: { authorization: 'Bearer valid-token' },
    } as any;
}

function responseDouble() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { status, json } as any;
}

describe('authenticate — frontera BODEGUERO post-JWT', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        verifyAuthToken.mockReturnValue({
            userId: 'user_1', tenantId: 'tenant_1', role: 'BODEGUERO', email: 'bodega@example.com',
        });
    });

    it('bloquea una lectura financiera aunque GET normalmente esté exento del paywall', async () => {
        const req = request('GET', '/api/purchases');
        const res = responseDouble();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(req.role).toBe('BODEGUERO');
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('permite una lectura operativa con query después de verificar el JWT', async () => {
        const req = request('GET', '/api/products?search=aceite');
        const res = responseDouble();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('no cambia el acceso existente de otros roles', async () => {
        verifyAuthToken.mockReturnValue({
            userId: 'manager_1', tenantId: 'tenant_1', role: 'MANAGER', email: 'manager@example.com',
        });
        const res = responseDouble();
        const next = vi.fn();

        await authenticate(request('GET', '/api/purchases'), res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });
});
