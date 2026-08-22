import { describe, expect, it } from 'vitest';
import { reconcilePublicCatalogCart } from '../components/PublicCatalog';

const product = (patch: Record<string, unknown> = {}) => ({
    id: 'product-a',
    name: 'Concentrado',
    price: 20,
    unit: 'lb',
    saleMode: 'MEASURED' as const,
    quantityStep: '0.01',
    packUnit: 'saco',
    packSize: 100,
    packPrice: 1800,
    ...patch,
});

describe('rehidratación segura del catálogo público', () => {
    it('descarta PACK cacheado si el empaque dejó de estar publicado/configurado', () => {
        const restored = reconcilePublicCatalogCart([{
            id: 'product-a',
            presentation: 'PACK',
            quantity: '2',
        }], [product({ packUnit: null, packSize: null, packPrice: null })]);

        expect(restored).toEqual([]);
    });

    it('conserva la semántica y cantidad cuando la presentación sigue vigente', () => {
        const restored = reconcilePublicCatalogCart([{
            id: 'product-a',
            presentation: 'PACK',
            quantity: '2',
        }], [product()]);

        expect(restored).toHaveLength(1);
        expect(restored[0]).toMatchObject({ presentation: 'PACK', quantity: '2' });
    });
});
