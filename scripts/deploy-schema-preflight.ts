import { Prisma } from '@prisma/client';

export const UNSAFE_SCHEMA_STATE_EXIT_CODE = 42;
export const WAREHOUSE_SELLER_INDEX = 'Warehouse_tenantId_sellerId_key';
export const STOCK_COUNT_OPEN_WAREHOUSE_INDEX = 'StockCount_openWarehouseKey_key';
export const STOCK_COUNT_WAREHOUSE_INDEX = 'StockCount_warehouseId_idx';
export const STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX = 'StockCount_tenantId_warehouseId_status_idx';
export const STOCK_COUNT_WAREHOUSE_FOREIGN_KEY = 'StockCount_warehouseId_fkey';

// Identificadores internos y constantes: nunca contienen entrada del usuario.
const WAREHOUSE_TABLE_SQL = Prisma.raw('`Warehouse`');
const USER_TABLE_SQL = Prisma.raw('`User`');
const SELLER_ID_COLUMN_SQL = Prisma.raw('`sellerId`');
const TENANT_ID_COLUMN_SQL = Prisma.raw('`tenantId`');
const WAREHOUSE_SELLER_INDEX_SQL = Prisma.raw('`Warehouse_tenantId_sellerId_key`');
const STOCK_COUNT_TABLE_SQL = Prisma.raw('`StockCount`');
const WAREHOUSE_ID_COLUMN_SQL = Prisma.raw('`warehouseId`');
const ID_COLUMN_SQL = Prisma.raw('`id`');
const OPEN_WAREHOUSE_KEY_COLUMN_SQL = Prisma.raw('`openWarehouseKey`');
const STATUS_COLUMN_SQL = Prisma.raw('`status`');
const STOCK_COUNT_OPEN_WAREHOUSE_INDEX_SQL = Prisma.raw('`StockCount_openWarehouseKey_key`');
const STOCK_COUNT_WAREHOUSE_INDEX_SQL = Prisma.raw('`StockCount_warehouseId_idx`');
const STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX_SQL = Prisma.raw('`StockCount_tenantId_warehouseId_status_idx`');
const STOCK_COUNT_WAREHOUSE_FOREIGN_KEY_SQL = Prisma.raw('`StockCount_warehouseId_fkey`');

export class UnsafeSchemaStateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsafeSchemaStateError';
    }
}

export interface DeploySchemaClient {
    query<T>(statement: Prisma.Sql): Promise<T>;
    execute(statement: Prisma.Sql): Promise<number>;
}

export interface DeploySchemaLogger {
    info(message: string): void;
    warn(message: string): void;
}

export interface WarehouseSellerColumnRow {
    dataType: string;
    columnType: string;
    isNullable: string;
    characterMaximumLength: number | bigint | null;
    characterSetName: string | null;
    collationName: string | null;
    columnDefault: string | null;
    extra: string;
    generationExpression: string;
}

export interface WarehouseSellerIndexRow {
    indexName: string;
    nonUnique: number | bigint;
    seqInIndex: number | bigint;
    columnName: string;
    subPart: number | bigint | null;
    indexType: string;
    isVisible: string;
    collation: string | null;
    expression: string | null;
}

export type StockCountColumnRow = WarehouseSellerColumnRow;
export type StockCountIndexRow = WarehouseSellerIndexRow;

export interface StockCountForeignKeyRow {
    constraintName: string;
    columnName: string;
    referencedTableName: string;
    referencedColumnName: string;
    ordinalPosition: number | bigint;
    deleteRule: string;
    updateRule: string;
}

interface DuplicateAssignmentRow {
    tenantId: string;
    sellerId: string;
    duplicateCount: number | bigint;
}

interface InvalidSellerRow {
    warehouseId: string;
    tenantId: string;
    sellerId: string;
    reason: 'MISSING_USER' | 'CROSS_TENANT';
}

interface DuplicateOpenWarehouseRow {
    openWarehouseKey: string;
    duplicateCount: number | bigint;
}

interface InvalidStockCountWarehouseRow {
    stockCountId: string;
    tenantId: string;
    warehouseId: string;
    reason: 'MISSING_WAREHOUSE' | 'CROSS_TENANT';
}

interface InvalidOpenWarehouseKeyRow {
    stockCountId: string;
    status: string;
    warehouseId: string | null;
    openWarehouseKey: string;
    reason: 'MISSING_WAREHOUSE_ID' | 'KEY_MISMATCH' | 'INACTIVE_COUNT';
}

export type SchemaObjectState = 'missing' | 'valid' | 'invalid';

export function inspectWarehouseSellerColumn(rows: WarehouseSellerColumnRow[]): SchemaObjectState {
    if (rows.length === 0) return 'missing';
    if (rows.length !== 1) return 'invalid';

    const [column] = rows;
    return column.dataType.toLowerCase() === 'varchar'
        && column.columnType.toLowerCase() === 'varchar(191)'
        && column.isNullable.toUpperCase() === 'YES'
        && Number(column.characterMaximumLength) === 191
        && column.columnDefault === null
        && column.extra === ''
        && column.generationExpression === ''
        ? 'valid'
        : 'invalid';
}

export const inspectStockCountNullableIdColumn = inspectWarehouseSellerColumn;

function columnsUseSameEncoding(
    sellerRows: WarehouseSellerColumnRow[],
    userIdRows: WarehouseSellerColumnRow[],
): boolean {
    if (sellerRows.length !== 1 || userIdRows.length !== 1) return false;
    return sellerRows[0].characterSetName === userIdRows[0].characterSetName
        && sellerRows[0].collationName === userIdRows[0].collationName;
}

export function inspectWarehouseSellerIndex(rows: WarehouseSellerIndexRow[]): SchemaObjectState {
    if (rows.length === 0) return 'missing';
    if (rows.length !== 2) return 'invalid';

    const ordered = [...rows].sort((a, b) => Number(a.seqInIndex) - Number(b.seqInIndex));
    const expectedColumns = ['tenantId', 'sellerId'];
    const valid = ordered.every((row, index) => (
        row.indexName === WAREHOUSE_SELLER_INDEX
        && Number(row.nonUnique) === 0
        && Number(row.seqInIndex) === index + 1
        && row.columnName === expectedColumns[index]
        && row.subPart === null
        && row.indexType.toUpperCase() === 'BTREE'
        && row.isVisible.toUpperCase() === 'YES'
        && row.collation === 'A'
        && row.expression === null
    ));

    return valid ? 'valid' : 'invalid';
}

function inspectExactIndex(
    rows: StockCountIndexRow[],
    expectedName: string,
    expectedColumns: string[],
    unique: boolean,
): SchemaObjectState {
    if (rows.length === 0) return 'missing';
    if (rows.length !== expectedColumns.length) return 'invalid';

    const ordered = [...rows].sort((a, b) => Number(a.seqInIndex) - Number(b.seqInIndex));
    const valid = ordered.every((row, index) => (
        row.indexName === expectedName
        && Number(row.nonUnique) === (unique ? 0 : 1)
        && Number(row.seqInIndex) === index + 1
        && row.columnName === expectedColumns[index]
        && row.subPart === null
        && row.indexType.toUpperCase() === 'BTREE'
        && row.isVisible.toUpperCase() === 'YES'
        && row.collation === 'A'
        && row.expression === null
    ));

    return valid ? 'valid' : 'invalid';
}

export function inspectStockCountOpenWarehouseIndex(rows: StockCountIndexRow[]): SchemaObjectState {
    return inspectExactIndex(rows, STOCK_COUNT_OPEN_WAREHOUSE_INDEX, ['openWarehouseKey'], true);
}

export function inspectStockCountWarehouseIndex(rows: StockCountIndexRow[]): SchemaObjectState {
    return inspectExactIndex(rows, STOCK_COUNT_WAREHOUSE_INDEX, ['warehouseId'], false);
}

export function inspectStockCountTenantWarehouseStatusIndex(rows: StockCountIndexRow[]): SchemaObjectState {
    return inspectExactIndex(
        rows,
        STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
        ['tenantId', 'warehouseId', 'status'],
        false,
    );
}

export function inspectStockCountWarehouseForeignKey(rows: StockCountForeignKeyRow[]): SchemaObjectState {
    if (rows.length === 0) return 'missing';
    if (rows.length !== 1) return 'invalid';

    const [row] = rows;
    return row.constraintName === STOCK_COUNT_WAREHOUSE_FOREIGN_KEY
        && row.columnName === 'warehouseId'
        && row.referencedTableName === 'Warehouse'
        && row.referencedColumnName === 'id'
        && Number(row.ordinalPosition) === 1
        && row.deleteRule.toUpperCase() === 'RESTRICT'
        && row.updateRule.toUpperCase() === 'CASCADE'
        ? 'valid'
        : 'invalid';
}

async function readSellerColumn(db: DeploySchemaClient): Promise<WarehouseSellerColumnRow[]> {
    return db.query<WarehouseSellerColumnRow[]>(Prisma.sql`
        SELECT
            DATA_TYPE AS dataType,
            COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable,
            CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
            CHARACTER_SET_NAME AS characterSetName,
            COLLATION_NAME AS collationName,
            COLUMN_DEFAULT AS columnDefault,
            EXTRA AS extra,
            GENERATION_EXPRESSION AS generationExpression
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'Warehouse'
          AND COLUMN_NAME = 'sellerId'
    `);
}

async function readUserIdColumn(db: DeploySchemaClient): Promise<WarehouseSellerColumnRow[]> {
    return db.query<WarehouseSellerColumnRow[]>(Prisma.sql`
        SELECT
            DATA_TYPE AS dataType,
            COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable,
            CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
            CHARACTER_SET_NAME AS characterSetName,
            COLLATION_NAME AS collationName,
            COLUMN_DEFAULT AS columnDefault,
            EXTRA AS extra,
            GENERATION_EXPRESSION AS generationExpression
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'User'
          AND COLUMN_NAME = 'id'
    `);
}

async function warehouseTableExists(db: DeploySchemaClient): Promise<boolean> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'Warehouse'
        LIMIT 1
    `);
    return rows.length === 1;
}

async function stockCountTableExists(db: DeploySchemaClient): Promise<boolean> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'StockCount'
        LIMIT 1
    `);
    return rows.length === 1;
}

async function readSellerIndex(db: DeploySchemaClient): Promise<WarehouseSellerIndexRow[]> {
    return db.query<WarehouseSellerIndexRow[]>(Prisma.sql`
        SELECT
            INDEX_NAME AS indexName,
            NON_UNIQUE AS nonUnique,
            SEQ_IN_INDEX AS seqInIndex,
            COLUMN_NAME AS columnName,
            SUB_PART AS subPart,
            INDEX_TYPE AS indexType,
            IS_VISIBLE AS isVisible,
            COLLATION AS collation,
            EXPRESSION AS expression
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'Warehouse'
          AND INDEX_NAME = 'Warehouse_tenantId_sellerId_key'
        ORDER BY SEQ_IN_INDEX
    `);
}

async function readStockCountColumn(
    db: DeploySchemaClient,
    columnName: 'warehouseId' | 'openWarehouseKey',
): Promise<StockCountColumnRow[]> {
    if (columnName === 'warehouseId') {
        return db.query<StockCountColumnRow[]>(Prisma.sql`
            SELECT
                DATA_TYPE AS dataType,
                COLUMN_TYPE AS columnType,
                IS_NULLABLE AS isNullable,
                CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
                CHARACTER_SET_NAME AS characterSetName,
                COLLATION_NAME AS collationName,
                COLUMN_DEFAULT AS columnDefault,
                EXTRA AS extra,
                GENERATION_EXPRESSION AS generationExpression
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'StockCount'
              AND COLUMN_NAME = 'warehouseId'
        `);
    }

    return db.query<StockCountColumnRow[]>(Prisma.sql`
        SELECT
            DATA_TYPE AS dataType,
            COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable,
            CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
            CHARACTER_SET_NAME AS characterSetName,
            COLLATION_NAME AS collationName,
            COLUMN_DEFAULT AS columnDefault,
            EXTRA AS extra,
            GENERATION_EXPRESSION AS generationExpression
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'StockCount'
          AND COLUMN_NAME = 'openWarehouseKey'
    `);
}

async function readWarehouseIdColumn(db: DeploySchemaClient): Promise<WarehouseSellerColumnRow[]> {
    return db.query<WarehouseSellerColumnRow[]>(Prisma.sql`
        SELECT
            DATA_TYPE AS dataType,
            COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable,
            CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
            CHARACTER_SET_NAME AS characterSetName,
            COLLATION_NAME AS collationName,
            COLUMN_DEFAULT AS columnDefault,
            EXTRA AS extra,
            GENERATION_EXPRESSION AS generationExpression
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'Warehouse'
          AND COLUMN_NAME = 'id'
    `);
}

async function readStockCountIndex(
    db: DeploySchemaClient,
    indexName: typeof STOCK_COUNT_OPEN_WAREHOUSE_INDEX
        | typeof STOCK_COUNT_WAREHOUSE_INDEX
        | typeof STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
): Promise<StockCountIndexRow[]> {
    return db.query<StockCountIndexRow[]>(Prisma.sql`
        SELECT
            INDEX_NAME AS indexName,
            NON_UNIQUE AS nonUnique,
            SEQ_IN_INDEX AS seqInIndex,
            COLUMN_NAME AS columnName,
            SUB_PART AS subPart,
            INDEX_TYPE AS indexType,
            IS_VISIBLE AS isVisible,
            COLLATION AS collation,
            EXPRESSION AS expression
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'StockCount'
          AND INDEX_NAME = ${indexName}
        ORDER BY SEQ_IN_INDEX
    `);
}

async function readStockCountWarehouseForeignKey(
    db: DeploySchemaClient,
): Promise<StockCountForeignKeyRow[]> {
    return db.query<StockCountForeignKeyRow[]>(Prisma.sql`
        SELECT
            rc.CONSTRAINT_NAME AS constraintName,
            kcu.COLUMN_NAME AS columnName,
            kcu.REFERENCED_TABLE_NAME AS referencedTableName,
            kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
            kcu.ORDINAL_POSITION AS ordinalPosition,
            rc.DELETE_RULE AS deleteRule,
            rc.UPDATE_RULE AS updateRule
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        INNER JOIN information_schema.KEY_COLUMN_USAGE kcu
          ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
         AND kcu.TABLE_NAME = rc.TABLE_NAME
         AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
          AND rc.TABLE_NAME = 'StockCount'
          AND (
            rc.CONSTRAINT_NAME = 'StockCount_warehouseId_fkey'
            OR kcu.COLUMN_NAME = 'warehouseId'
          )
        ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `);
}

async function assertAssignmentsAreSafe(db: DeploySchemaClient): Promise<void> {
    const duplicates = await db.query<DuplicateAssignmentRow[]>(Prisma.sql`
        SELECT tenantId, sellerId, COUNT(*) AS duplicateCount
        FROM ${WAREHOUSE_TABLE_SQL}
        WHERE sellerId IS NOT NULL
        GROUP BY tenantId, sellerId
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length > 0) {
        const detail = duplicates
            .map(row => `${row.tenantId}/${row.sellerId} (${String(row.duplicateCount)})`)
            .join(', ');
        throw new UnsafeSchemaStateError(
            `Hay asignaciones de carga duplicadas; no se creará el índice único: ${detail}`,
        );
    }

    const invalidSellers = await db.query<InvalidSellerRow[]>(Prisma.sql`
        SELECT
            w.id AS warehouseId,
            w.tenantId,
            w.sellerId,
            CASE WHEN u.id IS NULL THEN 'MISSING_USER' ELSE 'CROSS_TENANT' END AS reason
        FROM ${WAREHOUSE_TABLE_SQL} w
        LEFT JOIN ${USER_TABLE_SQL} u ON u.id = w.sellerId
        WHERE w.sellerId IS NOT NULL
          AND (u.id IS NULL OR u.tenantId <> w.tenantId)
        LIMIT 10
    `);

    if (invalidSellers.length > 0) {
        const detail = invalidSellers
            .map(row => `${row.warehouseId}/${row.sellerId} (${row.reason})`)
            .join(', ');
        throw new UnsafeSchemaStateError(
            `Hay cargas con vendedor inexistente o de otro tenant; no se continuará: ${detail}`,
        );
    }
}

async function ensureSellerColumn(db: DeploySchemaClient, logger: DeploySchemaLogger): Promise<void> {
    const initialState = inspectWarehouseSellerColumn(await readSellerColumn(db));
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            'Warehouse.sellerId existe con una definición incompatible; se requiere intervención manual.',
        );
    }

    if (initialState === 'missing') {
        logger.info('Aplicando DDL seguro: Warehouse.sellerId VARCHAR(191) NULL.');
        try {
            await db.execute(Prisma.sql`
                ALTER TABLE ${WAREHOUSE_TABLE_SQL}
                ADD COLUMN ${SELLER_ID_COLUMN_SQL} VARCHAR(191) NULL
            `);
        } catch (error) {
            // Otro contenedor puede haber ganado la carrera. Nunca asumimos éxito:
            // information_schema debe confirmar la definición exacta.
            if (inspectWarehouseSellerColumn(await readSellerColumn(db)) !== 'valid') throw error;
            logger.warn('Warehouse.sellerId fue creado concurrentemente; definición verificada.');
        }
    }

    if (inspectWarehouseSellerColumn(await readSellerColumn(db)) !== 'valid') {
        throw new UnsafeSchemaStateError(
            'No se pudo verificar la definición final de Warehouse.sellerId.',
        );
    }

    const sellerColumn = await readSellerColumn(db);
    const userIdColumn = await readUserIdColumn(db);
    if (!columnsUseSameEncoding(sellerColumn, userIdColumn)) {
        throw new UnsafeSchemaStateError(
            'Warehouse.sellerId no usa el mismo charset/collation que User.id.',
        );
    }
}

async function ensureSellerUniqueIndex(db: DeploySchemaClient, logger: DeploySchemaLogger): Promise<void> {
    const initialState = inspectWarehouseSellerIndex(await readSellerIndex(db));
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${WAREHOUSE_SELLER_INDEX} existe con columnas u opciones incompatibles.`,
        );
    }

    if (initialState === 'missing') {
        logger.info(`Aplicando DDL seguro: índice único ${WAREHOUSE_SELLER_INDEX}.`);
        try {
            await db.execute(Prisma.sql`
                CREATE UNIQUE INDEX ${WAREHOUSE_SELLER_INDEX_SQL}
                ON ${WAREHOUSE_TABLE_SQL}(${TENANT_ID_COLUMN_SQL}, ${SELLER_ID_COLUMN_SQL})
            `);
        } catch (error) {
            // CREATE UNIQUE INDEX puede competir con otro inicio. Releer es la
            // única confirmación válida; si sigue ausente, el error se propaga.
            if (inspectWarehouseSellerIndex(await readSellerIndex(db)) !== 'valid') {
                await assertAssignmentsAreSafe(db);
                throw error;
            }
            logger.warn(`${WAREHOUSE_SELLER_INDEX} fue creado concurrentemente; definición verificada.`);
        }
    }

    if (inspectWarehouseSellerIndex(await readSellerIndex(db)) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${WAREHOUSE_SELLER_INDEX}.`,
        );
    }
}

async function assertStockCountDataAreSafe(db: DeploySchemaClient): Promise<void> {
    const duplicateOpenWarehouses = await db.query<DuplicateOpenWarehouseRow[]>(Prisma.sql`
        SELECT openWarehouseKey, COUNT(*) AS duplicateCount
        FROM ${STOCK_COUNT_TABLE_SQL}
        WHERE openWarehouseKey IS NOT NULL
        GROUP BY openWarehouseKey
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicateOpenWarehouses.length > 0) {
        const detail = duplicateOpenWarehouses
            .map(row => `${row.openWarehouseKey} (${String(row.duplicateCount)})`)
            .join(', ');
        throw new UnsafeSchemaStateError(
            `Hay conteos activos duplicados por bodega; no se creará el índice único: ${detail}`,
        );
    }

    const invalidWarehouses = await db.query<InvalidStockCountWarehouseRow[]>(Prisma.sql`
        SELECT
            sc.id AS stockCountId,
            sc.tenantId,
            sc.warehouseId,
            CASE WHEN w.id IS NULL THEN 'MISSING_WAREHOUSE' ELSE 'CROSS_TENANT' END AS reason
        FROM ${STOCK_COUNT_TABLE_SQL} sc
        LEFT JOIN ${WAREHOUSE_TABLE_SQL} w ON w.id = sc.warehouseId
        WHERE sc.warehouseId IS NOT NULL
          AND (w.id IS NULL OR w.tenantId <> sc.tenantId)
        LIMIT 10
    `);

    if (invalidWarehouses.length > 0) {
        const detail = invalidWarehouses
            .map(row => `${row.stockCountId}/${row.warehouseId} (${row.reason})`)
            .join(', ');
        throw new UnsafeSchemaStateError(
            `Hay conteos vinculados a una bodega inexistente o de otro tenant; no se continuará: ${detail}`,
        );
    }

    const invalidOpenKeys = await db.query<InvalidOpenWarehouseKeyRow[]>(Prisma.sql`
        SELECT
            id AS stockCountId,
            status,
            warehouseId,
            openWarehouseKey,
            CASE
              WHEN warehouseId IS NULL THEN 'MISSING_WAREHOUSE_ID'
              WHEN openWarehouseKey <> warehouseId THEN 'KEY_MISMATCH'
              ELSE 'INACTIVE_COUNT'
            END AS reason
        FROM ${STOCK_COUNT_TABLE_SQL}
        WHERE openWarehouseKey IS NOT NULL
          AND (
            warehouseId IS NULL
            OR openWarehouseKey <> warehouseId
            OR status NOT IN ('OPEN', 'CLOSING')
          )
        LIMIT 10
    `);

    if (invalidOpenKeys.length > 0) {
        const detail = invalidOpenKeys
            .map(row => `${row.stockCountId}/${row.openWarehouseKey} (${row.reason})`)
            .join(', ');
        throw new UnsafeSchemaStateError(
            `Hay claves de conteo activo incoherentes; no se continuará: ${detail}`,
        );
    }
}

async function ensureStockCountColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    columnName: 'warehouseId' | 'openWarehouseKey',
): Promise<void> {
    const inspect = inspectStockCountNullableIdColumn;
    const initialState = inspect(await readStockCountColumn(db, columnName));
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `StockCount.${columnName} existe con una definición incompatible; se requiere intervención manual.`,
        );
    }

    if (initialState === 'missing') {
        logger.info(`Aplicando DDL seguro: StockCount.${columnName} VARCHAR(191) NULL.`);
        try {
            if (columnName === 'warehouseId') {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${STOCK_COUNT_TABLE_SQL}
                    ADD COLUMN ${WAREHOUSE_ID_COLUMN_SQL} VARCHAR(191) NULL
                `);
            } else {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${STOCK_COUNT_TABLE_SQL}
                    ADD COLUMN ${OPEN_WAREHOUSE_KEY_COLUMN_SQL} VARCHAR(191) NULL
                `);
            }
        } catch (error) {
            if (inspect(await readStockCountColumn(db, columnName)) !== 'valid') throw error;
            logger.warn(`StockCount.${columnName} fue creada concurrentemente; definición verificada.`);
        }
    }

    const finalColumn = await readStockCountColumn(db, columnName);
    if (inspect(finalColumn) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de StockCount.${columnName}.`,
        );
    }

    const warehouseIdColumn = await readWarehouseIdColumn(db);
    if (!columnsUseSameEncoding(finalColumn, warehouseIdColumn)) {
        throw new UnsafeSchemaStateError(
            `StockCount.${columnName} no usa el mismo charset/collation que Warehouse.id.`,
        );
    }
}

interface StockCountIndexDefinition {
    name: typeof STOCK_COUNT_OPEN_WAREHOUSE_INDEX
        | typeof STOCK_COUNT_WAREHOUSE_INDEX
        | typeof STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX;
    inspect(rows: StockCountIndexRow[]): SchemaObjectState;
    create(db: DeploySchemaClient): Promise<number>;
}

const STOCK_COUNT_INDEX_DEFINITIONS: StockCountIndexDefinition[] = [
    {
        name: STOCK_COUNT_OPEN_WAREHOUSE_INDEX,
        inspect: inspectStockCountOpenWarehouseIndex,
        create: db => db.execute(Prisma.sql`
            CREATE UNIQUE INDEX ${STOCK_COUNT_OPEN_WAREHOUSE_INDEX_SQL}
            ON ${STOCK_COUNT_TABLE_SQL}(${OPEN_WAREHOUSE_KEY_COLUMN_SQL})
        `),
    },
    {
        name: STOCK_COUNT_WAREHOUSE_INDEX,
        inspect: inspectStockCountWarehouseIndex,
        create: db => db.execute(Prisma.sql`
            CREATE INDEX ${STOCK_COUNT_WAREHOUSE_INDEX_SQL}
            ON ${STOCK_COUNT_TABLE_SQL}(${WAREHOUSE_ID_COLUMN_SQL})
        `),
    },
    {
        name: STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
        inspect: inspectStockCountTenantWarehouseStatusIndex,
        create: db => db.execute(Prisma.sql`
            CREATE INDEX ${STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX_SQL}
            ON ${STOCK_COUNT_TABLE_SQL}(
                ${TENANT_ID_COLUMN_SQL},
                ${WAREHOUSE_ID_COLUMN_SQL},
                ${STATUS_COLUMN_SQL}
            )
        `),
    },
];

async function ensureStockCountIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: StockCountIndexDefinition,
): Promise<void> {
    const initialState = definition.inspect(await readStockCountIndex(db, definition.name));
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${definition.name} existe con columnas u opciones incompatibles.`,
        );
    }

    if (initialState === 'missing') {
        logger.info(`Aplicando DDL seguro: índice ${definition.name}.`);
        try {
            await definition.create(db);
        } catch (error) {
            if (definition.inspect(await readStockCountIndex(db, definition.name)) !== 'valid') {
                await assertStockCountDataAreSafe(db);
                throw error;
            }
            logger.warn(`${definition.name} fue creado concurrentemente; definición verificada.`);
        }
    }

    if (definition.inspect(await readStockCountIndex(db, definition.name)) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${definition.name}.`,
        );
    }
}

async function ensureStockCountWarehouseForeignKey(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const initialState = inspectStockCountWarehouseForeignKey(await readStockCountWarehouseForeignKey(db));
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY} existe o compite con una relación incompatible.`,
        );
    }

    if (initialState === 'missing') {
        logger.info(`Aplicando DDL seguro: FK ${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY}.`);
        try {
            await db.execute(Prisma.sql`
                ALTER TABLE ${STOCK_COUNT_TABLE_SQL}
                ADD CONSTRAINT ${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY_SQL}
                FOREIGN KEY (${WAREHOUSE_ID_COLUMN_SQL}) REFERENCES ${WAREHOUSE_TABLE_SQL}(${ID_COLUMN_SQL})
                ON DELETE RESTRICT ON UPDATE CASCADE
            `);
        } catch (error) {
            if (inspectStockCountWarehouseForeignKey(await readStockCountWarehouseForeignKey(db)) !== 'valid') {
                await assertStockCountDataAreSafe(db);
                throw error;
            }
            logger.warn(`${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY} fue creada concurrentemente; definición verificada.`);
        }
    }

    if (inspectStockCountWarehouseForeignKey(await readStockCountWarehouseForeignKey(db)) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY}.`,
        );
    }
}

export async function applyStockCountSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    if (!await stockCountTableExists(db)) {
        logger.info('Preflight DDL: StockCount aún no existe; db push creará su schema completo.');
        return;
    }

    await ensureStockCountColumn(db, logger, 'warehouseId');
    await ensureStockCountColumn(db, logger, 'openWarehouseKey');

    // No se atribuye ningún conteo legado a una bodega. Incluso con una sola
    // bodega actual no podemos demostrar que esa topología existía al contar.
    // OPEN/CLOSING legados conservan ambas columnas en NULL y no consumen una
    // clave activa inventada.
    await assertStockCountDataAreSafe(db);
    for (const definition of STOCK_COUNT_INDEX_DEFINITIONS) {
        await ensureStockCountIndex(db, logger, definition);
    }
    await ensureStockCountWarehouseForeignKey(db, logger);
    await assertStockCountDataAreSafe(db);
    logger.info('Preflight DDL verificado: StockCount por bodega listo sin reasignar históricos.');
}

/**
 * DDL expand-only que Prisma db push considera "data loss" aunque no borra filas.
 * Se ejecuta antes del db push normal y converge desde estados parciales.
 */
export async function applyDeploySchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    // En una instalación vacía no hay nada que parchear: db push crea el schema
    // completo, incluido el índice, sin advertencias sobre datos existentes.
    if (!await warehouseTableExists(db)) {
        if (await stockCountTableExists(db)) {
            throw new UnsafeSchemaStateError(
                'StockCount existe pero Warehouse no; el schema parcial requiere intervención manual.',
            );
        }
        logger.info('Preflight DDL: Warehouse aún no existe; db push creará el schema completo.');
        return;
    }

    await ensureSellerColumn(db, logger);
    await assertAssignmentsAreSafe(db);
    await ensureSellerUniqueIndex(db, logger);
    await assertAssignmentsAreSafe(db);
    logger.info('Preflight DDL verificado: Warehouse.sellerId e índice único listos.');
    await applyStockCountSchemaPreflight(db, logger);
}
