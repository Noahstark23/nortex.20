import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { resolvePosCredit, isUnverifiableCreditSale } from '../utils/posCredit';

const customer = (currentDebt: unknown = '900', creditLimit: unknown = '30000', isBlocked = false) => ({ currentDebt, creditLimit, isBlocked });

describe('preview Decimal del crédito POS', () => {
    it.each([['900', '30000', '1960'], ['900.00', '30000.00', '1960.00'], [900, 30000, 1960], [new Decimal(900), new Decimal(30000), new Decimal(1960)]])('suma deuda y venta sin concatenación (%s)', (debt, limit, sale) => {
        expect(resolvePosCredit(customer(debt, limit), sale)).toEqual({ limit: '30000', currentDebt: '900', projectedDebt: '2860', available: '29100', exceedsLimit: false, debtPct: 3, projectedPct: 9.533333333333333, color: 'green', projectedColor: 'green' });
    });

    it.each([[0, 0, 0, false], ['0', '30000', '1960', false], ['0.10', '0.30', '0.20', false], [0.1, 0.3, 0.2, false], ['0.10', '0.30', '0.21', true], ['900', '2860', '1960', false], ['900', '2859.99', '1960', true]])('conserva el límite exacto y los centavos (%s, %s, %s)', (debt, limit, sale, exceedsLimit) => {
        expect(resolvePosCredit(customer(debt, limit), sale)?.exceedsLimit).toBe(exceedsLimit);
    });

    it('cero deuda y cero límite conservan lectura 100% y disponibilidad cero', () => {
        expect(resolvePosCredit(customer(0, 0), 1)).toEqual({ limit: '0', currentDebt: '0', projectedDebt: '1', available: '0', exceedsLimit: true, debtPct: 100, projectedPct: 100, color: 'red', projectedColor: 'red' });
    });

    it.each([null, undefined, '', 'abc', NaN, Infinity, -1, '-0.01', false, {}, [], '100000000', '99999999.999', '1e1000', '1e-1000', '0.001'])('no interpreta un monto inválido como cero: %s', (invalid) => {
        expect(resolvePosCredit({ ...customer(), currentDebt: invalid }, 1960)).toBeNull();
        expect(resolvePosCredit({ ...customer(), creditLimit: invalid }, 1960)).toBeNull();
        expect(resolvePosCredit(customer(), invalid)).toBeNull();
    });

    it('admite la frontera Decimal(10, 2) exacta y exponentes válidos', () => {
        expect(resolvePosCredit(customer('99999999.98', '99999999.99'), '0.01')?.projectedDebt).toBe('99999999.99');
        expect(resolvePosCredit(customer('9e2', '3e4'), '1.96e3')?.projectedDebt).toBe('2860');
    });
    it('un desborde derivado de dos montos válidos falla cerrado', () => {
        expect(resolvePosCredit(customer('99999999.99', '99999999.99'), '0.01')).toBeNull();
        expect(resolvePosCredit(customer('99999999.99', '99999999.99'), '99999999.99')).toBeNull();
    });

    it('sin cliente no calcula crédito', () => expect(resolvePosCredit(null, 1960)).toBeNull());

    it.each([[14999, 'green'], [15000, 'yellow'], [23999, 'yellow'], [24000, 'red']])('conserva color de deuda en %s', (debt, color) => {
        expect(resolvePosCredit(customer(debt), 0)?.color).toBe(color);
    });
    it.each([[23999, 'green'], [24000, 'yellow'], [29999, 'yellow'], [30000, 'red']])('conserva color proyectado en %s', (sale, projectedColor) => {
        expect(resolvePosCredit(customer(0), sale)?.projectedColor).toBe(projectedColor);
    });
    it('el cliente bloqueado permanece rojo aunque tenga crédito disponible', () => {
        expect(resolvePosCredit(customer(900, 30000, true), 1960)?.color).toBe('red');
    });
    it('deuda sobre el límite conserva disponibilidad cero', () => {
        expect(resolvePosCredit(customer(30100), 1960)?.available).toBe('0');
    });
    it('cambia de cliente sin reutilizar la deuda previa; también recibe snapshots JSON', () => {
        expect(resolvePosCredit(customer(), 1960)?.projectedDebt).toBe('2860');
        expect(resolvePosCredit(JSON.parse(JSON.stringify(customer('25', '2000'))), 1960)?.projectedDebt).toBe('1985');
    });
});

describe('invariante: crédito no verificable se rechaza siempre (N-REV-20261004-01 v2)', () => {
    const valid = resolvePosCredit({ currentDebt: '900', creditLimit: '30000', isBlocked: false }, '1960');
    it('CREDIT con datos inválidos (creditInfo null) se rechaza', () => {
        expect(isUnverifiableCreditSale('CREDIT', null)).toBe(true);
    });
    it('CREDIT con datos inválidos se rechaza aunque el override/PIN esté autorizado', () => {
        // El guard corre ANTES del override: la autorización de exceder el
        // límite nunca habilita vender fiado sin números verificables.
        expect(isUnverifiableCreditSale('CREDIT', null)).toBe(true);
    });
    it('CREDIT con datos verificables no lo rechaza este guard (lo decide el límite/override)', () => {
        expect(valid).not.toBeNull();
        expect(isUnverifiableCreditSale('CREDIT', valid)).toBe(false);
    });
    it('otros métodos no pasan por este guard aunque el crédito sea inválido', () => {
        for (const method of ['CASH', 'CARD', 'QR', 'TRANSFER']) {
            expect(isUnverifiableCreditSale(method, null)).toBe(false);
        }
    });
});
