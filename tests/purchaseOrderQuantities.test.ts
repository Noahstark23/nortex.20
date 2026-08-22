import { describe, expect, it } from 'vitest';
import {
    normalizePurchaseOrderLines,
    normalizePurchaseOrderReceiptLines,
    PurchaseOrderQuantityError,
    sanitizePurchaseQuantityInput,
} from '../utils/purchaseOrderQuantities';

const measured = {
    id: 'kg-1',
    name: 'Pollo por peso',
    unit: 'kg',
    saleMode: 'MEASURED',
    quantityStep: '0.25',
} as const;

const counted = {
    id: 'unit-1',
    name: 'Saco cerrado',
    unit: 'saco',
    saleMode: 'COUNTED',
    quantityStep: '1',
} as const;

const orderItem = (overrides: Record<string, unknown> = {}) => ({
    id: 'line-1',
    productId: measured.id,
    productName: measured.name,
    quantityOrdered: 37.5,
    quantityReceived: 0,
    quantityOrderedExact: '37.5000',
    quantityReceivedExact: '0.0000',
    unitAtOrder: 'kg',
    saleModeAtOrder: 'MEASURED',
    quantityStepAtOrder: '0.25',
    ...overrides,
});

const expectCode = (action: () => unknown, code: string) => {
    try {
        action();
        throw new Error('Se esperaba un PurchaseOrderQuantityError');
    } catch (error) {
        expect(error).toBeInstanceOf(PurchaseOrderQuantityError);
        expect((error as PurchaseOrderQuantityError).code).toBe(code);
    }
};

describe('cantidades exactas en órdenes de compra', () => {
    it('acepta 37.5 kg y congela unidad, modo y paso autoritativos', () => {
        const [line] = normalizePurchaseOrderLines(
            [{ productId: measured.id, quantity: '37.5', unitCost: '41.20', saleMode: 'COUNTED' }],
            [measured],
        );

        expect(line.quantity.toString()).toBe('37.5');
        expect(line.unitCost.toFixed(2)).toBe('41.20');
        expect(line.unitAtOrder).toBe('kg');
        expect(line.saleModeAtOrder).toBe('MEASURED');
        expect(line.quantityStepAtOrder).toBe('0.25');
    });

    it('rechaza 1.5 para un producto COUNTED aunque el cliente diga MEASURED', () => {
        expectCode(
            () => normalizePurchaseOrderLines(
                [{ productId: counted.id, quantity: '1.5', unitCost: '10', saleMode: 'MEASURED' }],
                [counted],
            ),
            'INVALID_LINE',
        );
    });

    it('rechaza producto de otro tenant al no aparecer en la consulta tenant-scoped', () => {
        expectCode(
            () => normalizePurchaseOrderLines(
                [{ productId: 'foreign-product', quantity: '1', unitCost: '10' }],
                [measured],
            ),
            'PRODUCT_NOT_IN_TENANT',
        );
    });

    it('rechaza productos duplicados antes de persistir', () => {
        expectCode(
            () => normalizePurchaseOrderLines(
                [
                    { productId: measured.id, quantity: '1', unitCost: '10' },
                    { productId: measured.id, quantity: '2', unitCost: '10' },
                ],
                [measured],
            ),
            'DUPLICATE_PRODUCT',
        );
    });

    it('rechaza un modo de catálogo desconocido en vez de coercionarlo a MEASURED', () => {
        expectCode(
            () => normalizePurchaseOrderLines(
                [{ productId: measured.id, quantity: '1', unitCost: '10' }],
                [{ ...measured, saleMode: 'BROKEN' }],
            ),
            'INVALID_PRODUCT_RULES',
        );
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 'Infinity', 'NaN'])(
        'rechaza cantidades no finitas: %s',
        quantity => {
            expectCode(
                () => normalizePurchaseOrderLines(
                    [{ productId: measured.id, quantity, unitCost: '10' }],
                    [measured],
                ),
                'INVALID_LINE',
            );
        },
    );

    it.each(['10.001', '-1', 'Infinity', '100000000'])(
        'rechaza costos que no caben exactamente en Decimal(10,2): %s',
        unitCost => {
            expectCode(
                () => normalizePurchaseOrderLines(
                    [{ productId: measured.id, quantity: '1', unitCost }],
                    [measured],
                ),
                'INVALID_UNIT_COST',
            );
        },
    );

    it('recibe parcialmente decimales exactos y calcula el saldo sin truncar', () => {
        const [receipt] = normalizePurchaseOrderReceiptLines(
            [{ itemId: 'line-1', quantityReceived: '12.25' }],
            [orderItem()],
            [measured],
        );

        expect(receipt.quantity.toString()).toBe('12.25');
        expect(receipt.receivedAfter.toString()).toBe('12.25');
        expect(receipt.remainingBefore.toString()).toBe('37.5');

        const [finalReceipt] = normalizePurchaseOrderReceiptLines(
            [{ itemId: 'line-1', quantityReceived: '25.25' }],
            [orderItem({ quantityReceived: 12.25, quantityReceivedExact: '12.2500' })],
            [measured],
        );
        expect(finalReceipt.receivedAfter.toString()).toBe('37.5');
    });

    it('bloquea sobre-recepción decimal usando los campos exactos como autoridad', () => {
        expectCode(
            () => normalizePurchaseOrderReceiptLines(
                [{ itemId: 'line-1', quantityReceived: '25.5' }],
                [orderItem({
                    // Las sombras Float están manipuladas; no deben gobernar.
                    quantityOrdered: 999,
                    quantityReceived: 0,
                    quantityReceivedExact: '12.2500',
                })],
                [measured],
            ),
            'OVER_RECEIPT',
        );
    });

    it('usa el snapshot al recibir aunque el producto cambie de paso', () => {
        const changedProduct = { ...measured, quantityStep: '1' };
        const [receipt] = normalizePurchaseOrderReceiptLines(
            [{ itemId: 'line-1', quantityReceived: '0.25' }],
            [orderItem()],
            [changedProduct],
        );

        expect(receipt.quantity.toString()).toBe('0.25');
        expect(receipt.rules.quantityStep).toBe('0.25');
    });

    it('rechaza 1.5 en la recepción de una OC COUNTED', () => {
        expectCode(
            () => normalizePurchaseOrderReceiptLines(
                [{ itemId: 'counted-line', quantityReceived: '1.5' }],
                [orderItem({
                    id: 'counted-line',
                    productId: counted.id,
                    productName: counted.name,
                    quantityOrdered: 3,
                    quantityOrderedExact: '3',
                    unitAtOrder: 'saco',
                    saleModeAtOrder: 'COUNTED',
                    quantityStepAtOrder: '1',
                })],
                [counted],
            ),
            'INVALID_LINE',
        );
    });

    it('compatibiliza una fila legacy solo cuando todos los snapshots están ausentes', () => {
        const [receipt] = normalizePurchaseOrderReceiptLines(
            [{ itemId: 'line-1', quantityReceived: '0.5' }],
            [orderItem({
                quantityOrderedExact: null,
                quantityReceivedExact: null,
                unitAtOrder: null,
                saleModeAtOrder: null,
                quantityStepAtOrder: null,
            })],
            [measured],
        );

        expect(receipt.quantity.toString()).toBe('0.5');
        expect(receipt.rules).toEqual({ saleMode: 'MEASURED', quantityStep: '0.25' });
        expect(receipt.unitAtOrder).toBe('kg');
    });

    it('rechaza snapshots parciales para no mezclar una unidad vieja con reglas nuevas', () => {
        expectCode(
            () => normalizePurchaseOrderReceiptLines(
                [{ itemId: 'line-1', quantityReceived: '1' }],
                [orderItem({ unitAtOrder: null })],
                [measured],
            ),
            'INVALID_ORDER_SNAPSHOT',
        );
    });

    it('rechaza una cantidad histórica que no respeta su paso congelado', () => {
        expectCode(
            () => normalizePurchaseOrderReceiptLines(
                [{ itemId: 'line-1', quantityReceived: '0.25' }],
                [orderItem({ quantityOrderedExact: '37.4' })],
                [measured],
            ),
            'CORRUPT_ORDER_QUANTITY',
        );
    });

    it('rechaza itemId repetido y líneas ajenas a la OC', () => {
        expectCode(
            () => normalizePurchaseOrderReceiptLines(
                [
                    { itemId: 'line-1', quantityReceived: '1' },
                    { itemId: 'line-1', quantityReceived: '1' },
                ],
                [orderItem()],
                [measured],
            ),
            'DUPLICATE_ITEM',
        );
        expectCode(
            () => normalizePurchaseOrderReceiptLines(
                [{ itemId: 'foreign-line', quantityReceived: '1' }],
                [orderItem()],
                [measured],
            ),
            'ITEM_NOT_IN_ORDER',
        );
    });

    it('limita la captura visual a cuatro decimales y un solo punto', () => {
        expect(sanitizePurchaseQuantityInput('37..50009kg')).toBe('37.5000');
    });
});
