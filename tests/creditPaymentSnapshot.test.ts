import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { creditPaymentResponseBalances, newCreditPaymentSnapshot } from '../backend/services/creditPaymentSnapshot';

describe('respuesta de un abono confirmado', () => {
    it('separa saldo de factura y deuda total sin perder centavos', () => {
        const snapshot = newCreditPaymentSnapshot('pago-1', new Decimal('4.00'), new Decimal('44.00'));
        expect(snapshot).toEqual({ replayed: false, paymentId: 'pago-1', saleBalance: '4.00', customerDebt: '44.00' });
        expect(creditPaymentResponseBalances(snapshot)).toEqual({ balance: 4, customerDebt: 44, status: 'CREDIT_PENDING' });
    });

    it('marca pagada la factura sin borrar la deuda de otras facturas', () => {
        const snapshot = newCreditPaymentSnapshot('pago-2', new Decimal('0'), new Decimal('40.50'));
        expect(snapshot.saleBalance).toBe('0.00');
        expect(creditPaymentResponseBalances(snapshot)).toEqual({ balance: 0, customerDebt: 40.5, status: 'PAID' });
    });

    it('conserva la ausencia de cliente identificado', () => {
        const snapshot = newCreditPaymentSnapshot('pago-3', new Decimal('0'), null);
        expect(snapshot.customerDebt).toBeNull();
        expect(creditPaymentResponseBalances(snapshot)).toEqual({ balance: 0, customerDebt: null, status: 'PAID' });
    });
});
