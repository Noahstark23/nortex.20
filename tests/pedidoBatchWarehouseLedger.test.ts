import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyStockDeltaMock = vi.hoisted(() => vi.fn());
const recordSaleMock = vi.hoisted(() => vi.fn());
const consumeGlobalFefoMock = vi.hoisted(() => vi.fn());
const consumeWarehouseFefoMock = vi.hoisted(() => vi.fn());
const allocateSaleFefoMock = vi.hoisted(() => vi.fn());
const resolveBatchWarehouseModeMock = vi.hoisted(() => vi.fn());
const applyBatchWarehouseDeltaMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/services/stockService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/stockService.js')>()),
    applyStockDelta: applyStockDeltaMock,
}));

vi.mock('../backend/services/accounting.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/accounting.js')>()),
    recordSale: recordSaleMock,
}));

vi.mock('../backend/services/saleBatchAllocationService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/saleBatchAllocationService.js')>()),
    consumeProductBatchesFefo: consumeGlobalFefoMock,
    consumeProductBatchesByWarehouseFefo: consumeWarehouseFefoMock,
    allocateSaleItemBatchesFefo: allocateSaleFefoMock,
}));

vi.mock('../backend/services/productBatchWarehouseLedgerService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/productBatchWarehouseLedgerService.js')>()),
    resolveBatchWarehouseLedgerMode: resolveBatchWarehouseModeMock,
    applyBatchWarehouseDelta: applyBatchWarehouseDeltaMock,
}));

import { BatchAllocationError } from '../backend/services/saleBatchAllocationService';
import { BatchWarehouseLedgerError } from '../backend/services/productBatchWarehouseLedgerService';
import {
    cancelPedidoInTransaction,
    completePedidoDeliveryInTransaction,
    reservePedidoInTransaction,
} from '../backend/services/pedidoFulfillmentService';

const pedidoItem = (quantity = '0.7500') => ({
    id: 'pedido-item-a',
    pedidoId: 'pedido-a',
    productoId: 'product-a',
    cantidad: 1,
    cantidadExact: { toString: () => quantity },
    presentationAtSale: 'BASE',
    presentationQuantityAtSale: { toString: () => quantity },
    productNameAtOrder: 'Producto con lote',
    unitAtOrder: 'unidad',
    saleModeAtOrder: 'MEASURED',
    quantityStepAtOrder: { toString: () => '0.0001' },
    unitPriceExactAtOrder: { toString: () => '10.0000' },
    ivaExentoAtOrder: false,
    precioUnitario: { toString: () => '10.00' },
    subtotal: { toString: () => '7.50' },
});

const trackedProduct = () => ({
    id: 'product-a',
    name: 'Producto con lote',
    unit: 'unidad',
    cost: 4,
    ivaExento: false,
    saleMode: 'MEASURED',
    quantityStep: { toString: () => '0.0001' },
    requiresBatchTracking: true,
});

const allocation = (batchId: string, quantity: string) => ({
    batchId,
    batchNumber: `LOT-${batchId}`,
    quantity: new Decimal(quantity),
});

const appliedLedgerEntry = (params: {
    id: string;
    batchId?: string;
    quantity?: string;
    createdAt: string;
}) => ({
    id: params.id,
    productId: 'product-a',
    batchId: params.batchId ?? 'batch-a',
    warehouseId: 'warehouse-b',
    quantityDelta: new Decimal(params.quantity ?? '0.2500').negated(),
    createdAt: new Date(params.createdAt),
});

const reserveTx = (options: {
    quantity?: string;
    allowNegativeStock?: boolean;
    warehouseId?: string;
} = {}) => {
    const item = pedidoItem(options.quantity);
    const pedido = { id: 'pedido-a', tenantId: 'tenant-a', estado: 'pendiente', items: [item] };
    return {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'pedido-a' }]),
        pedido: {
            findFirst: vi.fn().mockResolvedValue(pedido),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findFirstOrThrow: vi.fn().mockResolvedValue({ ...pedido, estado: 'preparando' }),
        },
        trackingEvento: { create: vi.fn().mockResolvedValue({ id: 'event-reserve' }) },
        kardexMovement: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue({ id: 'kardex-reserve' }),
        },
        product: { findMany: vi.fn().mockResolvedValue([trackedProduct()]) },
        tenant: {
            findUnique: vi.fn().mockResolvedValue({
                allowNegativeStock: options.allowNegativeStock ?? false,
            }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-reserve' }) },
        __warehouseId: options.warehouseId ?? 'warehouse-a',
    } as any;
};

const deliveryTx = (options: {
    reserved?: boolean;
    warehouseId?: string | null;
} = {}) => {
    const item = pedidoItem();
    const pedido = {
        id: 'pedido-a',
        tenantId: 'tenant-a',
        clienteNombre: 'Cliente Uno',
        total: { toString: () => '7.50' },
        costoEntrega: { toString: () => '0' },
        items: [item],
    };
    const reservations = options.reserved
        ? [{
            id: 'reservation-kardex-a',
            productId: 'product-a',
            quantity: -0.75,
            batchId: 'batch-a',
            warehouseId: options.warehouseId === undefined ? 'warehouse-a' : options.warehouseId,
        }]
        : [];
    return {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'pedido-a' }]),
        pedido: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findFirst: vi.fn().mockResolvedValue(pedido),
            update: vi.fn().mockResolvedValue({}),
            findFirstOrThrow: vi.fn().mockResolvedValue({ ...pedido, facturaId: 'sale-a' }),
        },
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-active' }) },
        trackingEvento: { create: vi.fn().mockResolvedValue({ id: 'event-delivery' }) },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-delivery' }) },
        product: { findMany: vi.fn().mockResolvedValue([trackedProduct()]) },
        kardexMovement: {
            findMany: vi.fn().mockResolvedValue(reservations),
            create: vi.fn().mockResolvedValue({ id: 'kardex-delivery' }),
        },
        tenant: { findUnique: vi.fn().mockResolvedValue({
            allowNegativeStock: false,
            fiscalRegime: 'GENERAL',
            fiscalRegimeVersion: 2,
        }) },
        sale: { create: vi.fn().mockResolvedValue({ id: 'sale-a' }) },
        saleItem: { create: vi.fn().mockResolvedValue({ id: 'sale-item-a' }) },
        saleItemBatchAllocation: {
            create: vi.fn().mockResolvedValue({ id: 'sale-allocation-a' }),
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        payment: { create: vi.fn().mockResolvedValue({ id: 'payment-a' }) },
        __warehouseId: options.warehouseId ?? 'warehouse-a',
    } as any;
};

const cancellationTx = (options: {
    appliedLocal?: string;
    estado?: string;
    includeRelease?: boolean;
} = {}) => {
    const reservation = {
        id: 'reservation-kardex-a',
        productId: 'product-a',
        quantity: -0.75,
        batchId: 'batch-a',
        warehouseId: 'warehouse-b',
        referenceType: 'PEDIDO_RESERVA',
    };
    const release = {
        id: 'release-kardex-a',
        productId: 'product-a',
        quantity: 0.75,
        batchId: 'batch-a',
        warehouseId: 'warehouse-b',
        referenceType: 'PEDIDO_LIBERACION',
    };
    const pedido = {
        id: 'pedido-a',
        tenantId: 'tenant-a',
        estado: options.estado ?? 'preparando',
        facturaId: null,
        eventos: [{ id: 'prepared-event-a' }],
        items: [pedidoItem()],
    };
    return {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'pedido-a' }]),
        pedido: {
            findFirst: vi.fn().mockResolvedValue(pedido),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findFirstOrThrow: vi.fn().mockResolvedValue({ ...pedido, estado: 'cancelado' }),
        },
        kardexMovement: {
            findMany: vi.fn().mockResolvedValue(options.includeRelease ? [reservation, release] : [reservation]),
            create: vi.fn().mockResolvedValue({ id: 'release-kardex-new' }),
        },
        productBatchLedgerEntry: {
            findMany: vi.fn().mockResolvedValue(options.appliedLocal
                ? [{
                    id: 'ledger-reserve-a',
                    productId: 'product-a',
                    batchId: 'batch-a',
                    warehouseId: 'warehouse-b',
                    quantityDelta: new Decimal(options.appliedLocal).negated(),
                    createdAt: new Date('2026-08-27T00:00:00.000Z'),
                }]
                : []),
        },
        productBatch: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        trackingEvento: { create: vi.fn().mockResolvedValue({ id: 'cancel-event-a' }) },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'cancel-audit-a' }) },
    } as any;
};

beforeEach(() => {
    vi.clearAllMocks();
    resolveBatchWarehouseModeMock.mockResolvedValue('OFF');
    applyBatchWarehouseDeltaMock.mockResolvedValue({
        mode: 'SHADOW',
        status: 'APPLIED',
        applied: true,
        replay: false,
    });
    applyStockDeltaMock.mockImplementation(async (_tx, input) => ({
        stockBefore: 1,
        stockAfter: new Decimal(1).plus(input.delta).toNumber(),
        warehouseId: 'warehouse-a',
    }));
    consumeGlobalFefoMock.mockResolvedValue({
        allocations: [allocation('batch-a', '0.7500')],
        unallocatedQuantity: new Decimal(0),
    });
    consumeWarehouseFefoMock.mockResolvedValue({
        allocations: [allocation('batch-a', '0.7500')],
        unallocatedQuantity: new Decimal(0),
    });
    allocateSaleFefoMock.mockResolvedValue({
        allocations: [allocation('batch-a', '0.7500')],
        unallocatedQuantity: new Decimal(0),
    });
    recordSaleMock.mockResolvedValue(undefined);
});

describe('subledger lote+bodega en fulfillment de pedidos', () => {
    it('OFF conserva la reserva FEFO histórica y el borde exacto 0.0001', async () => {
        const tx = reserveTx({ quantity: '0.0001' });
        applyStockDeltaMock.mockResolvedValue({
            stockBefore: 1,
            stockAfter: 0.9999,
            warehouseId: 'warehouse-a',
        });
        consumeGlobalFefoMock.mockResolvedValue({
            allocations: [allocation('batch-a', '0.0001')],
            unallocatedQuantity: new Decimal(0),
        });

        await reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        });

        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledWith(tx, 'tenant-a');
        expect(consumeGlobalFefoMock).toHaveBeenCalledWith(tx, expect.objectContaining({
            tenantId: 'tenant-a',
            productId: 'product-a',
            quantity: expect.any(Decimal),
        }));
        expect(consumeGlobalFefoMock.mock.calls[0][1].quantity.toFixed(4)).toBe('0.0001');
        expect(consumeWarehouseFefoMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).not.toHaveBeenCalled();
        expect(tx.kardexMovement.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ quantity: -0.0001, batchId: 'batch-a' }),
        }));
    });

    it('SHADOW usa FEFO global y registra APPLIED/GAP sin inventar otro saldo local', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        consumeGlobalFefoMock.mockResolvedValue({
            allocations: [allocation('batch-a', '0.5000'), allocation('batch-b', '0.2500')],
            unallocatedQuantity: new Decimal(0),
        });
        applyBatchWarehouseDeltaMock
            .mockResolvedValueOnce({ status: 'APPLIED', mode: 'SHADOW' })
            .mockResolvedValueOnce({ status: 'SHADOW_GAP', mode: 'SHADOW' });
        const tx = reserveTx({ warehouseId: 'warehouse-b' });
        applyStockDeltaMock.mockResolvedValue({ stockBefore: 4, stockAfter: 3.25, warehouseId: 'warehouse-b' });

        await reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        });

        expect(consumeGlobalFefoMock).toHaveBeenCalledTimes(1);
        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(consumeWarehouseFefoMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).toHaveBeenCalledTimes(2);
        expect(applyBatchWarehouseDeltaMock.mock.calls.map(([input]) => input.delta)).toEqual([
            '-0.5000', '-0.2500',
        ]);
        expect(applyBatchWarehouseDeltaMock.mock.calls.map(([input]) => input.sourceKey)).toEqual([
            'pedido:pedido-a:reserve:item:pedido-item-a:product:product-a:batch:batch-a',
            'pedido:pedido-a:reserve:item:pedido-item-a:product:product-a:batch:batch-b',
        ]);
        expect(applyBatchWarehouseDeltaMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            mode: 'SHADOW',
            warehouseId: 'warehouse-b',
            movementType: 'PEDIDO_RESERVE',
            referenceId: 'pedido-a',
            referenceType: 'PEDIDO',
            userId: 'user-active',
            allowNegative: false,
        }));
    });

    it('replay de reserva ya reclamada no vuelve a resolver modo ni consumir lotes', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        const tx = reserveTx();
        tx.pedido.updateMany.mockResolvedValue({ count: 0 });

        await expect(reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        })).rejects.toMatchObject({ code: 'PEDIDO_ALREADY_PREPARED', httpStatus: 409 });

        expect(resolveBatchWarehouseModeMock).not.toHaveBeenCalled();
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
        expect(consumeGlobalFefoMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).not.toHaveBeenCalled();
    });

    it('dos líneas del mismo producto/lote usan sourceKeys distintos por PedidoItem', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        const tx = reserveTx({ quantity: '0.5000' });
        const first = pedidoItem('0.5000');
        const second = { ...pedidoItem('0.5000'), id: 'pedido-item-b' };
        tx.pedido.findFirst.mockResolvedValue({
            id: 'pedido-a', tenantId: 'tenant-a', estado: 'pendiente', items: [second, first],
        });
        applyStockDeltaMock
            .mockResolvedValueOnce({ stockBefore: 2, stockAfter: 1.5, warehouseId: 'warehouse-a' })
            .mockResolvedValueOnce({ stockBefore: 1.5, stockAfter: 1, warehouseId: 'warehouse-a' });
        consumeGlobalFefoMock.mockResolvedValue({
            allocations: [allocation('batch-a', '0.5000')],
            unallocatedQuantity: new Decimal(0),
        });

        await reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        });

        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(applyBatchWarehouseDeltaMock.mock.calls.map(([input]) => input.sourceKey)).toEqual([
            'pedido:pedido-a:reserve:item:pedido-item-a:product:product-a:batch:batch-a',
            'pedido:pedido-a:reserve:item:pedido-item-b:product:product-a:batch:batch-a',
        ]);
        expect(new Set(applyBatchWarehouseDeltaMock.mock.calls.map(([input]) => input.sourceKey)).size).toBe(2);
    });

    it('ENFORCED consume FEFO en la bodega real aunque el tenant permita negativo global', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('ENFORCED');
        const tx = reserveTx({ allowNegativeStock: true, warehouseId: 'warehouse-b' });
        applyStockDeltaMock.mockResolvedValue({ stockBefore: 2, stockAfter: 1.25, warehouseId: 'warehouse-b' });

        await reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        });

        expect(applyStockDeltaMock).toHaveBeenCalledWith(tx, expect.objectContaining({
            enforceSufficient: true,
        }));
        expect(consumeWarehouseFefoMock).toHaveBeenCalledTimes(1);
        expect(consumeWarehouseFefoMock).toHaveBeenCalledWith(tx, expect.objectContaining({
            tenantId: 'tenant-a',
            productId: 'product-a',
            context: expect.objectContaining({
                mode: 'ENFORCED',
                warehouseId: 'warehouse-b',
                userId: 'user-active',
                movementType: 'PEDIDO_RESERVE',
                sourceKeyPrefix: 'pedido:pedido-a:reserve:item:pedido-item-a:product:product-a',
            }),
        }));
        expect(consumeGlobalFefoMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).not.toHaveBeenCalled();
    });

    it.each(['local', 'global'])('ENFORCED propaga falta %s antes de Kardex para rollback', async (scope) => {
        resolveBatchWarehouseModeMock.mockResolvedValue('ENFORCED');
        consumeWarehouseFefoMock.mockRejectedValue(new BatchAllocationError(
            'INSUFFICIENT_ACTIVE_BATCH_STOCK',
            `Stock ${scope} insuficiente`,
            409,
        ));
        const tx = reserveTx();

        await expect(reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        })).rejects.toMatchObject({
            code: 'PEDIDO_BATCH_STOCK_INSUFFICIENT',
            httpStatus: 409,
        });

        expect(applyStockDeltaMock).toHaveBeenCalledTimes(1);
        expect(tx.kardexMovement.create).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('un fallo del core SHADOW se propaga y no deja continuar a Kardex', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        applyBatchWarehouseDeltaMock.mockRejectedValue(new BatchWarehouseLedgerError(
            'BATCH_WAREHOUSE_LEDGER_CORRUPT',
            500,
            'Ledger inconsistente',
        ));
        const tx = reserveTx();

        await expect(reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        })).rejects.toMatchObject({
            code: 'PEDIDO_BATCH_WAREHOUSE_CONFLICT',
            httpStatus: 500,
        });
        expect(consumeGlobalFefoMock).toHaveBeenCalledTimes(1);
        expect(applyBatchWarehouseDeltaMock).toHaveBeenCalledTimes(1);
        expect(tx.kardexMovement.create).not.toHaveBeenCalled();
    });

    it('entrega sin reserva consume PEDIDO_DELIVERY; entrega reservada nunca consume dos veces', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        const unreserved = deliveryTx({ reserved: false, warehouseId: 'warehouse-b' });
        applyStockDeltaMock.mockResolvedValue({ stockBefore: 3, stockAfter: 2.25, warehouseId: 'warehouse-b' });

        await completePedidoDeliveryInTransaction(unreserved, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            actorUserId: 'user-active',
            source: 'DELIVERY_DASHBOARD',
        });

        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(applyStockDeltaMock).toHaveBeenCalledTimes(1);
        expect(applyBatchWarehouseDeltaMock).toHaveBeenCalledWith(expect.objectContaining({
            movementType: 'PEDIDO_DELIVERY',
            warehouseId: 'warehouse-b',
            delta: '-0.7500',
            sourceKey: 'pedido:pedido-a:delivery:item:pedido-item-a:product:product-a:batch:batch-a',
        }));
        expect(unreserved.saleItemBatchAllocation.createMany).toHaveBeenCalledWith({
            data: [{
                tenantId: 'tenant-a',
                saleItemId: 'sale-item-a',
                batchId: 'batch-a',
                warehouseId: 'warehouse-b',
                quantity: '0.7500',
            }],
        });

        vi.clearAllMocks();
        recordSaleMock.mockResolvedValue(undefined);
        const reserved = deliveryTx({ reserved: true });
        await completePedidoDeliveryInTransaction(reserved, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            actorUserId: 'user-active',
            source: 'DELIVERY_DASHBOARD',
        });

        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledWith(reserved, 'tenant-a');
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
        expect(consumeGlobalFefoMock).not.toHaveBeenCalled();
        expect(consumeWarehouseFefoMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).not.toHaveBeenCalled();
        expect(reserved.saleItemBatchAllocation.create).toHaveBeenCalledTimes(1);
        expect(reserved.saleItemBatchAllocation.create).toHaveBeenCalledWith({
            data: {
                tenantId: 'tenant-a',
                saleItemId: 'sale-item-a',
                batchId: 'batch-a',
                warehouseId: 'warehouse-a',
                quantity: '0.7500',
            },
        });
    });

    it('ENFORCED rechaza una reserva legacy sin bodega antes de crear venta o dinero', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('ENFORCED');
        const tx = deliveryTx({ reserved: true, warehouseId: null });

        await expect(completePedidoDeliveryInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            actorUserId: 'user-active',
            source: 'DELIVERY_DASHBOARD',
        })).rejects.toMatchObject({
            code: 'PEDIDO_BATCH_RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });

        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledWith(tx, 'tenant-a');
        expect(tx.sale.create).not.toHaveBeenCalled();
        expect(tx.saleItem.create).not.toHaveBeenCalled();
        expect(tx.saleItemBatchAllocation.create).not.toHaveBeenCalled();
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
        expect(tx.payment.create).not.toHaveBeenCalled();
        expect(recordSaleMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).not.toHaveBeenCalled();
    });

    it('ENFORCED conserva la autoridad del batchId histórico aunque el flag actual esté apagado', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('ENFORCED');
        const tx = deliveryTx({ reserved: true, warehouseId: null });
        tx.product.findMany.mockResolvedValue([{
            ...trackedProduct(),
            requiresBatchTracking: false,
        }]);

        await expect(completePedidoDeliveryInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            actorUserId: 'user-active',
            source: 'DELIVERY_DASHBOARD',
        })).rejects.toMatchObject({
            code: 'PEDIDO_BATCH_RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });

        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledWith(tx, 'tenant-a');
        expect(tx.sale.create).not.toHaveBeenCalled();
        expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('SHADOW audita una reserva completa sin bodega sin volver a consumir stock', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        const tx = deliveryTx({ reserved: true, warehouseId: null });

        await completePedidoDeliveryInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            actorUserId: 'user-active',
            source: 'DELIVERY_DASHBOARD',
        });

        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
        expect(consumeGlobalFefoMock).not.toHaveBeenCalled();
        expect(consumeWarehouseFefoMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).not.toHaveBeenCalled();
        expect(tx.saleItemBatchAllocation.create).toHaveBeenCalledWith({
            data: {
                tenantId: 'tenant-a',
                saleItemId: 'sale-item-a',
                batchId: 'batch-a',
                warehouseId: null,
                quantity: '0.7500',
            },
        });
        expect(tx.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: 'tenant-a',
                userId: 'user-active',
                action: 'PEDIDO_BATCH_RECONCILIATION_REQUIRED',
                details: expect.stringContaining('"missingWarehouseQuantity":"0.7500"'),
            }),
        });
    });

    it('cancel restaura global completo pero local solo lo APPLIED, nunca el gap SHADOW', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        const tx = cancellationTx({ appliedLocal: '0.5000' });
        applyStockDeltaMock.mockResolvedValue({ stockBefore: 5, stockAfter: 5.75, warehouseId: 'warehouse-b' });

        const result = await cancelPedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        });

        expect(result).toMatchObject({ idempotentReplay: false, releasedQuantity: '0.7500' });
        expect(resolveBatchWarehouseModeMock).toHaveBeenCalledTimes(1);
        expect(tx.productBatchLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: 'tenant-a',
                referenceId: 'pedido-a',
                movementType: 'PEDIDO_RESERVE',
                status: 'APPLIED',
            }),
            take: expect.any(Number),
        }));
        expect(tx.productBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { stock: { increment: 0.75 } },
        }));
        expect(applyBatchWarehouseDeltaMock).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'SHADOW',
            movementType: 'PEDIDO_CANCEL',
            warehouseId: 'warehouse-b',
            delta: '0.5000',
            sourceKey: 'pedido:pedido-a:cancel:movement:reservation-kardex-a:batch:batch-a',
            userId: 'user-active',
        }));
        expect(tx.kardexMovement.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ quantity: 0.75, batchId: 'batch-a' }),
        }));
    });

    it('cancel pagina todas las reservas APPLIED y restaura toda la suma local', async () => {
        resolveBatchWarehouseModeMock.mockResolvedValue('SHADOW');
        const tx = cancellationTx();
        tx.kardexMovement.findMany.mockResolvedValue([
            {
                id: 'reservation-kardex-a',
                productId: 'product-a',
                quantity: -0.75,
                batchId: 'batch-a',
                warehouseId: 'warehouse-b',
                referenceType: 'PEDIDO_RESERVA',
            },
        ]);
        tx.productBatchLedgerEntry.findMany = vi.fn()
            .mockResolvedValueOnce([
                ...Array.from({ length: 4_999 }, (_, index) => appliedLedgerEntry({
                    id: `ledger-${String(index).padStart(4, '0')}`,
                    createdAt: '2026-08-27T00:00:00.000Z',
                    quantity: '0.0000',
                })),
                appliedLedgerEntry({
                    id: 'ledger-4999',
                    createdAt: '2026-08-27T00:00:00.000Z',
                    quantity: '0.5000',
                }),
            ])
            .mockResolvedValueOnce([
                appliedLedgerEntry({
                    id: 'ledger-5000',
                    createdAt: '2026-08-27T00:00:01.000Z',
                    quantity: '0.2500',
                }),
            ]);
        applyStockDeltaMock.mockResolvedValue({ stockBefore: 5, stockAfter: 5.75, warehouseId: 'warehouse-b' });

        const result = await cancelPedidoInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            userId: 'user-active',
        });

        expect(result).toMatchObject({ idempotentReplay: false, releasedQuantity: '0.7500' });
        expect(tx.productBatchLedgerEntry.findMany).toHaveBeenCalledTimes(2);
        expect(tx.productBatchLedgerEntry.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({
                tenantId: 'tenant-a',
                referenceId: 'pedido-a',
                movementType: 'PEDIDO_RESERVE',
                status: 'APPLIED',
            }),
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 5_000,
        }));
        expect(tx.productBatchLedgerEntry.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({
                tenantId: 'tenant-a',
                referenceId: 'pedido-a',
                movementType: 'PEDIDO_RESERVE',
                status: 'APPLIED',
                OR: [
                    { createdAt: { gt: new Date('2026-08-27T00:00:00.000Z') } },
                    { createdAt: new Date('2026-08-27T00:00:00.000Z'), id: { gt: 'ledger-4999' } },
                ],
            }),
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 5_000,
        }));
        expect(applyBatchWarehouseDeltaMock).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'SHADOW',
            movementType: 'PEDIDO_CANCEL',
            warehouseId: 'warehouse-b',
            delta: '0.7500',
            sourceKey: 'pedido:pedido-a:cancel:movement:reservation-kardex-a:batch:batch-a',
            userId: 'user-active',
        }));
    });

    it('replay de cancelación completa no resuelve modo ni vuelve a tocar sidecar', async () => {
        const tx = cancellationTx({ estado: 'cancelado', includeRelease: true });

        const result = await cancelPedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-active',
        });

        expect(result.idempotentReplay).toBe(true);
        expect(resolveBatchWarehouseModeMock).not.toHaveBeenCalled();
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
        expect(applyBatchWarehouseDeltaMock).not.toHaveBeenCalled();
    });
});
