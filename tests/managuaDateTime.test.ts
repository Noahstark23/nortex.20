import { describe, expect, it } from 'vitest';
import { formatManaguaDateTime } from '../utils/managuaDateTime';

describe('hora de negocio en Ventas', () => {
    it('mantiene el día y la hora de Managua al cruzar medianoche UTC', () => {
        const shown = formatManaguaDateTime('2026-09-23T00:58:32.000Z');
        expect(shown).toContain('22/9/2026');
        expect(shown).toMatch(/6:58:32\s*p\.\s*m\./i);
        expect(formatManaguaDateTime('fecha inválida')).toBe('—');
    });

    it('conserva la zona de Managua cuando la vista pide otro formato', () => {
        expect(formatManaguaDateTime('2026-09-23T00:58:32.000Z', { dateStyle: 'short' }))
            .toBe('22/9/26');
    });
});
