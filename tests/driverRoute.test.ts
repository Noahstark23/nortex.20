import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
    motorizado: {
        findMany: vi.fn(),
    },
}));

const compareMock = vi.hoisted(() => vi.fn());
const signDriverTokenMock = vi.hoisted(() => vi.fn((driverId: string) => `driver-token:${driverId}`));

vi.mock('express-rate-limit', () => ({
    default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('bcryptjs', () => ({
    default: {
        compare: compareMock,
        hash: vi.fn(),
    },
}));

vi.mock('../backend/lib/prisma.js', () => ({
    default: prismaMock,
    prisma: prismaMock,
}));

vi.mock('../backend/services/secrets', () => ({
    signDriverToken: signDriverTokenMock,
    verifyDriverToken: vi.fn(),
}));

vi.mock('../backend/services/ledger', () => ({
    appendDriverWalletMovement: vi.fn(),
}));

vi.mock('../backend/services/stockService.js', () => ({
    StockError: class StockError extends Error {
        code = 'STOCK_ERROR';
    },
}));

vi.mock('../backend/services/pedidoFulfillmentService.js', () => ({
    completePedidoDeliveryInTransaction: vi.fn(),
    PedidoFulfillmentError: class PedidoFulfillmentError extends Error {
        code = 'PEDIDO_ERROR';
        httpStatus = 409;
    },
}));

type DriverRouteModule = typeof import('../backend/routes/driver');
let routeModule: DriverRouteModule;

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'driver-route-test-secret');
    routeModule = await import('../backend/routes/driver');
});

beforeEach(() => {
    prismaMock.motorizado.findMany.mockReset();
    compareMock.mockReset();
    signDriverTokenMock.mockReset();
    signDriverTokenMock.mockImplementation((driverId: string) => `driver-token:${driverId}`);
});

const response = () => {
    const res: any = {
        statusCode: 200,
        payload: undefined as unknown,
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: vi.fn((payload: unknown) => {
            res.payload = payload;
            return payload;
        }),
    };
    return res;
};

const routeHandler = (path: string, method: 'post'): any => {
    const router = routeModule.default as any;
    const layer = router.stack.find((candidate: any) =>
        candidate.route?.path === path && candidate.route.methods?.[method]);
    if (!layer) throw new Error(`No se encontró ${method.toUpperCase()} ${path}`);
    return layer.route.stack.at(-1).handle as any;
};

describe('driver login route', () => {
    it('falla cerrado cuando la consulta devuelve identidades ambiguas', async () => {
        const login = routeHandler('/login', 'post');
        const res = response();
        prismaMock.motorizado.findMany.mockResolvedValue(
            Array.from({ length: 51 }, (_, index) => ({
                id: `driver-${index + 1}`,
                nombre: `Driver ${index + 1}`,
                tipoFlota: 'PROPIA',
                zonaCobertura: 'Managua',
                kycStatus: 'APROBADO',
                activo: true,
                pinHash: `hash-${index + 1}`,
            })),
        );

        await login({
            body: { telefono: '8888-0000', pin: '1234' },
        }, res);

        expect(prismaMock.motorizado.findMany).toHaveBeenCalledWith({
            where: { telefono: '88880000', pinHash: { not: null } },
            take: 2,
            select: {
                id: true,
                nombre: true,
                tipoFlota: true,
                zonaCobertura: true,
                kycStatus: true,
                activo: true,
                pinHash: true,
            },
        });
        expect(compareMock).not.toHaveBeenCalled();
        expect(signDriverTokenMock).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.payload).toEqual({ error: 'Teléfono o PIN incorrectos.' });
    });

    it('rechaza dos identidades sin usar el PIN para escoger una', async () => {
        const login = routeHandler('/login', 'post');
        const res = response();
        prismaMock.motorizado.findMany.mockResolvedValue([
            {
                id: 'driver-a',
                nombre: 'Driver A',
                tipoFlota: 'NORTEX',
                zonaCobertura: 'Managua',
                kycStatus: 'APROBADO',
                activo: true,
                pinHash: 'hash-a',
            },
            {
                id: 'driver-b',
                nombre: 'Driver B',
                tipoFlota: 'PROPIA',
                zonaCobertura: 'Masaya',
                kycStatus: 'APROBADO',
                activo: true,
                pinHash: 'hash-b',
            },
        ]);
        compareMock.mockResolvedValue(true);

        await login({
            body: { telefono: '8888-0000', pin: '1234' },
        }, res);

        expect(prismaMock.motorizado.findMany).toHaveBeenCalledWith({
            where: { telefono: '88880000', pinHash: { not: null } },
            take: 2,
            select: {
                id: true,
                nombre: true,
                tipoFlota: true,
                zonaCobertura: true,
                kycStatus: true,
                activo: true,
                pinHash: true,
            },
        });
        expect(compareMock).not.toHaveBeenCalled();
        expect(signDriverTokenMock).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.payload).toEqual({
            error: 'Teléfono o PIN incorrectos.',
        });
    });

    it('emite token solo para un teléfono único con PIN válido', async () => {
        const login = routeHandler('/login', 'post');
        const res = response();
        prismaMock.motorizado.findMany.mockResolvedValue([
            {
                id: 'driver-b',
                nombre: 'Driver B',
                tipoFlota: 'PROPIA',
                zonaCobertura: 'Masaya',
                kycStatus: 'APROBADO',
                activo: true,
                pinHash: 'hash-b',
            },
        ]);
        compareMock.mockResolvedValueOnce(true);

        await login({
            body: { telefono: '8888-0000', pin: '1234' },
        }, res);

        expect(compareMock).toHaveBeenCalledExactlyOnceWith('1234', 'hash-b');
        expect(signDriverTokenMock).toHaveBeenCalledOnce();
        expect(signDriverTokenMock).toHaveBeenCalledWith('driver-b');
        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({
            token: 'driver-token:driver-b',
            driver: {
                id: 'driver-b',
                nombre: 'Driver B',
                tipoFlota: 'PROPIA',
                zonaCobertura: 'Masaya',
            },
        });
    });
});
