import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    accountFindUnique: vi.fn(),
}));

vi.mock('../backend/lib/prisma', () => ({
    default: {
        account: { findUnique: db.accountFindUnique },
    },
}));

import {
    recordAgentCommissionSettlement,
    recordAgentReversal,
    recordSupplierCreditNote,
} from '../backend/services/accounting';

const accountTypes: Record<string, string> = {
    '1.1.1': 'ASSET',
    '1.1.2': 'ASSET',
    '1.1.4': 'ASSET',
    '1.1.5': 'ASSET',
    '1.1.7': 'ASSET',
    '1.1.8': 'ASSET',
    '2.1.1': 'LIABILITY',
    '2.1.12': 'LIABILITY',
    '4.1.4': 'REVENUE',
    '5.1.3': 'EXPENSE',
};

function transaction() {
    return {
        fiscalPeriod: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
        journalEntry: {
            create: vi.fn().mockResolvedValue({ id: 'journal-contract-1' }),
        },
        $queryRaw: vi.fn(async (sql: { values: unknown[] }) => [{ id: sql.values[1] }]),
        journalLine: { create: vi.fn().mockResolvedValue({}) },
        account: { update: vi.fn().mockResolvedValue({}) },
    };
}

function postedLines(tx: ReturnType<typeof transaction>) {
    return tx.journalLine.create.mock.calls.map(([call]) => call.data);
}

describe('contratos de los wrappers contables asíncronos', () => {
    beforeEach(() => {
        db.accountFindUnique.mockReset();
        db.accountFindUnique.mockImplementation(({ where }: any) => {
            const code = where.tenantId_code.code;
            return Promise.resolve({ id: `account-${code}`, code, type: accountTypes[code] });
        });
    });

    it('postea la nota de crédito con fecha, referencia y líneas exactas', async () => {
        const tx = transaction();
        const postingDate = new Date('2026-08-30T18:30:00.000Z');

        await recordSupplierCreditNote(
            tx as any,
            'tenant-a',
            'user-a',
            'credit-note-123456',
            [
                { accountCode: '2.1.1', debit: '116.00', credit: 0 },
                { accountCode: '1.1.4', debit: 0, credit: '100.00' },
                { accountCode: '1.1.5', debit: 0, credit: '16.00' },
            ],
            postingDate,
        );

        expect(tx.journalEntry.create).toHaveBeenCalledWith({
            data: {
                tenantId: 'tenant-a',
                date: postingDate,
                description: 'Nota crédito proveedor #credit-n',
                referenceId: 'credit-note-123456',
                referenceType: 'SUPPLIER_CREDIT_NOTE',
                isAutomatic: true,
                createdBy: 'user-a',
            },
        });
        expect(postedLines(tx)).toEqual([
            { journalEntryId: 'journal-contract-1', accountId: 'account-2.1.1', debit: 116, credit: 0 },
            { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.4', debit: 0, credit: 100 },
            { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.5', debit: 0, credit: 16 },
        ]);
    });

    it.each([
        {
            direction: 'IN' as const,
            expected: [
                { journalEntryId: 'journal-contract-1', accountId: 'account-2.1.12', debit: 25, credit: 0 },
                { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.8', debit: 0, credit: 25 },
                { journalEntryId: 'journal-contract-1', accountId: 'account-4.1.4', debit: 1.5, credit: 0 },
                { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.7', debit: 0, credit: 1.5 },
            ],
        },
        {
            direction: 'OUT' as const,
            expected: [
                { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.8', debit: 25, credit: 0 },
                { journalEntryId: 'journal-contract-1', accountId: 'account-2.1.12', debit: 0, credit: 25 },
                { journalEntryId: 'journal-contract-1', accountId: 'account-4.1.4', debit: 1.5, credit: 0 },
                { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.7', debit: 0, credit: 1.5 },
            ],
        },
    ])('revierte exactamente una operación $direction con comisión', async ({ direction, expected }) => {
        const tx = transaction();

        await recordAgentReversal(
            tx as any,
            'tenant-a',
            'user-a',
            'agent-transaction-123',
            direction,
            25,
            1.5,
            'retiro USD anulado',
            '1.1.8',
        );

        expect(tx.journalEntry.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                description: 'Reversa agente: retiro USD anulado',
                referenceId: 'agent-transaction-123',
                referenceType: 'AGENT_TX_REVERSAL',
            }),
        });
        expect(postedLines(tx)).toEqual(expected);
    });

    it('no inventa líneas de comisión cuando la reversa tiene comisión cero', async () => {
        const tx = transaction();

        await recordAgentReversal(
            tx as any,
            'tenant-a',
            'user-a',
            'agent-transaction-zero',
            'OUT',
            25,
            0,
            'retiro sin comisión',
        );

        expect(postedLines(tx)).toEqual([
            { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.1', debit: 25, credit: 0 },
            { journalEntryId: 'journal-contract-1', accountId: 'account-2.1.12', debit: 0, credit: 25 },
        ]);
    });

    it('liquida comisiones contra Bancos y la cuenta por cobrar exactas', async () => {
        const tx = transaction();

        await recordAgentCommissionSettlement(
            tx as any,
            'tenant-a',
            'user-a',
            'agreement-123',
            82.75,
            'cierre agosto',
        );

        expect(tx.journalEntry.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                description: 'Liquidación comisiones: cierre agosto',
                referenceId: 'agreement-123',
                referenceType: 'AGENT_COMMISSION_SETTLEMENT',
            }),
        });
        expect(postedLines(tx)).toEqual([
            { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.2', debit: 82.75, credit: 0 },
            { journalEntryId: 'journal-contract-1', accountId: 'account-1.1.7', debit: 0, credit: 82.75 },
        ]);
    });
});
