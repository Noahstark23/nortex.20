import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildPaymentJournalLines, buildReturnJournalLines, buildSaleJournalLines } from '../backend/services/accounting';

type Line = { accountCode: string; debit: number; credit: number };
const balance = (lines: Line[], code: string) => lines.filter(line => line.accountCode === code)
    .reduce((sum, line) => sum.plus(line.debit).minus(line.credit), new Decimal(0)).toFixed(4);

describe('el canal cobrado conserva su cuenta a través de venta, abono y devolución', () => {
    it.each(['CASH', 'CARD', 'TRANSFER', 'QR'] as const)('%s revierte el mismo activo al devolver lo cobrado', method => {
        const sale = buildSaleJournalLines('100', '40', method, '100');
        const refund = buildReturnJournalLines({ total: '100', costTotal: '40', exemptTotal: '100',
            creditReduction: '0', settledRefund: '100', refundMethod: method, refundPending: false });
        expect(balance(sale, '1.1.1')).toBe(method === 'CASH' ? '100.0000' : '0.0000');
        expect(balance(sale, '1.1.2')).toBe(method === 'CASH' ? '0.0000' : '100.0000');
        expect(balance([...sale, ...refund], '1.1.1')).toBe('0.0000');
        expect(balance([...sale, ...refund], '1.1.2')).toBe('0.0000');
        expect(balance([...sale, ...refund], '1.1.4')).toBe('0.0000');
    });

    it.each(['CASH', 'CARD', 'TRANSFER', 'QR'] as const)('fiado y abono %s no ingresan dos veces dinero', method => {
        const creditSale = buildSaleJournalLines('100', '40', 'CREDIT', '100');
        const payment = buildPaymentJournalLines('100', method);
        const directSale = buildSaleJournalLines('100', '40', method, '100');
        for (const code of ['1.1.1', '1.1.2', '1.1.3']) {
            expect(balance([...creditSale, ...payment], code)).toBe(balance(directSale, code));
        }
    });

    it('saldo a favor parcial consume el pasivo y solo registra el remanente bancario', () => {
        const lines = buildSaleJournalLines('100', '40', 'TRANSFER', '100', { storeCreditApplied: '40' });
        expect(balance(lines, '2.1.14')).toBe('40.0000');
        expect(balance(lines, '1.1.2')).toBe('60.0000');
        expect(balance(lines, '1.1.1')).toBe('0.0000');
    });

    it.each(['', 'UNKNOWN', 'cash', 'CARD ', 'NORTEX_CAPITAL'])('rechaza un canal de venta sin contrato: %j', method => {
        expect(() => buildSaleJournalLines('100', '40', method, '100')).toThrow(/medio de pago/i);
    });
});
