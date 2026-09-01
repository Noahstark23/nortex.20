import { describe, expect, it } from 'vitest';
import {
    buildPurchaseSalePriceChange,
    canSetPurchaseSalePrice,
    hasPurchaseSalePriceIntent,
    PurchaseSalePriceError,
    resolvePurchaseSalePriceIntents,
} from '../backend/services/purchaseSalePriceService';

function capturePriceError(run: () => unknown): PurchaseSalePriceError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(PurchaseSalePriceError);
        return error as PurchaseSalePriceError;
    }
    throw new Error('Se esperaba PurchaseSalePriceError');
}

describe('purchaseSalePrice — red de mutación de la intención pura', () => {
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN'])('autoriza literalmente %s', (role) => {
        expect(canSetPurchaseSalePrice(role)).toBe(true);
    });

    it.each([
        'MANAGER', 'ACCOUNTANT', 'owner', 'admin', 'super_admin',
        ' OWNER', 'ADMIN ', '', null, undefined,
    ])('no amplía privilegios a %s', (role) => {
        expect(canSetPurchaseSalePrice(role)).toBe(false);
    });

    it('distingue omitido/null de cualquier intención presente', () => {
        expect(hasPurchaseSalePriceIntent([])).toBe(false);
        expect(hasPurchaseSalePriceIntent([
            { productId: 'a' },
            { productId: 'b', salePrice: null },
        ])).toBe(false);
        expect(hasPurchaseSalePriceIntent([{ productId: 'a', salePrice: '10' }])).toBe(true);
        // El esquema lo rechaza antes, pero el guard de rol debe tratar incluso
        // una cadena vacía presente como intento y nunca abrir un bypass.
        expect(hasPurchaseSalePriceIntent([{ productId: 'a', salePrice: '' }])).toBe(true);
    });

    it('devuelve vacío si ningún SKU solicita cambio', () => {
        expect(resolvePurchaseSalePriceIntents([
            { productId: 'a' },
            { productId: 'b', salePrice: null },
        ])).toEqual([]);
    });

    it('normaliza escala Decimal, deduplica igual y ordena por productId', () => {
        expect(resolvePurchaseSalePriceIntents([
            { productId: 'z', salePrice: '2.00' },
            { productId: 'a', salePrice: '10.500' },
            { productId: 'z', salePrice: '2' },
        ])).toEqual([
            { productId: 'a', salePrice: '10.5' },
            { productId: 'z', salePrice: '2' },
        ]);
    });

    it('rechaza el duplicado distinto identificando SKU, código y HTTP', () => {
        const error = capturePriceError(() => resolvePurchaseSalePriceIntents([
            { productId: 'sku-1', salePrice: '10' },
            { productId: 'sku-1', salePrice: '10.01' },
        ]));
        expect(error.code).toBe('CONFLICTING_PURCHASE_SALE_PRICE');
        expect(error.httpStatus).toBe(400);
        expect(error.message).toBe('El producto sku-1 tiene precios de venta distintos en la misma compra');
    });

    it.each(['', 'precio', '12abc'])('rechaza sintaxis inválida %j con contrato estable', (salePrice) => {
        const error = capturePriceError(() => resolvePurchaseSalePriceIntents([
            { productId: 'sku-1', salePrice },
        ]));
        expect(error.code).toBe('INVALID_PURCHASE_SALE_PRICE');
        expect(error.httpStatus).toBe(400);
        expect(error.message).toBe('El precio de venta debe ser un número válido');
    });

    it.each(['0', '-0.01', 'Infinity', '-Infinity', 'NaN', '1e400', '1e-1000'])
        ('rechaza cero, signo o no persistible %s sin coerciones', (salePrice) => {
            const error = capturePriceError(() => resolvePurchaseSalePriceIntents([
                { productId: 'sku-1', salePrice },
            ]));
            expect(error.code).toBe('INVALID_PURCHASE_SALE_PRICE');
            expect(error.httpStatus).toBe(400);
            expect(error.message).toBe('El precio de venta debe ser finito y mayor que cero');
        });

    it('preserva ausencia, omite no-op y captura before/after exactos', () => {
        const intent = { productId: 'sku-1', salePrice: '12.50' };
        expect(buildPurchaseSalePriceChange('sku-1', '10', undefined)).toBeNull();
        expect(buildPurchaseSalePriceChange('sku-1', '12.5', intent)).toBeNull();
        expect(buildPurchaseSalePriceChange('sku-1', '10.00', intent)).toEqual({
            productId: 'sku-1',
            priceBefore: '10',
            priceAfter: '12.5',
        });
    });
});
