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
