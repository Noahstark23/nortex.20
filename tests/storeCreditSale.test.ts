import { describe, expect, it } from 'vitest';
import { buildSaleJournalLines } from '../backend/services/accounting';
import { CreateSaleSchema } from '../backend/services/salesService';

const balance = (lines: Array<{ debit: number; credit: number }>) => lines.reduce(
    (sum, line) => sum + line.debit - line.credit,
    0,
);

describe('saldo a favor aplicado a una venta', () => {
    it('divide el debe entre la obligación con el cliente y el medio de cobro', () => {
        const lines = buildSaleJournalLines(115, 60, 'CASH', 0, { storeCreditApplied: 40 });
        expect(lines).toContainEqual({ accountCode: '1.1.1', debit: 75, credit: 0 });
        expect(lines).toContainEqual({ accountCode: '2.1.14', debit: 40, credit: 0 });
        expect(Math.abs(balance(lines))).toBeLessThan(0.000001);
    });

    it('permite que el saldo cubra el total sin inventar entrada de caja', () => {
        const lines = buildSaleJournalLines(115, 60, 'TRANSFER', 0, { storeCreditApplied: 115 });
        expect(lines.some((line) => line.accountCode === '1.1.1')).toBe(false);
        expect(lines).toContainEqual({ accountCode: '2.1.14', debit: 115, credit: 0 });
        expect(Math.abs(balance(lines))).toBeLessThan(0.000001);
    });

    it('rechaza montos negativos o mayores que la venta', () => {
        expect(() => buildSaleJournalLines(100, 0, 'CASH', 0, { storeCreditApplied: -1 })).toThrow(
            'El saldo a favor aplicado debe estar entre cero y el total de la venta',
        );
        expect(() => buildSaleJournalLines(100, 0, 'CASH', 0, { storeCreditApplied: 101 })).toThrow(
            'El saldo a favor aplicado debe estar entre cero y el total de la venta',
        );
    });

    it('valida el contrato de checkout con trazabilidad opcional a la devolución', () => {
        const parsed = CreateSaleSchema.safeParse({
            items: [{ id: 'product-1', quantity: '1' }],
            paymentMethod: 'CASH',
            customerId: 'customer-1',
            storeCreditAmount: '25.50',
            storeCreditSourceReturnId: 'return-1',
        });
        expect(parsed.success).toBe(true);
        expect(CreateSaleSchema.safeParse({
            items: [{ id: 'product-1', quantity: '1' }], paymentMethod: 'CASH', storeCreditAmount: '-1',
        }).success).toBe(false);
    });
});
