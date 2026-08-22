import { describe, expect, it } from 'vitest';
import {
    assertPeriodOpen,
    buildSaleJournalRequest,
    PeriodLockedError,
} from '../backend/services/accounting';

describe('fecha economica del asiento de venta', () => {
    it('offline conserva la fecha de la venta para el periodo fiscal', () => {
        const occurredAt = new Date('2026-07-31T23:59:59.000-06:00');
        const request = buildSaleJournalRequest(
            'sale-offline-1',
            115,
            60,
            'CASH',
            0,
            { date: occurredAt },
        );
        expect(request.entryOptions?.date).toBe(occurredAt);
        expect(request.entryOptions?.date.toISOString()).toBe('2026-08-01T05:59:59.000Z');
    });

    it('online sin fecha explicita conserva el default historico del motor', () => {
        const request = buildSaleJournalRequest('sale-online-1', 100, 50, 'CASH');
        expect(request.entryOptions).toBeUndefined();
    });

    it('la fecha economica offline activa el guard del periodo correspondiente', async () => {
        const occurredAt = new Date('2026-07-15T12:00:00.000-06:00');
        const findUnique = async ({ where }: any) => {
            expect(where).toEqual({
                tenantId_year_month: { tenantId: 'tenant-a', year: 2026, month: 7 },
            });
            return { status: 'CLOSED' };
        };

        await expect(assertPeriodOpen(
            { fiscalPeriod: { findUnique } } as any,
            'tenant-a',
            occurredAt,
        )).rejects.toBeInstanceOf(PeriodLockedError);
    });
});
