import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createJournalEntry } from '../backend/services/accounting';

const enabled = process.env.NORTEX_MYSQL_INTEGRATION === '1';
const run = enabled ? describe : describe.skip;
const url = new URL(process.env.DATABASE_URL || 'mysql://u:p@127.0.0.1:1/unavailable');
url.searchParams.set('connection_limit', '1');
url.searchParams.set('pool_timeout', '2');
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });

run('asiento real con una sola conexión MySQL', () => {
    afterAll(async () => db.$disconnect());
    it('siembra y resuelve cuentas sin salir de la transacción ni agotar el pool', async () => {
        const tenantId = `qa-pool-${randomUUID()}`;
        await db.tenant.create({ data: { id: tenantId, businessName: 'QA Pool', taxId: tenantId } });
        const lines = [{ accountCode: '1.1.1', debit: 25, credit: 0 }, { accountCode: '4.1.1', debit: 0, credit: 25 }];
        await db.$transaction(tx => createJournalEntry(tx, tenantId, 'QA pool uno', 'pool-sale', 'SALE', 'qa-user', lines), { timeout: 6000 });
        const rows = await db.account.findMany({ where: { tenantId, code: { in: ['1.1.1', '4.1.1'] } }, orderBy: { code: 'asc' } });
        expect(rows.map(row => row.balance.toFixed(4))).toEqual(['25.0000', '25.0000']);
        expect(await db.journalEntry.count({ where: { tenantId } })).toBe(1);
        await expect(db.$transaction(tx => createJournalEntry(tx, tenantId, 'Rollback', 'missing', 'SALE', 'qa-user', [lines[0], { accountCode: 'bad', debit: 0, credit: 25 }]))).rejects.toThrow('CUENTA_INEXISTENTE');
        expect(await db.journalEntry.count({ where: { tenantId } })).toBe(1);
        expect((await db.account.findMany({ where: { tenantId, code: { in: ['1.1.1', '4.1.1'] } }, orderBy: { code: 'asc' } })).map(row => row.balance.toFixed(4))).toEqual(['25.0000', '25.0000']);
    }, 15_000);
});
