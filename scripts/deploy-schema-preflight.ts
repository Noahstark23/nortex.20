import { Prisma } from '@prisma/client';

export const UNSAFE_SCHEMA_STATE_EXIT_CODE = 42;
export const WAREHOUSE_SELLER_INDEX = 'Warehouse_tenantId_sellerId_key';

// Identificadores internos y constantes: nunca contienen entrada del usuario.
const WAREHOUSE_TABLE_SQL = Prisma.raw('`Warehouse`');
const USER_TABLE_SQL = Prisma.raw('`User`');
const SELLER_ID_COLUMN_SQL = Prisma.raw('`sellerId`');
const TENANT_ID_COLUMN_SQL = Prisma.raw('`tenantId`');
const WAREHOUSE_SELLER_INDEX_SQL = Prisma.raw('`Warehouse_tenantId_sellerId_key`');

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
        logger.info('Preflight DDL: Warehouse aún no existe; db push creará el schema completo.');
        return;
    }

    await ensureSellerColumn(db, logger);
    await assertAssignmentsAreSafe(db);
    await ensureSellerUniqueIndex(db, logger);
    await assertAssignmentsAreSafe(db);
    logger.info('Preflight DDL verificado: Warehouse.sellerId e índice único listos.');
}
