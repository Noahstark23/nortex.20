import { describe, expect, it } from 'vitest';
import {
    isTenantCapabilityCode,
    normalizeTenantCapabilities,
    suggestedCapabilitiesForBusinessType,
} from '../utils/tenantCapabilities';

describe('tenant capabilities', () => {
    it('normaliza duplicados conservando orden', () => {
        expect(normalizeTenantCapabilities([
            'CARNES_AVES',
            'ALIMENTO_ANIMAL',
            'CARNES_AVES',
        ])).toEqual(['CARNES_AVES', 'ALIMENTO_ANIMAL']);
    });

    it('rechaza capacidades inventadas', () => {
        expect(isTenantCapabilityCode('ADMIN')).toBe(false);
        expect(() => normalizeTenantCapabilities(['CARNES_AVES', 'ADMIN'])).toThrow(
            'Capacidad no permitida',
        );
    });

    it('sugiere módulos por giro sin impedir combinaciones posteriores', () => {
        expect(suggestedCapabilitiesForBusinessType('CARNICERIA_POLLERIA'))
            .toEqual(['CARNES_AVES', 'PERECEDEROS']);
        expect(suggestedCapabilitiesForBusinessType('agropecuaria'))
            .toEqual(['ALIMENTO_ANIMAL', 'AGROINSUMOS']);
        expect(suggestedCapabilitiesForBusinessType('MISCELANEA')).toEqual([]);
    });
});
