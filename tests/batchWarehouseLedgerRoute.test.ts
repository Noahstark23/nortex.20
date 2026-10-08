import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { checkRole } from '../backend/middleware/checkRole';

const routeSource = readFileSync(
    resolve(process.cwd(), 'backend/routes/batchWarehouseLedger.ts'),
    'utf8',
);
const serverSource = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

type RouteModule = typeof import('../backend/routes/batchWarehouseLedger');
let routeModule: RouteModule;

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'batch-warehouse-route-test-secret');
    routeModule = await import('../backend/routes/batchWarehouseLedger');
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

describe('batch warehouse readiness route contract', () => {
    it('monta el router y limita el acceso a roles administrativos', () => {
        expect(serverSource).toContain("app.use('/api/batch-warehouse-ledger', batchWarehouseLedgerRouter)");
        expect(routeSource).toContain("checkRole(BATCH_WAREHOUSE_ADMIN_ROLES)");
        expect(routeModule.BATCH_WAREHOUSE_ADMIN_ROLES).toEqual(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
        for (const role of routeModule.BATCH_WAREHOUSE_ADMIN_ROLES) {
            expect(authorize(routeModule.BATCH_WAREHOUSE_ADMIN_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['MANAGER', 'VIEWER', 'CASHIER', 'BODEGUERO']) {
            expect(authorize(routeModule.BATCH_WAREHOUSE_ADMIN_ROLES, role).res.statusCode).toBe(403);
        }
        expect(authorize(routeModule.BATCH_WAREHOUSE_ADMIN_ROLES).res.statusCode).toBe(401);
    });

    it('valida query y body con esquemas estrictos y cantidades exactas', () => {
        expect(routeModule.BatchWarehouseReadinessQuerySchema.parse({
            cursor: ' batch-a ',
            limit: '100',
        })).toEqual({ cursor: 'batch-a', limit: 100 });
        expect(routeModule.BatchWarehouseReadinessQuerySchema.parse({})).toEqual({ limit: 50 });
        expect(() => routeModule.BatchWarehouseReadinessQuerySchema.parse({
            limit: 101,
        })).toThrow();
        expect(() => routeModule.BatchWarehouseReadinessQuerySchema.parse({
            tenantId: 'tenant-forjado',
        })).toThrow();

        expect(routeModule.BatchWarehouseReconciliationSchema.parse({
            clientEventId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
            batchId: ' batch-a ',
            reason: ' Conteo firmado ',
            allocations: [{ warehouseId: ' warehouse-a ', quantity: '1.2500' }],
        })).toEqual({
            clientEventId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
            batchId: 'batch-a',
            reason: 'Conteo firmado',
            allocations: [{ warehouseId: 'warehouse-a', quantity: '1.2500' }],
        });
        expect(() => routeModule.BatchWarehouseReconciliationSchema.parse({
            clientEventId: 'not-a-uuid',
            batchId: 'batch-a',
            reason: 'Conteo firmado',
            allocations: [{ warehouseId: 'warehouse-a', quantity: '1.2500' }],
        })).toThrow();
        expect(() => routeModule.BatchWarehouseReconciliationSchema.parse({
            clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            batchId: 'batch-a',
            reason: 'Conteo firmado',
            tenantId: 'tenant-forjado',
            allocations: [{ warehouseId: 'warehouse-a', quantity: '1.2500' }],
        })).toThrow();
        expect(() => routeModule.BatchWarehouseReconciliationSchema.parse({
            clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            batchId: 'batch-a',
            reason: 'Conteo firmado',
            allocations: [{ warehouseId: 'warehouse-a', quantity: 1.25 }],
        })).toThrow();
    });

    it('pasa solo tenant y usuario autenticados al servicio en GET y POST', async () => {
        const service = {
            readiness: vi.fn().mockResolvedValue({
                data: { mode: 'OFF', canEnterShadow: true, canEnforce: false },
                pageInfo: { limit: 25, nextCursor: null },
            }),
            reconcile: vi.fn().mockResolvedValue({
                data: { commandId: 'cmd-1', batchId: 'batch-a', productId: 'product-a', modeObserved: 'OFF', aggregateStock: '1.2500', allocationTotal: '1.2500', allocations: [] },
                replay: false,
            }),
        };
        const router = routeModule.buildBatchWarehouseLedgerRouter(service as any);
        const getHandler = routeHandlers(router, '/readiness', 'get').at(-1);
        const postHandlers = routeHandlers(router, '/reconcile', 'post');
        const validate = postHandlers.at(-2);
        const postHandler = postHandlers.at(-1);
        const getRes = response();
        const postRes = response();
        const next = vi.fn();
        const req: any = {
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            query: { cursor: 'batch-a', limit: '25' },
        };

        await getHandler(req, getRes);
        expect(service.readiness).toHaveBeenCalledWith('tenant-auth', {
            cursor: 'batch-a',
            limit: 25,
        });
        expect(getRes.json).toHaveBeenCalledWith({
            data: { mode: 'OFF', canEnterShadow: true, canEnforce: false },
            pageInfo: { limit: 25, nextCursor: null },
        });

        const postReq: any = {
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            body: {
                clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                batchId: ' batch-a ',
                reason: ' Conteo físico ',
                allocations: [{ warehouseId: ' warehouse-a ', quantity: '1.2500' }],
            },
        };
        validate(postReq, postRes, next);
        expect(next).toHaveBeenCalledOnce();
        await postHandler(postReq, postRes);
        expect(service.reconcile).toHaveBeenCalledWith('tenant-auth', 'user-auth', {
            clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            batchId: 'batch-a',
            reason: 'Conteo físico',
            allocations: [{ warehouseId: 'warehouse-a', quantity: '1.2500' }],
        });
        expect(postRes.statusCode).toBe(201);
        expect(postRes.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            replay: false,
        }));

        service.reconcile.mockResolvedValueOnce({
            data: {
                commandId: 'cmd-1',
                batchId: 'batch-a',
                productId: 'product-a',
                modeObserved: 'OFF',
                aggregateStock: '1.2500',
                allocationTotal: '1.2500',
                allocations: [],
            },
            replay: true,
        });
        const replayRes = response();
        await postHandler(postReq, replayRes);
        expect(replayRes.statusCode).toBe(200);
        expect(replayRes.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            replay: true,
        }));
    });

    it('mapea errores de dominio sin exponer fallos internos', async () => {
        const { BatchWarehouseReadinessError } = await import(
            '../backend/lib/batchWarehouseReadiness'
        );
        const { BatchWarehouseLedgerError } = await import(
            '../backend/services/productBatchWarehouseLedgerService.js'
        );
        const domainService = {
            readiness: vi.fn().mockRejectedValue(new BatchWarehouseReadinessError(
                'BATCH_READINESS_TENANT_NOT_FOUND',
                404,
                'No existe el tenant',
            )),
            reconcile: vi.fn().mockRejectedValue(new BatchWarehouseLedgerError(
                'BATCH_WAREHOUSE_INSUFFICIENT_STOCK',
                409,
                'Saldo insuficiente',
            )),
        };
        const router = routeModule.buildBatchWarehouseLedgerRouter(domainService as any);
        const getRes = response();
        const postRes = response();

        await routeHandlers(router, '/readiness', 'get').at(-1)(
            { tenantId: 'tenant-auth', query: {} },
            getRes,
        );
        expect(getRes.statusCode).toBe(404);
        expect(getRes.json).toHaveBeenCalledWith({
            error: 'No existe el tenant',
            code: 'BATCH_READINESS_TENANT_NOT_FOUND',
        });

        await routeHandlers(router, '/reconcile', 'post').at(-1)(
            {
                tenantId: 'tenant-auth',
                userId: 'user-auth',
                body: {
                    clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    batchId: 'batch-a',
                    reason: 'Conteo físico',
                    allocations: [{ warehouseId: 'warehouse-a', quantity: '1.2500' }],
                },
            },
            postRes,
        );
        expect(postRes.statusCode).toBe(409);
        expect(postRes.json).toHaveBeenCalledWith({
            error: 'Saldo insuficiente',
            code: 'BATCH_WAREHOUSE_INSUFFICIENT_STOCK',
        });

        const internalService = {
            readiness: vi.fn().mockRejectedValue(new Error('sensitive token value')),
            reconcile: vi.fn(),
        };
        const internalRouter = routeModule.buildBatchWarehouseLedgerRouter(internalService as any);
        const internalRes = response();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await routeHandlers(internalRouter, '/readiness', 'get').at(-1)(
            { tenantId: 'tenant-auth', query: {} },
            internalRes,
        );
        expect(internalRes.statusCode).toBe(500);
        expect(internalRes.json).toHaveBeenCalledWith({
            error: 'No pudimos completar el readiness lote-bodega',
        });
        expect(JSON.stringify(internalRes.json.mock.calls)).not.toContain('sensitive token value');
        consoleSpy.mockRestore();
    });
});
