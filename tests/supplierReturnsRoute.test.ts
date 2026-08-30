import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
    SUPPLIER_CREDIT_NOTE_READ_ROLES,
    SUPPLIER_CREDIT_NOTE_WRITE_ROLES,
    SUPPLIER_RETURN_READ_ROLES,
    SUPPLIER_RETURN_WRITE_ROLES,
} from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';

const EVENT_ID = '018f6d75-0d8c-7a7a-8b4b-e2b25a80eb12';

type RouteModule = typeof import('../backend/routes/supplierReturns');
let routeModule: RouteModule;

beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', 'supplier-returns-route-test-secret');
    routeModule = await import('../backend/routes/supplierReturns');
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

const returnDto = () => ({
    id: 'return-1',
    supplierId: 'supplier-1',
    returnNumber: 'DEV-000001',
    status: 'POSTED',
    reasonCode: 'DAMAGE',
    reason: 'Empaque dañado',
    supplierReference: 'RMA-9',
    batchLedgerMode: 'ENFORCED',
    returnedBy: 'user-auth',
    returnedAt: '2026-08-27T12:00:00.000Z',
    createdAt: '2026-08-27T12:00:00.000Z',
    items: [{
        id: 'return-item-1',
        sourceType: 'GOODS_RECEIPT_UNMATCHED' as const,
        sourceId: 'receipt-item-1',
        productId: 'product-1',
        productNameAtReturn: 'Carne molida',
        warehouse: { id: 'warehouse-1', name: 'Bodega principal' },
        batch: {
            id: 'batch-1',
            batchNumber: 'L-001',
            expiryDate: '2026-09-15',
        },
        quantityExact: '1.2500',
        unitAtReturn: 'KG',
        saleModeAtReturn: 'WEIGHT',
        quantityStepAtReturn: '0.0001',
        batchLedgerStatus: 'APPLIED',
        creditEligibility: 'PENDING_INVOICE_LINK' as const,
    }],
});

const creditNoteDto = () => ({
    id: 'credit-note-1',
    supplierId: 'supplier-1',
    creditNoteNumber: 'NC-001',
    type: 'RETURN',
    status: 'POSTED',
    invoiceDate: '2026-08-01',
    creditNoteDate: '2026-08-27',
    devolutionDate: '2026-08-27',
    postingDate: '2026-08-27',
    fiscalRegimeAtCredit: 'GENERAL',
    currencyAtIssue: 'NIO',
    subtotal: '100.00',
    tax: '15.00',
    creditableTax: '15.00',
    total: '115.00',
    inventoryReversalExact: '90.00',
    priceVarianceReversalExact: '10.00',
    remainingCredit: '0.00',
    reason: 'Mercancía devuelta',
    supplierReference: 'RMA-9',
    createdBy: 'user-auth',
    createdAt: '2026-08-27T12:00:00.000Z',
    lines: [{
        id: 'credit-line-1',
        supplierReturnItemId: 'return-item-1',
        quantityExact: '1.2500',
        subtotal: '100.00',
        tax: '15.00',
        creditableTax: '15.00',
        total: '115.00',
        descriptionAtCredit: 'Carne molida',
        unitAtCredit: 'KG',
    }],
    applications: [{
        id: 'application-1',
        purchaseId: 'purchase-1',
        amount: '115.00',
        appliedAt: '2026-08-27T12:00:00.000Z',
    }],
});

const dependencies = (overrides: Record<string, unknown> = {}) => ({
    listReturns: vi.fn().mockResolvedValue({
        data: [returnDto()],
        pageInfo: { nextCursor: null },
    }),
    getReturnEligibleLines: vi.fn().mockResolvedValue({
        purchaseOrderId: 'po-1',
        supplierId: 'supplier-1',
        batchLedgerMode: 'ENFORCED',
        truncated: false,
        eligibleLines: [],
    }),
    createReturn: vi.fn().mockResolvedValue({ supplierReturn: returnDto(), replay: false }),
    listCreditNotes: vi.fn().mockResolvedValue({
        data: [creditNoteDto()],
        pageInfo: { nextCursor: null },
    }),
    createCreditNote: vi.fn().mockResolvedValue({
        supplierCreditNote: creditNoteDto(),
        replay: false,
    }),
    ...overrides,
});

describe('supplier returns and credit notes HTTP contract', () => {
    it('aplica los roles canónicos y separa custodia física de finanzas', () => {
        expect(SUPPLIER_RETURN_READ_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT', 'BODEGUERO',
        ]);
        expect(SUPPLIER_RETURN_WRITE_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'BODEGUERO',
        ]);
        expect(SUPPLIER_CREDIT_NOTE_READ_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT',
        ]);
        expect(SUPPLIER_CREDIT_NOTE_WRITE_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT',
        ]);

        expect(authorize(SUPPLIER_RETURN_WRITE_ROLES, 'BODEGUERO').next).toHaveBeenCalledOnce();
        expect(authorize(SUPPLIER_RETURN_WRITE_ROLES, 'VIEWER').res.statusCode).toBe(403);
        expect(authorize(SUPPLIER_CREDIT_NOTE_WRITE_ROLES, 'ACCOUNTANT').next).toHaveBeenCalledOnce();
        expect(authorize(SUPPLIER_CREDIT_NOTE_WRITE_ROLES, 'MANAGER').res.statusCode).toBe(403);
        expect(authorize(SUPPLIER_CREDIT_NOTE_READ_ROLES, 'BODEGUERO').res.statusCode).toBe(403);
        expect(authorize(SUPPLIER_RETURN_READ_ROLES).res.statusCode).toBe(401);
    });

    it('valida params y queries estrictos con listas siempre acotadas', () => {
        expect(routeModule.SupplierProcurementParamsSchema.parse({
            supplierId: ' supplier-1 ',
        })).toEqual({ supplierId: 'supplier-1' });
        expect(routeModule.SupplierReturnListQuerySchema.parse({})).toEqual({ limit: 50 });
        expect(routeModule.SupplierReturnListQuerySchema.parse({
            purchaseOrderId: ' po-1 ',
            limit: '100',
        })).toEqual({ purchaseOrderId: 'po-1', limit: 100 });
        expect(routeModule.SupplierCreditNoteListQuerySchema.parse({
            purchaseId: 'purchase-1',
            limit: '1',
        })).toEqual({ purchaseId: 'purchase-1', limit: 1 });
        expect(() => routeModule.SupplierReturnListQuerySchema.parse({ limit: 101 })).toThrow();
        expect(() => routeModule.SupplierReturnListQuerySchema.parse({ tenantId: 'attacker' })).toThrow();
        expect(() => routeModule.SupplierCreditNoteListQuerySchema.parse({ role: 'OWNER' })).toThrow();
    });

    it('exige contexto de OC al bodeguero y pasa identidad solo desde autenticación', async () => {
        const service = dependencies();
        const router = routeModule.buildSupplierReturnsRouter(service as any);
        const handler = routeHandlers(router, '/:supplierId/returns', 'get').at(-1);
        const missingContextRes = response();

        await handler({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'BODEGUERO',
            params: { supplierId: 'supplier-1' },
            query: {},
        }, missingContextRes);
        expect(missingContextRes.statusCode).toBe(400);
        expect(missingContextRes.json).toHaveBeenCalledWith({
            error: 'La consulta de bodega requiere una orden de compra',
            code: 'SUPPLIER_RETURN_CONTEXT_REQUIRED',
        });
        expect(service.listReturns).not.toHaveBeenCalled();

        const res = response();
        await handler({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'BODEGUERO',
            params: { supplierId: 'supplier-1' },
            query: { purchaseOrderId: 'po-1', limit: '25' },
        }, res);
        expect(service.listReturns).toHaveBeenCalledWith({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'BODEGUERO',
            supplierId: 'supplier-1',
        }, { purchaseOrderId: 'po-1', limit: 25 });
        expect(service.getReturnEligibleLines).toHaveBeenCalledWith({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'BODEGUERO',
            supplierId: 'supplier-1',
        }, { purchaseOrderId: 'po-1', limit: 25 });
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                returns: [expect.objectContaining({ returnNumber: 'DEV-000001' })],
                eligibleLines: expect.objectContaining({
                    purchaseOrderId: 'po-1',
                    eligibleLines: [],
                }),
            }),
        }));
    });

    it('rechaza identidad en el body y conserva replay/decimales de la devolución', async () => {
        const service = dependencies({
            createReturn: vi.fn().mockResolvedValue({ supplierReturn: returnDto(), replay: true }),
        });
        const router = routeModule.buildSupplierReturnsRouter(service as any);
        const handlers = routeHandlers(router, '/:supplierId/returns', 'post');
        const validate = handlers.at(-2);
        const create = handlers.at(-1);
        const invalidRes = response();
        const invalidNext = vi.fn();

        validate({
            body: {
                clientEventId: EVENT_ID,
                reasonCode: 'DAMAGE',
                reason: 'Daño confirmado',
                lines: [{
                    sourceType: 'DIRECT_PURCHASE_ITEM',
                    purchaseItemId: 'purchase-item-1',
                    quantity: '1.2500',
                }],
                tenantId: 'tenant-atacante',
            },
        }, invalidRes, invalidNext);
        expect(invalidRes.statusCode).toBe(400);
        expect(invalidRes.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'INVALID_SUPPLIER_RETURN',
        }));
        expect(invalidNext).not.toHaveBeenCalled();

        const req: any = {
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'BODEGUERO',
            params: { supplierId: 'supplier-1' },
            body: {
                clientEventId: EVENT_ID,
                reasonCode: 'DAMAGE',
                reason: '  Daño confirmado  ',
                lines: [{
                    sourceType: 'DIRECT_PURCHASE_ITEM',
                    purchaseItemId: 'purchase-item-1',
                    quantity: '1.2500',
                }],
            },
        };
        const res = response();
        const next = vi.fn();
        validate(req, res, next);
        expect(next).toHaveBeenCalledOnce();
        await create(req, res);

        expect(service.createReturn).toHaveBeenCalledWith({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'BODEGUERO',
            supplierId: 'supplier-1',
        }, expect.objectContaining({
            clientEventId: EVENT_ID,
            reason: 'Daño confirmado',
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                supplierId: 'supplier-1',
                items: [expect.objectContaining({ quantityExact: '1.2500' })],
            }),
            replay: true,
        }));
    });

    it('allow-listea el DTO físico incluso si una dependencia agrega costos', async () => {
        const unsafeReturn = {
            ...returnDto(),
            tenantId: 'tenant-secret',
            payloadHash: 'secret-hash',
            items: [{
                ...returnDto().items[0],
                bookUnitCostExact: '99.999999',
                bookValueExact: '124.99',
            }],
        };
        const service = dependencies({
            listReturns: vi.fn().mockResolvedValue({
                data: [unsafeReturn],
                pageInfo: { nextCursor: null },
            }),
        });
        const router = routeModule.buildSupplierReturnsRouter(service as any);
        const res = response();
        await routeHandlers(router, '/:supplierId/returns', 'get').at(-1)({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'BODEGUERO',
            params: { supplierId: 'supplier-1' },
            query: { purchaseOrderId: 'po-1' },
        }, res);

        const payload = res.json.mock.calls[0]?.[0];
        expect(JSON.stringify(payload)).not.toContain('tenant-secret');
        expect(JSON.stringify(payload)).not.toContain('secret-hash');
        expect(JSON.stringify(payload)).not.toContain('bookUnitCostExact');
        expect(JSON.stringify(payload)).not.toContain('bookValueExact');
    });

    it('valida la nota estrictamente y entrega al servicio solo actor JWT + decimales string', async () => {
        const service = dependencies({
            createCreditNote: vi.fn().mockResolvedValue({
                supplierCreditNote: creditNoteDto(),
                replay: true,
            }),
        });
        const router = routeModule.buildSupplierReturnsRouter(service as any);
        const handlers = routeHandlers(router, '/:supplierId/credit-notes', 'post');
        const validate = handlers.at(-2);
        const create = handlers.at(-1);
        const body = {
            clientEventId: EVENT_ID,
            creditNoteNumber: ' NC-001 ',
            invoiceDate: '2026-08-01',
            creditNoteDate: '2026-08-27',
            devolutionDate: '2026-08-27',
            postingDate: '2026-08-27',
            reason: '  Mercancía devuelta  ',
            subtotal: '100.00',
            tax: '15.00',
            creditableTax: '15.00',
            total: '115.00',
            lines: [{
                supplierReturnItemId: 'return-item-1',
                quantity: '1.2500',
                subtotal: '100.00',
                tax: '15.00',
                creditableTax: '15.00',
                total: '115.00',
            }],
            applications: [{ purchaseId: 'purchase-1', amount: '115.00' }],
        };
        const req: any = {
            tenantId: 'tenant-auth',
            userId: 'accountant-auth',
            role: 'ACCOUNTANT',
            params: { supplierId: 'supplier-1' },
            body,
        };
        const res = response();
        const next = vi.fn();
        validate(req, res, next);
        expect(next).toHaveBeenCalledOnce();
        await create(req, res);

        expect(service.createCreditNote).toHaveBeenCalledWith({
            tenantId: 'tenant-auth',
            userId: 'accountant-auth',
            role: 'ACCOUNTANT',
            supplierId: 'supplier-1',
        }, expect.objectContaining({
            creditNoteNumber: 'NC-001',
            total: '115.00',
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ total: '115.00' }),
            replay: true,
        }));

        const invalidRes = response();
        validate({ body: { ...body, userId: 'attacker' } }, invalidRes, vi.fn());
        expect(invalidRes.statusCode).toBe(400);
        expect(invalidRes.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'INVALID_SUPPLIER_CREDIT_NOTE',
        }));
    });

    it('mapea errores de dominio y sanitiza errores internos sin PII', async () => {
        const { SupplierReturnError } = await import('../backend/lib/supplierReturns');
        const domainService = dependencies({
            createReturn: vi.fn().mockRejectedValue(new SupplierReturnError(
                'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
                409,
                'La cantidad excede la fuente disponible',
            )),
        });
        const domainRouter = routeModule.buildSupplierReturnsRouter(domainService as any);
        const domainRes = response();
        await routeHandlers(domainRouter, '/:supplierId/returns', 'post').at(-1)({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'MANAGER',
            params: { supplierId: 'supplier-1' },
            body: {
                clientEventId: EVENT_ID,
                reasonCode: 'DAMAGE',
                reason: 'Daño confirmado',
                lines: [],
            },
        }, domainRes);
        expect(domainRes.statusCode).toBe(409);
        expect(domainRes.json).toHaveBeenCalledWith({
            error: 'La cantidad excede la fuente disponible',
            code: 'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
        });

        const internalService = dependencies({
            listCreditNotes: vi.fn().mockRejectedValue(
                new Error('Prisma leaked supplier tax id 001-SECRET'),
            ),
        });
        const internalRouter = routeModule.buildSupplierReturnsRouter(internalService as any);
        const internalRes = response();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await routeHandlers(internalRouter, '/:supplierId/credit-notes', 'get').at(-1)({
            tenantId: 'tenant-auth',
            userId: 'user-auth',
            role: 'ACCOUNTANT',
            params: { supplierId: 'supplier-1' },
            query: {},
        }, internalRes);
        expect(internalRes.statusCode).toBe(500);
        expect(internalRes.json).toHaveBeenCalledWith({
            error: 'No pudimos completar la operación de proveedor',
            code: 'SUPPLIER_OPERATION_FAILED',
        });
        expect(JSON.stringify(internalRes.json.mock.calls)).not.toContain('001-SECRET');
        expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('001-SECRET');
        consoleSpy.mockRestore();
    });
});
