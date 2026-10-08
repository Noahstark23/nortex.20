import { describe, expect, it } from 'vitest';
import { SupplierPaymentRequestSchema } from '../backend/validation/schemas';

describe('SupplierPaymentRequestSchema', () => {
    it('conserva el body vacío para liquidación total legacy', () => {
        expect(SupplierPaymentRequestSchema.parse({})).toEqual({});
    });

    it('conserva el importe como string decimal y acepta UUID para abonos', () => {
        expect(SupplierPaymentRequestSchema.parse({
            amount: '25.12',
            method: 'TRANSFER',
            clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8277',
            reference: ' TRX-42 ',
        })).toEqual({
            amount: '25.12',
            method: 'TRANSFER',
            clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8277',
            reference: 'TRX-42',
        });
    });

    it.each([
        { amount: '0' },
        { amount: '-1' },
        { amount: '1.001' },
        { amount: '9999999999.991' },
        { amount: '10', method: 'CREDIT' },
        { amount: '10', clientEventId: 'no-es-uuid' },
        { amount: '10', unexpected: true },
    ])('rechaza payload inválido %#', (payload) => {
        expect(SupplierPaymentRequestSchema.safeParse(payload).success).toBe(false);
    });

    it('normaliza null y vacío opcionales sin convertirlos en datos persistibles', () => {
        expect(SupplierPaymentRequestSchema.parse({ reference: null, notes: '' })).toEqual({
            reference: undefined,
            notes: undefined,
        });
    });
});
