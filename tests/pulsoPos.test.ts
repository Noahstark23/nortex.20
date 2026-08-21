/**
 * NORTEX — Pulso del día del POS: racha, meta automática y récord.
 *
 * Casos borde que esta red fija: racha cortada vs continua, racha que termina
 * ayer (hoy sin venta aún), meta con poca historia (null), redondeo de la meta
 * hacia ARRIBA a C$50, récord que excluye a hoy, y empate que NO es récord.
 */
import { describe, it, expect } from 'vitest';
import { calcularPulso, claveDelDiaManagua, inicioDelDiaManagua } from '../backend/services/pulsoPos';

const d = (dia: string, total: number, ventas = 1) => ({ dia, total, ventas });

describe('claveDelDiaManagua / inicioDelDiaManagua (UTC-6 fijo)', () => {
    it('las 10 pm de Managua siguen siendo "hoy" aunque en UTC ya sea mañana', () => {
        // 2026-08-20 22:30 Managua = 2026-08-21 04:30 UTC
        expect(claveDelDiaManagua(new Date('2026-08-21T04:30:00Z'))).toBe('2026-08-20');
    });
    it('mediodía de Managua es el mismo día', () => {
        expect(claveDelDiaManagua(new Date('2026-08-20T18:00:00Z'))).toBe('2026-08-20');
    });
    it('el día de Managua empieza a las 06:00 UTC', () => {
        expect(inicioDelDiaManagua(new Date('2026-08-21T04:30:00Z')).toISOString()).toBe('2026-08-20T06:00:00.000Z');
    });
});

describe('racha de días vendiendo', () => {
    it('cuenta días consecutivos terminando hoy', () => {
        const p = calcularPulso([d('2026-08-20', 100), d('2026-08-19', 90), d('2026-08-18', 80)], '2026-08-20');
        expect(p.racha).toBe(3);
        expect(p.rachaIncluyeHoy).toBe(true);
    });
    it('un hueco corta la racha (no lo salta)', () => {
        const p = calcularPulso([d('2026-08-20', 100), d('2026-08-18', 80), d('2026-08-17', 70)], '2026-08-20');
        expect(p.racha).toBe(1);
    });
    it('hoy sin venta: la racha termina ayer y lo dice', () => {
        const p = calcularPulso([d('2026-08-19', 90), d('2026-08-18', 80)], '2026-08-20');
        expect(p.racha).toBe(2);
        expect(p.rachaIncluyeHoy).toBe(false);
    });
    it('sin ventas nunca: racha 0', () => {
        const p = calcularPulso([], '2026-08-20');
        expect(p.racha).toBe(0);
        expect(p.rachaIncluyeHoy).toBe(false);
    });
    it('cruza el fin de mes sin cortarse', () => {
        const p = calcularPulso([d('2026-08-01', 50), d('2026-07-31', 50), d('2026-07-30', 50)], '2026-08-01');
        expect(p.racha).toBe(3);
    });
});

describe('meta diaria automática', () => {
    it('con menos de 3 días de historia no hay meta ni récord (día 1 sin gritos falsos)', () => {
        const p = calcularPulso([d('2026-08-20', 645), d('2026-08-19', 500)], '2026-08-20');
        expect(p.metaDiaria).toBeNull();
        expect(p.record).toBeNull();
        expect(p.esRecordHoy).toBe(false);
    });
    it('promedia los días previos y redondea HACIA ARRIBA a múltiplo de C$50', () => {
        // previos: 1000, 1100, 1230 → prom 1110 → meta 1150 (no 1100)
        const p = calcularPulso(
            [d('2026-08-20', 10), d('2026-08-19', 1000), d('2026-08-18', 1100), d('2026-08-17', 1230)],
            '2026-08-20'
        );
        expect(p.metaDiaria).toBe('1150.00');
    });
    it('un promedio ya múltiplo de 50 no sube al siguiente escalón', () => {
        const p = calcularPulso(
            [d('2026-08-19', 100), d('2026-08-18', 100), d('2026-08-17', 100)],
            '2026-08-20'
        );
        expect(p.metaDiaria).toBe('100.00');
    });
    it('solo usa los últimos 7 días CON venta (el octavo ya no pesa)', () => {
        const dias = [
            d('2026-08-19', 100), d('2026-08-18', 100), d('2026-08-17', 100), d('2026-08-16', 100),
            d('2026-08-15', 100), d('2026-08-14', 100), d('2026-08-13', 100),
            d('2026-08-12', 99999), // fuera de la muestra de 7
        ];
        expect(calcularPulso(dias, '2026-08-20').metaDiaria).toBe('100.00');
    });
    it('hoy NO entra al promedio de la meta (la meta no se persigue a sí misma)', () => {
        const p = calcularPulso(
            [d('2026-08-20', 100000), d('2026-08-19', 100), d('2026-08-18', 100), d('2026-08-17', 100)],
            '2026-08-20'
        );
        expect(p.metaDiaria).toBe('100.00');
    });
});

describe('récord', () => {
    it('récord = mejor día previo; superarlo estricto marca esRecordHoy', () => {
        const p = calcularPulso(
            [d('2026-08-20', 1300), d('2026-08-19', 1200), d('2026-08-18', 900), d('2026-08-17', 800)],
            '2026-08-20'
        );
        expect(p.record).toBe('1200.00');
        expect(p.esRecordHoy).toBe(true);
    });
    it('empatar el récord NO es romperlo', () => {
        const p = calcularPulso(
            [d('2026-08-20', 1200), d('2026-08-19', 1200), d('2026-08-18', 900), d('2026-08-17', 800)],
            '2026-08-20'
        );
        expect(p.esRecordHoy).toBe(false);
    });
    it('el total de hoy no compite como récord previo', () => {
        const p = calcularPulso(
            [d('2026-08-20', 5000), d('2026-08-19', 400), d('2026-08-18', 300), d('2026-08-17', 200)],
            '2026-08-20'
        );
        expect(p.record).toBe('400.00');
        expect(p.esRecordHoy).toBe(true);
    });
});
