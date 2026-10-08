import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    purchaseQuantityInputStep,
    resolvePurchaseLine,
    type PurchaseProductAuthority,
} from '../utils/purchasePackaging';
import { QuantityValidationError } from '../utils/quantity';

const measuredProduct = (overrides: Partial<PurchaseProductAuthority> = {}): PurchaseProductAuthority => ({
    unit: 'kg',
    saleMode: 'MEASURED',
    quantityStep: '0.25',
    packUnit: 'bolsa',
    packSize: '4',
    ...overrides,
});

const captureQuantityError = (run: () => unknown): QuantityValidationError => {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(QuantityValidationError);
        return error as QuantityValidationError;
    }
    throw new Error('Se esperaba QuantityValidationError');
};

describe('resolvePurchaseLine — fronteras mutables del contrato puro', () => {
    it.each([
        { input: undefined, message: 'El costo debe ser un decimal válido' },
        { input: null, message: 'El costo debe ser un decimal válido' },
        { input: {}, message: 'El costo debe ser un decimal válido' },
        { input: true, message: 'El costo debe ser un decimal válido' },
        { input: 1n, message: 'El costo debe ser un decimal válido' },
        { input: '', message: 'El costo es obligatorio' },
        { input: '   ', message: 'El costo es obligatorio' },
        { input: 'no-es-decimal', message: 'El costo debe ser un decimal válido' },
    ])('rechaza el costo inválido $input con un contrato estable', ({ input, message }) => {
        const error = captureQuantityError(() => resolvePurchaseLine({
            quantity: '1',
            unitCost: input,
            purchaseUnit: 'BASE',
        }, measuredProduct()));

        expect(error.code).toBe('INVALID_QUANTITY');
        expect(error.message).toBe(message);
    });

    it.each([
        { input: Number.POSITIVE_INFINITY, code: 'NON_FINITE_QUANTITY', message: 'El costo debe ser finito' },
        { input: Number.NEGATIVE_INFINITY, code: 'NON_FINITE_QUANTITY', message: 'El costo debe ser finito' },
        { input: Number.NaN, code: 'NON_FINITE_QUANTITY', message: 'El costo debe ser finito' },
        { input: 0, code: 'NON_POSITIVE_QUANTITY', message: 'El costo debe ser mayor que cero' },
        { input: -0.01, code: 'NON_POSITIVE_QUANTITY', message: 'El costo debe ser mayor que cero' },
    ])('distingue el costo finito y estrictamente positivo: $input', ({ input, code, message }) => {
        const error = captureQuantityError(() => resolvePurchaseLine({
            quantity: '1',
            unitCost: input,
        }, measuredProduct()));

        expect(error.code).toBe(code);
        expect(error.message).toBe(message);
    });

    it('acepta Decimal y conserva el modo BASE ante cualquier valor no PACK', () => {
        const resolved = resolvePurchaseLine({
            quantity: '2.5',
            unitCost: new Decimal('3.75'),
            purchaseUnit: null,
        }, measuredProduct());

        expect(resolved).toMatchObject({ purchaseUnit: 'BASE' });
        expect(resolved.visibleUnitCost.toString()).toBe('3.75');
        expect(resolved.authoritativeFactor.toString()).toBe('1');
        expect(resolved.baseQuantity.toString()).toBe('2.5');
        expect(resolved.baseUnitCost.toString()).toBe('3.75');
        expect(resolved.lineTotal.toString()).toBe('9.38');
    });

    it('aplica los pasos por defecto distintos para COUNTED y legado/MEASURED', () => {
        const counted = resolvePurchaseLine({ quantity: '2', unitCost: '1' }, {
            saleMode: 'COUNTED',
            quantityStep: null,
        });
        expect(counted.baseQuantity.toString()).toBe('2');

        const countedError = captureQuantityError(() => resolvePurchaseLine({
            quantity: '1.5',
            unitCost: '1',
        }, { saleMode: 'COUNTED', quantityStep: undefined }));
        expect(countedError.code).toBe('COUNTED_REQUIRES_INTEGER');

        const legacy = resolvePurchaseLine({ quantity: '0.0001', unitCost: '1' }, {
            saleMode: null,
            quantityStep: null,
        });
        expect(legacy.baseQuantity.toString()).toBe('0.0001');
    });

    it.each([
        { packUnit: null, packSize: '4' },
        { packUnit: '', packSize: '4' },
        { packUnit: '   ', packSize: '4' },
        { packUnit: 'bolsa', packSize: null },
        { packUnit: 'bolsa', packSize: undefined },
    ])('exige nombre y factor completos para PACK: %o', (overrides) => {
        const error = captureQuantityError(() => resolvePurchaseLine({
            quantity: '1',
            unitCost: '12',
            purchaseUnit: 'PACK',
        }, measuredProduct(overrides)));

        expect(error.code).toBe('INVALID_QUANTITY');
        expect(error.message).toBe('El producto no tiene un empaque completo configurado');
    });

    it.each(['', 'abc', '0', '-1', Number.POSITIVE_INFINITY])(
        'envuelve el factor de empaque inválido %s sin filtrar la excepción interna',
        (packSize) => {
            const error = captureQuantityError(() => resolvePurchaseLine({
                quantity: '1',
                unitCost: '12',
                purchaseUnit: 'PACK',
            }, measuredProduct({ packSize })));

            expect(error.code).toBe('INVALID_QUANTITY');
            expect(error.message).toMatch(/^El tamaño de empaque configurado no es válido: /);
            expect(error.message.length).toBeGreaterThan('El tamaño de empaque configurado no es válido: '.length);
        },
    );
});

describe('purchaseQuantityInputStep — límites visibles', () => {
    it('usa el paso base autoritativo fuera de PACK', () => {
        expect(purchaseQuantityInputStep(measuredProduct({ quantityStep: '0.125' }), 'BASE')).toBe('0.125');
    });

    it('usa los pasos por defecto cuando quantityStep falta', () => {
        expect(purchaseQuantityInputStep({ saleMode: 'COUNTED', quantityStep: null }, 'BASE')).toBe('1');
        expect(purchaseQuantityInputStep({ saleMode: null, quantityStep: undefined }, 'BASE')).toBe('0.0001');
    });

    it.each([null, undefined])('no convierte PACK cuando packSize es %s', (packSize) => {
        expect(purchaseQuantityInputStep(measuredProduct({
            quantityStep: '0.25',
            packSize,
        }), 'PACK')).toBe('0.25');
    });

    it('devuelve el cociente exacto si cabe en cuatro decimales y uno si no cabe', () => {
        expect(purchaseQuantityInputStep(measuredProduct({
            quantityStep: '0.25',
            packSize: '2',
        }), 'PACK')).toBe('0.125');
        expect(purchaseQuantityInputStep(measuredProduct({
            quantityStep: '0.0001',
            packSize: '3',
        }), 'PACK')).toBe('1');
    });

    it.each(['', 'abc', '0', '-1', Number.POSITIVE_INFINITY])(
        'usa el fallback seguro para un factor inválido %s',
        (packSize) => {
            expect(purchaseQuantityInputStep(measuredProduct({ packSize }), 'PACK')).toBe('1');
        },
    );
});
