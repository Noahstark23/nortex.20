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
    canonicalJournalAccountLockOrder,
    createJournalEntry,
} from '../backend/services/accounting';

const accountTypes: Record<string, string> = {
    '1.1.1': 'ASSET',
    '1.1.4': 'ASSET',
    '2.1.1': 'LIABILITY',
};

describe('orden canónico de locks contables', () => {
    beforeEach(() => {
        db.accountFindUnique.mockReset();
        db.accountFindUnique.mockImplementation(({ where }: any) => {
            const code = where.tenantId_code.code;
            return Promise.resolve({ id: `account-${code}`, code, type: accountTypes[code] });
        });
    });

    it('ordena por código e id sin mutar la presentación y deduplica cuentas', () => {
        const accounts = [
            { id: 'account-inventory', code: '1.1.4', label: 'Inventario' },
            { id: 'account-cash', code: '1.1.1', label: 'Caja' },
            { id: 'account-inventory', code: '1.1.4', label: 'Inventario repetido' },
            { id: 'account-payable', code: '2.1.1', label: 'CxP' },
        ];
        const originalIds = accounts.map((account) => account.id);

        expect(canonicalJournalAccountLockOrder(accounts).map((account) => account.id)).toEqual([
            'account-cash',
            'account-inventory',
            'account-payable',
        ]);
        expect(accounts.map((account) => account.id)).toEqual(originalIds);
    });

    it('prioriza código aunque el id ordene al revés y desempata ids del mismo código', () => {
        const accounts = [
            { id: 'a-payable', code: '2.1.1', label: 'CxP' },
            { id: 'z-cash', code: '1.1.1', label: 'Caja' },
            { id: 'z-bank', code: '1.1.2', label: 'Banco Z' },
            { id: 'a-bank', code: '1.1.2', label: 'Banco A original' },
            { id: 'a-bank', code: '1.1.2', label: 'Banco A definitivo' },
        ];

        const ordered = canonicalJournalAccountLockOrder(accounts);

        expect(ordered.map(({ id, code }) => ({ id, code }))).toEqual([
            { id: 'z-cash', code: '1.1.1' },
            { id: 'a-bank', code: '1.1.2' },
            { id: 'z-bank', code: '1.1.2' },
            { id: 'a-payable', code: '2.1.1' },
        ]);
        expect(ordered[1].label).toBe('Banco A definitivo');
    });

    it('prebloquea cuentas en orden único antes del asiento y conserva las líneas', async () => {
        const events: string[] = [];
        const queryRaw = vi.fn(async (sql: { values: unknown[] }) => {
            const accountId = String(sql.values[1]);
            events.push(`lock:${accountId}`);
            return [{ id: accountId }];
        });
        const journalEntryCreate = vi.fn(async () => {
            events.push('entry');
            return { id: 'journal-1' };
        });
        const journalLineCreate = vi.fn(async ({ data }: any) => {
            events.push(`line:${data.accountId}`);
            return {};
        });
        const accountUpdate = vi.fn(async ({ where }: any) => {
            events.push(`update:${where.id}`);
            return {};
        });
        const tx = {
            fiscalPeriod: { findUnique: vi.fn().mockResolvedValue(null) },
            $queryRaw: queryRaw,
            journalEntry: { create: journalEntryCreate },
            journalLine: { create: journalLineCreate },
            account: { findUnique: db.accountFindUnique, update: accountUpdate },
        };

        await createJournalEntry(
            tx as any,
            'tenant-1',
            'Compra CASH inversa a venta',
            'reference-1',
            'PURCHASE',
            'user-1',
            [
                { accountCode: '1.1.4', debit: 10, credit: 0 },
                { accountCode: '1.1.1', debit: 0, credit: 10 },
            ],
            { date: new Date('2026-08-27T12:00:00.000Z') },
        );

        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(events.slice(0, 3)).toEqual([
            'lock:account-1.1.1',
            'lock:account-1.1.4',
            'entry',
        ]);
        expect(journalLineCreate.mock.calls.map(([call]) => call.data.accountId)).toEqual([
            'account-1.1.4',
            'account-1.1.1',
        ]);
    });

    it('falla antes de crear el asiento si una cuenta desaparece al bloquear', async () => {
        const tx = {
            fiscalPeriod: { findUnique: vi.fn().mockResolvedValue(null) },
            $queryRaw: vi.fn().mockResolvedValue([]),
            journalEntry: { create: vi.fn() },
            journalLine: { create: vi.fn() },
            account: { findUnique: db.accountFindUnique, update: vi.fn() },
        };

        await expect(createJournalEntry(
            tx as any,
            'tenant-1',
            'Asiento inválido',
            'reference-1',
            'TEST',
            'user-1',
            [
                { accountCode: '1.1.1', debit: 1, credit: 0 },
                { accountCode: '2.1.1', debit: 0, credit: 1 },
            ],
        )).rejects.toThrow('CUENTA_INEXISTENTE: 1.1.1 no existe en el tenant');
        expect(tx.journalEntry.create).not.toHaveBeenCalled();
        expect(tx.journalLine.create).not.toHaveBeenCalled();
        expect(tx.account.update).not.toHaveBeenCalled();
    });
});
