import { describe, expect, it } from 'vitest';
import {
    productFamilyPreset,
    type ProductFamily,
    type ProductFamilyPreset,
} from '../utils/productFamilyPresets';

const expected: Record<ProductFamily, ProductFamilyPreset> = {
    GENERAL: {
        unit: 'unidad',
        saleMode: 'COUNTED',
        quantityStep: '1',
        requiresBatchTracking: false,
        packUnit: '',
        packSize: '',
    },
    MEAT: {
        unit: 'lb',
        saleMode: 'MEASURED',
        quantityStep: '0.01',
        requiresBatchTracking: true,
        packUnit: '',
        packSize: '',
    },
    POULTRY: {
        unit: 'lb',
        saleMode: 'MEASURED',
        quantityStep: '0.01',
        requiresBatchTracking: true,
        packUnit: '',
        packSize: '',
    },
    ANIMAL_FEED: {
        unit: 'lb',
        saleMode: 'MEASURED',
        quantityStep: '0.01',
        requiresBatchTracking: false,
        packUnit: 'saco',
        packSize: '100',
    },
    AGRO_INPUT: {
        unit: 'unidad',
        saleMode: 'COUNTED',
        quantityStep: '1',
        requiresBatchTracking: false,
        packUnit: '',
        packSize: '',
    },
    VETERINARY: {
        unit: 'frasco',
        saleMode: 'COUNTED',
        quantityStep: '1',
        requiresBatchTracking: true,
        packUnit: '',
        packSize: '',
    },
};

describe('productFamilyPreset — contrato completo por familia', () => {
    it.each(Object.keys(expected) as ProductFamily[])('%s conserva únicamente defaults operativos', (family) => {
        const preset = productFamilyPreset(family);
        expect(preset).toEqual(expected[family]);
        expect(Object.keys(preset).sort()).toEqual([
            'packSize',
            'packUnit',
            'quantityStep',
            'requiresBatchTracking',
            'saleMode',
            'unit',
        ]);
    });

    it('cada llamada entrega una copia superficial independiente', () => {
        const first = productFamilyPreset('GENERAL');
        const second = productFamilyPreset('GENERAL');
        expect(first).not.toBe(second);
        first.unit = 'alterada';
        expect(second).toEqual(expected.GENERAL);
        expect(productFamilyPreset('GENERAL')).toEqual(expected.GENERAL);
    });
});
