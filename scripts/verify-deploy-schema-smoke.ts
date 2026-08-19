import prisma from '../backend/lib/prisma';
import {
    inspectWarehouseSellerColumn,
    inspectWarehouseSellerIndex,
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
