import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    buildJournalPayloadHash,
    JournalPostingError,
    postJournalOnce,
    reverseJournalOnce,
    type JournalPostingDatabase,
} from '../backend/services/journalPosting';

type EntryRecord = {
    id: string;
    tenantId: string;
    date: Date;
    description: string;
    referenceId: string | null;
    referenceType: string | null;
    isAutomatic: boolean;
    createdBy: string;
    createdAt: Date;
    postingKey: string | null;
    payloadHash: string | null;
    economicDate: Date | null;
    postedAt: Date | null;
    entryKind: string;
    reversalOfId: string | null;
};

type LineRecord = {
    id: string;
    journalEntryId: string;
    accountId: string;
    debit: string;
    credit: string;
};

type AuditRecord = {
    action: string;
    details: string;
};

function buildFakeDb(): {
    db: JournalPostingDatabase;
    state: {
        entries: EntryRecord[];
        lines: LineRecord[];
        audits: AuditRecord[];
        accounts: Array<{ id: string; code: string; type: string; balance: Decimal }>;
    };
} {
    let entrySeq = 1;
    let lineSeq = 1;
    const state = {
        entries: [] as EntryRecord[],
        lines: [] as LineRecord[],
        audits: [] as AuditRecord[],
        accounts: [
            { id: 'cash', code: '1.1.1', type: 'ASSET', balance: new Decimal(0) },
            { id: 'sales', code: '4.1.1', type: 'REVENUE', balance: new Decimal(0) },
        ],
    };

    const findEntry = async ({ where, select }: any) => {
        const entry = state.entries.find((candidate) => {
            if (where?.id && candidate.id !== where.id) return false;
            if (where?.tenantId && candidate.tenantId !== where.tenantId) return false;
            if (where?.postingKey !== undefined && candidate.postingKey !== where.postingKey) return false;
            if (where?.reversalOfId !== undefined && candidate.reversalOfId !== where.reversalOfId) return false;
            return true;
        });
        if (!entry) return null;
        if (select?.lines) {
            return {
                ...entry,
                lines: state.lines
                    .filter((line) => line.journalEntryId === entry.id)
                    .sort((left, right) => left.id.localeCompare(right.id)),
            };
        }
        return { ...entry };
    };

    const tx = {
        user: {
            findFirst: async ({ where }: any) => (
                where?.id === 'user-a' && where?.tenantId === 'tenant-a' && where?.status === 'ACTIVE'
                    ? { id: 'user-a' }
                    : null
            ),
        },
        fiscalPeriod: {
            findUnique: async () => null,
        },
        account: {
            findMany: async ({ where }: any) => state.accounts
                .filter((account) => account.id && where.id.in.includes(account.id))
                .map((account) => ({
                    id: account.id,
                    code: account.code,
                    type: account.type,
                    balance: account.balance.toFixed(4),
                })),
            updateMany: async ({ where, data }: any) => {
                const account = state.accounts.find(
                    (candidate) => candidate.id === where.id && candidate.id && where.tenantId === 'tenant-a',
                );
                if (!account) return { count: 0 };
                account.balance = account.balance.plus(new Decimal(data.balance.increment));
                return { count: 1 };
            },
        },
        journalEntry: {
            findFirst: findEntry,
            create: async ({ data }: any) => {
                if (
                    data.postingKey
                    && state.entries.some((entry) => entry.tenantId === data.tenantId && entry.postingKey === data.postingKey)
                ) {
                    throw { code: 'P2002' };
                }
                if (
                    data.reversalOfId
                    && state.entries.some((entry) => entry.reversalOfId === data.reversalOfId)
                ) {
                    throw { code: 'P2002' };
                }
                const created: EntryRecord = {
                    id: `entry-${entrySeq++}`,
                    tenantId: data.tenantId,
                    date: new Date(data.date),
                    description: data.description,
                    referenceId: data.referenceId ?? null,
                    referenceType: data.referenceType ?? null,
                    isAutomatic: data.isAutomatic,
                    createdBy: data.createdBy,
                    createdAt: new Date(data.postedAt ?? data.date),
                    postingKey: data.postingKey ?? null,
                    payloadHash: data.payloadHash ?? null,
                    economicDate: data.economicDate ?? null,
                    postedAt: data.postedAt ?? null,
                    entryKind: data.entryKind,
                    reversalOfId: data.reversalOfId ?? null,
                };
                state.entries.push(created);
                return { ...created };
            },
        },
        journalLine: {
            createMany: async ({ data }: any) => {
                for (const line of data) {
                    state.lines.push({
                        id: `line-${lineSeq++}`,
                        journalEntryId: line.journalEntryId,
                        accountId: line.accountId,
                        debit: String(line.debit),
                        credit: String(line.credit),
                    });
                }
                return { count: data.length };
            },
        },
        auditLog: {
            create: async ({ data }: any) => {
                state.audits.push({
                    action: data.action,
                    details: String(data.details),
                });
                return { id: `audit-${state.audits.length}` };
            },
        },
    };

    const db = {
        user: tx.user,
        journalEntry: { findFirst: tx.journalEntry.findFirst },
        $transaction: async (callback) => callback(tx as any),
    } as unknown as JournalPostingDatabase;

    return { db, state };
}

const POST_DATE = new Date('2026-08-31T15:00:00.000Z');

function saleLines() {
    return [
        { accountId: 'cash', debit: '100.0000', credit: '0.0000' },
        { accountId: 'sales', debit: '0.0000', credit: '100.0000' },
    ];
}

function originalPayloadHash() {
    return buildJournalPayloadHash({
        tenantId: 'tenant-a',
        economicDate: POST_DATE,
        postingDate: POST_DATE,
        description: 'Venta #1',
        referenceId: 'sale-1',
        referenceType: 'SALE',
        lines: saleLines(),
    });
}

function changedPayloadHash() {
    return buildJournalPayloadHash({
        tenantId: 'tenant-a',
        economicDate: POST_DATE,
        postingDate: POST_DATE,
        description: 'Venta #1 alterada',
        referenceId: 'sale-1',
        referenceType: 'SALE',
        lines: saleLines(),
    });
}

function reversalPayloadHash(originalEntryId: string) {
    return buildJournalPayloadHash({
        tenantId: 'tenant-a',
        economicDate: POST_DATE,
        postingDate: POST_DATE,
        description: 'Reverso: Venta #1',
        referenceId: originalEntryId,
        referenceType: 'JOURNAL_REVERSAL',
        entryKind: 'REVERSAL',
        reversalOfId: originalEntryId,
        lines: [
            { accountId: 'cash', debit: '0.0000', credit: '100.0000' },
            { accountId: 'sales', debit: '100.0000', credit: '0.0000' },
        ],
    });
}

describe('journalPosting', () => {
    it('crea una sola póliza por postingKey y responde replay exacto sin duplicar auditoría', async () => {
        const { db, state } = buildFakeDb();

        const first = await postJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            postingKey: 'sale:sale-1',
            payloadHash: originalPayloadHash(),
            economicDate: POST_DATE,
            postingDate: POST_DATE,
            postedAt: POST_DATE,
            description: 'Venta #1',
            referenceId: 'sale-1',
            referenceType: 'SALE',
            lines: saleLines(),
        });
        const replay = await postJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            postingKey: 'sale:sale-1',
            payloadHash: originalPayloadHash(),
            economicDate: POST_DATE,
            postingDate: POST_DATE,
            postedAt: POST_DATE,
            description: 'Venta #1',
            referenceId: 'sale-1',
            referenceType: 'SALE',
            lines: saleLines(),
        });

        expect(first.idempotentReplay).toBe(false);
        expect(replay).toMatchObject({
            idempotentReplay: true,
            entry: { id: first.entry.id, postingKey: 'sale:sale-1' },
        });
        expect(state.entries).toHaveLength(1);
        expect(state.lines).toHaveLength(2);
        expect(state.audits).toHaveLength(1);
        expect(state.accounts.find((account) => account.id === 'cash')?.balance.toFixed(4)).toBe('100.0000');
        expect(state.accounts.find((account) => account.id === 'sales')?.balance.toFixed(4)).toBe('100.0000');
    });

    it('rechaza reutilizar la misma postingKey con otro payloadHash', async () => {
        const { db } = buildFakeDb();

        await postJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            postingKey: 'sale:sale-1',
            payloadHash: originalPayloadHash(),
            economicDate: POST_DATE,
            postingDate: POST_DATE,
            postedAt: POST_DATE,
            description: 'Venta #1',
            referenceId: 'sale-1',
            referenceType: 'SALE',
            lines: saleLines(),
        });

        await expect(postJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            postingKey: 'sale:sale-1',
            payloadHash: changedPayloadHash(),
            economicDate: POST_DATE,
            postingDate: POST_DATE,
            postedAt: POST_DATE,
            description: 'Venta #1 alterada',
            referenceId: 'sale-1',
            referenceType: 'SALE',
            lines: saleLines(),
        })).rejects.toBeInstanceOf(JournalPostingError);

        await expect(postJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            postingKey: 'sale:sale-1',
            payloadHash: changedPayloadHash(),
            economicDate: POST_DATE,
            postingDate: POST_DATE,
            postedAt: POST_DATE,
            description: 'Venta #1 alterada',
            referenceId: 'sale-1',
            referenceType: 'SALE',
            lines: saleLines(),
        })).rejects.toMatchObject({
            code: 'JOURNAL_POSTING_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
        });
    });

    it('crea un solo reverso exacto y deja saldos nuevamente en cero', async () => {
        const { db, state } = buildFakeDb();

        const original = await postJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            postingKey: 'sale:sale-1',
            payloadHash: originalPayloadHash(),
            economicDate: POST_DATE,
            postingDate: POST_DATE,
            postedAt: POST_DATE,
            description: 'Venta #1',
            referenceId: 'sale-1',
            referenceType: 'SALE',
            lines: saleLines(),
        });

        const reversal = await reverseJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            originalEntryId: original.entry.id,
            postingKey: 'reversal:sale:sale-1',
            payloadHash: reversalPayloadHash(original.entry.id),
            postingDate: POST_DATE,
            postedAt: POST_DATE,
        });
        const replay = await reverseJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            originalEntryId: original.entry.id,
            postingKey: 'reversal:sale:sale-1',
            payloadHash: reversalPayloadHash(original.entry.id),
            postingDate: POST_DATE,
            postedAt: POST_DATE,
        });

        expect(reversal.idempotentReplay).toBe(false);
        expect(reversal.entry).toMatchObject({
            entryKind: 'REVERSAL',
            reversalOfId: original.entry.id,
        });
        expect(replay).toMatchObject({
            idempotentReplay: true,
            entry: { id: reversal.entry.id },
        });
        expect(state.entries).toHaveLength(2);
        expect(state.audits.map((audit) => audit.action)).toEqual([
            'JOURNAL_POSTED',
            'JOURNAL_REVERSED',
        ]);
        expect(state.accounts.find((account) => account.id === 'cash')?.balance.toFixed(4)).toBe('0.0000');
        expect(state.accounts.find((account) => account.id === 'sales')?.balance.toFixed(4)).toBe('0.0000');
    });
});
