import Decimal from 'decimal.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
    isCashReceivedError,
    suggestNioCashAmounts,
    validateCashReceived,
    type CashReceivedValidation,
} from '../utils/posCash';

const values = (amounts: Decimal[]): string[] => amounts.map(amount => amount.toString());

describe('validateCashReceived', () => {
    it('identifica de forma estricta solo los resultados de error', () => {
        const error = validateCashReceived('99', '100');
        const success = validateCashReceived('100', '100');

        expect(isCashReceivedError(error)).toBe(true);
        expect(isCashReceivedError(success)).toBe(false);
    });

    it('mantiene un resultado discriminado y montos Decimal en TypeScript', () => {
        const result = validateCashReceived('120', new Decimal('100'));

        expectTypeOf(result).toEqualTypeOf<CashReceivedValidation>();
        if (result.ok) {
            expectTypeOf(result.received).toEqualTypeOf<Decimal>();
            expectTypeOf(result.total).toEqualTypeOf<Decimal>();
            expectTypeOf(result.change).toEqualTypeOf<Decimal>();
            expect(result.change.toString()).toBe('20');
        }
    });

    it.each([[''], ['   '], [null], [undefined]])('distingue un monto vacio: %p', received => {
        expect(validateCashReceived(received, '100')).toEqual({
            ok: false,
            code: 'EMPTY_RECEIVED',
            message: 'Ingresá el efectivo recibido',
        });
    });

    it.each([['.'], ['efectivo'], ['1,000'], [NaN], [Infinity], [-1], [{ amount: 100 }]])(
        'rechaza un monto recibido invalido: %p',
        received => {
            const result = validateCashReceived(received, '100');
            expect(result.ok).toBe(false);
            if (result.ok === false) expect(result.code).toBe('INVALID_RECEIVED');
        },
    );

    it('rechaza bigint aunque Decimal.js pueda convertirlo implicitamente', () => {
        expect(validateCashReceived(100n, '100')).toEqual({
            ok: false,
            code: 'INVALID_RECEIVED',
            message: 'El efectivo recibido no es válido',
        });
        expect(validateCashReceived('100', 100n)).toEqual({
            ok: false,
            code: 'INVALID_TOTAL',
            message: 'El total de la venta no es válido',
        });
    });

    it.each([[''], ['0'], ['-1'], ['venta'], [NaN], [Infinity], [null]])(
        'rechaza un total invalido: %p',
        total => {
            const result = validateCashReceived('100', total);
            expect(result.ok).toBe(false);
            if (result.ok === false) expect(result.code).toBe('INVALID_TOTAL');
        },
    );

    it('rechaza efectivo menor al total y calcula el faltante con Decimal', () => {
        const result = validateCashReceived('84.90', '85.10');

        expect(result).toMatchObject({
            ok: false,
            code: 'INSUFFICIENT_RECEIVED',
            message: 'El efectivo recibido es menor que el total',
        });
        if (result.ok === false) {
            expect(result.shortfall?.toString()).toBe('0.2');
        }
    });

    it('acepta el monto exacto sin producir vuelto negativo', () => {
        const result = validateCashReceived('85.10', new Decimal('85.10'));

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.received).toBeInstanceOf(Decimal);
            expect(result.change.toString()).toBe('0');
        }
    });

    it('calcula el vuelto sin errores de punto flotante', () => {
        const result = validateCashReceived('0.30', '0.10');

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.change.toString()).toBe('0.2');
    });

    it('acepta entradas numéricas finitas sin confundirlas con tipos no permitidos', () => {
        const result = validateCashReceived(120, 100);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.received.toString()).toBe('120');
            expect(result.total.toString()).toBe('100');
            expect(result.change.toString()).toBe('20');
        }
    });
});

describe('suggestNioCashAmounts', () => {
    it('conserva Decimal[] como contrato de salida', () => {
        const suggestions = suggestNioCashAmounts(new Decimal('19'));

        expectTypeOf(suggestions).toEqualTypeOf<Decimal[]>();
        expect(suggestions.every(amount => amount instanceof Decimal)).toBe(true);
    });

    it('ofrece C$20 para una venta de C$19', () => {
        expect(values(suggestNioCashAmounts('19'))).toEqual(['20', '50', '100']);
        expect(values(suggestNioCashAmounts(19))).toEqual(['20', '50', '100']);
    });

    it('ofrece C$100 y C$200 para una venta de C$85', () => {
        expect(values(suggestNioCashAmounts('85'))).toEqual(['100', '200', '500']);
    });

    it('combina redondeos utiles para C$645', () => {
        expect(values(suggestNioCashAmounts('645'))).toEqual(['650', '700', '1000']);
    });

    it('nunca repite el total exacto ni sugerencias equivalentes', () => {
        const suggestions = values(suggestNioCashAmounts('100', 10));

        expect(suggestions).not.toContain('100');
        expect(new Set(suggestions).size).toBe(suggestions.length);
    });

    it('ninguna sugerencia queda por debajo del total', () => {
        const total = new Decimal('649.99');
        const suggestions = suggestNioCashAmounts(total, 10);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.every(amount => amount.greaterThan(total))).toBe(true);
    });

    it('respeta un maximo configurable', () => {
        expect(values(suggestNioCashAmounts('19', 2))).toEqual(['20', '50']);
        expect(values(suggestNioCashAmounts('19', 1))).toEqual(['20']);
        expect(suggestNioCashAmounts('19', 0)).toEqual([]);
        expect(suggestNioCashAmounts('19', -1)).toEqual([]);
        expect(suggestNioCashAmounts('19', 0.9)).toEqual([]);
        expect(suggestNioCashAmounts('19', Infinity)).toEqual([]);
    });

    it.each([[''], ['.'], ['venta'], ['0'], ['-1'], [NaN], [Infinity], [null], [undefined]])(
        'no sugiere montos para un total invalido: %p',
        total => {
            expect(suggestNioCashAmounts(total)).toEqual([]);
        },
    );
});
