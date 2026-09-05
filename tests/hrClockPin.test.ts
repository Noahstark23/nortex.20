import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    employeeFindFirst: vi.fn(), shiftFindFirst: vi.fn(), shiftCreate: vi.fn(), shiftUpdate: vi.fn(),
    verifyAuthToken: vi.fn(), userFindUnique: vi.fn(), tenantFindUnique: vi.fn(),
}));
vi.mock('@prisma/client', async importOriginal => {
    const original = await importOriginal<typeof import('@prisma/client')>();
    return { ...original, PrismaClient: class { employee = { findFirst: mocks.employeeFindFirst }; shift = { findFirst: mocks.shiftFindFirst, create: mocks.shiftCreate, update: mocks.shiftUpdate }; } };
});
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: mocks.verifyAuthToken }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: mocks.userFindUnique }, tenant: { findUnique: mocks.tenantFindUnique } } }));

import router from '../backend/routes/hr';
import { flushAllCache } from '../backend/middleware/auth';

async function invoke(path: string, body: unknown) {
    const req = { method: 'POST', originalUrl: `/api/hr${path}`, headers: { authorization: 'Bearer fixture' }, body };
    const res: any = { statusCode: 200, payload: undefined, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.payload = value; return this; } };
    const route = router.stack.find(layer => layer.route?.path === path)!.route;
    for (const layer of route.stack) {
        let continued = false;
        await layer.handle(req as any, res, () => { continued = true; });
        if (!continued) break;
    }
    return res;
}

beforeEach(() => {
    vi.clearAllMocks(); flushAllCache();
    mocks.verifyAuthToken.mockReturnValue({ userId: 'user-a', tenantId: 'tenant-a', role: 'OWNER' });
    mocks.userFindUnique.mockResolvedValue({ id: 'user-a', tenantId: 'tenant-a', role: 'EMPLOYEE', status: 'ACTIVE' });
    mocks.tenantFindUnique.mockResolvedValue({ subscriptionStatus: 'ACTIVE' });
    mocks.employeeFindFirst.mockResolvedValue({ id: 'employee-a', firstName: 'Ana', jornada: 'DIURNA' });
    mocks.shiftFindFirst.mockResolvedValue(null);
    mocks.shiftCreate.mockResolvedValue({ id: 'shift-a' });
});

describe.each(['/clock-in', '/clock-out'])('PIN obligatorio en %s', path => {
    it.each([{}, undefined, null, { pin: null }, { pin: '' }, { pin: '   ' }, { pin: '123' }, { pin: '12345' }, { pin: '12ab' }, { pin: { equals: '1234' } }])('rechaza %j antes de consultar empleados', async body => {
        expect((await invoke(path, body)).statusCode).toBe(400);
        expect(mocks.employeeFindFirst).not.toHaveBeenCalled();
        expect(mocks.shiftCreate).not.toHaveBeenCalled();
        expect(mocks.shiftUpdate).not.toHaveBeenCalled();
    });
    it('un empleado autenticado conserva asistencia con PIN válido y tenant persistido', async () => {
        if (path === '/clock-out') mocks.shiftFindFirst.mockResolvedValue({ id: 'shift-a', startTime: new Date() });
        expect((await invoke(path, { pin: ' 0123 ', tenantId: 'tenant-b', userId: 'other' })).statusCode).toBe(200);
        expect(mocks.employeeFindFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ tenantId: 'tenant-a', pin: '0123' }) });
    });
    it('una sesión revocada nunca llega al PIN', async () => {
        mocks.userFindUnique.mockResolvedValue(null);
        expect((await invoke(path, { pin: '0123' })).statusCode).toBe(403);
        expect(mocks.employeeFindFirst).not.toHaveBeenCalled();
    });
});
