import { describe, expect, it } from 'vitest';
import {
    planReturnBatchRestoration,
    ReturnResolutionError,
    type ReturnBatchAllocationSnapshot,
} from '../backend/services/returnService';

const saleItem = { id: 'sale-item-a', productId: 'product-a', quantity: '3.0000' };

const allocation = (
    overrides: Partial<ReturnBatchAllocationSnapshot> = {},
): ReturnBatchAllocationSnapshot => ({
    id: 'allocation-a',
    saleItemId: saleItem.id,
    productId: saleItem.productId,
    batchId: 'batch-a',
    batchNumber: 'LOT-A',
    warehouseId: 'warehouse-a',
    quantity: '3.0000',
    ...overrides,
});

const plan = (overrides: Record<string, unknown> = {}) => planReturnBatchRestoration({
    saleItem,
    requestedQuantity: '1.0000',
    sameProductLineCount: 1,
    requiresBatchTracking: true,
    previousReturns: [],
    allocations: [allocation()],
    ledgerMode: 'SHADOW',
    ...overrides,
} as never);

const captureReturnError = (action: () => unknown): ReturnResolutionError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(ReturnResolutionError);
        expect((error as ReturnResolutionError).name).toBe('ReturnResolutionError');
        return error as ReturnResolutionError;
    }
    throw new Error('Se esperaba ReturnResolutionError');
};

const expectReturnError = (
    action: () => unknown,
    code: string,
    message: string,
): void => {
    expect(captureReturnError(action)).toMatchObject({ code, httpStatus: 409, message });
};

const historyItem = (overrides: Record<string, unknown> = {}) => ({
    saleItemId: saleItem.id,
    productId: saleItem.productId,
    quantity: '1.0000',
    batchRestorations: [],
    ...overrides,
});

describe('mutación: fronteras del plan de restauración', () => {
    it.each([
        ['no decimal', 'bad', 'requestedQuantity no es un decimal válido'],
        ['cero', '0', 'requestedQuantity debe ser positiva y tener hasta cuatro decimales'],
        ['negativa', '-0.0001', 'requestedQuantity debe ser positiva y tener hasta cuatro decimales'],
        ['NaN', 'NaN', 'requestedQuantity debe ser positiva y tener hasta cuatro decimales'],
        ['cinco decimales', '0.00001', 'requestedQuantity debe ser positiva y tener hasta cuatro decimales'],
    ])('rechaza requestedQuantity %s con código y campo exactos', (_title, requestedQuantity, message) => {
        expectReturnError(
            () => plan({ requestedQuantity }),
            'INVALID_RETURN_QUANTITY',
            message,
        );
    });

    it.each([
        ['bad', 'saleItem.quantity no es un decimal válido'],
        ['0', 'saleItem.quantity debe ser positiva y tener hasta cuatro decimales'],
        ['Infinity', 'saleItem.quantity debe ser positiva y tener hasta cuatro decimales'],
        ['1.00001', 'saleItem.quantity debe ser positiva y tener hasta cuatro decimales'],
    ])('rechaza saleItem.quantity inválida %s', (quantity, message) => {
        expectReturnError(
            () => plan({ saleItem: { ...saleItem, quantity } }),
            'RECONCILIATION_REQUIRED',
            message,
        );
    });

    it.each([0, -1, 1.5, Number.NaN])(
        'rechaza sameProductLineCount no entero positivo: %s',
        (sameProductLineCount) => {
            expectReturnError(
                () => plan({ sameProductLineCount }),
                'RECONCILIATION_REQUIRED',
                'La identidad de la línea vendida requiere conciliación',
            );
        },
    );

    it('acepta el borde Decimal .0001 y el conteo mínimo uno', () => {
        const result = plan({
            saleItem: { ...saleItem, quantity: '0.0001' },
            requestedQuantity: '0.0001',
            sameProductLineCount: 1,
            allocations: [allocation({ quantity: '0.0001' })],
        });
        expect(result.mode).toBe('BATCH_RESTORED');
        expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('0.0001');
    });

    it.each([
        ['allocation id vacío', [allocation({ id: '   ' })]],
        ['batch id vacío', [allocation({ batchId: '   ' })]],
        ['otra línea', [allocation({ saleItemId: 'sale-item-b' })]],
        ['otro producto', [allocation({ productId: 'product-b' })]],
        ['allocation duplicada', [
            allocation({ id: ' duplicate ', batchId: 'batch-a', quantity: '1' }),
            allocation({ id: 'duplicate', batchId: 'batch-b', quantity: '1' }),
        ]],
        ['batch duplicado', [
            allocation({ id: 'allocation-a', batchId: ' duplicate ', quantity: '1' }),
            allocation({ id: 'allocation-b', batchId: 'duplicate', quantity: '1' }),
        ]],
    ])('rechaza evidencia ambigua: %s', (_title, allocations) => {
        expectReturnError(
            () => plan({ allocations }),
            'RECONCILIATION_REQUIRED',
            'La evidencia lote-bodega de la venta es ambigua',
        );
    });

    it.each([
        ['bad', 'SaleItemBatchAllocation.quantity no es un decimal válido'],
        ['0', 'SaleItemBatchAllocation.quantity debe ser positiva y tener hasta cuatro decimales'],
        ['1.00001', 'SaleItemBatchAllocation.quantity debe ser positiva y tener hasta cuatro decimales'],
    ])('rechaza cantidad de allocation %s', (quantity, message) => {
        expectReturnError(
            () => plan({ allocations: [allocation({ quantity })] }),
            'RECONCILIATION_REQUIRED',
            message,
        );
    });

    it('rechaza el acumulado de allocations por encima de lo vendido', () => {
        expectReturnError(
            () => plan({
                saleItem: { ...saleItem, quantity: '2.0000' },
                allocations: [
                    allocation({ id: 'allocation-a', batchId: 'batch-a', quantity: '1.5000' }),
                    allocation({ id: 'allocation-b', batchId: 'batch-b', quantity: '0.5001' }),
                ],
            }),
            'RECONCILIATION_REQUIRED',
            'Las asignaciones por lote superan la cantidad vendida',
        );
    });

    it('recorta ids y bodega, y convierte una bodega vacía en gap legacy', () => {
        const exact = plan({ allocations: [allocation({
            id: ' allocation-a ',
            batchId: ' batch-a ',
            warehouseId: ' warehouse-a ',
        })] });
        expect(exact.batchRestorations[0]).toMatchObject({
            allocationId: 'allocation-a',
            batchId: 'batch-a',
            warehouseId: 'warehouse-a',
        });

        const legacy = plan({ allocations: [allocation({ warehouseId: '   ' })] });
        expect(legacy.batchRestorations[0].warehouseId).toBeNull();
        expect(legacy.reconciliationGaps[0].reason).toBe('MISSING_ALLOCATION_WAREHOUSE');
    });
});

describe('mutación: historial previo por línea y producto', () => {
    it('rechaza colección e ítems históricos que no sean arrays/objetos', () => {
        expectReturnError(
            () => plan({ previousReturns: [{ items: null }] }),
            'BATCH_RETURN_HISTORY_INVALID',
            'El historial de devoluciones requiere conciliación',
        );
        for (const rawItem of [null, 'line', []]) {
            expectReturnError(
                () => plan({ previousReturns: [{ items: [rawItem] }] }),
                'BATCH_RETURN_HISTORY_INVALID',
                'El historial de devoluciones contiene una línea inválida',
            );
        }
    });

    it('ignora líneas ajenas con identidad exacta o legacy y procesa solo la propia', () => {
        const result = plan({
            requestedQuantity: '1.0000',
            previousReturns: [{
                items: [
                    historyItem({ saleItemId: 'sale-item-b', productId: saleItem.productId, quantity: '2' }),
                    historyItem({ saleItemId: '', productId: 'product-b', quantity: '2' }),
                    historyItem({ saleItemId: 7, productId: 9, quantity: '2' }),
                    historyItem({ saleItemId: saleItem.id, productId: '', quantity: '0.5000' }),
                ],
            }],
        });
        expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('1.0000');
        expect(result.aggregateOnlyQuantity.toFixed(4)).toBe('0.0000');
    });

    it('trata saleItemId no textual como identidad legacy y productId no textual como ausente', () => {
        const legacyNonTextId = plan({
            requiresBatchTracking: false,
            allocations: [allocation({ quantity: '1.0000' })],
            previousReturns: [{ items: [historyItem({
                saleItemId: 7,
                productId: saleItem.productId,
                quantity: '1.0000',
                batchRestorations: undefined,
            })] }],
        });
        expect(legacyNonTextId.batchRestorations).toEqual([]);
        expect(legacyNonTextId.aggregateOnlyQuantity.toFixed(4)).toBe('1.0000');

        const exactWithMissingProduct = plan({
            requiresBatchTracking: false,
            allocations: [allocation({ quantity: '1.0000' })],
            previousReturns: [{ items: [historyItem({
                saleItemId: saleItem.id,
                productId: 7,
                quantity: '1.0000',
                batchRestorations: undefined,
            })] }],
        });
        expect(exactWithMissingProduct.batchRestorations).toEqual([]);
        expect(exactWithMissingProduct.aggregateOnlyQuantity.toFixed(4)).toBe('1.0000');
    });

    it('rechaza una línea exacta ligada a otro producto', () => {
        expectReturnError(
            () => plan({
                previousReturns: [{ items: [historyItem({ productId: 'product-b' })] }],
            }),
            'BATCH_RETURN_HISTORY_INVALID',
            'El historial relaciona la línea con otro producto',
        );
    });

    it('acepta identidad legacy solo para un SKU vendido en una línea', () => {
        const legacy = historyItem({ saleItemId: '', productId: saleItem.productId, quantity: '1' });
        const result = plan({ previousReturns: [{ items: [legacy] }] });
        expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('1.0000');

        expectReturnError(
            () => plan({ sameProductLineCount: 2, previousReturns: [{ items: [legacy] }] }),
            'BATCH_RETURN_HISTORY_AMBIGUOUS',
            'Una devolución histórica no identifica la línea exacta de venta',
        );
    });

    it.each([
        ['bad', 'ProductReturn.items.quantity no es un decimal válido'],
        ['0', 'ProductReturn.items.quantity debe ser positiva y tener hasta cuatro decimales'],
        ['1.00001', 'ProductReturn.items.quantity debe ser positiva y tener hasta cuatro decimales'],
    ])('rechaza cantidad histórica %s', (quantity, message) => {
        expectReturnError(
            () => plan({ previousReturns: [{ items: [historyItem({ quantity })] }] }),
            'BATCH_RETURN_HISTORY_INVALID',
            message,
        );
    });

    it('trata desglose ausente/no-array como capacidad legacy ya consumida', () => {
        for (const batchRestorations of [undefined, null, {}]) {
            const result = plan({
                requestedQuantity: '1.0000',
                previousReturns: [{ items: [historyItem({
                    quantity: '1.0000',
                    batchRestorations,
                })] }],
                allocations: [
                    allocation({ id: 'allocation-a', batchId: 'batch-a', quantity: '0.5000' }),
                    allocation({ id: 'allocation-b', batchId: 'batch-b', quantity: '2.5000' }),
                ],
            });
            expect(result.batchRestorations).toHaveLength(1);
            expect(result.batchRestorations[0]).toMatchObject({ allocationId: 'allocation-b' });
            expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('1.0000');
        }
    });

    it('rechaza restauración sin objeto, sin lote o contra lote no vendido', () => {
        for (const rawRestoration of [null, 'restoration', {}, { batchId: 'batch-z', quantity: '1' }]) {
            expectReturnError(
                () => plan({
                    previousReturns: [{ items: [historyItem({
                        batchRestorations: [rawRestoration],
                    })] }],
                }),
                'BATCH_RETURN_HISTORY_INVALID',
                'El historial referencia un lote no consumido por la venta',
            );
        }
    });

    it('no inventa batchId para una restauración nula aunque ese texto exista como lote', () => {
        expectReturnError(
            () => plan({
                allocations: [allocation({ batchId: 'Stryker was here!' })],
                previousReturns: [{ items: [historyItem({ batchRestorations: [null] })] }],
            }),
            'BATCH_RETURN_HISTORY_INVALID',
            'El historial referencia un lote no consumido por la venta',
        );
    });

    it('acepta ids opcionales ausentes y recorta bodega histórica correcta', () => {
        const result = plan({
            requestedQuantity: '1.0000',
            previousReturns: [{ items: [historyItem({
                quantity: '1.0000',
                batchRestorations: [{
                    batchId: 'batch-a',
                    allocationId: 7,
                    warehouseId: ' warehouse-a ',
                    quantity: '1.0000',
                }],
            })] }],
        });
        expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('1.0000');
    });

    it.each([
        [{ allocationId: 'allocation-z' }, 'El historial lote-bodega no coincide con la asignación original'],
        [{ warehouseId: 'warehouse-z' }, 'El historial lote-bodega no coincide con la asignación original'],
    ])('rechaza identidad histórica divergente %j', (identity, message) => {
        expectReturnError(
            () => plan({
                previousReturns: [{ items: [historyItem({
                    batchRestorations: [{
                        batchId: 'batch-a',
                        quantity: '1.0000',
                        ...identity,
                    }],
                })] }],
            }),
            'BATCH_RETURN_HISTORY_INVALID',
            message,
        );
    });

    it.each([
        ['bad', 'ProductReturn.items.batchRestorations.quantity no es un decimal válido'],
        ['0', 'ProductReturn.items.batchRestorations.quantity debe ser positiva y tener hasta cuatro decimales'],
    ])('rechaza cantidad de desglose %s', (quantity, message) => {
        expectReturnError(
            () => plan({
                previousReturns: [{ items: [historyItem({
                    batchRestorations: [{ batchId: 'batch-a', quantity }],
                })] }],
            }),
            'BATCH_RETURN_HISTORY_INVALID',
            message,
        );
    });

    it('rechaza desglose superior al total devuelto', () => {
        expectReturnError(
            () => plan({
                previousReturns: [{ items: [historyItem({
                    quantity: '1.0000',
                    batchRestorations: [{ batchId: 'batch-a', quantity: '1.0001' }],
                })] }],
            }),
            'BATCH_RETURN_HISTORY_INVALID',
            'El desglose por lote supera la cantidad devuelta',
        );
    });

    it('rechaza cuando el historial restauró más que la allocation original', () => {
        expectReturnError(
            () => plan({
                saleItem: { ...saleItem, quantity: '3' },
                requestedQuantity: '0.5000',
                allocations: [allocation({ quantity: '1.0000' })],
                previousReturns: [{ items: [historyItem({
                    quantity: '2.0000',
                    batchRestorations: [{ batchId: 'batch-a', quantity: '2.0000' }],
                })] }],
            }),
            'BATCH_RETURN_HISTORY_INVALID',
            'El historial ya restaura más de lo originalmente consumido en un lote',
        );
    });
});

describe('mutación: capacidad, gaps y modos finales', () => {
    it('consume primero el remanente legacy en orden y luego restaura sin doble crédito', () => {
        const result = plan({
            requestedQuantity: '1.0000',
            previousReturns: [{ items: [historyItem({
                quantity: '1.0000',
                batchRestorations: undefined,
            })] }],
            allocations: [
                allocation({ id: 'allocation-a', batchId: 'batch-a', quantity: '0.2500' }),
                allocation({ id: 'allocation-b', batchId: 'batch-b', quantity: '2.7500' }),
            ],
        });
        expect(result.batchRestorations).toHaveLength(1);
        expect(result.batchRestorations[0].allocationId).toBe('allocation-b');
        expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('1.0000');
    });

    it('lotes posteriores a remaining=0 permanecen como iteraciones no-op', () => {
        const result = plan({
            requestedQuantity: '0.2500',
            allocations: [
                allocation({ id: 'allocation-a', batchId: 'batch-a', quantity: '1.0000' }),
                allocation({ id: 'allocation-b', batchId: 'batch-b', quantity: '2.0000' }),
            ],
        });
        expect(result.batchRestorations.map(restoration => ({
            allocationId: restoration.allocationId,
            quantity: restoration.quantity.toFixed(4),
        }))).toEqual([{ allocationId: 'allocation-a', quantity: '0.2500' }]);
        expect(result.aggregateOnlyQuantity.toFixed(4)).toBe('0.0000');
    });

    it('rechaza exactamente cuando devolución previa + solicitada supera lo vendido', () => {
        expectReturnError(
            () => plan({
                requestedQuantity: '2.0001',
                previousReturns: [{ items: [historyItem({ quantity: '1.0000' })] }],
            }),
            'BATCH_RETURN_EXCEEDED',
            'La devolución acumulada supera la cantidad vendida de la línea',
        );
        expect(() => plan({
            requestedQuantity: '2.0000',
            previousReturns: [{ items: [historyItem({ quantity: '1.0000' })] }],
        })).not.toThrow();
    });

    it('declara PARTIAL cuando hay allocation pero queda agregado no-lote', () => {
        const result = plan({
            requestedQuantity: '2.0000',
            requiresBatchTracking: false,
            allocations: [allocation({ quantity: '0.7500' })],
        });
        expect(result.mode).toBe('PARTIAL_BATCH_RESTORED');
        expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('0.7500');
        expect(result.aggregateOnlyQuantity.toFixed(4)).toBe('1.2500');
        expect(result.reconciliationGaps).toEqual([]);
    });

    it('declara LEGACY sin allocations y agrega gap solo para producto tracked', () => {
        const tracked = plan({ allocations: [], requestedQuantity: '0.5000' });
        expect(tracked.mode).toBe('LEGACY_AGGREGATE_ONLY');
        expect(tracked.reconciliationGaps.map(gap => ({
            allocationId: gap.allocationId,
            batchId: gap.batchId,
            quantity: gap.quantity.toFixed(4),
            reason: gap.reason,
        }))).toEqual([{
            allocationId: null,
            batchId: null,
            quantity: '0.5000',
            reason: 'MISSING_BATCH_ALLOCATION',
        }]);

        const untracked = plan({
            allocations: [],
            requestedQuantity: '0.5000',
            requiresBatchTracking: false,
        });
        expect(untracked.reconciliationGaps).toEqual([]);
    });

    it('ENFORCED conserva diagnóstico exacto para cualquier gap', () => {
        for (const allocations of [[], [allocation({ warehouseId: null })]]) {
            expectReturnError(
                () => plan({ allocations, ledgerMode: 'ENFORCED' }),
                'RECONCILIATION_REQUIRED',
                'La venta no conserva evidencia exacta de lote y bodega para restaurar esta cantidad',
            );
        }
    });
});
