import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
    applyPurchaseMatchResolutionSchemaPreflight,
    inspectPurchaseMatchResolutionClientEventIdColumn,
    inspectPurchaseMatchResolutionIdempotencyIndex,
    inspectPurchaseMatchResolutionPayloadHashColumn,
    PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX,
    UnsafeSchemaStateError,
    type DeploySchemaClient,
    type PurchaseMatchResolutionColumnRow,
    type PurchaseMatchResolutionIndexRow,
} from '../scripts/deploy-schema-preflight';

type State = 'missing' | 'valid' | 'invalid';
type ColumnName = 'matchResolutionClientEventId' | 'matchResolutionPayloadHash';
type Action = `column:${ColumnName}` | 'index:idempotency';

function sqlText(statement: Prisma.Sql): string {
    return statement.strings.join('?').replace(/\s+/g, ' ').trim();
}

function exactColumn(length: 64 | 128): PurchaseMatchResolutionColumnRow {
    return {
        dataType: 'varchar',
        columnType: `varchar(${length})`,
        isNullable: 'YES',
        characterMaximumLength: BigInt(length),
        characterSetName: 'utf8mb4',
        collationName: 'utf8mb4_unicode_ci',
        columnDefault: null,
        extra: '',
        generationExpression: '',
    };
}

function exactIndexRows(): PurchaseMatchResolutionIndexRow[] {
    return ['tenantId', 'matchResolutionClientEventId'].map((columnName, index) => ({
        indexName: PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX,
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

class PurchaseMatchResolutionSchemaFake implements DeploySchemaClient {
    tableExists = true;
    columns: Record<ColumnName, State> = {
        matchResolutionClientEventId: 'missing',
        matchResolutionPayloadHash: 'missing',
    };
    index: State = 'missing';
    tenantCollation = 'utf8mb4_unicode_ci';
    duplicates: Array<{
        tenantId: string;
        matchResolutionClientEventId: string;
        duplicateCount: bigint;
    }> = [];
    raceWins = new Set<Action>();
    hardFailures = new Set<Action>();
    events: string[] = [];

    private columnRows(columnName: ColumnName): PurchaseMatchResolutionColumnRow[] {
        const state = this.columns[columnName];
        if (state === 'missing') return [];
        const length = columnName === 'matchResolutionClientEventId' ? 128 : 64;
        const row = exactColumn(length);
        return state === 'valid'
            ? [row]
            : [{ ...row, isNullable: 'NO' }];
    }

    private indexRows(): PurchaseMatchResolutionIndexRow[] {
        if (this.index === 'missing') return [];
        const rows = exactIndexRows();
        return this.index === 'valid'
            ? rows
            : rows.map(row => ({ ...row, nonUnique: 1n }));
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes('information_schema.TABLES')
            && text.includes("TABLE_NAME = 'Purchase'")) {
            return (this.tableExists ? [{ tableName: 'Purchase' }] : []) as T;
        }
        if (text.includes('information_schema.COLUMNS')
            && text.includes("TABLE_NAME = 'Purchase'")) {
            if (text.includes("COLUMN_NAME = 'tenantId'")) {
                return [{
                    ...exactColumn(128),
                    columnType: 'varchar(191)',
                    characterMaximumLength: 191n,
                    isNullable: 'NO',
                    collationName: this.tenantCollation,
                }] as T;
            }
            for (const columnName of Object.keys(this.columns) as ColumnName[]) {
                if (values.includes(columnName)) return this.columnRows(columnName) as T;
            }
        }
        if (text.includes('information_schema.STATISTICS')
            && values.includes(PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX)) {
            this.events.push('query:index');
            return this.indexRows() as T;
        }
        if (text.includes('GROUP BY tenantId, matchResolutionClientEventId')) {
            this.events.push('query:duplicates');
            return this.duplicates as T;
        }

        throw new Error(`Query inesperada en fake de matching: ${text}`);
    }

    private actionFor(statement: Prisma.Sql): Action {
        const text = sqlText(statement);
        if (text.includes('ADD COLUMN `matchResolutionClientEventId`')) {
            return 'column:matchResolutionClientEventId';
        }
        if (text.includes('ADD COLUMN `matchResolutionPayloadHash`')) {
            return 'column:matchResolutionPayloadHash';
        }
        if (text.includes(`CREATE UNIQUE INDEX \`${PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX}\``)) {
            return 'index:idempotency';
        }
        throw new Error(`DDL inesperado en fake de matching: ${text}`);
    }

    private apply(action: Action): void {
        if (action === 'index:idempotency') {
            this.index = 'valid';
            return;
        }
        this.columns[action.slice('column:'.length) as ColumnName] = 'valid';
    }

    async execute(statement: Prisma.Sql): Promise<number> {
        const action = this.actionFor(statement);
        this.events.push(`execute:${action}`);
        if (this.hardFailures.has(action)) throw new Error(`fallo ${action}`);
        this.apply(action);
        if (this.raceWins.has(action)) throw new Error(`otro iniciador ganó ${action}`);
        return 0;
    }
}

describe('Purchase match resolution deploy schema preflight', () => {
    it('acepta únicamente columnas nullable e índice tenant+evento exactos', () => {
        const event = exactColumn(128);
        const hash = exactColumn(64);
        const index = exactIndexRows();

        expect(inspectPurchaseMatchResolutionClientEventIdColumn([])).toBe('missing');
        expect(inspectPurchaseMatchResolutionClientEventIdColumn([event])).toBe('valid');
        expect(inspectPurchaseMatchResolutionClientEventIdColumn([{ ...event, isNullable: 'NO' }])).toBe('invalid');
        expect(inspectPurchaseMatchResolutionPayloadHashColumn([hash])).toBe('valid');
        expect(inspectPurchaseMatchResolutionPayloadHashColumn([{ ...hash, columnType: 'varchar(128)' }])).toBe('invalid');
        expect(inspectPurchaseMatchResolutionIdempotencyIndex([...index].reverse())).toBe('valid');
        expect(inspectPurchaseMatchResolutionIdempotencyIndex(index.map(row => ({ ...row, nonUnique: 1n })))).toBe('invalid');
        expect(inspectPurchaseMatchResolutionIdempotencyIndex([
            { ...index[0], columnName: 'matchResolutionClientEventId' },
            { ...index[1], columnName: 'tenantId' },
        ])).toBe('invalid');
    });

    it('deja que db push cree el contrato cuando Purchase aún no existe', async () => {
        const db = new PurchaseMatchResolutionSchemaFake();
        db.tableExists = false;
        const info = vi.fn();

        await applyPurchaseMatchResolutionSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('Purchase aún no existe'));
    });

    it('crea columnas e índice en orden seguro y revalida duplicados', async () => {
        const db = new PurchaseMatchResolutionSchemaFake();

        await applyPurchaseMatchResolutionSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns).toEqual({
            matchResolutionClientEventId: 'valid',
            matchResolutionPayloadHash: 'valid',
        });
        expect(db.index).toBe('valid');
        expect(db.events.indexOf('query:duplicates')).toBeLessThan(
            db.events.indexOf('execute:index:idempotency'),
        );
        expect(db.events.lastIndexOf('query:duplicates')).toBeGreaterThan(
            db.events.indexOf('execute:index:idempotency'),
        );
    });

    it('es idempotente cuando el estado completo ya es exacto', async () => {
        const db = new PurchaseMatchResolutionSchemaFake();
        db.columns.matchResolutionClientEventId = 'valid';
        db.columns.matchResolutionPayloadHash = 'valid';
        db.index = 'valid';

        await applyPurchaseMatchResolutionSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });
        await applyPurchaseMatchResolutionSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('falla cerrado ante columna o índice homónimo incompatibles', async () => {
        const badColumn = new PurchaseMatchResolutionSchemaFake();
        badColumn.columns.matchResolutionClientEventId = 'invalid';
        await expect(applyPurchaseMatchResolutionSchemaPreflight(
            badColumn,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('Purchase.matchResolutionClientEventId');

        const badIndex = new PurchaseMatchResolutionSchemaFake();
        badIndex.columns.matchResolutionClientEventId = 'valid';
        badIndex.columns.matchResolutionPayloadHash = 'valid';
        badIndex.index = 'invalid';
        await expect(applyPurchaseMatchResolutionSchemaPreflight(
            badIndex,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX);
    });

    it('rechaza duplicados sin crear el índice ni alterar filas', async () => {
        const db = new PurchaseMatchResolutionSchemaFake();
        db.columns.matchResolutionClientEventId = 'valid';
        db.columns.matchResolutionPayloadHash = 'valid';
        db.duplicates = [{
            tenantId: 'tenant-1',
            matchResolutionClientEventId: 'evento-1',
            duplicateCount: 2n,
        }];

        await expect(applyPurchaseMatchResolutionSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
        expect(db.index).toBe('missing');
        expect(db.events).not.toContain('execute:index:idempotency');
    });

    it('tolera carreras solo si la relectura confirma cada objeto exacto', async () => {
        const db = new PurchaseMatchResolutionSchemaFake();
        db.raceWins.add('column:matchResolutionClientEventId');
        db.raceWins.add('column:matchResolutionPayloadHash');
        db.raceWins.add('index:idempotency');
        const warn = vi.fn();

        await applyPurchaseMatchResolutionSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.index).toBe('valid');
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('propaga un fallo DDL real cuando la relectura sigue ausente', async () => {
        const db = new PurchaseMatchResolutionSchemaFake();
        db.hardFailures.add('column:matchResolutionClientEventId');

        await expect(applyPurchaseMatchResolutionSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo column:matchResolutionClientEventId');
        expect(db.columns.matchResolutionClientEventId).toBe('missing');
    });
});
