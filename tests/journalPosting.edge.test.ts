import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    buildJournalPayloadHash,
    postJournalOnce,
    reverseJournalOnce,
    type JournalHeaderRecord,
    type JournalPostingDatabase,
} from '../backend/services/journalPosting';

const TENANT_ID = 'tenant-a';
const USER_ID = 'user-a';
const POST_DATE = new Date('2026-08-31T15:00:00.000Z');
const LINES = [
    { accountId: 'cash', debit: '100.0000', credit: '0.0000' },
    { accountId: 'sales', debit: '0.0000', credit: '100.0000' },
];

const hashFor = (
    lines: Array<{ accountId: string; debit: string | Decimal; credit: string | Decimal }> = LINES,
    description = 'Venta #1',
) => buildJournalPayloadHash({
    tenantId: TENANT_ID,
    economicDate: POST_DATE,
    postingDate: POST_DATE,
    description,
    referenceId: 'sale-1',
    referenceType: 'SALE',
    lines,
});

const header = (overrides: Partial<JournalHeaderRecord> = {}): JournalHeaderRecord => ({
    id: 'entry-winner',
    tenantId: TENANT_ID,
    date: POST_DATE,
    economicDate: POST_DATE,
    postedAt: POST_DATE,
    description: 'Venta #1',
    referenceId: 'sale-1',
    referenceType: 'SALE',
    isAutomatic: true,
    entryKind: 'ORIGINAL',
    postingKey: 'sale:sale-1',
    payloadHash: hashFor(),
    reversalOfId: null,
    createdBy: USER_ID,
    createdAt: POST_DATE,
    ...overrides,
});

const dbWith = (input: {
    actor?: boolean;
    findEntry?: (args: any) => Promise<any>;
    transaction?: (callback: (tx: any) => Promise<any>) => Promise<any>;
}) => {
    const userFind = vi.fn(async ({ where }: any) => input.actor === false
        ? null
        : where.id === USER_ID && where.tenantId === TENANT_ID && where.status === 'ACTIVE'
            ? { id: USER_ID }
            : null);
    const entryFind = vi.fn(input.findEntry ?? (async () => null));
    const transaction = vi.fn(input.transaction ?? (async () => {
        throw new Error('No se esperaba transaccion');
    }));
    return {
        db: {
            user: { findFirst: userFind },
            journalEntry: { findFirst: entryFind },
            $transaction: transaction,
        } as unknown as JournalPostingDatabase,
        spies: { userFind, entryFind, transaction },
    };
};

const postInput = (db: JournalPostingDatabase, overrides: Record<string, unknown> = {}) => ({
    db,
    tenantId: TENANT_ID,
    userId: USER_ID,
    postingKey: 'sale:sale-1',
    payloadHash: hashFor(),
    economicDate: POST_DATE,
    postingDate: POST_DATE,
    postedAt: POST_DATE,
    description: 'Venta #1',
    referenceId: 'sale-1',
    referenceType: 'SALE',
    lines: LINES,
    ...overrides,
});

const txHarness = (input: {
    periodStatus?: string | null;
    accounts?: Array<{ id: string; code: string; type: string; balance: string }>;
} = {}) => {
    const accounts = input.accounts ?? [
        { id: 'cash', code: '1.1.1', type: 'ASSET', balance: '0.0000' },
        { id: 'sales', code: '4.1.1', type: 'REVENUE', balance: '0.0000' },
    ];
    const createEntry = vi.fn(async ({ data }: any) => header({ ...data, id: 'entry-new' }));
    const createLines = vi.fn(async ({ data }: any) => ({ count: data.length }));
    const createAudit = vi.fn(async () => ({ id: 'audit-new' }));
    const updateAccount = vi.fn(async () => ({ count: 1 }));
    const findAccounts = vi.fn(async ({ where }: any) => accounts
        .filter(account => where.id.in.includes(account.id)));
    const findPeriod = vi.fn(async () => input.periodStatus ? { status: input.periodStatus } : null);
    const tx: any = {
        user: { findFirst: vi.fn(async () => ({ id: USER_ID })) },
        fiscalPeriod: { findUnique: findPeriod },
        account: { findMany: findAccounts, updateMany: updateAccount },
        journalEntry: { findFirst: vi.fn(async () => null), create: createEntry },
        journalLine: { createMany: createLines },
        auditLog: { create: createAudit },
    };
    return {
        tx,
        spies: { createEntry, createLines, createAudit, updateAccount, findAccounts, findPeriod },
    };
};

describe('journalPosting - bordes de integridad', () => {
    it('genera la misma huella para el mismo asiento con lineas reordenadas y montos canonicos', () => {
        const reordered = [
            { accountId: 'sales', debit: new Decimal(0), credit: new Decimal('100') },
            { accountId: 'cash', debit: new Decimal('100.0000'), credit: new Decimal(0) },
        ];
        expect(hashFor(reordered)).toBe(hashFor());
    });

    it('rechaza una huella declarada que no corresponde a las lineas materiales', async () => {
        const { db, spies } = dbWith({});
        await expect(postJournalOnce(postInput(db, {
            payloadHash: hashFor(),
            lines: [
                { accountId: 'cash', debit: '101.0000', credit: '0.0000' },
                { accountId: 'sales', debit: '0.0000', credit: '101.0000' },
            ],
        }) as never)).rejects.toMatchObject({
            code: 'JOURNAL_POSTING_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
        });
        expect(spies.entryFind).not.toHaveBeenCalled();
        expect(spies.transaction).not.toHaveBeenCalled();
    });

    it('rechaza Number para no heredar redondeo binario', async () => {
        const { db, spies } = dbWith({});
        await expect(postJournalOnce(postInput(db, {
            lines: [
                { accountId: 'cash', debit: 100, credit: '0' },
                { accountId: 'sales', debit: '0', credit: '100' },
            ],
        }) as never)).rejects.toMatchObject({ code: 'INVALID_JOURNAL_POSTING' });
        expect(spies.transaction).not.toHaveBeenCalled();
    });

    it('rechaza importes con mas de cuatro decimales', async () => {
        const { db, spies } = dbWith({});
        await expect(postJournalOnce(postInput(db, {
            lines: [
                { accountId: 'cash', debit: '100.00001', credit: '0' },
                { accountId: 'sales', debit: '0', credit: '100.00001' },
            ],
        }) as never)).rejects.toMatchObject({ code: 'INVALID_JOURNAL_POSTING' });
        expect(spies.transaction).not.toHaveBeenCalled();
    });

    it('rechaza un asiento descuadrado con Decimal exacto', async () => {
        const { db, spies } = dbWith({});
        await expect(postJournalOnce(postInput(db, {
            lines: [
                { accountId: 'cash', debit: '100.0000', credit: '0' },
                { accountId: 'sales', debit: '0', credit: '99.9999' },
            ],
        }) as never)).rejects.toMatchObject({ code: 'JOURNAL_ENTRY_UNBALANCED' });
        expect(spies.transaction).not.toHaveBeenCalled();
    });

    it('un actor inactivo no puede observar siquiera un replay existente', async () => {
        const { db, spies } = dbWith({ actor: false, findEntry: async () => header() });
        await expect(postJournalOnce(postInput(db))).rejects.toMatchObject({
            code: 'JOURNAL_POSTING_ACTOR_FORBIDDEN',
            httpStatus: 403,
        });
        expect(spies.entryFind).not.toHaveBeenCalled();
        expect(spies.transaction).not.toHaveBeenCalled();
    });

    it('aborta antes del encabezado si falta una cuenta del tenant', async () => {
        const harness = txHarness({
            accounts: [{ id: 'cash', code: '1.1.1', type: 'ASSET', balance: '0.0000' }],
        });
        const { db } = dbWith({ transaction: callback => callback(harness.tx) });
        await expect(postJournalOnce(postInput(db))).rejects.toMatchObject({
            code: 'JOURNAL_ACCOUNT_NOT_FOUND',
        });
        expect(harness.spies.findAccounts).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: TENANT_ID, id: { in: ['cash', 'sales'] } },
        }));
        expect(harness.spies.createEntry).not.toHaveBeenCalled();
        expect(harness.spies.createAudit).not.toHaveBeenCalled();
    });

    it('usa el mes fiscal de Managua y un periodo cerrado no toca dinero ni auditoria', async () => {
        // En UTC ya es septiembre, pero en Nicaragua aun es 31 de agosto.
        const monthEdge = new Date('2026-09-01T01:00:00.000Z');
        const monthEdgeHash = buildJournalPayloadHash({
            tenantId: TENANT_ID,
            economicDate: POST_DATE,
            postingDate: monthEdge,
            description: 'Venta #1',
            referenceId: 'sale-1',
            referenceType: 'SALE',
            lines: LINES,
        });
        const harness = txHarness({ periodStatus: 'CLOSED' });
        const { db } = dbWith({ transaction: callback => callback(harness.tx) });
        await expect(postJournalOnce(postInput(db, {
            postingDate: monthEdge,
            payloadHash: monthEdgeHash,
        }))).rejects.toMatchObject({
            code: 'JOURNAL_PERIOD_LOCKED',
            httpStatus: 409,
        });
        expect(harness.spies.findPeriod).toHaveBeenCalledWith({
            where: { tenantId_year_month: { tenantId: TENANT_ID, year: 2026, month: 8 } },
            select: { status: true },
        });
        expect(harness.spies.createEntry).not.toHaveBeenCalled();
        expect(harness.spies.updateAccount).not.toHaveBeenCalled();
        expect(harness.spies.createAudit).not.toHaveBeenCalled();
    });

    it('tras P2002 relee fuera de la transaccion y devuelve el ganador exacto', async () => {
        let lostRace = false;
        const winner = header();
        const { db, spies } = dbWith({
            findEntry: async () => lostRace ? winner : null,
            transaction: async () => {
                lostRace = true;
                throw { code: 'P2002' };
            },
        });
        const result = await postJournalOnce(postInput(db));
        expect(result).toEqual({ entry: winner, idempotentReplay: true });
        expect(spies.entryFind).toHaveBeenCalledTimes(2);
        expect(spies.userFind).toHaveBeenCalledTimes(2);
    });

    it('tras P2002 rechaza al ganador si su payloadHash diverge', async () => {
        let lostRace = false;
        const winner = header({ payloadHash: 'b'.repeat(64) });
        const { db } = dbWith({
            findEntry: async () => lostRace ? winner : null,
            transaction: async () => {
                lostRace = true;
                throw { code: 'P2002' };
            },
        });
        await expect(postJournalOnce(postInput(db))).rejects.toMatchObject({
            code: 'JOURNAL_POSTING_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
        });
    });

    it('resuelve P2002 del indice unico reversalOfId sin crear un segundo reverso', async () => {
        const original = {
            ...header({ id: 'entry-original', postingKey: 'sale:sale-1' }),
            lines: [
                { id: 'line-1', accountId: 'cash', debit: '100.0000', credit: '0.0000' },
                { id: 'line-2', accountId: 'sales', debit: '0.0000', credit: '100.0000' },
            ],
        };
        const reversalHash = buildJournalPayloadHash({
            tenantId: TENANT_ID,
            economicDate: POST_DATE,
            postingDate: POST_DATE,
            description: 'Reverso: Venta #1',
            referenceId: original.id,
            referenceType: 'JOURNAL_REVERSAL',
            entryKind: 'REVERSAL',
            reversalOfId: original.id,
            lines: [
                { accountId: 'cash', debit: '0.0000', credit: '100.0000' },
                { accountId: 'sales', debit: '100.0000', credit: '0.0000' },
            ],
        });
        const winner = header({
            id: 'entry-reversal',
            postingKey: 'reversal:sale:sale-1',
            payloadHash: reversalHash,
            entryKind: 'REVERSAL',
            reversalOfId: original.id,
        });
        let lostRace = false;
        const { db, spies } = dbWith({
            findEntry: async ({ where }) => {
                if (where.id === original.id) return original;
                if (lostRace && where.reversalOfId === original.id) return winner;
                return null;
            },
            transaction: async () => {
                lostRace = true;
                throw { code: 'P2002' };
            },
        });

        const result = await reverseJournalOnce({
            db,
            tenantId: TENANT_ID,
            userId: USER_ID,
            originalEntryId: original.id,
            postingKey: 'reversal:sale:sale-1',
            payloadHash: reversalHash,
            postingDate: POST_DATE,
            postedAt: POST_DATE,
        });

        expect(result).toEqual({ entry: winner, idempotentReplay: true });
        expect(spies.entryFind).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: original.id, tenantId: TENANT_ID },
        }));
        expect(spies.userFind).toHaveBeenCalledTimes(2);
    });

    it('un reverso tambien respeta el periodo contable cerrado', async () => {
        const monthEdge = new Date('2026-09-01T01:00:00.000Z');
        const original = {
            ...header({ id: 'entry-original' }),
            lines: [
                { id: 'line-1', accountId: 'cash', debit: '100.0000', credit: '0.0000' },
                { id: 'line-2', accountId: 'sales', debit: '0.0000', credit: '100.0000' },
            ],
        };
        const reversalHash = buildJournalPayloadHash({
            tenantId: TENANT_ID,
            economicDate: POST_DATE,
            postingDate: monthEdge,
            description: 'Reverso: Venta #1',
            referenceId: original.id,
            referenceType: 'JOURNAL_REVERSAL',
            entryKind: 'REVERSAL',
            reversalOfId: original.id,
            lines: [
                { accountId: 'cash', debit: '0.0000', credit: '100.0000' },
                { accountId: 'sales', debit: '100.0000', credit: '0.0000' },
            ],
        });
        const harness = txHarness({ periodStatus: 'CLOSED' });
        harness.tx.journalEntry.findFirst = vi.fn(async ({ where }: any) =>
            where.id === original.id ? original : null);
        const { db } = dbWith({
            findEntry: async ({ where }) => where.id === original.id ? original : null,
            transaction: callback => callback(harness.tx),
        });

        await expect(reverseJournalOnce({
            db,
            tenantId: TENANT_ID,
            userId: USER_ID,
            originalEntryId: original.id,
            postingKey: 'reversal:sale:sale-1',
            payloadHash: reversalHash,
            postingDate: monthEdge,
            postedAt: POST_DATE,
        })).rejects.toMatchObject({ code: 'JOURNAL_PERIOD_LOCKED', httpStatus: 409 });
        expect(harness.spies.createEntry).not.toHaveBeenCalled();
        expect(harness.spies.updateAccount).not.toHaveBeenCalled();
        expect(harness.spies.createAudit).not.toHaveBeenCalled();
        expect(harness.spies.findPeriod).toHaveBeenCalledWith({
            where: { tenantId_year_month: { tenantId: TENANT_ID, year: 2026, month: 8 } },
            select: { status: true },
        });
    });
});
