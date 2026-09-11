import { describe, expect, it } from 'vitest';
import { calculatePurchaseMoney } from '../backend/lib/purchaseMoney';
import {
    PURCHASE_TAX_SIN_TRASLADO,
    PURCHASE_TAX_TRASLADADO,
} from '../utils/purchaseTaxTreatment';

const moneySnapshot = (result: ReturnType<typeof calculatePurchaseMoney>) => ({
    lines: result.lines.map((line) => ({
        lineNet: line.lineNet.toFixed(2),
        lineTax: line.lineTax.toFixed(2),
        creditableTax: line.creditableTax.toFixed(2),
        lineTotal: line.lineTotal.toFixed(2),
    })),
    subtotal: result.subtotal.toFixed(2),
    tax: result.tax.toFixed(2),
    creditableTax: result.creditableTax.toFixed(2),
    total: result.total.toFixed(2),
});

describe('totales monetarios autoritativos de compras', () => {
    it('hace liquidable en centavos una línea gravada de C$0.10', () => {
        expect(moneySnapshot(calculatePurchaseMoney([
            { lineNet: '0.10', taxable: true },
        ], true, PURCHASE_TAX_TRASLADADO))).toEqual({
            lines: [{
                lineNet: '0.10',
                lineTax: '0.02',
                creditableTax: '0.02',
                lineTotal: '0.12',
            }],
            subtotal: '0.10',
            tax: '0.02',
            creditableTax: '0.02',
            total: '0.12',
        });
    });

    it('redondea cada línea antes de sumar, no el agregado de la factura', () => {
        const result = calculatePurchaseMoney([
            { lineNet: '0.03', taxable: true },
            { lineNet: '0.03', taxable: true },
            { lineNet: '0.03', taxable: true },
        ], true, PURCHASE_TAX_TRASLADADO);

        expect(result.lines.map((line) => line.lineTax.toFixed(2))).toEqual(['0.00', '0.00', '0.00']);
        expect(result.subtotal.toFixed(2)).toBe('0.09');
        expect(result.tax.toFixed(2)).toBe('0.00');
        expect(result.total.toFixed(2)).toBe('0.09');
    });

    it('aplica HALF_UP a la base y separa las líneas exentas', () => {
        expect(moneySnapshot(calculatePurchaseMoney([
            { lineNet: '0.105', taxable: true },
            { lineNet: '0.104', taxable: false },
            { lineNet: '1.00', taxable: true },
        ], true, PURCHASE_TAX_TRASLADADO))).toEqual({
            lines: [
                { lineNet: '0.11', lineTax: '0.02', creditableTax: '0.02', lineTotal: '0.13' },
                { lineNet: '0.10', lineTax: '0.00', creditableTax: '0.00', lineTotal: '0.10' },
                { lineNet: '1.00', lineTax: '0.15', creditableTax: '0.15', lineTotal: '1.15' },
            ],
            subtotal: '1.21',
            tax: '0.17',
            creditableTax: '0.17',
            total: '1.38',
        });
    });

    it('en cuota fija conserva el IVA facturado pero no lo acredita', () => {
        expect(moneySnapshot(calculatePurchaseMoney([
            { lineNet: '1.00', taxable: true },
            { lineNet: '2.00', taxable: false },
        ], false, PURCHASE_TAX_TRASLADADO))).toEqual({
            lines: [
                { lineNet: '1.00', lineTax: '0.15', creditableTax: '0.00', lineTotal: '1.15' },
                { lineNet: '2.00', lineTax: '0.00', creditableTax: '0.00', lineTotal: '2.00' },
            ],
            subtotal: '3.00',
            tax: '0.15',
            creditableTax: '0.00',
            total: '3.15',
        });
    });

    it('acepta una línea cero sin convertirla en negativa o gravarla de más', () => {
        expect(moneySnapshot(calculatePurchaseMoney([
            { lineNet: '0', taxable: true },
        ], true, PURCHASE_TAX_TRASLADADO))).toEqual({
            lines: [{ lineNet: '0.00', lineTax: '0.00', creditableTax: '0.00', lineTotal: '0.00' }],
            subtotal: '0.00',
            tax: '0.00',
            creditableTax: '0.00',
            total: '0.00',
        });
    });

    it('rechaza una factura sin líneas monetarias', () => {
        expect(() => calculatePurchaseMoney([], true, PURCHASE_TAX_TRASLADADO)).toThrow(
            'La compra requiere al menos una línea monetaria',
        );
    });

    it.each([
        ['texto', 'lineNet[0] debe ser un decimal válido'],
        ['NaN', 'lineNet[0] debe ser finito y no negativo'],
        ['Infinity', 'lineNet[0] debe ser finito y no negativo'],
        ['-0.01', 'lineNet[0] debe ser finito y no negativo'],
    ])('rechaza una base inválida %s', (lineNet, message) => {
        expect(() => calculatePurchaseMoney(
            [{ lineNet, taxable: true }], true, PURCHASE_TAX_TRASLADADO,
        )).toThrow(message);
    });
});

describe('factura de compra sin traslación de IVA', () => {
    it('no cobra IVA sobre una línea GRAVADA cuando el proveedor no lo traslada', () => {
        // El caso reportado: factura de C$1,000 de un proveedor de cuota fija con
        // producto gravado. El total tiene que ser el del papel, no 1,150.
        expect(moneySnapshot(calculatePurchaseMoney([
            { lineNet: '1000.00', taxable: true },
        ], true, PURCHASE_TAX_SIN_TRASLADO))).toEqual({
            lines: [{
                lineNet: '1000.00',
                lineTax: '0.00',
                creditableTax: '0.00',
                lineTotal: '1000.00',
            }],
            subtotal: '1000.00',
            tax: '0.00',
            creditableTax: '0.00',
            total: '1000.00',
        });
    });

    it('deja el total igual al subtotal con líneas gravadas y exentas mezcladas', () => {
        const result = calculatePurchaseMoney([
            { lineNet: '500.00', taxable: true },
            { lineNet: '300.00', taxable: false },
        ], true, PURCHASE_TAX_SIN_TRASLADO);

        expect(result.tax.toFixed(2)).toBe('0.00');
        expect(result.creditableTax.toFixed(2)).toBe('0.00');
        expect(result.total.toFixed(2)).toBe('800.00');
        expect(result.total.equals(result.subtotal)).toBe(true);
    });

    it('conserva la base gravada aunque el IVA sea cero', () => {
        // Sin este desglose el libro fiscal no puede distinguir una base exenta
        // de una gravada que el proveedor no trasladó: ambas tienen IVA 0.00.
        const sinTraslado = calculatePurchaseMoney([
            { lineNet: '500.00', taxable: true },
            { lineNet: '300.00', taxable: false },
        ], true, PURCHASE_TAX_SIN_TRASLADO);

        expect(sinTraslado.taxableSubtotal.toFixed(2)).toBe('500.00');
        expect(sinTraslado.exemptSubtotal.toFixed(2)).toBe('300.00');
        expect(sinTraslado.lines.map((line) => line.taxable)).toEqual([true, false]);
    });

    it('nunca acredita crédito fiscal, ni siquiera en régimen general', () => {
        const result = calculatePurchaseMoney([
            { lineNet: '1000.00', taxable: true },
        ], true, PURCHASE_TAX_SIN_TRASLADO);

        expect(result.creditableTax.isZero()).toBe(true);
    });
});

describe('desglose de bases gravada y exenta', () => {
    it('suma cada base por separado y reconstruye el subtotal', () => {
        const result = calculatePurchaseMoney([
            { lineNet: '0.105', taxable: true },
            { lineNet: '0.104', taxable: false },
            { lineNet: '1.00', taxable: true },
        ], true, PURCHASE_TAX_TRASLADADO);

        expect(result.taxableSubtotal.toFixed(2)).toBe('1.11');
        expect(result.exemptSubtotal.toFixed(2)).toBe('0.10');
        expect(result.taxableSubtotal.plus(result.exemptSubtotal).equals(result.subtotal)).toBe(true);
    });

    it('deja la base gravada en cero cuando toda la factura es exenta', () => {
        const result = calculatePurchaseMoney([
            { lineNet: '10.00', taxable: false },
            { lineNet: '5.00', taxable: false },
        ], true, PURCHASE_TAX_TRASLADADO);

        expect(result.taxableSubtotal.toFixed(2)).toBe('0.00');
        expect(result.exemptSubtotal.toFixed(2)).toBe('15.00');
        expect(result.tax.toFixed(2)).toBe('0.00');
        expect(result.total.toFixed(2)).toBe('15.00');
    });

    it('deja la base exenta en cero cuando toda la factura es gravada', () => {
        const result = calculatePurchaseMoney([
            { lineNet: '10.00', taxable: true },
        ], true, PURCHASE_TAX_TRASLADADO);

        expect(result.taxableSubtotal.toFixed(2)).toBe('10.00');
        expect(result.exemptSubtotal.toFixed(2)).toBe('0.00');
    });
});
