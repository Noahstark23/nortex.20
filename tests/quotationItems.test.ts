import { describe, expect, it } from 'vitest';
import {
    legacyQuotationQuantity,
    QuotationItemError,
    resolveQuotationItems,
    serializeQuotationItemsForClient,
} from '../backend/lib/quotationItems';

const measuredProduct = {
    id: 'product-lb',
    name: 'Carne molida',
    price: '95.50',
    unit: 'lb',
    ivaExento: false,
    saleMode: 'MEASURED',
    quantityStep: '0.01',
};

describe('quotationItems', () => {
    it('acepta 0.50 lb y serializa la cantidad exacta para convertir al POS', () => {
        const resolved = resolveQuotationItems([{
            productId: 'product-lb',
            quantity: '0.50',
            price: '0.01',
            name: 'Manipulado',
        }], [measuredProduct]);

        expect(resolved[0]).toMatchObject({
            productId: 'product-lb',
            name: 'Carne molida',
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.01',
        });
        expect(resolved[0].price.toFixed(2)).toBe('95.50');
        expect(resolved[0].quantityExact.toString()).toBe('0.5');
        expect(resolved[0].quantityLegacy).toBe(1);
        expect(resolved[0].presentationAtQuote).toBe('BASE');
        expect(resolved[0].presentationQuantityAtQuote.toString()).toBe('0.5');

        const serialized = serializeQuotationItemsForClient([{
            productId: 'product-lb',
            id: 'quotation-item-lb',
            quantity: resolved[0].quantityLegacy,
            quantityExact: resolved[0].quantityExact.toFixed(),
            price: resolved[0].price.toFixed(2),
            unitPriceExact: resolved[0].price.toFixed(4),
            unitAtQuote: resolved[0].unit,
            saleModeAtQuote: resolved[0].saleMode,
            quantityStepAtQuote: resolved[0].quantityStep,
            presentationAtQuote: resolved[0].presentationAtQuote,
            presentationQuantityAtQuote: resolved[0].presentationQuantityAtQuote,
            ivaExentoAtQuote: resolved[0].ivaExento,
            name: resolved[0].name,
        }], [measuredProduct]);

        expect(serialized[0]).toMatchObject({
            id: 'product-lb',
            quantity: 0.5,
            quantityExact: '0.5',
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.01',
            price: 95.5,
            quotationItemId: 'quotation-item-lb',
            cartLineId: 'quotation:quotation-item-lb',
            presentationAtQuote: 'BASE',
            presentation: { quantity: '0.5', unit: 'lb' },
        });
    });

    it('serializa PACK con precio 4dp y referencia opaca para que POS no recalcule', () => {
        const [serialized] = serializeQuotationItemsForClient([{
            id: 'quotation-item-pack',
            productId: 'product-lb',
            quantity: 3,
            quantityExact: '3.0000',
            price: '3.33',
            unitPriceExact: '3.3333',
            unitAtQuote: 'unidad',
            saleModeAtQuote: 'COUNTED',
            quantityStepAtQuote: '1',
            presentationAtQuote: 'PACK',
            presentationQuantityAtQuote: '1',
            ivaExentoAtQuote: true,
            name: 'Pack de tres',
        }], [measuredProduct]);

        expect(serialized).toMatchObject({
            id: 'product-lb',
            quotationItemId: 'quotation-item-pack',
            cartLineId: 'quotation:quotation-item-pack',
            quantity: 3,
            price: 3.3333,
            basePrice: 3.3333,
            unitPriceExact: '3.3333',
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: '1',
            presentationAtQuote: 'PACK',
            presentation: { quantity: '1', unit: 'empaque' },
            packUnit: 'empaque',
            ivaExento: true,
        });
    });

    it('rechaza fracciones para productos COUNTED', () => {
        expect(() => resolveQuotationItems([{
            productId: 'counted-1',
            quantity: '1.5',
        }], [{
            id: 'counted-1',
            name: 'Saco de maíz',
            price: '180.00',
            unit: 'saco',
            ivaExento: false,
            saleMode: 'COUNTED',
            quantityStep: '1',
        }])).toThrowError(QuotationItemError);

        expect(() => resolveQuotationItems([{
            productId: 'counted-1',
            quantity: '1.5',
        }], [{
            id: 'counted-1',
            name: 'Saco de maíz',
            price: '180.00',
            unit: 'saco',
            ivaExento: false,
            saleMode: 'COUNTED',
            quantityStep: '1',
        }])).toThrow(/cantidades y pasos enteros/i);
    });

    it('ignora precio y nombre manipulados del cliente', () => {
        const resolved = resolveQuotationItems([{
            productId: 'product-lb',
            quantity: '1',
            price: '0.25',
            name: 'Otro nombre',
        }], [measuredProduct]);

        expect(resolved[0].name).toBe('Carne molida');
        expect(resolved[0].price.toFixed(2)).toBe('95.50');
    });

    it('rechaza productos fuera del tenant como no encontrados', () => {
        expect(() => resolveQuotationItems([{
            productId: 'foreign-product',
            quantity: '1',
        }], [measuredProduct])).toThrowError(QuotationItemError);

        expect(() => resolveQuotationItems([{
            productId: 'foreign-product',
            quantity: '1',
        }], [measuredProduct])).toThrow(/no encontrado en este negocio/i);
    });

    it('clampea la sombra Int sin alterar la cantidad exacta autoritativa', () => {
        expect(legacyQuotationQuantity('99999999999999.9999')).toBe(2_147_483_647);
        expect(legacyQuotationQuantity('0.75')).toBe(1);
    });
});
