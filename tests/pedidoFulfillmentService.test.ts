import { describe, expect, it, vi } from 'vitest';

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

import {
    cancelPedidoInTransaction,
    claimPedidoDelivery,
    completePedidoDeliveryInTransaction,
    isCompletePedidoReservationRelease,
    lockPedidoForFulfillment,
    reservePedidoInTransaction,
    validatePedidoReservationTotals,
} from '../backend/services/pedidoFulfillmentService';

const pedidoLockMock = () => vi.fn().mockResolvedValue([{ id: 'pedido-a' }]);

describe('fulfillment autoritativo de Pedido', () => {
    it('congela CUOTA_FIJA y registra cero IVA al facturar una entrega', async () => {
        applyStockDeltaMock.mockReset();
        recordSaleMock.mockReset();
        applyStockDeltaMock.mockResolvedValue({
            stockBefore: 10,
            stockAfter: 9,
            warehouseId: 'warehouse-a',
        });
        recordSaleMock.mockResolvedValue(undefined);
        const pedido = {
            id: 'pedido-a',
            tenantId: 'tenant-a',
            clienteNombre: 'Cliente Uno',
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
                productNameAtOrder: 'Producto Uno',
                unitAtOrder: 'unidad',
                saleModeAtOrder: 'COUNTED',
                quantityStepAtOrder: { toString: () => '1' },
                unitPriceExactAtOrder: { toString: () => '115' },
                ivaExentoAtOrder: false,
                precioUnitario: { toString: () => '115' },
                subtotal: { toString: () => '115' },
            }],
        };
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                findFirst: vi.fn().mockResolvedValue(pedido),
                update: vi.fn().mockResolvedValue({}),
                findFirstOrThrow: vi.fn().mockResolvedValue({ ...pedido, facturaId: 'sale-a' }),
            },
            user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a' }) },
            trackingEvento: { create: vi.fn().mockResolvedValue({}) },
            auditLog: { create: vi.fn().mockResolvedValue({}) },
            product: { findMany: vi.fn().mockResolvedValue([{
                id: 'product-a',
                name: 'Producto Uno',
                unit: 'unidad',
                cost: 60,
                ivaExento: false,
                saleMode: 'COUNTED',
                quantityStep: { toString: () => '1' },
                requiresBatchTracking: false,
            }]) },
            kardexMovement: {
                findMany: vi.fn().mockResolvedValue([]),
                create: vi.fn().mockResolvedValue({}),
            },
            tenant: { findUnique: vi.fn().mockResolvedValue({
                allowNegativeStock: false,
                fiscalRegime: 'CUOTA_FIJA',
                fiscalRegimeVersion: 4,
            }) },
            sale: { create: vi.fn().mockResolvedValue({ id: 'sale-a' }) },
            saleItem: { create: vi.fn().mockResolvedValue({ id: 'sale-item-a' }) },
            payment: { create: vi.fn().mockResolvedValue({}) },
        } as any;

        await completePedidoDeliveryInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            actorUserId: 'user-a',
            auditUserId: 'user-a',
            source: 'DELIVERY_DASHBOARD',
        });

        expect(tx.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: 'tenant-a' },
            select: {
                allowNegativeStock: true,
                fiscalRegime: true,
                fiscalRegimeVersion: true,
            },
        });
        expect(tx.sale.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: 'tenant-a',
                total: '115.0000',
                exemptTotal: '0.00',
                fiscalRegimeAtSale: 'CUOTA_FIJA',
                fiscalRegimeVersionAtSale: 4,
                vatAmountAtSale: '0.0000',
            }),
        });
        const recordArgs = recordSaleMock.mock.calls[0];
        expect(recordArgs.slice(0, 4)).toEqual([tx, 'tenant-a', 'user-a', 'sale-a']);
        expect(recordArgs[4].toString()).toBe('115');
        expect(recordArgs[5]).toBe(60);
        expect(recordArgs[6]).toBe('CASH');
        expect(recordArgs[7]).toBe(0);
        expect(recordArgs[8].fiscalRegime).toBe('CUOTA_FIJA');
        expect(recordArgs[8].vatAmount.toFixed(4)).toBe('0.0000');
    });

    it('un reintento de entrega no puede reclamar ni facturar el pedido dos veces', async () => {
        const updateMany = vi.fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                updateMany,
                findFirst: vi.fn().mockResolvedValue({ estado: 'entregado', facturaId: 'sale-a' }),
            },
        } as any;

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
        let estado = 'preparando';
        const transaction = () => ({
            $queryRaw: vi.fn(async () => {
                await acquire();
                return [{ id: 'pedido-a' }];
            }),
            pedido: {
                updateMany: vi.fn(async () => {
                    if (estado !== 'preparando') return { count: 0 };
                    estado = 'entregado';
                    return { count: 1 };
                }),
                findFirst: vi.fn(async () => ({
                    estado,
                    facturaId: estado === 'entregado' ? 'sale-a' : null,
                })),
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

    it.each(['preparando', 'en_tienda', 'en_ruta', 'en_camino', 'en_punto'])(
        'permite reclamar entrega desde %s con tenant y estado en el mismo update condicional',
        async (estado) => {
            const updateMany = vi.fn(async ({ where }) => ({
                count: where.estado.in.includes(estado) ? 1 : 0,
            }));
            const tx = {
                $queryRaw: pedidoLockMock(),
                pedido: { updateMany, findFirst: vi.fn() },
            } as any;

            await claimPedidoDelivery(tx, { pedidoId: 'pedido-a', tenantId: 'tenant-a' });

            expect(updateMany).toHaveBeenCalledWith({
                where: {
                    id: 'pedido-a',
                    tenantId: 'tenant-a',
                    facturaId: null,
                    estado: {
                        in: ['preparando', 'en_tienda', 'en_ruta', 'en_camino', 'en_punto'],
                    },
                },
                data: { estado: 'entregado', entregadoAt: expect.any(Date) },
            });
            expect(tx.pedido.findFirst).not.toHaveBeenCalled();
        },
    );

    it.each(['pendiente', 'asignado'])(
        'rechaza entrega directa desde %s sin facturar ni cambiar el estado',
        async (estado) => {
            const tx = {
                $queryRaw: pedidoLockMock(),
                pedido: {
                    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
                    findFirst: vi.fn().mockResolvedValue({ estado, facturaId: null }),
                },
            } as any;

            await expect(claimPedidoDelivery(tx, {
                pedidoId: 'pedido-a',
                tenantId: 'tenant-a',
            })).rejects.toMatchObject({
                code: 'PEDIDO_INVALID_STATE_TRANSITION',
                httpStatus: 409,
            });

            expect(tx.pedido.findFirst).toHaveBeenCalledWith({
                where: { id: 'pedido-a', tenantId: 'tenant-a' },
                select: { estado: true, facturaId: true },
            });
        },
    );

    it('complete falla antes de facturar si un cliente intenta entregar un pedido pendiente', async () => {
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                updateMany: vi.fn().mockResolvedValue({ count: 0 }),
                findFirst: vi.fn().mockResolvedValue({ estado: 'pendiente', facturaId: null }),
            },
            sale: { create: vi.fn() },
            payment: { create: vi.fn() },
        } as any;

        await expect(completePedidoDeliveryInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            actorUserId: 'user-a',
            source: 'DELIVERY_DASHBOARD',
        })).rejects.toMatchObject({
            code: 'PEDIDO_INVALID_STATE_TRANSITION',
            httpStatus: 409,
        });
        expect(tx.sale.create).not.toHaveBeenCalled();
        expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it.each(['pendiente', 'asignado'])(
        'reserva stock solo al preparar desde %s',
        async (estado) => {
            const pedido = {
                id: 'pedido-a',
                tenantId: 'tenant-a',
                estado,
                facturaId: null,
                items: [],
            };
            const updateMany = vi.fn(async ({ where }) => ({
                count: where.estado.in.includes(estado) ? 1 : 0,
            }));
            const tx = {
                $queryRaw: pedidoLockMock(),
                pedido: {
                    findFirst: vi.fn().mockResolvedValue(pedido),
                    updateMany,
                    findFirstOrThrow: vi.fn().mockResolvedValue({ ...pedido, estado: 'preparando' }),
                },
                trackingEvento: { create: vi.fn().mockResolvedValue({}) },
                kardexMovement: {
                    count: vi.fn().mockResolvedValue(0),
                    create: vi.fn(),
                },
                product: { findMany: vi.fn().mockResolvedValue([]) },
                tenant: { findUnique: vi.fn().mockResolvedValue({ allowNegativeStock: false }) },
                auditLog: { create: vi.fn() },
            } as any;

            await reservePedidoInTransaction(tx, {
                pedidoId: 'pedido-a',
                tenantId: 'tenant-a',
                userId: 'user-a',
            });

            expect(tx.pedido.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 'pedido-a',
                    tenantId: 'tenant-a',
                    facturaId: null,
                    estado: { in: ['pendiente', 'asignado'] },
                },
                data: { estado: 'preparando' },
            });
            expect(tx.trackingEvento.create).toHaveBeenCalledTimes(1);
        },
    );

    it('conserva el error idempotente al volver a preparar un pedido preparado', async () => {
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                findFirst: vi.fn().mockResolvedValue({
                    id: 'pedido-a', tenantId: 'tenant-a', estado: 'preparando', facturaId: null, items: [],
                }),
                updateMany: vi.fn(),
            },
        } as any;

        await expect(reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-a',
        })).rejects.toMatchObject({ code: 'PEDIDO_ALREADY_PREPARED', httpStatus: 409 });
        expect(tx.pedido.updateMany).not.toHaveBeenCalled();
    });

    it.each(['en_tienda', 'en_ruta', 'en_camino', 'en_punto'])(
        'rechaza volver a preparar desde %s sin tocar inventario',
        async (estado) => {
            applyStockDeltaMock.mockClear();
            const tx = {
                $queryRaw: pedidoLockMock(),
                pedido: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: 'pedido-a', tenantId: 'tenant-a', estado, facturaId: null, items: [],
                    }),
                    updateMany: vi.fn(),
                },
            } as any;

            await expect(reservePedidoInTransaction(tx, {
                pedidoId: 'pedido-a', tenantId: 'tenant-a', userId: 'user-a',
            })).rejects.toMatchObject({
                code: 'PEDIDO_INVALID_STATE_TRANSITION',
                httpStatus: 409,
            });
            expect(tx.pedido.updateMany).not.toHaveBeenCalled();
            expect(applyStockDeltaMock).not.toHaveBeenCalled();
        },
    );

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

    it('bloquea reservar desde en_camino aunque el pedido siga abierto', async () => {
        applyStockDeltaMock.mockReset();
        const tx = {
            $queryRaw: pedidoLockMock(),
            pedido: {
                findFirst: vi.fn().mockResolvedValue({
                    id: 'pedido-a',
                    tenantId: 'tenant-a',
                    estado: 'en_camino',
                    facturaId: null,
                    items: [],
                }),
                updateMany: vi.fn(),
            },
        } as any;

        await expect(reservePedidoInTransaction(tx, {
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            userId: 'user-a',
        })).rejects.toMatchObject({
            code: 'PEDIDO_INVALID_STATE_TRANSITION',
            httpStatus: 409,
        });
        expect(tx.pedido.updateMany).not.toHaveBeenCalled();
        expect(applyStockDeltaMock).not.toHaveBeenCalled();
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
