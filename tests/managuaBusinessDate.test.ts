import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    daysUntilManaguaCalendarDate,
    daysSinceManaguaCivilDate,
    managuaBusinessDate,
    managuaCalendarDateFloor,
    parseManaguaCivilDateInput,
} from '../backend/lib/managuaBusinessDate';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

function sourceBetween(start: string, end: string): string {
    const from = server.indexOf(start);
    const to = server.indexOf(end, from + start.length);
    expect(from, `No se encontró ${start}`).toBeGreaterThanOrEqual(0);
    expect(to, `No se encontró ${end}`).toBeGreaterThan(from);
    return server.slice(from, to);
}

describe('día civil de negocio de Managua', () => {
    it('no cambia de día cuando UTC ya avanzó pero Managua todavía no', () => {
        const beforeMidnight = new Date('2026-08-22T05:59:59.999Z');
        const dueOnManaguaDay = new Date('2026-08-21T12:00:00.000Z');

        expect(daysSinceManaguaCivilDate(dueOnManaguaDay, beforeMidnight)).toBe(0);
        expect(managuaBusinessDate(beforeMidnight).toISOString()).toBe('2026-08-21T12:00:00.000Z');
    });

    it('avanza exactamente al cruzar medianoche de Managua', () => {
        const due = new Date('2026-08-21T12:00:00.000Z');
        const midnight = new Date('2026-08-22T06:00:00.000Z');

        expect(daysSinceManaguaCivilDate(due, midnight)).toBe(1);
        expect(managuaBusinessDate(midnight).toISOString()).toBe('2026-08-22T12:00:00.000Z');
    });

    it('crea un piso de comparacion que incluye fechas legacy 00Z y normalizadas 12Z', () => {
        expect(managuaCalendarDateFloor(new Date('2026-08-22T05:59:59.999Z')).toISOString())
            .toBe('2026-08-21T00:00:00.000Z');
        expect(managuaCalendarDateFloor(new Date('2026-08-22T06:00:00.000Z')).toISOString())
            .toBe('2026-08-22T00:00:00.000Z');
    });

    it('calcula vencimiento por fecha impresa aunque el historial mezcle 00Z y 12Z', () => {
        const asOf = new Date('2026-08-22T18:00:00.000Z');
        expect(daysUntilManaguaCalendarDate(new Date('2026-08-22T00:00:00.000Z'), asOf)).toBe(0);
        expect(daysUntilManaguaCalendarDate(new Date('2026-08-22T12:00:00.000Z'), asOf)).toBe(0);
        expect(daysUntilManaguaCalendarDate(new Date('2026-08-21T12:00:00.000Z'), asOf)).toBe(-1);
        expect(daysUntilManaguaCalendarDate(new Date('2026-11-20T12:00:00.000Z'), asOf)).toBe(90);
    });

    it.each([
        ['2026-08-27', '2026-08-27T12:00:00.000Z'],
        ['2028-02-29', '2028-02-29T12:00:00.000Z'],
    ])('normaliza el día contable %s sin depender del TZ del proceso', (input, expected) => {
        expect(parseManaguaCivilDateInput(input)?.toISOString()).toBe(expected);
    });

    it.each([
        '',
        '2026-02-30',
        '2026-08-27T00:00:00.000Z',
        '27/08/2026',
        null,
        20260827,
    ])('rechaza fechas contables ambiguas o inexistentes: %s', (input) => {
        expect(parseManaguaCivilDateInput(input)).toBeNull();
    });

    it('rechaza prefijos/sufijos y tipos no string sin intentar reinterpretarlos', () => {
        expect(parseManaguaCivilDateInput('2026-08-27 extra')).toBeNull();
        expect(parseManaguaCivilDateInput('x2026-08-27')).toBeNull();
        expect(parseManaguaCivilDateInput({ toString: () => '2026-08-27' })).toBeNull();
        expect(parseManaguaCivilDateInput(true)).toBeNull();
    });

    it('rechaza meses y días imposibles aunque el prefijo parezca calendario', () => {
        expect(parseManaguaCivilDateInput('2026-13-01')).toBeNull();
        expect(parseManaguaCivilDateInput('2026-00-15')).toBeNull();
        expect(parseManaguaCivilDateInput('2026-04-31')).toBeNull();
    });

    it('falla con RangeError exacto si una fecha calendario ya viene inválida', () => {
        expect(() => daysUntilManaguaCalendarDate(
            new Date('invalid'),
            new Date('2026-08-22T18:00:00.000Z'),
        )).toThrowError(new RangeError('Fecha calendario inválida'));
        expect(() => daysUntilManaguaCalendarDate(
            new Date('2026-08-22T12:00:00.000Z'),
            new Date('invalid'),
        )).toThrowError(new RangeError('Fecha calendario inválida'));
    });

    it('conecta tipo de cambio y activos al parser civil, sin Date.parse local', () => {
        const exchangeRate = sourceBetween(
            "app.post('/api/accounting/exchange-rate'",
            '// B1 — Retenciones SUFRIDAS',
        );
        const fixedAsset = sourceBetween(
            "app.post('/api/accounting/fixed-assets'",
            '// PATCH dar de baja',
        );

        for (const route of [exchangeRate, fixedAsset]) {
            expect(route).toContain('parseManaguaCivilDateInput(');
            expect(route).toContain('managuaBusinessDate()');
        }
        expect(exchangeRate).not.toContain('new Date(fecha)');
        expect(exchangeRate).not.toContain('setHours(0, 0, 0, 0)');
        expect(fixedAsset).not.toContain('new Date(fechaAdquisicion)');
    });

    it.each([
        ['2026-08-23T12:00:00.000Z', -1],
        ['2026-08-22T12:00:00.000Z', 0],
        ['2026-07-23T12:00:00.000Z', 30],
        ['2026-07-22T12:00:00.000Z', 31],
        ['2026-06-23T12:00:00.000Z', 60],
        ['2026-06-22T12:00:00.000Z', 61],
        ['2026-05-24T12:00:00.000Z', 90],
        ['2026-05-23T12:00:00.000Z', 91],
    ])('calcula %s contra la fecha de negocio sin drift: %i días', (reference, expected) => {
        expect(daysSinceManaguaCivilDate(
            new Date(reference),
            new Date('2026-08-22T18:00:00.000Z'),
        )).toBe(expected);
    });

    it('usa la misma fecha civil en customer hub, aging, worklist y estado de cuenta', () => {
        const hubBuilder = sourceBetween(
            'async function buildCustomerHubList',
            'function applySellerCustomerScope',
        );
        const hubDetail = sourceBetween(
            "app.get('/api/customers/:id/hub'",
            "'/api/customers/:id/interactions'",
        );
        const worklist = sourceBetween(
            "app.get('/api/collections/worklist'",
            "app.get('/api/customers/:id/statement'",
        );
        const statement = sourceBetween(
            "app.get('/api/customers/:id/statement'",
            '// POST /api/credits/payment',
        );
        const aging = sourceBetween(
            "app.get('/api/accounting/aging'",
            '// ==========================================\n// 💵 FLUJO DE EFECTIVO',
        );

        expect(hubBuilder).toContain('const today = startOfTodayManaguaBusiness(asOf);');
        expect(hubDetail).toContain('const today = managuaBusinessDate(now);');
        expect(hubDetail).toContain('daysSinceManaguaCivilDate(ref, now)');
        expect(worklist).toContain('daysSinceManaguaCivilDate(ref, now)');
        expect(worklist).toContain('const startOfDay = inicioDelDiaManagua(now);');
        expect(statement).toContain('daysSinceManaguaCivilDate(ref, now)');
        expect(aging).toContain('const hoy = managuaBusinessDate(now);');
        expect(aging).toContain('daysSinceManaguaCivilDate(ref, now)');

        for (const route of [hubBuilder, hubDetail, worklist, statement, aging]) {
            expect(route).not.toContain('new Date(now.getFullYear(), now.getMonth(), now.getDate())');
            expect(route).not.toContain('/ MS_DAY');
        }
    });
});
