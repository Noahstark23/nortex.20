import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
    PROCUREMENT_MATCH_READ_ROLES,
    PROCUREMENT_MATCH_RESOLVE_ROLES,
} from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';

const EVENT_ID = '018f6d75-0d8c-7a7a-8b4b-e2b25a80eb12';
const routeSource = readFileSync(
    resolve(process.cwd(), 'backend/routes/procurementMatches.ts'),
    'utf8',
);
const serverSource = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

type RouteModule = typeof import('../backend/routes/procurementMatches');
let routeModule: RouteModule;

beforeAll(async () => {
    // El router importa authenticate, cuyo keyring debe fallar cerrado incluso
    // en pruebas. Se fija antes del import dinámico y nunca sale del proceso.
    vi.stubEnv('JWT_SECRET', 'procurement-match-route-test-secret');
    routeModule = await import('../backend/routes/procurementMatches');
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

const authorize = (roles: readonly string[], role?: string) => {
    const next = vi.fn();
    const res = response();
    checkRole(roles)({ role }, res, next);
    return { next, res };
};

const routeHandlers = (router: any, path: string, method: 'get' | 'post') => {
    const layer = router.stack.find((candidate: any) =>
        candidate.route?.path === path && candidate.route.methods?.[method]);
    if (!layer) throw new Error(`No se encontró ${method.toUpperCase()} ${path}`);
    return layer.route.stack.map((candidate: any) => candidate.handle);
};

describe('procurement matches route contract', () => {
    it('monta rutas tenant-scoped y políticas canónicas de mínimo privilegio', () => {
        expect(serverSource).toContain("app.use('/api/procurement/matches', procurementMatchesRouter)");
        expect(routeSource).toContain('checkRole(PROCUREMENT_MATCH_READ_ROLES)');
        expect(routeSource).toContain('checkRole(PROCUREMENT_MATCH_RESOLVE_ROLES)');
        expect(PROCUREMENT_MATCH_READ_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT',
        ]);
        expect(PROCUREMENT_MATCH_RESOLVE_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT',
        ]);

        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT']) {
            expect(authorize(PROCUREMENT_MATCH_RESOLVE_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['VIEWER', 'CASHIER', 'EMPLOYEE', 'VENDEDOR', 'BODEGUERO']) {
            expect(authorize(PROCUREMENT_MATCH_RESOLVE_ROLES, role).res.statusCode).toBe(403);
        }
        expect(authorize(PROCUREMENT_MATCH_READ_ROLES, 'VIEWER').next).toHaveBeenCalledOnce();
        expect(authorize(PROCUREMENT_MATCH_READ_ROLES).res.statusCode).toBe(401);
    });

    it('valida filtros acotados, convierte paymentHold y rechaza claves extra', () => {
        const valid = routeModule.ProcurementMatchListQuerySchema.parse({
            status: 'EXCEPTION',
            supplierId: ' supplier-1 ',
            purchaseOrderId: 'po-1',
            paymentHold: 'true',
            limit: '100',
        });
        expect(valid).toEqual({
            status: 'EXCEPTION',
            supplierId: 'supplier-1',
            purchaseOrderId: 'po-1',
            paymentHold: true,
            limit: 100,
        });
        expect(routeModule.ProcurementMatchListQuerySchema.parse({})).toEqual({ limit: 50 });
        expect(() => routeModule.ProcurementMatchListQuerySchema.parse({ limit: 101 })).toThrow();
        expect(() => routeModule.ProcurementMatchListQuerySchema.parse({ tenantId: 'tenant-2' })).toThrow();
    });

    it('exige UUID y razón útil sin aceptar tenantId desde el cuerpo', () => {
        expect(routeModule.ProcurementMatchResolutionSchema.parse({
            clientEventId: EVENT_ID.toUpperCase(),
            reason: '  Factura verificada contra soporte físico  ',
        })).toEqual({
            clientEventId: EVENT_ID.toUpperCase(),
            reason: 'Factura verificada contra soporte físico',
        });
        expect(() => routeModule.ProcurementMatchResolutionSchema.parse({
            clientEventId: 'not-a-uuid',
            reason: 'ok',
        })).toThrow();
        expect(() => routeModule.ProcurementMatchResolutionSchema.parse({
            clientEventId: EVENT_ID,
            reason: 'Razón válida',
            tenantId: 'tenant-atacante',
        })).toThrow();
    });

    it('pasa únicamente el tenant autenticado a lista y detalle', async () => {
        const service = {
            list: vi.fn().mockResolvedValue({ data: [], pageInfo: { nextCursor: null } }),
            detail: vi.fn().mockResolvedValue({ purchase: { id: 'purchase-1' } }),
            resolve: vi.fn(),
        };
        const router = routeModule.buildProcurementMatchesRouter(service as any);
        const listHandler = routeHandlers(router, '/', 'get').at(-1);
        const detailHandler = routeHandlers(router, '/:purchaseId', 'get').at(-1);
        const listRes = response();
        const detailRes = response();

        await listHandler({
            tenantId: 'tenant-auth',
            query: { status: 'MATCHED', paymentHold: 'false', limit: '25' },
        }, listRes);
        await detailHandler({
            tenantId: 'tenant-auth',
            params: { purchaseId: 'purchase-1' },
        }, detailRes);

        expect(service.list).toHaveBeenCalledWith('tenant-auth', {
            status: 'MATCHED', paymentHold: false, limit: 25,
        });
        expect(service.detail).toHaveBeenCalledWith('tenant-auth', 'purchase-1');
        expect(listRes.json).toHaveBeenCalledWith({ data: [], pageInfo: { nextCursor: null } });
        expect(detailRes.json).toHaveBeenCalledWith({ data: { purchase: { id: 'purchase-1' } } });
    });

    it('valida antes de resolver y conserva respuesta de replay idempotente', async () => {
        const service = {
            list: vi.fn(),
            detail: vi.fn(),
            resolve: vi.fn().mockResolvedValue({
                data: {
                    purchaseId: 'purchase-1',
                    matchStatus: 'RESOLVED',
                    paymentHold: false,
                },
                replay: true,
            }),
        };
        const router = routeModule.buildProcurementMatchesRouter(service as any);
        const handlers = routeHandlers(router, '/:purchaseId/resolve', 'post');
        const validate = handlers.at(-2);
        const resolveHandler = handlers.at(-1);
        const invalidRes = response();
        const invalidNext = vi.fn();

        validate({ body: { clientEventId: 'invalid', reason: 'ok' } }, invalidRes, invalidNext);
        expect(invalidRes.statusCode).toBe(400);
        expect(invalidRes.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'INVALID_MATCH_RESOLUTION',
        }));
        expect(invalidNext).not.toHaveBeenCalled();

        const req: any = {
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            params: { purchaseId: 'purchase-1' },
            body: { clientEventId: EVENT_ID, reason: ' Verificado por contabilidad ' },
        };
        const validRes = response();
        const validNext = vi.fn();
        validate(req, validRes, validNext);
        expect(validNext).toHaveBeenCalledOnce();
        await resolveHandler(req, validRes);

        expect(service.resolve).toHaveBeenCalledWith(
            'tenant-auth',
            'user-auth',
            'purchase-1',
            { clientEventId: EVENT_ID, reason: 'Verificado por contabilidad' },
        );
        expect(validRes.json).toHaveBeenCalledWith(expect.objectContaining({ replay: true }));
    });

    it('expone códigos de dominio estables sin filtrar errores internos', async () => {
        const { ProcurementMatchError } = await import('../backend/lib/procurementMatch');
        const domainService = {
            list: vi.fn(),
            detail: vi.fn().mockRejectedValue(new ProcurementMatchError(
                'PURCHASE_NOT_FOUND', 404, 'Compra no encontrada',
            )),
            resolve: vi.fn(),
        };
        const domainRouter = routeModule.buildProcurementMatchesRouter(domainService as any);
        const domainRes = response();
        await routeHandlers(domainRouter, '/:purchaseId', 'get').at(-1)(
            { tenantId: 'tenant-auth', params: { purchaseId: 'missing' } },
            domainRes,
        );
        expect(domainRes.statusCode).toBe(404);
        expect(domainRes.json).toHaveBeenCalledWith({
            error: 'Compra no encontrada', code: 'PURCHASE_NOT_FOUND',
        });

        const internalService = {
            ...domainService,
            detail: vi.fn().mockRejectedValue(new Error('sensitive database value')),
        };
        const internalRouter = routeModule.buildProcurementMatchesRouter(internalService as any);
        const internalRes = response();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await routeHandlers(internalRouter, '/:purchaseId', 'get').at(-1)(
            { tenantId: 'tenant-auth', params: { purchaseId: 'purchase-1' } },
            internalRes,
        );
        expect(internalRes.statusCode).toBe(500);
        expect(internalRes.json).toHaveBeenCalledWith({
            error: 'No pudimos completar la conciliación de la compra',
        });
        expect(JSON.stringify(internalRes.json.mock.calls)).not.toContain('sensitive database value');
        consoleSpy.mockRestore();
    });
});
