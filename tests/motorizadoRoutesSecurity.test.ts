import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const motorizado = {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    };

    return {
        prisma: {
            motorizado,
            pedido: { findMany: vi.fn() },
            driverWalletMovement: { findMany: vi.fn() },
            $transaction: vi.fn(),
        },
        bcrypt: {
            hash: vi.fn(),
            compare: vi.fn(),
        },
        signDriverToken: vi.fn(),
        verifyDriverToken: vi.fn(),
        appendDriverWalletMovement: vi.fn(),
        completePedidoDeliveryInTransaction: vi.fn(),
    };
});

vi.mock('@prisma/client', () => ({
    PrismaClient: function PrismaClient() {
        return mocks.prisma;
    },
}));

vi.mock('../backend/lib/prisma.js', () => ({
    default: mocks.prisma,
}));

vi.mock('bcryptjs', () => ({
    default: mocks.bcrypt,
}));

vi.mock('express-rate-limit', () => ({
    default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../backend/services/secrets', () => ({
    signDriverToken: mocks.signDriverToken,
    verifyDriverToken: mocks.verifyDriverToken,
    verifyAuthToken: vi.fn(),
}));

vi.mock('../backend/services/ledger', () => ({
    appendDriverWalletMovement: mocks.appendDriverWalletMovement,
}));

vi.mock('../backend/services/stockService.js', () => ({
    StockError: class StockError extends Error {
        code = 'TEST_STOCK_ERROR';
    },
}));

vi.mock('../backend/services/pedidoFulfillmentService.js', () => ({
    completePedidoDeliveryInTransaction: mocks.completePedidoDeliveryInTransaction,
    PedidoFulfillmentError: class PedidoFulfillmentError extends Error {
        code = 'TEST_FULFILLMENT_ERROR';
        httpStatus = 409;
    },
}));

import driverRouter from '../backend/routes/driver';
import motorizadosRouter from '../backend/routes/motorizados';
import { motorizadoSafeSelect } from '../backend/services/motorizadoIdentity';

type HttpMethod = 'get' | 'post' | 'patch';

const routeHandler = (router: any, path: string, method: HttpMethod) => {
    const layer = router.stack.find((candidate: any) =>
        candidate.route?.path === path && candidate.route.methods?.[method]);
    if (!layer) throw new Error(`No se encontró ${method.toUpperCase()} ${path}`);
    return layer.route.stack.at(-1).handle;
};

const roleGuard = (router: any, path: string, method: HttpMethod) => {
    const layer = router.stack.find((candidate: any) =>
        candidate.route?.path === path && candidate.route.methods?.[method]);
    if (!layer) throw new Error(`No se encontró ${method.toUpperCase()} ${path}`);
    return layer.route.stack.at(-2).handle;
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

const operationalRider = {
    id: 'driver-1',
    tipoFlota: 'PROPIA',
    nombre: 'Ana Pérez',
    telefono: '50588880000',
    zonaCobertura: 'Managua',
    activo: true,
    calificacionPromedio: 5,
    vehiculoPlaca: 'M 123',
};

describe('seguridad de rutas de motorizados', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.bcrypt.hash.mockResolvedValue('pin-hash');
        mocks.bcrypt.compare.mockResolvedValue(true);
    });

    it.each([
        ['/', 'post'],
        ['/:id', 'patch'],
    ] as const)('%s %s reserva la gestión de credenciales para OWNER o ADMIN', (path, method) => {
        const guard = roleGuard(motorizadosRouter, path, method);
        const denied = response();
        const deniedNext = vi.fn();
        guard({ role: 'CASHIER' }, denied, deniedNext);

        expect(denied.statusCode).toBe(403);
        expect(deniedNext).not.toHaveBeenCalled();

        const allowed = response();
        const allowedNext = vi.fn();
        guard({ role: 'OWNER' }, allowed, allowedNext);
        expect(allowedNext).toHaveBeenCalledOnce();
    });

    it('GET limita la consulta al tenant autenticado o a la red aprobada y selecciona solo datos operativos', async () => {
        mocks.prisma.motorizado.findMany.mockResolvedValue([operationalRider]);
        const res = response();

        await routeHandler(motorizadosRouter, '/', 'get')(
            { tenantId: 'tenant-auth', query: { tenantId: 'tenant-forjado' } },
            res,
        );

        expect(mocks.prisma.motorizado.findMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { tenantId: 'tenant-auth' },
                    { tipoFlota: 'NORTEX', kycStatus: 'APROBADO', activo: true },
                ],
            },
            select: motorizadoSafeSelect,
            orderBy: { tipoFlota: 'asc' },
        });
        expect(Object.keys(motorizadoSafeSelect).sort()).toEqual([
            'activo',
            'calificacionPromedio',
            'id',
            'nombre',
            'telefono',
            'tipoFlota',
            'vehiculoPlaca',
            'zonaCobertura',
        ]);
        for (const privateField of [
            'tenantId',
            'pinHash',
            'cedula',
            'kycNota',
            'fotoCedulaUrl',
            'fotoVehiculoUrl',
            'walletId',
            'walletBalance',
        ]) {
            expect(motorizadoSafeSelect).not.toHaveProperty(privateField);
        }
        expect(res.body).toEqual({ motorizados: [operationalRider] });
    });

    it('POST normaliza los campos y persiste exclusivamente el tenant autenticado', async () => {
        mocks.prisma.motorizado.findMany.mockResolvedValue([]);
        mocks.prisma.motorizado.create.mockResolvedValue(operationalRider);
        const res = response();

        await routeHandler(motorizadosRouter, '/', 'post')(
            {
                tenantId: 'tenant-auth',
                body: {
                    tenantId: 'tenant-forjado',
                    tipoFlota: 'NORTEX',
                    nombre: '  Ana Pérez  ',
                    telefono: '+505 8888-0000',
                    zonaCobertura: '  Managua  ',
                    vehiculoPlaca: '  M 123  ',
                    pin: '0420',
                },
            },
            res,
        );

        expect(mocks.prisma.motorizado.findMany).toHaveBeenCalledWith({
            where: { telefono: '50588880000', pinHash: { not: null } },
            select: { id: true, pinHash: true },
            take: 2,
        });
        expect(mocks.bcrypt.hash).toHaveBeenCalledWith('0420', 10);
        expect(mocks.prisma.motorizado.create).toHaveBeenCalledWith({
            data: {
                tenantId: 'tenant-auth',
                nombre: 'Ana Pérez',
                telefono: '50588880000',
                zonaCobertura: 'Managua',
                vehiculoPlaca: 'M 123',
                tipoFlota: 'PROPIA',
                activo: true,
                pinHash: 'pin-hash',
                kycStatus: 'APROBADO',
            },
            select: motorizadoSafeSelect,
        });
        expect(res.statusCode).toBe(201);
        expect(res.body).toEqual({
            message: 'Motorizado registrado con éxito.',
            motorizado: operationalRider,
        });
    });

    it.each([
        ['nombre corto', { nombre: ' A ', telefono: '8888-0000', zonaCobertura: 'Managua', pin: '1234' }],
        ['teléfono corto', { nombre: 'Ana Pérez', telefono: '12-34', zonaCobertura: 'Managua', pin: '1234' }],
        ['zona corta', { nombre: 'Ana Pérez', telefono: '8888-0000', zonaCobertura: ' X ', pin: '1234' }],
        ['placa larga', { nombre: 'Ana Pérez', telefono: '8888-0000', zonaCobertura: 'Managua', vehiculoPlaca: '123456789012345678901', pin: '1234' }],
        ['PIN no numérico', { nombre: 'Ana Pérez', telefono: '8888-0000', zonaCobertura: 'Managua', pin: '12ab' }],
    ])('POST rechaza %s antes de consultar o escribir', async (_label, body) => {
        const res = response();

        await routeHandler(motorizadosRouter, '/', 'post')(
            { tenantId: 'tenant-auth', body },
            res,
        );

        expect(res.statusCode).toBe(400);
        expect(mocks.prisma.motorizado.findMany).not.toHaveBeenCalled();
        expect(mocks.bcrypt.hash).not.toHaveBeenCalled();
        expect(mocks.prisma.motorizado.create).not.toHaveBeenCalled();
    });

    it('POST exige PIN antes de consultar credenciales, calcular hash o crear el motorizado', async () => {
        const res = response();

        await routeHandler(motorizadosRouter, '/', 'post')(
            {
                tenantId: 'tenant-auth',
                body: {
                    nombre: 'Ana Pérez',
                    telefono: '8888-0000',
                    zonaCobertura: 'Managua',
                },
            },
            res,
        );

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
            error: 'El PIN es obligatorio y debe ser de 4 a 6 dígitos.',
        });
        expect(mocks.prisma.motorizado.findMany).not.toHaveBeenCalled();
        expect(mocks.bcrypt.hash).not.toHaveBeenCalled();
        expect(mocks.prisma.motorizado.create).not.toHaveBeenCalled();
    });

    it('POST devuelve 409 ante un teléfono con credencial existente y no reemplaza su PIN', async () => {
        mocks.prisma.motorizado.findMany.mockResolvedValue([
            { id: 'driver-existing', pinHash: 'existing-hash' },
        ]);
        const res = response();

        await routeHandler(motorizadosRouter, '/', 'post')(
            {
                tenantId: 'tenant-auth',
                body: {
                    nombre: 'Ana Pérez',
                    telefono: '8888-0000',
                    zonaCobertura: 'Managua',
                    pin: '1234',
                },
            },
            res,
        );

        expect(res.statusCode).toBe(409);
        expect(res.body).toEqual({
            error: 'Ya existe un repartidor con ese teléfono y PIN. Usá otro número o restablecé el acceso del actual.',
        });
        expect(mocks.bcrypt.hash).not.toHaveBeenCalled();
        expect(mocks.prisma.motorizado.create).not.toHaveBeenCalled();
    });

    it('PATCH comprueba propiedad con el tenant autenticado y falla con 409 si el teléfono pertenece a otra credencial', async () => {
        mocks.prisma.motorizado.findFirst.mockResolvedValue({
            id: 'driver-1',
            telefono: '50588880000',
        });
        mocks.prisma.motorizado.findMany.mockResolvedValue([
            { id: 'driver-2', pinHash: 'other-hash' },
        ]);
        const res = response();

        await routeHandler(motorizadosRouter, '/:id', 'patch')(
            {
                tenantId: 'tenant-auth',
                params: { id: 'driver-1' },
                body: { tenantId: 'tenant-forjado', pin: '7777' },
            },
            res,
        );

        expect(mocks.prisma.motorizado.findFirst).toHaveBeenCalledWith({
            where: { id: 'driver-1', tenantId: 'tenant-auth' },
            select: { id: true, telefono: true },
        });
        expect(mocks.prisma.motorizado.findMany).toHaveBeenCalledWith({
            where: {
                telefono: '50588880000',
                pinHash: { not: null },
                NOT: { id: 'driver-1' },
            },
            select: { id: true, pinHash: true },
            take: 2,
        });
        expect(res.statusCode).toBe(409);
        expect(mocks.bcrypt.hash).not.toHaveBeenCalled();
        expect(mocks.prisma.motorizado.update).not.toHaveBeenCalled();
    });

    it('PATCH permite habilitar el acceso de un motorizado legacy sin PIN', async () => {
        mocks.prisma.motorizado.findFirst.mockResolvedValue({
            id: 'driver-legacy',
            telefono: '50588880000',
            pinHash: null,
        });
        mocks.prisma.motorizado.findMany.mockResolvedValue([]);
        mocks.prisma.motorizado.update.mockResolvedValue(operationalRider);
        const res = response();

        await routeHandler(motorizadosRouter, '/:id', 'patch')(
            {
                tenantId: 'tenant-auth',
                params: { id: 'driver-legacy' },
                body: { pin: '0042' },
            },
            res,
        );

        expect(mocks.bcrypt.hash).toHaveBeenCalledWith('0042', 10);
        expect(mocks.prisma.motorizado.update).toHaveBeenCalledWith({
            where: { id: 'driver-legacy' },
            data: { pinHash: 'pin-hash' },
            select: motorizadoSafeSelect,
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            message: 'Motorizado actualizado.',
            motorizado: operationalRider,
        });
    });

    it('driver login falla cerrado ante cuentas duplicadas sin comparar ningún hash', async () => {
        mocks.prisma.motorizado.findMany.mockResolvedValue([
            {
                id: 'driver-1',
                nombre: 'Ana',
                tipoFlota: 'PROPIA',
                zonaCobertura: 'Managua',
                activo: true,
                kycStatus: 'APROBADO',
                pinHash: 'hash-1',
            },
            {
                id: 'driver-2',
                nombre: 'Ana duplicada',
                tipoFlota: 'NORTEX',
                zonaCobertura: 'Masaya',
                activo: true,
                kycStatus: 'APROBADO',
                pinHash: 'hash-2',
            },
        ]);
        const res = response();

        await routeHandler(driverRouter, '/login', 'post')(
            { body: { telefono: '+505 8888-0000', pin: '1234' } },
            res,
        );

        expect(mocks.prisma.motorizado.findMany).toHaveBeenCalledWith({
            where: { telefono: '50588880000', pinHash: { not: null } },
            select: {
                id: true,
                nombre: true,
                tipoFlota: true,
                zonaCobertura: true,
                activo: true,
                kycStatus: true,
                pinHash: true,
            },
            take: 2,
        });
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Teléfono o PIN incorrectos.' });
        expect(mocks.bcrypt.compare).not.toHaveBeenCalled();
        expect(mocks.signDriverToken).not.toHaveBeenCalled();
    });
});
