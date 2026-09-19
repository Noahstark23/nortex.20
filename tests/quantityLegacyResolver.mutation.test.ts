import { describe, expect, it } from 'vitest';
import { resolveProductQuantityRules } from '../utils/productQuantityRules';
import { validateQuantity } from '../utils/quantity';

describe('reglas de catálogo heredado: modo y paso compartidos', () => {
    it.each(['unidad', 'unidades', 'caja', 'cajas', ' CAJA ', ' Unidad '])(
        'infiere conteo para %s sin configuración', (unit) => {
            expect(resolveProductQuantityRules({ unit })).toEqual({ saleMode: 'COUNTED', quantityStep: '1' });
            expect(resolveProductQuantityRules({ unit, saleMode: null, quantityStep: null }))
                .toEqual({ saleMode: 'COUNTED', quantityStep: '1' });
        },
    );

    it.each([undefined, null, '', 'kg', 'litro', 'metro', 'cajita', 'caja especial', 'pulgada']) (
        'conserva compatibilidad fraccionaria para %s', (unit) => {
            expect(resolveProductQuantityRules({ unit })).toEqual({ saleMode: 'MEASURED', quantityStep: '0.0001' });
        },
    );

    it('COUNTED explícito prevalece sobre una unidad medida y conserva su paso', () => {
        expect(resolveProductQuantityRules({ unit: 'kg', saleMode: 'COUNTED' }))
            .toEqual({ saleMode: 'COUNTED', quantityStep: '1' });
        expect(resolveProductQuantityRules({ unit: 'kg', saleMode: 'COUNTED', quantityStep: '2' }))
            .toEqual({ saleMode: 'COUNTED', quantityStep: '2' });
    });

    it('MEASURED explícito prevalece sobre el nombre de una unidad contable', () => {
        expect(resolveProductQuantityRules({ unit: 'caja', saleMode: 'MEASURED' }))
            .toEqual({ saleMode: 'MEASURED', quantityStep: '0.0001' });
        expect(resolveProductQuantityRules({ unit: 'caja', saleMode: 'MEASURED', quantityStep: '0.5' }))
            .toEqual({ saleMode: 'MEASURED', quantityStep: '0.5' });
    });

    it.each([0.25, '0.25', { toString: () => '0.25' }])(
        'un paso explícito %o evita inferir el modo por el nombre', (quantityStep) => {
            expect(resolveProductQuantityRules({ unit: 'caja', quantityStep }))
                .toEqual({ saleMode: 'MEASURED', quantityStep: '0.25' });
        },
    );

    it.each(['1', '1.00'])('un paso %s explícito sin modo sigue siendo MEASURED', (quantityStep) => {
        expect(resolveProductQuantityRules({ unit: 'cajas', quantityStep }))
            .toEqual({ saleMode: 'MEASURED', quantityStep });
    });

    it.each(['', { toString: () => '' }])('el paso vacío %o sigue sin configurar', (quantityStep) => {
        expect(resolveProductQuantityRules({ unit: 'caja', quantityStep }))
            .toEqual({ saleMode: 'COUNTED', quantityStep: '1' });
        expect(resolveProductQuantityRules({ unit: 'kg', quantityStep }))
            .toEqual({ saleMode: 'MEASURED', quantityStep: '0.0001' });
    });

    it('un modo desconocido explícito nunca dispara una inferencia por unidad', () => {
        expect(resolveProductQuantityRules({ unit: 'caja', saleMode: 'OTRO' }))
            .toEqual({ saleMode: 'MEASURED', quantityStep: '0.0001' });
    });

    it.each([0, '0', 'no-decimal', '-0.25'])('conserva un paso inválido %o para que la validación lo rechace', (quantityStep) => {
        const rules = resolveProductQuantityRules({ unit: 'caja', quantityStep });
        expect(rules).toEqual({ saleMode: 'MEASURED', quantityStep: quantityStep.toString() });
        expect(() => validateQuantity('1', rules)).toThrow();
    });
});
