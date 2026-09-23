import { describe, expect, it } from 'vitest';
import { resolveReportPeriod } from '../backend/lib/reportPeriod';
import { claveDelDiaManagua } from '../backend/services/pulsoPos';

describe('rango civil de Reportes en Managua', () => {
    it('incluye la tarde del último día y excluye el primer instante del siguiente', () => {
        const period = resolveReportPeriod('2026-09-01', '2026-09-30');
        expect(period?.start.toISOString()).toBe('2026-09-01T06:00:00.000Z');
        expect(period?.endExclusive.toISOString()).toBe('2026-10-01T06:00:00.000Z');
        expect(new Date('2026-10-01T05:59:59Z') < period!.endExclusive).toBe(true);
        expect(new Date('2026-10-01T06:00:00Z') < period!.endExclusive).toBe(false);
    });

    it('rechaza fechas civiles inválidas, rango inverso o excesivo', () => {
        expect(resolveReportPeriod('2026-02-30', '2026-03-01')).toBeNull();
        expect(resolveReportPeriod('2026-10-02', '2026-10-01')).toBeNull();
        expect(resolveReportPeriod('2025-01-01', '2026-10-01')).toBeNull();
    });

    it('elige el día actual por el reloj de Managua', () => {
        const period = resolveReportPeriod(undefined, undefined, new Date('2026-10-01T00:30:00Z'));
        expect(period?.endDate).toBe('2026-09-30');
        expect(claveDelDiaManagua(new Date('2026-10-01T00:30:00Z'))).toBe('2026-09-30');
    });
});
