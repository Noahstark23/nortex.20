import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateLaborLiability, computeAguinaldoAnual } from '../backend/services/nicaLabor';

afterEach(() => vi.useRealTimers());

// Importes literales derivados aparte con date/Fraction, no con el motor ni
// constantes importadas. Se verifican componentes y total, no solo su suma.
const liabilityCases = [
    { name: 'estimado corto', now: '2026-10-01T12:00:00Z', hire: '2026-08-01T23:00:00Z', salary: 12000, balance: undefined, expected: [2, 2000, 2038.3562, 2004.1068, 6042.463] },
    { name: 'saldo cero conocido', now: '2026-10-01T12:00:00Z', hire: '2026-08-01T23:00:00Z', salary: 12000, balance: 0, expected: [2, 0, 2038.3562, 2004.1068, 4042.463] },
    { name: 'saldo negativo conocido', now: '2026-10-01T12:00:00Z', hire: '2026-08-01T23:00:00Z', salary: 12000, balance: -5, expected: [2, 0, 2038.3562, 2004.1068, 4042.463] },
    { name: 'cuatro años completos', now: '2026-11-30T12:00:00Z', hire: '2022-11-30T23:00:00Z', salary: 12000, balance: 0, expected: [47, 0, 12000, 44000, 56000] },
    { name: 'saldo real mayor que treinta', now: '2026-11-30T12:00:00Z', hire: '2022-11-30T23:00:00Z', salary: 12000, balance: 40, expected: [47, 16000, 12000, 44000, 72000] },
    { name: 'estimado e indemnización alcanzan topes', now: '2026-11-30T12:00:00Z', hire: '2010-01-01T23:00:00Z', salary: 12000, balance: undefined, expected: [202, 12000, 12000, 60000, 84000] },
    { name: 'fracción del tercer año', now: '2026-11-30T12:00:00Z', hire: '2024-05-31T23:00:00Z', salary: 12000, balance: undefined, expected: [29, 12000, 12000, 29995.8932, 53995.8932] },
    { name: 'tercer año completo y fracción del cuarto', now: '2026-11-30T12:00:00Z', hire: '2023-11-30T23:00:00Z', salary: 12000, balance: 0, expected: [36, 0, 12000, 36005.4757, 48005.4757] },
    { name: 'reinicio primero de diciembre', now: '2026-12-01T00:00:00Z', hire: '2022-11-30T23:59:00Z', salary: 12000, balance: 0, expected: [48, 0, 32.8767, 44021.9028, 44054.7795] },
    { name: 'ingreso posterior al inicio anual', now: '2026-12-15T12:00:00Z', hire: '2026-12-10T23:59:00Z', salary: 12000, balance: 1.25, expected: [0, 500, 197.2603, 164.271, 861.5313] },
    { name: 'ingreso dos días futuro', now: '2026-05-29T12:00:00Z', hire: '2026-05-31T12:00:00Z', salary: 12000, balance: undefined, expected: [0, 0, 0, 0, 0] },
    { name: 'mismo día calendario', now: '2026-09-30T23:59:00Z', hire: '2026-09-30T00:00:00Z', salary: 12000, balance: undefined, expected: [0, 0, 32.8767, 0, 32.8767] },
    { name: 'cruce de medianoche UTC', now: '2026-09-30T00:01:00Z', hire: '2026-09-29T23:59:00Z', salary: 12000, balance: 0, expected: [0, 0, 65.7534, 32.8542, 98.6076] },
    { name: 'salario cero', now: '2026-11-30T12:00:00Z', hire: '2022-11-30T23:00:00Z', salary: 0, balance: 12.25, expected: [47, 0, 0, 0, 0] },
    { name: 'decimales y componentes redondeados', now: '2026-05-29T12:00:00Z', hire: '2025-12-01T23:00:00Z', salary: 12345.67, balance: 1.2345, expected: [5, 508.0243, 6088.2756, 6050.3078, 12646.6077] },
];

describe('pasivo laboral: tramos y saldos con resultados independientes', () => {
    it.each(liabilityCases)('$name', ({ now, hire, salary, balance, expected }) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(now));
        const hireDate = new Date(hire);
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', hireDate, salary, balance);
        const [monthsWorked, vacacionesPendientes, aguinaldoAcumulado, indemnizacion, totalPasivo] = expected;
        expect(result).toEqual({
            employeeId: 'synthetic-employee', employeeName: 'Persona sintética', hireDate,
            monthsWorked, vacacionesPendientes, aguinaldoAcumulado, indemnizacion, totalPasivo,
        });
    });
});

describe('pasivo laboral: vacaciones según el contrato existente', () => {
    it.each([undefined, null])('sin saldo conocido (%s) estima cinco días y no treinta', balance => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
        // 61 días calendario → 2 meses aproximados → 5 días; C$400 por día.
        const result = calculateLaborLiability('synthetic-employee', 'Persona sintética', new Date('2026-08-01T23:00:00Z'), 12000, balance);
        expect(result.monthsWorked).toBe(2);
        expect(result.vacacionesPendientes).toBe(2000);
    });
});

describe('aguinaldo anual: días calendario inclusivos del mismo motor', () => {
    it('ingreso al mediodía del último día todavía acredita un día calendario', () => {
        // Un día: 12000/365, redondeado a centavos = C$32.88.
        expect(computeAguinaldoAnual(12000, new Date('2026-11-30T12:00:00Z'), 2026, new Date('2026-11-30T18:00:00Z')))
            .toEqual({ dias: 1, monto: 32.88 });
    });

    it('dos fechas UTC consecutivas cuentan dos días aunque transcurran seis horas', () => {
        // Contrato calendarDaysBetween del motor, no bloques de 24 horas.
        expect(computeAguinaldoAnual(12000, new Date('2025-12-01T18:00:00Z'), 2026, new Date('2025-12-02T00:00:00Z')))
            .toEqual({ dias: 2, monto: 65.75 });
    });
});

describe('aguinaldo anual: límites y precisión independientes', () => {
    it.each([
        { name: '180 días inclusivos', salary: '12000', hire: '2020-01-01T00:00:00Z', year: 2026, today: '2026-05-29T12:00:00Z', dias: 180, monto: 5917.81 },
        { name: 'período completo después del cierre', salary: '12000', hire: '2020-01-01T00:00:00Z', year: 2026, today: '2027-01-05T12:00:00Z', dias: 365, monto: 12000 },
        { name: 'período bisiesto no excede un salario', salary: '12000', hire: '2020-01-01T00:00:00Z', year: 2024, today: '2024-12-02T00:00:00Z', dias: 365, monto: 12000 },
        { name: 'antes del inicio del período', salary: '12000', hire: '2020-01-01T00:00:00Z', year: 2026, today: '2025-11-29T12:00:00Z', dias: 0, monto: 0 },
        { name: 'ingreso futuro dentro del período', salary: '12000', hire: '2026-05-31T12:00:00Z', year: 2026, today: '2026-05-29T12:00:00Z', dias: 0, monto: 0 },
        { name: 'ingreso posterior al cierre', salary: '12000', hire: '2026-12-01T00:00:00Z', year: 2026, today: '2027-01-05T12:00:00Z', dias: 0, monto: 0 },
        { name: 'ingreso idéntico al inicio', salary: '12000', hire: '2025-12-01T00:00:00Z', year: 2026, today: '2026-05-29T12:00:00Z', dias: 180, monto: 5917.81 },
        { name: 'ingreso tardío se limita al cierre', salary: '12000', hire: '2026-11-29T23:59:00Z', year: 2026, today: '2027-01-05T12:00:00Z', dias: 2, monto: 65.75 },
        { name: 'un instante al inicio cuenta un día', salary: '12000', hire: '2025-12-01T00:00:00Z', year: 2026, today: '2025-12-01T00:00:00Z', dias: 1, monto: 32.88 },
        { name: 'hoy idéntico al cierre', salary: '12000', hire: '2020-01-01T00:00:00Z', year: 2026, today: '2026-11-30T00:00:00Z', dias: 365, monto: 12000 },
        { name: 'redondeo de salario decimal', salary: '12345.67', hire: '2025-12-01T18:00:00Z', year: 2026, today: '2025-12-02T00:00:00Z', dias: 2, monto: 67.65 },
        { name: 'salario cero conserva días', salary: '0', hire: '2025-12-01T00:00:00Z', year: 2026, today: '2026-05-29T12:00:00Z', dias: 180, monto: 0 },
    ])('$name', ({ salary, hire, year, today, dias, monto }) => {
        expect(computeAguinaldoAnual(salary, new Date(hire), year, new Date(today))).toEqual({ dias, monto });
    });
});
