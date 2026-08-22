import { describe, expect, it, vi } from 'vitest';

const applyStockDeltaMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/services/stockService.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/stockService.js')>()),
    applyStockDelta: applyStockDeltaMock,
}));

import {
    cancelPedidoInTransaction,
    claimPedidoDelivery,
    isCompletePedidoReservationRelease,
    lockPedidoForFulfillment,
    validatePedidoReservationTotals,
} from '../backend/services/pedidoFulfillmentService';

const pedidoLockMock = () => vi.fn().mockResolvedValue([{ id: 'pedido-a' }]);

describe('fulfillment autoritativo de Pedido', () => {
    it('un reintento de entrega no puede reclamar ni facturar el pedido dos veces', async () => {
        const updateMany = vi.fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });
        const tx = { $queryRaw: pedidoLockMock(), pedido: { updateMany } } as any;

        await claimPedidoDelivery(tx, { pedidoId: 'pedido-a', tenantId: 'tenant-a' });
        await expect(claimPedidoDelivery(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
        })).rejects.toMatchObject({
            code: 'PEDIDO_ALREADY_PROCESSED',
            httpStatus: 409,
        });

        expect(updateMany).toHaveBeenCalledTimes(2);
        expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 'pedido-a',
                tenantId: 'tenant-a',
                facturaId: null,
            }),
        }));
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
            updateMany.mock.invocationCallOrder[0],
        );
    });

    it('serializa dos entregas concurrentes: la segunda espera el row-lock y pierde el claim', async () => {
        let locked = false;
        const waiters: Array<() => void> = [];
        const acquire = async () => {
            if (!locked) {
                locked = true;
                return;
            }
            await new Promise<void>((resolve) => waiters.push(resolve));
            locked = true;
        };
        const release = () => {
            locked = false;
            waiters.shift()?.();
        };
        let estado = 'pendiente';
        const transaction = () => ({
            $queryRaw: vi.fn(async () => {
                await acquire();
                return [{ id: 'pedido-a' }];
            }),
            pedido: {
                updateMany: vi.fn(async () => {
                    if (estado !== 'pendiente') return { count: 0 };
                    estado = 'entregado';
                    return { count: 1 };
                }),
            },
        }) as any;
        const firstTx = transaction();
        const secondTx = transaction();

        const first = claimPedidoDelivery(firstTx, { pedidoId: 'pedido-a', tenantId: 'tenant-a' });
        await first;
        const second = claimPedidoDelivery(secondTx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a',
        }).then(() => null, (error) => error);

        await Promise.resolve();
        expect(secondTx.pedido.updateMany).not.toHaveBeenCalled();
        release();
        expect(await second).toMatchObject({ code: 'PEDIDO_ALREADY_PROCESSED', httpStatus: 409 });
        release();
    });

    it('falla cerrado si el row-lock no encuentra pedido dentro del tenant', async () => {
        const tx = { $queryRaw: vi.fn().mockResolvedValue([]) } as any;

        await expect(lockPedidoForFulfillment(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
        })).rejects.toMatchObject({ code: 'PEDIDO_NOT_FOUND', httpStatus: 404 });
    });

    it('valida la reserva agregada de BASE + PACK del mismo SKU con cantidad exacta', () => {
        expect(() => validatePedidoReservationTotals([
            { productoId: 'product-a', cantidad: 100, cantidadExact: { toString: () => '100' } },
            { productoId: 'product-a', cantidad: 4, cantidadExact: { toString: () => '3.5' } },
        ], [
            { productId: 'product-a', quantity: -100 },
            { productId: 'product-a', quantity: -3.5 },
        ])).not.toThrow();
    });

    it('rechaza una reserva parcial o de otro producto', () => {
        expect(() => validatePedidoReservationTotals([
            { productoId: 'product-a', cantidad: 1, cantidadExact: { toString: () => '0.75' } },
        ], [
            { productId: 'product-a', quantity: -0.5 },
        ])).toThrowError(expect.objectContaining({ code: 'PEDIDO_RESERVATION_MISMATCH' }));

        expect(() => validatePedidoReservationTotals([
            { productoId: 'product-a', cantidad: 1, cantidadExact: { toString: () => '0.75' } },
        ], [
            { productId: 'product-a', quantity: -0.75 },
            { productId: 'product-b', quantity: -1 },
        ])).toThrowError(expect.objectContaining({ code: 'PEDIDO_RESERVATION_MISMATCH' }));
    });

    it('cancelar preparado restaura cantidad exacta, bodega y lote una sola vez', async () => {
        applyStockDeltaMock.mockReset();
        applyStockDeltaMock.mockResolvedValue({
            stockBefore: 5,
            stockAfter: 5.75,
            warehouseId: 'warehouse-a',
        });
        const pedido = {
            id: 'pedido-a',
            tenantId: 'tenant-a',
            estado: 'preparando',
            facturaId: null,
            eventos: [{ id: 'prepared-event-a' }],
            items: [{
                productoId: 'product-a',
                cantidad: 1,
                cantidadExact: { toString: () => '0.75' },
            }],
        };
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                findFirst: vi.fn().mockResolvedValue(pedido),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                findFirstOrThrow: vi.fn().mockResolvedValue({ ...pedido, estado: 'cancelado' }),
            },
            kardexMovement: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 'reservation-a',
                    productId: 'product-a',
                    quantity: -0.75,
                    batchId: 'batch-a',
                    warehouseId: 'warehouse-a',
                    referenceType: 'PEDIDO_RESERVA',
                }]),
                create: vi.fn().mockResolvedValue({ id: 'release-a' }),
            },
            productBatch: {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            trackingEvento: { create: vi.fn().mockResolvedValue({}) },
            auditLog: { create: vi.fn().mockResolvedValue({}) },
        } as any;

        const result = await cancelPedidoInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            userId: 'user-a',
        });

        expect(result).toMatchObject({ idempotentReplay: false, releasedQuantity: '0.7500' });
        expect(applyStockDeltaMock).toHaveBeenCalledWith(tx, expect.objectContaining({
            tenantId: 'tenant-a',
            productId: 'product-a',
            delta: 0.75,
            warehouseId: 'warehouse-a',
        }));
        expect(tx.productBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'batch-a', tenantId: 'tenant-a', productId: 'product-a' },
            data: { stock: { increment: 0.75 } },
        }));
        expect(tx.kardexMovement.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                referenceType: 'PEDIDO_LIBERACION',
                quantity: 0.75,
                batchId: 'batch-a',
                warehouseId: 'warehouse-a',
            }),
        }));
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
            tx.pedido.findFirst.mock.invocationCallOrder[0],
        );
    });

    it('replay de cancelación no vuelve a tocar stock ni lotes', async () => {
        applyStockDeltaMock.mockReset();
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                findFirst: vi.fn().mockResolvedValue({
                    id: 'pedido-a', tenantId: 'tenant-a', estado: 'cancelado', facturaId: null, items: [], eventos: [],
                }),
            },
            kardexMovement: { findMany: vi.fn().mockResolvedValue([]) },
        } as any;

        const result = await cancelPedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-a',
        });

        expect(result.idempotentReplay).toBe(true);
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
    });

    it('bloquea cancelación preparada sin evidencia o con lote cross-tenant', async () => {
        const pedido = {
            id: 'pedido-a', tenantId: 'tenant-a', estado: 'preparando', facturaId: null,
            eventos: [{ id: 'prepared-event-a' }],
            items: [{ productoId: 'product-a', cantidad: 1, cantidadExact: { toString: () => '0.75' } }],
        };
        const noEvidence = {
            $queryRaw: pedidoLockMock(),
            pedido: { findFirst: vi.fn().mockResolvedValue(pedido) },
            kardexMovement: { findMany: vi.fn().mockResolvedValue([]) },
        } as any;
        await expect(cancelPedidoInTransaction(noEvidence, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-a',
        })).rejects.toMatchObject({ code: 'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED' });

        applyStockDeltaMock.mockResolvedValue({ stockBefore: 5, stockAfter: 5.75, warehouseId: 'warehouse-a' });
        const crossTenantBatch = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                findFirst: vi.fn().mockResolvedValue(pedido),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            kardexMovement: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 'reservation-a', productId: 'product-a', quantity: -0.75,
                    batchId: 'foreign-batch', warehouseId: 'warehouse-a',
                    referenceType: 'PEDIDO_RESERVA',
                }]),
            },
            productBatch: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        } as any;
        await expect(cancelPedidoInTransaction(crossTenantBatch, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-a',
        })).rejects.toMatchObject({ code: 'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED' });
        expect(crossTenantBatch.productBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: 'tenant-a', productId: 'product-a' }),
        }));
    });

    it('solo trata como replay cancelado una liberación completa y exacta', () => {
        const reservation = {
            id: 'reservation-a', productId: 'product-a', quantity: -0.75,
            batchId: 'batch-a', warehouseId: 'warehouse-a', referenceType: 'PEDIDO_RESERVA' as const,
        };
        const release = {
            id: 'release-a', productId: 'product-a', quantity: 0.75,
            batchId: 'batch-a', warehouseId: 'warehouse-a', referenceType: 'PEDIDO_LIBERACION' as const,
        };
        expect(isCompletePedidoReservationRelease([reservation], [release])).toBe(true);
        expect(isCompletePedidoReservationRelease([reservation], [{ ...release, quantity: 0.5 }])).toBe(false);
        expect(isCompletePedidoReservationRelease([reservation], [{
            ...release,
            batchId: 'foreign-batch',
        }])).toBe(false);
    });

    it('no oculta un pedido ya cancelado que todavía conserva reserva', async () => {
        applyStockDeltaMock.mockReset();
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                findFirst: vi.fn().mockResolvedValue({
                    id: 'pedido-a', tenantId: 'tenant-a', estado: 'cancelado', facturaId: null,
                    items: [], eventos: [{ id: 'prepared-event-a' }],
                }),
            },
            kardexMovement: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 'reservation-a', productId: 'product-a', quantity: -0.75,
                    batchId: 'batch-a', warehouseId: 'warehouse-a', referenceType: 'PEDIDO_RESERVA',
                }]),
            },
        } as any;

        await expect(cancelPedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-a',
        })).rejects.toMatchObject({ code: 'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED' });
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
    });
});
