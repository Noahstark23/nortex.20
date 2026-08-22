import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const posSource = readFileSync(new URL('../components/POS.tsx', import.meta.url), 'utf8');

describe('puente cotización → POS', () => {
    it('conserva quotationItemId y cantidad exacta en el payload online/offline', () => {
        expect(posSource).toContain("...(isQuotationCartLine(c) ? { quotationItemId: c.quotationItemId } : {})");
        expect(posSource).toContain("isQuotationCartLine(c) && c.quantityExact");
        expect(posSource).toContain("? c.quantityExact");
    });

    it('no fusiona, reprecifica ni edita una línea cotizada', () => {
        expect(posSource).toContain('&& !isQuotationCartLine(item)');
        expect(posSource).toContain('if (isQuotationCartLine(item)) return item;');
        expect(posSource).toContain('La cantidad está fijada por la cotización original.');
        expect(posSource).toContain("isQuotationLine ? 'fijado por cotización' : 'fijado por etiqueta'");
    });

    it('impide descuentos y mezcla con líneas libres antes de cobrar', () => {
        expect(posSource).toContain('const globalDiscountD = hasQuotationLines');
        expect(posSource).toContain('discount: isQuotationCartLine(c) ? 0');
        expect(posSource).toContain('hasQuotationLines && quotationLineCount !== cart.length');
        expect(posSource).toContain('disabled={hasQuotationLines}');
    });
});
