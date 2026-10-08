import { describe, expect, it } from 'vitest';
import { productFamilyPreset } from '../utils/productFamilyPresets';

describe('presets operativos por familia', () => {
    it('sugiere peso y lote para carnes y aves', () => {
        expect(productFamilyPreset('MEAT')).toEqual(expect.objectContaining({
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.01',
            requiresBatchTracking: true,
        }));
        expect(productFamilyPreset('POULTRY')).toEqual(productFamilyPreset('MEAT'));
    });

    it('sugiere venta abierta y saco para alimento animal', () => {
        expect(productFamilyPreset('ANIMAL_FEED')).toEqual(expect.objectContaining({
            unit: 'lb',
            saleMode: 'MEASURED',
            quantityStep: '0.01',
            packUnit: 'saco',
            packSize: '100',
        }));
    });

    it('no infiere fiscalidad ni precios', () => {
        const preset = productFamilyPreset('VETERINARY') as unknown as Record<string, unknown>;
        expect(preset).toEqual(expect.objectContaining({
            unit: 'frasco',
            saleMode: 'COUNTED',
            requiresBatchTracking: true,
        }));
        expect(preset).not.toHaveProperty('ivaExento');
        expect(preset).not.toHaveProperty('price');
        expect(preset).not.toHaveProperty('cost');
    });

    it('devuelve copias independientes', () => {
        const first = productFamilyPreset('ANIMAL_FEED');
        first.packSize = '40';
        expect(productFamilyPreset('ANIMAL_FEED').packSize).toBe('100');
    });
});
