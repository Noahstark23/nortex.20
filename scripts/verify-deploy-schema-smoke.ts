import prisma from '../backend/lib/prisma';
import {
    inspectProductReturnClientEventIdColumn,
    inspectProductReturnIdempotencyIndex,
    inspectProductReturnPayloadHashColumn,
    inspectStockCountNullableIdColumn,
    inspectStockCountOpenWarehouseIndex,
    inspectStockCountTenantWarehouseStatusIndex,
    inspectStockCountWarehouseForeignKey,
    inspectStockCountWarehouseIndex,
    inspectWarehouseSellerColumn,
    inspectWarehouseSellerIndex,
    PRODUCT_RETURN_IDEMPOTENCY_INDEX,
    STOCK_COUNT_OPEN_WAREHOUSE_INDEX,
    STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX,
    STOCK_COUNT_WAREHOUSE_FOREIGN_KEY,
    STOCK_COUNT_WAREHOUSE_INDEX,
    type StockCountForeignKeyRow,
    type ProductReturnColumnRow,
    type ProductReturnIndexRow,
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

async function readProductReturnIndex(): Promise<ProductReturnIndexRow[]> {
    return prisma.$queryRaw<ProductReturnIndexRow[]>`
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
          AND TABLE_NAME = 'ProductReturn'
          AND INDEX_NAME = ${PRODUCT_RETURN_IDEMPOTENCY_INDEX}
        ORDER BY SEQ_IN_INDEX
    `;
}

async function verifyProductReturnUpgrade(): Promise<void> {
    const columns = await prisma.$queryRaw<Array<ProductReturnColumnRow & { columnName: string }>>`
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
          AND TABLE_NAME = 'ProductReturn'
          AND COLUMN_NAME IN ('clientEventId', 'payloadHash')
        ORDER BY COLUMN_NAME
    `;
    assert(
        inspectProductReturnClientEventIdColumn(
            columns.filter(row => row.columnName === 'clientEventId'),
        ) === 'valid',
        'ProductReturn.clientEventId no coincide con VARCHAR(128) NULL.',
    );
    assert(
        inspectProductReturnPayloadHashColumn(
            columns.filter(row => row.columnName === 'payloadHash'),
        ) === 'valid',
        'ProductReturn.payloadHash no coincide con VARCHAR(64) NULL.',
    );

    const indexRows = await readProductReturnIndex();
    const returns = await prisma.$queryRaw<Array<{
        id: string;
        tenantId: string;
        saleId: string;
        reason: string;
        total: unknown;
        clientEventId: string | null;
        payloadHash: string | null;
    }>>`
        SELECT id, tenantId, saleId, reason, total, clientEventId, payloadHash
        FROM ProductReturn
        WHERE id IN ('product-return-deploy-legacy', 'product-return-deploy-duplicate')
        ORDER BY id
    `;

    if (mode === 'return-duplicates') {
        assert(returns.length === 2, `El preflight alteró devoluciones duplicadas: hay ${returns.length}.`);
        assert(
            returns.every(row => row.clientEventId === 'return-event-deploy-duplicate'),
            'El preflight alteró clientEventId duplicados.',
        );
        assert(
            returns.every(row => row.payloadHash === null),
            'El preflight inventó hashes para devoluciones duplicadas.',
        );
        assert(indexRows.length === 0, 'El índice de devoluciones no debía crearse con duplicados.');
        return;
    }

    assert(returns.length === 1, `El upgrade no conservó la devolución histórica única: hay ${returns.length}.`);
    const legacyReturn = returns[0];
    assert(legacyReturn?.id === 'product-return-deploy-legacy', 'Cambió la devolución histórica.');
    assert(legacyReturn?.tenantId === 'tenant-deploy-smoke', 'Cambió el tenant de la devolución histórica.');
    assert(legacyReturn?.saleId === 'sale-deploy-legacy', 'Cambió la venta de la devolución histórica.');
    assert(legacyReturn?.reason === 'Devolución histórica smoke', 'Cambió el motivo histórico.');
    assert(String(legacyReturn?.total) === '5', 'Cambió el total de la devolución histórica.');
    assert(legacyReturn?.clientEventId === null, 'El upgrade inventó clientEventId histórico.');
    assert(legacyReturn?.payloadHash === null, 'El upgrade inventó payloadHash histórico.');
    assert(
        inspectProductReturnIdempotencyIndex(indexRows) === 'valid',
        `${PRODUCT_RETURN_IDEMPOTENCY_INDEX} es incorrecto.`,
    );
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

interface MeasuredExpansionColumnRow {
    tableName: string;
    columnName: string;
    columnType: string;
    isNullable: string;
    columnDefault: string | null;
    extra: string;
    generationExpression: string;
}

interface ForeignKeyShapeRow {
    tableName: string;
    constraintName: string;
    columnName: string;
    referencedTableName: string;
    referencedColumnName: string;
    deleteRule: string;
    updateRule: string;
}

const MEASURED_TABLES = [
    'TenantCapability',
    'ScaleLabelProfile',
    'ScaleLabelProfileVersion',
    'ScaleProductMapping',
    'ScaleDevice',
    'SaleMeasurement',
    'SaleItemBatchAllocation',
] as const;

const EXPECTED_MEASURED_COLUMNS: Array<{
    tableName: string;
    columnName: string;
    columnType: string;
}> = [
    { tableName: 'Product', columnName: 'saleMode', columnType: 'varchar(191)' },
    { tableName: 'Product', columnName: 'quantityStep', columnType: 'decimal(18,4)' },
    { tableName: 'Product', columnName: 'productFamily', columnType: 'varchar(191)' },
    { tableName: 'PurchaseItem', columnName: 'quantityExact', columnType: 'decimal(18,4)' },
    { tableName: 'PurchaseOrderItem', columnName: 'quantityOrderedExact', columnType: 'decimal(18,4)' },
    { tableName: 'PurchaseOrderItem', columnName: 'quantityReceivedExact', columnType: 'decimal(18,4)' },
    { tableName: 'PurchaseOrderItem', columnName: 'unitAtOrder', columnType: 'varchar(191)' },
    { tableName: 'PurchaseOrderItem', columnName: 'saleModeAtOrder', columnType: 'varchar(191)' },
    { tableName: 'PurchaseOrderItem', columnName: 'quantityStepAtOrder', columnType: 'decimal(18,4)' },
    { tableName: 'Sale', columnName: 'offlinePayloadHash', columnType: 'varchar(64)' },
    { tableName: 'SaleItem', columnName: 'unitPriceExactAtSale', columnType: 'decimal(18,4)' },
    { tableName: 'SaleItem', columnName: 'productNameAtSale', columnType: 'varchar(191)' },
    { tableName: 'SaleItem', columnName: 'unitAtSale', columnType: 'varchar(191)' },
    { tableName: 'SaleItem', columnName: 'saleModeAtSale', columnType: 'varchar(191)' },
    { tableName: 'SaleItem', columnName: 'quantityStepAtSale', columnType: 'decimal(18,4)' },
    { tableName: 'SaleItem', columnName: 'presentationAtSale', columnType: 'varchar(191)' },
    { tableName: 'SaleItem', columnName: 'presentationQuantityAtSale', columnType: 'decimal(18,4)' },
    { tableName: 'QuotationItem', columnName: 'quantityExact', columnType: 'decimal(18,4)' },
    { tableName: 'QuotationItem', columnName: 'unitPriceExact', columnType: 'decimal(18,4)' },
    { tableName: 'QuotationItem', columnName: 'unitAtQuote', columnType: 'varchar(191)' },
    { tableName: 'QuotationItem', columnName: 'saleModeAtQuote', columnType: 'varchar(191)' },
    { tableName: 'QuotationItem', columnName: 'quantityStepAtQuote', columnType: 'decimal(18,4)' },
    { tableName: 'QuotationItem', columnName: 'presentationAtQuote', columnType: 'varchar(191)' },
    { tableName: 'QuotationItem', columnName: 'presentationQuantityAtQuote', columnType: 'decimal(18,4)' },
    { tableName: 'QuotationItem', columnName: 'ivaExentoAtQuote', columnType: 'tinyint(1)' },
    { tableName: 'PedidoItem', columnName: 'cantidadExact', columnType: 'decimal(18,4)' },
    { tableName: 'PedidoItem', columnName: 'presentationAtSale', columnType: 'varchar(191)' },
    { tableName: 'PedidoItem', columnName: 'presentationQuantityAtSale', columnType: 'decimal(18,4)' },
    { tableName: 'PedidoItem', columnName: 'productNameAtOrder', columnType: 'varchar(191)' },
    { tableName: 'PedidoItem', columnName: 'unitAtOrder', columnType: 'varchar(191)' },
    { tableName: 'PedidoItem', columnName: 'saleModeAtOrder', columnType: 'varchar(191)' },
    { tableName: 'PedidoItem', columnName: 'quantityStepAtOrder', columnType: 'decimal(18,4)' },
    { tableName: 'PedidoItem', columnName: 'unitPriceExactAtOrder', columnType: 'decimal(18,4)' },
    { tableName: 'PedidoItem', columnName: 'ivaExentoAtOrder', columnType: 'tinyint(1)' },
];

const EXPECTED_MEASURED_FOREIGN_KEYS: Array<Omit<ForeignKeyShapeRow, 'updateRule'>> = [
    { tableName: 'TenantCapability', constraintName: 'TenantCapability_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', referencedColumnName: 'id', deleteRule: 'CASCADE' },
    { tableName: 'ScaleLabelProfile', constraintName: 'ScaleLabelProfile_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleLabelProfileVersion', constraintName: 'ScaleLabelProfileVersion_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleLabelProfileVersion', constraintName: 'ScaleLabelProfileVersion_profileId_fkey', columnName: 'profileId', referencedTableName: 'ScaleLabelProfile', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleLabelProfileVersion', constraintName: 'ScaleLabelProfileVersion_createdBy_fkey', columnName: 'createdBy', referencedTableName: 'User', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleProductMapping', constraintName: 'ScaleProductMapping_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleProductMapping', constraintName: 'ScaleProductMapping_profileVersionId_fkey', columnName: 'profileVersionId', referencedTableName: 'ScaleLabelProfileVersion', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleProductMapping', constraintName: 'ScaleProductMapping_productId_fkey', columnName: 'productId', referencedTableName: 'Product', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleDevice', constraintName: 'ScaleDevice_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'ScaleDevice', constraintName: 'ScaleDevice_createdBy_fkey', columnName: 'createdBy', referencedTableName: 'User', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleMeasurement', constraintName: 'SaleMeasurement_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleMeasurement', constraintName: 'SaleMeasurement_saleItemId_fkey', columnName: 'saleItemId', referencedTableName: 'SaleItem', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleMeasurement', constraintName: 'SaleMeasurement_profileVersionId_fkey', columnName: 'profileVersionId', referencedTableName: 'ScaleLabelProfileVersion', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleMeasurement', constraintName: 'SaleMeasurement_deviceId_fkey', columnName: 'deviceId', referencedTableName: 'ScaleDevice', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleMeasurement', constraintName: 'SaleMeasurement_userId_fkey', columnName: 'userId', referencedTableName: 'User', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleItemBatchAllocation', constraintName: 'SaleItemBatchAllocation_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleItemBatchAllocation', constraintName: 'SaleItemBatchAllocation_saleItemId_fkey', columnName: 'saleItemId', referencedTableName: 'SaleItem', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
    { tableName: 'SaleItemBatchAllocation', constraintName: 'SaleItemBatchAllocation_batchId_fkey', columnName: 'batchId', referencedTableName: 'ProductBatch', referencedColumnName: 'id', deleteRule: 'RESTRICT' },
];

function assertAllNull(row: Record<string, unknown>, keys: string[], label: string): void {
    for (const key of keys) {
        assert(row[key] === null, `${label}.${key} debía permanecer NULL para el histórico.`);
    }
}

async function verifyMeasuredExpansion(): Promise<void> {
    const columns = await prisma.$queryRaw<MeasuredExpansionColumnRow[]>`
        SELECT
            TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable,
            COLUMN_DEFAULT AS columnDefault,
            EXTRA AS extra,
            GENERATION_EXPRESSION AS generationExpression
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (
            (TABLE_NAME = 'Product' AND COLUMN_NAME IN ('saleMode', 'quantityStep', 'productFamily'))
            OR (TABLE_NAME = 'PurchaseItem' AND COLUMN_NAME = 'quantityExact')
            OR (TABLE_NAME = 'PurchaseOrderItem' AND COLUMN_NAME IN ('quantityOrderedExact', 'quantityReceivedExact', 'unitAtOrder', 'saleModeAtOrder', 'quantityStepAtOrder'))
            OR (TABLE_NAME = 'Sale' AND COLUMN_NAME = 'offlinePayloadHash')
            OR (TABLE_NAME = 'SaleItem' AND COLUMN_NAME IN ('unitPriceExactAtSale', 'productNameAtSale', 'unitAtSale', 'saleModeAtSale', 'quantityStepAtSale', 'presentationAtSale', 'presentationQuantityAtSale'))
            OR (TABLE_NAME = 'QuotationItem' AND COLUMN_NAME IN ('quantityExact', 'unitPriceExact', 'unitAtQuote', 'saleModeAtQuote', 'quantityStepAtQuote', 'presentationAtQuote', 'presentationQuantityAtQuote', 'ivaExentoAtQuote'))
            OR (TABLE_NAME = 'PedidoItem' AND COLUMN_NAME IN ('cantidadExact', 'presentationAtSale', 'presentationQuantityAtSale', 'productNameAtOrder', 'unitAtOrder', 'saleModeAtOrder', 'quantityStepAtOrder', 'unitPriceExactAtOrder', 'ivaExentoAtOrder'))
          )
    `;
    assert(
        columns.length === EXPECTED_MEASURED_COLUMNS.length,
        `La expansión medida tiene ${columns.length}/${EXPECTED_MEASURED_COLUMNS.length} columnas verificadas.`,
    );
    const byColumn = new Map(columns.map(row => [`${row.tableName}.${row.columnName}`, row]));
    for (const expected of EXPECTED_MEASURED_COLUMNS) {
        const key = `${expected.tableName}.${expected.columnName}`;
        const actual = byColumn.get(key);
        assert(actual, `Falta la columna medida ${key}.`);
        assert(actual.columnType.toLowerCase() === expected.columnType, `${key} tiene tipo ${actual.columnType}.`);
        assert(actual.isNullable.toUpperCase() === 'YES', `${key} debe ser nullable para históricos.`);
        assert(actual.columnDefault === null, `${key} no debe inventar un valor por default.`);
        assert(actual.extra === '' && actual.generationExpression === '', `${key} tiene metadata inesperada.`);
    }

    const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (
            'TenantCapability', 'ScaleLabelProfile', 'ScaleLabelProfileVersion',
            'ScaleProductMapping', 'ScaleDevice', 'SaleMeasurement', 'SaleItemBatchAllocation'
          )
        ORDER BY TABLE_NAME
    `;
    assert(tables.length === MEASURED_TABLES.length, `Faltan tablas medidas: hay ${tables.length}/7.`);
    const tableNames = new Set(tables.map(row => row.tableName));
    for (const tableName of MEASURED_TABLES) assert(tableNames.has(tableName), `Falta la tabla ${tableName}.`);

    const foreignKeys = await prisma.$queryRaw<ForeignKeyShapeRow[]>`
        SELECT
            rc.TABLE_NAME AS tableName,
            rc.CONSTRAINT_NAME AS constraintName,
            kcu.COLUMN_NAME AS columnName,
            kcu.REFERENCED_TABLE_NAME AS referencedTableName,
            kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
            rc.DELETE_RULE AS deleteRule,
            rc.UPDATE_RULE AS updateRule
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        INNER JOIN information_schema.KEY_COLUMN_USAGE kcu
          ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
         AND kcu.TABLE_NAME = rc.TABLE_NAME
         AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
          AND rc.TABLE_NAME IN (
            'TenantCapability', 'ScaleLabelProfile', 'ScaleLabelProfileVersion',
            'ScaleProductMapping', 'ScaleDevice', 'SaleMeasurement', 'SaleItemBatchAllocation'
          )
    `;
    assert(
        foreignKeys.length === EXPECTED_MEASURED_FOREIGN_KEYS.length,
        `La expansión medida tiene ${foreignKeys.length}/${EXPECTED_MEASURED_FOREIGN_KEYS.length} FKs.`,
    );
    const byConstraint = new Map(foreignKeys.map(row => [row.constraintName, row]));
    for (const expected of EXPECTED_MEASURED_FOREIGN_KEYS) {
        const actual = byConstraint.get(expected.constraintName);
        assert(actual, `Falta la FK ${expected.constraintName}.`);
        assert(actual.tableName === expected.tableName, `${expected.constraintName} está en otra tabla.`);
        assert(actual.columnName === expected.columnName, `${expected.constraintName} usa otra columna.`);
        assert(actual.referencedTableName === expected.referencedTableName, `${expected.constraintName} referencia otra tabla.`);
        assert(actual.referencedColumnName === expected.referencedColumnName, `${expected.constraintName} referencia otra columna.`);
        assert(actual.deleteRule.toUpperCase() === expected.deleteRule, `${expected.constraintName} tiene ON DELETE incorrecto.`);
        assert(actual.updateRule.toUpperCase() === 'CASCADE', `${expected.constraintName} debe usar ON UPDATE CASCADE.`);
    }

    const newTableCounts = await prisma.$queryRaw<Array<{ tableName: string; rowCount: number | bigint }>>`
        SELECT 'TenantCapability' AS tableName, COUNT(*) AS rowCount FROM TenantCapability
        UNION ALL SELECT 'ScaleLabelProfile', COUNT(*) FROM ScaleLabelProfile
        UNION ALL SELECT 'ScaleLabelProfileVersion', COUNT(*) FROM ScaleLabelProfileVersion
        UNION ALL SELECT 'ScaleProductMapping', COUNT(*) FROM ScaleProductMapping
        UNION ALL SELECT 'ScaleDevice', COUNT(*) FROM ScaleDevice
        UNION ALL SELECT 'SaleMeasurement', COUNT(*) FROM SaleMeasurement
        UNION ALL SELECT 'SaleItemBatchAllocation', COUNT(*) FROM SaleItemBatchAllocation
    `;
    assert(
        newTableCounts.every(row => Number(row.rowCount) === 0),
        'El upgrade inventó filas dentro de las nuevas tablas medidas.',
    );

    const products = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, name, sku, stock, saleMode, quantityStep, productFamily
        FROM Product WHERE id = 'product-deploy-legacy'
    `;
    assert(products.length === 1, 'No se conservó el producto histórico.');
    assert(products[0]?.name === 'Producto histórico smoke' && products[0]?.sku === 'DEPLOY-LEGACY-1', 'Cambió la identidad del producto histórico.');
    assert(Number(products[0]?.stock) === 7, 'Cambió el stock del producto histórico.');
    assertAllNull(products[0], ['saleMode', 'quantityStep', 'productFamily'], 'Product histórico');

    const purchaseItems = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, quantity, quantityExact FROM PurchaseItem WHERE id = 'purchase-item-deploy-legacy'
    `;
    assert(purchaseItems.length === 1 && Number(purchaseItems[0]?.quantity) === 3, 'Cambió la compra histórica.');
    assertAllNull(purchaseItems[0], ['quantityExact'], 'PurchaseItem histórico');

    const purchaseOrderItems = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, quantityOrdered, quantityReceived, quantityOrderedExact, quantityReceivedExact,
               unitAtOrder, saleModeAtOrder, quantityStepAtOrder
        FROM PurchaseOrderItem WHERE id = 'purchase-order-item-deploy-legacy'
    `;
    assert(purchaseOrderItems.length === 1 && Number(purchaseOrderItems[0]?.quantityOrdered) === 4, 'Cambió la OC histórica.');
    assertAllNull(purchaseOrderItems[0], ['quantityOrderedExact', 'quantityReceivedExact', 'unitAtOrder', 'saleModeAtOrder', 'quantityStepAtOrder'], 'PurchaseOrderItem histórico');

    const sales = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, status, total, offlinePayloadHash FROM Sale WHERE id = 'sale-deploy-legacy'
    `;
    assert(sales.length === 1 && sales[0]?.status === 'COMPLETED' && String(sales[0]?.total) === '10', 'Cambió la venta histórica.');
    assertAllNull(sales[0], ['offlinePayloadHash'], 'Sale histórica');

    const saleItems = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, quantity, priceAtSale, unitPriceExactAtSale, productNameAtSale, unitAtSale,
               saleModeAtSale, quantityStepAtSale, presentationAtSale, presentationQuantityAtSale
        FROM SaleItem WHERE id = 'sale-item-deploy-legacy'
    `;
    assert(saleItems.length === 1 && Number(saleItems[0]?.quantity) === 2, 'Cambió la línea de venta histórica.');
    assertAllNull(saleItems[0], ['unitPriceExactAtSale', 'productNameAtSale', 'unitAtSale', 'saleModeAtSale', 'quantityStepAtSale', 'presentationAtSale', 'presentationQuantityAtSale'], 'SaleItem histórico');

    const quotationItems = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, quantity, quantityExact, unitPriceExact, unitAtQuote, saleModeAtQuote,
               quantityStepAtQuote, presentationAtQuote, presentationQuantityAtQuote, ivaExentoAtQuote
        FROM QuotationItem WHERE id = 'quotation-item-deploy-legacy'
    `;
    assert(quotationItems.length === 1 && Number(quotationItems[0]?.quantity) === 2, 'Cambió la cotización histórica.');
    assertAllNull(quotationItems[0], ['quantityExact', 'unitPriceExact', 'unitAtQuote', 'saleModeAtQuote', 'quantityStepAtQuote', 'presentationAtQuote', 'presentationQuantityAtQuote', 'ivaExentoAtQuote'], 'QuotationItem histórico');

    const orderItems = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id, cantidad, cantidadExact, presentationAtSale, presentationQuantityAtSale,
               productNameAtOrder, unitAtOrder, saleModeAtOrder, quantityStepAtOrder,
               unitPriceExactAtOrder, ivaExentoAtOrder
        FROM PedidoItem WHERE id = 'pedido-item-deploy-legacy'
    `;
    assert(orderItems.length === 1 && Number(orderItems[0]?.cantidad) === 2, 'Cambió el pedido histórico.');
    assertAllNull(orderItems[0], ['cantidadExact', 'presentationAtSale', 'presentationQuantityAtSale', 'productNameAtOrder', 'unitAtOrder', 'saleModeAtOrder', 'quantityStepAtOrder', 'unitPriceExactAtOrder', 'ivaExentoAtOrder'], 'PedidoItem histórico');
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
    await verifyProductReturnUpgrade();
    await verifyMeasuredExpansion();

    if (mode === 'return-duplicates') {
        console.log('Smoke adversarial verificado: devoluciones duplicadas intactas e índice ausente.');
        return;
    }

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
    console.log('Smoke de upgrade verificado: históricos, expansión medida, índices, tablas y FKs correctos.');
}

try {
    await main();
} finally {
    await prisma.$disconnect();
}
