import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateLaborLiability, computeAguinaldoAnual } from '../backend/services/nicaLabor';

afterEach(() => vi.useRealTimers());

const localDate = (input: string) => new Date(input.replace(/Z$/, ''));

describe('H2 retirado: la extracción anual conserva los límites propios de main', () => {
    it('contratación tardía conserva 179 días anuales y 180 en el pasivo', () => {
        const hire = new Date('2025-12-01T23:00:00Z');
        const today = new Date('2026-05-29T12:00:00Z');
        vi.useFakeTimers();
        vi.setSystemTime(today);
        expect(computeAguinaldoAnual(12000, hire, 2026, today)).toEqual({ dias: 179, monto: 5966.67 });
        expect(calculateLaborLiability('synthetic', 'Persona sintética', hire, 12000, 0).aguinaldoAcumulado).toBe(6000);
    });

    it('cruzar medianoche en dos minutos conserva un día anual', () => {
        expect(computeAguinaldoAnual(12000, new Date('2026-09-29T23:59:00Z'), 2026, new Date('2026-09-30T00:01:00Z')))
            .toEqual({ dias: 1, monto: 33.33 });
    });

    it('el inicio anual sigue siendo medianoche local, con rechazo del instante anterior', () => {
        const boundary = new Date(2025, 11, 1);
        const hire = new Date(2020, 0, 1);
        expect(computeAguinaldoAnual(12000, hire, 2026, new Date(boundary.getTime() - 1))).toEqual({ dias: 0, monto: 0 });
        expect(computeAguinaldoAnual(12000, hire, 2026, boundary)).toEqual({ dias: 1, monto: 33.33 });
    });
});

describe('refactor laboral: igualdad de timestamps y antigüedad cero', () => {
    it('ingreso idéntico al primero de diciembre conserva un día de aguinaldo', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date('2026-12-01T00:00:00Z'), 12000, 0);
        expect(result).toMatchObject({ monthsWorked: 0, vacacionesPendientes: 0, aguinaldoAcumulado: 33.3333, indemnizacion: 0, totalPasivo: 33.3333 });
    });

    it('antigüedad cero fuera de diciembre tampoco aplica piso de indemnización', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date('2026-10-01T12:00:00Z'), 12000, 0);
        expect(result).toMatchObject({ monthsWorked: 0, vacacionesPendientes: 0, aguinaldoAcumulado: 33.3333, indemnizacion: 0, totalPasivo: 33.3333 });
    });

    it.each([
        { name: 'ingreso y hoy exactamente al inicio', hire: '2025-12-01T00:00:00Z', year: 2026, today: '2025-12-01T00:00:00Z', dias: 1, monto: 33.33 },
        { name: 'ingreso y hoy exactamente al cierre', hire: '2026-11-30T00:00:00Z', year: 2026, today: '2026-11-30T00:00:00Z', dias: 1, monto: 33.33 },
        { name: 'timestamp cero es un ingreso conocido', hire: '1970-01-01T00:00:00Z', year: 1970, today: '1970-01-05T00:00:00Z', dias: 5, monto: 166.67 },
        { name: 'timestamp cero antes del período acredita cero', hire: '2020-01-01T00:00:00Z', year: 2026, today: '1970-01-01T00:00:00Z', dias: 0, monto: 0 },
    ])('$name', ({ hire, year, today, dias, monto }) => {
        expect(computeAguinaldoAnual(12000, localDate(hire), year, localDate(today))).toEqual({ dias, monto });
    });
});

// Caracterización previa al refactor. No acredita entradas válidas ni amplía
// la prueba de equivalencia del reviewer a Invalid Date; preserva el legado.
describe('refactor laboral: entradas inválidas no cambian su comportamiento previo', () => {
    it.each([
        { name: 'ingreso inválido', hire: new Date(NaN), today: new Date('2026-05-29T12:00:00Z'), year: 2026, dias: 180, monto: 6000 },
        { name: 'hoy inválido', hire: new Date('2020-01-01T00:00:00Z'), today: new Date(NaN), year: 2026, dias: 360, monto: 12000 },
        { name: 'ingreso y hoy inválidos', hire: new Date(NaN), today: new Date(NaN), year: 2026, dias: 360, monto: 12000 },
        { name: 'año NaN', hire: new Date('2020-01-01T00:00:00Z'), today: new Date('2026-05-29T12:00:00Z'), year: NaN, dias: 0, monto: 0 },
        { name: 'año infinito', hire: new Date('2020-01-01T00:00:00Z'), today: new Date('2026-05-29T12:00:00Z'), year: Infinity, dias: 0, monto: 0 },
    ])('$name en aguinaldo anual', ({ hire, today, year, dias, monto }) => {
        expect(computeAguinaldoAnual(12000, hire, year, today)).toEqual({ dias, monto });
    });

    it('ingreso inválido en pasivo con saldo conocido conserva indemnización cero', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date(NaN), 12000, 0);
        expect(result.monthsWorked).toBeNaN();
        expect(result).toMatchObject({ vacacionesPendientes: 0, aguinaldoAcumulado: 6000, indemnizacion: 0, totalPasivo: 6000 });
    });

    it('ingreso inválido sin saldo conserva NaN del estimado y no añade indemnización', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date(NaN), 12000);
        expect(result.monthsWorked).toBeNaN();
        expect(result.vacacionesPendientes).toBeNaN();
        expect(result.totalPasivo).toBeNaN();
        expect(result.aguinaldoAcumulado).toBe(6000);
        expect(result.indemnizacion).toBe(0);
    });
});
