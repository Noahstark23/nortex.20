import { describe, expect, it } from 'vitest';
import { adminBenefitState } from '../backend/services/adminOverviewService';
const now = new Date('2026-09-30T12:00:00Z');
describe('año fundador sólo con fechas explícitas', () => {
    it('identidad ausente y fechas incompletas permanecen desconocidas', () => {
        expect(adminBenefitState(null, null, null, now)).toBe('UNKNOWN');
        expect(adminBenefitState(true, null, null, now)).toBe('DATES_UNKNOWN');
        expect(adminBenefitState(true, '2026-01-01', null, now)).toBe('DATES_UNKNOWN');
        expect(adminBenefitState(true, null, '2027-01-01', now)).toBe('DATES_UNKNOWN');
    });
    it('no corrige ni completa fechas contradictorias', () => {
        expect(adminBenefitState(true, '2027-01-01', '2026-01-01', now)).toBe('DATES_UNKNOWN');
        expect(adminBenefitState(true, 'invalid', '2027-01-01', now)).toBe('DATES_UNKNOWN');
    });
    it('expone estados de evidencia sin modificar beneficios', () => {
        expect(adminBenefitState(false, null, null, now)).toBe('NOT_FOUNDER');
        expect(adminBenefitState(true, '2026-10-01', '2027-10-01', now)).toBe('SCHEDULED');
        expect(adminBenefitState(true, '2026-01-01', '2027-01-01', now)).toBe('CURRENT');
        expect(adminBenefitState(true, '2025-10-15', '2026-10-15', now)).toBe('ENDING_SOON');
        expect(adminBenefitState(true, '2025-09-30T12:00:00Z', now.toISOString(), now)).toBe('ENDED');
    });
});
