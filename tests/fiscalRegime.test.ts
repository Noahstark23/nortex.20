import { describe, expect, it } from 'vitest';
import {
    FISCAL_REGIME_CUOTA_FIJA,
    FISCAL_REGIME_GENERAL,
    hasFiscalRegimeVersionConflict,
    includedVatFromGross,
    normalizeFiscalRegime,
    resolveSaleFiscalAmounts,
} from '../utils/fiscalRegime';
import {
    buildPurchaseJournalLines,
    buildReturnJournalLines,
    buildSaleJournalLines,
} from '../backend/services/accounting';

describe('régimen fiscal', () => {
    it('normaliza solo CUOTA_FIJA y conserva GENERAL como default seguro', () => {
        expect(normalizeFiscalRegime(FISCAL_REGIME_CUOTA_FIJA)).toBe(FISCAL_REGIME_CUOTA_FIJA);
        expect(normalizeFiscalRegime(FISCAL_REGIME_GENERAL)).toBe(FISCAL_REGIME_GENERAL);
        expect(normalizeFiscalRegime(undefined)).toBe(FISCAL_REGIME_GENERAL);
        expect(normalizeFiscalRegime(null)).toBe(FISCAL_REGIME_GENERAL);
        expect(normalizeFiscalRegime('cuota_fija')).toBe(FISCAL_REGIME_GENERAL);
        expect(normalizeFiscalRegime('DESCONOCIDO')).toBe(FISCAL_REGIME_GENERAL);
    });

    it('GENERAL reconoce el IVA autoritativo y el ingreso por complemento', () => {
        const result = resolveSaleFiscalAmounts('315.0000', '15.0000', FISCAL_REGIME_GENERAL);

        expect(result.fiscalRegime).toBe(FISCAL_REGIME_GENERAL);
        expect(result.vatAmount.toFixed(4)).toBe('15.0000');
        expect(result.netRevenue.toFixed(4)).toBe('300.0000');
        expect(result.netRevenue.plus(result.vatAmount).toFixed(4)).toBe('315.0000');
    });

    it('desglosa IVA incluido de la porción gravada con precisión DGI', () => {
        expect(includedVatFromGross(0).toFixed(4)).toBe('0.0000');
        expect(includedVatFromGross(115).toFixed(4)).toBe('15.0000');
        expect(includedVatFromGross(100).toFixed(4)).toBe('13.0435');
        expect(() => includedVatFromGross(-0.0001)).toThrowError(
            'La venta gravada debe ser finita y no negativa',
        );
        expect(() => includedVatFromGross(Number.NaN)).toThrow();
        expect(() => includedVatFromGross(Number.POSITIVE_INFINITY)).toThrow();
    });

    it('CUOTA_FIJA lleva IVA trasladado a cero sin convertir el total en exento', () => {
        const result = resolveSaleFiscalAmounts('315.0000', '15.0000', FISCAL_REGIME_CUOTA_FIJA);

        expect(result.fiscalRegime).toBe(FISCAL_REGIME_CUOTA_FIJA);
        expect(result.vatAmount.toFixed(4)).toBe('0.0000');
        expect(result.netRevenue.toFixed(4)).toBe('315.0000');
    });

    it('permite clientes legacy solo en v1 y concilia toda versión ausente tras un cambio', () => {
        expect(hasFiscalRegimeVersionConflict(undefined, 1)).toBe(false);
        expect(hasFiscalRegimeVersionConflict(null, 1)).toBe(false);
        expect(hasFiscalRegimeVersionConflict(undefined, 3)).toBe(true);
        expect(hasFiscalRegimeVersionConflict(null, 3)).toBe(true);
        expect(hasFiscalRegimeVersionConflict(3, 3)).toBe(false);
        expect(hasFiscalRegimeVersionConflict(2, 3)).toBe(true);
        expect(hasFiscalRegimeVersionConflict(4, 3)).toBe(true);
    });

    it('redondea a cuatro decimales y mantiene la identidad contable', () => {
        const result = resolveSaleFiscalAmounts('115.00006', '15.00006', FISCAL_REGIME_GENERAL);

        expect(result.vatAmount.toFixed(4)).toBe('15.0001');
        expect(result.netRevenue.toFixed(4)).toBe('100.0000');
        expect(result.netRevenue.plus(result.vatAmount).toFixed(4)).toBe('115.0001');
    });

    it.each([
        ['-0.0001', '0'],
        ['NaN', '0'],
        ['Infinity', '0'],
        ['10', '-0.0001'],
        ['10', '10.0001'],
        ['10', 'NaN'],
    ])('rechaza montos incompatibles total=%s iva=%s', (total, vat) => {
        expect(() => resolveSaleFiscalAmounts(total, vat, FISCAL_REGIME_GENERAL)).toThrow();
    });

    it('expone errores distintos para total e IVA inválidos', () => {
        expect(() => resolveSaleFiscalAmounts(-1, 0)).toThrowError(
            'El total de venta debe ser finito y no negativo',
        );
        expect(() => resolveSaleFiscalAmounts(10, 11)).toThrowError(
            'El IVA general debe estar entre cero y el total de venta',
        );
    });
});

const journalBalance = (lines: Array<{ debit: number; credit: number }>): number => (
    lines.reduce((sum, line) => sum + line.debit - line.credit, 0)
);

describe('asientos por régimen fiscal', () => {
    it('mantiene GENERAL como default y el desglose histórico con exoneración', () => {
        const lines = buildSaleJournalLines(315, 200, 'CASH', 200);

        expect(lines).toEqual([
            { accountCode: '1.1.1', debit: 315, credit: 0 },
            { accountCode: '4.1.1', debit: 0, credit: 300 },
            { accountCode: '2.1.2', debit: 0, credit: 15 },
            { accountCode: '5.1.1', debit: 200, credit: 0 },
            { accountCode: '1.1.4', debit: 0, credit: 200 },
        ]);
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('usa el IVA persistido en GENERAL en vez de recalcularlo', () => {
        const lines = buildSaleJournalLines(115, 60, 'CREDIT', 0, {
            fiscalRegime: FISCAL_REGIME_GENERAL,
            vatAmount: '14.5000',
        });

        expect(lines[0]).toEqual({ accountCode: '1.1.3', debit: 115, credit: 0 });
        expect(lines[1]).toEqual({ accountCode: '4.1.1', debit: 0, credit: 100.5 });
        expect(lines[2]).toEqual({ accountCode: '2.1.2', debit: 0, credit: 14.5 });
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('CUOTA_FIJA reconoce todo como ingreso y cero IVA aunque exista desglose general', () => {
        const lines = buildSaleJournalLines(315, 200, 'CASH', 200, {
            fiscalRegime: FISCAL_REGIME_CUOTA_FIJA,
            vatAmount: 15,
        });

        expect(lines[1]).toEqual({ accountCode: '4.1.1', debit: 0, credit: 315 });
        expect(lines[2]).toEqual({ accountCode: '2.1.2', debit: 0, credit: 0 });
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rechaza costo de venta inválido %s',
        (cost) => {
            expect(() => buildSaleJournalLines(115, cost, 'CASH')).toThrowError(
                'El costo de venta debe ser finito y no negativo',
            );
        },
    );

    it('la devolución de CUOTA_FIJA revierte ingreso completo y nunca IVA', () => {
        const lines = buildReturnJournalLines({
            total: 315,
            costTotal: 200,
            exemptTotal: 200,
            fiscalRegime: FISCAL_REGIME_CUOTA_FIJA,
            creditReduction: 100,
            settledRefund: 215,
            refundMethod: 'TRANSFER',
        });

        expect(lines[0]).toEqual({ accountCode: '4.1.2', debit: 315, credit: 0 });
        expect(lines[1]).toEqual({ accountCode: '2.1.2', debit: 0, credit: 0 });
        expect(lines[3]).toEqual({ accountCode: '1.1.3', debit: 0, credit: 100 });
        expect(lines[4]).toEqual({ accountCode: '1.1.2', debit: 0, credit: 215 });
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('la devolución legacy conserva el desglose GENERAL', () => {
        const lines = buildReturnJournalLines({
            total: 315,
            costTotal: 200,
            exemptTotal: 200,
            creditReduction: 0,
            settledRefund: 315,
            refundMethod: 'CASH',
        });

        expect(lines[0]).toEqual({ accountCode: '4.1.2', debit: 300, credit: 0 });
        expect(lines[1]).toEqual({ accountCode: '2.1.2', debit: 15, credit: 0 });
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('rechaza y nombra cada monto inválido de la devolución', () => {
        const base = {
            total: 115,
            costTotal: 60,
            exemptTotal: 0,
            creditReduction: 0,
            settledRefund: 115,
            refundMethod: 'CASH' as const,
        };
        for (const field of [
            'total',
            'costTotal',
            'exemptTotal',
            'creditReduction',
            'settledRefund',
        ] as const) {
            expect(() => buildReturnJournalLines({ ...base, [field]: -1 })).toThrowError(
                `${field} debe ser finito y no negativo`,
            );
            expect(() => buildReturnJournalLines({ ...base, [field]: 'invalido' })).toThrowError(
                `${field} no es un monto decimal válido`,
            );
        }
    });

    it('rechaza exento mayor al total y una contrapartida incompleta', () => {
        expect(() => buildReturnJournalLines({
            total: 115,
            costTotal: 60,
            exemptTotal: 116,
            creditReduction: 0,
            settledRefund: 115,
            refundMethod: 'CASH',
        })).toThrowError('exemptTotal no puede superar el total de la devolución');
        expect(() => buildReturnJournalLines({
            total: 115,
            costTotal: 60,
            exemptTotal: 0,
            creditReduction: 0,
            settledRefund: 114,
            refundMethod: 'CASH',
        })).toThrowError(
            'creditReduction + settledRefund + storeCreditRestoration debe reconstruir exactamente el total de la devolución',
        );
    });

    it('compra legacy acredita tax; crédito cero capitaliza todo en inventario', () => {
        const legacy = buildPurchaseJournalLines(115, 15, 'CASH');
        const cuotaFija = buildPurchaseJournalLines(115, 15, 'CREDIT', 0);

        expect(legacy).toEqual([
            { accountCode: '1.1.4', debit: 100, credit: 0 },
            { accountCode: '1.1.5', debit: 15, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: 115 },
        ]);
        expect(cuotaFija).toEqual([
            { accountCode: '1.1.4', debit: 115, credit: 0 },
            { accountCode: '1.1.5', debit: 0, credit: 0 },
            { accountCode: '2.1.1', debit: 0, credit: 115 },
        ]);
        expect(Math.abs(journalBalance(legacy))).toBeLessThan(0.0001);
        expect(Math.abs(journalBalance(cuotaFija))).toBeLessThan(0.0001);
    });

    it('admite crédito fiscal parcial sin descuadrar la compra', () => {
        const lines = buildPurchaseJournalLines('115.00004', 15, 'TRANSFER', '5.00004');

        expect(lines).toEqual([
            { accountCode: '1.1.4', debit: 110, credit: 0 },
            { accountCode: '1.1.5', debit: 5, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: 115 },
        ]);
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('postea en centavos el caso mínimo que antes dejaba CxP en 0.1150', () => {
        const lines = buildPurchaseJournalLines('0.115', '0.015', 'CREDIT', '0.015');

        expect(lines).toEqual([
            { accountCode: '1.1.4', debit: 0.1, credit: 0 },
            { accountCode: '1.1.5', debit: 0.02, credit: 0 },
            { accountCode: '2.1.1', debit: 0, credit: 0.12 },
        ]);
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('postea una PPV desfavorable sin inflar Inventario sobre el costo de la OC', () => {
        const lines = buildPurchaseJournalLines(125, 15, 'CREDIT', 15, 100);

        expect(lines).toEqual([
            { accountCode: '1.1.4', debit: 100, credit: 0 },
            { accountCode: '1.1.5', debit: 15, credit: 0 },
            { accountCode: '5.1.3', debit: 10, credit: 0 },
            { accountCode: '2.1.1', debit: 0, credit: 125 },
        ]);
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('acredita una PPV favorable y conserva el costo estándar en Inventario', () => {
        const lines = buildPurchaseJournalLines(105, 15, 'CASH', 15, 100);

        expect(lines).toEqual([
            { accountCode: '1.1.4', debit: 100, credit: 0 },
            { accountCode: '1.1.5', debit: 15, credit: 0 },
            { accountCode: '5.1.3', debit: 0, credit: 10 },
            { accountCode: '1.1.1', debit: 0, credit: 105 },
        ]);
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it('omite PPV cuando costo factura y costo esperado coinciden a centavos', () => {
        const lines = buildPurchaseJournalLines('115.004', 15, 'CREDIT', 15, '100.004');

        expect(lines).toEqual([
            { accountCode: '1.1.4', debit: 100, credit: 0 },
            { accountCode: '1.1.5', debit: 15, credit: 0 },
            { accountCode: '2.1.1', debit: 0, credit: 115 },
        ]);
    });

    it('en CUOTA_FIJA deja IVA no acreditable visible en PPV y no en Inventario', () => {
        const lines = buildPurchaseJournalLines(115, 15, 'CREDIT', 0, 100);

        expect(lines).toEqual([
            { accountCode: '1.1.4', debit: 100, credit: 0 },
            { accountCode: '1.1.5', debit: 0, credit: 0 },
            { accountCode: '5.1.3', debit: 15, credit: 0 },
            { accountCode: '2.1.1', debit: 0, credit: 115 },
        ]);
        expect(Math.abs(journalBalance(lines))).toBeLessThan(0.0001);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
        'rechaza costo esperado de OC inválido: %s',
        (expected) => {
            expect(() => buildPurchaseJournalLines(115, 15, 'CREDIT', 15, expected))
                .toThrowError('El costo esperado de inventario debe ser finito y no negativo');
        },
    );

    it.each([
        [-1, 0, undefined],
        [10, -1, undefined],
        [10, 11, undefined],
        [10, 1, -1],
        [10, 1, 2],
        [10, Number.NaN, undefined],
    ])('rechaza compra inválida total=%s tax=%s acreditable=%s', (total, tax, creditable) => {
        expect(() => buildPurchaseJournalLines(total, tax, 'CASH', creditable)).toThrow();
    });

    it('distingue las tres fronteras inválidas de una compra', () => {
        expect(() => buildPurchaseJournalLines(-1, 0, 'CASH', 0)).toThrowError(
            'El total de compra debe ser finito y no negativo',
        );
        expect(() => buildPurchaseJournalLines(Number.NaN, 0, 'CASH', 0)).toThrowError(
            'El total de compra debe ser finito y no negativo',
        );
        expect(() => buildPurchaseJournalLines(10, -1, 'CASH', 0)).toThrowError(
            'El IVA de compra debe estar entre cero y el total de compra',
        );
        expect(() => buildPurchaseJournalLines(10, 11, 'CASH', 0)).toThrowError(
            'El IVA de compra debe estar entre cero y el total de compra',
        );
        expect(() => buildPurchaseJournalLines(10, 1, 'CASH', -1)).toThrowError(
            'El crédito fiscal debe estar entre cero y el IVA de compra',
        );
        expect(() => buildPurchaseJournalLines(10, 1, 'CASH', 2)).toThrowError(
            'El crédito fiscal debe estar entre cero y el IVA de compra',
        );
        expect(() => buildPurchaseJournalLines('-0.001', 0, 'CASH', 0)).toThrowError(
            'El total de compra debe ser finito y no negativo',
        );
    });
});
