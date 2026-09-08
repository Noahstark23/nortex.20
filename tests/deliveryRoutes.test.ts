import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { motorizadoSafeSelect } from '../backend/services/motorizadoIdentity';

const prismaMock = vi.hoisted(() => ({
    pedido: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
}));

const bcryptHashMock = vi.hoisted(() => vi.fn(async (value: string) => `hash:${value}`));
const reservePedidoInTransactionMock = vi.hoisted(() => vi.fn());
const cancelPedidoInTransactionMock = vi.hoisted(() => vi.fn());
const completePedidoDeliveryInTransactionMock = vi.hoisted(() => vi.fn());
const lockPedidoForFulfillmentMock = vi.hoisted(() => vi.fn());
const PedidoFulfillmentErrorMock = vi.hoisted(() => class PedidoFulfillmentError extends Error {
    code: string;
    httpStatus: number;

    constructor(code: string, httpStatus: number, message: string) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }
});

vi.mock('express-rate-limit', () => ({
    default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('bcryptjs', () => ({
    default: { hash: bcryptHashMock },
}));

vi.mock('../backend/middleware/auth', () => ({
    authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../backend/middleware/checkRole', () => ({
    checkRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../backend/lib/prisma.js', () => ({
    default: prismaMock,
    prisma: prismaMock,
}));

vi.mock('../backend/services/stockService', () => ({
    StockError: class StockError extends Error {
        code: string;

        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

vi.mock('../backend/services/pedidoFulfillmentService.js', () => ({
    PEDIDO_PREPARATION_SOURCE_STATES: ['pendiente', 'asignado', 'en_tienda'],
    reservePedidoInTransaction: reservePedidoInTransactionMock,
    cancelPedidoInTransaction: cancelPedidoInTransactionMock,
    completePedidoDeliveryInTransaction: completePedidoDeliveryInTransactionMock,
    lockPedidoForFulfillment: lockPedidoForFulfillmentMock,
    PedidoFulfillmentError: PedidoFulfillmentErrorMock,
}));

vi.mock('../backend/services/publicOrderItemService.js', () => ({
    PublicOrderItemError: class PublicOrderItemError extends Error {
        code = 'PUBLIC_ITEM_ERROR';
        httpStatus = 400;
    },
    resolvePublicOrderItems: vi.fn(),
}));

vi.mock('../backend/services/secrets.js', () => ({
    signPedidoTrackingToken: vi.fn(() => 'tracking-token'),
    verifyPedidoTrackingToken: vi.fn(() => ({ tenantId: 'tenant-auth' })),
}));

vi.mock('../backend/services/pedidoTrackingService.js', () => ({
    PUBLIC_PEDIDO_TRACKING_SELECT: {},
    toPublicPedidoTrackingDto: vi.fn(),
}));

type PedidosRouteModule = typeof import('../backend/routes/pedidos');
type MotorizadosRouteModule = typeof import('../backend/routes/motorizados');

let pedidosRouteModule: PedidosRouteModule;
let motorizadosRouteModule: MotorizadosRouteModule;

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'delivery-routes-test-secret');
    pedidosRouteModule = await import('../backend/routes/pedidos');
    motorizadosRouteModule = await import('../backend/routes/motorizados');
});

const response = () => {
    const res: any = {
        statusCode: 200,
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: vi.fn((payload: unknown) => payload),
        set: vi.fn(),
    };
    return res;
};

const routeHandlers = (router: any, path: string, method: 'get' | 'post' | 'patch') => {
    const layer = router.stack.find((candidate: any) =>
        candidate.route?.path === path && candidate.route.methods?.[method]);
    if (!layer) throw new Error(`No se encontró ${method.toUpperCase()} ${path}`);
    return layer.route.stack.map((candidate: any) => candidate.handle);
};

describe('delivery route hardening', () => {
    beforeEach(() => {
        prismaMock.pedido.findMany.mockReset();
        prismaMock.pedido.findFirst.mockReset();
        prismaMock.$transaction.mockReset();
        bcryptHashMock.mockClear();
        reservePedidoInTransactionMock.mockReset();
        cancelPedidoInTransactionMock.mockReset();
        completePedidoDeliveryInTransactionMock.mockReset();
        lockPedidoForFulfillmentMock.mockReset();
    });

    it('pagina GET /pedidos sin romper el arreglo pedidos existente', async () => {
        const router = pedidosRouteModule.buildPedidosRouter();
        const handler = routeHandlers(router, '/', 'get').at(-1);
        const pedidos = Array.from({ length: 101 }, (_, index) => ({
            id: `pedido-${index + 1}`,
            estado: 'pendiente',
        }));
        prismaMock.pedido.findMany.mockResolvedValue(pedidos);
        const res = response();

        await handler({
            tenantId: 'tenant-auth',
            query: {},
        }, res);

        expect(prismaMock.pedido.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 'tenant-auth' },
            skip: 0,
            take: 101,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            pedidos: pedidos.slice(0, 100),
            pageInfo: { page: 1, limit: 100, hasMore: true, nextPage: 2 },
        }));
    });

    it.each(['CASHIER', 'VIEWER'])('limita el producto del detalle privado para %s', async role => {
        const router = pedidosRouteModule.buildPedidosRouter();
        const handler = routeHandlers(router, '/:id', 'get').at(-1);
        const res = response();
        prismaMock.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            tenantId: 'tenant-auth',
            items: [{ producto: { name: 'Arroz', sku: 'ARZ-1', imageUrl: 'https://img.test/arroz.png' } }],
        });

        await handler({
            tenantId: 'tenant-auth',
            role,
            params: { id: 'pedido-1' },
        }, res);

        expect(prismaMock.pedido.findFirst).toHaveBeenCalledWith({
            where: { id: 'pedido-1', tenantId: 'tenant-auth' },
            include: {
                motorizado: {
                    select: motorizadoSafeSelect,
                },
                items: {
                    include: {
                        producto: {
                            select: {
                                name: true,
                                sku: true,
                                imageUrl: true,
                            },
                        },
                    },
                },
                eventos: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('cost');
        expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('pinHash');
    });

    it('rechaza despachar sin motorizado o desde un estado ilegal', async () => {
        const router = pedidosRouteModule.buildPedidosRouter();
        const handler = routeHandlers(router, '/:id/estado', 'patch').at(-1);
        const tx = {
            pedido: {
                findFirst: vi.fn()
                    .mockResolvedValueOnce({
                        id: 'pedido-1',
                        estado: 'preparando',
                        facturaId: null,
                        motorizadoId: null,
                    })
                    .mockResolvedValueOnce({
                        id: 'pedido-2',
                        estado: 'pendiente',
                        facturaId: null,
                        motorizadoId: 'rider-1',
                    }),
                updateMany: vi.fn(),
                findFirstOrThrow: vi.fn(),
            },
            trackingEvento: { create: vi.fn() },
        };
        prismaMock.$transaction.mockImplementation(async (callback: (db: typeof tx) => unknown) => callback(tx as any));
        const firstRes = response();
        const secondRes = response();

        await handler({
            tenantId: 'tenant-auth',
            params: { id: 'pedido-1' },
            body: { estado: 'en_camino' },
        }, firstRes);
        await handler({
            tenantId: 'tenant-auth',
            params: { id: 'pedido-2' },
            body: { estado: 'en_camino' },
        }, secondRes);

        expect(lockPedidoForFulfillmentMock).toHaveBeenCalledTimes(2);
        expect(tx.pedido.updateMany).not.toHaveBeenCalled();
        expect(firstRes.statusCode).toBe(409);
        expect(firstRes.json).toHaveBeenCalledWith({
            error: 'Asigná un motorizado antes de iniciar la ruta.',
            code: 'PEDIDO_RIDER_REQUIRED',
        });
        expect(secondRes.statusCode).toBe(409);
        expect(secondRes.json).toHaveBeenCalledWith({
            error: 'Transición de pendiente a en_camino no permitida.',
            code: 'PEDIDO_INVALID_STATE_TRANSITION',
        });
    });

    it('asigna motorizado dentro del tenant y solo mientras el pedido siga abierto', async () => {
        const router = pedidosRouteModule.buildPedidosRouter();
        const handler = routeHandlers(router, '/:id/motorizado', 'patch').at(-1);
        const tx = {
            pedido: {
                findFirst: vi.fn().mockResolvedValue({
                    id: 'pedido-1',
                    estado: 'preparando',
                    facturaId: null,
                    motorizadoId: null,
                }),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                findFirstOrThrow: vi.fn().mockResolvedValue({
                    id: 'pedido-1',
                    estado: 'preparando',
                    motorizadoId: 'rider-1',
                    motorizado: { id: 'rider-1', nombre: 'Ana' },
                }),
            },
            motorizado: {
                findFirst: vi.fn().mockResolvedValue({ id: 'rider-1', tenantId: 'tenant-auth', activo: true }),
            },
            trackingEvento: { create: vi.fn().mockResolvedValue({}) },
        };
        prismaMock.$transaction.mockImplementation(async (callback: (db: typeof tx) => unknown) => callback(tx as any));
        const res = response();

        await handler({
            tenantId: 'tenant-auth',
            params: { id: 'pedido-1' },
            body: { motorizadoId: 'rider-1' },
        }, res);

        expect(lockPedidoForFulfillmentMock).toHaveBeenCalledWith(tx, {
            pedidoId: 'pedido-1',
            tenantId: 'tenant-auth',
        });
        expect(tx.motorizado.findFirst).toHaveBeenCalledWith({
            where: {
                id: 'rider-1',
                activo: true,
                OR: [
                    { tenantId: 'tenant-auth' },
                    { tipoFlota: 'NORTEX', kycStatus: 'APROBADO' },
                ],
            },
            select: { id: true },
        });
        expect(tx.pedido.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'pedido-1',
                tenantId: 'tenant-auth',
                facturaId: null,
                motorizadoId: null,
                AND: [{ estado: 'preparando' }, { estado: { notIn: ['entregado', 'cancelado'] } }],
            },
            data: { motorizadoId: 'rider-1' },
        });
        expect(tx.pedido.findFirstOrThrow).toHaveBeenCalledWith({
            where: { id: 'pedido-1', tenantId: 'tenant-auth' },
            include: {
                motorizado: {
                    select: motorizadoSafeSelect,
                },
            },
        });
        expect(res.statusCode).toBe(200);
    });

    it('valida y normaliza el alta de motorizado con zona y placa separadas', async () => {
        const router = motorizadosRouteModule.buildMotorizadosRouter();
        const handler = routeHandlers(router, '/', 'post').at(-1);
        const create = vi.fn().mockResolvedValue({
            id: 'rider-1',
            nombre: 'Juan Perez',
        });
        (prismaMock as any).motorizado = {
            create,
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
        };
        const res = response();

        expect(motorizadosRouteModule.FleetRiderCreateSchema.parse({
            nombre: ' Juan Perez ',
            telefono: '8888-0000',
            zonaCobertura: ' Managua sur ',
            vehiculoPlaca: 'M-123456',
            pin: '0042',
        })).toMatchObject({
            nombre: 'Juan Perez',
            zonaCobertura: 'Managua sur',
            vehiculoPlaca: 'M-123456',
            pin: '0042',
        });

        await handler({
            tenantId: 'tenant-auth',
            body: {
                nombre: 'Juan Perez',
                telefono: '8888-0000',
                zonaCobertura: 'Managua sur',
                vehiculoPlaca: 'M-123456',
                pin: '0042',
            },
        }, res);

        expect(bcryptHashMock).toHaveBeenCalledWith('0042', 10);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                tenantId: 'tenant-auth',
                telefono: '88880000',
                zonaCobertura: 'Managua sur',
                vehiculoPlaca: 'M-123456',
                tipoFlota: 'PROPIA',
                pinHash: 'hash:0042',
            }),
            select: expect.objectContaining({
                id: true,
                nombre: true,
                telefono: true,
                zonaCobertura: true,
                vehiculoPlaca: true,
            }),
        }));
        expect(res.statusCode).toBe(201);
    });
});
