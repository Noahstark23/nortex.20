import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildReturnJournalLines } from '../backend/services/accounting';

type JournalLine = {
    accountCode: string;
    debit: number;
    credit: number;
};

const amountFor = (
    lines: JournalLine[],
    accountCode: string,
    side: 'debit' | 'credit',
): Decimal => lines
    .filter((line) => line.accountCode === accountCode)
    .reduce((sum, line) => sum.plus(line[side]), new Decimal(0));

const expectBalanced = (lines: JournalLine[]) => {
    const debit = lines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0));
    const credit = lines.reduce((sum, line) => sum.plus(line.credit), new Decimal(0));

    expect(debit.toString()).toBe(credit.toString());
};

const build = (overrides: Partial<{
    total: number;
    costTotal: number;
    exemptTotal: number | null;
    creditReduction: number;
    settledRefund: number;
    refundMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'QR';
}> = {}) => buildReturnJournalLines({
    total: 115,
    costTotal: 60,
    creditReduction: 0,
    settledRefund: 115,
    refundMethod: 'CASH',
    ...overrides,
});

describe('partida contable de devoluciones según saldo del crédito', () => {
    it('venta no crédito: acredita toda la devolución a Caja', () => {
        const lines = build();

        expect(amountFor(lines, '1.1.1', 'credit').toString()).toBe('115');
        expect(amountFor(lines, '1.1.3', 'credit').toString()).toBe('0');
        expectBalanced(lines);
    });

    it('crédito totalmente impago: reduce Cuentas por Cobrar y no Caja', () => {
        const lines = build({ creditReduction: 115, settledRefund: 0 });

        expect(amountFor(lines, '1.1.3', 'credit').toString()).toBe('115');
        expect(amountFor(lines, '1.1.1', 'credit').toString()).toBe('0');
        expectBalanced(lines);
    });

    it('crédito parcialmente pagado: divide la contrapartida entre CxC y Caja', () => {
        const lines = build({ creditReduction: 40, settledRefund: 75 });

        expect(amountFor(lines, '1.1.3', 'credit').toString()).toBe('40');
        expect(amountFor(lines, '1.1.1', 'credit').toString()).toBe('75');
        expect(
            amountFor(lines, '1.1.3', 'credit')
                .plus(amountFor(lines, '1.1.1', 'credit'))
                .toString(),
        ).toBe('115');
        expectBalanced(lines);
    });

    it('crédito ya pagado: reembolsa todo por Caja sin reducir CxC', () => {
        const lines = build({ creditReduction: 0, settledRefund: 115 });

        expect(amountFor(lines, '1.1.1', 'credit').toString()).toBe('115');
        expect(amountFor(lines, '1.1.3', 'credit').toString()).toBe('0');
        expectBalanced(lines);
    });

    it('crédito ya pagado por tarjeta: acredita Bancos y nunca Caja', () => {
        const lines = build({
            creditReduction: 0,
            settledRefund: 115,
            refundMethod: 'CARD',
        });

        expect(amountFor(lines, '1.1.2', 'credit').toString()).toBe('115');
        expect(amountFor(lines, '1.1.1', 'credit').toString()).toBe('0');
        expect(amountFor(lines, '1.1.3', 'credit').toString()).toBe('0');
        expectBalanced(lines);
    });
});

describe('canal del importe ya liquidado', () => {
    it('CARD acredita Bancos y no crea contrapartida en Caja', () => {
        const lines = build({ refundMethod: 'CARD' });

        expect(amountFor(lines, '1.1.2', 'credit').toString()).toBe('115');
        expect(amountFor(lines, '1.1.1', 'credit').toString()).toBe('0');
        expectBalanced(lines);
    });

    it.each(['QR', 'TRANSFER'] as const)('%s también acredita Bancos', (refundMethod) => {
        const lines = build({ refundMethod });

        expect(amountFor(lines, '1.1.2', 'credit').toString()).toBe('115');
        expect(amountFor(lines, '1.1.1', 'credit').toString()).toBe('0');
        expectBalanced(lines);
    });
});

describe('exactitud e invariantes del asiento de devolución', () => {
    it('revierte ingreso, IVA y costo en las cuentas exactas y conserva centavos', () => {
        const lines = buildReturnJournalLines({
            total: 100,
            costTotal: 33.33,
            creditReduction: 30.01,
            settledRefund: 69.99,
            refundMethod: 'CASH',
        });

        expect(amountFor(lines, '4.1.2', 'debit').toFixed(4)).toBe('86.9565');
        expect(amountFor(lines, '2.1.2', 'debit').toFixed(4)).toBe('13.0435');
        expect(amountFor(lines, '1.1.4', 'debit').toFixed(2)).toBe('33.33');
        expect(amountFor(lines, '5.1.1', 'credit').toFixed(2)).toBe('33.33');
        expect(amountFor(lines, '1.1.3', 'credit').toFixed(2)).toBe('30.01');
        expect(amountFor(lines, '1.1.1', 'credit').toFixed(2)).toBe('69.99');
        expectBalanced(lines);
    });

    it('devolución totalmente exenta: revierte todo el ingreso y ningún IVA', () => {
        const lines = build({ exemptTotal: 115 });

        expect(amountFor(lines, '4.1.2', 'debit').toFixed(4)).toBe('115.0000');
        expect(amountFor(lines, '2.1.2', 'debit').toFixed(4)).toBe('0.0000');
        expect(amountFor(lines, '1.1.1', 'credit').toFixed(2)).toBe('115.00');
        expectBalanced(lines);
    });

    it('devolución mixta: calcula ingreso e IVA solo sobre la parte gravada', () => {
        const lines = build({ exemptTotal: 50 });

        // total 115, exento 50: ingreso = 50 + 65/1.15; IVA = 65 - 65/1.15.
        expect(amountFor(lines, '4.1.2', 'debit').toFixed(4)).toBe('106.5217');
        expect(amountFor(lines, '2.1.2', 'debit').toFixed(4)).toBe('8.4783');
        expect(
            amountFor(lines, '4.1.2', 'debit')
                .plus(amountFor(lines, '2.1.2', 'debit'))
                .toFixed(4),
        ).toBe('115.0000');
        expectBalanced(lines);
    });

    it('rechaza un split que no reconstruye exactamente el total', () => {
        expect(() => build({ creditReduction: 40, settledRefund: 74.99 })).toThrow();
        expect(() => build({ creditReduction: 40, settledRefund: 75.01 })).toThrow();
    });

    it.each([
        ['total', { total: -1 }],
        ['costTotal', { costTotal: -1 }],
        ['exemptTotal', { exemptTotal: -1 }],
        ['creditReduction', { creditReduction: -1, settledRefund: 116 }],
        ['settledRefund', { creditReduction: 116, settledRefund: -1 }],
    ] as const)('rechaza %s negativo', (_field, overrides) => {
        expect(() => build(overrides)).toThrow();
    });
});
