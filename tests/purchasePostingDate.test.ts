import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    accountFindUnique: vi.fn(),
}));

vi.mock('../backend/lib/prisma', () => ({
    default: {
        account: { findUnique: db.accountFindUnique },
    },
}));

import { PeriodLockedError, recordPurchase } from '../backend/services/accounting';

const accountTypes: Record<string, string> = {
    '1.1.4': 'ASSET',
    '1.1.5': 'ASSET',
    '2.1.1': 'LIABILITY',
};

function transaction(periodStatus: 'OPEN' | 'CLOSED' | null = null) {
    return {
        fiscalPeriod: {
            findUnique: vi.fn().mockResolvedValue(
                periodStatus ? { status: periodStatus } : null,
            ),
        },
        journalEntry: {
            create: vi.fn().mockResolvedValue({ id: 'journal-purchase-1' }),
        },
        $queryRaw: vi.fn(async (sql: { values: unknown[] }) => [{ id: sql.values[1] }]),
        journalLine: { create: vi.fn().mockResolvedValue({}) },
        account: { update: vi.fn().mockResolvedValue({}) },
    };
}

describe('fecha contable de una compra', () => {
    beforeEach(() => {
        db.accountFindUnique.mockReset();
        db.accountFindUnique.mockImplementation(({ where }: any) => {
            const code = where.tenantId_code.code;
            return Promise.resolve({ id: `account-${code}`, code, type: accountTypes[code] });
        });
    });

    it('usa postingDate tanto para assertPeriodOpen como para el asiento', async () => {
        const tx = transaction();
        const postingDate = new Date('2026-09-01T12:00:00.000Z');

        await recordPurchase(
            tx as any,
            'tenant-a',
            'user-a',
            'purchase-a',
            '0.12',
            '0.02',
            'CREDIT',
            '0.02',
            postingDate,
        );

        expect(tx.fiscalPeriod.findUnique).toHaveBeenCalledWith({
            where: { tenantId_year_month: { tenantId: 'tenant-a', year: 2026, month: 9 } },
        });
        expect(tx.journalEntry.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: 'tenant-a',
                description: 'Compra a crédito #purchase',
                referenceId: 'purchase-a',
                referenceType: 'PURCHASE',
                date: postingDate,
            }),
        });
        expect(tx.journalLine.create).toHaveBeenCalledTimes(3);
    });

    it('distingue una compra de contado y conserva la identidad corta en el asiento', async () => {
        db.accountFindUnique.mockImplementation(({ where }: any) => {
            const code = where.tenantId_code.code;
            const type = code === '1.1.1' ? 'ASSET' : accountTypes[code];
            return Promise.resolve({ id: `account-${code}`, code, type });
        });
        const tx = transaction();
        const postingDate = new Date('2026-09-02T12:00:00.000Z');

        await recordPurchase(
            tx as any,
            'tenant-a',
            'user-a',
            'purchase-cash-1234',
            '11.50',
            '1.50',
            'CASH',
            '1.50',
            postingDate,
        );

        expect(tx.journalEntry.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: 'tenant-a',
                description: 'Compra de contado #purchase',
                referenceId: 'purchase-cash-1234',
                referenceType: 'PURCHASE',
                date: postingDate,
            }),
        });
        expect(tx.journalLine.create).toHaveBeenCalledTimes(3);
    });

    it('rechaza antes de escribir si el mes de postingDate está cerrado', async () => {
        const tx = transaction('CLOSED');

        await expect(recordPurchase(
            tx as any,
            'tenant-a',
            'user-a',
            'purchase-a',
            '10.00',
            '0.00',
            'CREDIT',
            '0.00',
            new Date('2026-10-31T12:00:00.000Z'),
        )).rejects.toBeInstanceOf(PeriodLockedError);

        expect(tx.journalEntry.create).not.toHaveBeenCalled();
        expect(tx.journalLine.create).not.toHaveBeenCalled();
    });
});
