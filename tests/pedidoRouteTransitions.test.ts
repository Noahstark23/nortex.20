import { motorizadoSafeSelect } from '../backend/services/motorizadoIdentity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    class PedidoFulfillmentError extends Error {
        constructor(
            public readonly code: string,
            public readonly httpStatus: number,
            message: string,
        ) {
            super(message);
            this.name = 'PedidoFulfillmentError';
        }
    }

    const tx = {
        pedido: {
            findFirst: vi.fn(),
            updateMany: vi.fn(),
            findFirstOrThrow: vi.fn(),
        },
        motorizado: { findFirst: vi.fn() },
        trackingEvento: { create: vi.fn() },
    };

    return {
        tx,
        prisma: {
            $transaction: vi.fn(),
        },
        PedidoFulfillmentError,
        lockPedidoForFulfillment: vi.fn(),
        reservePedidoInTransaction: vi.fn(),
        completePedidoDeliveryInTransaction: vi.fn(),
        cancelPedidoInTransaction: vi.fn(),
    };
});

vi.mock('../backend/lib/prisma.js', () => ({ default: mocks.prisma }));

vi.mock('../backend/middleware/auth', () => ({
    authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../backend/middleware/checkRole', () => ({
    checkRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('express-rate-limit', () => ({
    default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../backend/services/stockService.js', () => ({
    StockError: class StockError extends Error {
        code = 'TEST_STOCK_ERROR';
    },
}));

vi.mock('../backend/services/pedidoFulfillmentService.js', () => ({
    PedidoFulfillmentError: mocks.PedidoFulfillmentError,
    lockPedidoForFulfillment: mocks.lockPedidoForFulfillment,
    reservePedidoInTransaction: mocks.reservePedidoInTransaction,
    completePedidoDeliveryInTransaction: mocks.completePedidoDeliveryInTransaction,
    cancelPedidoInTransaction: mocks.cancelPedidoInTransaction,
}));

vi.mock('../backend/services/secrets.js', () => ({
    signPedidoTrackingToken: vi.fn(),
    verifyPedidoTrackingToken: vi.fn(),
}));

import pedidosRouter, {
    isPedidoTransitionAllowed,
    PEDIDO_ESTADOS_VALIDOS,
    PEDIDO_STATE_TRANSITIONS,
} from '../backend/routes/pedidos';

const routeHandler = (path: string) => {
    const layer = (pedidosRouter as any).stack.find((candidate: any) =>
        candidate.route?.path === path && candidate.route.methods?.patch);
    if (!layer) throw new Error(`No se encontró PATCH ${path}`);
    return layer.route.stack.at(-1).handle;
};

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

const estadoHandler = routeHandler('/:id/estado');
const motorizadoHandler = routeHandler('/:id/motorizado');

const request = (body: unknown) => ({
    tenantId: 'tenant-auth',
    userId: 'user-auth',
    params: { id: 'pedido-1' },
    body,
});

describe('matriz autoritativa de estados de pedido', () => {
    it('expone exactamente el flujo permitido y deja terminales sin salida', () => {
        expect(PEDIDO_STATE_TRANSITIONS).toEqual({
            pendiente: ['asignado', 'preparando', 'cancelado'],
            asignado: ['preparando', 'cancelado'],
            preparando: ['en_tienda', 'en_camino', 'cancelado'],
            en_tienda: ['en_ruta', 'en_camino', 'cancelado'],
            en_ruta: ['en_punto', 'entregado', 'cancelado'],
            en_camino: ['en_punto', 'entregado', 'cancelado'],
            en_punto: ['entregado', 'cancelado'],
            entregado: [],
            cancelado: [],
        });

        for (const from of PEDIDO_ESTADOS_VALIDOS) {
            for (const to of PEDIDO_ESTADOS_VALIDOS) {
                expect(isPedidoTransitionAllowed(from, to)).toBe(
                    PEDIDO_STATE_TRANSITIONS[from].includes(to as never),
                );
            }
        }
        expect(isPedidoTransitionAllowed('entregado', 'pendiente')).toBe(false);
        expect(isPedidoTransitionAllowed('estado-forjado', 'entregado')).toBe(false);
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.prisma.$transaction.mockImplementation(async (operation: any) => operation(mocks.tx));
        mocks.lockPedidoForFulfillment.mockResolvedValue(undefined);
        mocks.tx.pedido.updateMany.mockResolvedValue({ count: 1 });
        mocks.tx.pedido.findFirstOrThrow.mockResolvedValue({ id: 'pedido-1', estado: 'en_camino' });
    });

    it('rechaza bajo lock un salto pendiente -> en_camino antes de tocar stock o estado', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'pendiente',
            facturaId: null,
            motorizadoId: 'driver-1',
        });
        const res = response();

        await estadoHandler(request({ estado: 'en_camino' }), res);

        expect(mocks.lockPedidoForFulfillment).toHaveBeenCalledWith(mocks.tx, {
            pedidoId: 'pedido-1',
            tenantId: 'tenant-auth',
        });
        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ code: 'PEDIDO_INVALID_STATE_TRANSITION' });
        expect(mocks.tx.pedido.updateMany).not.toHaveBeenCalled();
        expect(mocks.reservePedidoInTransaction).not.toHaveBeenCalled();
        expect(mocks.completePedidoDeliveryInTransaction).not.toHaveBeenCalled();
    });

    it('exige motorizado para entrar en un estado de ruta', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'preparando',
            facturaId: null,
            motorizadoId: null,
        });
        const res = response();

        await estadoHandler(request({ estado: 'en_camino' }), res);

        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ code: 'PEDIDO_RIDER_REQUIRED' });
        expect(mocks.tx.pedido.updateMany).not.toHaveBeenCalled();
        expect(mocks.tx.trackingEvento.create).not.toHaveBeenCalled();
    });

    it('hace la transición de ruta con compare-and-set tenant-scoped y evento atómico', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'preparando',
            facturaId: null,
            motorizadoId: 'driver-1',
        });
        mocks.tx.pedido.findFirstOrThrow.mockResolvedValue({ id: 'pedido-1', estado: 'en_camino' });
        const res = response();

        await estadoHandler(request({ estado: 'en_camino', nota: 'Sale de tienda', lat: 12.1, lng: -86.2 }), res);

        expect(mocks.tx.pedido.findFirst).toHaveBeenCalledWith({
            where: { id: 'pedido-1', tenantId: 'tenant-auth' },
            select: { id: true, estado: true, facturaId: true, motorizadoId: true },
        });
        expect(mocks.tx.pedido.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'pedido-1',
                tenantId: 'tenant-auth',
                facturaId: null,
                estado: 'preparando',
                motorizadoId: { not: null },
            },
            data: { estado: 'en_camino' },
        });
        expect(mocks.tx.trackingEvento.create).toHaveBeenCalledWith({
            data: {
                pedidoId: 'pedido-1',
                estado: 'en_camino',
                nota: 'Sale de tienda',
                lat: 12.1,
                lng: -86.2,
            },
        });
        expect(res.body).toEqual({
            message: 'Estado actualizado a en_camino',
            pedido: { id: 'pedido-1', estado: 'en_camino' },
        });
    });

    it('valida la matriz antes de delegar la reserva especial en la misma transacción', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'asignado',
            facturaId: null,
            motorizadoId: 'driver-1',
        });
        mocks.reservePedidoInTransaction.mockResolvedValue({ id: 'pedido-1', estado: 'preparando' });
        const res = response();

        await estadoHandler(request({ estado: 'preparando' }), res);

        expect(mocks.reservePedidoInTransaction).toHaveBeenCalledWith(mocks.tx, {
            pedidoId: 'pedido-1',
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            nota: null,
            lat: null,
            lng: null,
        });
        expect(mocks.tx.pedido.updateMany).not.toHaveBeenCalled();
        expect(res.body).toEqual({
            message: 'Estado actualizado a preparando',
            pedido: { id: 'pedido-1', estado: 'preparando' },
        });
    });

    it('delega el reintento preparando -> preparando para preservar PEDIDO_ALREADY_PREPARED', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'preparando',
            facturaId: null,
            motorizadoId: 'driver-1',
        });
        mocks.reservePedidoInTransaction.mockRejectedValue(new mocks.PedidoFulfillmentError(
            'PEDIDO_ALREADY_PREPARED',
            409,
            'El pedido ya fue preparado.',
        ));
        const res = response();

        await estadoHandler(request({ estado: 'preparando' }), res);

        expect(mocks.reservePedidoInTransaction).toHaveBeenCalledWith(
            mocks.tx,
            expect.objectContaining({ pedidoId: 'pedido-1', tenantId: 'tenant-auth' }),
        );
        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ code: 'PEDIDO_ALREADY_PREPARED' });
    });

    it('delega cancelado -> cancelado para preservar la respuesta idempotente', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'cancelado',
            facturaId: null,
            motorizadoId: null,
        });
        mocks.cancelPedidoInTransaction.mockResolvedValue({
            pedido: { id: 'pedido-1', estado: 'cancelado' },
            idempotentReplay: true,
            releasedQuantity: '0',
        });
        const res = response();

        await estadoHandler(request({ estado: 'cancelado' }), res);

        expect(mocks.cancelPedidoInTransaction).toHaveBeenCalledWith(mocks.tx, {
            pedidoId: 'pedido-1',
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            nota: null,
            lat: null,
            lng: null,
        });
        expect(res.body).toEqual({
            message: 'Estado actualizado a cancelado',
            pedido: { id: 'pedido-1', estado: 'cancelado' },
            idempotentReplay: true,
            releasedQuantity: '0',
        });
    });
});

describe('asignación atómica de motorizado', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.prisma.$transaction.mockImplementation(async (operation: any) => operation(mocks.tx));
        mocks.lockPedidoForFulfillment.mockResolvedValue(undefined);
        mocks.tx.pedido.updateMany.mockResolvedValue({ count: 1 });
        mocks.tx.pedido.findFirstOrThrow.mockResolvedValue({ id: 'pedido-1', motorizadoId: 'driver-1' });
        mocks.tx.motorizado.findFirst.mockResolvedValue({ id: 'driver-1' });
    });

    it.each([undefined, '', '   ', 123, {}])('rechaza motorizadoId inválido (%j) antes de abrir transacción', async (motorizadoId) => {
        const res = response();

        await motorizadoHandler(request({ motorizadoId }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ code: 'PEDIDO_INVALID_RIDER' });
        expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('bloquea, valida y asigna dentro de una sola transacción tenant-scoped', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'pendiente',
            facturaId: null,
            motorizadoId: null,
        });
        const res = response();

        await motorizadoHandler(request({ motorizadoId: '  driver-1  ' }), res);

        expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
        expect(mocks.lockPedidoForFulfillment).toHaveBeenCalledWith(mocks.tx, {
            pedidoId: 'pedido-1',
            tenantId: 'tenant-auth',
        });
        expect(mocks.tx.pedido.findFirst).toHaveBeenCalledWith({
            where: { id: 'pedido-1', tenantId: 'tenant-auth' },
            select: { id: true, estado: true, facturaId: true, motorizadoId: true },
        });
        expect(mocks.tx.motorizado.findFirst).toHaveBeenCalledWith({
            where: {
                id: 'driver-1',
                activo: true,
                OR: [
                    { tenantId: 'tenant-auth' },
                    { tipoFlota: 'NORTEX', kycStatus: 'APROBADO' },
                ],
            },
            select: { id: true },
        });
        expect(mocks.tx.pedido.updateMany).toHaveBeenCalledWith({
            where: {
                id: 'pedido-1',
                tenantId: 'tenant-auth',
                facturaId: null,
                motorizadoId: null,
                AND: [
                    { estado: 'pendiente' },
                    { estado: { notIn: ['entregado', 'cancelado'] } },
                ],
            },
            data: { motorizadoId: 'driver-1' },
        });
        expect(mocks.tx.trackingEvento.create).toHaveBeenCalledWith({
            data: {
                pedidoId: 'pedido-1',
                estado: 'pendiente',
                nota: 'Motorizado asignado.',
            },
        });
        expect(mocks.tx.pedido.findFirstOrThrow).toHaveBeenCalledWith({
            where: { id: 'pedido-1', tenantId: 'tenant-auth' },
            include: { motorizado: { select: motorizadoSafeSelect } },
        });
        expect(res.body).toEqual({
            message: 'Motorizado asignado correctamente.',
            pedido: { id: 'pedido-1', motorizadoId: 'driver-1' },
        });
    });

    it('permite desasignar con null y registra el cambio dentro de la transacción', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'preparando',
            facturaId: null,
            motorizadoId: 'driver-1',
        });
        mocks.tx.pedido.findFirstOrThrow.mockResolvedValue({ id: 'pedido-1', motorizadoId: null });
        const res = response();

        await motorizadoHandler(request({ motorizadoId: null }), res);

        expect(mocks.tx.motorizado.findFirst).not.toHaveBeenCalled();
        expect(mocks.tx.pedido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { motorizadoId: null },
        }));
        expect(mocks.tx.trackingEvento.create).toHaveBeenCalledWith({
            data: {
                pedidoId: 'pedido-1',
                estado: 'preparando',
                nota: 'Asignación de motorizado removida.',
            },
        });
        expect(res.statusCode).toBe(200);
    });

    it('rechaza pedidos facturados o terminales después del lock y antes de validar el rider', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'entregado',
            facturaId: 'factura-1',
            motorizadoId: 'driver-old',
        });
        const res = response();

        await motorizadoHandler(request({ motorizadoId: 'driver-1' }), res);

        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ code: 'PEDIDO_ALREADY_PROCESSED' });
        expect(mocks.tx.motorizado.findFirst).not.toHaveBeenCalled();
        expect(mocks.tx.pedido.updateMany).not.toHaveBeenCalled();
    });

    it('devuelve 409 si el compare-and-set pierde una carrera y no crea evento', async () => {
        mocks.tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-1',
            estado: 'pendiente',
            facturaId: null,
            motorizadoId: null,
        });
        mocks.tx.pedido.updateMany.mockResolvedValue({ count: 0 });
        const res = response();

        await motorizadoHandler(request({ motorizadoId: 'driver-1' }), res);

        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ code: 'PEDIDO_ALREADY_PROCESSED' });
        expect(mocks.tx.trackingEvento.create).not.toHaveBeenCalled();
        expect(mocks.tx.pedido.findFirstOrThrow).not.toHaveBeenCalled();
    });
});
