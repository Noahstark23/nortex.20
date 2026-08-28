import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const routeSource = readFileSync(resolve(process.cwd(), 'backend/routes/purchaseOrders.ts'), 'utf8');

const cancellationState = (
    status: string,
    quantityReceived: string = '0',
    quantityReceivedExact: string | null = '0',
    evidence: {
        quantityRejectedExact?: string | null;
        quantityClosedShortExact?: string | null;
        goodsReceipts?: number;
        closeShorts?: number;
    } = {},
) => ({
    status,
    items: [{
        quantityReceived,
        quantityReceivedExact,
        quantityRejectedExact: evidence.quantityRejectedExact ?? null,
        quantityClosedShortExact: evidence.quantityClosedShortExact ?? null,
    }],
    _count: {
        goodsReceipts: evidence.goodsReceipts ?? 0,
        closeShorts: evidence.closeShorts ?? 0,
    },
});

const endpointBlock = (startMarker: string, endMarker: string): string => {
    const start = routeSource.indexOf(startMarker);
    const end = routeSource.indexOf(endMarker, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return routeSource.slice(start, end);
};

afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('../backend/lib/prisma');
    vi.resetModules();
});

const responseDouble = () => ({
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
        this.statusCode = code;
        return this;
    },
    json(payload: unknown) {
        this.body = payload;
        return this;
    },
});

const postHandler = (router: any, path: string) => {
    const routeLayer = router.stack.find((layer: any) =>
        layer.route?.path === path && layer.route.methods?.post);
    expect(routeLayer, `No se encontró POST ${path}`).toBeTruthy();
    return routeLayer.route.stack.at(-1).handle;
};

describe('integridad de cancelación de órdenes de compra', () => {
    it('solo admite DRAFT o APPROVED sin recepción', async () => {
        vi.stubEnv('JWT_SECRETS', 'purchase-order-cancellation-test-secret');
        const { getPurchaseOrderCancellationRejection } = await import('../backend/routes/purchaseOrders');

        expect(getPurchaseOrderCancellationRejection(cancellationState('DRAFT'))).toBeNull();
        expect(getPurchaseOrderCancellationRejection(cancellationState('APPROVED'))).toBeNull();

        expect(getPurchaseOrderCancellationRejection(
            cancellationState('PARTIALLY_RECEIVED'),
        )?.code).toBe('PO_HAS_RECEIPTS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('APPROVED', '0.25', null),
        )?.code).toBe('PO_HAS_RECEIPTS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('APPROVED', '0', '0.125'),
        )?.code).toBe('PO_HAS_RECEIPTS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('APPROVED', '0', '0', { quantityRejectedExact: '0.0001' }),
        )?.code).toBe('PO_HAS_RECEIPTS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('APPROVED', '0', '0', { quantityRejectedExact: '-0.0001' }),
        )?.code).toBe('PO_HAS_RECEIPTS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('APPROVED', '0', '0', { quantityClosedShortExact: '1' }),
        )?.code).toBe('PO_HAS_RECEIPTS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('APPROVED', '0', '0', { goodsReceipts: 1 }),
        )?.code).toBe('PO_HAS_RECEIPTS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('APPROVED', '0', '0', { closeShorts: 1 }),
        )?.code).toBe('PO_HAS_RECEIPTS');

        expect(getPurchaseOrderCancellationRejection(
            cancellationState('RECEIVED'),
        )?.code).toBe('PO_FINAL_STATUS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('CANCELLED'),
        )?.code).toBe('PO_FINAL_STATUS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('CLOSED_SHORT'),
        )?.code).toBe('PO_FINAL_STATUS');
        expect(getPurchaseOrderCancellationRejection(
            cancellationState('ESTADO_DESCONOCIDO'),
        )?.code).toBe('PO_INVALID_STATUS');
    });

    it('serializa aprobación y cancelación, y audita dentro de sus transacciones', () => {
        expect(routeSource).toContain("import prisma from '../lib/prisma'");
        expect(routeSource).not.toContain('new PrismaClient()');

        const approve = endpointBlock(
            "router.post('/:id/approve'",
            "router.post('/:id/cancel'",
        );
        const cancel = endpointBlock(
            "router.post('/:id/cancel'",
            "router.post('/:id/receive'",
        );

        for (const block of [approve, cancel]) {
            const transactionIndex = block.indexOf('prisma.$transaction');
            const lockIndex = block.indexOf('FOR UPDATE');
            const readIndex = block.indexOf('tx.purchaseOrder.findFirst');
            const updateIndex = block.indexOf('tx.purchaseOrder.update');
            const auditIndex = block.indexOf('tx.auditLog.create');

            expect(transactionIndex).toBeGreaterThanOrEqual(0);
            expect(lockIndex).toBeGreaterThan(transactionIndex);
            expect(readIndex).toBeGreaterThan(lockIndex);
            expect(updateIndex).toBeGreaterThan(readIndex);
            expect(auditIndex).toBeGreaterThan(updateIndex);
            expect(block).toContain('before: purchaseOrderTransitionSnapshot');
            expect(block).toContain('after: purchaseOrderTransitionSnapshot');
        }

        expect(cancel).toContain("action: 'PO_CANCELLED'");
        expect(cancel).toContain('getPurchaseOrderCancellationRejection(po)');
        expect(cancel).toContain('_count: { select: { goodsReceipts: true, closeShorts: true } }');
        expect(cancel).toContain('code: result.rejection.code');
    });

    it('solo crea o aprueba OCs con un proveedor activo y no eliminado', () => {
        const create = endpointBlock(
            "router.post('/', authenticate, checkRole(ROLES_WRITE)",
            "router.post('/:id/approve'",
        );
        const approve = endpointBlock(
            "router.post('/:id/approve'",
            "router.post('/:id/cancel'",
        );

        const createTransactionIndex = create.indexOf('prisma.$transaction');
        const createLockIndex = create.indexOf('FOR UPDATE');
        const createStateReadIndex = create.indexOf("supplier.status !== 'ACTIVE'");
        const createWriteIndex = create.indexOf('tx.purchaseOrder.create');
        const createAuditIndex = create.indexOf('tx.auditLog.create');
        expect(createTransactionIndex).toBeGreaterThanOrEqual(0);
        expect(createLockIndex).toBeGreaterThan(createTransactionIndex);
        expect(createStateReadIndex).toBeGreaterThan(createLockIndex);
        expect(createWriteIndex).toBeGreaterThan(createStateReadIndex);
        expect(createAuditIndex).toBeGreaterThan(createWriteIndex);
        expect(create).toContain('supplier.deletedAt !== null');
        expect(create).toContain("action: 'PO_CREATED'");
        expect(create).toContain('before: null');
        expect(create).toContain('after: {');
        expect(create).toContain("code: 'SUPPLIER_NOT_ACTIVE'");
        expect(approve).toContain('\\`deletedAt\\` IS NULL');
        expect(approve).toContain("\\`status\\` = ${'ACTIVE'}");
        expect(approve).toContain("code: 'SUPPLIER_NOT_ACTIVE'");
        expect(create).toContain('WHERE id = ${supplierId} AND \\`tenantId\\` = ${tenantId}');
        expect(approve).toContain('WHERE id = ${po.supplierId}');
        expect(approve).toContain('AND \\`tenantId\\` = ${tenantId}');
        expect(approve.indexOf('FROM \\`PurchaseOrder\\`')).toBeLessThan(approve.indexOf('FROM \\`Supplier\\`'));
    });

    it('rechaza por API un proveedor bloqueado al crear y al aprobar', async () => {
        vi.stubEnv('JWT_SECRETS', 'purchase-order-supplier-status-test-secret');

        const purchaseOrderCreate = vi.fn();
        const createAudit = vi.fn();
        const createTx = {
            $queryRaw: vi.fn().mockResolvedValue([{
                id: 'supplier-blocked',
                status: 'BLOCKED',
                deletedAt: null,
            }]),
            product: { findMany: vi.fn() },
            purchaseOrder: {
                count: vi.fn(),
                create: purchaseOrderCreate,
            },
            auditLog: { create: createAudit },
        };
        const purchaseOrderUpdate = vi.fn();
        const auditCreate = vi.fn();
        const approveTx = {
            $queryRaw: vi.fn()
                .mockResolvedValueOnce([{ id: 'po-draft' }])
                .mockResolvedValueOnce([]),
            purchaseOrder: {
                findFirst: vi.fn().mockResolvedValue({
                    id: 'po-draft',
                    tenantId: 'tenant-a',
                    supplierId: 'supplier-blocked',
                    orderNumber: 'OC-0001',
                    status: 'DRAFT',
                    approvedBy: null,
                    approvedAt: null,
                }),
                update: purchaseOrderUpdate,
            },
            auditLog: { create: auditCreate },
        };
        const prismaMock = {
            $transaction: vi.fn()
                .mockImplementationOnce((callback: (client: typeof createTx) => unknown) => callback(createTx))
                .mockImplementationOnce((callback: (client: typeof approveTx) => unknown) => callback(approveTx)),
        };
        vi.doMock('../backend/lib/prisma', () => ({ default: prismaMock }));

        const { default: router } = await import('../backend/routes/purchaseOrders');

        const createResponse = responseDouble();
        await postHandler(router, '/')({
            tenantId: 'tenant-a',
            userId: 'user-a',
            body: { supplierId: 'supplier-blocked', items: [{ productId: 'product-a' }] },
        }, createResponse);
        expect(createResponse.statusCode).toBe(409);
        expect(createResponse.body).toMatchObject({ code: 'SUPPLIER_NOT_ACTIVE' });
        expect(createTx.$queryRaw).toHaveBeenCalledOnce();
        expect(purchaseOrderCreate).not.toHaveBeenCalled();
        expect(createAudit).not.toHaveBeenCalled();

        const approveResponse = responseDouble();
        await postHandler(router, '/:id/approve')({
            tenantId: 'tenant-a',
            userId: 'user-a',
            params: { id: 'po-draft' },
        }, approveResponse);
        expect(approveResponse.statusCode).toBe(409);
        expect(approveResponse.body).toMatchObject({ code: 'SUPPLIER_NOT_ACTIVE' });
        expect(purchaseOrderUpdate).not.toHaveBeenCalled();
        expect(auditCreate).not.toHaveBeenCalled();
    });

    it('bloquea cancel por API tras un comprobante reject-only aunque accepted siga en cero', async () => {
        vi.stubEnv('JWT_SECRETS', 'purchase-order-reject-only-cancellation-secret');
        const purchaseOrderUpdate = vi.fn();
        const auditCreate = vi.fn();
        const cancelTx = {
            $queryRaw: vi.fn().mockResolvedValue([{ id: 'po-approved' }]),
            purchaseOrder: {
                findFirst: vi.fn().mockResolvedValue({
                    id: 'po-approved',
                    tenantId: 'tenant-a',
                    supplierId: 'supplier-a',
                    orderNumber: 'OC-0001',
                    status: 'APPROVED',
                    approvedBy: 'user-a',
                    approvedAt: new Date('2026-08-27T17:00:00.000Z'),
                    items: [{
                        quantityReceived: 0,
                        quantityReceivedExact: '0',
                        quantityRejectedExact: '3',
                        quantityClosedShortExact: '0',
                    }],
                    _count: { goodsReceipts: 1, closeShorts: 0 },
                }),
                update: purchaseOrderUpdate,
            },
            auditLog: { create: auditCreate },
        };
        const prismaMock = {
            $transaction: vi.fn((callback: (client: typeof cancelTx) => unknown) => callback(cancelTx)),
        };
        vi.doMock('../backend/lib/prisma', () => ({ default: prismaMock }));

        const { default: router } = await import('../backend/routes/purchaseOrders');
        const response = responseDouble();
        await postHandler(router, '/:id/cancel')({
            tenantId: 'tenant-a',
            userId: 'user-a',
            params: { id: 'po-approved' },
        }, response);

        expect(response.statusCode).toBe(409);
        expect(response.body).toMatchObject({ code: 'PO_HAS_RECEIPTS' });
        expect(purchaseOrderUpdate).not.toHaveBeenCalled();
        expect(auditCreate).not.toHaveBeenCalled();
    });

    it('monta close-short solo con roles de escritura, separado de receive BODEGUERO', () => {
        expect(routeSource).toContain(
            "router.post('/:id/close-short', authenticate, checkRole(ROLES_WRITE)",
        );
        expect(routeSource).not.toContain(
            "router.post('/:id/close-short', authenticate, checkRole(ROLES_RECEIVE)",
        );
        expect(routeSource).toContain('const ROLES_WRITE = PURCHASE_WRITE_ROLES');
        expect(routeSource).toContain('const ROLES_RECEIVE = PURCHASE_ORDER_RECEIVE_ROLES');
    });

    it('redacta autor, nota libre y costo para BODEGUERO sin ocultar inspección física', () => {
        const start = routeSource.indexOf('const redactBodegueroGoodsReceipt');
        const end = routeSource.indexOf('/**', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const redaction = routeSource.slice(start, end);

        expect(redaction).toContain('deliveredQuantityExact');
        expect(redaction).toContain('rejectedQuantityExact');
        expect(redaction).toContain('rejectionReasonCode');
        expect(redaction).toContain('supplierFault');
        expect(redaction).not.toContain('receivedBy:');
        expect(redaction).not.toContain('receiver:');
        expect(redaction).not.toContain('rejectionNotes:');
        expect(redaction).not.toContain('unitCostExact:');
    });
});
