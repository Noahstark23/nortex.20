import { describe, expect, it } from 'vitest';
import {
    matchesCustomerHubSegment,
    resolveCustomerHubNextAction,
    resolveCustomerHubSegment,
} from '../utils/customerHub';

describe('customerHub', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');

    it('prioriza bloqueo sobre cualquier otra señal', () => {
        const segment = resolveCustomerHubSegment({
            creditLimit: 100,
            currentDebt: 150,
            isBlocked: true,
            overdueInvoices: 2,
        }, now);

        expect(segment).toBe('blocked');
        expect(resolveCustomerHubNextAction(segment, {
            creditLimit: 100,
            currentDebt: 150,
            isBlocked: true,
        })).toMatch(/bloqueo/i);
    });

    it('marca sobrelímite cuando la deuda supera el cupo', () => {
        expect(resolveCustomerHubSegment({
            creditLimit: 100,
            currentDebt: 101,
            isBlocked: false,
        }, now)).toBe('overlimit');
    });

    it('marca con deuda aunque no haya vencidas', () => {
        expect(resolveCustomerHubSegment({
            creditLimit: 500,
            currentDebt: 25,
            isBlocked: false,
            openInvoices: 1,
        }, now)).toBe('withDebt');
    });

    it('marca inactivo si no compra hace 60 dias o mas', () => {
        expect(resolveCustomerHubSegment({
            creditLimit: 0,
            currentDebt: 0,
            isBlocked: false,
            lastSaleAt: '2026-06-20T00:00:00.000Z',
        }, now)).toBe('inactive');
    });

    it('cambia a inactivo al cruzar la medianoche civil de Managua del dia 60', () => {
        const signals = {
            creditLimit: 0,
            currentDebt: 0,
            isBlocked: false,
            // 28 de junio, 23:59:30 en Managua.
            lastSaleAt: '2026-06-28T23:59:30.000-06:00',
        };

        expect(resolveCustomerHubSegment(
            signals,
            new Date('2026-08-26T23:59:59.999-06:00'),
        )).toBe('active');
        expect(resolveCustomerHubSegment(
            signals,
            new Date('2026-08-27T00:00:00.000-06:00'),
        )).toBe('inactive');
    });

    it('respeta el corte exacto de 59 y 60 dias civiles con timestamps de zonas distintas', () => {
        // Ambos `now` representan la medianoche del 27 de agosto en Managua.
        const nowFromEurope = new Date('2026-08-27T08:00:00.000+02:00');
        const nowFromAsia = new Date('2026-08-27T20:00:00.000+14:00');

        expect(resolveCustomerHubSegment({
            creditLimit: 0,
            currentDebt: 0,
            isBlocked: false,
            // 29 de junio, 00:00 en Managua: 59 dias civiles.
            lastSaleAt: '2026-06-29T20:00:00.000+14:00',
        }, nowFromEurope)).toBe('active');

        expect(resolveCustomerHubSegment({
            creditLimit: 0,
            currentDebt: 0,
            isBlocked: false,
            // 28 de junio, 23:59:59 en Managua: 60 dias civiles,
            // aunque aun no transcurrieron 60 bloques completos de 24 horas.
            lastSaleAt: '2026-06-28T23:59:59.000-06:00',
        }, nowFromAsia)).toBe('inactive');
    });

    it('hace match de filtros operativos sin perder deudores bloqueados o sobrelimite', () => {
        expect(matchesCustomerHubSegment('withDebt', 'blocked', {
            creditLimit: 100,
            currentDebt: 100,
            isBlocked: true,
        })).toBe(true);
        expect(matchesCustomerHubSegment('withDebt', 'overlimit', {
            creditLimit: 100,
            currentDebt: 101,
            isBlocked: false,
        })).toBe(true);
        expect(matchesCustomerHubSegment('withDebt', 'active', {
            creditLimit: 100,
            currentDebt: 0,
            isBlocked: false,
        })).toBe(false);
    });
});
