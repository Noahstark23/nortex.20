import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
    'backend/prisma/migrations/20260831_cash_close_journal_idempotency/migration.sql',
    'utf8',
);

function modelBlock(name: string): string {
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`No se encontro model ${name}`);
    return match[0];
}

describe('PR-01 — persistencia idempotente de caja y contabilidad', () => {
    it('conserva turnos historicos y protege la llave de cierre por tenant', () => {
        const shift = modelBlock('Shift');

        expect(shift).toMatch(/closeEventId\s+String\?\s+@db\.VarChar\(128\)/);
        expect(shift).toMatch(/closePayloadHash\s+String\?\s+@db\.VarChar\(64\)/);
        expect(shift).toContain('@@unique([tenantId, closeEventId])');
    });

    it('modela una poliza por postingKey y un solo reverso por original', () => {
        const entry = modelBlock('JournalEntry');

        expect(entry).toMatch(/postingKey\s+String\?\s+@db\.VarChar\(191\)/);
        expect(entry).toMatch(/payloadHash\s+String\?\s+@db\.VarChar\(64\)/);
        expect(entry).toMatch(/economicDate\s+DateTime\?/);
        expect(entry).toMatch(/postedAt\s+DateTime\?/);
        expect(entry).toMatch(/entryKind\s+String\s+@default\("ORIGINAL"\)\s+@db\.VarChar\(32\)/);
        expect(entry).toMatch(/reversalOfId\s+String\?\s+@unique/);
        expect(entry).toContain('@@unique([tenantId, postingKey])');
        expect(entry).toContain('@relation("JournalEntryReversal"');
        expect(entry).toContain('onDelete: Restrict');
    });

    it('usa Decimal(18,4) en saldos y partidas sin convertir a Float', () => {
        const account = modelBlock('Account');
        const line = modelBlock('JournalLine');

        expect(account).toMatch(/balance\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(18, 4\)/);
        expect(line).toMatch(/debit\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(18, 4\)/);
        expect(line).toMatch(/credit\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(18, 4\)/);
        expect(account).not.toMatch(/balance\s+Float/);
        expect(line).not.toMatch(/(?:debit|credit)\s+Float/);
    });

    it('migra sin borrar ni reescribir historicos', () => {
        expect(migration).toContain('ADD COLUMN `closeEventId` VARCHAR(128) NULL');
        expect(migration).toContain('ADD COLUMN `postingKey` VARCHAR(191) NULL');
        expect(migration).toContain('CREATE UNIQUE INDEX `Shift_tenantId_closeEventId_key`');
        expect(migration).toContain('CREATE UNIQUE INDEX `JournalEntry_tenantId_postingKey_key`');
        expect(migration).toContain('CREATE UNIQUE INDEX `JournalEntry_reversalOfId_key`');
        expect(migration).toContain('JournalEntry_reversalOfId_fkey');
        expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
        expect(migration).toMatch(/`balance` DECIMAL\(18,4\) NOT NULL DEFAULT 0/);
        expect(migration).toMatch(/`debit` DECIMAL\(18,4\) NOT NULL DEFAULT 0/);
        expect(migration).toMatch(/`credit` DECIMAL\(18,4\) NOT NULL DEFAULT 0/);
        expect(migration).not.toMatch(/^(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
        expect(migration).not.toContain('--accept-data-loss');
    });
});
