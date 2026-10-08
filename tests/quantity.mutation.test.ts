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

type ExpectedQuantityError = {
    code: QuantityValidationError['code'];
    message: string;
};

const expectQuantityError = (
    operation: () => unknown,
    expected: ExpectedQuantityError,
): QuantityValidationError => {
    let thrown: unknown;
    try {
        operation();
    } catch (error) {
        thrown = error;
    }

    expect(thrown).toBeInstanceOf(QuantityValidationError);
    expect(thrown).toMatchObject({
        name: 'QuantityValidationError',
        code: expected.code,
        message: expected.message,
    });
    return thrown as QuantityValidationError;
};

describe('quantity — contrato observable exhaustivo', () => {
    it('preserva identidad, código y mensaje del error de dominio', () => {
        const error = new QuantityValidationError('INVALID_QUANTITY', 'detalle verificable');

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('QuantityValidationError');
        expect(error.code).toBe('INVALID_QUANTITY');
        expect(error.message).toBe('detalle verificable');
    });

    it('mantiene el límite físico exacto de Decimal(18,4)', () => {
        expect(MAX_QUANTITY.toFixed(4)).toBe('99999999999999.9999');
        expect(parseQuantity(MAX_QUANTITY).toFixed(4)).toBe('99999999999999.9999');
    });
});

describe('parseQuantity — fronteras y errores estables', () => {
    it('acepta strings periféricamente espaciados, numbers y clona Decimal', () => {
        const source = new Decimal('3.7500');
        const clone = parseQuantity(source);

        expect(parseQuantity(' \t1.2500\n ').toString()).toBe('1.25');
        expect(parseQuantity(2.5).toString()).toBe('2.5');
        expect(clone.toString()).toBe('3.75');
        expect(clone).not.toBe(source);
    });

    it.each([null, undefined, false, {}, []])('rechaza tipos no decimales: %o', (input) => {
        expectQuantityError(() => parseQuantity(input), {
            code: 'INVALID_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        });
    });

    it('no acepta objetos que intenten simular un decimal mediante toString', () => {
        const decimalImpostor = { toString: () => '1.25' };

        expectQuantityError(() => parseQuantity(decimalImpostor), {
            code: 'INVALID_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        });
    });

    it.each(['', '   ', '\t\n', '1,25', 'carne'])('rechaza texto vacío o mal formado: %o', (input) => {
        expectQuantityError(() => parseQuantity(input), {
            code: 'INVALID_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        });
    });

    it.each([NaN, Infinity, -Infinity, 'NaN', 'Infinity', '-Infinity'])('rechaza no finitos: %o', (input) => {
        expectQuantityError(() => parseQuantity(input), {
            code: 'NON_FINITE_QUANTITY',
            message: 'La cantidad debe ser finita',
        });
    });

    it.each(['0', '-0', '-0.0001'])('rechaza cantidades no positivas: %s', (input) => {
        expectQuantityError(() => parseQuantity(input), {
            code: 'NON_POSITIVE_QUANTITY',
            message: 'La cantidad debe ser mayor que cero',
        });
    });

    it('acepta cuatro decimales y rechaza el quinto significativo', () => {
        expect(parseQuantity('1.0001').toFixed(4)).toBe('1.0001');
        expectQuantityError(() => parseQuantity('1.00001'), {
            code: 'TOO_MANY_DECIMALS',
            message: 'La cantidad admite como máximo 4 decimales',
        });
    });

    it('acepta el máximo exacto y rechaza el siguiente valor persistible', () => {
        expect(parseQuantity('99999999999999.9999').equals(MAX_QUANTITY)).toBe(true);
        expectQuantityError(() => parseQuantity('100000000000000.0000'), {
            code: 'QUANTITY_OVERFLOW',
            message: 'La cantidad excede el máximo permitido',
        });
    });
});

describe('validateQuantity — modo, paso y máximo de negocio', () => {
    const measured = { saleMode: 'MEASURED' as const, quantityStep: '0.25' };

    it('rechaza un modo ajeno al dominio antes de interpretar la cantidad', () => {
        expectQuantityError(() => validateQuantity('1', {
            saleMode: 'WEIGHTED' as never,
            quantityStep: '1',
        }), {
            code: 'INVALID_QUANTITY',
            message: 'El modo de venta no es válido',
        });
    });

    it('acepta múltiplos exactos y comunica el paso en un desajuste', () => {
        expect(validateQuantity('1.25', measured).toString()).toBe('1.25');
        expectQuantityError(() => validateQuantity('1.2', measured), {
            code: 'STEP_MISMATCH',
            message: 'La cantidad debe ser múltiplo exacto de 0.25',
        });
    });

    it('COUNTED exige por separado cantidad entera y paso entero', () => {
        expect(validateQuantity('3', { saleMode: 'COUNTED', quantityStep: '1' }).toString()).toBe('3');
        expectQuantityError(() => validateQuantity('1.5', {
            saleMode: 'COUNTED',
            quantityStep: '1',
        }), {
            code: 'COUNTED_REQUIRES_INTEGER',
            message: 'Los productos contables requieren cantidades y pasos enteros',
        });
        expectQuantityError(() => validateQuantity('2', {
            saleMode: 'COUNTED',
            quantityStep: '0.5',
        }), {
            code: 'COUNTED_REQUIRES_INTEGER',
            message: 'Los productos contables requieren cantidades y pasos enteros',
        });
    });

    it('distingue un paso ilegible del resto de pasos inválidos', () => {
        expectQuantityError(() => validateQuantity('1', {
            saleMode: 'MEASURED',
            quantityStep: 'no-es-decimal',
        }), {
            code: 'INVALID_STEP',
            message: 'El paso de cantidad no es válido',
        });

        const invalidStepMessage = 'El paso debe ser positivo, finito y tener hasta 4 decimales';
        for (const quantityStep of ['NaN', 'Infinity', '0', '-0.1', '0.00001', '100000000000000']) {
            expectQuantityError(() => validateQuantity('1', {
                saleMode: 'MEASURED',
                quantityStep,
            }), {
                code: 'INVALID_STEP',
                message: invalidStepMessage,
            });
        }
    });

    it('acepta el máximo configurado inclusive y bloquea el exceso', () => {
        expect(validateQuantity('10', {
            saleMode: 'MEASURED',
            quantityStep: '0.25',
            maxQuantity: '10',
        }).toString()).toBe('10');
        expectQuantityError(() => validateQuantity('10.25', {
            saleMode: 'MEASURED',
            quantityStep: '0.25',
            maxQuantity: '10',
        }), {
            code: 'QUANTITY_OVERFLOW',
            message: 'La cantidad excede el máximo configurado de 10',
        });
    });

    it('envuelve el motivo exacto de un máximo configurado inválido', () => {
        expectQuantityError(() => validateQuantity('1', {
            saleMode: 'MEASURED',
            quantityStep: '1',
            maxQuantity: 'no-es-decimal',
        }), {
            code: 'INVALID_QUANTITY',
            message: 'El máximo configurado no es válido: La cantidad no tiene un formato decimal válido',
        });
        expectQuantityError(() => validateQuantity('1', {
            saleMode: 'MEASURED',
            quantityStep: '1',
            maxQuantity: '0',
        }), {
            code: 'INVALID_QUANTITY',
            message: 'El máximo configurado no es válido: La cantidad debe ser mayor que cero',
        });
    });
});

describe('validateNonNegativeQuantity — inventario con cero permitido', () => {
    const measured = { saleMode: 'MEASURED' as const, quantityStep: '0.0001' };

    it('acepta cero y el máximo exacto sin perder precisión', () => {
        expect(validateNonNegativeQuantity('0', measured).toString()).toBe('0');
        expect(validateNonNegativeQuantity(MAX_QUANTITY, measured).toFixed(4))
            .toBe('99999999999999.9999');
    });

    it('rechaza un modo de venta inválido', () => {
        expectQuantityError(() => validateNonNegativeQuantity('0', {
            saleMode: 'WEIGHTED' as never,
            quantityStep: '1',
        }), {
            code: 'INVALID_QUANTITY',
            message: 'El modo de venta no es válido',
        });
    });

    it.each([null, '   ', 'inventario'])('rechaza una entrada inválida: %o', (input) => {
        expectQuantityError(() => validateNonNegativeQuantity(input, measured), {
            code: 'INVALID_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        });
    });

    it.each(['NaN', 'Infinity', '-Infinity'])('rechaza stock no finito: %s', (input) => {
        expectQuantityError(() => validateNonNegativeQuantity(input, measured), {
            code: 'NON_FINITE_QUANTITY',
            message: 'La cantidad debe ser finita',
        });
    });

    it('rechaza negativos, incluido cero con signo, con su causa exacta', () => {
        for (const input of ['-0', '-0.0001']) {
            expectQuantityError(() => validateNonNegativeQuantity(input, measured), {
                code: 'NON_POSITIVE_QUANTITY',
                message: 'La cantidad no puede ser negativa',
            });
        }
    });

    it('rechaza exceso de escala y overflow con su causa exacta', () => {
        expectQuantityError(() => validateNonNegativeQuantity('0.00001', measured), {
            code: 'TOO_MANY_DECIMALS',
            message: 'La cantidad admite como máximo 4 decimales',
        });
        expectQuantityError(() => validateNonNegativeQuantity('100000000000000', measured), {
            code: 'QUANTITY_OVERFLOW',
            message: 'La cantidad excede el máximo permitido',
        });
    });

    it('valida el paso aun cuando la cantidad es cero', () => {
        expectQuantityError(() => validateNonNegativeQuantity('0', {
            saleMode: 'MEASURED',
            quantityStep: 'paso-inválido',
        }), {
            code: 'INVALID_STEP',
            message: 'El paso de cantidad no es válido',
        });
        expectQuantityError(() => validateNonNegativeQuantity('0', {
            saleMode: 'MEASURED',
            quantityStep: 'Infinity',
        }), {
            code: 'INVALID_STEP',
            message: 'El paso debe ser positivo, finito y tener hasta 4 decimales',
        });
    });

    it('COUNTED acepta cero con paso entero y rechaza un paso fraccionario', () => {
        expect(validateNonNegativeQuantity('0', {
            saleMode: 'COUNTED',
            quantityStep: '1',
        }).toString()).toBe('0');
        expectQuantityError(() => validateNonNegativeQuantity('0', {
            saleMode: 'COUNTED',
            quantityStep: '0.5',
        }), {
            code: 'COUNTED_REQUIRES_INTEGER',
            message: 'Los productos contables requieren cantidades y pasos enteros',
        });
    });

    it('para cantidades positivas conserva la validación exacta del múltiplo', () => {
        expect(validateNonNegativeQuantity('1.25', {
            saleMode: 'MEASURED',
            quantityStep: '0.25',
        }).toString()).toBe('1.25');
        expectQuantityError(() => validateNonNegativeQuantity('1.2', {
            saleMode: 'MEASURED',
            quantityStep: '0.25',
        }), {
            code: 'STEP_MISMATCH',
            message: 'La cantidad debe ser múltiplo exacto de 0.25',
        });
    });
});

describe('convertQuantity — normalización y pares permitidos', () => {
    it.each([
        ['1250', ' G ', 'kg', '1.25'],
        ['1.25', 'kg', ' G ', '1250'],
        ['20', ' OZ ', 'lb', '1.25'],
        ['1.25', 'lb', ' OZ ', '20'],
    ] as const)('convierte %s %s → %s exactamente', (input, from, to, expected) => {
        expect(convertQuantity(input, from, to).toString()).toBe(expected);
    });

    it('trata una unidad idéntica normalizada como identidad, incluso si no es masa', () => {
        expect(convertQuantity('2.5000', ' Litro ', 'LITRO').toString()).toBe('2.5');
    });

    it('rechaza cada lado vacío con el error de unidad', () => {
        for (const [from, to] of [['   ', 'kg'], ['kg', '   ']] as const) {
            expectQuantityError(() => convertQuantity('1', from, to), {
                code: 'INCOMPATIBLE_UNITS',
                message: 'La unidad no puede estar vacía',
            });
        }
    });

    it.each([
        [' kg ', 'LB'],
        ['litro', 'kg'],
        ['kg', 'litro'],
        ['g', 'oz'],
    ] as const)('rechaza sin inferir una conversión de %s a %s', (from, to) => {
        expectQuantityError(() => convertQuantity('1', from, to), {
            code: 'INCOMPATIBLE_UNITS',
            message: `No existe una conversión exacta permitida de ${from} a ${to}`,
        });
    });

    it('valida la cantidad antes de decidir la conversión', () => {
        expectQuantityError(() => convertQuantity('0', '', ''), {
            code: 'NON_POSITIVE_QUANTITY',
            message: 'La cantidad debe ser mayor que cero',
        });
    });
});

describe('formato decimal y unidad', () => {
    it.each([
        ['1.2500', '1.25'],
        ['1', '1'],
        ['0.0001', '0.0001'],
        ['1.23454', '1.2345'],
        ['1.23455', '1.2346'],
        ['-0.1250', '-0.125'],
    ] as const)('formatea %s como %s', (input, expected) => {
        expect(formatQuantityValue(input)).toBe(expected);
    });

    it('distingue formato ilegible y valor no finito', () => {
        expectQuantityError(() => formatQuantityValue('cantidad'), {
            code: 'INVALID_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        });
        expectQuantityError(() => formatQuantityValue(Infinity), {
            code: 'NON_FINITE_QUANTITY',
            message: 'La cantidad debe ser finita',
        });
    });

    it('normaliza espacios de la unidad sin cambiar su escritura interna', () => {
        expect(formatQuantity('1.2500', '  lb  ')).toBe('1.25 lb');
        expect(formatQuantity('2', 'Caja Grande')).toBe('2 Caja Grande');
    });

    it('rechaza una unidad vacía', () => {
        expectQuantityError(() => formatQuantity('1', ' \t '), {
            code: 'INCOMPATIBLE_UNITS',
            message: 'La unidad no puede estar vacía',
        });
    });
});

describe('assertBaseUnitChangeAllowed — invariantes de stock e historial', () => {
    const conversionMessage = 'La unidad base no se puede cambiar cuando el producto tiene stock, movimientos u órdenes abiertas; usá una conversión auditada';

    it('normaliza por separado la unidad actual y la siguiente antes de comparar', () => {
        expect(() => assertBaseUnitChangeAllowed({
            currentUnit: ' LB ',
            nextUnit: 'lb',
            stock: 'stock-no-decimal',
            hasMovements: true,
            hasOpenCommitments: true,
        })).not.toThrow();
        expect(() => assertBaseUnitChangeAllowed({
            currentUnit: 'lb',
            nextUnit: ' LB ',
            stock: 'stock-no-decimal',
            hasMovements: true,
            hasOpenCommitments: true,
        })).not.toThrow();
    });

    it('rechaza por separado una unidad actual o siguiente vacía', () => {
        for (const [currentUnit, nextUnit] of [[' ', 'kg'], ['kg', '\t']] as const) {
            expectQuantityError(() => assertBaseUnitChangeAllowed({
                currentUnit,
                nextUnit,
                stock: '0',
                hasMovements: false,
            }), {
                code: 'INCOMPATIBLE_UNITS',
                message: 'La unidad no puede estar vacía',
            });
        }
    });

    it('permite el cambio con cero finito, sin movimientos ni compromisos', () => {
        for (const hasOpenCommitments of [undefined, false]) {
            expect(() => assertBaseUnitChangeAllowed({
                currentUnit: 'unidad',
                nextUnit: 'kg',
                stock: '0',
                hasMovements: false,
                hasOpenCommitments,
            })).not.toThrow();
        }
    });

    it('distingue stock ilegible de stock no finito', () => {
        expectQuantityError(() => assertBaseUnitChangeAllowed({
            currentUnit: 'unidad',
            nextUnit: 'kg',
            stock: 'stock-no-decimal',
            hasMovements: false,
        }), {
            code: 'INVALID_QUANTITY',
            message: 'El stock actual no es un decimal válido',
        });
        expectQuantityError(() => assertBaseUnitChangeAllowed({
            currentUnit: 'unidad',
            nextUnit: 'kg',
            stock: 'Infinity',
            hasMovements: false,
        }), {
            code: 'NON_FINITE_QUANTITY',
            message: 'El stock actual debe ser finito',
        });
    });

    it.each([
        { stock: '0.0001', hasMovements: false, hasOpenCommitments: false },
        { stock: '0', hasMovements: true, hasOpenCommitments: false },
        { stock: '0', hasMovements: false, hasOpenCommitments: true },
    ])('bloquea independientemente stock, movimientos y compromisos: %o', (state) => {
        expectQuantityError(() => assertBaseUnitChangeAllowed({
            currentUnit: 'unidad',
            nextUnit: 'kg',
            ...state,
        }), {
            code: 'UNIT_CHANGE_REQUIRES_CONVERSION',
            message: conversionMessage,
        });
    });
});
