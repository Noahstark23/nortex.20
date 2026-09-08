import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
    applyCashCloseJournalSchemaPreflight,
    inspectCashCloseJournalColumn,
    inspectCashCloseJournalForeignKey,
    inspectCashCloseJournalIndex,
    JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX,
    JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY,
    JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX,
    SHIFT_CLOSE_EVENT_UNIQUE_INDEX,
    UnsafeSchemaStateError,
    type CashCloseJournalColumnRow,
    type CashCloseJournalForeignKeyRow,
    type CashCloseJournalIndexRow,
    type DeploySchemaClient,
    type ProcurementPhaseTwoBColumnContract,
} from '../scripts/deploy-schema-preflight';

type TableName = 'Shift' | 'JournalEntry';
type ColumnKey =
    | 'Shift.closeEventId'
    | 'Shift.closePayloadHash'
    | 'JournalEntry.economicDate'
    | 'JournalEntry.postedAt'
    | 'JournalEntry.entryKind'
    | 'JournalEntry.postingKey'
    | 'JournalEntry.payloadHash'
    | 'JournalEntry.reversalOfId';
type IndexName =
    | typeof SHIFT_CLOSE_EVENT_UNIQUE_INDEX
    | typeof JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX
    | typeof JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX;
type State = 'missing' | 'valid' | 'invalid';
type Action = `column:${ColumnKey}` | `index:${IndexName}` | 'foreignKey:reversalOfId';

const COLUMN_CONTRACTS: Record<ColumnKey, ProcurementPhaseTwoBColumnContract> = {
    'Shift.closeEventId': {
        columnName: 'closeEventId',
        columnType: 'varchar(128)',
        nullable: true,
        defaultValue: null,
    },
    'Shift.closePayloadHash': {
        columnName: 'closePayloadHash',
        columnType: 'varchar(64)',
        nullable: true,
        defaultValue: null,
    },
    'JournalEntry.economicDate': {
        columnName: 'economicDate',
        columnType: 'datetime(3)',
        nullable: true,
        defaultValue: null,
    },
    'JournalEntry.postedAt': {
        columnName: 'postedAt',
        columnType: 'datetime(3)',
        nullable: true,
        defaultValue: null,
    },
    'JournalEntry.entryKind': {
        columnName: 'entryKind',
        columnType: 'varchar(32)',
        nullable: false,
        defaultValue: 'ORIGINAL',
    },
    'JournalEntry.postingKey': {
        columnName: 'postingKey',
        columnType: 'varchar(191)',
        nullable: true,
        defaultValue: null,
    },
    'JournalEntry.payloadHash': {
        columnName: 'payloadHash',
        columnType: 'varchar(64)',
        nullable: true,
        defaultValue: null,
    },
    'JournalEntry.reversalOfId': {
        columnName: 'reversalOfId',
        columnType: 'varchar(191)',
        nullable: true,
        defaultValue: null,
    },
};

const INDEX_COLUMNS: Record<IndexName, string[]> = {
    [SHIFT_CLOSE_EVENT_UNIQUE_INDEX]: ['tenantId', 'closeEventId'],
    [JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX]: ['tenantId', 'postingKey'],
    [JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX]: ['reversalOfId'],
};

function sqlText(statement: Prisma.Sql): string {
    return statement.strings.join('?').replace(/\s+/g, ' ').trim();
}

function columnRow(
    contract: ProcurementPhaseTwoBColumnContract,
): CashCloseJournalColumnRow {
    const isVarchar = contract.columnType.startsWith('varchar');
    const length = isVarchar
        ? Number(contract.columnType.match(/\d+/)?.[0])
        : null;
    return {
        columnName: contract.columnName,
        dataType: isVarchar ? 'varchar' : 'datetime',
        columnType: contract.columnType,
        isNullable: contract.nullable ? 'YES' : 'NO',
        characterMaximumLength: length,
        characterSetName: isVarchar ? 'utf8mb4' : null,
        collationName: isVarchar ? 'utf8mb4_unicode_ci' : null,
        columnDefault: contract.defaultValue,
        extra: '',
        generationExpression: '',
    };
}

function indexRows(name: IndexName): CashCloseJournalIndexRow[] {
    return INDEX_COLUMNS[name].map((columnName, index) => ({
        indexName: name,
        nonUnique: 0n,
        seqInIndex: BigInt(index + 1),
        columnName,
        subPart: null,
        indexType: 'BTREE',
        isVisible: 'YES',
        collation: 'A',
        expression: null,
    }));
}

const exactReversalForeignKey: CashCloseJournalForeignKeyRow = {
    constraintName: JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY,
    columnName: 'reversalOfId',
    referencedTableName: 'JournalEntry',
    referencedColumnName: 'id',
    ordinalPosition: 1n,
    deleteRule: 'RESTRICT',
    updateRule: 'CASCADE',
};

class CashCloseJournalSchemaFake implements DeploySchemaClient {
    tables = new Set<TableName>(['Shift', 'JournalEntry']);
    columns = Object.fromEntries(
        Object.keys(COLUMN_CONTRACTS).map(key => [key, 'missing']),
    ) as Record<ColumnKey, State>;
    indexes: Record<IndexName, State> = {
        [SHIFT_CLOSE_EVENT_UNIQUE_INDEX]: 'missing',
        [JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX]: 'missing',
        [JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX]: 'missing',
    };
    foreignKey: State = 'missing';
    duplicates: Partial<Record<IndexName, unknown[]>> = {};
    invalidReversals: unknown[] = [];
    reversalCollation = 'utf8mb4_unicode_ci';
    raceWins = new Set<Action>();
    hardFailures = new Set<Action>();
    events: string[] = [];

    makeValid(): this {
        for (const key of Object.keys(this.columns) as ColumnKey[]) {
            this.columns[key] = 'valid';
        }
        for (const name of Object.keys(this.indexes) as IndexName[]) {
            this.indexes[name] = 'valid';
        }
        this.foreignKey = 'valid';
        return this;
    }

    private rowsForTable(tableName: TableName): CashCloseJournalColumnRow[] {
        const baseline = tableName === 'Shift'
            ? [columnRow({
                columnName: 'tenantId',
                columnType: 'varchar(191)',
                nullable: false,
                defaultValue: null,
            })]
            : [
                columnRow({
                    columnName: 'id',
                    columnType: 'varchar(191)',
                    nullable: false,
                    defaultValue: null,
                }),
                columnRow({
                    columnName: 'tenantId',
                    columnType: 'varchar(191)',
                    nullable: false,
                    defaultValue: null,
                }),
            ];
        const optional = (Object.entries(COLUMN_CONTRACTS) as Array<[
            ColumnKey,
            ProcurementPhaseTwoBColumnContract,
        ]>)
            .filter(([key]) => key.startsWith(`${tableName}.`))
            .flatMap(([key, contract]) => {
                const state = this.columns[key];
                if (state === 'missing') return [];
                const valid = columnRow(contract);
                if (key === 'JournalEntry.reversalOfId') {
                    valid.collationName = this.reversalCollation;
                }
                return [state === 'valid'
                    ? valid
                    : { ...valid, isNullable: valid.isNullable === 'YES' ? 'NO' : 'YES' }];
            });
        return [...baseline, ...optional];
    }

    private indexRowsForTable(tableName: TableName): CashCloseJournalIndexRow[] {
        return (Object.entries(this.indexes) as Array<[IndexName, State]>)
            .filter(([name]) => (
                tableName === 'Shift'
                    ? name === SHIFT_CLOSE_EVENT_UNIQUE_INDEX
                    : name !== SHIFT_CLOSE_EVENT_UNIQUE_INDEX
            ))
            .flatMap(([name, state]) => {
                if (state === 'missing') return [];
                const exact = indexRows(name);
                return state === 'valid'
                    ? exact
                    : exact.map(row => ({ ...row, nonUnique: 1n }));
            });
    }

    private duplicateIndex(text: string): IndexName | null {
        if (text.includes('GROUP BY tenantId, closeEventId')) return SHIFT_CLOSE_EVENT_UNIQUE_INDEX;
        if (text.includes('GROUP BY tenantId, postingKey')) return JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX;
        if (text.includes('GROUP BY reversalOfId')) return JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX;
        return null;
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes('information_schema.TABLES')
            && text.includes("TABLE_NAME IN ('Shift', 'JournalEntry')")) {
            return [...this.tables].map(tableName => ({ tableName })) as T;
        }
        if (text.includes('information_schema.COLUMNS')) {
            const tableName = values.find(value => value === 'Shift' || value === 'JournalEntry') as TableName;
            return this.rowsForTable(tableName) as T;
        }
        if (text.includes('information_schema.STATISTICS')) {
            const tableName = values.find(value => value === 'Shift' || value === 'JournalEntry') as TableName;
            return this.indexRowsForTable(tableName) as T;
        }
        if (text.includes('information_schema.REFERENTIAL_CONSTRAINTS')) {
            if (this.foreignKey === 'missing') return [] as T;
            return [this.foreignKey === 'valid'
                ? exactReversalForeignKey
                : { ...exactReversalForeignKey, deleteRule: 'CASCADE' }] as T;
        }
        const duplicateIndexName = this.duplicateIndex(text);
        if (duplicateIndexName) {
            this.events.push(`query:duplicates:${duplicateIndexName}`);
            return (this.duplicates[duplicateIndexName] ?? []) as T;
        }
        if (text.includes('LEFT JOIN `JournalEntry` original')) {
            this.events.push('query:reversals');
            return this.invalidReversals as T;
        }

        throw new Error(`Query cierre/asiento inesperada: ${text}`);
    }

    private actionFor(text: string): Action {
        if (text.includes('ADD CONSTRAINT `JournalEntry_reversalOfId_fkey`')) {
            return 'foreignKey:reversalOfId';
        }
        for (const name of Object.keys(this.indexes) as IndexName[]) {
            if (text.includes(`INDEX \`${name}\``)) return `index:${name}`;
        }
        for (const key of Object.keys(this.columns) as ColumnKey[]) {
            const [, columnName] = key.split('.');
            const [tableName] = key.split('.');
            if (text.includes(`TABLE \`${tableName}\``)
                && text.includes(`COLUMN \`${columnName}\``)) {
                return `column:${key}` as Action;
            }
        }
        throw new Error(`DDL cierre/asiento inesperado: ${text}`);
    }

    private apply(action: Action): void {
        if (action === 'foreignKey:reversalOfId') {
            this.foreignKey = 'valid';
            return;
        }
        if (action.startsWith('column:')) {
            this.columns[action.slice('column:'.length) as ColumnKey] = 'valid';
            return;
        }
        this.indexes[action.slice('index:'.length) as IndexName] = 'valid';
    }

    async execute(statement: Prisma.Sql): Promise<number> {
        const action = this.actionFor(sqlText(statement));
        this.events.push(`execute:${action}`);
        if (this.hardFailures.has(action)) throw new Error(`fallo ${action}`);
        this.apply(action);
        if (this.raceWins.has(action)) throw new Error(`otro iniciador ganó ${action}`);
        return 0;
    }
}

describe('cash close and journal schema inspection', () => {
    it('valida columnas, índices y FK con forma exacta', () => {
        const contract = COLUMN_CONTRACTS['Shift.closeEventId'];
        const exactColumn = columnRow(contract);
        const exactIndex = indexRows(SHIFT_CLOSE_EVENT_UNIQUE_INDEX);

        expect(inspectCashCloseJournalColumn([], contract)).toBe('missing');
        expect(inspectCashCloseJournalColumn([exactColumn], contract)).toBe('valid');
        expect(inspectCashCloseJournalColumn(
            [{ ...exactColumn, columnType: 'varchar(191)' }],
            contract,
        )).toBe('invalid');
        expect(inspectCashCloseJournalIndex(
            exactIndex,
            SHIFT_CLOSE_EVENT_UNIQUE_INDEX,
            ['tenantId', 'closeEventId'],
        )).toBe('valid');
        expect(inspectCashCloseJournalIndex(
            exactIndex.map(row => ({ ...row, nonUnique: 1n })),
            SHIFT_CLOSE_EVENT_UNIQUE_INDEX,
            ['tenantId', 'closeEventId'],
        )).toBe('invalid');
        expect(inspectCashCloseJournalForeignKey([exactReversalForeignKey])).toBe('valid');
        expect(inspectCashCloseJournalForeignKey([{
            ...exactReversalForeignKey,
            updateRule: 'RESTRICT',
        }])).toBe('invalid');
    });
});

describe('cash close and journal deploy schema preflight', () => {
    it('converge desde un estado legacy y luego resulta idempotente', async () => {
        const db = new CashCloseJournalSchemaFake();

        await applyCashCloseJournalSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(Object.values(db.columns).every(state => state === 'valid')).toBe(true);
        expect(Object.values(db.indexes).every(state => state === 'valid')).toBe(true);
        expect(db.foreignKey).toBe('valid');
        expect(db.events.filter(event => event.startsWith('execute:'))).toHaveLength(12);

        db.events = [];
        await applyCashCloseJournalSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('converge solo Shift si JournalEntry todavía no existe', async () => {
        const db = new CashCloseJournalSchemaFake();
        db.tables.delete('JournalEntry');

        await applyCashCloseJournalSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns['Shift.closeEventId']).toBe('valid');
        expect(db.columns['Shift.closePayloadHash']).toBe('valid');
        expect(db.indexes[SHIFT_CLOSE_EVENT_UNIQUE_INDEX]).toBe('valid');
        expect(db.events.some(event => event.includes('JournalEntry'))).toBe(false);
    });

    it('rechaza duplicados non-null antes del primer ALTER', async () => {
        const db = new CashCloseJournalSchemaFake();
        db.columns['JournalEntry.postingKey'] = 'valid';
        db.duplicates[JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX] = [{
            keyPartOne: 'tenant-1',
            keyPartTwo: 'SALE:sale-1',
            duplicateCount: 2n,
        }];

        await expect(applyCashCloseJournalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(/claves non-null duplicadas/);

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('rechaza un contrato o índice homónimo incompatible sin reparar datos', async () => {
        const db = new CashCloseJournalSchemaFake();
        db.columns['Shift.closeEventId'] = 'invalid';

        await expect(applyCashCloseJournalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);

        const indexDrift = new CashCloseJournalSchemaFake();
        indexDrift.indexes[SHIFT_CLOSE_EVENT_UNIQUE_INDEX] = 'invalid';
        await expect(applyCashCloseJournalSchemaPreflight(
            indexDrift,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(/definición incompatible/);
        expect(indexDrift.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('rechaza reversos huérfanos o cross-tenant antes del DDL', async () => {
        const db = new CashCloseJournalSchemaFake();
        db.columns['JournalEntry.reversalOfId'] = 'valid';
        db.invalidReversals = [{
            reversalId: 'reversal-1',
            reversalTenantId: 'tenant-a',
            reversalOfId: 'original-b',
            originalTenantId: 'tenant-b',
            reason: 'CROSS_TENANT',
        }];

        await expect(applyCashCloseJournalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(/cross-tenant/);

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('rechaza reversalOfId con collation incompatible antes del DDL', async () => {
        const db = new CashCloseJournalSchemaFake();
        db.columns['JournalEntry.reversalOfId'] = 'valid';
        db.reversalCollation = 'utf8mb4_bin';

        await expect(applyCashCloseJournalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(/mismo charset y collation/);

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('tolera carreras de columna, índice y FK solo si convergen exacto', async () => {
        const db = new CashCloseJournalSchemaFake();
        db.raceWins.add('column:Shift.closeEventId');
        db.raceWins.add(`index:${JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX}`);
        db.raceWins.add('foreignKey:reversalOfId');
        const warn = vi.fn();

        await applyCashCloseJournalSchemaPreflight(db, { info: vi.fn(), warn });

        expect(warn).toHaveBeenCalledTimes(3);
        expect(db.foreignKey).toBe('valid');
    });

    it('propaga un fallo DDL que no deja el contrato exacto', async () => {
        const db = new CashCloseJournalSchemaFake();
        db.hardFailures.add('column:Shift.closePayloadHash');

        await expect(applyCashCloseJournalSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo column:Shift.closePayloadHash');
    });
});
