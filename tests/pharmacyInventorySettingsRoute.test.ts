import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkRole } from '../backend/middleware/checkRole';

type RouteModule = typeof import('../backend/routes/pharmacyInventorySettings');
let routeModule: RouteModule;

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'pharmacy-inventory-settings-route-test-secret');
    routeModule = await import('../backend/routes/pharmacyInventorySettings');
});

const response = () => {
    const res: any = {
        statusCode: 200,
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: vi.fn((payload: unknown) => payload),
    };
    return res;
};

const routeHandlers = (router: any, method: 'get' | 'put') => {
    const layer = router.stack.find((candidate: any) =>
        candidate.route?.path === '/' && candidate.route.methods?.[method]);
    if (!layer) throw new Error(`No se encontró ${method.toUpperCase()} /`);
    return layer.route.stack.map((candidate: any) => candidate.handle);
};

const authorize = (role?: string) => {
    const next = vi.fn();
    const res = response();
    checkRole(routeModule.PHARMACY_INVENTORY_ADMIN_ROLES)({ role }, res, next);
    return { next, res };
};

describe('pharmacy inventory settings route contract', () => {
    it('está montado bajo la configuración tenant autenticada', () => {
        const server = readFileSync('backend/server.ts', 'utf8');
        expect(server).toContain(
            "app.use('/api/tenant/pharmacy-inventory-settings', pharmacyInventorySettingsRouter)",
        );
    });

    it('restringe GET y PUT a roles administrativos autenticados', () => {
        expect(routeModule.PHARMACY_INVENTORY_ADMIN_ROLES).toEqual([
            'OWNER',
            'ADMIN',
            'SUPER_ADMIN',
        ]);
        const service = { getSettings: vi.fn(), setMode: vi.fn() };
        const router = routeModule.buildPharmacyInventorySettingsRouter(service as any);
        expect(routeHandlers(router, 'get')).toHaveLength(3);
        expect(routeHandlers(router, 'put')).toHaveLength(4);

        for (const role of routeModule.PHARMACY_INVENTORY_ADMIN_ROLES) {
            expect(authorize(role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['MANAGER', 'VIEWER', 'CASHIER', 'BODEGUERO']) {
            expect(authorize(role).res.statusCode).toBe(403);
        }
        expect(authorize().res.statusCode).toBe(401);
    });

    it('acepta únicamente el body estricto OFF o ENFORCED', () => {
        expect(routeModule.PharmacyInventoryModeSchema.parse({ mode: 'OFF' })).toEqual({
            mode: 'OFF',
        });
        expect(routeModule.PharmacyInventoryModeSchema.parse({ mode: 'ENFORCED' })).toEqual({
            mode: 'ENFORCED',
        });
        expect(() => routeModule.PharmacyInventoryModeSchema.parse({ mode: 'SHADOW' })).toThrow();
        expect(() => routeModule.PharmacyInventoryModeSchema.parse({
            mode: 'ENFORCED',
            tenantId: 'tenant-forjado',
        })).toThrow();
        expect(() => routeModule.PharmacyInventoryModeSchema.parse({})).toThrow();
    });

    it('pasa exclusivamente tenant y usuario autenticados al servicio', async () => {
        const settings = {
            data: {
                pharmacyInventoryMode: 'OFF',
                pharmacyInventoryActivatedAt: null,
                batchWarehouseLedgerMode: 'ENFORCED',
                readiness: {
                    evaluatedBatchWarehouseLedgerMode: 'ENFORCED',
                    canEnforce: false,
                    canActivatePharmacy: true,
                    materialBlockers: [],
                    summary: {},
                },
            },
        };
        const mutation = {
            data: {
                pharmacyInventoryMode: 'ENFORCED',
                pharmacyInventoryActivatedAt: new Date('2026-08-31T20:00:00.000Z'),
                batchWarehouseLedgerMode: 'ENFORCED',
                changed: true,
                readiness: settings.data.readiness,
            },
        };
        const service = {
            getSettings: vi.fn().mockResolvedValue(settings),
            setMode: vi.fn().mockResolvedValue(mutation),
        };
        const router = routeModule.buildPharmacyInventorySettingsRouter(service as any);
        const getRes = response();
        await routeHandlers(router, 'get').at(-1)(
            { tenantId: 'tenant-auth', query: { tenantId: 'tenant-forjado' } },
            getRes,
        );
        expect(service.getSettings).toHaveBeenCalledWith('tenant-auth');
        expect(getRes.json).toHaveBeenCalledWith(settings);

        const putHandlers = routeHandlers(router, 'put');
        const validate = putHandlers.at(-2);
        const handler = putHandlers.at(-1);
        const req: any = {
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            body: { mode: 'ENFORCED' },
        };
        const putRes = response();
        const next = vi.fn();
        validate(req, putRes, next);
        expect(next).toHaveBeenCalledOnce();
        await handler(req, putRes);
        expect(service.setMode).toHaveBeenCalledWith(
            'tenant-auth',
            'user-auth',
            'ENFORCED',
        );
        expect(putRes.json).toHaveBeenCalledWith({ success: true, ...mutation });
    });

    it('rechaza body inválido antes de llamar al servicio', () => {
        const service = { getSettings: vi.fn(), setMode: vi.fn() };
        const router = routeModule.buildPharmacyInventorySettingsRouter(service as any);
        const validate = routeHandlers(router, 'put').at(-2);
        const res = response();
        const next = vi.fn();

        validate(
            {
                body: {
                    mode: 'ENFORCED',
                    tenantId: 'tenant-forjado',
                },
            },
            res,
            next,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'PHARMACY_INVENTORY_INVALID_INPUT',
        }));
        expect(service.setMode).not.toHaveBeenCalled();
    });

    it('mapea errores de dominio y oculta detalles de fallos internos', async () => {
        const { PharmacyInventorySettingsError } = await import(
            '../backend/services/pharmacyInventorySettingsService'
        );
        const domainService = {
            getSettings: vi.fn().mockRejectedValue(new PharmacyInventorySettingsError(
                'PHARMACY_INVENTORY_TENANT_NOT_FOUND',
                404,
                'No existe el negocio',
            )),
            setMode: vi.fn().mockRejectedValue(new PharmacyInventorySettingsError(
                'PHARMACY_INVENTORY_OPEN_HOLDS',
                409,
                'Queda stock retenido',
            )),
        };
        const router = routeModule.buildPharmacyInventorySettingsRouter(domainService as any);
        const getRes = response();
        await routeHandlers(router, 'get').at(-1)({ tenantId: 'tenant-auth' }, getRes);
        expect(getRes.statusCode).toBe(404);
        expect(getRes.json).toHaveBeenCalledWith({
            error: 'No existe el negocio',
            code: 'PHARMACY_INVENTORY_TENANT_NOT_FOUND',
        });

        const putRes = response();
        await routeHandlers(router, 'put').at(-1)(
            {
                tenantId: 'tenant-auth',
                userId: 'user-auth',
                body: { mode: 'OFF' },
            },
            putRes,
        );
        expect(putRes.statusCode).toBe(409);
        expect(putRes.json).toHaveBeenCalledWith({
            error: 'Queda stock retenido',
            code: 'PHARMACY_INVENTORY_OPEN_HOLDS',
        });

        const internalService = {
            getSettings: vi.fn().mockRejectedValue(new Error('secret database host')),
            setMode: vi.fn(),
        };
        const internalRouter = routeModule.buildPharmacyInventorySettingsRouter(
            internalService as any,
        );
        const internalRes = response();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await routeHandlers(internalRouter, 'get').at(-1)(
            { tenantId: 'tenant-auth' },
            internalRes,
        );
        expect(internalRes.statusCode).toBe(500);
        expect(internalRes.json).toHaveBeenCalledWith({
            error: 'No pudimos completar la configuración farmacéutica',
        });
        expect(JSON.stringify(internalRes.json.mock.calls)).not.toContain('secret database host');
        consoleSpy.mockRestore();
    });
});
