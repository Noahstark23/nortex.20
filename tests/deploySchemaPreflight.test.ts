import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
    applyDeploySchemaPreflight,
    applyPaymentSchemaPreflight,
    applyProductReturnSchemaPreflight,
    applyRetencionSufridaSchemaPreflight,
    applyStockCountSchemaPreflight,
    inspectPaymentClientEventIdColumn,
    inspectPaymentIdempotencyIndex,
    inspectPaymentPayloadHashColumn,
    inspectProductReturnClientEventIdColumn,
    inspectProductReturnIdempotencyIndex,
    inspectProductReturnPayloadHashColumn,
    inspectRetencionSufridaClientEventIdColumn,
    inspectRetencionSufridaIdempotencyIndex,
    inspectRetencionSufridaPayloadHashColumn,
    inspectStockCountNullableIdColumn,
    inspectStockCountOpenWarehouseIndex,
    inspectStockCountTenantWarehouseStatusIndex,
    inspectStockCountWarehouseForeignKey,
    inspectStockCountWarehouseIndex,
    inspectWarehouseSellerColumn,
    inspectWarehouseSellerIndex,
    PAYMENT_IDEMPOTENCY_INDEX,
    PRODUCT_RETURN_IDEMPOTENCY_INDEX,
    RETENCION_SUFRIDA_IDEMPOTENCY_INDEX,
    STOCK_COUNT_OPEN_WAREHOUSE_INDEX,
    STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
    STOCK_COUNT_WAREHOUSE_FOREIGN_KEY,
    STOCK_COUNT_WAREHOUSE_INDEX,
    UnsafeSchemaStateError,
    WAREHOUSE_SELLER_INDEX,
    type DeploySchemaClient,
    type PaymentColumnRow,
    type PaymentIndexRow,
    type ProductReturnColumnRow,
    type ProductReturnIndexRow,
    type RetencionSufridaColumnRow,
    type RetencionSufridaIndexRow,
    type StockCountColumnRow,
    type StockCountForeignKeyRow,
    type StockCountIndexRow,
    type WarehouseSellerIndexRow,
} from '../scripts/deploy-schema-preflight';

const validColumn: StockCountColumnRow = {
    dataType: 'varchar',
    columnType: 'varchar(191)',
    isNullable: 'YES',
    characterMaximumLength: 191n,
    characterSetName: 'utf8mb4',
    collationName: 'utf8mb4_unicode_ci',
    columnDefault: null,
    extra: '',
    generationExpression: '',
};

const invalidColumn: StockCountColumnRow = {
    ...validColumn,
    columnType: 'varchar(255)',
    characterMaximumLength: 255n,
};

function exactIndexRows(name: string, columns: string[], unique: boolean): StockCountIndexRow[] {
    return columns.map((columnName, index) => ({
        indexName: name,
        nonUnique: unique ? 0n : 1n,
        seqInIndex: BigInt(index + 1),
        columnName,
        subPart: null,
        indexType: 'BTREE',
        isVisible: 'YES',
        collation: 'A',
        expression: null,
    }));
}

const validSellerIndexRows: WarehouseSellerIndexRow[] = exactIndexRows(
    WAREHOUSE_SELLER_INDEX,
    ['tenantId', 'sellerId'],
    true,
);

const validForeignKey: StockCountForeignKeyRow = {
    constraintName: STOCK_COUNT_WAREHOUSE_FOREIGN_KEY,
    columnName: 'warehouseId',
    referencedTableName: 'Warehouse',
    referencedColumnName: 'id',
    ordinalPosition: 1n,
    deleteRule: 'RESTRICT',
    updateRule: 'CASCADE',
};

type State = 'missing' | 'valid' | 'invalid';
type Action =
    | 'column:warehouseId'
    | 'column:openWarehouseKey'
    | 'index:openWarehouseKey'
    | 'index:warehouseId'
    | 'index:tenantWarehouseStatus'
    | 'foreignKey:warehouseId';

type ProductReturnAction =
    | 'column:clientEventId'
    | 'column:payloadHash'
    | 'index:idempotency';

type PaymentAction =
    | 'column:clientEventId'
    | 'column:payloadHash'
    | 'index:idempotency';

type RetencionSufridaAction =
    | 'column:clientEventId'
    | 'column:payloadHash'
    | 'index:idempotency';

function sqlText(statement: Prisma.Sql): string {
    return statement.strings.join('?').replace(/\s+/g, ' ').trim();
}

class StockCountSchemaFake implements DeploySchemaClient {
    stockCountExists = true;
    columns: Record<'warehouseId' | 'openWarehouseKey', State> = {
        warehouseId: 'missing',
        openWarehouseKey: 'missing',
    };
    indexes: Record<'openWarehouseKey' | 'warehouseId' | 'tenantWarehouseStatus', State> = {
        openWarehouseKey: 'missing',
        warehouseId: 'missing',
        tenantWarehouseStatus: 'missing',
    };
    foreignKey: State = 'missing';
    duplicateOpenWarehouses: unknown[] = [];
    invalidWarehouses: unknown[] = [];
    invalidOpenKeys: unknown[] = [];
    raceWins = new Set<Action>();
    hardFailures = new Set<Action>();
    events: string[] = [];

    makeEverythingValid(): this {
        this.columns.warehouseId = 'valid';
        this.columns.openWarehouseKey = 'valid';
        this.indexes.openWarehouseKey = 'valid';
        this.indexes.warehouseId = 'valid';
        this.indexes.tenantWarehouseStatus = 'valid';
        this.foreignKey = 'valid';
        return this;
    }

    private columnRows(state: State): StockCountColumnRow[] {
        if (state === 'missing') return [];
        return [{ ...(state === 'valid' ? validColumn : invalidColumn) }];
    }

    private indexRows(
        state: State,
        name: string,
        columns: string[],
        unique: boolean,
    ): StockCountIndexRow[] {
        if (state === 'missing') return [];
        const rows = exactIndexRows(name, columns, unique);
        return state === 'valid' ? rows : rows.map(row => ({ ...row, isVisible: 'NO' }));
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes("TABLE_NAME = 'StockCount'") && text.includes('information_schema.TABLES')) {
            return (this.stockCountExists ? [{ tableName: 'StockCount' }] : []) as T;
        }
        if (text.includes('FROM information_schema.COLUMNS')
            && text.includes("TABLE_NAME = 'StockCount'")
            && text.includes("COLUMN_NAME = 'warehouseId'")) {
            return this.columnRows(this.columns.warehouseId) as T;
        }
        if (text.includes('FROM information_schema.COLUMNS')
            && text.includes("TABLE_NAME = 'StockCount'")
            && text.includes("COLUMN_NAME = 'openWarehouseKey'")) {
            return this.columnRows(this.columns.openWarehouseKey) as T;
        }
        if (text.includes('FROM information_schema.COLUMNS')
            && text.includes("TABLE_NAME = 'Warehouse'")
            && text.includes("COLUMN_NAME = 'id'")) {
            return [{ ...validColumn, isNullable: 'NO' }] as T;
        }
        if (text.includes('information_schema.STATISTICS')) {
            const indexName = values.find(value => typeof value === 'string');
            if (indexName === STOCK_COUNT_OPEN_WAREHOUSE_INDEX) {
                return this.indexRows(
                    this.indexes.openWarehouseKey,
                    STOCK_COUNT_OPEN_WAREHOUSE_INDEX,
                    ['openWarehouseKey'],
                    true,
                ) as T;
            }
            if (indexName === STOCK_COUNT_WAREHOUSE_INDEX) {
                return this.indexRows(
                    this.indexes.warehouseId,
                    STOCK_COUNT_WAREHOUSE_INDEX,
                    ['warehouseId'],
                    false,
                ) as T;
            }
            if (indexName === STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX) {
                return this.indexRows(
                    this.indexes.tenantWarehouseStatus,
                    STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
                    ['tenantId', 'warehouseId', 'status'],
                    false,
                ) as T;
            }
        }
        if (text.includes('information_schema.REFERENTIAL_CONSTRAINTS')) {
            if (this.foreignKey === 'missing') return [] as T;
            return [{
                ...validForeignKey,
                ...(this.foreignKey === 'invalid' ? { deleteRule: 'CASCADE' } : {}),
            }] as T;
        }
        if (text.includes('GROUP BY openWarehouseKey')) {
            this.events.push('query:safety:duplicates');
            return this.duplicateOpenWarehouses as T;
        }
        if (text.includes('LEFT JOIN `Warehouse` w ON w.id = sc.warehouseId')) {
            this.events.push('query:safety:warehouses');
            return this.invalidWarehouses as T;
        }
        if (text.includes('id AS stockCountId') && text.includes('openWarehouseKey')) {
            this.events.push('query:safety:openKeys');
            return this.invalidOpenKeys as T;
        }

        throw new Error(`Query inesperada en fake: ${text}`);
    }

    private actionFor(statement: Prisma.Sql): Action {
        const text = sqlText(statement);
        if (text.includes('ADD COLUMN `warehouseId`')) return 'column:warehouseId';
        if (text.includes('ADD COLUMN `openWarehouseKey`')) return 'column:openWarehouseKey';
        if (text.includes(`CREATE UNIQUE INDEX \`${STOCK_COUNT_OPEN_WAREHOUSE_INDEX}\``)) {
            return 'index:openWarehouseKey';
        }
        if (text.includes(`CREATE INDEX \`${STOCK_COUNT_WAREHOUSE_INDEX}\``)) return 'index:warehouseId';
        if (text.includes(`CREATE INDEX \`${STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX}\``)) {
            return 'index:tenantWarehouseStatus';
        }
        if (text.includes(`ADD CONSTRAINT \`${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY}\``)) {
            return 'foreignKey:warehouseId';
        }
        throw new Error(`DDL inesperado en fake: ${text}`);
    }

    private apply(action: Action): void {
        if (action === 'column:warehouseId') this.columns.warehouseId = 'valid';
        if (action === 'column:openWarehouseKey') this.columns.openWarehouseKey = 'valid';
        if (action === 'index:openWarehouseKey') this.indexes.openWarehouseKey = 'valid';
        if (action === 'index:warehouseId') this.indexes.warehouseId = 'valid';
        if (action === 'index:tenantWarehouseStatus') this.indexes.tenantWarehouseStatus = 'valid';
        if (action === 'foreignKey:warehouseId') this.foreignKey = 'valid';
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

const validProductReturnClientEventIdColumn: ProductReturnColumnRow = {
    ...validColumn,
    columnType: 'varchar(128)',
    characterMaximumLength: 128n,
};

const validProductReturnPayloadHashColumn: ProductReturnColumnRow = {
    ...validColumn,
    columnType: 'varchar(64)',
    characterMaximumLength: 64n,
};

class ProductReturnSchemaFake implements DeploySchemaClient {
    productReturnExists = true;
    columns: Record<'clientEventId' | 'payloadHash', State> = {
        clientEventId: 'missing',
        payloadHash: 'missing',
    };
    index: State = 'missing';
    duplicates: unknown[] = [];
    raceWins = new Set<ProductReturnAction>();
    hardFailures = new Set<ProductReturnAction>();
    events: string[] = [];

    makeEverythingValid(): this {
        this.columns.clientEventId = 'valid';
        this.columns.payloadHash = 'valid';
        this.index = 'valid';
        return this;
    }

    private columnRows(
        columnName: 'clientEventId' | 'payloadHash',
    ): ProductReturnColumnRow[] {
        const state = this.columns[columnName];
        if (state === 'missing') return [];
        const valid = columnName === 'clientEventId'
            ? validProductReturnClientEventIdColumn
            : validProductReturnPayloadHashColumn;
        return [{ ...(state === 'valid' ? valid : { ...valid, isNullable: 'NO' }) }];
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes("TABLE_NAME = 'ProductReturn'")
            && text.includes('information_schema.TABLES')) {
            return (this.productReturnExists ? [{ tableName: 'ProductReturn' }] : []) as T;
        }
        if (text.includes("TABLE_NAME = 'ProductReturn'")
            && text.includes("COLUMN_NAME = 'tenantId'")) {
            return [{ ...validColumn, isNullable: 'NO' }] as T;
        }
        if (text.includes('FROM information_schema.COLUMNS')
            && text.includes("TABLE_NAME = 'ProductReturn'")) {
            const columnName = values.find(value => (
                value === 'clientEventId' || value === 'payloadHash'
            ));
            if (columnName === 'clientEventId' || columnName === 'payloadHash') {
                return this.columnRows(columnName) as T;
            }
        }
        if (text.includes('information_schema.STATISTICS')
            && values.includes(PRODUCT_RETURN_IDEMPOTENCY_INDEX)) {
            if (this.index === 'missing') return [] as T;
            const rows: ProductReturnIndexRow[] = exactIndexRows(
                PRODUCT_RETURN_IDEMPOTENCY_INDEX,
                ['tenantId', 'clientEventId'],
                true,
            );
            return (this.index === 'valid'
                ? rows
                : rows.map(row => ({ ...row, nonUnique: 1n }))) as T;
        }
        if (text.includes('GROUP BY tenantId, clientEventId')) {
            this.events.push('query:safety:duplicates');
            return this.duplicates as T;
        }

        throw new Error(`Query inesperada en fake de ProductReturn: ${text}`);
    }

    private actionFor(statement: Prisma.Sql): ProductReturnAction {
        const text = sqlText(statement);
        if (text.includes('ADD COLUMN `clientEventId`')) return 'column:clientEventId';
        if (text.includes('ADD COLUMN `payloadHash`')) return 'column:payloadHash';
        if (text.includes(`CREATE UNIQUE INDEX \`${PRODUCT_RETURN_IDEMPOTENCY_INDEX}\``)) {
            return 'index:idempotency';
        }
        throw new Error(`DDL inesperado en fake de ProductReturn: ${text}`);
    }

    private apply(action: ProductReturnAction): void {
        if (action === 'column:clientEventId') this.columns.clientEventId = 'valid';
        if (action === 'column:payloadHash') this.columns.payloadHash = 'valid';
        if (action === 'index:idempotency') this.index = 'valid';
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

const validPaymentClientEventIdColumn: PaymentColumnRow = {
    ...validColumn,
    columnType: 'varchar(128)',
    characterMaximumLength: 128n,
};

const validPaymentPayloadHashColumn: PaymentColumnRow = {
    ...validColumn,
    columnType: 'varchar(64)',
    characterMaximumLength: 64n,
};

class PaymentSchemaFake implements DeploySchemaClient {
    paymentExists = true;
    columns: Record<'clientEventId' | 'payloadHash', State> = {
        clientEventId: 'missing',
        payloadHash: 'missing',
    };
    index: State = 'missing';
    duplicates: unknown[] = [];
    raceWins = new Set<PaymentAction>();
    hardFailures = new Set<PaymentAction>();
    events: string[] = [];

    makeEverythingValid(): this {
        this.columns.clientEventId = 'valid';
        this.columns.payloadHash = 'valid';
        this.index = 'valid';
        return this;
    }

    private columnRows(
        columnName: 'clientEventId' | 'payloadHash',
    ): PaymentColumnRow[] {
        const state = this.columns[columnName];
        if (state === 'missing') return [];
        const valid = columnName === 'clientEventId'
            ? validPaymentClientEventIdColumn
            : validPaymentPayloadHashColumn;
        return [{ ...(state === 'valid' ? valid : { ...valid, isNullable: 'NO' }) }];
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes("TABLE_NAME = 'Payment'")
            && text.includes('information_schema.TABLES')) {
            return (this.paymentExists ? [{ tableName: 'Payment' }] : []) as T;
        }
        if (text.includes("TABLE_NAME = 'Payment'")
            && text.includes("COLUMN_NAME = 'saleId'")) {
            return [{ ...validColumn, isNullable: 'NO' }] as T;
        }
        if (text.includes('FROM information_schema.COLUMNS')
            && text.includes("TABLE_NAME = 'Payment'")) {
            const columnName = values.find(value => (
                value === 'clientEventId' || value === 'payloadHash'
            ));
            if (columnName === 'clientEventId' || columnName === 'payloadHash') {
                return this.columnRows(columnName) as T;
            }
        }
        if (text.includes('information_schema.STATISTICS')
            && values.includes(PAYMENT_IDEMPOTENCY_INDEX)) {
            if (this.index === 'missing') return [] as T;
            const rows: PaymentIndexRow[] = exactIndexRows(
                PAYMENT_IDEMPOTENCY_INDEX,
                ['saleId', 'clientEventId'],
                true,
            );
            return (this.index === 'valid'
                ? rows
                : rows.map(row => ({ ...row, nonUnique: 1n }))) as T;
        }
        if (text.includes('GROUP BY saleId, clientEventId')) {
            this.events.push('query:safety:duplicates');
            return this.duplicates as T;
        }

        throw new Error(`Query inesperada en fake de Payment: ${text}`);
    }

    private actionFor(statement: Prisma.Sql): PaymentAction {
        const text = sqlText(statement);
        if (text.includes('ADD COLUMN `clientEventId`')) return 'column:clientEventId';
        if (text.includes('ADD COLUMN `payloadHash`')) return 'column:payloadHash';
        if (text.includes(`CREATE UNIQUE INDEX \`${PAYMENT_IDEMPOTENCY_INDEX}\``)) {
            return 'index:idempotency';
        }
        throw new Error(`DDL inesperado en fake de Payment: ${text}`);
    }

    private apply(action: PaymentAction): void {
        if (action === 'column:clientEventId') this.columns.clientEventId = 'valid';
        if (action === 'column:payloadHash') this.columns.payloadHash = 'valid';
        if (action === 'index:idempotency') this.index = 'valid';
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

const validRetencionSufridaClientEventIdColumn: RetencionSufridaColumnRow = {
    ...validColumn,
    columnType: 'varchar(128)',
    characterMaximumLength: 128n,
};

const validRetencionSufridaPayloadHashColumn: RetencionSufridaColumnRow = {
    ...validColumn,
    columnType: 'varchar(64)',
    characterMaximumLength: 64n,
};

class RetencionSufridaSchemaFake implements DeploySchemaClient {
    tableExists = true;
    columns: Record<'clientEventId' | 'payloadHash', State> = {
        clientEventId: 'missing',
        payloadHash: 'missing',
    };
    index: State = 'missing';
    duplicates: unknown[] = [];
    raceWins = new Set<RetencionSufridaAction>();
    hardFailures = new Set<RetencionSufridaAction>();
    events: string[] = [];
    duplicateQueries: string[] = [];

    makeEverythingValid(): this {
        this.columns.clientEventId = 'valid';
        this.columns.payloadHash = 'valid';
        this.index = 'valid';
        return this;
    }

    private columnRows(
        columnName: 'clientEventId' | 'payloadHash',
    ): RetencionSufridaColumnRow[] {
        const state = this.columns[columnName];
        if (state === 'missing') return [];
        const valid = columnName === 'clientEventId'
            ? validRetencionSufridaClientEventIdColumn
            : validRetencionSufridaPayloadHashColumn;
        return [{ ...(state === 'valid' ? valid : { ...valid, isNullable: 'NO' }) }];
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes("TABLE_NAME = 'RetencionSufrida'")
            && text.includes('information_schema.TABLES')) {
            return (this.tableExists ? [{ tableName: 'RetencionSufrida' }] : []) as T;
        }
        if (text.includes("TABLE_NAME = 'RetencionSufrida'")
            && text.includes("COLUMN_NAME = 'tenantId'")) {
            return [{ ...validColumn, isNullable: 'NO' }] as T;
        }
        if (text.includes('FROM information_schema.COLUMNS')
            && text.includes("TABLE_NAME = 'RetencionSufrida'")) {
            const columnName = values.find(value => (
                value === 'clientEventId' || value === 'payloadHash'
            ));
            if (columnName === 'clientEventId' || columnName === 'payloadHash') {
                return this.columnRows(columnName) as T;
            }
        }
        if (text.includes('information_schema.STATISTICS')
            && values.includes(RETENCION_SUFRIDA_IDEMPOTENCY_INDEX)) {
            if (this.index === 'missing') return [] as T;
            const rows: RetencionSufridaIndexRow[] = exactIndexRows(
                RETENCION_SUFRIDA_IDEMPOTENCY_INDEX,
                ['tenantId', 'clientEventId'],
                true,
            );
            return (this.index === 'valid'
                ? rows
                : rows.map(row => ({ ...row, nonUnique: 1n }))) as T;
        }
        if (text.includes('GROUP BY tenantId, clientEventId')) {
            this.events.push('query:safety:duplicates');
            this.duplicateQueries.push(text);
            return this.duplicates as T;
        }

        throw new Error(`Query inesperada en fake de RetencionSufrida: ${text}`);
    }

    private actionFor(statement: Prisma.Sql): RetencionSufridaAction {
        const text = sqlText(statement);
        if (text.includes('ADD COLUMN `clientEventId`')) return 'column:clientEventId';
        if (text.includes('ADD COLUMN `payloadHash`')) return 'column:payloadHash';
        if (text.includes(`CREATE UNIQUE INDEX \`${RETENCION_SUFRIDA_IDEMPOTENCY_INDEX}\``)) {
            return 'index:idempotency';
        }
        throw new Error(`DDL inesperado en fake de RetencionSufrida: ${text}`);
    }

    private apply(action: RetencionSufridaAction): void {
        if (action === 'column:clientEventId') this.columns.clientEventId = 'valid';
        if (action === 'column:payloadHash') this.columns.payloadHash = 'valid';
        if (action === 'index:idempotency') this.index = 'valid';
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

describe('deploy schema preflight', () => {
    it('acepta únicamente Warehouse.sellerId nullable varchar(191)', () => {
        expect(inspectWarehouseSellerColumn([])).toBe('missing');
        expect(inspectWarehouseSellerColumn([validColumn])).toBe('valid');
        expect(inspectWarehouseSellerColumn([invalidColumn])).toBe('invalid');
        expect(inspectWarehouseSellerColumn([{ ...validColumn, isNullable: 'NO' }])).toBe('invalid');
        expect(inspectWarehouseSellerColumn([{ ...validColumn, columnDefault: 'seller-default' }])).toBe('invalid');
    });

    it('acepta únicamente el unique tenantId + sellerId en el orden exacto', () => {
        expect(inspectWarehouseSellerIndex([])).toBe('missing');
        expect(inspectWarehouseSellerIndex([...validSellerIndexRows].reverse())).toBe('valid');
        expect(inspectWarehouseSellerIndex(validSellerIndexRows.map(row => ({ ...row, nonUnique: 1n })))).toBe('invalid');
        expect(inspectWarehouseSellerIndex([
            { ...validSellerIndexRows[0], columnName: 'sellerId' },
            { ...validSellerIndexRows[1], columnName: 'tenantId' },
        ])).toBe('invalid');
    });

    it('rechaza un índice de vendedor homónimo por prefijos o invisible', () => {
        expect(inspectWarehouseSellerIndex(validSellerIndexRows.map(row => ({ ...row, subPart: 10n })))).toBe('invalid');
        expect(inspectWarehouseSellerIndex(validSellerIndexRows.map(row => ({ ...row, isVisible: 'NO' })))).toBe('invalid');
    });

    it('no aplica DDL sobre una instalación completamente vacía', async () => {
        const query = vi.fn().mockResolvedValue([]);
        const execute = vi.fn();
        const info = vi.fn();

        await applyDeploySchemaPreflight({ query, execute }, { info, warn: vi.fn() });

        expect(query).toHaveBeenCalledTimes(5);
        expect(execute).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledWith(expect.stringContaining('Warehouse aún no existe'));
    });

    it('falla cerrado si StockCount existe sin Warehouse', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ tableName: 'StockCount' }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        await expect(applyDeploySchemaPreflight(
            { query, execute: vi.fn() },
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
    });

    it('falla cerrado si ProductReturn existe sin Warehouse', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ tableName: 'ProductReturn' }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        await expect(applyDeploySchemaPreflight(
            { query, execute: vi.fn() },
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
    });

    it('falla cerrado si RetencionSufrida existe sin Warehouse', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ tableName: 'RetencionSufrida' }]);

        await expect(applyDeploySchemaPreflight(
            { query, execute: vi.fn() },
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
    });
});

describe('StockCount deploy schema preflight', () => {
    it('valida columnas, índices y FK con la forma exacta de Prisma', () => {
        expect(inspectStockCountNullableIdColumn([])).toBe('missing');
        expect(inspectStockCountNullableIdColumn([validColumn])).toBe('valid');
        expect(inspectStockCountNullableIdColumn([invalidColumn])).toBe('invalid');

        const openIndex = exactIndexRows(STOCK_COUNT_OPEN_WAREHOUSE_INDEX, ['openWarehouseKey'], true);
        const warehouseIndex = exactIndexRows(STOCK_COUNT_WAREHOUSE_INDEX, ['warehouseId'], false);
        const compositeIndex = exactIndexRows(
            STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
            ['tenantId', 'warehouseId', 'status'],
            false,
        );
        expect(inspectStockCountOpenWarehouseIndex(openIndex)).toBe('valid');
        expect(inspectStockCountOpenWarehouseIndex([{ ...openIndex[0], nonUnique: 1n }])).toBe('invalid');
        expect(inspectStockCountWarehouseIndex(warehouseIndex)).toBe('valid');
        expect(inspectStockCountWarehouseIndex([{ ...warehouseIndex[0], columnName: 'tenantId' }])).toBe('invalid');
        expect(inspectStockCountTenantWarehouseStatusIndex([...compositeIndex].reverse())).toBe('valid');
        expect(inspectStockCountTenantWarehouseStatusIndex(compositeIndex.slice(0, 2))).toBe('invalid');
        expect(inspectStockCountWarehouseForeignKey([validForeignKey])).toBe('valid');
        expect(inspectStockCountWarehouseForeignKey([{ ...validForeignKey, deleteRule: 'CASCADE' }])).toBe('invalid');
        expect(inspectStockCountWarehouseForeignKey([
            validForeignKey,
            { ...validForeignKey, constraintName: 'otra_fkey' },
        ])).toBe('invalid');
    });

    it('deja que db push cree StockCount en una instalación sin esa tabla', async () => {
        const db = new StockCountSchemaFake();
        db.stockCountExists = false;
        const info = vi.fn();

        await applyStockCountSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('StockCount aún no existe'));
    });

    it('crea solo DDL expand-only, en orden seguro, sin reasignar conteos legados', async () => {
        const db = new StockCountSchemaFake();

        await applyStockCountSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns).toEqual({ warehouseId: 'valid', openWarehouseKey: 'valid' });
        expect(db.indexes).toEqual({
            openWarehouseKey: 'valid',
            warehouseId: 'valid',
            tenantWarehouseStatus: 'valid',
        });
        expect(db.foreignKey).toBe('valid');
        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:warehouseId',
            'execute:column:openWarehouseKey',
            'execute:index:openWarehouseKey',
            'execute:index:warehouseId',
            'execute:index:tenantWarehouseStatus',
            'execute:foreignKey:warehouseId',
        ]);
        expect(db.events.indexOf('query:safety:duplicates')).toBeLessThan(
            db.events.indexOf('execute:index:openWarehouseKey'),
        );
    });

    it('es idempotente cuando el schema ya está completo', async () => {
        const db = new StockCountSchemaFake().makeEverythingValid();

        await applyStockCountSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });
        await applyStockCountSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('converge desde un estado parcial sin tocar objetos válidos', async () => {
        const db = new StockCountSchemaFake().makeEverythingValid();
        db.columns.openWarehouseKey = 'missing';
        db.indexes.openWarehouseKey = 'missing';
        db.foreignKey = 'missing';

        await applyStockCountSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:openWarehouseKey',
            'execute:index:openWarehouseKey',
            'execute:foreignKey:warehouseId',
        ]);
    });

    it.each([
        ['columna', (db: StockCountSchemaFake) => { db.columns.warehouseId = 'invalid'; }, 'StockCount.warehouseId'],
        ['índice', (db: StockCountSchemaFake) => { db.indexes.warehouseId = 'invalid'; }, STOCK_COUNT_WAREHOUSE_INDEX],
        ['FK', (db: StockCountSchemaFake) => { db.foreignKey = 'invalid'; }, STOCK_COUNT_WAREHOUSE_FOREIGN_KEY],
    ])('falla cerrado ante %s incompatible', async (_label, arrange, expectedMessage) => {
        const db = new StockCountSchemaFake().makeEverythingValid();
        arrange(db);

        await expect(applyStockCountSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(expectedMessage);
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it.each([
        [
            'duplicados activos',
            (db: StockCountSchemaFake) => {
                db.duplicateOpenWarehouses = [{ openWarehouseKey: 'warehouse-1', duplicateCount: 2n }];
            },
            'conteos activos duplicados',
        ],
        [
            'bodega ajena o inexistente',
            (db: StockCountSchemaFake) => {
                db.invalidWarehouses = [{
                    stockCountId: 'count-1',
                    tenantId: 'tenant-1',
                    warehouseId: 'warehouse-2',
                    reason: 'CROSS_TENANT',
                }];
            },
            'bodega inexistente o de otro tenant',
        ],
        [
            'clave activa incoherente',
            (db: StockCountSchemaFake) => {
                db.invalidOpenKeys = [{
                    stockCountId: 'count-1',
                    status: 'CLOSED',
                    warehouseId: 'warehouse-1',
                    openWarehouseKey: 'warehouse-1',
                    reason: 'INACTIVE_COUNT',
                }];
            },
            'claves de conteo activo incoherentes',
        ],
    ])('falla cerrado sin DDL ante datos con %s', async (_label, arrange, expectedMessage) => {
        const db = new StockCountSchemaFake().makeEverythingValid();
        arrange(db);

        await expect(applyStockCountSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(expectedMessage);
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('tolera carreras solo después de releer y verificar cada objeto', async () => {
        const db = new StockCountSchemaFake();
        const actions: Action[] = [
            'column:warehouseId',
            'column:openWarehouseKey',
            'index:openWarehouseKey',
            'index:warehouseId',
            'index:tenantWarehouseStatus',
            'foreignKey:warehouseId',
        ];
        actions.forEach(action => db.raceWins.add(action));
        const warn = vi.fn();

        await applyStockCountSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.columns).toEqual({ warehouseId: 'valid', openWarehouseKey: 'valid' });
        expect(db.indexes).toEqual({
            openWarehouseKey: 'valid',
            warehouseId: 'valid',
            tenantWarehouseStatus: 'valid',
        });
        expect(db.foreignKey).toBe('valid');
        expect(warn).toHaveBeenCalledTimes(actions.length);
    });

    it('propaga un error DDL si la relectura no confirma convergencia', async () => {
        const db = new StockCountSchemaFake();
        db.hardFailures.add('column:warehouseId');

        await expect(applyStockCountSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo column:warehouseId');
        expect(db.columns.warehouseId).toBe('missing');
    });
});

describe('ProductReturn deploy schema preflight', () => {
    it('valida columnas nullable e índice único con la forma exacta de Prisma', () => {
        expect(inspectProductReturnClientEventIdColumn([])).toBe('missing');
        expect(inspectProductReturnClientEventIdColumn([
            validProductReturnClientEventIdColumn,
        ])).toBe('valid');
        expect(inspectProductReturnClientEventIdColumn([{
            ...validProductReturnClientEventIdColumn,
            characterMaximumLength: 191n,
            columnType: 'varchar(191)',
        }])).toBe('invalid');
        expect(inspectProductReturnPayloadHashColumn([
            validProductReturnPayloadHashColumn,
        ])).toBe('valid');
        expect(inspectProductReturnPayloadHashColumn([{
            ...validProductReturnPayloadHashColumn,
            isNullable: 'NO',
        }])).toBe('invalid');

        const index = exactIndexRows(
            PRODUCT_RETURN_IDEMPOTENCY_INDEX,
            ['tenantId', 'clientEventId'],
            true,
        );
        expect(inspectProductReturnIdempotencyIndex([...index].reverse())).toBe('valid');
        expect(inspectProductReturnIdempotencyIndex(
            index.map(row => ({ ...row, nonUnique: 1n })),
        )).toBe('invalid');
        expect(inspectProductReturnIdempotencyIndex([
            { ...index[0], columnName: 'clientEventId' },
            { ...index[1], columnName: 'tenantId' },
        ])).toBe('invalid');
    });

    it('deja que db push cree ProductReturn cuando la tabla aún no existe', async () => {
        const db = new ProductReturnSchemaFake();
        db.productReturnExists = false;
        const info = vi.fn();

        await applyProductReturnSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('ProductReturn aún no existe'));
    });

    it('crea solo las columnas nullable antes de validar y crear el unique', async () => {
        const db = new ProductReturnSchemaFake();

        await applyProductReturnSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns).toEqual({ clientEventId: 'valid', payloadHash: 'valid' });
        expect(db.index).toBe('valid');
        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:clientEventId',
            'execute:column:payloadHash',
            'execute:index:idempotency',
        ]);
        expect(db.events.indexOf('query:safety:duplicates')).toBeLessThan(
            db.events.indexOf('execute:index:idempotency'),
        );
    });

    it('es idempotente y converge desde un estado parcial', async () => {
        const complete = new ProductReturnSchemaFake().makeEverythingValid();
        await applyProductReturnSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        await applyProductReturnSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        expect(complete.events.some(event => event.startsWith('execute:'))).toBe(false);

        const partial = new ProductReturnSchemaFake().makeEverythingValid();
        partial.columns.payloadHash = 'missing';
        partial.index = 'missing';
        await applyProductReturnSchemaPreflight(partial, { info: vi.fn(), warn: vi.fn() });
        expect(partial.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:payloadHash',
            'execute:index:idempotency',
        ]);
    });

    it.each([
        [
            'clientEventId incompatible',
            (db: ProductReturnSchemaFake) => { db.columns.clientEventId = 'invalid'; },
            'ProductReturn.clientEventId',
        ],
        [
            'payloadHash incompatible',
            (db: ProductReturnSchemaFake) => { db.columns.payloadHash = 'invalid'; },
            'ProductReturn.payloadHash',
        ],
        [
            'índice homónimo incompatible',
            (db: ProductReturnSchemaFake) => { db.index = 'invalid'; },
            PRODUCT_RETURN_IDEMPOTENCY_INDEX,
        ],
    ])('falla cerrado ante %s', async (_label, arrange, message) => {
        const db = new ProductReturnSchemaFake().makeEverythingValid();
        arrange(db);

        await expect(applyProductReturnSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(message);
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('falla cerrado ante duplicados no-null sin cambiar filas ni crear el índice', async () => {
        const db = new ProductReturnSchemaFake().makeEverythingValid();
        db.index = 'missing';
        db.duplicates = [{
            tenantId: 'tenant-1',
            clientEventId: 'return-event-1',
            duplicateCount: 2n,
        }];

        await expect(applyProductReturnSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('clientEventId duplicado');
        expect(db.index).toBe('missing');
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('tolera carreras únicamente cuando la relectura confirma cada objeto exacto', async () => {
        const db = new ProductReturnSchemaFake();
        const actions: ProductReturnAction[] = [
            'column:clientEventId',
            'column:payloadHash',
            'index:idempotency',
        ];
        actions.forEach(action => db.raceWins.add(action));
        const warn = vi.fn();

        await applyProductReturnSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.columns).toEqual({ clientEventId: 'valid', payloadHash: 'valid' });
        expect(db.index).toBe('valid');
        expect(warn).toHaveBeenCalledTimes(actions.length);
    });

    it('propaga un error DDL cuando el estado final sigue ausente', async () => {
        const db = new ProductReturnSchemaFake();
        db.hardFailures.add('column:clientEventId');

        await expect(applyProductReturnSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo column:clientEventId');
        expect(db.columns.clientEventId).toBe('missing');
    });
});

describe('Payment deploy schema preflight', () => {
    it('valida columnas nullable e índice único con la forma exacta de Prisma', () => {
        expect(inspectPaymentClientEventIdColumn([])).toBe('missing');
        expect(inspectPaymentClientEventIdColumn([
            validPaymentClientEventIdColumn,
        ])).toBe('valid');
        expect(inspectPaymentClientEventIdColumn([{
            ...validPaymentClientEventIdColumn,
            characterMaximumLength: 191n,
            columnType: 'varchar(191)',
        }])).toBe('invalid');
        expect(inspectPaymentPayloadHashColumn([
            validPaymentPayloadHashColumn,
        ])).toBe('valid');
        expect(inspectPaymentPayloadHashColumn([{
            ...validPaymentPayloadHashColumn,
            isNullable: 'NO',
        }])).toBe('invalid');

        const index = exactIndexRows(
            PAYMENT_IDEMPOTENCY_INDEX,
            ['saleId', 'clientEventId'],
            true,
        );
        expect(inspectPaymentIdempotencyIndex([...index].reverse())).toBe('valid');
        expect(inspectPaymentIdempotencyIndex(
            index.map(row => ({ ...row, nonUnique: 1n })),
        )).toBe('invalid');
        expect(inspectPaymentIdempotencyIndex([
            { ...index[0], columnName: 'clientEventId' },
            { ...index[1], columnName: 'saleId' },
        ])).toBe('invalid');
    });

    it('deja que db push cree Payment cuando la tabla aún no existe', async () => {
        const db = new PaymentSchemaFake();
        db.paymentExists = false;
        const info = vi.fn();

        await applyPaymentSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('Payment aún no existe'));
    });

    it('crea columnas nullable e índice único antes de db push', async () => {
        const db = new PaymentSchemaFake();

        await applyPaymentSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns).toEqual({ clientEventId: 'valid', payloadHash: 'valid' });
        expect(db.index).toBe('valid');
        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:clientEventId',
            'execute:column:payloadHash',
            'execute:index:idempotency',
        ]);
        expect(db.events.indexOf('query:safety:duplicates')).toBeLessThan(
            db.events.indexOf('execute:index:idempotency'),
        );
    });

    it('es idempotente y converge desde un estado parcial', async () => {
        const complete = new PaymentSchemaFake().makeEverythingValid();
        await applyPaymentSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        await applyPaymentSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        expect(complete.events.some(event => event.startsWith('execute:'))).toBe(false);

        const partial = new PaymentSchemaFake().makeEverythingValid();
        partial.columns.payloadHash = 'missing';
        partial.index = 'missing';
        await applyPaymentSchemaPreflight(partial, { info: vi.fn(), warn: vi.fn() });
        expect(partial.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:payloadHash',
            'execute:index:idempotency',
        ]);
    });

    it.each([
        [
            'clientEventId incompatible',
            (db: PaymentSchemaFake) => { db.columns.clientEventId = 'invalid'; },
            'Payment.clientEventId',
        ],
        [
            'payloadHash incompatible',
            (db: PaymentSchemaFake) => { db.columns.payloadHash = 'invalid'; },
            'Payment.payloadHash',
        ],
        [
            'índice homónimo incompatible',
            (db: PaymentSchemaFake) => { db.index = 'invalid'; },
            PAYMENT_IDEMPOTENCY_INDEX,
        ],
    ])('falla cerrado ante %s', async (_label, arrange, message) => {
        const db = new PaymentSchemaFake().makeEverythingValid();
        arrange(db);

        await expect(applyPaymentSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(message);
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('falla cerrado ante duplicados no-null sin cambiar filas ni crear el índice', async () => {
        const db = new PaymentSchemaFake().makeEverythingValid();
        db.index = 'missing';
        db.duplicates = [{
            saleId: 'sale-1',
            clientEventId: 'payment-event-1',
            duplicateCount: 2n,
        }];

        await expect(applyPaymentSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('clientEventId duplicado');
        expect(db.index).toBe('missing');
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('tolera carreras únicamente cuando la relectura confirma cada objeto exacto', async () => {
        const db = new PaymentSchemaFake();
        const actions: PaymentAction[] = [
            'column:clientEventId',
            'column:payloadHash',
            'index:idempotency',
        ];
        actions.forEach(action => db.raceWins.add(action));
        const warn = vi.fn();

        await applyPaymentSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.columns).toEqual({ clientEventId: 'valid', payloadHash: 'valid' });
        expect(db.index).toBe('valid');
        expect(warn).toHaveBeenCalledTimes(actions.length);
    });

    it('propaga un error DDL cuando el estado final sigue ausente', async () => {
        const db = new PaymentSchemaFake();
        db.hardFailures.add('column:clientEventId');

        await expect(applyPaymentSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo column:clientEventId');
        expect(db.columns.clientEventId).toBe('missing');
    });
});

describe('RetencionSufrida deploy schema preflight', () => {
    it('valida columnas nullable e índice único con la forma exacta de Prisma', () => {
        expect(inspectRetencionSufridaClientEventIdColumn([])).toBe('missing');
        expect(inspectRetencionSufridaClientEventIdColumn([
            validRetencionSufridaClientEventIdColumn,
        ])).toBe('valid');
        expect(inspectRetencionSufridaClientEventIdColumn([{
            ...validRetencionSufridaClientEventIdColumn,
            characterMaximumLength: 191n,
            columnType: 'varchar(191)',
        }])).toBe('invalid');
        expect(inspectRetencionSufridaPayloadHashColumn([
            validRetencionSufridaPayloadHashColumn,
        ])).toBe('valid');
        expect(inspectRetencionSufridaPayloadHashColumn([{
            ...validRetencionSufridaPayloadHashColumn,
            isNullable: 'NO',
        }])).toBe('invalid');

        const index = exactIndexRows(
            RETENCION_SUFRIDA_IDEMPOTENCY_INDEX,
            ['tenantId', 'clientEventId'],
            true,
        );
        expect(inspectRetencionSufridaIdempotencyIndex([...index].reverse())).toBe('valid');
        expect(inspectRetencionSufridaIdempotencyIndex(
            index.map(row => ({ ...row, nonUnique: 1n })),
        )).toBe('invalid');
        expect(inspectRetencionSufridaIdempotencyIndex([
            { ...index[0], columnName: 'clientEventId' },
            { ...index[1], columnName: 'tenantId' },
        ])).toBe('invalid');
    });

    it('deja que db push cree RetencionSufrida cuando la tabla aún no existe', async () => {
        const db = new RetencionSufridaSchemaFake();
        db.tableExists = false;
        const info = vi.fn();

        await applyRetencionSufridaSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('RetencionSufrida aún no existe'));
    });

    it('converge desde el schema legacy con DDL expand-only y conserva históricos null', async () => {
        const db = new RetencionSufridaSchemaFake();

        await applyRetencionSufridaSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns).toEqual({ clientEventId: 'valid', payloadHash: 'valid' });
        expect(db.index).toBe('valid');
        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:clientEventId',
            'execute:column:payloadHash',
            'execute:index:idempotency',
        ]);
        expect(db.events.indexOf('query:safety:duplicates')).toBeLessThan(
            db.events.indexOf('execute:index:idempotency'),
        );
        expect(db.duplicateQueries.length).toBeGreaterThan(0);
        expect(db.duplicateQueries.every(query => (
            query.includes('WHERE clientEventId IS NOT NULL')
        ))).toBe(true);
    });

    it('es idempotente con el schema completo y converge desde estados parciales', async () => {
        const complete = new RetencionSufridaSchemaFake().makeEverythingValid();
        await applyRetencionSufridaSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        await applyRetencionSufridaSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        expect(complete.events.some(event => event.startsWith('execute:'))).toBe(false);

        const partial = new RetencionSufridaSchemaFake().makeEverythingValid();
        partial.columns.payloadHash = 'missing';
        partial.index = 'missing';
        await applyRetencionSufridaSchemaPreflight(partial, { info: vi.fn(), warn: vi.fn() });
        expect(partial.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:payloadHash',
            'execute:index:idempotency',
        ]);
    });

    it.each([
        [
            'clientEventId incompatible',
            (db: RetencionSufridaSchemaFake) => { db.columns.clientEventId = 'invalid'; },
            'RetencionSufrida.clientEventId',
        ],
        [
            'payloadHash incompatible',
            (db: RetencionSufridaSchemaFake) => { db.columns.payloadHash = 'invalid'; },
            'RetencionSufrida.payloadHash',
        ],
        [
            'índice homónimo incompatible',
            (db: RetencionSufridaSchemaFake) => { db.index = 'invalid'; },
            RETENCION_SUFRIDA_IDEMPOTENCY_INDEX,
        ],
    ])('falla cerrado ante %s', async (_label, arrange, message) => {
        const db = new RetencionSufridaSchemaFake().makeEverythingValid();
        arrange(db);

        await expect(applyRetencionSufridaSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(message);
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('falla cerrado ante duplicados no-null sin cambiar filas ni crear el índice', async () => {
        const db = new RetencionSufridaSchemaFake().makeEverythingValid();
        db.index = 'missing';
        db.duplicates = [{
            tenantId: 'tenant-1',
            clientEventId: 'retencion-event-1',
            duplicateCount: 2n,
        }];

        await expect(applyRetencionSufridaSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('clientEventId duplicado');
        expect(db.index).toBe('missing');
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('tolera carreras únicamente cuando la relectura confirma cada objeto exacto', async () => {
        const db = new RetencionSufridaSchemaFake();
        const actions: RetencionSufridaAction[] = [
            'column:clientEventId',
            'column:payloadHash',
            'index:idempotency',
        ];
        actions.forEach(action => db.raceWins.add(action));
        const warn = vi.fn();

        await applyRetencionSufridaSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.columns).toEqual({ clientEventId: 'valid', payloadHash: 'valid' });
        expect(db.index).toBe('valid');
        expect(warn).toHaveBeenCalledTimes(actions.length);
    });

    it('propaga un error DDL cuando el estado final sigue ausente', async () => {
        const db = new RetencionSufridaSchemaFake();
        db.hardFailures.add('column:clientEventId');

        await expect(applyRetencionSufridaSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo column:clientEventId');
        expect(db.columns.clientEventId).toBe('missing');
    });
});
