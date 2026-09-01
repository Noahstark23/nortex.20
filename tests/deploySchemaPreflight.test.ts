import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
    applyDeploySchemaPreflight,
    applyPaymentSchemaPreflight,
    applyPharmacyInventorySchemaPreflight,
    applyProcurementPhaseTwoBSchemaPreflight,
    applyProcurementPhaseTwoCSchemaPreflight,
    applyProductReturnSchemaPreflight,
    applyRetencionSufridaSchemaPreflight,
    applyStockCountSchemaPreflight,
    inspectPaymentClientEventIdColumn,
    inspectPaymentIdempotencyIndex,
    inspectPaymentPayloadHashColumn,
    inspectPharmacyInventoryColumn,
    inspectPharmacyInventoryForeignKey,
    inspectPharmacyInventoryIndex,
    inspectProcurementPhaseTwoBColumn,
    inspectProcurementPhaseTwoBForeignKey,
    inspectProcurementPhaseTwoBIndex,
    inspectProcurementPhaseTwoCColumn,
    inspectProcurementPhaseTwoCForeignKey,
    inspectProcurementPhaseTwoCIndex,
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
    PRODUCT_BATCH_HOLD_SOURCE_UNIQUE_INDEX,
    PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY,
    PURCHASE_ITEM_INVENTORY_BATCH_INDEX,
    PURCHASE_ITEM_INVENTORY_WAREHOUSE_FOREIGN_KEY,
    PURCHASE_ITEM_INVENTORY_WAREHOUSE_INDEX,
    PRODUCT_BATCH_LEDGER_SOURCE_UNIQUE_INDEX,
    SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY,
    SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX,
    PRODUCT_RETURN_IDEMPOTENCY_INDEX,
    RETENCION_SUFRIDA_IDEMPOTENCY_INDEX,
    STOCK_COUNT_OPEN_WAREHOUSE_INDEX,
    STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
    STOCK_COUNT_WAREHOUSE_FOREIGN_KEY,
    STOCK_COUNT_WAREHOUSE_INDEX,
    STOCK_TRANSFER_IDEMPOTENCY_INDEX,
    SUPPLIER_CREDIT_NOTE_LINE_RETURN_ITEM_UNIQUE_INDEX,
    SUPPLIER_RETURN_EVENT_UNIQUE_INDEX,
    UnsafeSchemaStateError,
    WAREHOUSE_SELLER_INDEX,
    type DeploySchemaClient,
    type PaymentColumnRow,
    type PaymentIndexRow,
    type PharmacyInventoryColumnContract,
    type ProcurementPhaseTwoBColumnContract,
    type ProcurementPhaseTwoBColumnRow,
    type ProcurementPhaseTwoCColumnContract,
    type ProcurementPhaseTwoCColumnRow,
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

        expect(query).toHaveBeenCalledTimes(9);
        expect(execute).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledWith(expect.stringContaining('Warehouse aún no existe'));
    });

    it('falla cerrado si StockCount existe sin Warehouse', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ tableName: 'StockCount' }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
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
            .mockResolvedValueOnce([])
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
            .mockResolvedValueOnce([{ tableName: 'RetencionSufrida' }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        await expect(applyDeploySchemaPreflight(
            { query, execute: vi.fn() },
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
    });

    it('falla cerrado si Purchase existe sin Warehouse', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ tableName: 'Purchase' }])
            .mockResolvedValueOnce([]);

        await expect(applyDeploySchemaPreflight(
            { query, execute: vi.fn() },
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
    });

    it('falla cerrado si ProductBatchHold existe sin Warehouse', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ tableName: 'ProductBatchHold' }]);

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

const phaseTwoBTenantContracts: ProcurementPhaseTwoBColumnContract[] = [
    {
        columnName: 'batchWarehouseLedgerMode',
        columnType: 'varchar(16)',
        nullable: false,
        defaultValue: 'OFF',
    },
    {
        columnName: 'batchWarehouseLedgerActivatedAt',
        columnType: 'datetime(3)',
        nullable: true,
        defaultValue: null,
    },
];
const phaseTwoBStockTransferContracts: ProcurementPhaseTwoBColumnContract[] = [
    { columnName: 'clientEventId', columnType: 'varchar(128)', nullable: true, defaultValue: null },
    { columnName: 'payloadHash', columnType: 'varchar(64)', nullable: true, defaultValue: null },
    { columnName: 'payloadVersion', columnType: 'int', nullable: false, defaultValue: '1' },
    { columnName: 'batchLedgerMode', columnType: 'varchar(16)', nullable: false, defaultValue: 'OFF' },
    { columnName: 'batchTransferStatus', columnType: 'varchar(32)', nullable: false, defaultValue: 'OFF' },
    { columnName: 'batchSnapshot', columnType: 'json', nullable: true, defaultValue: null },
];
const phaseTwoBFakeContracts: ProcurementPhaseTwoBColumnContract[] = [
    ...phaseTwoBTenantContracts,
    ...phaseTwoBStockTransferContracts,
    {
        columnName: 'warehouseId',
        columnType: 'varchar(191)',
        nullable: true,
        defaultValue: null,
    },
];

function phaseTwoBColumnRow(
    contract: ProcurementPhaseTwoBColumnContract,
): ProcurementPhaseTwoBColumnRow {
    const varchar = contract.columnType.match(/^varchar\((\d+)\)$/);
    return {
        columnName: contract.columnName,
        dataType: contract.columnType.split('(')[0],
        columnType: contract.columnType,
        isNullable: contract.nullable ? 'YES' : 'NO',
        characterMaximumLength: varchar ? BigInt(varchar[1]) : null,
        characterSetName: varchar ? 'utf8mb4' : null,
        collationName: varchar ? 'utf8mb4_unicode_ci' : null,
        columnDefault: contract.defaultValue,
        extra: contract.extra ?? '',
        generationExpression: '',
    };
}

class ProcurementPhaseTwoBSchemaFake implements DeploySchemaClient {
    tables = new Set<string>(['Tenant']);
    columns = new Map<string, State>();
    index: State = 'missing';
    stockTransferIndex: State = 'missing';
    foreignKey: State = 'missing';
    invalidReferences: Array<{
        allocationId: string;
        tenantId: string;
        warehouseId: string;
        reason: 'MISSING_WAREHOUSE' | 'CROSS_TENANT';
    }> = [];
    duplicateStockTransferEvents: Array<{
        tenantId: string;
        clientEventId: string;
        duplicateCount: number | bigint;
    }> = [];
    events: string[] = [];
    raceWins = new Set<string>();
    hardFailures = new Set<string>();

    constructor() {
        for (const contract of phaseTwoBTenantContracts) {
            this.columns.set(`Tenant.${contract.columnName}`, 'missing');
        }
    }

    makeTenantValid(): this {
        for (const contract of phaseTwoBTenantContracts) {
            this.columns.set(`Tenant.${contract.columnName}`, 'valid');
        }
        return this;
    }

    addStockTransfer(state: State = 'missing'): this {
        this.tables.add('StockTransfer');
        for (const contract of phaseTwoBStockTransferContracts) {
            this.columns.set(`StockTransfer.${contract.columnName}`, state);
        }
        return this;
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];
        if (text.includes('information_schema.TABLES') && text.includes('TABLE_NAME IN')) {
            return [...this.tables].map(tableName => ({ tableName })) as T;
        }
        if (text.includes('information_schema.COLUMNS')) {
            const tableName = String(values[0]);
            const rows: ProcurementPhaseTwoBColumnRow[] = [];
            for (const contract of phaseTwoBFakeContracts) {
                const key = `${tableName}.${contract.columnName}`;
                const state = this.columns.get(key);
                if (state === 'valid') rows.push(phaseTwoBColumnRow(contract));
                if (state === 'invalid') {
                    rows.push(phaseTwoBColumnRow({ ...contract, nullable: !contract.nullable }));
                }
            }
            return rows as T;
        }
        if (text.includes('information_schema.STATISTICS')) {
            const tableName = String(values[0]);
            if (tableName === 'StockTransfer') {
                if (this.stockTransferIndex === 'missing') return [] as T;
                const rows = exactIndexRows(
                    STOCK_TRANSFER_IDEMPOTENCY_INDEX,
                    ['tenantId', 'clientEventId'],
                    true,
                );
                return (this.stockTransferIndex === 'valid'
                    ? rows
                    : rows.map(row => ({ ...row, nonUnique: 1n }))) as T;
            }
            if (tableName !== 'SaleItemBatchAllocation' || this.index === 'missing') {
                return [] as T;
            }
            const rows = exactIndexRows(
                SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX,
                ['tenantId', 'warehouseId'],
                false,
            );
            return (this.index === 'valid'
                ? rows
                : [{ ...rows[0], nonUnique: 0n }, rows[1]]) as T;
        }
        if (text.includes('information_schema.REFERENTIAL_CONSTRAINTS')) {
            if (String(values[0]) !== 'SaleItemBatchAllocation' || this.foreignKey === 'missing') {
                return [] as T;
            }
            const row: StockCountForeignKeyRow = {
                constraintName: SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY,
                columnName: 'warehouseId',
                referencedTableName: 'Warehouse',
                referencedColumnName: 'id',
                ordinalPosition: 1n,
                deleteRule: this.foreignKey === 'valid' ? 'RESTRICT' : 'CASCADE',
                updateRule: 'CASCADE',
            };
            return [row] as T;
        }
        if (text.includes('LEFT JOIN `Warehouse` warehouse')) {
            this.events.push('query:safety:warehouse');
            return this.invalidReferences as T;
        }
        if (text.includes('FROM `StockTransfer`') && text.includes('GROUP BY tenantId, clientEventId')) {
            this.events.push('query:safety:stockTransferDuplicates');
            return this.duplicateStockTransferEvents as T;
        }
        throw new Error(`Query inesperada en fake 2B: ${text}`);
    }

    async execute(statement: Prisma.Sql): Promise<number> {
        const text = sqlText(statement);
        const tableName = text.match(/ALTER TABLE `([^`]+)`/)?.[1];
        const columnName = text.match(/ADD COLUMN `([^`]+)`/)?.[1];
        let action: string;
        if (tableName && columnName) {
            action = `column:${tableName}.${columnName}`;
            this.columns.set(`${tableName}.${columnName}`, 'valid');
        } else if (text.includes(`CREATE INDEX \`${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX}\``)) {
            action = 'index:warehouse';
            this.index = 'valid';
        } else if (text.includes(`CREATE UNIQUE INDEX \`${STOCK_TRANSFER_IDEMPOTENCY_INDEX}\``)) {
            action = 'index:stockTransferIdempotency';
            this.stockTransferIndex = 'valid';
        } else if (text.includes(`ADD CONSTRAINT \`${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY}\``)) {
            action = 'foreignKey:warehouse';
            this.foreignKey = 'valid';
        } else {
            throw new Error(`DDL inesperado en fake 2B: ${text}`);
        }
        this.events.push(`execute:${action}`);
        if (this.hardFailures.has(action)) {
            if (columnName && tableName) this.columns.set(`${tableName}.${columnName}`, 'missing');
            throw new Error(`fallo ${action}`);
        }
        if (this.raceWins.has(action)) throw new Error(`otro iniciador ganó ${action}`);
        return 0;
    }
}

describe('Procurement Fase 2B deploy schema preflight', () => {
    it('valida tipos, índices y FKs con la forma exacta de Prisma/MySQL 8', () => {
        const decimal: ProcurementPhaseTwoBColumnContract = {
            columnName: 'stock',
            columnType: 'decimal(18,4)',
            nullable: false,
            defaultValue: '0.0000',
        };
        const decimalRow = phaseTwoBColumnRow(decimal);
        expect(inspectProcurementPhaseTwoBColumn([decimalRow], decimal)).toBe('valid');
        expect(inspectProcurementPhaseTwoBColumn(
            [{ ...decimalRow, columnType: 'decimal(12,2)' }],
            decimal,
        )).toBe('invalid');

        const index = exactIndexRows(
            PRODUCT_BATCH_LEDGER_SOURCE_UNIQUE_INDEX,
            ['tenantId', 'sourceKey'],
            true,
        );
        expect(inspectProcurementPhaseTwoBIndex(
            [...index].reverse(),
            PRODUCT_BATCH_LEDGER_SOURCE_UNIQUE_INDEX,
            ['tenantId', 'sourceKey'],
            true,
        )).toBe('valid');
        expect(inspectProcurementPhaseTwoBIndex(
            index.map(row => ({ ...row, nonUnique: 1n })),
            PRODUCT_BATCH_LEDGER_SOURCE_UNIQUE_INDEX,
            ['tenantId', 'sourceKey'],
            true,
        )).toBe('invalid');

        expect(inspectProcurementPhaseTwoBForeignKey([{
            constraintName: SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY,
            columnName: 'warehouseId',
            referencedTableName: 'Warehouse',
            referencedColumnName: 'id',
            ordinalPosition: 1n,
            deleteRule: 'RESTRICT',
            updateRule: 'CASCADE',
        }], {
            constraintName: SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY,
            columnName: 'warehouseId',
            referencedTableName: 'Warehouse',
            deleteRule: 'RESTRICT',
        })).toBe('valid');
    });

    it('converge columnas base desde un estado parcial sin activar el ledger', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake();

        await applyProcurementPhaseTwoBSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.columns.get('Tenant.batchWarehouseLedgerMode')).toBe('valid');
        expect(db.columns.get('Tenant.batchWarehouseLedgerActivatedAt')).toBe('valid');
        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:Tenant.batchWarehouseLedgerMode',
            'execute:column:Tenant.batchWarehouseLedgerActivatedAt',
        ]);
        expect(db.events.some(event => /SHADOW|ENFORCED/.test(event))).toBe(false);
    });

    it('converge StockTransfer legacy con columnas nullable/default OFF e índice único', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake()
            .makeTenantValid()
            .addStockTransfer();

        await applyProcurementPhaseTwoBSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        for (const contract of phaseTwoBStockTransferContracts) {
            expect(db.columns.get(`StockTransfer.${contract.columnName}`)).toBe('valid');
        }
        expect(db.stockTransferIndex).toBe('valid');
        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:StockTransfer.clientEventId',
            'execute:column:StockTransfer.payloadHash',
            'execute:column:StockTransfer.payloadVersion',
            'execute:column:StockTransfer.batchLedgerMode',
            'execute:column:StockTransfer.batchTransferStatus',
            'execute:column:StockTransfer.batchSnapshot',
            'execute:index:stockTransferIdempotency',
        ]);
        expect(db.events.filter(event => event === 'query:safety:stockTransferDuplicates')).toHaveLength(2);
    });

    it('falla cerrado ante clientEventId duplicados sin crear el unique', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake()
            .makeTenantValid()
            .addStockTransfer('valid');
        db.duplicateStockTransferEvents = [{
            tenantId: 'tenant-a',
            clientEventId: 'event-duplicado',
            duplicateCount: 2n,
        }];

        await expect(applyProcurementPhaseTwoBSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('StockTransfer.clientEventId duplicados');
        expect(db.stockTransferIndex).toBe('missing');
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('tolera carrera del unique de StockTransfer solo si la relectura es exacta', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake()
            .makeTenantValid()
            .addStockTransfer('valid');
        db.raceWins.add('index:stockTransferIdempotency');
        const warn = vi.fn();

        await applyProcurementPhaseTwoBSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.stockTransferIndex).toBe('valid');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('falla cerrado ante unique homónimo de StockTransfer no único', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake()
            .makeTenantValid()
            .addStockTransfer('valid');
        db.stockTransferIndex = 'invalid';

        await expect(applyProcurementPhaseTwoBSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(STOCK_TRANSFER_IDEMPOTENCY_INDEX);
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('es idempotente y tolera una carrera solo tras releer la columna exacta', async () => {
        const complete = new ProcurementPhaseTwoBSchemaFake().makeTenantValid();
        await applyProcurementPhaseTwoBSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        await applyProcurementPhaseTwoBSchemaPreflight(complete, { info: vi.fn(), warn: vi.fn() });
        expect(complete.events.some(event => event.startsWith('execute:'))).toBe(false);

        const raced = new ProcurementPhaseTwoBSchemaFake();
        raced.raceWins.add('column:Tenant.batchWarehouseLedgerMode');
        const warn = vi.fn();
        await applyProcurementPhaseTwoBSchemaPreflight(raced, { info: vi.fn(), warn });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(raced.columns.get('Tenant.batchWarehouseLedgerMode')).toBe('valid');
    });

    it('falla cerrado ante una columna homónima incompatible sin DDL', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake().makeTenantValid();
        db.columns.set('Tenant.batchWarehouseLedgerMode', 'invalid');

        await expect(applyProcurementPhaseTwoBSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('Tenant.batchWarehouseLedgerMode');
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('falla cerrado si una tabla nueva aparece parcial o incompatible', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake().makeTenantValid();
        db.tables.add('ProductBatchWarehouseStock');

        await expect(applyProcurementPhaseTwoBSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('ProductBatchWarehouseStock.id');
    });

    it('no crea la FK de allocation ante una bodega cross-tenant', async () => {
        const db = new ProcurementPhaseTwoBSchemaFake().makeTenantValid();
        db.tables.add('SaleItemBatchAllocation');
        db.columns.set('SaleItemBatchAllocation.warehouseId', 'missing');
        db.invalidReferences = [{
            allocationId: 'allocation-1',
            tenantId: 'tenant-a',
            warehouseId: 'warehouse-b',
            reason: 'CROSS_TENANT',
        }];

        await expect(applyProcurementPhaseTwoBSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('otro tenant');
        expect(db.foreignKey).toBe('missing');
        expect(db.events).toContain('execute:column:SaleItemBatchAllocation.warehouseId');
        expect(db.events).toContain('execute:index:warehouse');
        expect(db.events).not.toContain('execute:foreignKey:warehouse');
    });
});

const phaseTwoCBaseContracts: Array<{
    tableName: 'Purchase' | 'PurchaseItem';
    contract: ProcurementPhaseTwoCColumnContract;
}> = [
    {
        tableName: 'Purchase',
        contract: { columnName: 'settledAt', columnType: 'datetime(3)', nullable: true, defaultValue: null },
    },
    {
        tableName: 'PurchaseItem',
        contract: { columnName: 'inventoryWarehouseId', columnType: 'varchar(191)', nullable: true, defaultValue: null },
    },
    {
        tableName: 'PurchaseItem',
        contract: { columnName: 'inventoryBatchId', columnType: 'varchar(191)', nullable: true, defaultValue: null },
    },
    {
        tableName: 'PurchaseItem',
        contract: { columnName: 'inventoryUnitCostExact', columnType: 'decimal(18,6)', nullable: true, defaultValue: null },
    },
];

const phaseTwoCIndexes = [
    {
        name: PURCHASE_ITEM_INVENTORY_WAREHOUSE_INDEX,
        columns: ['inventoryWarehouseId'],
    },
    {
        name: PURCHASE_ITEM_INVENTORY_BATCH_INDEX,
        columns: ['inventoryBatchId'],
    },
] as const;

const phaseTwoCForeignKeys = [
    {
        name: PURCHASE_ITEM_INVENTORY_WAREHOUSE_FOREIGN_KEY,
        columnName: 'inventoryWarehouseId',
        referencedTableName: 'Warehouse',
    },
    {
        name: PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY,
        columnName: 'inventoryBatchId',
        referencedTableName: 'ProductBatch',
    },
] as const;

class ProcurementPhaseTwoCSchemaFake implements DeploySchemaClient {
    tables = new Set<string>(['Purchase', 'PurchaseItem']);
    columns = new Map<string, State>();
    indexes = new Map<string, State>();
    foreignKeys = new Map<string, State>();
    invalidReferences: Array<{ purchaseItemId: string; reason: string }> = [];
    duplicateRows: Array<{ duplicateCount: number | bigint }> = [];
    events: string[] = [];
    raceWins = new Set<string>();

    constructor() {
        for (const definition of phaseTwoCBaseContracts) {
            this.columns.set(`${definition.tableName}.${definition.contract.columnName}`, 'missing');
        }
        for (const index of phaseTwoCIndexes) this.indexes.set(index.name, 'missing');
        for (const foreignKey of phaseTwoCForeignKeys) this.foreignKeys.set(foreignKey.name, 'missing');
    }

    makeBaseValid(): this {
        for (const definition of phaseTwoCBaseContracts) {
            this.columns.set(`${definition.tableName}.${definition.contract.columnName}`, 'valid');
        }
        for (const index of phaseTwoCIndexes) this.indexes.set(index.name, 'valid');
        for (const foreignKey of phaseTwoCForeignKeys) this.foreignKeys.set(foreignKey.name, 'valid');
        return this;
    }

    addAllDocumentTables(): this {
        for (const table of [
            'SupplierReturn',
            'SupplierReturnItem',
            'SupplierCreditNote',
            'SupplierCreditNoteLine',
            'SupplierCreditApplication',
        ]) this.tables.add(table);
        return this;
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];
        if (text.includes('information_schema.TABLES') && text.includes('SupplierCreditApplication')) {
            return [...this.tables].map(tableName => ({ tableName })) as T;
        }
        if (text.includes('information_schema.COLUMNS')) {
            const tableName = String(values[0]);
            const rows: ProcurementPhaseTwoCColumnRow[] = [];
            for (const definition of phaseTwoCBaseContracts.filter(row => row.tableName === tableName)) {
                const state = this.columns.get(`${tableName}.${definition.contract.columnName}`);
                if (state === 'valid') rows.push(phaseTwoBColumnRow(definition.contract));
                if (state === 'invalid') {
                    rows.push(phaseTwoBColumnRow({
                        ...definition.contract,
                        nullable: !definition.contract.nullable,
                    }));
                }
            }
            return rows as T;
        }
        if (text.includes('information_schema.STATISTICS')) {
            const rows = phaseTwoCIndexes.flatMap(index => {
                const state = this.indexes.get(index.name);
                if (state === 'missing') return [];
                const exact = exactIndexRows(index.name, [...index.columns], false);
                return state === 'valid' ? exact : exact.map(row => ({ ...row, nonUnique: 0n }));
            });
            return rows as T;
        }
        if (text.includes('information_schema.REFERENTIAL_CONSTRAINTS')) {
            const rows = phaseTwoCForeignKeys.flatMap(foreignKey => {
                const state = this.foreignKeys.get(foreignKey.name);
                if (state === 'missing') return [];
                return [{
                    constraintName: foreignKey.name,
                    columnName: foreignKey.columnName,
                    referencedTableName: foreignKey.referencedTableName,
                    referencedColumnName: 'id',
                    ordinalPosition: 1n,
                    deleteRule: state === 'valid' ? 'RESTRICT' : 'CASCADE',
                    updateRule: 'CASCADE',
                }];
            });
            return rows as T;
        }
        if (text.includes('BATCH_PRODUCT_MISMATCH')) {
            this.events.push('query:safety:inventoryEvidence');
            return this.invalidReferences as T;
        }
        if (text.includes('HAVING COUNT(*) > 1')) {
            this.events.push('query:safety:duplicates');
            return this.duplicateRows as T;
        }
        throw new Error(`Query inesperada en fake 2C: ${text}`);
    }

    async execute(statement: Prisma.Sql): Promise<number> {
        const text = sqlText(statement);
        const tableName = text.match(/ALTER TABLE `([^`]+)`/)?.[1];
        const columnName = text.match(/ADD COLUMN `([^`]+)`/)?.[1];
        let action: string;
        if (tableName && columnName) {
            action = `column:${tableName}.${columnName}`;
            this.columns.set(`${tableName}.${columnName}`, 'valid');
        } else {
            const indexName = text.match(/CREATE INDEX `([^`]+)`/)?.[1];
            const foreignKeyName = text.match(/ADD CONSTRAINT `([^`]+)`/)?.[1];
            if (indexName) {
                action = `index:${indexName}`;
                this.indexes.set(indexName, 'valid');
            } else if (foreignKeyName) {
                action = `foreignKey:${foreignKeyName}`;
                this.foreignKeys.set(foreignKeyName, 'valid');
            } else {
                throw new Error(`DDL inesperado en fake 2C: ${text}`);
            }
        }
        this.events.push(`execute:${action}`);
        if (this.raceWins.has(action)) throw new Error(`otro iniciador ganó ${action}`);
        return 0;
    }
}

describe('Procurement Fase 2C deploy schema preflight', () => {
    it('valida columnas, índices y FKs con el contrato exacto', () => {
        const decimal = phaseTwoCBaseContracts.at(-1)!.contract;
        const row = phaseTwoBColumnRow(decimal);
        expect(inspectProcurementPhaseTwoCColumn([row], decimal)).toBe('valid');
        expect(inspectProcurementPhaseTwoCColumn(
            [{ ...row, columnType: 'decimal(12,2)' }],
            decimal,
        )).toBe('invalid');

        const index = exactIndexRows(PURCHASE_ITEM_INVENTORY_BATCH_INDEX, ['inventoryBatchId'], false);
        expect(inspectProcurementPhaseTwoCIndex(
            index,
            PURCHASE_ITEM_INVENTORY_BATCH_INDEX,
            ['inventoryBatchId'],
            false,
        )).toBe('valid');
        expect(inspectProcurementPhaseTwoCForeignKey([{
            constraintName: PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY,
            columnName: 'inventoryBatchId',
            referencedTableName: 'ProductBatch',
            referencedColumnName: 'id',
            ordinalPosition: 1n,
            deleteRule: 'RESTRICT',
            updateRule: 'CASCADE',
        }], {
            constraintName: PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY,
            columnName: 'inventoryBatchId',
            referencedTableName: 'ProductBatch',
            deleteRule: 'RESTRICT',
        })).toBe('valid');
    });

    it('converge el histórico con DDL expand-only y es idempotente', async () => {
        const db = new ProcurementPhaseTwoCSchemaFake();

        await applyProcurementPhaseTwoCSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events.filter(event => event.startsWith('execute:'))).toEqual([
            'execute:column:Purchase.settledAt',
            'execute:column:PurchaseItem.inventoryWarehouseId',
            'execute:column:PurchaseItem.inventoryBatchId',
            'execute:column:PurchaseItem.inventoryUnitCostExact',
            `execute:index:${PURCHASE_ITEM_INVENTORY_WAREHOUSE_INDEX}`,
            `execute:index:${PURCHASE_ITEM_INVENTORY_BATCH_INDEX}`,
            `execute:foreignKey:${PURCHASE_ITEM_INVENTORY_WAREHOUSE_FOREIGN_KEY}`,
            `execute:foreignKey:${PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY}`,
        ]);
        const before = db.events.length;
        await applyProcurementPhaseTwoCSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });
        expect(db.events.slice(before).some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('tolera carreras solo cuando la relectura confirma cada objeto exacto', async () => {
        const db = new ProcurementPhaseTwoCSchemaFake();
        for (const action of [
            'column:Purchase.settledAt',
            'column:PurchaseItem.inventoryWarehouseId',
            'column:PurchaseItem.inventoryBatchId',
            'column:PurchaseItem.inventoryUnitCostExact',
            `index:${PURCHASE_ITEM_INVENTORY_WAREHOUSE_INDEX}`,
            `index:${PURCHASE_ITEM_INVENTORY_BATCH_INDEX}`,
            `foreignKey:${PURCHASE_ITEM_INVENTORY_WAREHOUSE_FOREIGN_KEY}`,
            `foreignKey:${PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY}`,
        ]) db.raceWins.add(action);
        const warn = vi.fn();

        await applyProcurementPhaseTwoCSchemaPreflight(db, { info: vi.fn(), warn });

        expect(warn).toHaveBeenCalledTimes(8);
    });

    it('falla cerrado ante evidencia cross-tenant antes de crear FKs', async () => {
        const db = new ProcurementPhaseTwoCSchemaFake().makeBaseValid();
        db.foreignKeys.set(PURCHASE_ITEM_INVENTORY_WAREHOUSE_FOREIGN_KEY, 'missing');
        db.foreignKeys.set(PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY, 'missing');
        db.invalidReferences = [{ purchaseItemId: 'item-a', reason: 'CROSS_TENANT_WAREHOUSE' }];

        await expect(applyProcurementPhaseTwoCSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('cross-tenant');
        expect(db.events.some(event => event.startsWith('execute:foreignKey'))).toBe(false);
    });

    it('falla cerrado ante una tabla documental parcial', async () => {
        const db = new ProcurementPhaseTwoCSchemaFake().makeBaseValid();
        db.tables.add('SupplierReturn');

        await expect(applyProcurementPhaseTwoCSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('está parcial');
    });

    it('falla cerrado ante duplicados antes de validar o reparar tablas documentales', async () => {
        const db = new ProcurementPhaseTwoCSchemaFake().makeBaseValid().addAllDocumentTables();
        db.duplicateRows = [{ duplicateCount: 2n }];

        await expect(applyProcurementPhaseTwoCSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('duplicados incompatibles');
        expect(db.events.some(event => event.startsWith('execute:'))).toBe(false);
    });

    it('deja el CREATE TABLE completo a db push en una instalación vacía', async () => {
        const db = new ProcurementPhaseTwoCSchemaFake();
        db.tables.clear();
        const info = vi.fn();

        await applyProcurementPhaseTwoCSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('instalación vacía'));
    });

    it('conserva los nombres congelados de idempotencia y uso físico único', () => {
        expect(SUPPLIER_RETURN_EVENT_UNIQUE_INDEX).toBe('SupplierReturn_tenantId_clientEventId_key');
        expect(SUPPLIER_CREDIT_NOTE_LINE_RETURN_ITEM_UNIQUE_INDEX)
            .toBe('SupplierCreditNoteLine_supplierReturnItemId_key');
    });
});

const pharmacyBaseContracts: Array<{
    tableName: 'Tenant' | 'ProductBatchWarehouseStock';
    contract: PharmacyInventoryColumnContract;
}> = [
    {
        tableName: 'Tenant',
        contract: {
            columnName: 'pharmacyInventoryMode',
            columnType: 'varchar(16)',
            nullable: false,
            defaultValue: 'OFF',
        },
    },
    {
        tableName: 'Tenant',
        contract: {
            columnName: 'pharmacyInventoryActivatedAt',
            columnType: 'datetime(3)',
            nullable: true,
            defaultValue: null,
        },
    },
    {
        tableName: 'ProductBatchWarehouseStock',
        contract: {
            columnName: 'heldStock',
            columnType: 'decimal(18,4)',
            nullable: false,
            defaultValue: '0.0000',
        },
    },
];

const pharmacyHoldColumns: PharmacyInventoryColumnContract[] = [
    { columnName: 'id', columnType: 'varchar(191)', nullable: false, defaultValue: null },
    { columnName: 'tenantId', columnType: 'varchar(191)', nullable: false, defaultValue: null },
    { columnName: 'productId', columnType: 'varchar(191)', nullable: false, defaultValue: null },
    { columnName: 'batchId', columnType: 'varchar(191)', nullable: false, defaultValue: null },
    { columnName: 'warehouseId', columnType: 'varchar(191)', nullable: false, defaultValue: null },
    { columnName: 'quantityDelta', columnType: 'decimal(18,4)', nullable: false, defaultValue: null },
    { columnName: 'heldBefore', columnType: 'decimal(18,4)', nullable: false, defaultValue: null },
    { columnName: 'heldAfter', columnType: 'decimal(18,4)', nullable: false, defaultValue: null },
    { columnName: 'physicalStockSnapshot', columnType: 'decimal(18,4)', nullable: false, defaultValue: null },
    { columnName: 'sellableBefore', columnType: 'decimal(18,4)', nullable: false, defaultValue: null },
    { columnName: 'sellableAfter', columnType: 'decimal(18,4)', nullable: false, defaultValue: null },
    { columnName: 'holdReasonCode', columnType: 'varchar(32)', nullable: false, defaultValue: null },
    { columnName: 'referenceId', columnType: 'varchar(191)', nullable: true, defaultValue: null },
    { columnName: 'referenceType', columnType: 'varchar(64)', nullable: true, defaultValue: null },
    { columnName: 'sourceKey', columnType: 'varchar(191)', nullable: false, defaultValue: null },
    { columnName: 'payloadHash', columnType: 'varchar(64)', nullable: false, defaultValue: null },
    { columnName: 'notes', columnType: 'text', nullable: true, defaultValue: null },
    { columnName: 'userId', columnType: 'varchar(191)', nullable: false, defaultValue: null },
    {
        columnName: 'createdAt',
        columnType: 'datetime(3)',
        nullable: false,
        defaultValue: 'current_timestamp(3)',
        extra: 'DEFAULT_GENERATED',
    },
];

const pharmacyHoldIndexes = [
    { name: 'PRIMARY', columns: ['id'], unique: true },
    {
        name: PRODUCT_BATCH_HOLD_SOURCE_UNIQUE_INDEX,
        columns: ['tenantId', 'sourceKey'],
        unique: true,
    },
    {
        name: 'ProductBatchHold_tenantId_createdAt_idx',
        columns: ['tenantId', 'createdAt'],
        unique: false,
    },
    {
        name: 'ProductBatchHold_tenantId_batchId_warehouseId_createdAt_idx',
        columns: ['tenantId', 'batchId', 'warehouseId', 'createdAt'],
        unique: false,
    },
    {
        name: 'ProductBatchHold_tenantId_productId_warehouseId_createdAt_idx',
        columns: ['tenantId', 'productId', 'warehouseId', 'createdAt'],
        unique: false,
    },
    {
        name: 'ProductBatchHold_tenantId_referenceType_referenceId_idx',
        columns: ['tenantId', 'referenceType', 'referenceId'],
        unique: false,
    },
    { name: 'ProductBatchHold_userId_idx', columns: ['userId'], unique: false },
] as const;

const pharmacyHoldForeignKeys = [
    {
        name: 'ProductBatchHold_tenantId_fkey',
        columnName: 'tenantId',
        referencedTableName: 'Tenant',
        deleteRule: 'CASCADE',
    },
    {
        name: 'ProductBatchHold_productId_fkey',
        columnName: 'productId',
        referencedTableName: 'Product',
        deleteRule: 'RESTRICT',
    },
    {
        name: 'ProductBatchHold_batchId_fkey',
        columnName: 'batchId',
        referencedTableName: 'ProductBatch',
        deleteRule: 'RESTRICT',
    },
    {
        name: 'ProductBatchHold_warehouseId_fkey',
        columnName: 'warehouseId',
        referencedTableName: 'Warehouse',
        deleteRule: 'RESTRICT',
    },
    {
        name: 'ProductBatchHold_userId_fkey',
        columnName: 'userId',
        referencedTableName: 'User',
        deleteRule: 'RESTRICT',
    },
] as const;

class PharmacyInventorySchemaFake implements DeploySchemaClient {
    tables = new Set<string>(['Tenant', 'ProductBatchWarehouseStock']);
    baseColumns = new Map<string, State>();
    missingHoldColumn: string | null = null;
    invalidHoldColumn: string | null = null;
    invalidHoldIndex: string | null = null;
    missingHoldIndex: string | null = null;
    invalidHoldForeignKey: string | null = null;
    missingHoldForeignKey: string | null = null;
    events: string[] = [];
    raceWins = new Set<string>();
    hardFailures = new Set<string>();

    constructor() {
        for (const definition of pharmacyBaseContracts) {
            this.baseColumns.set(`${definition.tableName}.${definition.contract.columnName}`, 'missing');
        }
    }

    makeBaseValid(): this {
        for (const definition of pharmacyBaseContracts) {
            this.baseColumns.set(`${definition.tableName}.${definition.contract.columnName}`, 'valid');
        }
        return this;
    }

    addHoldTable(): this {
        this.tables.add('ProductBatchHold');
        return this;
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];
        if (text.includes('information_schema.TABLES') && text.includes('ProductBatchHold')) {
            return [...this.tables].map(tableName => ({ tableName })) as T;
        }
        if (text.includes('information_schema.COLUMNS')) {
            const tableName = String(values[0]);
            if (tableName === 'ProductBatchHold') {
                return pharmacyHoldColumns.flatMap(contract => {
                    if (contract.columnName === this.missingHoldColumn) return [];
                    const effective = contract.columnName === this.invalidHoldColumn
                        ? { ...contract, nullable: !contract.nullable }
                        : contract;
                    return [phaseTwoBColumnRow(effective)];
                }) as T;
            }
            return pharmacyBaseContracts
                .filter(definition => definition.tableName === tableName)
                .flatMap(definition => {
                    const state = this.baseColumns.get(`${tableName}.${definition.contract.columnName}`);
                    if (state === 'missing') return [];
                    const effective = state === 'invalid'
                        ? { ...definition.contract, nullable: !definition.contract.nullable }
                        : definition.contract;
                    return [phaseTwoBColumnRow(effective)];
                }) as T;
        }
        if (text.includes('information_schema.STATISTICS')) {
            return pharmacyHoldIndexes.flatMap(index => {
                if (index.name === this.missingHoldIndex) return [];
                const rows = exactIndexRows(index.name, [...index.columns], index.unique);
                return index.name === this.invalidHoldIndex
                    ? rows.map(row => ({ ...row, isVisible: 'NO' }))
                    : rows;
            }) as T;
        }
        if (text.includes('information_schema.REFERENTIAL_CONSTRAINTS')) {
            return pharmacyHoldForeignKeys.flatMap(foreignKey => {
                if (foreignKey.name === this.missingHoldForeignKey) return [];
                return [{
                    constraintName: foreignKey.name,
                    columnName: foreignKey.columnName,
                    referencedTableName: foreignKey.referencedTableName,
                    referencedColumnName: 'id',
                    ordinalPosition: 1n,
                    deleteRule: foreignKey.name === this.invalidHoldForeignKey
                        ? (foreignKey.deleteRule === 'CASCADE' ? 'RESTRICT' : 'CASCADE')
                        : foreignKey.deleteRule,
                    updateRule: 'CASCADE',
                }];
            }) as T;
        }
        throw new Error(`Query inesperada en fake farmacia: ${text}`);
    }

    async execute(statement: Prisma.Sql): Promise<number> {
        const text = sqlText(statement);
        const tableName = text.match(/ALTER TABLE `([^`]+)`/)?.[1];
        const columnName = text.match(/ADD COLUMN `([^`]+)`/)?.[1];
        if (!tableName || !columnName) throw new Error(`DDL inesperado en fake farmacia: ${text}`);
        const action = `column:${tableName}.${columnName}`;
        this.events.push(`execute:${action}`);
        if (this.hardFailures.has(action)) throw new Error(`fallo ${action}`);
        this.baseColumns.set(`${tableName}.${columnName}`, 'valid');
        if (this.raceWins.has(action)) throw new Error(`otro iniciador ganó ${action}`);
        return 0;
    }
}

describe('Farmacia Bloque 0 deploy schema preflight', () => {
    it('valida tipos, defaults, índices y FKs con el contrato exacto de MySQL', () => {
        const heldStock = pharmacyBaseContracts[2].contract;
        const heldStockRow = phaseTwoBColumnRow(heldStock);
        expect(inspectPharmacyInventoryColumn([heldStockRow], heldStock)).toBe('valid');
        expect(inspectPharmacyInventoryColumn(
            [{ ...heldStockRow, columnDefault: null }],
            heldStock,
        )).toBe('invalid');

        const sourceIndex = exactIndexRows(
            PRODUCT_BATCH_HOLD_SOURCE_UNIQUE_INDEX,
            ['tenantId', 'sourceKey'],
            true,
        );
        expect(inspectPharmacyInventoryIndex(
            sourceIndex,
            PRODUCT_BATCH_HOLD_SOURCE_UNIQUE_INDEX,
            ['tenantId', 'sourceKey'],
            true,
        )).toBe('valid');
        expect(inspectPharmacyInventoryForeignKey([{
            constraintName: 'ProductBatchHold_tenantId_fkey',
            columnName: 'tenantId',
            referencedTableName: 'Tenant',
            referencedColumnName: 'id',
            ordinalPosition: 1n,
            deleteRule: 'CASCADE',
            updateRule: 'CASCADE',
        }], {
            constraintName: 'ProductBatchHold_tenantId_fkey',
            columnName: 'tenantId',
            referencedTableName: 'Tenant',
            deleteRule: 'CASCADE',
        })).toBe('valid');
    });

    it('converge solo las columnas históricas con defaults inertes y es idempotente', async () => {
        const db = new PharmacyInventorySchemaFake();

        await applyPharmacyInventorySchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events).toEqual([
            'execute:column:Tenant.pharmacyInventoryMode',
            'execute:column:Tenant.pharmacyInventoryActivatedAt',
            'execute:column:ProductBatchWarehouseStock.heldStock',
        ]);
        expect(db.events.some(event => /ENFORCED|UPDATE|INSERT/.test(event))).toBe(false);

        const before = db.events.length;
        await applyPharmacyInventorySchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });
        expect(db.events.slice(before)).toEqual([]);
    });

    it('tolera carreras solo cuando la relectura confirma las tres columnas exactas', async () => {
        const db = new PharmacyInventorySchemaFake();
        for (const action of [
            'column:Tenant.pharmacyInventoryMode',
            'column:Tenant.pharmacyInventoryActivatedAt',
            'column:ProductBatchWarehouseStock.heldStock',
        ]) db.raceWins.add(action);
        const warn = vi.fn();

        await applyPharmacyInventorySchemaPreflight(db, { info: vi.fn(), warn });

        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('propaga el error DDL cuando la carrera no dejó el objeto exacto', async () => {
        const db = new PharmacyInventorySchemaFake();
        db.hardFailures.add('column:ProductBatchWarehouseStock.heldStock');

        await expect(applyPharmacyInventorySchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo column:ProductBatchWarehouseStock.heldStock');
        expect(db.baseColumns.get('ProductBatchWarehouseStock.heldStock')).toBe('missing');
    });

    it('falla cerrado ante una columna histórica incompatible sin intentar repararla', async () => {
        const db = new PharmacyInventorySchemaFake().makeBaseValid();
        db.baseColumns.set('Tenant.pharmacyInventoryMode', 'invalid');

        await expect(applyPharmacyInventorySchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('Tenant.pharmacyInventoryMode');
        expect(db.events).toEqual([]);
    });

    it('delega el CREATE TABLE nuevo y atómico a db push cuando ProductBatchHold no existe', async () => {
        const db = new PharmacyInventorySchemaFake().makeBaseValid();
        const info = vi.fn();

        await applyPharmacyInventorySchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('sin DML ni activaciones'));
    });

    it('acepta ProductBatchHold solo cuando columnas, índices y FKs están completos', async () => {
        const db = new PharmacyInventorySchemaFake().makeBaseValid().addHoldTable();

        await applyPharmacyInventorySchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events).toEqual([]);
    });

    it.each([
        [
            'columna faltante',
            (db: PharmacyInventorySchemaFake) => { db.missingHoldColumn = 'sellableAfter'; },
            'ProductBatchHold.sellableAfter',
        ],
        [
            'índice incompatible',
            (db: PharmacyInventorySchemaFake) => {
                db.invalidHoldIndex = PRODUCT_BATCH_HOLD_SOURCE_UNIQUE_INDEX;
            },
            PRODUCT_BATCH_HOLD_SOURCE_UNIQUE_INDEX,
        ],
        [
            'FK faltante',
            (db: PharmacyInventorySchemaFake) => {
                db.missingHoldForeignKey = 'ProductBatchHold_warehouseId_fkey';
            },
            'ProductBatchHold_warehouseId_fkey',
        ],
    ])('falla cerrado ante ProductBatchHold parcial: %s', async (_label, arrange, expected) => {
        const db = new PharmacyInventorySchemaFake().makeBaseValid().addHoldTable();
        arrange(db);

        await expect(applyPharmacyInventorySchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(expected);
        expect(db.events).toEqual([]);
    });

    it('falla cerrado si ProductBatchHold aparece sin su proyección lote+bodega', async () => {
        const db = new PharmacyInventorySchemaFake().makeBaseValid().addHoldTable();
        db.tables.delete('ProductBatchWarehouseStock');

        await expect(applyPharmacyInventorySchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('sin ProductBatchWarehouseStock');
        expect(db.events).toEqual([]);
    });
});
