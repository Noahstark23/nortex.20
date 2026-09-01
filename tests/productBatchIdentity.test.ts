import { describe, expect, it } from 'vitest';
import {
    assertProductBatchExpiryIdentity,
    PRODUCT_BATCH_EXPIRY_CONFLICT_CODE,
    ProductBatchIdentityError,
} from '../backend/lib/productBatchIdentity';

describe('identidad civil de producto+lote', () => {
    it('acepta el mismo vencimiento impreso aunque una fecha este a 00Z y otra a 12Z', () => {
        expect(() => assertProductBatchExpiryIdentity({
            productId: 'product-a',
            batchNumber: 'L-01',
            existingExpiryDate: new Date('2027-08-12T00:00:00.000Z'),
            incomingExpiryDate: new Date('2027-08-12T12:00:00.000Z'),
        })).not.toThrow();
    });

    it('rechaza mezclar el mismo producto+lote con otro vencimiento usando error estable', () => {
        try {
            assertProductBatchExpiryIdentity({
                productId: 'product-a',
                productName: 'Amoxicilina 500 mg',
                batchNumber: 'L-01',
                existingExpiryDate: '2027-08-12',
                incomingExpiryDate: '2027-09-12',
            });
            throw new Error('se esperaba conflicto');
        } catch (error) {
            expect(error).toBeInstanceOf(ProductBatchIdentityError);
            expect(error).toMatchObject({
                name: 'ProductBatchIdentityError',
                code: PRODUCT_BATCH_EXPIRY_CONFLICT_CODE,
                httpStatus: 409,
                message: 'El lote L-01 de Amoxicilina 500 mg ya tiene otro vencimiento',
                details: {
                    productId: 'product-a',
                    batchNumber: 'L-01',
                    existingExpiryDate: '2027-08-12',
                    incomingExpiryDate: '2027-09-12',
                },
            });
        }
    });

    it.each([
        ['2027-02-30', 'La fecha de vencimiento del lote es invalida'],
        ['2027-8-12', 'La fecha de vencimiento del lote debe usar YYYY-MM-DD'],
        ['2027-08-12 extra', 'La fecha de vencimiento del lote debe usar YYYY-MM-DD'],
        ['x2027-08-12', 'La fecha de vencimiento del lote debe usar YYYY-MM-DD'],
    ])('rechaza fechas string inválidas: %s', (incomingExpiryDate, message) => {
        expect(() => assertProductBatchExpiryIdentity({
            productId: 'product-a',
            batchNumber: 'L-01',
            existingExpiryDate: '2027-08-12',
            incomingExpiryDate,
        })).toThrowError(new RangeError(message));
    });

    it('rechaza fechas Date inválidas antes de comparar identidad', () => {
        expect(() => assertProductBatchExpiryIdentity({
            productId: 'product-a',
            batchNumber: 'L-01',
            existingExpiryDate: new Date('invalid'),
            incomingExpiryDate: new Date('2027-08-12T12:00:00.000Z'),
        })).toThrowError(new RangeError('La fecha de vencimiento del lote es invalida'));
    });

    it('mantiene el mensaje base si el conflicto no trae nombre de producto', () => {
        expect(() => assertProductBatchExpiryIdentity({
            productId: 'product-a',
            batchNumber: 'L-01',
            existingExpiryDate: '2027-08-12',
            incomingExpiryDate: '2027-09-12',
        })).toThrowError('El lote L-01 ya tiene otro vencimiento');
    });
});
