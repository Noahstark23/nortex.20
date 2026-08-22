import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    assertBaseUnitChangeAllowed,
    convertQuantity,
    formatQuantity,
    formatQuantityValue,
    MAX_QUANTITY,
    parseQuantity,
    QuantityValidationError,
    validateNonNegativeQuantity,
    validateQuantity,
} from '../utils/quantity';

const expectQuantityError = (fn: () => unknown, code: QuantityValidationError['code']): void => {
    try {
        fn();
        throw new Error('Se esperaba QuantityValidationError');
    } catch (error) {
        expect(error).toBeInstanceOf(QuantityValidationError);
        expect((error as QuantityValidationError).code).toBe(code);
    }
};

describe('parseQuantity', () => {
    it('acepta string, number y Decimal sin convertir el resultado a Number', () => {
        expect(parseQuantity('1.2500')).toBeInstanceOf(Decimal);
        expect(parseQuantity('1.2500').toString()).toBe('1.25');
        expect(parseQuantity(2.5).toString()).toBe('2.5');
        expect(parseQuantity(new Decimal('3.75')).toString()).toBe('3.75');
    });

    it.each([0, '0', '-0.1', -2])('rechaza cero o negativos: %s', (input) => {
        expectQuantityError(() => parseQuantity(input), 'NON_POSITIVE_QUANTITY');
    });

    it.each([NaN, Infinity, -Infinity, 'NaN', 'Infinity'])('rechaza no finitos: %s', (input) => {
        expectQuantityError(() => parseQuantity(input), 'NON_FINITE_QUANTITY');
    });

    it.each(['', '   ', '1,25', 'pollo', null, undefined, {}, []])('rechaza entrada inválida', (input) => {
        expectQuantityError(() => parseQuantity(input), 'INVALID_QUANTITY');
    });

    it('acepta hasta cuatro decimales y rechaza el quinto significativo', () => {
        expect(parseQuantity('0.0001').toString()).toBe('0.0001');
        expectQuantityError(() => parseQuantity('0.00001'), 'TOO_MANY_DECIMALS');
    });

    it('rechaza overflow del Decimal(18,4)', () => {
        expect(parseQuantity(MAX_QUANTITY).equals(MAX_QUANTITY)).toBe(true);
        expectQuantityError(() => parseQuantity('100000000000000'), 'QUANTITY_OVERFLOW');
        expectQuantityError(() => parseQuantity('1e9999999999999999'), 'NON_FINITE_QUANTITY');
    });

    it('no oculta ruido binario recibido como Number', () => {
        expectQuantityError(() => parseQuantity(0.1 + 0.2), 'TOO_MANY_DECIMALS');
    });
});

describe('validateQuantity', () => {
    it('valida múltiplos exactos con Decimal (0.1 + 0.2 = 0.3)', () => {
        const exact = parseQuantity('0.1').plus(parseQuantity('0.2'));
        expect(exact.toString()).toBe('0.3');
        expect(validateQuantity(exact, { saleMode: 'MEASURED', quantityStep: '0.1' }).toString()).toBe('0.3');
    });

    it('rechaza una fracción que no coincide con el step', () => {
        expectQuantityError(
            () => validateQuantity('1.25', { saleMode: 'MEASURED', quantityStep: '0.1' }),
            'STEP_MISMATCH',
        );
    });

    it('COUNTED exige cantidad y step enteros', () => {
        expect(validateQuantity('3', { saleMode: 'COUNTED', quantityStep: '1' }).toString()).toBe('3');
        expectQuantityError(
            () => validateQuantity('1.5', { saleMode: 'COUNTED', quantityStep: '1' }),
            'COUNTED_REQUIRES_INTEGER',
        );
        expectQuantityError(
            () => validateQuantity('2', { saleMode: 'COUNTED', quantityStep: '0.5' }),
            'COUNTED_REQUIRES_INTEGER',
        );
    });

    it.each(['0', '-1', '0.00001', 'NaN', 'Infinity'])('rechaza step inválido: %s', (step) => {
        expectQuantityError(
            () => validateQuantity('1', { saleMode: 'MEASURED', quantityStep: step }),
            'INVALID_STEP',
        );
    });

    it('aplica un máximo de negocio sin ampliar el tope persistible', () => {
        expect(validateQuantity('99.9999', {
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
            maxQuantity: '100',
        }).toString()).toBe('99.9999');
        expectQuantityError(
            () => validateQuantity('100.0001', {
                saleMode: 'MEASURED',
                quantityStep: '0.0001',
                maxQuantity: '100',
            }),
            'QUANTITY_OVERFLOW',
        );
    });
});

describe('validateNonNegativeQuantity', () => {
    it('conserva stock decimal de alta rápida sin truncarlo', () => {
        expect(validateNonNegativeQuantity('37.50', {
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
        }).toString()).toBe('37.5');
        expect(validateNonNegativeQuantity('0', {
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
        }).toString()).toBe('0');
    });

    it('solo COUNTED explícito rechaza fracciones', () => {
        expectQuantityError(() => validateNonNegativeQuantity('37.50', {
            saleMode: 'COUNTED',
            quantityStep: '1',
        }), 'COUNTED_REQUIRES_INTEGER');
    });
});

describe('convertQuantity', () => {
    it('convierte exactamente g ↔ kg', () => {
        expect(convertQuantity('1250', 'g', 'kg').toString()).toBe('1.25');
        expect(convertQuantity('1.25', 'kg', 'g').toString()).toBe('1250');
    });

    it('convierte exactamente oz ↔ lb', () => {
        expect(convertQuantity('20', 'oz', 'lb').toString()).toBe('1.25');
        expect(convertQuantity('1.25', 'lb', 'oz').toString()).toBe('20');
    });

    it('conserva una cantidad cuando la unidad es idéntica', () => {
        expect(convertQuantity('2.5', 'litro', 'litro').toString()).toBe('2.5');
    });

    it.each([
        ['kg', 'lb'],
        ['g', 'oz'],
        ['kg', 'litro'],
        ['unidad', 'kg'],
    ])('rechaza magnitudes/conversiones no aprobadas: %s → %s', (from, to) => {
        expectQuantityError(() => convertQuantity('1', from, to), 'INCOMPATIBLE_UNITS');
    });

    it('bloquea el cambio cuando existe una orden de compra abierta', () => {
        expectQuantityError(
            () => assertBaseUnitChangeAllowed({
                currentUnit: 'kg',
                nextUnit: 'lb',
                stock: '0',
                hasMovements: false,
                hasOpenCommitments: true,
            }),
            'UNIT_CHANGE_REQUIRES_CONVERSION',
        );
    });
});

describe('formato de cantidad/unidad', () => {
    it('muestra hasta cuatro decimales sin ceros finales', () => {
        expect(formatQuantityValue('1.2500')).toBe('1.25');
        expect(formatQuantityValue('0.0001')).toBe('0.0001');
        expect(formatQuantity('1.2500', 'lb')).toBe('1.25 lb');
    });

    it('redondea solo para presentación, nunca para validar', () => {
        expect(formatQuantityValue('1.23456')).toBe('1.2346');
        expectQuantityError(() => parseQuantity('1.23456'), 'TOO_MANY_DECIMALS');
    });

    it('rechaza formatos no finitos y unidad vacía', () => {
        expectQuantityError(() => formatQuantityValue(Infinity), 'NON_FINITE_QUANTITY');
        expectQuantityError(() => formatQuantity('1', '   '), 'INCOMPATIBLE_UNITS');
    });
});

describe('cambio de unidad base', () => {
    it('permite normalizar el mismo nombre de unidad', () => {
        expect(() => assertBaseUnitChangeAllowed({
            currentUnit: 'LB',
            nextUnit: ' lb ',
            stock: '25.5',
            hasMovements: true,
        })).not.toThrow();
    });

    it('permite cambiar antes del primer movimiento con stock cero', () => {
        expect(() => assertBaseUnitChangeAllowed({
            currentUnit: 'unidad',
            nextUnit: 'lb',
            stock: '0',
            hasMovements: false,
        })).not.toThrow();
    });

    it.each([
        { stock: '0.0001', hasMovements: false },
        { stock: '0', hasMovements: true },
    ])('exige conversión auditada si ya existe stock o historial: %o', ({ stock, hasMovements }) => {
        expectQuantityError(
            () => assertBaseUnitChangeAllowed({
                currentUnit: 'lb',
                nextUnit: 'kg',
                stock,
                hasMovements,
            }),
            'UNIT_CHANGE_REQUIRES_CONVERSION',
        );
    });
});
