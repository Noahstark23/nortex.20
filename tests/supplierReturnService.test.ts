import type { Prisma, PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inventoryMocks = vi.hoisted(() => ({
    applyStockDelta: vi.fn(),
    applyBatchWarehouseDelta: vi.fn(),
    resolveBatchWarehouseLedgerMode: vi.fn(),
}));

vi.mock('../backend/services/stockService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/stockService.js')>()),
    applyStockDelta: inventoryMocks.applyStockDelta,
}));

vi.mock('../backend/services/productBatchWarehouseLedgerService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/productBatchWarehouseLedgerService.js')>()),
    applyBatchWarehouseDelta: inventoryMocks.applyBatchWarehouseDelta,
    resolveBatchWarehouseLedgerMode: inventoryMocks.resolveBatchWarehouseLedgerMode,
}));

import {
    buildSupplierReturnCommandId,
    buildSupplierReturnPayloadHash,
    normalizeSupplierReturnCommand,
    serializeSupplierReturnStoredResult,
    SupplierReturnError,
    type SupplierReturnStoredResult,
} from '../backend/lib/supplierReturns';
import type { CreateSupplierReturnInput } from '../backend/validation/supplierReturnSchemas';
import {
    buildSupplierReturnResultAuditId,
    executeSupplierReturn,
    executeSupplierReturnTransaction,
    SupplierReturnServiceError,
} from '../backend/services/supplierReturnService';

const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';
const SUPPLIER_ID = 'supplier-1';
const WAREHOUSE_ID = 'warehouse-1';
const EVENT_ID = '018f2f89-6f3f-7ca1-8a00-123456789abc';
const NOW = new Date('2026-08-27T20:00:00.000Z');
const EXPIRY = new Date('2027-08-27T12:00:00.000Z');

const directRequest = (
    quantity = '1',
    eventId = EVENT_ID,
): CreateSupplierReturnInput => ({
    clientEventId: eventId,
    reasonCode: 'QUALITY',
    reason: 'Calidad fuera de especificación',
    supplierReference: 'DEV-PROV-1',
    lines: [{
        sourceType: 'DIRECT_PURCHASE_ITEM',
        purchaseItemId: 'purchase-item-direct',
        quantity,
    }],
});

const mixedRequest = (): CreateSupplierReturnInput => ({
    clientEventId: EVENT_ID,
    reasonCode: 'QUALITY',
    reason: 'Mercadería no conforme',
    lines: [
        { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-direct', quantity: '1' },
        { sourceType: 'GOODS_RECEIPT_UNMATCHED', goodsReceiptItemId: 'receipt-item-1', quantity: '1' },
        { sourceType: 'PURCHASE_MATCH_ALLOCATION', purchaseMatchAllocationId: 'allocation-1', quantity: '2' },
    ],
});

const allocationTransitionRequest = (): CreateSupplierReturnInput => ({
    clientEventId: '018f2f89-6f3f-7ca1-8a00-123456789abd',
    reasonCode: 'QUALITY',
    reason: 'Devolución posterior al enlace de factura',
    lines: [
        { sourceType: 'PURCHASE_MATCH_ALLOCATION', purchaseMatchAllocationId: 'allocation-1', quantity: '4' },
        { sourceType: 'PURCHASE_MATCH_ALLOCATION', purchaseMatchAllocationId: 'allocation-2', quantity: '2' },
    ],
});

const sqlText = (query: unknown): string => {
    const candidate = query as { strings?: readonly string[]; sql?: string };
    return candidate.strings?.join('?') ?? candidate.sql ?? String(query);
};

const sqlValues = (query: unknown): readonly unknown[] =>
    (query as { values?: readonly unknown[] }).values ?? [];

interface FakeOptions {
    actorActive?: boolean;
    supplierExists?: boolean;
    mode?: 'OFF' | 'SHADOW' | 'ENFORCED';
    trackedDirect?: boolean;
    serialDirect?: boolean;
    shadowGapHistory?: boolean;
    aggregateDirect?: number;
    aggregateReceipt?: number;
    localDirect?: number;
    localReceipt?: number;
    batchStock?: number;
    batchWarehouseStock?: string;
    batchLedgerStatus?: 'APPLIED' | 'SHADOW_GAP';
    batchUpdateCount?: number;
    priorDirect?: Record<string, string>;
    priorUnmatched?: Record<string, string>;
    priorMatched?: Record<string, string>;
    auditFailure?: Error;
}

interface FakeStoredState {
    header: null | Record<string, unknown>;
    items: Array<Record<string, unknown>>;
    audit: null | { id: string; tenantId: string; userId: string; action: string; details: string };
    kardex: Array<Record<string, unknown>>;
}

const purchaseRows = [
    {
        id: 'purchase-direct', supplierId: SUPPLIER_ID,
        purchaseOrderId: null, documentStatus: 'POSTED',
    },
    {
        id: 'purchase-match-1', supplierId: SUPPLIER_ID,
        purchaseOrderId: 'purchase-order-1', documentStatus: 'POSTED',
    },
    {
        id: 'purchase-match-2', supplierId: SUPPLIER_ID,
        purchaseOrderId: 'purchase-order-1', documentStatus: 'POSTED',
    },
];

const purchaseItemRows = [
    {
        id: 'purchase-item-direct', purchaseId: 'purchase-direct', productId: 'product-direct',
        productName: 'Carne molida', quantityExact: '5.0000', purchaseOrderItemId: null,
        inventoryWarehouseId: WAREHOUSE_ID, inventoryBatchId: null,
        inventoryUnitCostExact: '10.123456', batchNumber: null, expiryDate: null,
    },
    {
        id: 'purchase-item-match-1', purchaseId: 'purchase-match-1', productId: 'product-receipt',
        productName: 'Pollo entero', quantityExact: '4.0000', purchaseOrderItemId: 'purchase-order-item-1',
        inventoryWarehouseId: null, inventoryBatchId: null,
        inventoryUnitCostExact: null, batchNumber: null, expiryDate: null,
    },
    {
        id: 'purchase-item-match-2', purchaseId: 'purchase-match-2', productId: 'product-receipt',
        productName: 'Pollo entero', quantityExact: '2.0000', purchaseOrderItemId: 'purchase-order-item-1',
        inventoryWarehouseId: null, inventoryBatchId: null,
        inventoryUnitCostExact: null, batchNumber: null, expiryDate: null,
    },
];

const orderItemRows = [{
    id: 'purchase-order-item-1', purchaseOrderId: 'purchase-order-1', productId: 'product-receipt',
    productName: 'Pollo entero', quantityOrdered: 10, quantityReceived: 10,
    quantityOrderedExact: '10.0000', quantityReceivedExact: '10.0000',
    unitAtOrder: 'kg', saleModeAtOrder: 'MEASURED', quantityStepAtOrder: '0.0001',
    unitCost: '7.50', unitCostExact: '7.500000',
}];

const allocationRows = [
    {
        id: 'allocation-1', purchaseItemId: 'purchase-item-match-1',
        purchaseOrderItemId: 'purchase-order-item-1', goodsReceiptItemId: 'receipt-item-1',
        source: 'FORMAL_RECEIPT', quantityExact: '4.0000',
    },
    {
        id: 'allocation-2', purchaseItemId: 'purchase-item-match-2',
        purchaseOrderItemId: 'purchase-order-item-1', goodsReceiptItemId: 'receipt-item-1',
        source: 'FORMAL_RECEIPT', quantityExact: '2.0000',
    },
];

const valuesInclude = (values: readonly unknown[], value: string): boolean =>
    values.some(candidate => String(candidate) === value);

const rowsRequested = <TRow extends { id: string }>(
    rows: readonly TRow[],
    values: readonly unknown[],
): TRow[] => rows.filter(row => valuesInclude(values, row.id));

const hydratedReturn = (state: FakeStoredState): Record<string, unknown> | null => {
    if (!state.header) return null;
    return {
        ...state.header,
        items: [...state.items]
            .sort((left, right) => String(left.sourceHash).localeCompare(String(right.sourceHash)))
            .map(item => ({
                ...item,
                quantityExact: new Decimal(String(item.quantityExact)),
                bookUnitCostExact: new Decimal(String(item.bookUnitCostExact)),
                bookValueExact: new Decimal(String(item.bookValueExact)),
                quantityStepAtReturn: item.quantityStepAtReturn == null
                    ? null
                    : new Decimal(String(item.quantityStepAtReturn)),
                expiryDateAtReturn: item.expiryDateAtReturn == null
                    ? null
                    : new Date(String(item.expiryDateAtReturn)),
                warehouse: { id: item.warehouseId, name: 'Bodega Central' },
            })),
    };
};

const makeFakeTx = (options: FakeOptions = {}) => {
    const events: string[] = [];
    const state: FakeStoredState = { header: null, items: [], audit: null, kardex: [] };
    const aggregate = new Map<string, number>([
        ['product-direct', options.aggregateDirect ?? 20],
        ['product-receipt', options.aggregateReceipt ?? 20],
    ]);
    const directBatch = options.trackedDirect === true ? 'batch-direct' : null;

    const directItem = {
        ...purchaseItemRows[0],
        inventoryBatchId: directBatch,
        batchNumber: directBatch ? 'LOT-DIRECT' : null,
        expiryDate: directBatch ? EXPIRY : null,
    };
    const allPurchaseItems = [directItem, ...purchaseItemRows.slice(1)];

    const queryRaw = vi.fn(async (query: unknown): Promise<unknown[]> => {
        const text = sqlText(query);
        const values = sqlValues(query);

        if (text.includes('SELECT pi.id AS sourceId')) {
            events.push('preview-direct');
            return valuesInclude(values, directItem.id)
                && valuesInclude(values, TENANT_ID)
                ? [{ sourceId: directItem.id, purchaseId: directItem.purchaseId }]
                : [];
        }
        if (text.includes('SELECT gri.id AS sourceId')) {
            events.push('preview-receipt');
            return valuesInclude(values, 'receipt-item-1')
                && valuesInclude(values, TENANT_ID)
                ? [{
                    sourceId: 'receipt-item-1', goodsReceiptId: 'receipt-1',
                    purchaseOrderId: 'purchase-order-1', purchaseOrderItemId: 'purchase-order-item-1',
                }]
                : [];
        }
        if (text.includes('SELECT pma.id AS sourceId')) {
            events.push('preview-allocation');
            return allocationRows
                .filter(row => valuesInclude(values, row.id) && valuesInclude(values, TENANT_ID))
                .map(row => ({
                    sourceId: row.id,
                    purchaseId: row.id === 'allocation-1' ? 'purchase-match-1' : 'purchase-match-2',
                    purchaseItemId: row.purchaseItemId,
                    purchaseOrderId: 'purchase-order-1',
                    purchaseOrderItemId: row.purchaseOrderItemId,
                    goodsReceiptId: 'receipt-1',
                    goodsReceiptItemId: row.goodsReceiptItemId,
                }));
        }
        if (text.includes('FROM `SupplierReturnItem`')) {
            events.push('lock-prior-returns');
            const source = text.includes('sri.`purchaseItemId`')
                ? options.priorDirect
                : text.includes('sri.`goodsReceiptItemId`')
                    ? options.priorUnmatched
                    : options.priorMatched;
            return Object.entries(source ?? {})
                .filter(([sourceId]) => valuesInclude(values, sourceId))
                .map(([sourceId, returnedExact]) => ({ sourceId, returnedExact, invalidCount: 0 }));
        }
        if (text.includes('FROM `Supplier`')) {
            events.push('lock-supplier');
            return options.supplierExists === false
                || !valuesInclude(values, TENANT_ID)
                ? []
                : [{ id: String(values[0] ?? SUPPLIER_ID) }];
        }
        if (text.includes('FROM `PurchaseMatchAllocation`')) {
            events.push('lock-allocations');
            return allocationRows.filter(row =>
                valuesInclude(values, row.id)
                || (row.goodsReceiptItemId !== null && valuesInclude(values, row.goodsReceiptItemId)));
        }
        if (text.includes('FROM `PurchaseOrderItem`')) {
            events.push('lock-order-items');
            return rowsRequested(orderItemRows, values);
        }
        if (text.includes('FROM `PurchaseOrder`')) {
            events.push('lock-orders');
            return valuesInclude(values, 'purchase-order-1')
                ? [{ id: 'purchase-order-1', supplierId: SUPPLIER_ID }]
                : [];
        }
        if (text.includes('FROM `PurchaseItem`')) {
            events.push('lock-purchase-items');
            return rowsRequested(allPurchaseItems, values);
        }
        if (text.includes('FROM `Purchase`')) {
            events.push('lock-purchases');
            return rowsRequested(purchaseRows, values);
        }
        if (text.includes('FROM `GoodsReceiptItem`')) {
            events.push('lock-receipt-items');
            return valuesInclude(values, 'receipt-item-1') ? [{
                id: 'receipt-item-1', goodsReceiptId: 'receipt-1',
                purchaseOrderItemId: 'purchase-order-item-1', productId: 'product-receipt',
                quantityExact: '10.0000', unitSnapshot: 'kg', saleModeSnapshot: 'MEASURED',
                unitCostExact: '7.500000', batchId: null, batchNumber: null, expiryDate: null,
            }] : [];
        }
        if (text.includes('FROM `GoodsReceipt`')) {
            events.push('lock-receipts');
            return valuesInclude(values, 'receipt-1') ? [{
                id: 'receipt-1', purchaseOrderId: 'purchase-order-1',
                warehouseId: WAREHOUSE_ID, status: 'POSTED',
            }] : [];
        }
        if (text.includes('FROM `Warehouse`')) {
            events.push('lock-warehouses');
            return valuesInclude(values, TENANT_ID) && valuesInclude(values, WAREHOUSE_ID)
                ? [{ id: WAREHOUSE_ID, name: 'Bodega Central' }]
                : [];
        }
        if (text.includes('FROM `ProductBatchWarehouseStock`')) {
            events.push('lock-batch-warehouse');
            return directBatch && valuesInclude(values, directBatch) ? [{
                id: 'batch-warehouse-1', productId: 'product-direct', batchId: directBatch,
                warehouseId: WAREHOUSE_ID, stock: options.batchWarehouseStock ?? '20.0000',
            }] : [];
        }
        if (text.includes('FROM `ProductBatchLedgerEntry`')) {
            events.push('lock-shadow-gaps');
            return options.shadowGapHistory === true && directBatch
                ? [{ batchId: directBatch }]
                : [];
        }
        if (text.includes('FROM `ProductBatch`')) {
            if (text.includes('SELECT id, productId')) {
                events.push('lock-batches');
                return directBatch && valuesInclude(values, directBatch) ? [{
                    id: directBatch, productId: 'product-direct', batchNumber: 'LOT-DIRECT',
                    expiryDate: EXPIRY, stock: options.batchStock ?? 20,
                }] : [];
            }
            events.push('lock-batch-history');
            return directBatch ? [{ productId: 'product-direct' }] : [];
        }
        if (text.includes('FROM `SerialNumber`')) {
            events.push('lock-serial-history');
            return options.serialDirect === true ? [{ productId: 'product-direct' }] : [];
        }
        if (text.includes('FROM `ProductStock`')) {
            events.push('lock-product-stocks');
            const rows = [
                { id: 'stock-direct', productId: 'product-direct', warehouseId: WAREHOUSE_ID, stock: options.localDirect ?? 20 },
                { id: 'stock-receipt', productId: 'product-receipt', warehouseId: WAREHOUSE_ID, stock: options.localReceipt ?? 20 },
            ];
            return rows.filter(row => valuesInclude(values, row.productId));
        }
        if (text.includes('FROM `Product`')) {
            events.push('lock-products');
            const rows = [
                {
                    id: 'product-direct', name: 'Carne molida', unit: 'kg', saleMode: 'MEASURED',
                    quantityStep: '0.0001', requiresBatchTracking: options.trackedDirect === true,
                    requiresSerialTracking: options.serialDirect === true, cost: 12, stock: options.aggregateDirect ?? 20,
                },
                {
                    id: 'product-receipt', name: 'Pollo entero', unit: 'kg', saleMode: 'MEASURED',
                    quantityStep: '0.0001', requiresBatchTracking: false,
                    requiresSerialTracking: false, cost: 8, stock: options.aggregateReceipt ?? 20,
                },
            ];
            return rows.filter(row => valuesInclude(values, row.id));
        }
        throw new Error(`SQL inesperado en SupplierReturnService.test: ${text}`);
    });

    const userFindFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        events.push('actor');
        return options.actorActive === false
            || where.tenantId !== TENANT_ID
            || where.status !== 'ACTIVE'
            ? null
            : { id: USER_ID };
    });

    const supplierReturnFindFirst = vi.fn(async () => {
        events.push(state.header ? 'return-read-existing' : 'return-read-empty');
        return hydratedReturn(state);
    });

    const tx = {
        user: { findFirst: userFindFirst },
        supplierReturn: {
            findFirst: supplierReturnFindFirst,
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                events.push('header-create');
                state.header = { ...data };
                return { id: data.id };
            }),
        },
        supplierReturnItem: {
            createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
                events.push('items-create');
                state.items.push(...data);
                return { count: data.length };
            }),
        },
        productBatch: {
            updateMany: vi.fn(async () => {
                events.push('batch-decrement');
                return { count: options.batchUpdateCount ?? 1 };
            }),
        },
        kardexMovement: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                events.push('kardex');
                state.kardex.push(data);
                return data;
            }),
        },
        auditLog: {
            findFirst: vi.fn(async () => state.audit),
            create: vi.fn(async ({ data }: { data: FakeStoredState['audit'] }) => {
                events.push('audit');
                if (options.auditFailure) throw options.auditFailure;
                state.audit = data;
                return data;
            }),
        },
        $queryRaw: queryRaw,
    };

    inventoryMocks.resolveBatchWarehouseLedgerMode.mockImplementation(async () => {
        events.push('mode');
        return options.mode ?? 'OFF';
    });
    inventoryMocks.applyStockDelta.mockImplementation(async (
        _tx: unknown,
        input: { productId: string; delta: number; warehouseId: string },
    ) => {
        events.push(`stock:${input.productId}`);
        const before = aggregate.get(input.productId) ?? 0;
        const after = before + input.delta;
        aggregate.set(input.productId, after);
        return { stockBefore: before, stockAfter: after, warehouseId: input.warehouseId };
    });
    inventoryMocks.applyBatchWarehouseDelta.mockImplementation(async () => {
        events.push('batch-ledger');
        return {
            mode: options.mode ?? 'ENFORCED',
            status: options.batchLedgerStatus ?? 'APPLIED',
            applied: options.batchLedgerStatus !== 'SHADOW_GAP',
            replay: false,
            ledgerEntryId: 'ledger-1',
            stockBefore: options.batchWarehouseStock ?? '20.0000',
            stockAfter: '19.0000',
            gap: options.batchLedgerStatus === 'SHADOW_GAP' ? '1.0000' : null,
        };
    });

    return {
        tx: tx as unknown as Prisma.TransactionClient,
        raw: tx,
        state,
        events,
        queryRaw,
        aggregate,
    };
};

const execute = (
    tx: Prisma.TransactionClient,
    request: CreateSupplierReturnInput = directRequest(),
    context: { tenantId?: string; userId?: string; supplierId?: string } = {},
) => executeSupplierReturn({
    tx,
    tenantId: context.tenantId ?? TENANT_ID,
    userId: context.userId ?? USER_ID,
    supplierId: context.supplierId ?? SUPPLIER_ID,
    request,
    now: NOW,
});

const expectReturnError = async (
    promise: Promise<unknown>,
    code: string,
): Promise<SupplierReturnError | SupplierReturnServiceError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(error instanceof SupplierReturnError
            ? SupplierReturnError
            : SupplierReturnServiceError);
        expect(error).toMatchObject({ code });
        return error as SupplierReturnError | SupplierReturnServiceError;
    }
    throw new Error('Se esperaba un error de devolución a proveedor');
};

describe('SupplierReturnService: fuentes, stock y auditoría', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('postea las tres fuentes con DTO operativo redacted y auditoría atómica', async () => {
        const fake = makeFakeTx();
        const result = await execute(fake.tx, mixedRequest());

        expect(result.replay).toBe(false);
        expect(result.supplierReturn).toMatchObject({
            supplierId: SUPPLIER_ID,
            status: 'POSTED',
            reason: 'Mercadería no conforme',
            batchLedgerMode: 'OFF',
            returnedBy: USER_ID,
        });
        expect(result.supplierReturn.items.map(item => item.sourceType).sort()).toEqual([
            'DIRECT_PURCHASE_ITEM',
            'GOODS_RECEIPT_UNMATCHED',
            'PURCHASE_MATCH_ALLOCATION',
        ]);
        expect(result.supplierReturn.items.find(item => item.sourceType === 'GOODS_RECEIPT_UNMATCHED'))
            .toMatchObject({ sourceId: 'receipt-item-1', creditEligibility: 'PENDING_INVOICE_LINK' });
        expect(result.supplierReturn.items.find(item => item.sourceType === 'PURCHASE_MATCH_ALLOCATION'))
            .toMatchObject({ sourceId: 'allocation-1', creditEligibility: 'NOTEABLE' });
        expect(result.supplierReturn.items[0]).not.toHaveProperty('bookUnitCostExact');
        expect(result.supplierReturn.items[0]).not.toHaveProperty('bookValueExact');
        expect(result.supplierReturn).not.toHaveProperty('tenantId');

        expect(inventoryMocks.applyStockDelta).toHaveBeenCalledTimes(3);
        expect(fake.raw.kardexMovement.create).toHaveBeenCalledTimes(3);
        expect(fake.raw.auditLog.create).toHaveBeenCalledTimes(1);
        expect(fake.events.indexOf('lock-supplier')).toBeLessThan(fake.events.indexOf('header-create'));
        expect(fake.events.indexOf('header-create')).toBeLessThan(fake.events.indexOf('lock-products'));
        expect(fake.events.indexOf('items-create')).toBeLessThan(fake.events.indexOf('stock:product-direct'));
        expect(fake.events.lastIndexOf('kardex')).toBeLessThan(fake.events.indexOf('audit'));

        const audit = JSON.parse(fake.state.audit?.details ?? 'null') as {
            response: { lines: unknown[] };
            audit: { before: unknown[]; after: unknown[] };
        };
        expect(audit.response.lines).toHaveLength(3);
        expect(audit.audit.before).toHaveLength(3);
        expect(audit.audit.after).toHaveLength(3);
    });

    it('conserva el borde pesable 0.0001 hasta la frontera Float del stock', async () => {
        const fake = makeFakeTx();
        const result = await execute(fake.tx, directRequest('0.0001'));

        expect(result.supplierReturn.items[0].quantityExact).toBe('0.0001');
        expect(inventoryMocks.applyStockDelta).toHaveBeenCalledWith(
            fake.tx,
            expect.objectContaining({
                tenantId: TENANT_ID,
                productId: 'product-direct',
                warehouseId: WAREHOUSE_ID,
                delta: -0.0001,
                enforceSufficient: true,
            }),
        );
        expect(fake.state.kardex[0]).toMatchObject({ quantity: -0.0001, type: 'PURCHASE_RETURN' });
    });

    it('impide resetear el cupo unmatched al aparecer dos allocations del mismo recibo', async () => {
        const fake = makeFakeTx({ priorUnmatched: { 'receipt-item-1': '5.0000' } });
        const error = await expectReturnError(
            execute(fake.tx, allocationTransitionRequest()),
            'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
        );

        expect(error.httpStatus).toBe(409);
        expect(fake.events).toContain('lock-allocations');
        expect(fake.events.filter(event => event === 'lock-prior-returns')).toHaveLength(2);
        expect(inventoryMocks.applyStockDelta).not.toHaveBeenCalled();
        expect(fake.raw.kardexMovement.create).not.toHaveBeenCalled();
        expect(fake.raw.auditLog.create).not.toHaveBeenCalled();
    });

    it('falla cerrado por actor revocado antes de replay, locks o efectos', async () => {
        const fake = makeFakeTx({ actorActive: false });
        const error = await expectReturnError(execute(fake.tx), 'SUPPLIER_RETURN_ACTOR_FORBIDDEN');
        expect(error.httpStatus).toBe(403);
        expect(fake.events).toEqual(['actor']);
        expect(fake.raw.supplierReturn.findFirst).not.toHaveBeenCalled();
        expect(fake.queryRaw).not.toHaveBeenCalled();
    });

    it('aísla proveedor por tenant y no revela fuentes de otro negocio', async () => {
        const fake = makeFakeTx();
        const error = await expectReturnError(
            execute(fake.tx, directRequest(), { tenantId: 'tenant-2' }),
            'SUPPLIER_RETURN_ACTOR_FORBIDDEN',
        );
        expect(error.httpStatus).toBe(403);
        expect(fake.queryRaw).not.toHaveBeenCalled();
    });

    it('permite devolver a un proveedor histórico sin exigir status ACTIVE', async () => {
        const fake = makeFakeTx();
        await execute(fake.tx);
        const supplierQuery = fake.queryRaw.mock.calls
            .map(call => sqlText(call[0]))
            .find(text => text.includes('FROM `Supplier`'));
        expect(supplierQuery).toContain('WHERE id =');
        expect(supplierQuery).toContain('tenantId =');
        expect(supplierQuery).not.toContain('status =');
    });

    it('rechaza proveedor inexistente antes de inspeccionar fuentes', async () => {
        const fake = makeFakeTx({ supplierExists: false });
        await expectReturnError(execute(fake.tx), 'SUPPLIER_RETURN_SUPPLIER_NOT_FOUND');
        expect(fake.events).toEqual(['actor', 'return-read-empty', 'mode', 'lock-supplier']);
        expect(inventoryMocks.applyStockDelta).not.toHaveBeenCalled();
    });

    it.each([
        ['local', { localDirect: 0 }, 'SUPPLIER_RETURN_LOCAL_STOCK_INSUFFICIENT'],
        ['agregado', { aggregateDirect: 0 }, 'SUPPLIER_RETURN_AGGREGATE_STOCK_INSUFFICIENT'],
    ] as const)('rechaza stock %s insuficiente antes de Kardex y auditoría', async (_label, options, code) => {
        const fake = makeFakeTx(options);
        await expectReturnError(execute(fake.tx), code);
        expect(inventoryMocks.applyStockDelta).not.toHaveBeenCalled();
        expect(fake.raw.kardexMovement.create).not.toHaveBeenCalled();
        expect(fake.raw.auditLog.create).not.toHaveBeenCalled();
    });
});

describe('SupplierReturnService: autoridad de lote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('OFF rechaza una fuente loteada antes de mover stock', async () => {
        const fake = makeFakeTx({ trackedDirect: true, mode: 'OFF' });
        await expectReturnError(execute(fake.tx), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED');
        expect(inventoryMocks.applyStockDelta).not.toHaveBeenCalled();
        expect(inventoryMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
        expect(fake.raw.auditLog.create).not.toHaveBeenCalled();
    });

    it('SHADOW_GAP aborta antes del lote global, Kardex y auditoría', async () => {
        const fake = makeFakeTx({
            trackedDirect: true,
            mode: 'SHADOW',
            batchLedgerStatus: 'SHADOW_GAP',
        });
        await expectReturnError(execute(fake.tx), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED');
        expect(inventoryMocks.applyStockDelta).toHaveBeenCalledTimes(1);
        expect(inventoryMocks.applyBatchWarehouseDelta).toHaveBeenCalledTimes(1);
        expect(fake.raw.productBatch.updateMany).not.toHaveBeenCalled();
        expect(fake.raw.kardexMovement.create).not.toHaveBeenCalled();
        expect(fake.raw.auditLog.create).not.toHaveBeenCalled();
    });

    it('ENFORCED debita sidecar y lote global con referencia item-level', async () => {
        const fake = makeFakeTx({ trackedDirect: true, mode: 'ENFORCED' });
        const result = await execute(fake.tx);

        expect(result.supplierReturn.items[0]).toMatchObject({
            batch: { id: 'batch-direct', batchNumber: 'LOT-DIRECT', expiryDate: EXPIRY.toISOString() },
            batchLedgerStatus: 'APPLIED',
        });
        expect(inventoryMocks.applyBatchWarehouseDelta).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'ENFORCED',
            movementType: 'PURCHASE_RETURN',
            referenceType: 'SUPPLIER_RETURN_ITEM',
            delta: '-1.0000',
            allowNegative: false,
        }));
        const ledgerIntent = inventoryMocks.applyBatchWarehouseDelta.mock.calls[0][0] as {
            referenceId: string;
            sourceKey: string;
        };
        expect(ledgerIntent.referenceId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(ledgerIntent.sourceKey).toContain(`:item:${ledgerIntent.referenceId}:batch:batch-direct`);
        expect(fake.raw.productBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 'batch-direct', tenantId: TENANT_ID, productId: 'product-direct',
                stock: { gte: 1 },
            }),
            data: { stock: { decrement: 1 } },
        }));
        expect(fake.raw.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rechaza insuficiencia global del lote antes de efectos', async () => {
        const fake = makeFakeTx({ trackedDirect: true, mode: 'ENFORCED', batchStock: 0 });
        await expectReturnError(execute(fake.tx), 'SUPPLIER_RETURN_BATCH_STOCK_INSUFFICIENT');
        expect(inventoryMocks.applyStockDelta).not.toHaveBeenCalled();
        expect(inventoryMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });

    it('rechaza historial serial aunque el flag actual se haya apagado', async () => {
        const fake = makeFakeTx({ serialDirect: true });
        await expectReturnError(execute(fake.tx), 'SUPPLIER_RETURN_SERIAL_UNSUPPORTED');
        expect(inventoryMocks.applyStockDelta).not.toHaveBeenCalled();
    });

    it('rechaza SHADOW_GAP histórico antes de recrear un movimiento', async () => {
        const fake = makeFakeTx({ trackedDirect: true, mode: 'ENFORCED', shadowGapHistory: true });
        await expectReturnError(execute(fake.tx), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED');
        expect(inventoryMocks.applyBatchWarehouseDelta).not.toHaveBeenCalled();
    });
});

const replayFixture = (overrides: {
    request?: CreateSupplierReturnInput;
    payloadHash?: string;
    auditDetails?: string | null;
} = {}) => {
    const request = overrides.request ?? directRequest();
    const command = normalizeSupplierReturnCommand({
        tenantId: TENANT_ID,
        userId: USER_ID,
        supplierId: SUPPLIER_ID,
        clientEventId: request.clientEventId,
        reasonCode: request.reasonCode,
        reason: request.reason,
        supplierReference: request.supplierReference,
        lines: request.lines,
    });
    const payloadHash = overrides.payloadHash ?? buildSupplierReturnPayloadHash(command);
    const returnId = 'return-existing';
    const itemId = 'return-item-existing';
    const returnNumber = `DEV-${command.clientEventId.toUpperCase()}`;
    const record = {
        id: returnId,
        tenantId: TENANT_ID,
        supplierId: SUPPLIER_ID,
        returnNumber,
        status: 'POSTED',
        reasonCode: command.reasonCode,
        reason: command.reason,
        supplierReference: command.supplierReference,
        clientEventId: command.clientEventId,
        payloadVersion: 1,
        payloadHash,
        batchLedgerMode: 'OFF',
        returnedBy: USER_ID,
        returnedAt: NOW,
        createdAt: NOW,
        items: [{
            id: itemId,
            tenantId: TENANT_ID,
            supplierReturnId: returnId,
            sourceType: 'DIRECT_PURCHASE_ITEM',
            purchaseItemId: 'purchase-item-direct',
            goodsReceiptItemId: null,
            purchaseMatchAllocationId: null,
            productId: 'product-direct',
            productNameAtReturn: 'Carne molida',
            warehouseId: WAREHOUSE_ID,
            batchId: null,
            quantityExact: new Decimal(command.lines[0].quantity),
            bookUnitCostExact: new Decimal('12.000000'),
            bookValueExact: new Decimal(command.lines[0].quantity).mul(12).toDecimalPlaces(4),
            unitAtReturn: 'kg',
            saleModeAtReturn: 'MEASURED',
            quantityStepAtReturn: new Decimal('0.0001'),
            batchNumberAtReturn: null,
            expiryDateAtReturn: null,
            sourceHash: command.lines[0].sourceHash,
            batchLedgerStatus: 'NOT_APPLICABLE',
            warehouse: { id: WAREHOUSE_ID, name: 'Bodega Central' },
        }],
    };
    const stored: SupplierReturnStoredResult = {
        version: 1,
        commandType: 'SUPPLIER_RETURN_POST',
        commandId: buildSupplierReturnCommandId(command),
        payloadHash,
        response: {
            supplierReturnId: returnId,
            returnNumber,
            supplierId: SUPPLIER_ID,
            status: 'POSTED',
            lines: [{
                supplierReturnItemId: itemId,
                sourceHash: command.lines[0].sourceHash,
                quantityExact: command.lines[0].quantity,
            }],
        },
    };
    const audit = {
        id: buildSupplierReturnResultAuditId({ tenantId: TENANT_ID, clientEventId: command.clientEventId }),
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: 'SUPPLIER_RETURN_POSTED',
        details: overrides.auditDetails === undefined
            ? serializeSupplierReturnStoredResult(stored)
            : overrides.auditDetails,
    };
    return { request, command, record, audit };
};

describe('SupplierReturnService: replay y frontera transaccional', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('devuelve replay exacto solo después de validar actor ACTIVE', async () => {
        const replay = replayFixture();
        const db = {
            user: { findFirst: vi.fn().mockResolvedValue({ id: USER_ID }) },
            supplierReturn: { findFirst: vi.fn().mockResolvedValue(replay.record) },
            auditLog: { findFirst: vi.fn().mockResolvedValue(replay.audit) },
            $transaction: vi.fn(),
        } as unknown as PrismaClient;

        const result = await executeSupplierReturnTransaction({
            db, tenantId: TENANT_ID, userId: USER_ID, supplierId: SUPPLIER_ID,
            request: replay.request,
        });
        expect(result).toMatchObject({ replay: true, supplierReturn: { id: 'return-existing' } });
        expect(db.user.findFirst).toHaveBeenCalledWith({
            where: { id: USER_ID, tenantId: TENANT_ID, status: 'ACTIVE' },
            select: { id: true },
        });
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('actor revocado no puede observar ni repetir un resultado existente', async () => {
        const replay = replayFixture();
        const supplierReturnFind = vi.fn().mockResolvedValue(replay.record);
        const db = {
            user: { findFirst: vi.fn().mockResolvedValue(null) },
            supplierReturn: { findFirst: supplierReturnFind },
            auditLog: { findFirst: vi.fn().mockResolvedValue(replay.audit) },
            $transaction: vi.fn(),
        } as unknown as PrismaClient;
        await expectReturnError(executeSupplierReturnTransaction({
            db, tenantId: TENANT_ID, userId: USER_ID, supplierId: SUPPLIER_ID,
            request: replay.request,
        }), 'SUPPLIER_RETURN_ACTOR_FORBIDDEN');
        expect(supplierReturnFind).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('tras P2002 relee en snapshot fresco y devuelve el ganador exacto', async () => {
        const replay = replayFixture();
        const supplierReturnFind = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(replay.record);
        const db = {
            user: { findFirst: vi.fn().mockResolvedValue({ id: USER_ID }) },
            supplierReturn: { findFirst: supplierReturnFind },
            auditLog: { findFirst: vi.fn().mockResolvedValue(replay.audit) },
            $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
        } as unknown as PrismaClient;

        const result = await executeSupplierReturnTransaction({
            db, tenantId: TENANT_ID, userId: USER_ID, supplierId: SUPPLIER_ID,
            request: replay.request,
        });
        expect(result.replay).toBe(true);
        expect(db.user.findFirst).toHaveBeenCalledTimes(2);
        expect(supplierReturnFind).toHaveBeenCalledTimes(2);
        expect(db.$transaction).toHaveBeenCalledWith(
            expect.any(Function),
            { isolationLevel: 'ReadCommitted' },
        );
    });

    it('revalida actor después de P2002 antes de leer el ganador', async () => {
        const supplierReturnFind = vi.fn().mockResolvedValue(null);
        const actorFind = vi.fn()
            .mockResolvedValueOnce({ id: USER_ID })
            .mockResolvedValueOnce(null);
        const db = {
            user: { findFirst: actorFind },
            supplierReturn: { findFirst: supplierReturnFind },
            auditLog: { findFirst: vi.fn() },
            $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
        } as unknown as PrismaClient;

        await expectReturnError(executeSupplierReturnTransaction({
            db, tenantId: TENANT_ID, userId: USER_ID, supplierId: SUPPLIER_ID,
            request: directRequest(),
        }), 'SUPPLIER_RETURN_ACTOR_FORBIDDEN');
        expect(supplierReturnFind).toHaveBeenCalledTimes(1);
        expect(db.auditLog.findFirst).not.toHaveBeenCalled();
    });

    it('rechaza replay con payload divergente después de P2002', async () => {
        const winner = replayFixture();
        const conflictingRequest = { ...directRequest(), reason: 'Otra intención económica' };
        const db = {
            user: { findFirst: vi.fn().mockResolvedValue({ id: USER_ID }) },
            supplierReturn: {
                findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner.record),
            },
            auditLog: { findFirst: vi.fn().mockResolvedValue(winner.audit) },
            $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
        } as unknown as PrismaClient;
        await expectReturnError(executeSupplierReturnTransaction({
            db, tenantId: TENANT_ID, userId: USER_ID, supplierId: SUPPLIER_ID,
            request: conflictingRequest,
        }), 'SUPPLIER_RETURN_IDEMPOTENCY_CONFLICT');
    });

    it('falla cerrado si el resultado inmutable está ausente o corrupto', async () => {
        const replay = replayFixture({ auditDetails: '{corrupto' });
        const db = {
            user: { findFirst: vi.fn().mockResolvedValue({ id: USER_ID }) },
            supplierReturn: { findFirst: vi.fn().mockResolvedValue(replay.record) },
            auditLog: { findFirst: vi.fn().mockResolvedValue(replay.audit) },
            $transaction: vi.fn(),
        } as unknown as PrismaClient;
        const error = await expectReturnError(executeSupplierReturnTransaction({
            db, tenantId: TENANT_ID, userId: USER_ID, supplierId: SUPPLIER_ID,
            request: replay.request,
        }), 'SUPPLIER_RETURN_RESULT_INCOMPLETE');
        expect(error.httpStatus).toBe(500);
        expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('traduce P2034 a conflicto reintentable estable', async () => {
        const db = {
            user: { findFirst: vi.fn().mockResolvedValue({ id: USER_ID }) },
            supplierReturn: { findFirst: vi.fn().mockResolvedValue(null) },
            auditLog: { findFirst: vi.fn() },
            $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
        } as unknown as PrismaClient;
        const error = await expectReturnError(executeSupplierReturnTransaction({
            db, tenantId: TENANT_ID, userId: USER_ID, supplierId: SUPPLIER_ID,
            request: directRequest(),
        }), 'SUPPLIER_RETURN_CONCURRENT_WRITE');
        expect(error.httpStatus).toBe(409);
    });
});
