import { describe, expect, it } from 'vitest';
import { calculatePurchaseOrderInvoiceAvailability } from '../backend/lib/purchaseOrderAvailability';
import { buildSalesQuantityBreakdown } from '../backend/lib/salesQuantityReport';

describe('buildSalesQuantityBreakdown — dimensiones, fallbacks y orden', () => {
    it('expone todos los defaults legacy sin confundirlos con valores vacíos', () => {
        const [row] = buildSalesQuantityBreakdown([{
            productId: null,
            productNameAtSale: '',
            unitAtSale: '   ',
            saleModeAtSale: null,
            presentationAtSale: null,
            quantity: '1.23456',
        }]);

        expect(row).toEqual({
            productId: 'legacy-product',
            productName: 'Producto legado',
            saleMode: 'MEASURED',
            presentation: 'BASE',
            baseUnit: 'unidad',
            displayUnit: 'unidad (fallback)',
            usedFallbackUnit: true,
            quantity: '1.2346',
        });
    });

    it('recorta la unidad real y conserva COUNTED explícito', () => {
        expect(buildSalesQuantityBreakdown([{
            productId: 'p1',
            productNameAtSale: 'Huevos',
            unitAtSale: '  unidad  ',
            saleModeAtSale: 'COUNTED',
            presentationAtSale: 'BASE',
            quantity: '3',
        }])).toEqual([{
            productId: 'p1',
            productName: 'Huevos',
            saleMode: 'COUNTED',
            presentation: 'BASE',
            baseUnit: 'unidad',
            displayUnit: 'unidad',
            usedFallbackUnit: false,
            quantity: '3',
        }]);
    });

    it('para PACK usa presentationQuantity, incluso cero, y cae a quantity solo si falta', () => {
        const rows = buildSalesQuantityBreakdown([
            {
                productId: 'a',
                productNameAtSale: 'Caja A',
                unitAtSale: 'ud',
                presentationAtSale: 'PACK',
                presentationQuantityAtSale: 0,
                quantity: '12',
            },
            {
                productId: 'b',
                productNameAtSale: 'Caja B',
                unitAtSale: null,
                presentationAtSale: 'PACK',
                presentationQuantityAtSale: null,
                quantity: '2',
            },
        ]);

        expect(rows).toEqual([
            expect.objectContaining({
                productId: 'a',
                presentation: 'PACK',
                baseUnit: 'ud',
                displayUnit: 'empaque(s) · base ud',
                quantity: '0',
            }),
            expect.objectContaining({
                productId: 'b',
                presentation: 'PACK',
                baseUnit: 'unidad',
                displayUnit: 'empaque(s) · base unidad (fallback)',
                quantity: '2',
            }),
        ]);
    });

    it('BASE ignora una cantidad de presentación residual', () => {
        const [row] = buildSalesQuantityBreakdown([{
            productId: 'base',
            productNameAtSale: 'Venta base',
            unitAtSale: 'kg',
            presentationAtSale: 'BASE',
            presentationQuantityAtSale: '99',
            quantity: '1.5',
        }]);
        expect(row?.quantity).toBe('1.5');
    });

    it('la clave estructurada no colisiona cuando id y nombre concatenados coinciden', () => {
        const rows = buildSalesQuantityBreakdown([
            { productId: 'a', productNameAtSale: 'bc', unitAtSale: 'kg', quantity: '1' },
            { productId: 'ab', productNameAtSale: 'c', unitAtSale: 'kg', quantity: '2' },
        ]);
        expect(rows).toHaveLength(2);
        expect(rows.map(({ productId, productName, quantity }) => ({ productId, productName, quantity }))).toEqual([
            { productId: 'a', productName: 'bc', quantity: '1' },
            { productId: 'ab', productName: 'c', quantity: '2' },
        ]);
    });

    it('mantiene grupos separados por nombre, modo, presentación y unidad visible', () => {
        const common = { productId: 'p', quantity: '1' };
        const rows = buildSalesQuantityBreakdown([
            { ...common, productNameAtSale: 'A', unitAtSale: 'kg', saleModeAtSale: 'MEASURED', presentationAtSale: 'BASE' },
            { ...common, productNameAtSale: 'B', unitAtSale: 'kg', saleModeAtSale: 'MEASURED', presentationAtSale: 'BASE' },
            { ...common, productNameAtSale: 'A', unitAtSale: 'kg', saleModeAtSale: 'COUNTED', presentationAtSale: 'BASE' },
            { ...common, productNameAtSale: 'A', unitAtSale: 'kg', saleModeAtSale: 'MEASURED', presentationAtSale: 'PACK', presentationQuantityAtSale: '1' },
            { ...common, productNameAtSale: 'A', unitAtSale: 'lb', saleModeAtSale: 'MEASURED', presentationAtSale: 'BASE' },
        ]);

        expect(rows).toHaveLength(5);
        expect(rows.map(({ productName, saleMode, presentation, displayUnit }) =>
            [productName, saleMode, presentation, displayUnit].join('|'))).toEqual([
            'A|MEASURED|PACK|empaque(s) · base kg',
            'A|MEASURED|BASE|kg',
            'A|COUNTED|BASE|kg',
            'A|MEASURED|BASE|lb',
            'B|MEASURED|BASE|kg',
        ]);
    });

    it('suma por clave completa antes de redondear a cuatro decimales', () => {
        const rows = buildSalesQuantityBreakdown([
            { productId: 'p', productNameAtSale: 'Peso', unitAtSale: 'kg', quantity: '0.00006' },
            { productId: 'p', productNameAtSale: 'Peso', unitAtSale: 'kg', quantity: '0.00006' },
        ]);
        expect(rows[0]?.quantity).toBe('0.0001');
    });
});

describe('calculatePurchaseOrderInvoiceAvailability — ramas tenant-agnostic puras', () => {
    it('conserva el primer nombre y suma exactos/fallbacks de líneas repetidas', () => {
        const result = calculatePurchaseOrderInvoiceAvailability([
            { productId: 'p', productName: 'Nombre inicial', quantityReceived: '999', quantityReceivedExact: '1.2500' },
            { productId: 'p', productName: 'Nombre posterior', quantityReceived: '2.5', quantityReceivedExact: null },
        ], []);

        expect([...result.entries()].map(([key, value]) => ({
            key,
            productName: value.productName,
            remaining: value.remaining.toString(),
        }))).toEqual([{ key: 'p', productName: 'Nombre inicial', remaining: '3.75' }]);
    });

    it('resta exactos y fallbacks acumulados, pero ignora facturas de productos ajenos a la OC', () => {
        const result = calculatePurchaseOrderInvoiceAvailability([
            { productId: 'p', productName: 'Producto', quantityReceived: '10' },
        ], [
            { items: [
                { productId: 'p', quantity: '100', quantityExact: '1.1250' },
                { productId: 'ausente', quantity: '500', quantityExact: '500.0000' },
            ] },
            { items: [{ productId: 'p', quantity: '2.25', quantityExact: null }] },
        ]);

        expect([...result.keys()]).toEqual(['p']);
        expect(result.get('p')?.remaining.toString()).toBe('6.625');
    });

    it('devuelve un mapa vacío para una OC sin líneas aunque existan facturas históricas', () => {
        const result = calculatePurchaseOrderInvoiceAvailability([], [{
            items: [{ productId: 'fantasma', quantity: '3' }],
        }]);
        expect(result.size).toBe(0);
    });
});
