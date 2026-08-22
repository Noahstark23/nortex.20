import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
    verifyAuthToken: vi.fn(),
    userFindUnique: vi.fn(),
    tenantFindUnique: vi.fn(),
}));

vi.mock('../backend/services/secrets', () => ({
    verifyAuthToken: authMocks.verifyAuthToken,
}));

vi.mock('../backend/lib/prisma.js', () => ({
    default: {
        user: { findUnique: authMocks.userFindUnique },
        tenant: { findUnique: authMocks.tenantFindUnique },
    },
}));

import { authenticate, flushAllCache } from '../backend/middleware/auth';
import { POS_SALE_ROLES } from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';

const tokenPrincipal = {
    userId: 'user-a',
    tenantId: 'tenant-a',
    role: 'ADMIN',
    email: 'anterior@nortex.test',
};

const activeUser = (patch: Record<string, unknown> = {}) => ({
    id: 'user-a',
    tenantId: 'tenant-a',
    role: 'ADMIN',
    status: 'ACTIVE',
    email: 'actual@nortex.test',
    ...patch,
});

const request = (method = 'GET', originalUrl = '/api/sales/search') => ({
    headers: { authorization: 'Bearer signed-token' },
    method,
    originalUrl,
});

const response = () => {
    const res: any = {
        statusCode: 200,
        body: undefined,
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: vi.fn((body: unknown) => {
            res.body = body;
            return res;
        }),
    };
    return res;
};

describe('authenticate revalida la autoridad persistida en cada request', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        flushAllCache();
        authMocks.verifyAuthToken.mockReturnValue({ ...tokenPrincipal });
        authMocks.userFindUnique.mockResolvedValue(activeUser());
        authMocks.tenantFindUnique.mockResolvedValue({
            subscriptionStatus: 'ACTIVE',
            trialEndsAt: null,
        });
    });

    it('consulta el usuario en BD en cada request, incluso en rutas exentas de billing', async () => {
        const firstNext = vi.fn();
        const secondNext = vi.fn();

        await authenticate(request(), response(), firstNext);
        await authenticate(request(), response(), secondNext);

        expect(firstNext).toHaveBeenCalledOnce();
        expect(secondNext).toHaveBeenCalledOnce();
        expect(authMocks.userFindUnique).toHaveBeenCalledTimes(2);
        expect(authMocks.userFindUnique).toHaveBeenNthCalledWith(1, {
            where: { id: 'user-a' },
            select: { id: true, tenantId: true, role: true, status: true, email: true },
        });
    });

    it('usa el rol y email actuales de BD, nunca los claims viejos del JWT', async () => {
        authMocks.userFindUnique.mockResolvedValue(activeUser({
            role: 'VIEWER',
            email: 'nuevo@nortex.test',
        }));
        const req: any = request();
        const authRes = response();
        const authNext = vi.fn();

        await authenticate(req, authRes, authNext);

        expect(authNext).toHaveBeenCalledOnce();
        expect(req).toMatchObject({
            userId: 'user-a',
            tenantId: 'tenant-a',
            role: 'VIEWER',
            email: 'nuevo@nortex.test',
        });

        const roleRes = response();
        const roleNext = vi.fn();
        checkRole(POS_SALE_ROLES)(req, roleRes, roleNext);
        expect(roleNext).not.toHaveBeenCalled();
        expect(roleRes.statusCode).toBe(403);
    });

    it('revoca inmediatamente un usuario DISABLED aunque su JWT siga vigente', async () => {
        authMocks.userFindUnique.mockResolvedValue(activeUser({ status: 'DISABLED' }));
        const res = response();
        const next = vi.fn();

        await authenticate(request(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
    });

    it('falla cerrado cuando el userId firmado ya no existe en BD', async () => {
        authMocks.userFindUnique.mockResolvedValue(null);
        const res = response();
        const next = vi.fn();

        await authenticate(request(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
        expect(authMocks.tenantFindUnique).not.toHaveBeenCalled();
    });

    it('revoca el JWT si el usuario ahora pertenece a otro tenant', async () => {
        authMocks.userFindUnique.mockResolvedValue(activeUser({ tenantId: 'tenant-b' }));
        const res = response();
        const next = vi.fn();

        await authenticate(request(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
        expect(authMocks.tenantFindUnique).not.toHaveBeenCalled();
    });

    it('preserva SUPER_ADMIN solo cuando el rol ACTIVE actual esta en BD', async () => {
        authMocks.verifyAuthToken.mockReturnValue({ ...tokenPrincipal, role: 'VIEWER' });
        authMocks.userFindUnique.mockResolvedValue(activeUser({ role: 'SUPER_ADMIN' }));
        const res = response();
        const next = vi.fn();

        await authenticate(request('POST', '/api/accounting/journal'), res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(authMocks.tenantFindUnique).not.toHaveBeenCalled();
    });

    it('falla cerrado si no puede consultar el estado actual del usuario', async () => {
        authMocks.userFindUnique.mockRejectedValue(new Error('db unavailable'));
        const res = response();
        const next = vi.fn();

        await authenticate(request(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(500);
        expect(res.body).toMatchObject({ code: 'AUTH_STATE_UNAVAILABLE' });
    });

    it('rechaza tokens de otro tipo antes de consultar al usuario', async () => {
        authMocks.verifyAuthToken.mockImplementation(() => {
            throw new Error('driver token no valido para sesion de usuario');
        });
        const res = response();
        const next = vi.fn();

        await authenticate(request(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(authMocks.userFindUnique).not.toHaveBeenCalled();
    });
});
