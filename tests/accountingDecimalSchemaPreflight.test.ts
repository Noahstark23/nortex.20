import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
    applyAccountingDecimalSchemaPreflight,
    decideAccountingDecimalConvergence,
    inspectAccountingDecimalColumn,
    isSafeDecimalWidening,
    UnsafeSchemaStateError,
    type AccountingDecimalColumnRow,
    type AccountingDecimalColumnState,
    type DeploySchemaClient,
} from '../scripts/deploy-schema-preflight';

type ColumnKey = 'Account.balance' | 'JournalLine.debit' | 'JournalLine.credit';
type ExistingColumnState = Exclude<AccountingDecimalColumnState, 'missing'>;

function sqlText(statement: Prisma.Sql): string {
    return statement.strings.join('?').replace(/\s+/g, ' ').trim();
}

function decimalRow(
    tableName: 'Account' | 'JournalLine',
    columnName: 'balance' | 'debit' | 'credit',
    precision: 14 | 18,
    scale: 2 | 4,
): AccountingDecimalColumnRow {
    return {
        tableName,
        columnName,
        dataType: 'decimal',
        columnType: `decimal(${precision},${scale})`,
        isNullable: 'NO',
        numericPrecision: BigInt(precision),
        numericScale: BigInt(scale),
        columnDefault: scale === 2 ? '0.00' : '0.0000',
        extra: '',
        generationExpression: '',
    };
}

class AccountingDecimalSchemaFake implements DeploySchemaClient {
    tables = new Set<'Account' | 'JournalLine'>(['Account', 'JournalLine']);
    columns: Record<ColumnKey, ExistingColumnState> = {
        'Account.balance': 'legacy',
        'JournalLine.debit': 'legacy',
        'JournalLine.credit': 'legacy',
    };
    unsafeValues: Partial<Record<ColumnKey, Array<{ recordId: string; unsafeValue: string }>>> = {};
    raceWins = new Set<ColumnKey>();
    hardFailures = new Set<ColumnKey>();
    events: string[] = [];

    makeTarget(): this {
        this.columns['Account.balance'] = 'target';
        this.columns['JournalLine.debit'] = 'target';
        this.columns['JournalLine.credit'] = 'target';
        return this;
    }

    private keyFromValues(values: unknown[]): ColumnKey {
        const tableName = values.find(value => value === 'Account' || value === 'JournalLine');
        const columnName = values.find(value => (
            value === 'balance' || value === 'debit' || value === 'credit'
        ));
        return `${String(tableName)}.${String(columnName)}` as ColumnKey;
    }

    private keyFromSql(text: string): ColumnKey {
        if (text.includes('`Account`')) return 'Account.balance';
        if (text.includes('`debit`') || text.includes('CAST(debit')) return 'JournalLine.debit';
        return 'JournalLine.credit';
    }

    private rowsFor(key: ColumnKey): AccountingDecimalColumnRow[] {
        const [tableName, columnName] = key.split('.') as [
            'Account' | 'JournalLine',
            'balance' | 'debit' | 'credit',
        ];
        const state = this.columns[key];
        if (state === 'legacy') return [decimalRow(tableName, columnName, 14, 2)];
        if (state === 'target') return [decimalRow(tableName, columnName, 18, 4)];
        return [{
            ...decimalRow(tableName, columnName, 18, 4),
            columnType: 'decimal(18,4) unsigned',
        }];
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes('information_schema.TABLES')
            && text.includes("TABLE_NAME IN ('Account', 'JournalLine')")) {
            return [...this.tables].map(tableName => ({ tableName })) as T;
        }
        if (text.includes('information_schema.COLUMNS')) {
            const key = this.keyFromValues(values);
            this.events.push(`query:column:${key}`);
            return this.rowsFor(key) as T;
        }
        if (text.includes("CAST('-99999999999999.9999' AS DECIMAL(18, 4))")) {
            const key = this.keyFromSql(text);
            this.events.push(`query:range:${key}`);
            return (this.unsafeValues[key] ?? []) as T;
        }

        throw new Error(`Query contable inesperada: ${text}`);
    }

    async execute(statement: Prisma.Sql): Promise<number> {
        const text = sqlText(statement);
        const key = this.keyFromSql(text);
        if (!text.includes('MODIFY COLUMN')) {
            throw new Error(`DDL contable inesperado: ${text}`);
        }

        this.events.push(`execute:${key}`);
        if (this.hardFailures.has(key)) throw new Error(`fallo DDL ${key}`);
        this.columns[key] = 'target';
        if (this.raceWins.has(key)) throw new Error(`otro iniciador amplió ${key}`);
        return 0;
    }
}

describe('accounting decimal preflight decisions', () => {
    it('demuestra widening por capacidad entera y fraccionaria', () => {
        expect(isSafeDecimalWidening(
            { precision: 14, scale: 2 },
            { precision: 18, scale: 4 },
        )).toBe(true);
        expect(isSafeDecimalWidening(
            { precision: 18, scale: 6 },
            { precision: 18, scale: 4 },
        )).toBe(false);
        expect(isSafeDecimalWidening(
            { precision: 20, scale: 2 },
            { precision: 18, scale: 4 },
        )).toBe(false);
    });

    it('acepta exclusivamente el contrato legacy o final exacto', () => {
        const legacy = decimalRow('Account', 'balance', 14, 2);
        const target = decimalRow('Account', 'balance', 18, 4);

        expect(inspectAccountingDecimalColumn([])).toBe('missing');
        expect(inspectAccountingDecimalColumn([legacy])).toBe('legacy');
        expect(inspectAccountingDecimalColumn([target])).toBe('target');
        expect(decideAccountingDecimalConvergence([legacy])).toBe('alter');
        expect(decideAccountingDecimalConvergence([target])).toBe('noop');
        expect(decideAccountingDecimalConvergence([])).toBe('reject');
        expect(inspectAccountingDecimalColumn([{ ...target, isNullable: 'YES' }])).toBe('invalid');
        expect(inspectAccountingDecimalColumn([{ ...target, columnDefault: null }])).toBe('invalid');
        expect(inspectAccountingDecimalColumn([{
            ...target,
            numericScale: 2n,
        }])).toBe('invalid');
        expect(inspectAccountingDecimalColumn([{
            ...target,
            columnType: 'decimal(18,4) unsigned',
        }])).toBe('invalid');
        expect(inspectAccountingDecimalColumn([{
            ...target,
            columnName: 'credit',
        }])).toBe('invalid');
    });
});

describe('accounting decimal deploy schema preflight', () => {
    it('deja que db push cree el contrato final en una instalación vacía', async () => {
        const db = new AccountingDecimalSchemaFake();
        db.tables.clear();
        const info = vi.fn();

        await applyAccountingDecimalSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('aún no existen'));
    });

    it('amplía las tres columnas solo después de validar contratos y rangos', async () => {
        const db = new AccountingDecimalSchemaFake();

        await applyAccountingDecimalSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(Object.values(db.columns)).toEqual(['target', 'target', 'target']);
        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:Account.balance',
            'execute:JournalLine.debit',
            'execute:JournalLine.credit',
        ]);
        const firstDdl = db.events.findIndex(event => event.startsWith('execute:'));
        expect(db.events.slice(0, firstDdl).filter(event => event.startsWith('query:range:')))
            .toHaveLength(3);
    });

    it('es idempotente cuando las tres columnas ya tienen el contrato final', async () => {
        const db = new AccountingDecimalSchemaFake().makeTarget();

        await applyAccountingDecimalSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });
        await applyAccountingDecimalSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('acepta que otro despliegue gane la carrera si deja el contrato exacto', async () => {
        const db = new AccountingDecimalSchemaFake();
        db.raceWins.add('JournalLine.debit');
        const warn = vi.fn();

        await applyAccountingDecimalSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.columns['JournalLine.debit']).toBe('target');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('concurrentemente'));
    });

    it('rechaza drift antes de alterar cualquier columna', async () => {
        const db = new AccountingDecimalSchemaFake();
        db.columns['JournalLine.credit'] = 'invalid';

        await expect(applyAccountingDecimalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('rechaza valores fuera del rango objetivo antes de cualquier DDL', async () => {
        const db = new AccountingDecimalSchemaFake();
        db.unsafeValues['JournalLine.credit'] = [{
            recordId: 'line-unsafe',
            unsafeValue: '100000000000000.0000',
        }];

        await expect(applyAccountingDecimalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(/fuera del rango DECIMAL\(18,4\).*line-unsafe/);

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('converge la tabla existente y deja que db push cree la tabla ausente', async () => {
        const db = new AccountingDecimalSchemaFake();
        db.tables.delete('JournalLine');

        await applyAccountingDecimalSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns['Account.balance']).toBe('target');
        expect(db.events).not.toContain('execute:JournalLine.debit');
        expect(db.events).not.toContain('execute:JournalLine.credit');
    });

    it('propaga un fallo DDL que no converge al contrato final', async () => {
        const db = new AccountingDecimalSchemaFake();
        db.hardFailures.add('Account.balance');

        await expect(applyAccountingDecimalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo DDL Account.balance');
    });
});
