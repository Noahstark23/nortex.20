import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateLaborLiability, computeAguinaldoAnual } from '../backend/services/nicaLabor';

afterEach(() => vi.useRealTimers());

describe('refactor laboral: igualdad de timestamps y antigüedad cero', () => {
    it('ingreso idéntico al primero de diciembre conserva un día de aguinaldo', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date('2026-12-01T00:00:00Z'), 12000, 0);
        expect(result).toMatchObject({ monthsWorked: 0, vacacionesPendientes: 0, aguinaldoAcumulado: 32.8767, indemnizacion: 0, totalPasivo: 32.8767 });
    });

    it('antigüedad cero fuera de diciembre tampoco aplica piso de indemnización', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date('2026-10-01T12:00:00Z'), 12000, 0);
        expect(result).toMatchObject({ monthsWorked: 0, vacacionesPendientes: 0, aguinaldoAcumulado: 32.8767, indemnizacion: 0, totalPasivo: 32.8767 });
    });

    it.each([
        { name: 'ingreso y hoy exactamente al inicio', hire: '2025-12-01T00:00:00Z', year: 2026, today: '2025-12-01T00:00:00Z', dias: 1, monto: 32.88 },
        { name: 'ingreso y hoy exactamente al cierre', hire: '2026-11-30T00:00:00Z', year: 2026, today: '2026-11-30T00:00:00Z', dias: 1, monto: 32.88 },
        { name: 'timestamp cero es un ingreso conocido', hire: '1970-01-01T00:00:00Z', year: 1970, today: '1970-01-05T00:00:00Z', dias: 5, monto: 164.38 },
        { name: 'timestamp cero antes del período acredita cero', hire: '2020-01-01T00:00:00Z', year: 2026, today: '1970-01-01T00:00:00Z', dias: 0, monto: 0 },
    ])('$name', ({ hire, year, today, dias, monto }) => {
        expect(computeAguinaldoAnual(12000, new Date(hire), year, new Date(today))).toEqual({ dias, monto });
    });
});

// Caracterización previa al refactor. No acredita entradas válidas ni amplía
// la prueba de equivalencia del reviewer a Invalid Date; preserva el legado.
describe('refactor laboral: entradas inválidas no cambian su comportamiento previo', () => {
    it.each([
        { name: 'ingreso inválido', hire: new Date(NaN), today: new Date('2026-05-29T12:00:00Z'), year: 2026, dias: 180, monto: 5917.81 },
        { name: 'hoy inválido', hire: new Date('2020-01-01T00:00:00Z'), today: new Date(NaN), year: 2026, dias: 365, monto: 12000 },
        { name: 'ingreso y hoy inválidos', hire: new Date(NaN), today: new Date(NaN), year: 2026, dias: 365, monto: 12000 },
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
        expect(result).toMatchObject({ vacacionesPendientes: 0, aguinaldoAcumulado: 5917.8082, indemnizacion: 0, totalPasivo: 5917.8082 });
    });

    it('ingreso inválido sin saldo conserva NaN del estimado y no añade indemnización', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date(NaN), 12000);
        expect(result.monthsWorked).toBeNaN();
        expect(result.vacacionesPendientes).toBeNaN();
        expect(result.totalPasivo).toBeNaN();
        expect(result.aguinaldoAcumulado).toBe(5917.8082);
        expect(result.indemnizacion).toBe(0);
    });
});
