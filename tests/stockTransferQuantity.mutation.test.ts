import { describe, expect, it } from 'vitest';
import { QuantityValidationError } from '../utils/quantity';
import { validateStockTransferQuantity } from '../utils/stockTransferQuantity';

const errorFrom = (run: () => unknown): QuantityValidationError => {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(QuantityValidationError);
        return error as QuantityValidationError;
    }
    throw new Error('Se esperaba QuantityValidationError');
};

describe('validateStockTransferQuantity — autoridad de modo y paso', () => {
    it('COUNTED explícito usa paso uno por defecto y exige enteros', () => {
        expect(validateStockTransferQuantity('2', {
            saleMode: 'COUNTED',
            quantityStep: null,
        }).toString()).toBe('2');

        const error = errorFrom(() => validateStockTransferQuantity('1.5', {
            saleMode: 'COUNTED',
            quantityStep: undefined,
        }));
        expect(error.code).toBe('COUNTED_REQUIRES_INTEGER');
        expect(error.message).toBe('Los productos contables requieren cantidades y pasos enteros');
    });

    it.each([null, undefined, '', { toString: () => '' }])(
        'MEASURED/legacy usa 0.0001 cuando el paso falta o está vacío: %o',
        (quantityStep) => {
            expect(validateStockTransferQuantity('0.0001', {
                saleMode: null,
                quantityStep,
            }).toString()).toBe('0.0001');
        },
    );

    it('cualquier modo no COUNTED conserva fracciones como MEASURED', () => {
        expect(validateStockTransferQuantity('1.25', {
            saleMode: 'OTRO',
            quantityStep: '0.25',
        }).toString()).toBe('1.25');
    });

    it('convierte pasos numéricos y objetos Decimal-like a texto autoritativo', () => {
        expect(validateStockTransferQuantity('1.5', {
            saleMode: 'MEASURED',
            quantityStep: 0.5,
        }).toString()).toBe('1.5');
        expect(validateStockTransferQuantity('0.75', {
            saleMode: 'MEASURED',
            quantityStep: { toString: () => '0.25' },
        }).toString()).toBe('0.75');
    });

    it('no sustituye silenciosamente un paso cero o inválido presente', () => {
        for (const quantityStep of [0, 'no-decimal']) {
            const error = errorFrom(() => validateStockTransferQuantity('1', {
                saleMode: 'MEASURED',
                quantityStep,
            }));
            expect(error.code).toBe('INVALID_STEP');
        }
    });

    it('delega límites y múltiplo exacto al dominio compartido', () => {
        const stepError = errorFrom(() => validateStockTransferQuantity('1.2', {
            saleMode: 'MEASURED',
            quantityStep: '0.25',
        }));
        expect(stepError.code).toBe('STEP_MISMATCH');
        expect(stepError.message).toBe('La cantidad debe ser múltiplo exacto de 0.25');

        const scaleError = errorFrom(() => validateStockTransferQuantity('1.00001', {
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
        }));
        expect(scaleError.code).toBe('TOO_MANY_DECIMALS');
    });
});
