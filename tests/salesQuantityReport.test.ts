import { describe, expect, it } from 'vitest';
import { buildSalesQuantityBreakdown } from '../backend/lib/salesQuantityReport';

describe('buildSalesQuantityBreakdown', () => {
    it('suma cantidades exactas cuando producto, unidad y presentación coinciden', () => {
        const rows = buildSalesQuantityBreakdown([
            {
                productId: 'p-1',
                productNameAtSale: 'Carne molida',
                unitAtSale: 'lb',
                saleModeAtSale: 'MEASURED',
                presentationAtSale: 'BASE',
                quantity: '1.25',
            },
            {
                productId: 'p-1',
                productNameAtSale: 'Carne molida',
                unitAtSale: 'lb',
                saleModeAtSale: 'MEASURED',
                presentationAtSale: 'BASE',
                quantity: '0.75',
            },
        ]);

        expect(rows).toEqual([expect.objectContaining({
            productId: 'p-1',
            productName: 'Carne molida',
            displayUnit: 'lb',
            quantity: '2',
            presentation: 'BASE',
        })]);
    });

    it('separa unidades incompatibles aunque el producto sea el mismo', () => {
        const rows = buildSalesQuantityBreakdown([
            {
                productId: 'p-1',
                productNameAtSale: 'Carne molida',
                unitAtSale: 'lb',
                saleModeAtSale: 'MEASURED',
                presentationAtSale: 'BASE',
                quantity: '1',
            },
            {
                productId: 'p-1',
                productNameAtSale: 'Carne molida',
                unitAtSale: 'kg',
                saleModeAtSale: 'MEASURED',
                presentationAtSale: 'BASE',
                quantity: '1',
            },
        ]);

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.displayUnit)).toEqual(['kg', 'lb']);
    });

    it('usa fallback explícito cuando falta unitAtSale', () => {
        const rows = buildSalesQuantityBreakdown([{
            productId: 'legacy',
            productNameAtSale: 'Producto legado',
            unitAtSale: null,
            saleModeAtSale: null,
            presentationAtSale: 'BASE',
            quantity: '3',
        }]);

        expect(rows[0]).toMatchObject({
            displayUnit: 'unidad (fallback)',
            baseUnit: 'unidad',
            usedFallbackUnit: true,
        });
    });

    it('no mezcla PACK con BASE y usa la cantidad de presentación para empaque', () => {
        const rows = buildSalesQuantityBreakdown([
            {
                productId: 'feed-1',
                productNameAtSale: 'Concentrado bovino',
                unitAtSale: 'lb',
                saleModeAtSale: 'MEASURED',
                presentationAtSale: 'BASE',
                quantity: '100',
            },
            {
                productId: 'feed-1',
                productNameAtSale: 'Concentrado bovino',
                unitAtSale: 'lb',
                saleModeAtSale: 'MEASURED',
                presentationAtSale: 'PACK',
                presentationQuantityAtSale: '1',
                quantity: '100',
            },
        ]);

        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.presentation === 'BASE')).toMatchObject({
            displayUnit: 'lb',
            quantity: '100',
        });
        expect(rows.find((row) => row.presentation === 'PACK')).toMatchObject({
            displayUnit: 'empaque(s) · base lb',
            quantity: '1',
        });
    });
});
