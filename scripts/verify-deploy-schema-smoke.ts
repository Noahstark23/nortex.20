import prisma from '../backend/lib/prisma';
import {
    inspectStockCountNullableIdColumn,
    inspectStockCountOpenWarehouseIndex,
    inspectStockCountTenantWarehouseStatusIndex,
    inspectStockCountWarehouseForeignKey,
    inspectStockCountWarehouseIndex,
    inspectWarehouseSellerColumn,
    inspectWarehouseSellerIndex,
    STOCK_COUNT_OPEN_WAREHOUSE_INDEX,
    STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
    STOCK_COUNT_WAREHOUSE_FOREIGN_KEY,
    STOCK_COUNT_WAREHOUSE_INDEX,
    type StockCountForeignKeyRow,
    type WarehouseSellerColumnRow,
    type WarehouseSellerIndexRow,
} from './deploy-schema-preflight';

const mode = process.argv[2] ?? 'success';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function readIndex(): Promise<WarehouseSellerIndexRow[]> {
    return prisma.$queryRaw<WarehouseSellerIndexRow[]>`
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
    `;
}

async function readStockCountIndex(indexName: string): Promise<WarehouseSellerIndexRow[]> {
    return prisma.$queryRaw<WarehouseSellerIndexRow[]>`
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
    `;
}

async function verifyStockCountUpgrade(): Promise<void> {
    const columns = await prisma.$queryRaw<Array<WarehouseSellerColumnRow & { columnName: string }>>`
        SELECT
            COLUMN_NAME AS columnName,
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
          AND COLUMN_NAME IN ('warehouseId', 'openWarehouseKey')
        ORDER BY COLUMN_NAME
    `;
    const warehouseIdColumn = columns.filter(row => row.columnName === 'warehouseId');
    const openWarehouseKeyColumn = columns.filter(row => row.columnName === 'openWarehouseKey');
    assert(inspectStockCountNullableIdColumn(warehouseIdColumn) === 'valid', 'StockCount.warehouseId no coincide con el schema.');
    assert(inspectStockCountNullableIdColumn(openWarehouseKeyColumn) === 'valid', 'StockCount.openWarehouseKey no coincide con el schema.');

    const [openIndex, warehouseIndex, compositeIndex] = await Promise.all([
        readStockCountIndex(STOCK_COUNT_OPEN_WAREHOUSE_INDEX),
        readStockCountIndex(STOCK_COUNT_WAREHOUSE_INDEX),
        readStockCountIndex(STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX),
    ]);
    assert(inspectStockCountOpenWarehouseIndex(openIndex) === 'valid', `${STOCK_COUNT_OPEN_WAREHOUSE_INDEX} es incorrecto.`);
    assert(inspectStockCountWarehouseIndex(warehouseIndex) === 'valid', `${STOCK_COUNT_WAREHOUSE_INDEX} es incorrecto.`);
    assert(
        inspectStockCountTenantWarehouseStatusIndex(compositeIndex) === 'valid',
        `${STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX} es incorrecto.`,
    );

    const foreignKeys = await prisma.$queryRaw<StockCountForeignKeyRow[]>`
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
            rc.CONSTRAINT_NAME = ${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY}
            OR kcu.COLUMN_NAME = 'warehouseId'
          )
        ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `;
    assert(
        inspectStockCountWarehouseForeignKey(foreignKeys) === 'valid',
        `${STOCK_COUNT_WAREHOUSE_FOREIGN_KEY} es incorrecta.`,
    );

    const stockCounts = await prisma.$queryRaw<Array<{
        id: string;
        status: string;
        warehouseId: string | null;
        openWarehouseKey: string | null;
    }>>`
        SELECT id, status, warehouseId, openWarehouseKey
        FROM StockCount
        WHERE id IN ('stock-count-deploy-open', 'stock-count-deploy-closed')
        ORDER BY id
    `;
    assert(stockCounts.length === 2, `El upgrade no conservó los 2 conteos legados: hay ${stockCounts.length}.`);
    const closed = stockCounts.find(row => row.id === 'stock-count-deploy-closed');
    const open = stockCounts.find(row => row.id === 'stock-count-deploy-open');
    assert(closed?.status === 'CLOSED', 'Cambió el estado del conteo cerrado legado.');
    assert(closed?.warehouseId === null, 'El upgrade inventó una bodega para el conteo cerrado legado.');
    assert(closed?.openWarehouseKey === null, 'El upgrade inventó una clave activa para el conteo cerrado legado.');
    assert(open?.status === 'OPEN', 'Cambió el estado del conteo abierto legado.');
    assert(open?.warehouseId === null, 'El upgrade atribuyó el conteo OPEN legado a una bodega.');
    assert(open?.openWarehouseKey === null, 'El upgrade consumió una clave activa para el conteo OPEN legado.');
}

async function main(): Promise<void> {
    if (mode === 'empty') {
        const tableRows = await prisma.$queryRaw<Array<{ tableCount: number | bigint }>>`
            SELECT COUNT(*) AS tableCount
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
        `;
        assert(Number(tableRows[0]?.tableCount ?? -1) === 0, 'La BD de smoke no está vacía.');
        console.log('BD desechable vacía verificada.');
        return;
    }

    const warehouseRows = await prisma.$queryRaw<Array<{
        id: string;
        tenantId: string;
        name: string;
        sellerId: string | null;
    }>>`
        SELECT id, tenantId, name, sellerId
        FROM Warehouse
        ORDER BY id
    `;

    const columnRows = await prisma.$queryRaw<WarehouseSellerColumnRow[]>`
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
    `;
    assert(inspectWarehouseSellerColumn(columnRows) === 'valid', 'Warehouse.sellerId no coincide con el schema.');

    const indexRows = await readIndex();
    await verifyStockCountUpgrade();

    if (mode === 'duplicates') {
        assert(warehouseRows.length === 2, `El preflight alteró filas: se esperaban 2 y hay ${warehouseRows.length}.`);
        assert(warehouseRows.every(row => row.sellerId === 'user-deploy-smoke'), 'El preflight alteró las asignaciones duplicadas.');
        assert(indexRows.length === 0, 'El índice no debía crearse con duplicados.');
        console.log('Smoke adversarial verificado: duplicados intactos e índice ausente.');
        return;
    }

    if (mode === 'cross-tenant') {
        const first = warehouseRows.find(row => row.id === 'warehouse-deploy-1');
        const second = warehouseRows.find(row => row.id === 'warehouse-deploy-2');
        assert(first?.sellerId === 'user-deploy-cross-tenant', 'El preflight alteró el seller cross-tenant.');
        assert(second?.sellerId === null, 'El preflight alteró la segunda bodega.');
        assert(indexRows.length === 0, 'El índice no debía crearse con una relación cross-tenant.');
        console.log('Smoke adversarial verificado: relación cross-tenant intacta e índice ausente.');
        return;
    }

    assert(warehouseRows.length === 2, `El upgrade no conservó las 2 bodegas: hay ${warehouseRows.length}.`);
    assert(warehouseRows[0]?.id === 'warehouse-deploy-1', 'Cambió la primera bodega del fixture.');
    assert(warehouseRows[0]?.tenantId === 'tenant-deploy-smoke', 'Cambió el tenant de la primera bodega.');
    assert(warehouseRows[0]?.name === 'Principal Smoke', 'Cambió el nombre de la primera bodega.');
    assert(warehouseRows[0]?.sellerId === null, 'El upgrade inventó una asignación de vendedor.');
    assert(warehouseRows[1]?.id === 'warehouse-deploy-2', 'Cambió la segunda bodega del fixture.');
    assert(warehouseRows[1]?.sellerId === null, 'El upgrade inventó una segunda asignación.');
    assert(inspectWarehouseSellerIndex(indexRows) === 'valid', 'El índice único final es incorrecto.');

    const fkRows = await prisma.$queryRaw<Array<{ constraintName: string }>>`
        SELECT CONSTRAINT_NAME AS constraintName
        FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('Warehouse', 'SellerProduct')
    `;
    const constraints = new Set(fkRows.map(row => row.constraintName));
    for (const expected of [
        'Warehouse_sellerId_fkey',
        'SellerProduct_tenantId_fkey',
        'SellerProduct_sellerId_fkey',
        'SellerProduct_productId_fkey',
    ]) {
        assert(constraints.has(expected), `Falta la FK ${expected}.`);
    }

    const sellerProductRows = await prisma.$queryRaw<Array<{ tableCount: number | bigint }>>`
        SELECT COUNT(*) AS tableCount
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'SellerProduct'
    `;
    assert(Number(sellerProductRows[0]?.tableCount ?? 0) === 1, 'Falta la tabla SellerProduct.');
    console.log('Smoke de upgrade verificado: datos, columna, índice, tabla y FKs correctos.');
}

try {
    await main();
} finally {
    await prisma.$disconnect();
}
