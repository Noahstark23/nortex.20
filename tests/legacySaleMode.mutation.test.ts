import { describe, expect, it } from 'vitest';
import { resolveQuotationItems, type QuotationProductAuthority } from '../backend/lib/quotationItems';
import { resolveLegacySaleMode } from '../utils/legacySaleMode';

describe('compatibilidad del modo de venta en cotizaciones legacy', () => {
    it.each(['unidad', 'caja', 'cajas', ' UNIDAD ', ' CAJA ', ' CaJaS '])(
        'conserva el conteo de %s cuando la ficha no tiene modo ni paso', (unit) => {
            expect(resolveLegacySaleMode({ unit })).toBe('COUNTED');
            expect(resolveLegacySaleMode({ unit, saleMode: null, quantityStep: null })).toBe('COUNTED');
        },
    );

    it.each([undefined, null, '', 'kg', 'metro', 'caja especial', 'unidades']) (
        'no reinterpreta como conteo la unidad legacy %s', (unit) => {
            // El resolver actual de catálogo admite otras etiquetas. Este contrato
            // conserva la interpretación legacy que todavía usan las cotizaciones.
            expect(resolveLegacySaleMode({ unit })).toBe('MEASURED');
        },
    );

    it('respeta COUNTED explícito aunque la unidad y el paso sugieran una medida', () => {
        expect(resolveLegacySaleMode({ unit: 'kg', saleMode: 'COUNTED' })).toBe('COUNTED');
        expect(resolveLegacySaleMode({ unit: 'kg', saleMode: 'COUNTED', quantityStep: '0.5' }))
            .toBe('COUNTED');
    });

    it('conserva la venta fraccionaria explícita de una caja sin exigir un paso configurado', () => {
        expect(resolveLegacySaleMode({ unit: 'caja', saleMode: 'MEASURED' })).toBe('MEASURED');
        expect(resolveLegacySaleMode({ unit: 'caja', saleMode: 'MEASURED', quantityStep: null }))
            .toBe('MEASURED');
    });

    it.each(['0.25', '1', 0.5, { toString: () => '0.5' }])(
        'conserva un paso explícito %o sin inferir conteo por el nombre', (quantityStep) => {
            expect(resolveLegacySaleMode({ unit: 'cajas', quantityStep })).toBe('MEASURED');
            expect(resolveLegacySaleMode({ unit: 'cajas', saleMode: null, quantityStep }))
                .toBe('MEASURED');
        },
    );

    it('no reemplaza un modo legacy desconocido por una inferencia nueva', () => {
        expect(resolveLegacySaleMode({ unit: 'unidad', saleMode: 'LEGACY' })).toBe('MEASURED');
    });

    const quoteProduct = (overrides: Partial<QuotationProductAuthority>): QuotationProductAuthority => ({
        id: 'qa-legacy-cemento',
        name: 'Cemento de prueba',
        price: '250.00',
        unit: 'caja',
        ivaExento: false,
        saleMode: null,
        quantityStep: null,
        ...overrides,
    });

    it.each(['unidad', 'caja', 'cajas']) (
        'cotiza dos %s completas y rechaza media sin redondearla', (unit) => {
            const product = quoteProduct({ unit });
            const [item] = resolveQuotationItems([{ productId: product.id, quantity: '2' }], [product]);
            expect(item.saleMode).toBe('COUNTED');
            expect(item.quantityStep).toBe('1');
            expect(item.quantityExact.toString()).toBe('2');
            expect(() => resolveQuotationItems([{ productId: product.id, quantity: '0.5' }], [product]))
                .toThrow(/cantidades y pasos enteros/i);
        },
    );

    it.each([
        { saleMode: 'MEASURED', quantityStep: null, expectedStep: '0.0001' },
        { saleMode: null, quantityStep: '0.25', expectedStep: '0.25' },
    ])('cotiza media caja según la configuración explícita %o', ({ saleMode, quantityStep, expectedStep }) => {
        const product = quoteProduct({ saleMode, quantityStep });
        const [item] = resolveQuotationItems([{ productId: product.id, quantity: '0.5' }], [product]);
        expect(item.saleMode).toBe('MEASURED');
        expect(item.quantityStep).toBe(expectedStep);
        expect(item.quantityExact.toString()).toBe('0.5');
        expect(item.presentationQuantityAtQuote.toString()).toBe('0.5');
    });
});
