import { describe, expect, it } from 'vitest';
import { normalizeActiveScaleContext, offlineSaleBelongsToScope } from '../lib/db';

describe('contexto offline de etiquetas', () => {
    it('aísla ventas pendientes por tenant y usuario antes de sincronizarlas', () => {
        const sale = { tenantId: 'tenant-a', userId: 'cashier-a' };
        expect(offlineSaleBelongsToScope(sale, { tenantId: 'tenant-a', userId: 'cashier-a' })).toBe(true);
        expect(offlineSaleBelongsToScope(sale, { tenantId: 'tenant-b', userId: 'cashier-a' })).toBe(false);
        expect(offlineSaleBelongsToScope(sale, { tenantId: 'tenant-a', userId: 'cashier-b' })).toBe(false);
    });

    it('fija la versión publicada y aplana sus mappings sin mezclar tenant', () => {
        const context = normalizeActiveScaleContext({
            data: {
                schemaVersion: 1,
                cacheVersion: 'hash-uno',
                generatedAt: '2026-08-22T12:00:00.000Z',
                profiles: [{
                    id: 'version-7',
                    profileId: 'perfil-1',
                    profileVersionId: 'version-7',
                    version: 7,
                    name: 'Balanza mostrador',
                    status: 'PUBLISHED',
                    symbology: 'EAN_13',
                    totalLength: 13,
                    prefixes: ['20'],
                    itemStart: 2,
                    itemLength: 5,
                    valueStart: 7,
                    valueLength: 5,
                    valueKind: 'WEIGHT',
                    impliedDecimals: 3,
                    sourceUnit: 'lb',
                    checksumMode: 'EAN13',
                    pricePolicy: 'RECALCULATE',
                    roundingTolerance: '0.01',
                    minValue: '0.001',
                    maxValue: '99.999',
                    mappings: [{
                        id: 'map-1',
                        plu: '12345',
                        productId: 'product-1',
                        sourceUnit: 'lb',
                        product: {
                            id: 'product-1',
                            name: 'Carne molida',
                            unit: 'lb',
                            price: '95.50',
                            saleMode: 'MEASURED',
                            quantityStep: '0.001',
                        },
                    }],
                }],
            },
        }, 'tenant-a');

        expect(context).toMatchObject({
            tenantId: 'tenant-a',
            hash: 'hash-uno',
            fetchedAt: '2026-08-22T12:00:00.000Z',
        });
        expect(context.profiles).toHaveLength(1);
        expect(context.profiles[0]).toMatchObject({
            id: 'version-7',
            profileVersionId: 'version-7',
            profileVersion: 7,
            pricingPolicy: 'RECALCULATE',
        });
        expect(context.mappings[0]).toMatchObject({
            profileVersionId: 'version-7',
            plu: '12345',
            productId: 'product-1',
            product: { name: 'Carne molida', quantityStep: '0.001' },
        });
    });

    it('rechaza otra versión del contrato en vez de reinterpretarla', () => {
        expect(() => normalizeActiveScaleContext({ data: { schemaVersion: 2, profiles: [] } }, 'tenant-a'))
            .toThrow(/esquema compatible/i);
    });
});
