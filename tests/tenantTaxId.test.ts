import { describe, expect, it } from 'vitest';
import { isPlaceholderTaxId } from '../utils/tenantTaxId';

describe('placeholder fiscal del registro', () => {
    it.each([
        'TAX-1787427351390',
        'TAX-550e8400-e29b-41d4-a716-446655440000',
        ' tax-temporal ',
    ])('reconoce %s como marcador interno', (value) => {
        expect(isPlaceholderTaxId(value)).toBe(true);
    });

    it.each(['001-010190-0001A', '', null, undefined])(
        'no oculta un RUC real o valor ausente: %s',
        (value) => {
            expect(isPlaceholderTaxId(value)).toBe(false);
        },
    );
});
