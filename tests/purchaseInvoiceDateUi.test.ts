import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    formatCalendarDate,
    formatCalendarDateLong,
    isValidCalendarDateInput,
    localCalendarDateInputValue,
} from '../components/Purchases';

const purchasesSource = readFileSync(
    resolve(process.cwd(), 'components/Purchases.tsx'),
    'utf8',
);

describe('fecha civil de la factura en Nueva Compra', () => {
    it('calcula el valor inicial desde el calendario local, incluso cerca de medianoche', () => {
        const localLateNight = new Date(2026, 7, 22, 23, 59, 59);

        expect(localCalendarDateInputValue(localLateNight)).toBe('2026-08-22');
    });

    it.each([
        ['fecha regular', '2026-08-22', true],
        ['día bisiesto real', '2028-02-29', true],
        ['día inexistente', '2026-02-30', false],
        ['año no bisiesto', '2027-02-29', false],
        ['datetime en vez de día civil', '2026-08-22T12:00:00.000Z', false],
        ['valor vacío', '', false],
    ])('valida %s (%s)', (_label, value, expected) => {
        expect(isValidCalendarDateInput(value)).toBe(expected);
    });

    it('presenta un campo requerido y accesible con error inline', () => {
        expect(purchasesSource).toContain('Fecha de la factura *');
        expect(purchasesSource).toContain('id="purchase-invoice-date"');
        expect(purchasesSource).toContain('htmlFor="purchase-invoice-date"');
        expect(purchasesSource).toMatch(/id="purchase-invoice-date"[\s\S]*?type="date"[\s\S]*?required/);
        expect(purchasesSource).toContain("aria-describedby={formErrors.date ? 'purchase-invoice-date-error' : undefined}");
        expect(purchasesSource).toContain('id="purchase-invoice-date-error"');
        expect(purchasesSource).toContain("errors.date = 'Ingresá la fecha de la factura.'");
        expect(purchasesSource).toContain("errors.date = 'Ingresá una fecha de factura válida.'");
    });

    it('envía, reinicia y recupera errores de la fecha de factura', () => {
        expect(purchasesSource).toContain('date: purchaseDate,');
        expect(purchasesSource).toContain('setPurchaseDate(localCalendarDateInputValue());');
        expect(purchasesSource).toContain('date: Array.isArray(details.date) ? String(details.date[0]) : undefined,');
    });

    it('renderiza la fecha fiscal de Purchase.date y no createdAt', () => {
        expect(purchasesSource).toContain('formatCalendarDateLong(p.date)');
        expect(purchasesSource).toContain('formatCalendarDate(p.date)');
        expect(purchasesSource).toContain('formatCalendarDate(selectedPurchase.date)');
        expect(purchasesSource).not.toMatch(/format(?:Calendar)?Date(?:Long)?\([^)]*createdAt/);
        expect(purchasesSource).not.toMatch(/new Date\([^)]*createdAt/);
    });

    it('proyecta fechas nuevas e históricas al calendario fiscal de Managua', () => {
        // La fila histórica representa 31/jul a las 20:00 en Managua, aunque en
        // UTC ya sea 1/ago. La fila nueva normalizada al mediodía conserva el día.
        expect(formatCalendarDate('2026-08-01T02:00:00.000Z')).toContain('31');
        expect(formatCalendarDate('2026-07-31T12:00:00.000Z')).toContain('31');
        expect(formatCalendarDateLong('2026-08-01T02:00:00.000Z').toLowerCase()).toContain('julio');
    });
});
