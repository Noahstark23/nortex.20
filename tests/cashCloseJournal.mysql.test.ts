import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import {
    buildJournalPayloadHash,
    postJournalOnce,
    reverseJournalOnce,
    type JournalPostingDatabase,
} from '../backend/services/journalPosting';
import {
    closeLegacyShift,
    type ShiftCloseDatabase,
} from '../backend/services/shiftCloseService';

/**
 * Smoke de concurrencia contra MySQL 8 real.
 *
 * No corre dentro de `npm test`: el wrapper
 * `scripts/test-cash-close-journal-mysql.sh` crea una BD/usuario efimeros en
 * `nortex-mysql-dev`, activa esta suite y siempre limpia al terminar.
 */
const mysqlEnabled = process.env.NORTEX_MYSQL_INTEGRATION === '1';
const describeMysql = mysqlEnabled ? describe : describe.skip;

const TENANT_ID = 'tenant-pr01-mysql';
const USER_ID = 'user-pr01-mysql';
const CASH_ACCOUNT_ID = 'account-cash-pr01';
const SALES_ACCOUNT_ID = 'account-sales-pr01';
const POSTING_DATE = new Date('2026-08-31T15:00:00.000Z');

const journalDb = prisma as unknown as JournalPostingDatabase;
const shiftDb = prisma as unknown as ShiftCloseDatabase;

const saleLines = (creditAccountId = SALES_ACCOUNT_ID) => [
    { accountId: CASH_ACCOUNT_ID, debit: '125.4321', credit: '0.0000' },
    { accountId: creditAccountId, debit: '0.0000', credit: '125.4321' },
];

const journalCommand = (
    postingKey: string,
    description: string,
    lines = saleLines(),
) => {
    const payloadHash = buildJournalPayloadHash({
        tenantId: TENANT_ID,
        economicDate: POSTING_DATE,
        postingDate: POSTING_DATE,
        description,
        referenceId: 'sale-pr01-mysql',
        referenceType: 'SALE',
        lines,
    });
    return {
        db: journalDb,
        tenantId: TENANT_ID,
        userId: USER_ID,
        postingKey,
        payloadHash,
        economicDate: POSTING_DATE,
        postingDate: POSTING_DATE,
        postedAt: POSTING_DATE,
        description,
        referenceId: 'sale-pr01-mysql',
        referenceType: 'SALE',
        lines,
    };
};

async function createCloseFixture(shiftId: string): Promise<void> {
    await prisma.shift.create({
        data: {
            id: shiftId,
            tenantId: TENANT_ID,
            userId: USER_ID,
            initialCash: '100.00',
            initialCashUsd: '0.0000',
            status: 'OPEN',
            startTime: new Date('2026-08-31T08:00:00.000Z'),
        },
    });
    await prisma.sale.create({
        data: {
            id: `sale-${shiftId}`,
            tenantId: TENANT_ID,
            shiftId,
            total: '50.0000',
            status: 'COMPLETED',
            paymentMethod: 'CASH',
            createdAt: new Date('2026-08-31T10:00:00.000Z'),
        },
    });
}

describeMysql('PR-01 cash close + journal en MySQL 8 real', () => {
    beforeAll(async () => {
        await prisma.tenant.create({
            data: {
                id: TENANT_ID,
                businessName: 'Nortex PR-01 MySQL Integration',
                taxId: 'PR01-MYSQL-EPHEMERAL',
                theftAlertThreshold: '500.00',
            },
        });
        await prisma.user.create({
            data: {
                id: USER_ID,
                tenantId: TENANT_ID,
                password: 'fixture-not-used-for-authentication',
                name: 'Cashier PR-01',
                role: 'CASHIER',
                status: 'ACTIVE',
            },
        });
        await prisma.account.createMany({
            data: [
                {
                    id: CASH_ACCOUNT_ID,
                    tenantId: TENANT_ID,
                    code: '1.1.1-PR01',
                    name: 'Caja PR-01',
                    type: 'ASSET',
                    balance: '0.0000',
                },
                {
                    id: SALES_ACCOUNT_ID,
                    tenantId: TENANT_ID,
                    code: '4.1.1-PR01',
                    name: 'Ventas PR-01',
                    type: 'REVENUE',
                    balance: '0.0000',
                },
            ],
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('50 postings concurrentes producen una poliza, dos lineas, una auditoria y un solo saldo', async () => {
        const command = journalCommand('mysql:sale:50-way', 'Venta concurrente PR-01');
        const results = await Promise.all(
            Array.from({ length: 50 }, () => postJournalOnce(command)),
        );

        expect(results.filter(result => !result.idempotentReplay)).toHaveLength(1);
        expect(results.filter(result => result.idempotentReplay)).toHaveLength(49);
        expect(new Set(results.map(result => result.entry.id))).toHaveLength(1);

        const entry = await prisma.journalEntry.findFirstOrThrow({
            where: { tenantId: TENANT_ID, postingKey: command.postingKey },
            select: { id: true },
        });
        expect(await prisma.journalEntry.count({
            where: { tenantId: TENANT_ID, postingKey: command.postingKey },
        })).toBe(1);
        expect(await prisma.journalLine.count({ where: { journalEntryId: entry.id } })).toBe(2);
        expect(await prisma.auditLog.count({
            where: { tenantId: TENANT_ID, action: 'JOURNAL_POSTED' },
        })).toBe(1);

        const accounts = await prisma.account.findMany({
            where: { tenantId: TENANT_ID, id: { in: [CASH_ACCOUNT_ID, SALES_ACCOUNT_ID] } },
            select: { id: true, balance: true },
        });
        expect(Object.fromEntries(accounts.map(account => [
            account.id,
            new Decimal(account.balance.toString()).toFixed(4),
        ]))).toEqual({
            [CASH_ACCOUNT_ID]: '125.4321',
            [SALES_ACCOUNT_ID]: '125.4321',
        });
    }, 30_000);

    it('misma postingKey con otra intencion responde 409 y no agrega efectos', async () => {
        const before = {
            entries: await prisma.journalEntry.count({ where: { tenantId: TENANT_ID } }),
            lines: await prisma.journalLine.count(),
            audits: await prisma.auditLog.count({ where: { tenantId: TENANT_ID } }),
            accounts: await prisma.account.findMany({
                where: { tenantId: TENANT_ID },
                orderBy: { id: 'asc' },
                select: { balance: true },
            }),
        };
        const changed = journalCommand(
            'mysql:sale:50-way',
            'Venta concurrente PR-01 ALTERADA',
        );

        await expect(postJournalOnce(changed)).rejects.toMatchObject({
            code: 'JOURNAL_POSTING_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
        });

        expect(await prisma.journalEntry.count({ where: { tenantId: TENANT_ID } })).toBe(before.entries);
        expect(await prisma.journalLine.count()).toBe(before.lines);
        expect(await prisma.auditLog.count({ where: { tenantId: TENANT_ID } })).toBe(before.audits);
        const accountsAfter = await prisma.account.findMany({
            where: { tenantId: TENANT_ID },
            orderBy: { id: 'asc' },
            select: { balance: true },
        });
        expect(accountsAfter.map(account => account.balance.toString()))
            .toEqual(before.accounts.map(account => account.balance.toString()));
    });

    it('cuenta ausente revierte encabezado, lineas, auditoria y saldos', async () => {
        const before = {
            entries: await prisma.journalEntry.count({ where: { tenantId: TENANT_ID } }),
            lines: await prisma.journalLine.count(),
            audits: await prisma.auditLog.count({ where: { tenantId: TENANT_ID } }),
            cash: await prisma.account.findUniqueOrThrow({
                where: { id: CASH_ACCOUNT_ID },
                select: { balance: true },
            }),
        };
        const command = journalCommand(
            'mysql:sale:missing-account',
            'Venta con cuenta ausente',
            saleLines('account-does-not-exist'),
        );

        await expect(postJournalOnce(command)).rejects.toMatchObject({
            code: 'JOURNAL_ACCOUNT_NOT_FOUND',
            httpStatus: 422,
        });

        expect(await prisma.journalEntry.count({ where: { tenantId: TENANT_ID } })).toBe(before.entries);
        expect(await prisma.journalEntry.count({
            where: { tenantId: TENANT_ID, postingKey: command.postingKey },
        })).toBe(0);
        expect(await prisma.journalLine.count()).toBe(before.lines);
        expect(await prisma.auditLog.count({ where: { tenantId: TENANT_ID } })).toBe(before.audits);
        const cashAfter = await prisma.account.findUniqueOrThrow({
            where: { id: CASH_ACCOUNT_ID },
            select: { balance: true },
        });
        expect(cashAfter.balance.toString()).toBe(before.cash.balance.toString());
    });

    it('20 reversos concurrentes crean uno, auditan una vez y restauran los saldos exactos', async () => {
        const accountIds = [CASH_ACCOUNT_ID, SALES_ACCOUNT_ID];
        const balancesBefore = await prisma.account.findMany({
            where: { tenantId: TENANT_ID, id: { in: accountIds } },
            orderBy: { id: 'asc' },
            select: { id: true, balance: true },
        });
        const originalLines = saleLines();
        const originalDescription = 'Venta a revertir PR-01';
        const original = await postJournalOnce(journalCommand(
            'mysql:sale:reverse-original',
            originalDescription,
            originalLines,
        ));
        expect(original.idempotentReplay).toBe(false);

        const reversalDescription = `Reverso: ${originalDescription}`;
        const reversalLines = originalLines.map(line => ({
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
        }));
        const reversalPayloadHash = buildJournalPayloadHash({
            tenantId: TENANT_ID,
            economicDate: POSTING_DATE,
            postingDate: POSTING_DATE,
            description: reversalDescription,
            referenceId: original.entry.id,
            referenceType: 'JOURNAL_REVERSAL',
            entryKind: 'REVERSAL',
            reversalOfId: original.entry.id,
            lines: reversalLines,
        });
        const reversalCommand = {
            db: journalDb,
            tenantId: TENANT_ID,
            userId: USER_ID,
            originalEntryId: original.entry.id,
            postingKey: 'mysql:journal:reverse-20-way',
            payloadHash: reversalPayloadHash,
            economicDate: POSTING_DATE,
            postingDate: POSTING_DATE,
            postedAt: POSTING_DATE,
            description: reversalDescription,
        };

        const results = await Promise.all(
            Array.from({ length: 20 }, () => reverseJournalOnce(reversalCommand)),
        );

        expect(results.filter(result => !result.idempotentReplay)).toHaveLength(1);
        expect(results.filter(result => result.idempotentReplay)).toHaveLength(19);
        expect(new Set(results.map(result => result.entry.id))).toHaveLength(1);

        const reversal = await prisma.journalEntry.findFirstOrThrow({
            where: { tenantId: TENANT_ID, reversalOfId: original.entry.id },
            select: { id: true, entryKind: true, postingKey: true },
        });
        expect(reversal).toMatchObject({
            entryKind: 'REVERSAL',
            postingKey: reversalCommand.postingKey,
        });
        expect(await prisma.journalEntry.count({
            where: { tenantId: TENANT_ID, reversalOfId: original.entry.id },
        })).toBe(1);
        expect(await prisma.journalLine.count({ where: { journalEntryId: reversal.id } })).toBe(2);
        expect(await prisma.auditLog.count({
            where: { tenantId: TENANT_ID, action: 'JOURNAL_REVERSED' },
        })).toBe(1);

        const balancesAfter = await prisma.account.findMany({
            where: { tenantId: TENANT_ID, id: { in: accountIds } },
            orderBy: { id: 'asc' },
            select: { id: true, balance: true },
        });
        expect(balancesAfter.map(account => ({
            id: account.id,
            balance: new Decimal(account.balance.toString()).toFixed(4),
        }))).toEqual(balancesBefore.map(account => ({
            id: account.id,
            balance: new Decimal(account.balance.toString()).toFixed(4),
        })));
    }, 30_000);

    it('dos cierres identicos concurrentes dejan un SHIFT_CLOSED y un replay', async () => {
        const shiftId = 'shift-pr01-identical';
        const eventId = '9e742da8-d440-4b7f-9ff4-629827a77812';
        await createCloseFixture(shiftId);
        const input = {
            shiftId,
            declaredCash: '150.00',
            auditNotes: 'Conteo MySQL PR-01',
            clientEventId: eventId,
        };

        const results = await Promise.all([
            closeLegacyShift(shiftDb, { tenantId: TENANT_ID, userId: USER_ID, role: 'CASHIER' }, input),
            closeLegacyShift(shiftDb, { tenantId: TENANT_ID, userId: USER_ID, role: 'CASHIER' }, input),
        ]);

        expect(results.map(result => result.body.idempotentReplay).sort()).toEqual([false, true]);
        expect(await prisma.auditLog.count({
            where: { tenantId: TENANT_ID, action: 'SHIFT_CLOSED' },
        })).toBe(1);
        expect(await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).toMatchObject({
            status: 'CLOSED',
            closeEventId: eventId,
        });

        const replay = await closeLegacyShift(
            shiftDb,
            { tenantId: TENANT_ID, userId: USER_ID, role: 'CASHIER' },
            input,
        );
        expect(replay.body.idempotentReplay).toBe(true);
        expect(await prisma.auditLog.count({
            where: { tenantId: TENANT_ID, action: 'SHIFT_CLOSED' },
        })).toBe(1);
    }, 15_000);

    it('dos cierres distintos concurrentes dejan un ganador y un conflicto 409 sin segunda auditoria', async () => {
        const shiftId = 'shift-pr01-conflict';
        const eventId = '06889a39-617c-4c14-bb9a-a01642209fee';
        await createCloseFixture(shiftId);
        const context = { tenantId: TENANT_ID, userId: USER_ID, role: 'CASHIER' };
        const firstInput = { shiftId, declaredCash: '150.00', clientEventId: eventId };
        const secondInput = { shiftId, declaredCash: '151.00', clientEventId: eventId };

        const settled = await Promise.allSettled([
            closeLegacyShift(shiftDb, context, firstInput),
            closeLegacyShift(shiftDb, context, secondInput),
        ]);
        const fulfilled = settled.filter(
            (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof closeLegacyShift>>> =>
                result.status === 'fulfilled',
        );
        const rejected = settled.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
        );

        expect(fulfilled).toHaveLength(1);
        expect(fulfilled[0].value.body.idempotentReplay).toBe(false);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toMatchObject({
            code: 'CLOSE_SHIFT_CONFLICT',
            httpStatus: 409,
        });
        expect(await prisma.auditLog.count({
            where: { tenantId: TENANT_ID, action: 'SHIFT_CLOSED' },
        })).toBe(2);
        expect(await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).toMatchObject({
            status: 'CLOSED',
            closeEventId: eventId,
        });
    }, 15_000);
});
