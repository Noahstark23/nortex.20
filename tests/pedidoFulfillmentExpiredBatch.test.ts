import { afterEach, describe, expect, it, vi } from 'vitest';

const applyStockDeltaMock = vi.hoisted(() => vi.fn());
const recordSaleMock = vi.hoisted(() => vi.fn());
const resolveBatchWarehouseLedgerModeMock = vi.hoisted(() => vi.fn(async () => 'OFF'));
const applyBatchWarehouseDeltaMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/services/stockService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/stockService.js')>()),
    applyStockDelta: applyStockDeltaMock,
}));

vi.mock('../backend/services/accounting.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/accounting.js')>()),
    recordSale: recordSaleMock,
}));

vi.mock('../backend/services/productBatchWarehouseLedgerService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/productBatchWarehouseLedgerService.js')>()),
    resolveBatchWarehouseLedgerMode: resolveBatchWarehouseLedgerModeMock,
    applyBatchWarehouseDelta: applyBatchWarehouseDeltaMock,
}));

import { completePedidoDeliveryInTransaction } from '../backend/services/pedidoFulfillmentService';

/**
 * La reserva de un pedido elige lote vigente con el corte FEFO del día en que
 * se reserva. Entre reservar y entregar pasan días reales, y la entrega reusaba
 * ese lote sin volver a mirarlo: un lote que vencía en el medio se despachaba
 * igual y quedaba registrado como una venta FEFO normal.
 *
 * Estas pruebas fijan la DECISIÓN dada la fila que devuelve la base. Que el
 * corte civil de Managua sea el correcto lo prueba `batchExpiryPolicy.test.ts`
 * sobre la función pura compartida, y que MySQL realmente excluya el lote
 * vencido lo prueba el circuito de integración: acá no se finge ninguna de las
 * dos cosas.
 */
const pedidoConReserva = () => ({
    id: 'pedido-a',
    tenantId: 'tenant-a',
    clienteNombre: 'Doña Chepita',
    total: { toString: () => '115' },
    costoEntrega: { toString: () => '0' },
    items: [{
        id: 'item-a',
        pedidoId: 'pedido-a',
        productoId: 'product-a',
        cantidad: 1,
        cantidadExact: { toString: () => '1' },
        presentationAtSale: 'BASE',
        presentationQuantityAtSale: { toString: () => '1' },
        productNameAtOrder: 'Acetaminofén 500mg',
        unitAtOrder: 'tableta',
        saleModeAtOrder: 'COUNTED',
        quantityStepAtOrder: { toString: () => '1' },
        unitPriceExactAtOrder: { toString: () => '115' },
        ivaExentoAtOrder: false,
        precioUnitario: { toString: () => '115' },
        subtotal: { toString: () => '115' },
    }],
});

const txConLotes = (batchesVencidos: Array<{
    batchNumber: string;
    expiryDate: Date;
}>) => {
    const pedido = pedidoConReserva();
    return {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'pedido-a' }]),
        pedido: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findFirst: vi.fn().mockResolvedValue(pedido),
            update: vi.fn().mockResolvedValue({}),
            findFirstOrThrow: vi.fn().mockResolvedValue({ ...pedido, facturaId: 'sale-a' }),
        },
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a' }) },
        trackingEvento: { create: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
        product: {
            findMany: vi.fn().mockResolvedValue([{
                id: 'product-a',
                name: 'Acetaminofén 500mg',
                unit: 'tableta',
                cost: 60,
                ivaExento: false,
                saleMode: 'COUNTED',
                quantityStep: { toString: () => '1' },
                requiresBatchTracking: true,
            }]),
        },
        kardexMovement: {
            findMany: vi.fn().mockResolvedValue([{
                id: 'reservation-a',
                productId: 'product-a',
                quantity: -1,
                batchId: 'batch-vencido',
                warehouseId: 'warehouse-a',
            }]),
            create: vi.fn().mockResolvedValue({}),
        },
        productBatch: {
            findMany: vi.fn().mockResolvedValue(
                batchesVencidos.map((batch, index) => ({
                    id: `batch-${index}`,
                    batchNumber: batch.batchNumber,
                    expiryDate: batch.expiryDate,
                })),
            ),
        },
        tenant: {
            findUnique: vi.fn().mockResolvedValue({
                allowNegativeStock: false,
                fiscalRegime: 'GENERAL',
                fiscalRegimeVersion: 4,
            }),
        },
        sale: { create: vi.fn().mockResolvedValue({ id: 'sale-a' }) },
        saleItem: { create: vi.fn().mockResolvedValue({ id: 'sale-item-a' }) },
        saleItemBatchAllocation: { create: vi.fn().mockResolvedValue({}) },
        payment: { create: vi.fn().mockResolvedValue({}) },
    } as any;
};

const entregar = (tx: any) => completePedidoDeliveryInTransaction(tx, {
    pedidoId: 'pedido-a',
    tenantId: 'tenant-a',
    actorUserId: 'user-a',
    auditUserId: 'user-a',
    source: 'DELIVERY_DASHBOARD',
});

describe('entrega de un pedido con lote reservado vencido', () => {
    afterEach(() => {
        vi.useRealTimers();
        applyStockDeltaMock.mockReset();
        recordSaleMock.mockReset();
    });

    it('bloquea la entrega y no factura nada', async () => {
        const tx = txConLotes([
            { batchNumber: 'L-441', expiryDate: new Date('2026-08-01T00:00:00.000Z') },
        ]);

        await expect(entregar(tx)).rejects.toMatchObject({
            code: 'PEDIDO_BATCH_EXPIRED',
            httpStatus: 409,
        });

        // Falla cerrado: ni venta, ni línea, ni evidencia de lote, ni stock.
        expect(tx.sale.create).not.toHaveBeenCalled();
        expect(tx.saleItem.create).not.toHaveBeenCalled();
        expect(tx.saleItemBatchAllocation.create).not.toHaveBeenCalled();
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
        expect(recordSaleMock).not.toHaveBeenCalled();
    });

    it('nombra el lote y su fecha de vencimiento en el mensaje', async () => {
        const tx = txConLotes([
            { batchNumber: 'L-441', expiryDate: new Date('2026-08-01T00:00:00.000Z') },
        ]);

        // Quien lee esto está en el mostrador con el pedido en la mano: sin el
        // número de lote no sabe cuál caja apartar.
        await expect(entregar(tx)).rejects.toThrow(/L-441/);
        await expect(entregar(tx)).rejects.toThrow(/01\/08\/2026/);
    });

    it('cuenta el resto en vez de devolver un muro de texto', async () => {
        const tx = txConLotes([
            { batchNumber: 'L-1', expiryDate: new Date('2026-08-01T00:00:00.000Z') },
            { batchNumber: 'L-2', expiryDate: new Date('2026-08-02T00:00:00.000Z') },
            { batchNumber: 'L-3', expiryDate: new Date('2026-08-03T00:00:00.000Z') },
            { batchNumber: 'L-4', expiryDate: new Date('2026-08-04T00:00:00.000Z') },
            { batchNumber: 'L-5', expiryDate: new Date('2026-08-05T00:00:00.000Z') },
        ]);

        await expect(entregar(tx)).rejects.toThrow(/L-1.*L-2.*L-3/);
        await expect(entregar(tx)).rejects.toThrow(/y 2 más/);
        await expect(entregar(tx)).rejects.not.toThrow(/L-4/);
    });

    it('consulta solo los lotes de este pedido y de este negocio', async () => {
        const tx = txConLotes([]);
        await entregar(tx);

        const consulta = tx.productBatch.findMany.mock.calls[0][0];
        expect(consulta.where.tenantId).toBe('tenant-a');
        expect(consulta.where.id).toEqual({ in: ['batch-vencido'] });
    });

    it('corta por el día civil de Managua, no por el reloj UTC', async () => {
        // 05:59 UTC sigue siendo el día anterior en Managua (UTC-6): el corte
        // debe ser el 21, no el 22. Es el mismo borde que ya protege al motor
        // FEFO; acá se prueba que la entrega usa esa misma política.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-22T05:59:59.999Z'));
        const anoche = txConLotes([]);
        await entregar(anoche);
        expect(anoche.productBatch.findMany.mock.calls[0][0].where.expiryDate).toEqual({
            lt: new Date('2026-08-21T00:00:00.000Z'),
        });

        vi.setSystemTime(new Date('2026-08-22T06:00:00.000Z'));
        const manana = txConLotes([]);
        await entregar(manana);
        expect(manana.productBatch.findMany.mock.calls[0][0].where.expiryDate).toEqual({
            lt: new Date('2026-08-22T00:00:00.000Z'),
        });
    });

    it('entrega normal cuando el lote reservado sigue vigente', async () => {
        const tx = txConLotes([]);
        applyStockDeltaMock.mockResolvedValue({
            stockBefore: 10,
            stockAfter: 9,
            warehouseId: 'warehouse-a',
        });
        recordSaleMock.mockResolvedValue(undefined);

        await entregar(tx);

        expect(tx.sale.create).toHaveBeenCalled();
        expect(tx.saleItemBatchAllocation.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                batchId: 'batch-vencido',
                warehouseId: 'warehouse-a',
                quantity: '1.0000',
            }),
        });
    });
});
