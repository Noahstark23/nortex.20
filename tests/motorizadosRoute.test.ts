import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
    motorizado: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
    },
}));

vi.mock('../backend/lib/prisma.js', () => ({
    default: prismaMock,
    prisma: prismaMock,
}));

type MotorizadosRouteModule = typeof import('../backend/routes/motorizados');

const source = readFileSync(resolve(process.cwd(), 'backend/routes/motorizados.ts'), 'utf8');
let routeModule: MotorizadosRouteModule;

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'motorizados-route-test-secret');
    routeModule = await import('../backend/routes/motorizados');
});

beforeEach(() => {
    prismaMock.motorizado.create.mockReset();
    prismaMock.motorizado.findMany.mockReset();
    prismaMock.motorizado.findFirst.mockReset();
    prismaMock.motorizado.updateMany.mockReset();
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

const routeHandler = (path: string, method: 'get' | 'post' | 'patch'): any => {
    const router = routeModule.buildMotorizadosRouter();
    const layer = router.stack.find((candidate: any) =>
        candidate.route?.path === path && candidate.route.methods?.[method]);
    if (!layer) throw new Error(`No se encontró ${method.toUpperCase()} ${path}`);
    return layer.route.stack.at(-1).handle as any;
};

describe('contrato de flota propia', () => {
    it('usa el singleton Prisma y no crea otro pool de conexiones', () => {
        expect(source).toContain("import prisma from '../lib/prisma.js';");
        expect(source).not.toContain('new PrismaClient');
        expect(source).not.toMatch(/import\s*\{\s*PrismaClient\s*\}/u);
    });

    it('normaliza teléfono y placa al validar un alta completa', () => {
        expect(routeModule.FleetRiderCreateSchema.parse({
            nombre: ' Ana López ',
            telefono: '+505 (8888)-0000',
            zonaCobertura: ' Managua sur ',
            vehiculoPlaca: ' m 123-456 ',
            pin: '0042',
        })).toEqual({
            nombre: 'Ana López',
            telefono: '50588880000',
            zonaCobertura: 'Managua sur',
            vehiculoPlaca: 'M 123-456',
            pin: '0042',
        });

        expect(routeModule.FleetRiderCreateSchema.parse({
            nombre: 'Ana López',
            telefono: '88880000',
            zonaCobertura: 'Managua',
            pin: '0042',
            tipoFlota: 'PROPIA',
        })).toEqual({
            nombre: 'Ana López',
            telefono: '88880000',
            zonaCobertura: 'Managua',
            pin: '0042',
            tipoFlota: 'PROPIA',
        });
    });

    it('exige nombre, teléfono y zona; rechaza extras y credenciales ambiguas', () => {
        const valid = {
            nombre: 'Ana López',
            telefono: '88880000',
            zonaCobertura: 'Managua',
            pin: '0042',
        };

        for (const requiredField of ['nombre', 'telefono', 'zonaCobertura', 'pin'] as const) {
            const candidate: Partial<typeof valid> = { ...valid };
            delete candidate[requiredField];
            expect(routeModule.FleetRiderCreateSchema.safeParse(candidate).success).toBe(false);
        }

        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            tenantId: 'tenant-atacante',
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            tipoFlota: 'NORTEX',
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            telefono: '8888abc0000',
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            telefono: '1234567',
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            telefono: '1234567890123456',
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            pin: 1234,
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            pin: '1234567',
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            nombre: 'A',
        }).success).toBe(false);
        expect(routeModule.FleetRiderCreateSchema.safeParse({
            ...valid,
            zonaCobertura: 'M',
        }).success).toBe(false);
    });

    it('responde errores de validación en español sin reflejar campos ni valores', async () => {
        const post = routeHandler('/', 'post');
        const extraFieldRes = response();
        const missingFieldRes = response();

        await post({
            tenantId: 'tenant-auth',
            body: {
                nombre: 'Ana López',
                telefono: '88880000',
                zonaCobertura: 'Managua',
                pin: '0042',
                tenantId: 'tenant-atacante-secreto',
            },
        }, extraFieldRes, vi.fn());
        await post({
            tenantId: 'tenant-auth',
            body: { nombre: 'Ana López' },
        }, missingFieldRes, vi.fn());

        expect(extraFieldRes.statusCode).toBe(400);
        expect(extraFieldRes.payload).toEqual({ error: 'La solicitud contiene campos no permitidos.' });
        expect(JSON.stringify(extraFieldRes.payload)).not.toContain('tenantId');
        expect(JSON.stringify(extraFieldRes.payload)).not.toContain('tenant-atacante-secreto');
        expect(missingFieldRes.statusCode).toBe(400);
        expect(missingFieldRes.payload.error).toMatch(/[áéíóúñ]/iu);
    });

    it('rechaza duplicado por teléfono dentro del mismo tenant y conserva el control global de identidad', async () => {
        const post = routeHandler('/', 'post');
        const res = response();
        prismaMock.motorizado.findFirst.mockResolvedValueOnce({ id: 'rider-existing' });

        await post({
            tenantId: 'tenant-auth',
            body: {
                nombre: 'Ana López',
                telefono: '88880000',
                zonaCobertura: 'Managua',
                pin: '0042',
                tipoFlota: 'PROPIA',
            },
        }, res, vi.fn());

        expect(prismaMock.motorizado.findFirst).toHaveBeenCalledWith({
            where: {
                tenantId: 'tenant-auth',
                tipoFlota: 'PROPIA',
                telefono: '88880000',
            },
            select: { id: true },
        });
        expect(prismaMock.motorizado.create).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
        expect(res.payload).toEqual({
            error: 'Ya existe un motorizado con ese teléfono en tu flota.',
        });
    });

    it('define PATCH parcial estricto con null explícito para limpiar placa o PIN', () => {
        expect(routeModule.FleetRiderPatchSchema.parse({
            activo: false,
            zonaCobertura: ' Ciudad Sandino ',
            vehiculoPlaca: ' m-987654 ',
            pin: '000001',
        })).toEqual({
            activo: false,
            zonaCobertura: 'Ciudad Sandino',
            vehiculoPlaca: 'M-987654',
            pin: '000001',
        });
        expect(routeModule.FleetRiderPatchSchema.parse({
            vehiculoPlaca: null,
            pin: null,
        })).toEqual({ vehiculoPlaca: null, pin: null });
        expect(routeModule.FleetRiderPatchSchema.safeParse({}).success).toBe(false);
        expect(routeModule.FleetRiderPatchSchema.safeParse({ nombre: 'Intruso' }).success).toBe(false);
        expect(routeModule.FleetRiderPatchSchema.safeParse({ activo: 'false' }).success).toBe(false);
        expect(routeModule.FleetRiderPatchSchema.safeParse({ pin: '' }).success).toBe(false);
        expect(routeModule.FleetRiderPatchSchema.safeParse({ vehiculoPlaca: '' }).success).toBe(false);
    });

    it('falla cerrado si no existe tenant autenticado y rechaza PATCH vacío antes de la BD', async () => {
        const post = routeHandler('/', 'post');
        const patch = routeHandler('/:id', 'patch');
        const noTenantRes = response();
        const emptyPatchRes = response();

        await post({ body: {} }, noTenantRes, vi.fn());
        await patch(
            { tenantId: 'tenant-auth', params: { id: 'rider-1' }, body: {} },
            emptyPatchRes,
            vi.fn(),
        );

        expect(noTenantRes.statusCode).toBe(401);
        expect(noTenantRes.payload).toEqual({ error: 'No se pudo identificar el negocio de la sesión.' });
        expect(emptyPatchRes.statusCode).toBe(400);
        expect(emptyPatchRes.payload).toEqual({ error: 'Debés enviar al menos un campo para actualizar.' });
    });

    it('limpia placa y PIN con escritura tenant-scoped aunque el update sea idempotente', async () => {
        const patch = routeHandler('/:id', 'patch');
        const res = response();
        prismaMock.motorizado.findFirst
            .mockResolvedValueOnce({ id: 'rider-1' })
            .mockResolvedValueOnce({
                id: 'rider-1',
                tenantId: 'tenant-auth',
                tipoFlota: 'PROPIA',
                nombre: 'Ana López',
                telefono: '88880000',
                zonaCobertura: 'Managua',
                activo: true,
                calificacionPromedio: 5,
                vehiculoPlaca: null,
                createdAt: new Date('2026-09-01T00:00:00.000Z'),
                kycStatus: 'APROBADO',
            });
        // MySQL puede reportar cero filas cambiadas cuando el valor ya era null.
        prismaMock.motorizado.updateMany.mockResolvedValue({ count: 0 });

        await patch({
            tenantId: 'tenant-auth',
            params: { id: 'rider-1' },
            body: { vehiculoPlaca: null, pin: null },
        }, res, vi.fn());

        expect(prismaMock.motorizado.updateMany).toHaveBeenCalledWith({
            where: { id: 'rider-1', tenantId: 'tenant-auth', tipoFlota: 'PROPIA' },
            data: { vehiculoPlaca: null, pinHash: null },
        });
        expect(prismaMock.motorizado.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: { id: 'rider-1', tenantId: 'tenant-auth', tipoFlota: 'PROPIA' },
        }));
        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({ message: 'Motorizado actualizado.' });
    });

    it('persiste la placa y repite el scope tenant+flota en la escritura PATCH', () => {
        const postStart = source.indexOf("router.post('/', authenticate");
        const patchStart = source.indexOf("router.patch('/:id', authenticate");
        const liquidationStart = source.indexOf("router.get('/:id/liquidacion'", patchStart);
        const postBlock = source.slice(postStart, patchStart);
        const patchBlock = source.slice(patchStart, liquidationStart);

        expect(postStart).toBeGreaterThan(-1);
        expect(patchStart).toBeGreaterThan(postStart);
        expect(postBlock).toContain('tenantId,');
        expect(postBlock).toContain('vehiculoPlaca: data.vehiculoPlaca ?? null');
        expect(postBlock).toContain("tipoFlota: 'PROPIA'");

        expect(patchBlock).toContain("where: { id, tenantId, tipoFlota: 'PROPIA' }");
        expect(patchBlock).toContain('prisma.motorizado.updateMany');
        expect(patchBlock).not.toContain('prisma.motorizado.update({');
        expect(patchBlock).not.toContain('updated.count');
        expect(patchBlock).toContain('dataUpdate.vehiculoPlaca = parsed.data.vehiculoPlaca');
        expect(patchBlock).toContain('dataUpdate.pinHash = parsed.data.pin === null');
    });

    it('GET devuelve datos operativos sin credenciales ni KYC privado', async () => {
        const privateRow = { id: 'rider-1', nombre: 'Ana López', telefono: '88880000',
            tipoFlota: 'PROPIA', zonaCobertura: 'Managua', activo: true, calificacionPromedio: 5,
            vehiculoPlaca: 'M 123', pinHash: 'private-pin-hash', cedula: 'private-id',
            walletBalance: '100', fotoCedulaUrl: 'private-photo', tenantId: 'tenant-auth' };
        prismaMock.motorizado.findMany.mockImplementation(async ({ select }) => [
            Object.fromEntries(Object.entries(privateRow).filter(([key]) => select[key])),
        ]);
        const res = response();
        await routeHandler('/', 'get')({ tenantId: 'tenant-auth' }, res, vi.fn());
        expect(prismaMock.motorizado.findMany).toHaveBeenCalledWith({
            where: { OR: [{ tenantId: 'tenant-auth' }, { tipoFlota: 'NORTEX', kycStatus: 'APROBADO', activo: true }] },
            orderBy: { tipoFlota: 'asc' }, take: 250,
            select: { id: true, nombre: true, telefono: true, tipoFlota: true, zonaCobertura: true,
                activo: true, calificacionPromedio: true, vehiculoPlaca: true },
        });
        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({ motorizados: [{ id: 'rider-1', nombre: 'Ana López', telefono: '88880000',
            tipoFlota: 'PROPIA', zonaCobertura: 'Managua', activo: true, calificacionPromedio: 5, vehiculoPlaca: 'M 123' }] });
    });
});
