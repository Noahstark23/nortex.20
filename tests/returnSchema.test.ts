import { describe, expect, it } from 'vitest';
import { CreateReturnSchema } from '../backend/validation/schemas';

const payloadWithQuantity = (quantity: string | number) => ({
    clientEventId: '018f47cb-52d6-7f6a-8b41-25db4b0ae1a9',
    saleId: 'sale-001',
    items: [{ saleItemId: 'sale-item-001', quantity }],
    reason: 'Producto devuelto por el cliente',
});

describe('CreateReturnSchema — identidad de línea y cantidades decimales', () => {
    it('acepta saleItemId y conserva 0.50 como texto Decimal-safe', () => {
        const result = CreateReturnSchema.safeParse(payloadWithQuantity('0.50'));

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.items[0]).toMatchObject({
            saleItemId: 'sale-item-001',
            quantity: '0.50',
        });
    });

    it('acepta productId legacy para que el servicio decida si es inequívoco', () => {
        const result = CreateReturnSchema.safeParse({
            clientEventId: '018f47cb-52d6-7f6a-8b41-25db4b0ae1aa',
            saleId: 'sale-legacy',
            items: [{ productId: 'product-meat', quantity: 0.5 }],
            reason: 'Devolución legacy',
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.items[0]).toEqual({
            productId: 'product-meat',
            quantity: '0.5',
        });
    });

    it('requiere saleItemId o productId en cada entrada', () => {
        const result = CreateReturnSchema.safeParse({
            clientEventId: '018f47cb-52d6-7f6a-8b41-25db4b0ae1ab',
            saleId: 'sale-001',
            items: [{ quantity: '0.50' }],
            reason: 'Sin identidad',
        });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ message: 'saleItemId requerido' }),
        ]));
    });

    it.each([
        ['cero', '0'],
        ['negativa', '-0.50'],
        ['no finita', 'Infinity'],
        ['más de cuatro decimales', '0.00001'],
    ])('rechaza cantidad %s (%s)', (_label, quantity) => {
        expect(CreateReturnSchema.safeParse(payloadWithQuantity(quantity)).success).toBe(false);
    });

    it.each(['CASH', 'CARD', 'TRANSFER', 'QR'] as const)(
        'acepta refundMethod opcional %s',
        (refundMethod) => {
            const result = CreateReturnSchema.safeParse({
                ...payloadWithQuantity('0.50'),
                refundMethod,
            });

            expect(result.success).toBe(true);
            if (result.success) expect(result.data.refundMethod).toBe(refundMethod);
        },
    );

    it.each(['CREDIT', 'CRYPTO'])('rechaza refundMethod no permitido %s', (refundMethod) => {
        expect(CreateReturnSchema.safeParse({
            ...payloadWithQuantity('0.50'),
            refundMethod,
        }).success).toBe(false);
    });

    it('exige una clave de idempotencia en el contrato nuevo', () => {
        const { clientEventId: _omitted, ...withoutEvent } = payloadWithQuantity('0.50');
        expect(CreateReturnSchema.safeParse(withoutEvent).success).toBe(false);
    });

    it('normaliza bordes y limita la clave de idempotencia', () => {
        const valid = CreateReturnSchema.safeParse({
            ...payloadWithQuantity('0.50'),
            clientEventId: '  retry-return-0001  ',
        });
        expect(valid.success).toBe(true);
        if (valid.success) expect(valid.data.clientEventId).toBe('retry-return-0001');

        expect(CreateReturnSchema.safeParse({
            ...payloadWithQuantity('0.50'),
            clientEventId: 'short',
        }).success).toBe(false);
        expect(CreateReturnSchema.safeParse({
            ...payloadWithQuantity('0.50'),
            clientEventId: 'x'.repeat(129),
        }).success).toBe(false);
    });
});
