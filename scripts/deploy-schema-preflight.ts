import { Prisma } from '@prisma/client';

export const UNSAFE_SCHEMA_STATE_EXIT_CODE = 42;
export const WAREHOUSE_SELLER_INDEX = 'Warehouse_tenantId_sellerId_key';
export const STOCK_COUNT_OPEN_WAREHOUSE_INDEX = 'StockCount_openWarehouseKey_key';
export const STOCK_COUNT_WAREHOUSE_INDEX = 'StockCount_warehouseId_idx';
export const STOCK_COUNT_TENANT_WAREHOUSE_STATUS_INDEX = 'StockCount_tenantId_warehouseId_status_idx';
export const STOCK_COUNT_WAREHOUSE_FOREIGN_KEY = 'StockCount_warehouseId_fkey';
export const PRODUCT_RETURN_IDEMPOTENCY_INDEX = 'ProductReturn_tenantId_clientEventId_key';
export const PRODUCT_RETURN_CORRECTION_REQUEST_UNIQUE_INDEX = 'ProductReturn_correctionRequestId_key';
export const PRODUCT_RETURN_NUMBER_UNIQUE_INDEX = 'ProductReturn_tenantId_returnNumber_key';
export const PAYMENT_IDEMPOTENCY_INDEX = 'Payment_saleId_clientEventId_key';
export const RETENCION_SUFRIDA_IDEMPOTENCY_INDEX = 'RetencionSufrida_tenantId_clientEventId_key';
export const PURCHASE_INVOICE_UNIQUE_INDEX = 'Purchase_tenantId_supplierId_invoiceNumber_key';
export const PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX = 'Purchase_tenantId_matchResolutionClientEventId_key';
export const SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX = 'SaleItemBatchAllocation_tenantId_warehouseId_idx';
export const SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY = 'SaleItemBatchAllocation_warehouseId_fkey';
export const PRODUCT_BATCH_WAREHOUSE_STOCK_UNIQUE_INDEX = 'ProductBatchWarehouseStock_tenantId_batchId_warehouseId_key';
export const PRODUCT_BATCH_LEDGER_SOURCE_UNIQUE_INDEX = 'ProductBatchLedgerEntry_tenantId_sourceKey_key';
export const PURCHASE_ORDER_CLOSE_SHORT_EVENT_UNIQUE_INDEX = 'PurchaseOrderCloseShort_tenantId_clientEventId_key';
export const STOCK_TRANSFER_IDEMPOTENCY_INDEX = 'StockTransfer_tenantId_clientEventId_key';
export const PURCHASE_ITEM_INVENTORY_WAREHOUSE_INDEX = 'PurchaseItem_inventoryWarehouseId_idx';
export const PURCHASE_ITEM_INVENTORY_BATCH_INDEX = 'PurchaseItem_inventoryBatchId_idx';
export const PURCHASE_ITEM_INVENTORY_WAREHOUSE_FOREIGN_KEY = 'PurchaseItem_inventoryWarehouseId_fkey';
export const PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY = 'PurchaseItem_inventoryBatchId_fkey';
export const SUPPLIER_RETURN_NUMBER_UNIQUE_INDEX = 'SupplierReturn_tenantId_returnNumber_key';
export const SUPPLIER_RETURN_EVENT_UNIQUE_INDEX = 'SupplierReturn_tenantId_clientEventId_key';
export const SUPPLIER_RETURN_ITEM_SOURCE_UNIQUE_INDEX = 'SupplierReturnItem_supplierReturnId_sourceHash_key';
export const SUPPLIER_CREDIT_NOTE_NUMBER_UNIQUE_INDEX = 'SupplierCreditNote_tenantId_supplierId_creditNoteNumber_key';
export const SUPPLIER_CREDIT_NOTE_EVENT_UNIQUE_INDEX = 'SupplierCreditNote_tenantId_clientEventId_key';
export const SUPPLIER_CREDIT_NOTE_LINE_RETURN_ITEM_UNIQUE_INDEX = 'SupplierCreditNoteLine_supplierReturnItemId_key';
export const SUPPLIER_CREDIT_NOTE_LINE_DOCUMENT_ITEM_UNIQUE_INDEX = 'SupplierCreditNoteLine_creditNoteId_supplierReturnItemId_key';
export const SUPPLIER_CREDIT_APPLICATION_PURCHASE_UNIQUE_INDEX = 'SupplierCreditApplication_creditNoteId_purchaseId_key';
export const SHIFT_CLOSE_EVENT_UNIQUE_INDEX = 'Shift_tenantId_closeEventId_key';
export const JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX = 'JournalEntry_tenantId_postingKey_key';
export const JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX = 'JournalEntry_reversalOfId_key';
export const JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY = 'JournalEntry_reversalOfId_fkey';
export const PRODUCT_BATCH_HOLD_SOURCE_UNIQUE_INDEX = 'ProductBatchHold_tenantId_sourceKey_key';

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
const PRODUCT_RETURN_TABLE_SQL = Prisma.raw('`ProductReturn`');
const PAYMENT_TABLE_SQL = Prisma.raw('`Payment`');
const RETENCION_SUFRIDA_TABLE_SQL = Prisma.raw('`RetencionSufrida`');
const PURCHASE_TABLE_SQL = Prisma.raw('`Purchase`');
const CLIENT_EVENT_ID_COLUMN_SQL = Prisma.raw('`clientEventId`');
const PAYLOAD_HASH_COLUMN_SQL = Prisma.raw('`payloadHash`');
const CORRECTION_REQUEST_ID_COLUMN_SQL = Prisma.raw('`correctionRequestId`');
const RETURN_NUMBER_COLUMN_SQL = Prisma.raw('`returnNumber`');
const PRODUCT_RETURN_IDEMPOTENCY_INDEX_SQL = Prisma.raw('`ProductReturn_tenantId_clientEventId_key`');
const PRODUCT_RETURN_CORRECTION_REQUEST_UNIQUE_INDEX_SQL = Prisma.raw('`ProductReturn_correctionRequestId_key`');
const PRODUCT_RETURN_NUMBER_UNIQUE_INDEX_SQL = Prisma.raw('`ProductReturn_tenantId_returnNumber_key`');
const PAYMENT_IDEMPOTENCY_INDEX_SQL = Prisma.raw('`Payment_saleId_clientEventId_key`');
const RETENCION_SUFRIDA_IDEMPOTENCY_INDEX_SQL = Prisma.raw('`RetencionSufrida_tenantId_clientEventId_key`');
const PURCHASE_INVOICE_UNIQUE_INDEX_SQL = Prisma.raw('`Purchase_tenantId_supplierId_invoiceNumber_key`');
const PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX_SQL = Prisma.raw('`Purchase_tenantId_matchResolutionClientEventId_key`');
const SALE_ID_COLUMN_SQL = Prisma.raw('`saleId`');
const SUPPLIER_ID_COLUMN_SQL = Prisma.raw('`supplierId`');
const INVOICE_NUMBER_COLUMN_SQL = Prisma.raw('`invoiceNumber`');
const MATCH_RESOLUTION_CLIENT_EVENT_ID_COLUMN_SQL = Prisma.raw('`matchResolutionClientEventId`');
const MATCH_RESOLUTION_PAYLOAD_HASH_COLUMN_SQL = Prisma.raw('`matchResolutionPayloadHash`');

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

export interface AccountingDecimalColumnRow {
    tableName: string;
    columnName: string;
    dataType: string;
    columnType: string;
    isNullable: string;
    numericPrecision: number | bigint | null;
    numericScale: number | bigint | null;
    columnDefault: string | null;
    extra: string;
    generationExpression: string;
}

export type AccountingDecimalColumnState = 'missing' | 'legacy' | 'target' | 'invalid';
export type AccountingDecimalConvergenceDecision = 'alter' | 'noop' | 'reject';

export type StockCountColumnRow = WarehouseSellerColumnRow;
export type StockCountIndexRow = WarehouseSellerIndexRow;
export type ProductReturnColumnRow = WarehouseSellerColumnRow;
export type ProductReturnIndexRow = WarehouseSellerIndexRow;
export type PaymentColumnRow = WarehouseSellerColumnRow;
export type PaymentIndexRow = WarehouseSellerIndexRow;
export type RetencionSufridaColumnRow = WarehouseSellerColumnRow;
export type RetencionSufridaIndexRow = WarehouseSellerIndexRow;
export type PurchaseInvoiceIndexRow = WarehouseSellerIndexRow;
export type PurchaseMatchResolutionColumnRow = WarehouseSellerColumnRow;
export type PurchaseMatchResolutionIndexRow = WarehouseSellerIndexRow;
export type ProcurementPhaseTwoBColumnRow = WarehouseSellerColumnRow & { columnName: string };
export type ProcurementPhaseTwoBIndexRow = WarehouseSellerIndexRow;
export type ProcurementPhaseTwoBForeignKeyRow = StockCountForeignKeyRow;
export type ProcurementPhaseTwoCColumnRow = ProcurementPhaseTwoBColumnRow;
export type ProcurementPhaseTwoCIndexRow = ProcurementPhaseTwoBIndexRow;
export type ProcurementPhaseTwoCForeignKeyRow = ProcurementPhaseTwoBForeignKeyRow;
export type CashCloseJournalColumnRow = ProcurementPhaseTwoBColumnRow;
export type CashCloseJournalIndexRow = ProcurementPhaseTwoBIndexRow;
export type CashCloseJournalForeignKeyRow = ProcurementPhaseTwoBForeignKeyRow;
export type PharmacyInventoryColumnRow = ProcurementPhaseTwoBColumnRow;
export type PharmacyInventoryIndexRow = ProcurementPhaseTwoBIndexRow;
export type PharmacyInventoryForeignKeyRow = ProcurementPhaseTwoBForeignKeyRow;

export interface ProcurementPhaseTwoBColumnContract {
    columnName: string;
    columnType: string;
    nullable: boolean;
    defaultValue: string | null;
    extra?: string;
}

export type ProcurementPhaseTwoCColumnContract = ProcurementPhaseTwoBColumnContract;
export type PharmacyInventoryColumnContract = ProcurementPhaseTwoBColumnContract;

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

interface DuplicateProductReturnEventRow {
    tenantId: string;
    clientEventId: string;
    duplicateCount: number | bigint;
}

interface DuplicateProductReturnCorrectionRow {
    correctionRequestId: string;
    duplicateCount: number | bigint;
}

interface DuplicateProductReturnNumberRow {
    tenantId: string;
    returnNumber: number | bigint;
    duplicateCount: number | bigint;
}

interface DuplicatePaymentEventRow {
    saleId: string;
    clientEventId: string;
    duplicateCount: number | bigint;
}

interface DuplicateRetencionSufridaEventRow {
    tenantId: string;
    clientEventId: string;
    duplicateCount: number | bigint;
}

interface DuplicatePurchaseInvoiceRow {
    tenantId: string;
    supplierId: string;
    invoiceNumber: string;
    duplicateCount: number | bigint;
}

interface DuplicatePurchaseMatchResolutionEventRow {
    tenantId: string;
    matchResolutionClientEventId: string;
    duplicateCount: number | bigint;
}

export type SchemaObjectState = 'missing' | 'valid' | 'invalid';

function normalizedSchemaDefault(value: string | null): string | null {
    if (value === null) return null;
    return value.toLowerCase().replace(/^'(.*)'$/, '$1');
}

function isZeroDecimalDefault(value: string | null): boolean {
    if (value === null) return false;
    return /^[-+]?0+(?:\.0+)?$/.test(value.trim().replace(/^'(.*)'$/, '$1'));
}

/**
 * Un DECIMAL solo se amplía sin redondear ni perder rango cuando el destino
 * conserva (o aumenta) por separado sus dígitos enteros y fraccionarios.
 */
export function isSafeDecimalWidening(
    source: { precision: number; scale: number },
    target: { precision: number; scale: number },
): boolean {
    if (!Number.isInteger(source.precision)
        || !Number.isInteger(source.scale)
        || !Number.isInteger(target.precision)
        || !Number.isInteger(target.scale)
        || source.precision <= 0
        || target.precision <= 0
        || source.scale < 0
        || target.scale < 0
        || source.scale > source.precision
        || target.scale > target.precision) {
        return false;
    }

    return source.scale <= target.scale
        && source.precision - source.scale <= target.precision - target.scale;
}

/**
 * Solo acepta el contrato histórico DECIMAL(14,2) o el final DECIMAL(18,4).
 * Cualquier nullabilidad, default, atributo unsigned/generado o metadata
 * discordante se considera drift y se rechaza antes de ejecutar DDL.
 */
export function inspectAccountingDecimalColumn(
    rows: AccountingDecimalColumnRow[],
): AccountingDecimalColumnState {
    if (rows.length === 0) return 'missing';
    if (rows.length !== 1) return 'invalid';

    const [column] = rows;
    const precision = Number(column.numericPrecision);
    const scale = Number(column.numericScale);
    const normalizedColumnType = column.columnType.toLowerCase().replace(/\s+/g, '');
    const identityIsValid = (column.tableName === 'Account' && column.columnName === 'balance')
        || (column.tableName === 'JournalLine'
            && (column.columnName === 'debit' || column.columnName === 'credit'));
    const commonContractIsValid = identityIsValid
        && column.dataType.toLowerCase() === 'decimal'
        && column.isNullable.toUpperCase() === 'NO'
        && isZeroDecimalDefault(column.columnDefault)
        && column.extra === ''
        && column.generationExpression === '';

    if (!commonContractIsValid) return 'invalid';
    if (precision === 14 && scale === 2 && normalizedColumnType === 'decimal(14,2)') {
        return 'legacy';
    }
    if (precision === 18 && scale === 4 && normalizedColumnType === 'decimal(18,4)') {
        return 'target';
    }
    return 'invalid';
}

export function decideAccountingDecimalConvergence(
    rows: AccountingDecimalColumnRow[],
): AccountingDecimalConvergenceDecision {
    const state = inspectAccountingDecimalColumn(rows);
    if (state === 'target') return 'noop';
    if (state === 'legacy'
        && isSafeDecimalWidening(
            { precision: 14, scale: 2 },
            { precision: 18, scale: 4 },
        )) {
        return 'alter';
    }
    return 'reject';
}

export function inspectProcurementPhaseTwoBColumn(
    rows: ProcurementPhaseTwoBColumnRow[],
    expected: ProcurementPhaseTwoBColumnContract,
): SchemaObjectState {
    const matches = rows.filter(row => row.columnName === expected.columnName);
    if (matches.length === 0) return 'missing';
    if (matches.length !== 1) return 'invalid';

    const [column] = matches;
    const expectedType = expected.columnType.toLowerCase();
    const expectedLengthMatch = expectedType.match(/^varchar\((\d+)\)$/);
    const expectedLength = expectedLengthMatch ? Number(expectedLengthMatch[1]) : null;
    const defaultMatches = normalizedSchemaDefault(column.columnDefault)
        === normalizedSchemaDefault(expected.defaultValue);

    return column.columnType.toLowerCase() === expectedType
        && column.isNullable.toUpperCase() === (expected.nullable ? 'YES' : 'NO')
        && (expectedLength === null || Number(column.characterMaximumLength) === expectedLength)
        && defaultMatches
        && column.extra.toUpperCase() === (expected.extra ?? '').toUpperCase()
        && column.generationExpression === ''
        ? 'valid'
        : 'invalid';
}

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

function inspectNullableVarcharColumn(
    rows: WarehouseSellerColumnRow[],
    maximumLength: number,
): SchemaObjectState {
    if (rows.length === 0) return 'missing';
    if (rows.length !== 1) return 'invalid';

    const [column] = rows;
    return column.dataType.toLowerCase() === 'varchar'
        && column.columnType.toLowerCase() === `varchar(${maximumLength})`
        && column.isNullable.toUpperCase() === 'YES'
        && Number(column.characterMaximumLength) === maximumLength
        && column.columnDefault === null
        && column.extra === ''
        && column.generationExpression === ''
        ? 'valid'
        : 'invalid';
}

export const inspectStockCountNullableIdColumn = inspectWarehouseSellerColumn;

export function inspectProductReturnClientEventIdColumn(
    rows: ProductReturnColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 128);
}

export function inspectProductReturnPayloadHashColumn(
    rows: ProductReturnColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 64);
}

export function inspectProductReturnCorrectionRequestIdColumn(
    rows: ProductReturnColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 191);
}

export function inspectProductReturnReturnNumberColumn(
    rows: ProductReturnColumnRow[],
): SchemaObjectState {
    if (rows.length === 0) return 'missing';
    if (rows.length !== 1) return 'invalid';

    const [column] = rows;
    return column.dataType.toLowerCase() === 'int'
        && column.columnType.toLowerCase() === 'int'
        && column.isNullable.toUpperCase() === 'YES'
        && column.characterMaximumLength === null
        && column.characterSetName === null
        && column.collationName === null
        && column.columnDefault === null
        && column.extra === ''
        && column.generationExpression === ''
        ? 'valid'
        : 'invalid';
}

export function inspectPaymentClientEventIdColumn(
    rows: PaymentColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 128);
}

export function inspectPaymentPayloadHashColumn(
    rows: PaymentColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 64);
}

export function inspectRetencionSufridaClientEventIdColumn(
    rows: RetencionSufridaColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 128);
}

export function inspectRetencionSufridaPayloadHashColumn(
    rows: RetencionSufridaColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 64);
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

export function inspectProductReturnIdempotencyIndex(
    rows: ProductReturnIndexRow[],
): SchemaObjectState {
    return inspectExactIndex(
        rows,
        PRODUCT_RETURN_IDEMPOTENCY_INDEX,
        ['tenantId', 'clientEventId'],
        true,
    );
}

export function inspectProductReturnCorrectionRequestIndex(
    rows: ProductReturnIndexRow[],
): SchemaObjectState {
    return inspectExactIndex(
        rows,
        PRODUCT_RETURN_CORRECTION_REQUEST_UNIQUE_INDEX,
        ['correctionRequestId'],
        true,
    );
}

export function inspectProductReturnNumberIndex(
    rows: ProductReturnIndexRow[],
): SchemaObjectState {
    return inspectExactIndex(
        rows,
        PRODUCT_RETURN_NUMBER_UNIQUE_INDEX,
        ['tenantId', 'returnNumber'],
        true,
    );
}

export function inspectPaymentIdempotencyIndex(
    rows: PaymentIndexRow[],
): SchemaObjectState {
    return inspectExactIndex(
        rows,
        PAYMENT_IDEMPOTENCY_INDEX,
        ['saleId', 'clientEventId'],
        true,
    );
}

export function inspectRetencionSufridaIdempotencyIndex(
    rows: RetencionSufridaIndexRow[],
): SchemaObjectState {
    return inspectExactIndex(
        rows,
        RETENCION_SUFRIDA_IDEMPOTENCY_INDEX,
        ['tenantId', 'clientEventId'],
        true,
    );
}

export function inspectPurchaseInvoiceUniqueIndex(
    rows: PurchaseInvoiceIndexRow[],
): SchemaObjectState {
    return inspectExactIndex(
        rows,
        PURCHASE_INVOICE_UNIQUE_INDEX,
        ['tenantId', 'supplierId', 'invoiceNumber'],
        true,
    );
}

export function inspectPurchaseMatchResolutionClientEventIdColumn(
    rows: PurchaseMatchResolutionColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 128);
}

export function inspectPurchaseMatchResolutionPayloadHashColumn(
    rows: PurchaseMatchResolutionColumnRow[],
): SchemaObjectState {
    return inspectNullableVarcharColumn(rows, 64);
}

export function inspectPurchaseMatchResolutionIdempotencyIndex(
    rows: PurchaseMatchResolutionIndexRow[],
): SchemaObjectState {
    return inspectExactIndex(
        rows,
        PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX,
        ['tenantId', 'matchResolutionClientEventId'],
        true,
    );
}

export function inspectProcurementPhaseTwoBIndex(
    rows: ProcurementPhaseTwoBIndexRow[],
    expectedName: string,
    expectedColumns: string[],
    unique: boolean,
): SchemaObjectState {
    return inspectExactIndex(rows, expectedName, expectedColumns, unique);
}

export function inspectProcurementPhaseTwoBForeignKey(
    rows: ProcurementPhaseTwoBForeignKeyRow[],
    expected: {
        constraintName: string;
        columnName: string;
        referencedTableName: string;
        deleteRule: 'CASCADE' | 'RESTRICT';
    },
): SchemaObjectState {
    const matches = rows.filter(row => (
        row.constraintName === expected.constraintName || row.columnName === expected.columnName
    ));
    if (matches.length === 0) return 'missing';
    if (matches.length !== 1) return 'invalid';

    const [row] = matches;
    return row.constraintName === expected.constraintName
        && row.columnName === expected.columnName
        && row.referencedTableName === expected.referencedTableName
        && row.referencedColumnName === 'id'
        && Number(row.ordinalPosition) === 1
        && row.deleteRule.toUpperCase() === expected.deleteRule
        && row.updateRule.toUpperCase() === 'CASCADE'
        ? 'valid'
        : 'invalid';
}

export function inspectCashCloseJournalColumn(
    rows: CashCloseJournalColumnRow[],
    expected: ProcurementPhaseTwoBColumnContract,
): SchemaObjectState {
    return inspectProcurementPhaseTwoBColumn(rows, expected);
}

export function inspectCashCloseJournalIndex(
    rows: CashCloseJournalIndexRow[],
    expectedName: string,
    expectedColumns: string[],
): SchemaObjectState {
    return inspectProcurementPhaseTwoBIndex(rows, expectedName, expectedColumns, true);
}

export function inspectCashCloseJournalForeignKey(
    rows: CashCloseJournalForeignKeyRow[],
): SchemaObjectState {
    return inspectProcurementPhaseTwoBForeignKey(rows, {
        constraintName: JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY,
        columnName: 'reversalOfId',
        referencedTableName: 'JournalEntry',
        deleteRule: 'RESTRICT',
    });
}

export function inspectProcurementPhaseTwoCColumn(
    rows: ProcurementPhaseTwoCColumnRow[],
    expected: ProcurementPhaseTwoCColumnContract,
): SchemaObjectState {
    return inspectProcurementPhaseTwoBColumn(rows, expected);
}

export function inspectProcurementPhaseTwoCIndex(
    rows: ProcurementPhaseTwoCIndexRow[],
    expectedName: string,
    expectedColumns: string[],
    unique: boolean,
): SchemaObjectState {
    return inspectProcurementPhaseTwoBIndex(rows, expectedName, expectedColumns, unique);
}

export function inspectProcurementPhaseTwoCForeignKey(
    rows: ProcurementPhaseTwoCForeignKeyRow[],
    expected: {
        constraintName: string;
        columnName: string;
        referencedTableName: string;
        deleteRule: 'CASCADE' | 'RESTRICT';
    },
): SchemaObjectState {
    return inspectProcurementPhaseTwoBForeignKey(rows, expected);
}

export function inspectPharmacyInventoryColumn(
    rows: PharmacyInventoryColumnRow[],
    expected: PharmacyInventoryColumnContract,
): SchemaObjectState {
    return inspectProcurementPhaseTwoBColumn(rows, expected);
}

export function inspectPharmacyInventoryIndex(
    rows: PharmacyInventoryIndexRow[],
    expectedName: string,
    expectedColumns: string[],
    unique: boolean,
): SchemaObjectState {
    return inspectProcurementPhaseTwoBIndex(rows, expectedName, expectedColumns, unique);
}

export function inspectPharmacyInventoryForeignKey(
    rows: PharmacyInventoryForeignKeyRow[],
    expected: {
        constraintName: string;
        columnName: string;
        referencedTableName: string;
        deleteRule: 'CASCADE' | 'RESTRICT';
    },
): SchemaObjectState {
    return inspectProcurementPhaseTwoBForeignKey(rows, expected);
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

async function productReturnTableExists(db: DeploySchemaClient): Promise<boolean> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'ProductReturn'
        LIMIT 1
    `);
    return rows.length === 1;
}

async function paymentTableExists(db: DeploySchemaClient): Promise<boolean> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'Payment'
        LIMIT 1
    `);
    return rows.length === 1;
}

async function retencionSufridaTableExists(db: DeploySchemaClient): Promise<boolean> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'RetencionSufrida'
        LIMIT 1
    `);
    return rows.length === 1;
}

async function purchaseTableExists(db: DeploySchemaClient): Promise<boolean> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'Purchase'
        LIMIT 1
    `);
    return rows.length === 1;
}

async function productBatchHoldTableExists(db: DeploySchemaClient): Promise<boolean> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'ProductBatchHold'
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

async function readProductReturnColumn(
    db: DeploySchemaClient,
    columnName: 'clientEventId' | 'payloadHash' | 'correctionRequestId' | 'returnNumber',
): Promise<ProductReturnColumnRow[]> {
    return db.query<ProductReturnColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'ProductReturn'
          AND COLUMN_NAME = ${columnName}
    `);
}

async function readProductReturnTenantIdColumn(
    db: DeploySchemaClient,
): Promise<ProductReturnColumnRow[]> {
    return db.query<ProductReturnColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'ProductReturn'
          AND COLUMN_NAME = 'tenantId'
    `);
}

async function readProductReturnIndex(
    db: DeploySchemaClient,
    indexName:
        | typeof PRODUCT_RETURN_IDEMPOTENCY_INDEX
        | typeof PRODUCT_RETURN_CORRECTION_REQUEST_UNIQUE_INDEX
        | typeof PRODUCT_RETURN_NUMBER_UNIQUE_INDEX,
): Promise<ProductReturnIndexRow[]> {
    return db.query<ProductReturnIndexRow[]>(Prisma.sql`
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
          AND INDEX_NAME = ${indexName}
        ORDER BY SEQ_IN_INDEX
    `);
}

async function readPaymentColumn(
    db: DeploySchemaClient,
    columnName: 'clientEventId' | 'payloadHash',
): Promise<PaymentColumnRow[]> {
    return db.query<PaymentColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'Payment'
          AND COLUMN_NAME = ${columnName}
    `);
}

async function readPaymentSaleIdColumn(
    db: DeploySchemaClient,
): Promise<PaymentColumnRow[]> {
    return db.query<PaymentColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'Payment'
          AND COLUMN_NAME = 'saleId'
    `);
}

async function readPaymentIdempotencyIndex(
    db: DeploySchemaClient,
): Promise<PaymentIndexRow[]> {
    return db.query<PaymentIndexRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'Payment'
          AND INDEX_NAME = ${PAYMENT_IDEMPOTENCY_INDEX}
        ORDER BY SEQ_IN_INDEX
    `);
}

async function readRetencionSufridaColumn(
    db: DeploySchemaClient,
    columnName: 'clientEventId' | 'payloadHash',
): Promise<RetencionSufridaColumnRow[]> {
    return db.query<RetencionSufridaColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'RetencionSufrida'
          AND COLUMN_NAME = ${columnName}
    `);
}

async function readRetencionSufridaTenantIdColumn(
    db: DeploySchemaClient,
): Promise<RetencionSufridaColumnRow[]> {
    return db.query<RetencionSufridaColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'RetencionSufrida'
          AND COLUMN_NAME = 'tenantId'
    `);
}

async function readRetencionSufridaIdempotencyIndex(
    db: DeploySchemaClient,
): Promise<RetencionSufridaIndexRow[]> {
    return db.query<RetencionSufridaIndexRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'RetencionSufrida'
          AND INDEX_NAME = ${RETENCION_SUFRIDA_IDEMPOTENCY_INDEX}
        ORDER BY SEQ_IN_INDEX
    `);
}

async function readPurchaseInvoiceUniqueIndex(
    db: DeploySchemaClient,
): Promise<PurchaseInvoiceIndexRow[]> {
    return db.query<PurchaseInvoiceIndexRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'Purchase'
          AND INDEX_NAME = ${PURCHASE_INVOICE_UNIQUE_INDEX}
        ORDER BY SEQ_IN_INDEX
    `);
}

async function readPurchaseMatchResolutionColumn(
    db: DeploySchemaClient,
    columnName: 'matchResolutionClientEventId' | 'matchResolutionPayloadHash',
): Promise<PurchaseMatchResolutionColumnRow[]> {
    return db.query<PurchaseMatchResolutionColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'Purchase'
          AND COLUMN_NAME = ${columnName}
    `);
}

async function readPurchaseTenantIdColumn(
    db: DeploySchemaClient,
): Promise<PurchaseMatchResolutionColumnRow[]> {
    return db.query<PurchaseMatchResolutionColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'Purchase'
          AND COLUMN_NAME = 'tenantId'
    `);
}

async function readPurchaseMatchResolutionIdempotencyIndex(
    db: DeploySchemaClient,
): Promise<PurchaseMatchResolutionIndexRow[]> {
    return db.query<PurchaseMatchResolutionIndexRow[]>(Prisma.sql`
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
          AND TABLE_NAME = 'Purchase'
          AND INDEX_NAME = ${PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX}
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

async function assertProductReturnEventsAreUnique(db: DeploySchemaClient): Promise<void> {
    const duplicates = await db.query<DuplicateProductReturnEventRow[]>(Prisma.sql`
        SELECT tenantId, clientEventId, COUNT(*) AS duplicateCount
        FROM ${PRODUCT_RETURN_TABLE_SQL}
        WHERE clientEventId IS NOT NULL
        GROUP BY tenantId, clientEventId
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length === 0) return;

    const detail = duplicates
        .map(row => `${row.tenantId}/${row.clientEventId} (${String(row.duplicateCount)})`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `Hay devoluciones con clientEventId duplicado; no se creará el índice único: ${detail}`,
    );
}

async function assertProductReturnCorrectionsAreUnique(db: DeploySchemaClient): Promise<void> {
    const duplicates = await db.query<DuplicateProductReturnCorrectionRow[]>(Prisma.sql`
        SELECT correctionRequestId, COUNT(*) AS duplicateCount
        FROM ${PRODUCT_RETURN_TABLE_SQL}
        WHERE correctionRequestId IS NOT NULL
        GROUP BY correctionRequestId
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length === 0) return;

    const detail = duplicates
        .map(row => `${row.correctionRequestId} (${String(row.duplicateCount)})`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `Hay devoluciones con correctionRequestId duplicado; no se creará el índice único: ${detail}`,
    );
}

async function assertProductReturnNumbersAreUnique(db: DeploySchemaClient): Promise<void> {
    const duplicates = await db.query<DuplicateProductReturnNumberRow[]>(Prisma.sql`
        SELECT tenantId, returnNumber, COUNT(*) AS duplicateCount
        FROM ${PRODUCT_RETURN_TABLE_SQL}
        WHERE returnNumber IS NOT NULL
        GROUP BY tenantId, returnNumber
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length === 0) return;

    const detail = duplicates
        .map(row => `${row.tenantId}/${String(row.returnNumber)} (${String(row.duplicateCount)})`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `Hay devoluciones con returnNumber duplicado por tenant; no se creará el índice único: ${detail}`,
    );
}

type ProductReturnNullableColumn =
    | 'clientEventId'
    | 'payloadHash'
    | 'correctionRequestId'
    | 'returnNumber';

function inspectProductReturnColumn(
    columnName: ProductReturnNullableColumn,
    rows: ProductReturnColumnRow[],
): SchemaObjectState {
    if (columnName === 'clientEventId') return inspectProductReturnClientEventIdColumn(rows);
    if (columnName === 'payloadHash') return inspectProductReturnPayloadHashColumn(rows);
    if (columnName === 'correctionRequestId') {
        return inspectProductReturnCorrectionRequestIdColumn(rows);
    }
    return inspectProductReturnReturnNumberColumn(rows);
}

async function ensureProductReturnColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    columnName: ProductReturnNullableColumn,
): Promise<void> {
    const initialState = inspectProductReturnColumn(
        columnName,
        await readProductReturnColumn(db, columnName),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `ProductReturn.${columnName} existe con una definición incompatible; se requiere intervención manual.`,
        );
    }

    if (initialState === 'missing') {
        const columnType = columnName === 'clientEventId'
            ? 'VARCHAR(128)'
            : columnName === 'payloadHash'
                ? 'VARCHAR(64)'
                : columnName === 'correctionRequestId'
                    ? 'VARCHAR(191)'
                    : 'INTEGER';
        logger.info(`Aplicando DDL seguro: ProductReturn.${columnName} ${columnType} NULL.`);
        try {
            if (columnName === 'clientEventId') {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PRODUCT_RETURN_TABLE_SQL}
                    ADD COLUMN ${CLIENT_EVENT_ID_COLUMN_SQL} VARCHAR(128) NULL
                `);
            } else if (columnName === 'payloadHash') {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PRODUCT_RETURN_TABLE_SQL}
                    ADD COLUMN ${PAYLOAD_HASH_COLUMN_SQL} VARCHAR(64) NULL
                `);
            } else if (columnName === 'correctionRequestId') {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PRODUCT_RETURN_TABLE_SQL}
                    ADD COLUMN ${CORRECTION_REQUEST_ID_COLUMN_SQL} VARCHAR(191) NULL
                `);
            } else {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PRODUCT_RETURN_TABLE_SQL}
                    ADD COLUMN ${RETURN_NUMBER_COLUMN_SQL} INTEGER NULL
                `);
            }
        } catch (error) {
            const concurrentState = inspectProductReturnColumn(
                columnName,
                await readProductReturnColumn(db, columnName),
            );
            if (concurrentState !== 'valid') throw error;
            logger.warn(`ProductReturn.${columnName} fue creada concurrentemente; definición verificada.`);
        }
    }

    const finalColumn = await readProductReturnColumn(db, columnName);
    if (inspectProductReturnColumn(columnName, finalColumn) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ProductReturn.${columnName}.`,
        );
    }

    if (columnName !== 'returnNumber') {
        const tenantIdColumn = await readProductReturnTenantIdColumn(db);
        if (!columnsUseSameEncoding(finalColumn, tenantIdColumn)) {
            throw new UnsafeSchemaStateError(
                `ProductReturn.${columnName} no usa el mismo charset/collation que ProductReturn.tenantId.`,
            );
        }
    }
}

interface ProductReturnUniqueIndexDefinition {
    name:
        | typeof PRODUCT_RETURN_IDEMPOTENCY_INDEX
        | typeof PRODUCT_RETURN_CORRECTION_REQUEST_UNIQUE_INDEX
        | typeof PRODUCT_RETURN_NUMBER_UNIQUE_INDEX;
    statement: Prisma.Sql;
    inspect(rows: ProductReturnIndexRow[]): SchemaObjectState;
    assertUnique(db: DeploySchemaClient): Promise<void>;
}

const PRODUCT_RETURN_UNIQUE_INDEX_DEFINITIONS: ProductReturnUniqueIndexDefinition[] = [
    {
        name: PRODUCT_RETURN_IDEMPOTENCY_INDEX,
        statement: Prisma.sql`
            CREATE UNIQUE INDEX ${PRODUCT_RETURN_IDEMPOTENCY_INDEX_SQL}
            ON ${PRODUCT_RETURN_TABLE_SQL}(${TENANT_ID_COLUMN_SQL}, ${CLIENT_EVENT_ID_COLUMN_SQL})
        `,
        inspect: inspectProductReturnIdempotencyIndex,
        assertUnique: assertProductReturnEventsAreUnique,
    },
    {
        name: PRODUCT_RETURN_CORRECTION_REQUEST_UNIQUE_INDEX,
        statement: Prisma.sql`
            CREATE UNIQUE INDEX ${PRODUCT_RETURN_CORRECTION_REQUEST_UNIQUE_INDEX_SQL}
            ON ${PRODUCT_RETURN_TABLE_SQL}(${CORRECTION_REQUEST_ID_COLUMN_SQL})
        `,
        inspect: inspectProductReturnCorrectionRequestIndex,
        assertUnique: assertProductReturnCorrectionsAreUnique,
    },
    {
        name: PRODUCT_RETURN_NUMBER_UNIQUE_INDEX,
        statement: Prisma.sql`
            CREATE UNIQUE INDEX ${PRODUCT_RETURN_NUMBER_UNIQUE_INDEX_SQL}
            ON ${PRODUCT_RETURN_TABLE_SQL}(${TENANT_ID_COLUMN_SQL}, ${RETURN_NUMBER_COLUMN_SQL})
        `,
        inspect: inspectProductReturnNumberIndex,
        assertUnique: assertProductReturnNumbersAreUnique,
    },
];

async function ensureProductReturnUniqueIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: ProductReturnUniqueIndexDefinition,
): Promise<void> {
    const initialState = definition.inspect(await readProductReturnIndex(db, definition.name));
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${definition.name} existe con columnas u opciones incompatibles.`,
        );
    }

    if (initialState === 'missing') {
        logger.info(`Aplicando DDL seguro: índice único ${definition.name}.`);
        try {
            await db.execute(definition.statement);
        } catch (error) {
            if (definition.inspect(await readProductReturnIndex(db, definition.name)) !== 'valid') {
                await definition.assertUnique(db);
                throw error;
            }
            logger.warn(`${definition.name} fue creado concurrentemente; definición verificada.`);
        }
    }

    if (definition.inspect(await readProductReturnIndex(db, definition.name)) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${definition.name}.`,
        );
    }
}

export async function applyProductReturnSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    if (!await productReturnTableExists(db)) {
        logger.info('Preflight DDL: ProductReturn aún no existe; db push creará su schema completo.');
        return;
    }

    await ensureProductReturnColumn(db, logger, 'clientEventId');
    await ensureProductReturnColumn(db, logger, 'payloadHash');
    await ensureProductReturnColumn(db, logger, 'correctionRequestId');
    await ensureProductReturnColumn(db, logger, 'returnNumber');
    for (const definition of PRODUCT_RETURN_UNIQUE_INDEX_DEFINITIONS) {
        await definition.assertUnique(db);
    }
    for (const definition of PRODUCT_RETURN_UNIQUE_INDEX_DEFINITIONS) {
        await ensureProductReturnUniqueIndex(db, logger, definition);
    }
    for (const definition of PRODUCT_RETURN_UNIQUE_INDEX_DEFINITIONS) {
        await definition.assertUnique(db);
    }
    logger.info(
        'Preflight DDL verificado: idempotencia y numeración de ProductReturn listas sin alterar históricos.',
    );
}

async function assertPaymentEventsAreUnique(db: DeploySchemaClient): Promise<void> {
    const duplicates = await db.query<DuplicatePaymentEventRow[]>(Prisma.sql`
        SELECT saleId, clientEventId, COUNT(*) AS duplicateCount
        FROM ${PAYMENT_TABLE_SQL}
        WHERE clientEventId IS NOT NULL
        GROUP BY saleId, clientEventId
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length === 0) return;

    const detail = duplicates
        .map(row => `${row.saleId}/${row.clientEventId} (${String(row.duplicateCount)})`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `Hay abonos con clientEventId duplicado; no se creará el índice único: ${detail}`,
    );
}

type PaymentNullableColumn = 'clientEventId' | 'payloadHash';

function inspectPaymentColumn(
    columnName: PaymentNullableColumn,
    rows: PaymentColumnRow[],
): SchemaObjectState {
    return columnName === 'clientEventId'
        ? inspectPaymentClientEventIdColumn(rows)
        : inspectPaymentPayloadHashColumn(rows);
}

async function ensurePaymentColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    columnName: PaymentNullableColumn,
): Promise<void> {
    const initialState = inspectPaymentColumn(
        columnName,
        await readPaymentColumn(db, columnName),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `Payment.${columnName} existe con una definición incompatible; se requiere intervención manual.`,
        );
    }

    if (initialState === 'missing') {
        const length = columnName === 'clientEventId' ? 128 : 64;
        logger.info(`Aplicando DDL seguro: Payment.${columnName} VARCHAR(${length}) NULL.`);
        try {
            if (columnName === 'clientEventId') {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PAYMENT_TABLE_SQL}
                    ADD COLUMN ${CLIENT_EVENT_ID_COLUMN_SQL} VARCHAR(128) NULL
                `);
            } else {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PAYMENT_TABLE_SQL}
                    ADD COLUMN ${PAYLOAD_HASH_COLUMN_SQL} VARCHAR(64) NULL
                `);
            }
        } catch (error) {
            const concurrentState = inspectPaymentColumn(
                columnName,
                await readPaymentColumn(db, columnName),
            );
            if (concurrentState !== 'valid') throw error;
            logger.warn(`Payment.${columnName} fue creada concurrentemente; definición verificada.`);
        }
    }

    const finalColumn = await readPaymentColumn(db, columnName);
    if (inspectPaymentColumn(columnName, finalColumn) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de Payment.${columnName}.`,
        );
    }

    const saleIdColumn = await readPaymentSaleIdColumn(db);
    if (!columnsUseSameEncoding(finalColumn, saleIdColumn)) {
        throw new UnsafeSchemaStateError(
            `Payment.${columnName} no usa el mismo charset/collation que Payment.saleId.`,
        );
    }
}

async function ensurePaymentIdempotencyIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const initialState = inspectPaymentIdempotencyIndex(
        await readPaymentIdempotencyIndex(db),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${PAYMENT_IDEMPOTENCY_INDEX} existe con columnas u opciones incompatibles.`,
        );
    }

    if (initialState === 'missing') {
        logger.info(`Aplicando DDL seguro: índice único ${PAYMENT_IDEMPOTENCY_INDEX}.`);
        try {
            await db.execute(Prisma.sql`
                CREATE UNIQUE INDEX ${PAYMENT_IDEMPOTENCY_INDEX_SQL}
                ON ${PAYMENT_TABLE_SQL}(${SALE_ID_COLUMN_SQL}, ${CLIENT_EVENT_ID_COLUMN_SQL})
            `);
        } catch (error) {
            if (inspectPaymentIdempotencyIndex(
                await readPaymentIdempotencyIndex(db),
            ) !== 'valid') {
                await assertPaymentEventsAreUnique(db);
                throw error;
            }
            logger.warn(`${PAYMENT_IDEMPOTENCY_INDEX} fue creado concurrentemente; definición verificada.`);
        }
    }

    if (inspectPaymentIdempotencyIndex(
        await readPaymentIdempotencyIndex(db),
    ) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${PAYMENT_IDEMPOTENCY_INDEX}.`,
        );
    }
}

export async function applyPaymentSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    if (!await paymentTableExists(db)) {
        logger.info('Preflight DDL: Payment aún no existe; db push creará su schema completo.');
        return;
    }

    await ensurePaymentColumn(db, logger, 'clientEventId');
    await ensurePaymentColumn(db, logger, 'payloadHash');
    await assertPaymentEventsAreUnique(db);
    await ensurePaymentIdempotencyIndex(db, logger);
    await assertPaymentEventsAreUnique(db);
    logger.info('Preflight DDL verificado: idempotencia de Payment lista sin alterar históricos.');
}

async function assertRetencionSufridaEventsAreUnique(db: DeploySchemaClient): Promise<void> {
    const duplicates = await db.query<DuplicateRetencionSufridaEventRow[]>(Prisma.sql`
        SELECT tenantId, clientEventId, COUNT(*) AS duplicateCount
        FROM ${RETENCION_SUFRIDA_TABLE_SQL}
        WHERE clientEventId IS NOT NULL
        GROUP BY tenantId, clientEventId
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length === 0) return;

    const detail = duplicates
        .map(row => `${row.tenantId}/${row.clientEventId} (${String(row.duplicateCount)})`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `Hay retenciones sufridas con clientEventId duplicado; no se creará el índice único: ${detail}`,
    );
}

type RetencionSufridaNullableColumn = 'clientEventId' | 'payloadHash';

function inspectRetencionSufridaColumn(
    columnName: RetencionSufridaNullableColumn,
    rows: RetencionSufridaColumnRow[],
): SchemaObjectState {
    return columnName === 'clientEventId'
        ? inspectRetencionSufridaClientEventIdColumn(rows)
        : inspectRetencionSufridaPayloadHashColumn(rows);
}

async function ensureRetencionSufridaColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    columnName: RetencionSufridaNullableColumn,
): Promise<void> {
    const initialState = inspectRetencionSufridaColumn(
        columnName,
        await readRetencionSufridaColumn(db, columnName),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `RetencionSufrida.${columnName} existe con una definición incompatible; se requiere intervención manual.`,
        );
    }

    if (initialState === 'missing') {
        const length = columnName === 'clientEventId' ? 128 : 64;
        logger.info(`Aplicando DDL seguro: RetencionSufrida.${columnName} VARCHAR(${length}) NULL.`);
        try {
            if (columnName === 'clientEventId') {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${RETENCION_SUFRIDA_TABLE_SQL}
                    ADD COLUMN ${CLIENT_EVENT_ID_COLUMN_SQL} VARCHAR(128) NULL
                `);
            } else {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${RETENCION_SUFRIDA_TABLE_SQL}
                    ADD COLUMN ${PAYLOAD_HASH_COLUMN_SQL} VARCHAR(64) NULL
                `);
            }
        } catch (error) {
            const concurrentState = inspectRetencionSufridaColumn(
                columnName,
                await readRetencionSufridaColumn(db, columnName),
            );
            if (concurrentState !== 'valid') throw error;
            logger.warn(`RetencionSufrida.${columnName} fue creada concurrentemente; definición verificada.`);
        }
    }

    const finalColumn = await readRetencionSufridaColumn(db, columnName);
    if (inspectRetencionSufridaColumn(columnName, finalColumn) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de RetencionSufrida.${columnName}.`,
        );
    }

    const tenantIdColumn = await readRetencionSufridaTenantIdColumn(db);
    if (!columnsUseSameEncoding(finalColumn, tenantIdColumn)) {
        throw new UnsafeSchemaStateError(
            `RetencionSufrida.${columnName} no usa el mismo charset/collation que RetencionSufrida.tenantId.`,
        );
    }
}

async function ensureRetencionSufridaIdempotencyIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const initialState = inspectRetencionSufridaIdempotencyIndex(
        await readRetencionSufridaIdempotencyIndex(db),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${RETENCION_SUFRIDA_IDEMPOTENCY_INDEX} existe con columnas u opciones incompatibles.`,
        );
    }

    if (initialState === 'missing') {
        logger.info(`Aplicando DDL seguro: índice único ${RETENCION_SUFRIDA_IDEMPOTENCY_INDEX}.`);
        try {
            await db.execute(Prisma.sql`
                CREATE UNIQUE INDEX ${RETENCION_SUFRIDA_IDEMPOTENCY_INDEX_SQL}
                ON ${RETENCION_SUFRIDA_TABLE_SQL}(${TENANT_ID_COLUMN_SQL}, ${CLIENT_EVENT_ID_COLUMN_SQL})
            `);
        } catch (error) {
            if (inspectRetencionSufridaIdempotencyIndex(
                await readRetencionSufridaIdempotencyIndex(db),
            ) !== 'valid') {
                await assertRetencionSufridaEventsAreUnique(db);
                throw error;
            }
            logger.warn(`${RETENCION_SUFRIDA_IDEMPOTENCY_INDEX} fue creado concurrentemente; definición verificada.`);
        }
    }

    if (inspectRetencionSufridaIdempotencyIndex(
        await readRetencionSufridaIdempotencyIndex(db),
    ) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${RETENCION_SUFRIDA_IDEMPOTENCY_INDEX}.`,
        );
    }
}

export async function applyRetencionSufridaSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    if (!await retencionSufridaTableExists(db)) {
        logger.info('Preflight DDL: RetencionSufrida aún no existe; db push creará su schema completo.');
        return;
    }

    await ensureRetencionSufridaColumn(db, logger, 'clientEventId');
    await ensureRetencionSufridaColumn(db, logger, 'payloadHash');
    await assertRetencionSufridaEventsAreUnique(db);
    await ensureRetencionSufridaIdempotencyIndex(db, logger);
    await assertRetencionSufridaEventsAreUnique(db);
    logger.info('Preflight DDL verificado: idempotencia de RetencionSufrida lista sin alterar históricos.');
}

async function assertPurchaseInvoicesAreUnique(db: DeploySchemaClient): Promise<void> {
    const duplicates = await db.query<DuplicatePurchaseInvoiceRow[]>(Prisma.sql`
        SELECT tenantId, supplierId, invoiceNumber, COUNT(*) AS duplicateCount
        FROM ${PURCHASE_TABLE_SQL}
        GROUP BY tenantId, supplierId, invoiceNumber
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length === 0) return;

    const rows = duplicates.reduce(
        (total, row) => total + BigInt(row.duplicateCount),
        0n,
    );
    throw new UnsafeSchemaStateError(
        `Hay ${duplicates.length} grupo(s) de facturas de proveedor duplicadas (${String(rows)} filas); `
        + 'no se creará el índice único ni se alterarán datos.',
    );
}

async function ensurePurchaseInvoiceUniqueIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const initialState = inspectPurchaseInvoiceUniqueIndex(
        await readPurchaseInvoiceUniqueIndex(db),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${PURCHASE_INVOICE_UNIQUE_INDEX} existe con columnas u opciones incompatibles.`,
        );
    }

    if (initialState === 'missing') {
        // La validación previa evita intentar un DDL que sabemos inseguro. El
        // propio UNIQUE protege la carrera entre esta lectura y CREATE INDEX.
        await assertPurchaseInvoicesAreUnique(db);
        logger.info(`Aplicando DDL seguro: índice único ${PURCHASE_INVOICE_UNIQUE_INDEX}.`);
        try {
            await db.execute(Prisma.sql`
                CREATE UNIQUE INDEX ${PURCHASE_INVOICE_UNIQUE_INDEX_SQL}
                ON ${PURCHASE_TABLE_SQL}(
                    ${TENANT_ID_COLUMN_SQL},
                    ${SUPPLIER_ID_COLUMN_SQL},
                    ${INVOICE_NUMBER_COLUMN_SQL}
                )
            `);
        } catch (error) {
            if (inspectPurchaseInvoiceUniqueIndex(
                await readPurchaseInvoiceUniqueIndex(db),
            ) !== 'valid') {
                await assertPurchaseInvoicesAreUnique(db);
                throw error;
            }
            logger.warn(`${PURCHASE_INVOICE_UNIQUE_INDEX} fue creado concurrentemente; definición verificada.`);
        }
    }

    if (inspectPurchaseInvoiceUniqueIndex(
        await readPurchaseInvoiceUniqueIndex(db),
    ) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${PURCHASE_INVOICE_UNIQUE_INDEX}.`,
        );
    }
}

export async function applyPurchaseInvoiceSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    if (!await purchaseTableExists(db)) {
        logger.info('Preflight DDL: Purchase aún no existe; db push creará su schema completo.');
        return;
    }

    await assertPurchaseInvoicesAreUnique(db);
    await ensurePurchaseInvoiceUniqueIndex(db, logger);
    await assertPurchaseInvoicesAreUnique(db);
    logger.info('Preflight DDL verificado: unicidad de facturas de proveedor lista sin alterar históricos.');
}

type PurchaseMatchResolutionNullableColumn =
    | 'matchResolutionClientEventId'
    | 'matchResolutionPayloadHash';

function inspectPurchaseMatchResolutionColumn(
    columnName: PurchaseMatchResolutionNullableColumn,
    rows: PurchaseMatchResolutionColumnRow[],
): SchemaObjectState {
    return columnName === 'matchResolutionClientEventId'
        ? inspectPurchaseMatchResolutionClientEventIdColumn(rows)
        : inspectPurchaseMatchResolutionPayloadHashColumn(rows);
}

async function ensurePurchaseMatchResolutionColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    columnName: PurchaseMatchResolutionNullableColumn,
): Promise<void> {
    const initialState = inspectPurchaseMatchResolutionColumn(
        columnName,
        await readPurchaseMatchResolutionColumn(db, columnName),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `Purchase.${columnName} existe con una definición incompatible; se requiere intervención manual.`,
        );
    }

    if (initialState === 'missing') {
        const length = columnName === 'matchResolutionClientEventId' ? 128 : 64;
        logger.info(`Aplicando DDL seguro: Purchase.${columnName} VARCHAR(${length}) NULL.`);
        try {
            if (columnName === 'matchResolutionClientEventId') {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PURCHASE_TABLE_SQL}
                    ADD COLUMN ${MATCH_RESOLUTION_CLIENT_EVENT_ID_COLUMN_SQL} VARCHAR(128) NULL
                `);
            } else {
                await db.execute(Prisma.sql`
                    ALTER TABLE ${PURCHASE_TABLE_SQL}
                    ADD COLUMN ${MATCH_RESOLUTION_PAYLOAD_HASH_COLUMN_SQL} VARCHAR(64) NULL
                `);
            }
        } catch (error) {
            const concurrentState = inspectPurchaseMatchResolutionColumn(
                columnName,
                await readPurchaseMatchResolutionColumn(db, columnName),
            );
            if (concurrentState !== 'valid') throw error;
            logger.warn(`Purchase.${columnName} fue creada concurrentemente; definición verificada.`);
        }
    }

    const finalColumn = await readPurchaseMatchResolutionColumn(db, columnName);
    if (inspectPurchaseMatchResolutionColumn(columnName, finalColumn) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de Purchase.${columnName}.`,
        );
    }

    const tenantIdColumn = await readPurchaseTenantIdColumn(db);
    if (!columnsUseSameEncoding(finalColumn, tenantIdColumn)) {
        throw new UnsafeSchemaStateError(
            `Purchase.${columnName} no usa el mismo charset/collation que Purchase.tenantId.`,
        );
    }
}

async function assertPurchaseMatchResolutionEventsAreUnique(
    db: DeploySchemaClient,
): Promise<void> {
    const duplicates = await db.query<DuplicatePurchaseMatchResolutionEventRow[]>(Prisma.sql`
        SELECT tenantId, matchResolutionClientEventId, COUNT(*) AS duplicateCount
        FROM ${PURCHASE_TABLE_SQL}
        WHERE matchResolutionClientEventId IS NOT NULL
        GROUP BY tenantId, matchResolutionClientEventId
        HAVING COUNT(*) > 1
        LIMIT 10
    `);

    if (duplicates.length === 0) return;

    const rows = duplicates.reduce(
        (total, row) => total + BigInt(row.duplicateCount),
        0n,
    );
    throw new UnsafeSchemaStateError(
        `Hay ${duplicates.length} grupo(s) de resoluciones de matching duplicadas (${String(rows)} filas); `
        + 'no se creará el índice único ni se alterarán datos.',
    );
}

async function ensurePurchaseMatchResolutionIdempotencyIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const initialState = inspectPurchaseMatchResolutionIdempotencyIndex(
        await readPurchaseMatchResolutionIdempotencyIndex(db),
    );
    if (initialState === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX} existe con columnas u opciones incompatibles.`,
        );
    }

    if (initialState === 'missing') {
        await assertPurchaseMatchResolutionEventsAreUnique(db);
        logger.info(`Aplicando DDL seguro: índice único ${PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX}.`);
        try {
            await db.execute(Prisma.sql`
                CREATE UNIQUE INDEX ${PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX_SQL}
                ON ${PURCHASE_TABLE_SQL}(
                    ${TENANT_ID_COLUMN_SQL},
                    ${MATCH_RESOLUTION_CLIENT_EVENT_ID_COLUMN_SQL}
                )
            `);
        } catch (error) {
            if (inspectPurchaseMatchResolutionIdempotencyIndex(
                await readPurchaseMatchResolutionIdempotencyIndex(db),
            ) !== 'valid') {
                await assertPurchaseMatchResolutionEventsAreUnique(db);
                throw error;
            }
            logger.warn(`${PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX} fue creado concurrentemente; definición verificada.`);
        }
    }

    if (inspectPurchaseMatchResolutionIdempotencyIndex(
        await readPurchaseMatchResolutionIdempotencyIndex(db),
    ) !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${PURCHASE_MATCH_RESOLUTION_IDEMPOTENCY_INDEX}.`,
        );
    }
}

export async function applyPurchaseMatchResolutionSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    if (!await purchaseTableExists(db)) {
        logger.info('Preflight DDL: Purchase aún no existe; db push creará la idempotencia de matching.');
        return;
    }

    await ensurePurchaseMatchResolutionColumn(db, logger, 'matchResolutionClientEventId');
    await ensurePurchaseMatchResolutionColumn(db, logger, 'matchResolutionPayloadHash');
    await assertPurchaseMatchResolutionEventsAreUnique(db);
    await ensurePurchaseMatchResolutionIdempotencyIndex(db, logger);
    await assertPurchaseMatchResolutionEventsAreUnique(db);
    logger.info('Preflight DDL verificado: resolución idempotente de matching lista sin alterar históricos.');
}

type ProcurementPhaseTwoBBaseTable =
    | 'Tenant'
    | 'StockTransfer'
    | 'PurchaseOrderItem'
    | 'GoodsReceipt'
    | 'GoodsReceiptItem'
    | 'SaleItemBatchAllocation';

interface ProcurementPhaseTwoBColumnDefinition {
    tableName: ProcurementPhaseTwoBBaseTable;
    contract: ProcurementPhaseTwoBColumnContract;
    ddl: Prisma.Sql;
}

interface ProcurementPhaseTwoBIndexContract {
    name: string;
    columns: string[];
    unique: boolean;
}

interface ProcurementPhaseTwoBForeignKeyContract {
    constraintName: string;
    columnName: string;
    referencedTableName: string;
    deleteRule: 'CASCADE' | 'RESTRICT';
}

interface ProcurementPhaseTwoBTableContract {
    tableName:
        | 'ProductBatchWarehouseStock'
        | 'ProductBatchLedgerEntry'
        | 'PurchaseOrderCloseShort'
        | 'PurchaseOrderCloseShortItem';
    columns: ProcurementPhaseTwoBColumnContract[];
    indexes: ProcurementPhaseTwoBIndexContract[];
    foreignKeys: ProcurementPhaseTwoBForeignKeyContract[];
}

const PHASE_TWO_B_BASE_COLUMNS: ProcurementPhaseTwoBColumnDefinition[] = [
    {
        tableName: 'Tenant',
        contract: {
            columnName: 'batchWarehouseLedgerMode',
            columnType: 'varchar(16)',
            nullable: false,
            defaultValue: 'OFF',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`Tenant\`
            ADD COLUMN \`batchWarehouseLedgerMode\` VARCHAR(16) NOT NULL DEFAULT 'OFF'
        `,
    },
    {
        tableName: 'StockTransfer',
        contract: {
            columnName: 'clientEventId',
            columnType: 'varchar(128)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`StockTransfer\`
            ADD COLUMN \`clientEventId\` VARCHAR(128) NULL
        `,
    },
    {
        tableName: 'StockTransfer',
        contract: {
            columnName: 'payloadHash',
            columnType: 'varchar(64)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`StockTransfer\`
            ADD COLUMN \`payloadHash\` VARCHAR(64) NULL
        `,
    },
    {
        tableName: 'StockTransfer',
        contract: {
            columnName: 'payloadVersion',
            columnType: 'int',
            nullable: false,
            defaultValue: '1',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`StockTransfer\`
            ADD COLUMN \`payloadVersion\` INTEGER NOT NULL DEFAULT 1
        `,
    },
    {
        tableName: 'StockTransfer',
        contract: {
            columnName: 'batchLedgerMode',
            columnType: 'varchar(16)',
            nullable: false,
            defaultValue: 'OFF',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`StockTransfer\`
            ADD COLUMN \`batchLedgerMode\` VARCHAR(16) NOT NULL DEFAULT 'OFF'
        `,
    },
    {
        tableName: 'StockTransfer',
        contract: {
            columnName: 'batchTransferStatus',
            columnType: 'varchar(32)',
            nullable: false,
            defaultValue: 'OFF',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`StockTransfer\`
            ADD COLUMN \`batchTransferStatus\` VARCHAR(32) NOT NULL DEFAULT 'OFF'
        `,
    },
    {
        tableName: 'StockTransfer',
        contract: {
            columnName: 'batchSnapshot',
            columnType: 'json',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`StockTransfer\`
            ADD COLUMN \`batchSnapshot\` JSON NULL
        `,
    },
    {
        tableName: 'Tenant',
        contract: {
            columnName: 'batchWarehouseLedgerActivatedAt',
            columnType: 'datetime(3)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`Tenant\`
            ADD COLUMN \`batchWarehouseLedgerActivatedAt\` DATETIME(3) NULL
        `,
    },
    ...([
        'quantityRejectedExact',
        'quantityClosedShortExact',
    ] as const).map(columnName => ({
        tableName: 'PurchaseOrderItem' as const,
        contract: {
            columnName,
            columnType: 'decimal(18,4)',
            nullable: true,
            defaultValue: null,
        },
        ddl: columnName === 'quantityRejectedExact'
            ? Prisma.sql`
                ALTER TABLE \`PurchaseOrderItem\`
                ADD COLUMN \`quantityRejectedExact\` DECIMAL(18, 4) NULL
            `
            : Prisma.sql`
                ALTER TABLE \`PurchaseOrderItem\`
                ADD COLUMN \`quantityClosedShortExact\` DECIMAL(18, 4) NULL
            `,
    })),
    {
        tableName: 'GoodsReceipt',
        contract: {
            columnName: 'payloadVersion',
            columnType: 'int',
            nullable: false,
            defaultValue: '1',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`GoodsReceipt\`
            ADD COLUMN \`payloadVersion\` INTEGER NOT NULL DEFAULT 1
        `,
    },
    {
        tableName: 'GoodsReceipt',
        contract: {
            columnName: 'inspectionOutcome',
            columnType: 'varchar(32)',
            nullable: false,
            defaultValue: 'FULL_ACCEPT',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`GoodsReceipt\`
            ADD COLUMN \`inspectionOutcome\` VARCHAR(32) NOT NULL DEFAULT 'FULL_ACCEPT'
        `,
    },
    ...([
        'inspectedLineCount',
        'rejectedLineCount',
    ] as const).map(columnName => ({
        tableName: 'GoodsReceipt' as const,
        contract: {
            columnName,
            columnType: 'int',
            nullable: false,
            defaultValue: '0',
        },
        ddl: columnName === 'inspectedLineCount'
            ? Prisma.sql`
                ALTER TABLE \`GoodsReceipt\`
                ADD COLUMN \`inspectedLineCount\` INTEGER NOT NULL DEFAULT 0
            `
            : Prisma.sql`
                ALTER TABLE \`GoodsReceipt\`
                ADD COLUMN \`rejectedLineCount\` INTEGER NOT NULL DEFAULT 0
            `,
    })),
    {
        tableName: 'GoodsReceipt',
        contract: {
            columnName: 'hasSupplierFault',
            columnType: 'tinyint(1)',
            nullable: false,
            defaultValue: '0',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`GoodsReceipt\`
            ADD COLUMN \`hasSupplierFault\` BOOLEAN NOT NULL DEFAULT false
        `,
    },
    ...([
        'deliveredQuantityExact',
        'rejectedQuantityExact',
    ] as const).map(columnName => ({
        tableName: 'GoodsReceiptItem' as const,
        contract: {
            columnName,
            columnType: 'decimal(18,4)',
            nullable: true,
            defaultValue: null,
        },
        ddl: columnName === 'deliveredQuantityExact'
            ? Prisma.sql`
                ALTER TABLE \`GoodsReceiptItem\`
                ADD COLUMN \`deliveredQuantityExact\` DECIMAL(18, 4) NULL
            `
            : Prisma.sql`
                ALTER TABLE \`GoodsReceiptItem\`
                ADD COLUMN \`rejectedQuantityExact\` DECIMAL(18, 4) NULL
            `,
    })),
    {
        tableName: 'GoodsReceiptItem',
        contract: {
            columnName: 'rejectionReasonCode',
            columnType: 'varchar(32)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`GoodsReceiptItem\`
            ADD COLUMN \`rejectionReasonCode\` VARCHAR(32) NULL
        `,
    },
    {
        tableName: 'GoodsReceiptItem',
        contract: {
            columnName: 'rejectionNotes',
            columnType: 'text',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`GoodsReceiptItem\`
            ADD COLUMN \`rejectionNotes\` TEXT NULL
        `,
    },
    {
        tableName: 'GoodsReceiptItem',
        contract: {
            columnName: 'supplierFault',
            columnType: 'tinyint(1)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`GoodsReceiptItem\`
            ADD COLUMN \`supplierFault\` BOOLEAN NULL
        `,
    },
    {
        tableName: 'SaleItemBatchAllocation',
        contract: {
            columnName: 'warehouseId',
            columnType: 'varchar(191)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`SaleItemBatchAllocation\`
            ADD COLUMN \`warehouseId\` VARCHAR(191) NULL
        `,
    },
];

const idColumn = (columnName: string): ProcurementPhaseTwoBColumnContract => ({
    columnName,
    columnType: 'varchar(191)',
    nullable: false,
    defaultValue: null,
});
const requiredDecimal = (columnName: string): ProcurementPhaseTwoBColumnContract => ({
    columnName,
    columnType: 'decimal(18,4)',
    nullable: false,
    defaultValue: null,
});
const createdAtColumn = (): ProcurementPhaseTwoBColumnContract => ({
    columnName: 'createdAt',
    columnType: 'datetime(3)',
    nullable: false,
    defaultValue: 'current_timestamp(3)',
    extra: 'DEFAULT_GENERATED',
});

const PHASE_TWO_B_NEW_TABLES: ProcurementPhaseTwoBTableContract[] = [
    {
        tableName: 'ProductBatchWarehouseStock',
        columns: [
            idColumn('id'),
            idColumn('tenantId'),
            idColumn('productId'),
            idColumn('batchId'),
            idColumn('warehouseId'),
            {
                columnName: 'stock',
                columnType: 'decimal(18,4)',
                nullable: false,
                defaultValue: '0.0000',
            },
            createdAtColumn(),
            {
                columnName: 'updatedAt',
                columnType: 'datetime(3)',
                nullable: false,
                defaultValue: null,
            },
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            {
                name: 'ProductBatchWarehouseStock_tenantId_batchId_idx',
                columns: ['tenantId', 'batchId'],
                unique: false,
            },
            {
                name: 'ProductBatchWarehouseStock_tenantId_productId_warehouseId_idx',
                columns: ['tenantId', 'productId', 'warehouseId'],
                unique: false,
            },
            {
                name: 'ProductBatchWarehouseStock_tenantId_warehouseId_productId_idx',
                columns: ['tenantId', 'warehouseId', 'productId'],
                unique: false,
            },
            {
                name: PRODUCT_BATCH_WAREHOUSE_STOCK_UNIQUE_INDEX,
                columns: ['tenantId', 'batchId', 'warehouseId'],
                unique: true,
            },
        ],
        foreignKeys: [
            { constraintName: 'ProductBatchWarehouseStock_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'CASCADE' },
            { constraintName: 'ProductBatchWarehouseStock_productId_fkey', columnName: 'productId', referencedTableName: 'Product', deleteRule: 'RESTRICT' },
            { constraintName: 'ProductBatchWarehouseStock_batchId_fkey', columnName: 'batchId', referencedTableName: 'ProductBatch', deleteRule: 'RESTRICT' },
            { constraintName: 'ProductBatchWarehouseStock_warehouseId_fkey', columnName: 'warehouseId', referencedTableName: 'Warehouse', deleteRule: 'RESTRICT' },
        ],
    },
    {
        tableName: 'ProductBatchLedgerEntry',
        columns: [
            idColumn('id'),
            idColumn('tenantId'),
            idColumn('productId'),
            idColumn('batchId'),
            idColumn('warehouseId'),
            requiredDecimal('quantityDelta'),
            requiredDecimal('stockBefore'),
            requiredDecimal('stockAfter'),
            { columnName: 'movementType', columnType: 'varchar(32)', nullable: false, defaultValue: null },
            { columnName: 'status', columnType: 'varchar(32)', nullable: false, defaultValue: 'APPLIED' },
            { columnName: 'referenceId', columnType: 'varchar(191)', nullable: true, defaultValue: null },
            { columnName: 'referenceType', columnType: 'varchar(64)', nullable: true, defaultValue: null },
            { columnName: 'sourceKey', columnType: 'varchar(191)', nullable: false, defaultValue: null },
            { columnName: 'payloadHash', columnType: 'varchar(64)', nullable: false, defaultValue: null },
            { columnName: 'reason', columnType: 'text', nullable: true, defaultValue: null },
            idColumn('userId'),
            createdAtColumn(),
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: 'ProductBatchLedgerEntry_tenantId_batchId_createdAt_idx', columns: ['tenantId', 'batchId', 'createdAt'], unique: false },
            { name: 'ProductBatchLedgerEntry_tenantId_warehouseId_createdAt_idx', columns: ['tenantId', 'warehouseId', 'createdAt'], unique: false },
            { name: 'ProductBatchLedgerEntry_tenantId_productId_warehouseId_creat_idx', columns: ['tenantId', 'productId', 'warehouseId', 'createdAt'], unique: false },
            { name: 'ProductBatchLedgerEntry_tenantId_referenceType_referenceId_idx', columns: ['tenantId', 'referenceType', 'referenceId'], unique: false },
            { name: 'ProductBatchLedgerEntry_userId_idx', columns: ['userId'], unique: false },
            { name: PRODUCT_BATCH_LEDGER_SOURCE_UNIQUE_INDEX, columns: ['tenantId', 'sourceKey'], unique: true },
        ],
        foreignKeys: [
            { constraintName: 'ProductBatchLedgerEntry_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'CASCADE' },
            { constraintName: 'ProductBatchLedgerEntry_productId_fkey', columnName: 'productId', referencedTableName: 'Product', deleteRule: 'RESTRICT' },
            { constraintName: 'ProductBatchLedgerEntry_batchId_fkey', columnName: 'batchId', referencedTableName: 'ProductBatch', deleteRule: 'RESTRICT' },
            { constraintName: 'ProductBatchLedgerEntry_warehouseId_fkey', columnName: 'warehouseId', referencedTableName: 'Warehouse', deleteRule: 'RESTRICT' },
            { constraintName: 'ProductBatchLedgerEntry_userId_fkey', columnName: 'userId', referencedTableName: 'User', deleteRule: 'RESTRICT' },
        ],
    },
    {
        tableName: 'PurchaseOrderCloseShort',
        columns: [
            idColumn('id'),
            idColumn('tenantId'),
            idColumn('purchaseOrderId'),
            { columnName: 'status', columnType: 'varchar(32)', nullable: false, defaultValue: 'POSTED' },
            { columnName: 'clientEventId', columnType: 'varchar(128)', nullable: false, defaultValue: null },
            { columnName: 'payloadHash', columnType: 'varchar(64)', nullable: false, defaultValue: null },
            idColumn('closedBy'),
            { ...createdAtColumn(), columnName: 'closedAt' },
            createdAtColumn(),
            { columnName: 'lineCount', columnType: 'int', nullable: false, defaultValue: '0' },
            { columnName: 'closedLineCount', columnType: 'int', nullable: false, defaultValue: '0' },
            { columnName: 'hasSupplierFault', columnType: 'tinyint(1)', nullable: false, defaultValue: '0' },
            { columnName: 'reasonSummaryCode', columnType: 'varchar(32)', nullable: true, defaultValue: null },
            { columnName: 'note', columnType: 'text', nullable: true, defaultValue: null },
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: 'PurchaseOrderCloseShort_tenantId_purchaseOrderId_closedAt_idx', columns: ['tenantId', 'purchaseOrderId', 'closedAt'], unique: false },
            { name: 'PurchaseOrderCloseShort_closedBy_idx', columns: ['closedBy'], unique: false },
            { name: PURCHASE_ORDER_CLOSE_SHORT_EVENT_UNIQUE_INDEX, columns: ['tenantId', 'clientEventId'], unique: true },
        ],
        foreignKeys: [
            { constraintName: 'PurchaseOrderCloseShort_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'RESTRICT' },
            { constraintName: 'PurchaseOrderCloseShort_purchaseOrderId_fkey', columnName: 'purchaseOrderId', referencedTableName: 'PurchaseOrder', deleteRule: 'RESTRICT' },
            { constraintName: 'PurchaseOrderCloseShort_closedBy_fkey', columnName: 'closedBy', referencedTableName: 'User', deleteRule: 'RESTRICT' },
        ],
    },
    {
        tableName: 'PurchaseOrderCloseShortItem',
        columns: [
            idColumn('id'),
            idColumn('tenantId'),
            idColumn('closeShortId'),
            idColumn('purchaseOrderItemId'),
            requiredDecimal('quantityExact'),
            { columnName: 'reasonCode', columnType: 'varchar(32)', nullable: false, defaultValue: null },
            { columnName: 'supplierFault', columnType: 'tinyint(1)', nullable: true, defaultValue: null },
            { columnName: 'note', columnType: 'text', nullable: true, defaultValue: null },
            requiredDecimal('orderedQuantitySnapshotExact'),
            requiredDecimal('acceptedQuantitySnapshotExact'),
            requiredDecimal('rejectedQuantitySnapshotExact'),
            requiredDecimal('remainingBeforeExact'),
            requiredDecimal('remainingAfterExact'),
            { columnName: 'unitSnapshot', columnType: 'varchar(32)', nullable: false, defaultValue: null },
            { columnName: 'saleModeSnapshot', columnType: 'varchar(32)', nullable: true, defaultValue: null },
            { columnName: 'quantityStepSnapshot', columnType: 'decimal(18,4)', nullable: true, defaultValue: null },
            createdAtColumn(),
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: 'PurchaseOrderCloseShortItem_tenantId_closeShortId_idx', columns: ['tenantId', 'closeShortId'], unique: false },
            { name: 'PurchaseOrderCloseShortItem_tenantId_purchaseOrderItemId_idx', columns: ['tenantId', 'purchaseOrderItemId'], unique: false },
        ],
        foreignKeys: [
            { constraintName: 'PurchaseOrderCloseShortItem_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'RESTRICT' },
            { constraintName: 'PurchaseOrderCloseShortItem_closeShortId_fkey', columnName: 'closeShortId', referencedTableName: 'PurchaseOrderCloseShort', deleteRule: 'CASCADE' },
            { constraintName: 'PurchaseOrderCloseShortItem_purchaseOrderItemId_fkey', columnName: 'purchaseOrderItemId', referencedTableName: 'PurchaseOrderItem', deleteRule: 'RESTRICT' },
        ],
    },
];

async function readProcurementPhaseTwoBTables(
    db: DeploySchemaClient,
): Promise<Set<string>> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (
            'Tenant',
            'StockTransfer',
            'PurchaseOrderItem',
            'GoodsReceipt',
            'GoodsReceiptItem',
            'SaleItemBatchAllocation',
            'ProductBatchWarehouseStock',
            'ProductBatchLedgerEntry',
            'PurchaseOrderCloseShort',
            'PurchaseOrderCloseShortItem'
          )
    `);
    return new Set(rows.map(row => row.tableName));
}

async function readProcurementPhaseTwoBColumns(
    db: DeploySchemaClient,
    tableName: string,
): Promise<ProcurementPhaseTwoBColumnRow[]> {
    return db.query<ProcurementPhaseTwoBColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = ${tableName}
        ORDER BY ORDINAL_POSITION
    `);
}

async function readProcurementPhaseTwoBIndexes(
    db: DeploySchemaClient,
    tableName: string,
): Promise<ProcurementPhaseTwoBIndexRow[]> {
    return db.query<ProcurementPhaseTwoBIndexRow[]>(Prisma.sql`
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
          AND TABLE_NAME = ${tableName}
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `);
}

async function readProcurementPhaseTwoBForeignKeys(
    db: DeploySchemaClient,
    tableName: string,
): Promise<ProcurementPhaseTwoBForeignKeyRow[]> {
    return db.query<ProcurementPhaseTwoBForeignKeyRow[]>(Prisma.sql`
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
          AND rc.TABLE_NAME = ${tableName}
        ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `);
}

async function ensureProcurementPhaseTwoBColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: ProcurementPhaseTwoBColumnDefinition,
): Promise<void> {
    const read = async () => inspectProcurementPhaseTwoBColumn(
        await readProcurementPhaseTwoBColumns(db, definition.tableName),
        definition.contract,
    );
    const initial = await read();
    const label = `${definition.tableName}.${definition.contract.columnName}`;
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(`${label} existe con tipo, nullabilidad o default incompatible.`);
    }
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: columna ${label}.`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${label} fue creada concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(`No se pudo verificar la definición final de ${label}.`);
    }
}

async function assertSaleItemBatchAllocationWarehouseReferencesAreSafe(
    db: DeploySchemaClient,
): Promise<void> {
    const invalid = await db.query<Array<{
        allocationId: string;
        tenantId: string;
        warehouseId: string;
        reason: 'MISSING_WAREHOUSE' | 'CROSS_TENANT';
    }>>(Prisma.sql`
        SELECT
            allocation.id AS allocationId,
            allocation.tenantId,
            allocation.warehouseId,
            CASE WHEN warehouse.id IS NULL THEN 'MISSING_WAREHOUSE' ELSE 'CROSS_TENANT' END AS reason
        FROM \`SaleItemBatchAllocation\` allocation
        LEFT JOIN \`Warehouse\` warehouse ON warehouse.id = allocation.warehouseId
        WHERE allocation.warehouseId IS NOT NULL
          AND (warehouse.id IS NULL OR warehouse.tenantId <> allocation.tenantId)
        LIMIT 10
    `);
    if (invalid.length > 0) {
        const detail = invalid
            .map(row => `${row.allocationId}/${row.warehouseId} (${row.reason})`)
            .join(', ');
        throw new UnsafeSchemaStateError(
            `Hay allocations de lote con bodega inexistente o de otro tenant: ${detail}`,
        );
    }
}

async function ensureSaleItemBatchAllocationWarehouseIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const read = async () => {
        const rows = await readProcurementPhaseTwoBIndexes(db, 'SaleItemBatchAllocation');
        return inspectProcurementPhaseTwoBIndex(
            rows.filter(row => row.indexName === SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX),
            SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX,
            ['tenantId', 'warehouseId'],
            false,
        );
    };
    const initial = await read();
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX} existe con columnas u opciones incompatibles.`,
        );
    }
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: índice ${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX}.`);
        try {
            await db.execute(Prisma.sql`
                CREATE INDEX \`SaleItemBatchAllocation_tenantId_warehouseId_idx\`
                ON \`SaleItemBatchAllocation\`(\`tenantId\`, \`warehouseId\`)
            `);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX} fue creado concurrentemente; definición verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_INDEX}.`,
        );
    }
}

async function assertStockTransferClientEventsAreUnique(
    db: DeploySchemaClient,
): Promise<void> {
    const duplicates = await db.query<Array<{
        tenantId: string;
        clientEventId: string;
        duplicateCount: number | bigint;
    }>>(Prisma.sql`
        SELECT tenantId, clientEventId, COUNT(*) AS duplicateCount
        FROM \`StockTransfer\`
        WHERE clientEventId IS NOT NULL
        GROUP BY tenantId, clientEventId
        HAVING COUNT(*) > 1
        LIMIT 10
    `);
    if (duplicates.length > 0) {
        const detail = duplicates
            .map(row => `${row.tenantId}/${row.clientEventId} (${String(row.duplicateCount)})`)
            .join(', ');
        throw new UnsafeSchemaStateError(
            `Hay StockTransfer.clientEventId duplicados; no se creará el índice único: ${detail}`,
        );
    }
}

async function ensureStockTransferIdempotencyIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const read = async () => {
        const rows = await readProcurementPhaseTwoBIndexes(db, 'StockTransfer');
        return inspectProcurementPhaseTwoBIndex(
            rows.filter(row => row.indexName === STOCK_TRANSFER_IDEMPOTENCY_INDEX),
            STOCK_TRANSFER_IDEMPOTENCY_INDEX,
            ['tenantId', 'clientEventId'],
            true,
        );
    };
    const initial = await read();
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${STOCK_TRANSFER_IDEMPOTENCY_INDEX} existe con columnas u opciones incompatibles.`,
        );
    }
    await assertStockTransferClientEventsAreUnique(db);
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: índice único ${STOCK_TRANSFER_IDEMPOTENCY_INDEX}.`);
        try {
            await db.execute(Prisma.sql`
                CREATE UNIQUE INDEX \`StockTransfer_tenantId_clientEventId_key\`
                ON \`StockTransfer\`(\`tenantId\`, \`clientEventId\`)
            `);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${STOCK_TRANSFER_IDEMPOTENCY_INDEX} fue creado concurrentemente; definición verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${STOCK_TRANSFER_IDEMPOTENCY_INDEX}.`,
        );
    }
    await assertStockTransferClientEventsAreUnique(db);
}

const saleItemAllocationWarehouseForeignKey: ProcurementPhaseTwoBForeignKeyContract = {
    constraintName: SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY,
    columnName: 'warehouseId',
    referencedTableName: 'Warehouse',
    deleteRule: 'RESTRICT',
};

async function ensureSaleItemBatchAllocationWarehouseForeignKey(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const read = async () => inspectProcurementPhaseTwoBForeignKey(
        await readProcurementPhaseTwoBForeignKeys(db, 'SaleItemBatchAllocation'),
        saleItemAllocationWarehouseForeignKey,
    );
    const initial = await read();
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY} existe con definición incompatible.`,
        );
    }
    await assertSaleItemBatchAllocationWarehouseReferencesAreSafe(db);
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: FK ${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY}.`);
        try {
            await db.execute(Prisma.sql`
                ALTER TABLE \`SaleItemBatchAllocation\`
                ADD CONSTRAINT \`SaleItemBatchAllocation_warehouseId_fkey\`
                FOREIGN KEY (\`warehouseId\`) REFERENCES \`Warehouse\`(\`id\`)
                ON DELETE RESTRICT ON UPDATE CASCADE
            `);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY} fue creada concurrentemente; definición verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${SALE_ITEM_BATCH_ALLOCATION_WAREHOUSE_FOREIGN_KEY}.`,
        );
    }
    await assertSaleItemBatchAllocationWarehouseReferencesAreSafe(db);
}

async function assertProcurementPhaseTwoBTable(
    db: DeploySchemaClient,
    contract: ProcurementPhaseTwoBTableContract,
): Promise<void> {
    const [columns, indexes, foreignKeys] = await Promise.all([
        readProcurementPhaseTwoBColumns(db, contract.tableName),
        readProcurementPhaseTwoBIndexes(db, contract.tableName),
        readProcurementPhaseTwoBForeignKeys(db, contract.tableName),
    ]);

    for (const column of contract.columns) {
        if (inspectProcurementPhaseTwoBColumn(columns, column) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${contract.tableName}.${column.columnName} falta o tiene una definición incompatible.`,
            );
        }
    }
    for (const index of contract.indexes) {
        const rows = indexes.filter(row => row.indexName === index.name);
        if (inspectProcurementPhaseTwoBIndex(rows, index.name, index.columns, index.unique) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${index.name} falta o tiene columnas u opciones incompatibles.`,
            );
        }
    }
    for (const foreignKey of contract.foreignKeys) {
        if (inspectProcurementPhaseTwoBForeignKey(foreignKeys, foreignKey) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${foreignKey.constraintName} falta o tiene una definición incompatible.`,
            );
        }
    }
}

/**
 * Convergencia expand-only de Fase 2B sobre tablas ya pobladas. Las tablas
 * completamente nuevas quedan a cargo de db push (CREATE TABLE es atómico),
 * pero si ya existen se validan completas y se falla cerrado ante drift.
 */
export async function applyProcurementPhaseTwoBSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    const existingTables = await readProcurementPhaseTwoBTables(db);
    if (existingTables.size === 0) {
        logger.info('Preflight DDL 2B: instalación vacía; db push creará el contrato completo.');
        return;
    }
    if (!existingTables.has('Tenant')) {
        throw new UnsafeSchemaStateError(
            'Hay estructuras de Procurement Fase 2B sin Tenant; se requiere intervención manual.',
        );
    }

    for (const definition of PHASE_TWO_B_BASE_COLUMNS) {
        if (existingTables.has(definition.tableName)) {
            await ensureProcurementPhaseTwoBColumn(db, logger, definition);
        }
    }

    if (existingTables.has('StockTransfer')) {
        await ensureStockTransferIdempotencyIndex(db, logger);
    }

    if (existingTables.has('SaleItemBatchAllocation')) {
        await ensureSaleItemBatchAllocationWarehouseIndex(db, logger);
        await ensureSaleItemBatchAllocationWarehouseForeignKey(db, logger);
    }

    for (const contract of PHASE_TWO_B_NEW_TABLES) {
        if (existingTables.has(contract.tableName)) {
            await assertProcurementPhaseTwoBTable(db, contract);
        }
    }

    logger.info(
        'Preflight DDL 2B verificado: schema expandido sin repartir stock ni activar el ledger.',
    );
}

type ProcurementPhaseTwoCBaseTable = 'Purchase' | 'PurchaseItem';
type ProcurementPhaseTwoCNewTable =
    | 'SupplierReturn'
    | 'SupplierReturnItem'
    | 'SupplierCreditNote'
    | 'SupplierCreditNoteLine'
    | 'SupplierCreditApplication';

interface ProcurementPhaseTwoCColumnDefinition {
    tableName: ProcurementPhaseTwoCBaseTable;
    contract: ProcurementPhaseTwoCColumnContract;
    ddl: Prisma.Sql;
}

interface ProcurementPhaseTwoCIndexContract {
    name: string;
    columns: string[];
    unique: boolean;
}

interface ProcurementPhaseTwoCForeignKeyContract {
    constraintName: string;
    columnName: string;
    referencedTableName: string;
    deleteRule: 'CASCADE' | 'RESTRICT';
}

interface ProcurementPhaseTwoCTableContract {
    tableName: ProcurementPhaseTwoCNewTable;
    columns: ProcurementPhaseTwoCColumnContract[];
    indexes: ProcurementPhaseTwoCIndexContract[];
    foreignKeys: ProcurementPhaseTwoCForeignKeyContract[];
}

const PHASE_TWO_C_NEW_TABLE_NAMES: ProcurementPhaseTwoCNewTable[] = [
    'SupplierReturn',
    'SupplierReturnItem',
    'SupplierCreditNote',
    'SupplierCreditNoteLine',
    'SupplierCreditApplication',
];

const PHASE_TWO_C_BASE_COLUMNS: ProcurementPhaseTwoCColumnDefinition[] = [
    {
        tableName: 'Purchase',
        contract: {
            columnName: 'settledAt',
            columnType: 'datetime(3)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`Purchase\`
            ADD COLUMN \`settledAt\` DATETIME(3) NULL
        `,
    },
    {
        tableName: 'PurchaseItem',
        contract: {
            columnName: 'inventoryWarehouseId',
            columnType: 'varchar(191)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`PurchaseItem\`
            ADD COLUMN \`inventoryWarehouseId\` VARCHAR(191) NULL
        `,
    },
    {
        tableName: 'PurchaseItem',
        contract: {
            columnName: 'inventoryBatchId',
            columnType: 'varchar(191)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`PurchaseItem\`
            ADD COLUMN \`inventoryBatchId\` VARCHAR(191) NULL
        `,
    },
    {
        tableName: 'PurchaseItem',
        contract: {
            columnName: 'inventoryUnitCostExact',
            columnType: 'decimal(18,6)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`PurchaseItem\`
            ADD COLUMN \`inventoryUnitCostExact\` DECIMAL(18, 6) NULL
        `,
    },
];

const phaseTwoCIdColumn = (
    columnName: string,
    nullable = false,
): ProcurementPhaseTwoCColumnContract => ({
    columnName,
    columnType: 'varchar(191)',
    nullable,
    defaultValue: null,
});

const phaseTwoCVarcharColumn = (
    columnName: string,
    length: number,
    options: { nullable?: boolean; defaultValue?: string | null } = {},
): ProcurementPhaseTwoCColumnContract => ({
    columnName,
    columnType: `varchar(${length})`,
    nullable: options.nullable ?? false,
    defaultValue: options.defaultValue ?? null,
});

const phaseTwoCDecimalColumn = (
    columnName: string,
    scale: 4 | 6 = 4,
    options: { nullable?: boolean; defaultValue?: string | null } = {},
): ProcurementPhaseTwoCColumnContract => ({
    columnName,
    columnType: `decimal(18,${scale})`,
    nullable: options.nullable ?? false,
    defaultValue: options.defaultValue ?? null,
});

const phaseTwoCDateColumn = (
    columnName: string,
    nullable = false,
): ProcurementPhaseTwoCColumnContract => ({
    columnName,
    columnType: 'datetime(3)',
    nullable,
    defaultValue: null,
});

const phaseTwoCCreatedAtColumn = (): ProcurementPhaseTwoCColumnContract => ({
    columnName: 'createdAt',
    columnType: 'datetime(3)',
    nullable: false,
    defaultValue: 'current_timestamp(3)',
    extra: 'DEFAULT_GENERATED',
});

const PHASE_TWO_C_NEW_TABLES: ProcurementPhaseTwoCTableContract[] = [
    {
        tableName: 'SupplierReturn',
        columns: [
            phaseTwoCIdColumn('id'),
            phaseTwoCIdColumn('tenantId'),
            phaseTwoCIdColumn('supplierId'),
            phaseTwoCIdColumn('returnNumber'),
            phaseTwoCVarcharColumn('status', 32, { defaultValue: 'POSTED' }),
            phaseTwoCVarcharColumn('reasonCode', 32),
            { columnName: 'reason', columnType: 'text', nullable: true, defaultValue: null },
            phaseTwoCIdColumn('supplierReference', true),
            phaseTwoCVarcharColumn('clientEventId', 128),
            { columnName: 'payloadVersion', columnType: 'int', nullable: false, defaultValue: '1' },
            phaseTwoCVarcharColumn('payloadHash', 64),
            phaseTwoCVarcharColumn('batchLedgerMode', 16),
            phaseTwoCIdColumn('returnedBy'),
            phaseTwoCDateColumn('returnedAt'),
            phaseTwoCCreatedAtColumn(),
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: SUPPLIER_RETURN_NUMBER_UNIQUE_INDEX, columns: ['tenantId', 'returnNumber'], unique: true },
            { name: SUPPLIER_RETURN_EVENT_UNIQUE_INDEX, columns: ['tenantId', 'clientEventId'], unique: true },
            { name: 'SupplierReturn_tenantId_supplierId_returnedAt_idx', columns: ['tenantId', 'supplierId', 'returnedAt'], unique: false },
            { name: 'SupplierReturn_returnedBy_idx', columns: ['returnedBy'], unique: false },
        ],
        foreignKeys: [
            { constraintName: 'SupplierReturn_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturn_supplierId_fkey', columnName: 'supplierId', referencedTableName: 'Supplier', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturn_returnedBy_fkey', columnName: 'returnedBy', referencedTableName: 'User', deleteRule: 'RESTRICT' },
        ],
    },
    {
        tableName: 'SupplierReturnItem',
        columns: [
            phaseTwoCIdColumn('id'),
            phaseTwoCIdColumn('tenantId'),
            phaseTwoCIdColumn('supplierReturnId'),
            phaseTwoCVarcharColumn('sourceType', 32),
            phaseTwoCIdColumn('purchaseItemId', true),
            phaseTwoCIdColumn('goodsReceiptItemId', true),
            phaseTwoCIdColumn('purchaseMatchAllocationId', true),
            phaseTwoCIdColumn('productId'),
            phaseTwoCIdColumn('productNameAtReturn'),
            phaseTwoCIdColumn('warehouseId'),
            phaseTwoCIdColumn('batchId', true),
            phaseTwoCDecimalColumn('quantityExact'),
            phaseTwoCDecimalColumn('bookUnitCostExact', 6),
            phaseTwoCDecimalColumn('bookValueExact'),
            phaseTwoCVarcharColumn('unitAtReturn', 32),
            phaseTwoCVarcharColumn('saleModeAtReturn', 32, { nullable: true }),
            phaseTwoCDecimalColumn('quantityStepAtReturn', 4, { nullable: true }),
            phaseTwoCIdColumn('batchNumberAtReturn', true),
            phaseTwoCDateColumn('expiryDateAtReturn', true),
            phaseTwoCVarcharColumn('sourceHash', 64),
            phaseTwoCVarcharColumn('batchLedgerStatus', 32),
            phaseTwoCCreatedAtColumn(),
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: SUPPLIER_RETURN_ITEM_SOURCE_UNIQUE_INDEX, columns: ['supplierReturnId', 'sourceHash'], unique: true },
            { name: 'SupplierReturnItem_tenantId_supplierReturnId_idx', columns: ['tenantId', 'supplierReturnId'], unique: false },
            { name: 'SupplierReturnItem_tenantId_productId_warehouseId_idx', columns: ['tenantId', 'productId', 'warehouseId'], unique: false },
            { name: 'SupplierReturnItem_tenantId_purchaseItemId_idx', columns: ['tenantId', 'purchaseItemId'], unique: false },
            { name: 'SupplierReturnItem_tenantId_goodsReceiptItemId_idx', columns: ['tenantId', 'goodsReceiptItemId'], unique: false },
            { name: 'SupplierReturnItem_tenantId_purchaseMatchAllocationId_idx', columns: ['tenantId', 'purchaseMatchAllocationId'], unique: false },
            { name: 'SupplierReturnItem_tenantId_batchId_idx', columns: ['tenantId', 'batchId'], unique: false },
        ],
        foreignKeys: [
            { constraintName: 'SupplierReturnItem_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturnItem_supplierReturnId_fkey', columnName: 'supplierReturnId', referencedTableName: 'SupplierReturn', deleteRule: 'CASCADE' },
            { constraintName: 'SupplierReturnItem_purchaseItemId_fkey', columnName: 'purchaseItemId', referencedTableName: 'PurchaseItem', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturnItem_goodsReceiptItemId_fkey', columnName: 'goodsReceiptItemId', referencedTableName: 'GoodsReceiptItem', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturnItem_purchaseMatchAllocationId_fkey', columnName: 'purchaseMatchAllocationId', referencedTableName: 'PurchaseMatchAllocation', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturnItem_productId_fkey', columnName: 'productId', referencedTableName: 'Product', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturnItem_warehouseId_fkey', columnName: 'warehouseId', referencedTableName: 'Warehouse', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierReturnItem_batchId_fkey', columnName: 'batchId', referencedTableName: 'ProductBatch', deleteRule: 'RESTRICT' },
        ],
    },
    {
        tableName: 'SupplierCreditNote',
        columns: [
            phaseTwoCIdColumn('id'),
            phaseTwoCIdColumn('tenantId'),
            phaseTwoCIdColumn('supplierId'),
            phaseTwoCIdColumn('creditNoteNumber'),
            phaseTwoCVarcharColumn('type', 32, { defaultValue: 'RETURN' }),
            phaseTwoCVarcharColumn('status', 32, { defaultValue: 'POSTED' }),
            phaseTwoCDateColumn('invoiceDate'),
            phaseTwoCDateColumn('creditNoteDate'),
            phaseTwoCDateColumn('devolutionDate'),
            phaseTwoCDateColumn('postingDate'),
            phaseTwoCVarcharColumn('fiscalRegimeAtCredit', 32),
            phaseTwoCVarcharColumn('currencyAtIssue', 3),
            phaseTwoCDecimalColumn('subtotal'),
            phaseTwoCDecimalColumn('tax'),
            phaseTwoCDecimalColumn('creditableTax'),
            phaseTwoCDecimalColumn('total'),
            phaseTwoCDecimalColumn('inventoryReversalExact'),
            phaseTwoCDecimalColumn('priceVarianceReversalExact'),
            phaseTwoCDecimalColumn('remainingCredit', 4, { defaultValue: '0.0000' }),
            { columnName: 'reason', columnType: 'text', nullable: true, defaultValue: null },
            phaseTwoCIdColumn('supplierReference', true),
            phaseTwoCVarcharColumn('clientEventId', 128),
            { columnName: 'payloadVersion', columnType: 'int', nullable: false, defaultValue: '1' },
            phaseTwoCVarcharColumn('payloadHash', 64),
            phaseTwoCIdColumn('createdBy'),
            phaseTwoCCreatedAtColumn(),
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: SUPPLIER_CREDIT_NOTE_NUMBER_UNIQUE_INDEX, columns: ['tenantId', 'supplierId', 'creditNoteNumber'], unique: true },
            { name: SUPPLIER_CREDIT_NOTE_EVENT_UNIQUE_INDEX, columns: ['tenantId', 'clientEventId'], unique: true },
            { name: 'SupplierCreditNote_tenantId_supplierId_creditNoteDate_idx', columns: ['tenantId', 'supplierId', 'creditNoteDate'], unique: false },
            { name: 'SupplierCreditNote_tenantId_postingDate_idx', columns: ['tenantId', 'postingDate'], unique: false },
            { name: 'SupplierCreditNote_createdBy_idx', columns: ['createdBy'], unique: false },
        ],
        foreignKeys: [
            { constraintName: 'SupplierCreditNote_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditNote_supplierId_fkey', columnName: 'supplierId', referencedTableName: 'Supplier', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditNote_createdBy_fkey', columnName: 'createdBy', referencedTableName: 'User', deleteRule: 'RESTRICT' },
        ],
    },
    {
        tableName: 'SupplierCreditNoteLine',
        columns: [
            phaseTwoCIdColumn('id'),
            phaseTwoCIdColumn('tenantId'),
            phaseTwoCIdColumn('creditNoteId'),
            phaseTwoCIdColumn('supplierReturnItemId'),
            phaseTwoCIdColumn('sourcePurchaseItemId', true),
            phaseTwoCIdColumn('purchaseMatchAllocationId', true),
            phaseTwoCVarcharColumn('sourceHash', 64),
            phaseTwoCDecimalColumn('quantityExact'),
            phaseTwoCDecimalColumn('bookUnitCostExact', 6),
            phaseTwoCDecimalColumn('bookValueExact'),
            phaseTwoCDecimalColumn('subtotal'),
            phaseTwoCDecimalColumn('tax'),
            phaseTwoCDecimalColumn('creditableTax'),
            phaseTwoCDecimalColumn('total'),
            phaseTwoCDecimalColumn('inventoryReversalExact'),
            phaseTwoCDecimalColumn('priceVarianceReversalExact'),
            phaseTwoCIdColumn('descriptionAtCredit'),
            phaseTwoCVarcharColumn('unitAtCredit', 32),
            phaseTwoCCreatedAtColumn(),
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: SUPPLIER_CREDIT_NOTE_LINE_RETURN_ITEM_UNIQUE_INDEX, columns: ['supplierReturnItemId'], unique: true },
            { name: SUPPLIER_CREDIT_NOTE_LINE_DOCUMENT_ITEM_UNIQUE_INDEX, columns: ['creditNoteId', 'supplierReturnItemId'], unique: true },
            { name: 'SupplierCreditNoteLine_tenantId_creditNoteId_idx', columns: ['tenantId', 'creditNoteId'], unique: false },
            { name: 'SupplierCreditNoteLine_tenantId_sourcePurchaseItemId_idx', columns: ['tenantId', 'sourcePurchaseItemId'], unique: false },
            { name: 'SupplierCreditNoteLine_tenantId_purchaseMatchAllocationId_idx', columns: ['tenantId', 'purchaseMatchAllocationId'], unique: false },
        ],
        foreignKeys: [
            { constraintName: 'SupplierCreditNoteLine_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditNoteLine_creditNoteId_fkey', columnName: 'creditNoteId', referencedTableName: 'SupplierCreditNote', deleteRule: 'CASCADE' },
            { constraintName: 'SupplierCreditNoteLine_supplierReturnItemId_fkey', columnName: 'supplierReturnItemId', referencedTableName: 'SupplierReturnItem', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditNoteLine_sourcePurchaseItemId_fkey', columnName: 'sourcePurchaseItemId', referencedTableName: 'PurchaseItem', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditNoteLine_purchaseMatchAllocationId_fkey', columnName: 'purchaseMatchAllocationId', referencedTableName: 'PurchaseMatchAllocation', deleteRule: 'RESTRICT' },
        ],
    },
    {
        tableName: 'SupplierCreditApplication',
        columns: [
            phaseTwoCIdColumn('id'),
            phaseTwoCIdColumn('tenantId'),
            phaseTwoCIdColumn('supplierId'),
            phaseTwoCIdColumn('creditNoteId'),
            phaseTwoCIdColumn('purchaseId'),
            phaseTwoCDecimalColumn('amount'),
            phaseTwoCIdColumn('createdBy'),
            phaseTwoCDateColumn('appliedAt'),
            phaseTwoCCreatedAtColumn(),
        ],
        indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true },
            { name: SUPPLIER_CREDIT_APPLICATION_PURCHASE_UNIQUE_INDEX, columns: ['creditNoteId', 'purchaseId'], unique: true },
            { name: 'SupplierCreditApplication_tenantId_supplierId_appliedAt_idx', columns: ['tenantId', 'supplierId', 'appliedAt'], unique: false },
            { name: 'SupplierCreditApplication_tenantId_purchaseId_appliedAt_idx', columns: ['tenantId', 'purchaseId', 'appliedAt'], unique: false },
            { name: 'SupplierCreditApplication_createdBy_idx', columns: ['createdBy'], unique: false },
        ],
        foreignKeys: [
            { constraintName: 'SupplierCreditApplication_tenantId_fkey', columnName: 'tenantId', referencedTableName: 'Tenant', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditApplication_supplierId_fkey', columnName: 'supplierId', referencedTableName: 'Supplier', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditApplication_creditNoteId_fkey', columnName: 'creditNoteId', referencedTableName: 'SupplierCreditNote', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditApplication_purchaseId_fkey', columnName: 'purchaseId', referencedTableName: 'Purchase', deleteRule: 'RESTRICT' },
            { constraintName: 'SupplierCreditApplication_createdBy_fkey', columnName: 'createdBy', referencedTableName: 'User', deleteRule: 'RESTRICT' },
        ],
    },
];

async function readProcurementPhaseTwoCTables(
    db: DeploySchemaClient,
): Promise<Set<string>> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (
            'Purchase',
            'PurchaseItem',
            'SupplierReturn',
            'SupplierReturnItem',
            'SupplierCreditNote',
            'SupplierCreditNoteLine',
            'SupplierCreditApplication'
          )
    `);
    return new Set(rows.map(row => row.tableName));
}

async function ensureProcurementPhaseTwoCColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: ProcurementPhaseTwoCColumnDefinition,
): Promise<void> {
    const read = async () => inspectProcurementPhaseTwoCColumn(
        await readProcurementPhaseTwoBColumns(db, definition.tableName),
        definition.contract,
    );
    const initial = await read();
    const label = `${definition.tableName}.${definition.contract.columnName}`;
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(`${label} existe con tipo, nullabilidad o default incompatible.`);
    }
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: columna ${label}.`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${label} fue creada concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(`No se pudo verificar la definición final de ${label}.`);
    }
}

const PHASE_TWO_C_BASE_INDEXES: Array<{
    tableName: 'PurchaseItem';
    contract: ProcurementPhaseTwoCIndexContract;
    ddl: Prisma.Sql;
}> = [
    {
        tableName: 'PurchaseItem',
        contract: {
            name: PURCHASE_ITEM_INVENTORY_WAREHOUSE_INDEX,
            columns: ['inventoryWarehouseId'],
            unique: false,
        },
        ddl: Prisma.sql`
            CREATE INDEX \`PurchaseItem_inventoryWarehouseId_idx\`
            ON \`PurchaseItem\`(\`inventoryWarehouseId\`)
        `,
    },
    {
        tableName: 'PurchaseItem',
        contract: {
            name: PURCHASE_ITEM_INVENTORY_BATCH_INDEX,
            columns: ['inventoryBatchId'],
            unique: false,
        },
        ddl: Prisma.sql`
            CREATE INDEX \`PurchaseItem_inventoryBatchId_idx\`
            ON \`PurchaseItem\`(\`inventoryBatchId\`)
        `,
    },
];

async function ensureProcurementPhaseTwoCIndex(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: typeof PHASE_TWO_C_BASE_INDEXES[number],
): Promise<void> {
    const read = async () => {
        const rows = await readProcurementPhaseTwoBIndexes(db, definition.tableName);
        return inspectProcurementPhaseTwoCIndex(
            rows.filter(row => row.indexName === definition.contract.name),
            definition.contract.name,
            definition.contract.columns,
            definition.contract.unique,
        );
    };
    const initial = await read();
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${definition.contract.name} existe con columnas u opciones incompatibles.`,
        );
    }
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: índice ${definition.contract.name}.`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${definition.contract.name} fue creado concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${definition.contract.name}.`,
        );
    }
}

async function assertPurchaseItemInventoryReferencesAreSafe(
    db: DeploySchemaClient,
): Promise<void> {
    const invalid = await db.query<Array<{
        purchaseItemId: string;
        reason: 'MISSING_PURCHASE' | 'MISSING_WAREHOUSE' | 'CROSS_TENANT_WAREHOUSE'
            | 'MISSING_BATCH' | 'CROSS_TENANT_BATCH' | 'BATCH_PRODUCT_MISMATCH';
    }>>(Prisma.sql`
        SELECT
            item.id AS purchaseItemId,
            CASE
                WHEN purchase.id IS NULL THEN 'MISSING_PURCHASE'
                WHEN item.inventoryWarehouseId IS NOT NULL AND warehouse.id IS NULL THEN 'MISSING_WAREHOUSE'
                WHEN item.inventoryWarehouseId IS NOT NULL AND warehouse.tenantId <> purchase.tenantId THEN 'CROSS_TENANT_WAREHOUSE'
                WHEN item.inventoryBatchId IS NOT NULL AND batch.id IS NULL THEN 'MISSING_BATCH'
                WHEN item.inventoryBatchId IS NOT NULL AND batch.tenantId <> purchase.tenantId THEN 'CROSS_TENANT_BATCH'
                ELSE 'BATCH_PRODUCT_MISMATCH'
            END AS reason
        FROM \`PurchaseItem\` item
        LEFT JOIN \`Purchase\` purchase ON purchase.id = item.purchaseId
        LEFT JOIN \`Warehouse\` warehouse ON warehouse.id = item.inventoryWarehouseId
        LEFT JOIN \`ProductBatch\` batch ON batch.id = item.inventoryBatchId
        WHERE purchase.id IS NULL
           OR (item.inventoryWarehouseId IS NOT NULL
               AND (warehouse.id IS NULL OR warehouse.tenantId <> purchase.tenantId))
           OR (item.inventoryBatchId IS NOT NULL
               AND (batch.id IS NULL
                    OR batch.tenantId <> purchase.tenantId
                    OR batch.productId <> item.productId))
        LIMIT 10
    `);
    if (invalid.length > 0) {
        const detail = invalid.map(row => `${row.purchaseItemId} (${row.reason})`).join(', ');
        throw new UnsafeSchemaStateError(
            `PurchaseItem tiene evidencia de inventario inexistente, cross-tenant o de otro producto: ${detail}`,
        );
    }
}

const PHASE_TWO_C_BASE_FOREIGN_KEYS: Array<{
    tableName: 'PurchaseItem';
    contract: ProcurementPhaseTwoCForeignKeyContract;
    ddl: Prisma.Sql;
}> = [
    {
        tableName: 'PurchaseItem',
        contract: {
            constraintName: PURCHASE_ITEM_INVENTORY_WAREHOUSE_FOREIGN_KEY,
            columnName: 'inventoryWarehouseId',
            referencedTableName: 'Warehouse',
            deleteRule: 'RESTRICT',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`PurchaseItem\`
            ADD CONSTRAINT \`PurchaseItem_inventoryWarehouseId_fkey\`
            FOREIGN KEY (\`inventoryWarehouseId\`) REFERENCES \`Warehouse\`(\`id\`)
            ON DELETE RESTRICT ON UPDATE CASCADE
        `,
    },
    {
        tableName: 'PurchaseItem',
        contract: {
            constraintName: PURCHASE_ITEM_INVENTORY_BATCH_FOREIGN_KEY,
            columnName: 'inventoryBatchId',
            referencedTableName: 'ProductBatch',
            deleteRule: 'RESTRICT',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`PurchaseItem\`
            ADD CONSTRAINT \`PurchaseItem_inventoryBatchId_fkey\`
            FOREIGN KEY (\`inventoryBatchId\`) REFERENCES \`ProductBatch\`(\`id\`)
            ON DELETE RESTRICT ON UPDATE CASCADE
        `,
    },
];

async function ensureProcurementPhaseTwoCForeignKey(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: typeof PHASE_TWO_C_BASE_FOREIGN_KEYS[number],
): Promise<void> {
    const read = async () => inspectProcurementPhaseTwoCForeignKey(
        await readProcurementPhaseTwoBForeignKeys(db, definition.tableName),
        definition.contract,
    );
    const initial = await read();
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${definition.contract.constraintName} existe con definición incompatible.`,
        );
    }
    await assertPurchaseItemInventoryReferencesAreSafe(db);
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: FK ${definition.contract.constraintName}.`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${definition.contract.constraintName} fue creada concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${definition.contract.constraintName}.`,
        );
    }
    await assertPurchaseItemInventoryReferencesAreSafe(db);
}

async function assertProcurementPhaseTwoCUniquesAreSafe(
    db: DeploySchemaClient,
): Promise<void> {
    const checks: Array<{ label: string; statement: Prisma.Sql }> = [
        {
            label: 'SupplierReturn returnNumber por tenant',
            statement: Prisma.sql`
                SELECT tenantId, returnNumber, COUNT(*) AS duplicateCount
                FROM \`SupplierReturn\`
                GROUP BY tenantId, returnNumber
                HAVING COUNT(*) > 1
                LIMIT 10
            `,
        },
        {
            label: 'SupplierReturn clientEventId por tenant',
            statement: Prisma.sql`
                SELECT tenantId, clientEventId, COUNT(*) AS duplicateCount
                FROM \`SupplierReturn\`
                GROUP BY tenantId, clientEventId
                HAVING COUNT(*) > 1
                LIMIT 10
            `,
        },
        {
            label: 'SupplierReturnItem sourceHash dentro de la devolución',
            statement: Prisma.sql`
                SELECT supplierReturnId, sourceHash, COUNT(*) AS duplicateCount
                FROM \`SupplierReturnItem\`
                GROUP BY supplierReturnId, sourceHash
                HAVING COUNT(*) > 1
                LIMIT 10
            `,
        },
        {
            label: 'SupplierCreditNote número por tenant y proveedor',
            statement: Prisma.sql`
                SELECT tenantId, supplierId, creditNoteNumber, COUNT(*) AS duplicateCount
                FROM \`SupplierCreditNote\`
                GROUP BY tenantId, supplierId, creditNoteNumber
                HAVING COUNT(*) > 1
                LIMIT 10
            `,
        },
        {
            label: 'SupplierCreditNote clientEventId por tenant',
            statement: Prisma.sql`
                SELECT tenantId, clientEventId, COUNT(*) AS duplicateCount
                FROM \`SupplierCreditNote\`
                GROUP BY tenantId, clientEventId
                HAVING COUNT(*) > 1
                LIMIT 10
            `,
        },
        {
            label: 'SupplierCreditNoteLine uso global de SupplierReturnItem',
            statement: Prisma.sql`
                SELECT supplierReturnItemId, COUNT(*) AS duplicateCount
                FROM \`SupplierCreditNoteLine\`
                GROUP BY supplierReturnItemId
                HAVING COUNT(*) > 1
                LIMIT 10
            `,
        },
        {
            label: 'SupplierCreditApplication nota y factura',
            statement: Prisma.sql`
                SELECT creditNoteId, purchaseId, COUNT(*) AS duplicateCount
                FROM \`SupplierCreditApplication\`
                GROUP BY creditNoteId, purchaseId
                HAVING COUNT(*) > 1
                LIMIT 10
            `,
        },
    ];
    for (const check of checks) {
        const duplicates = await db.query<Array<{ duplicateCount: number | bigint }>>(check.statement);
        if (duplicates.length > 0) {
            throw new UnsafeSchemaStateError(
                `Hay duplicados incompatibles con ${check.label}; no se continuará el despliegue.`,
            );
        }
    }
}

async function assertProcurementPhaseTwoCTable(
    db: DeploySchemaClient,
    contract: ProcurementPhaseTwoCTableContract,
): Promise<void> {
    const [columns, indexes, foreignKeys] = await Promise.all([
        readProcurementPhaseTwoBColumns(db, contract.tableName),
        readProcurementPhaseTwoBIndexes(db, contract.tableName),
        readProcurementPhaseTwoBForeignKeys(db, contract.tableName),
    ]);
    for (const column of contract.columns) {
        if (inspectProcurementPhaseTwoCColumn(columns, column) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${contract.tableName}.${column.columnName} falta o tiene una definición incompatible.`,
            );
        }
    }
    for (const index of contract.indexes) {
        const rows = indexes.filter(row => row.indexName === index.name);
        if (inspectProcurementPhaseTwoCIndex(rows, index.name, index.columns, index.unique) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${index.name} falta o tiene columnas u opciones incompatibles.`,
            );
        }
    }
    for (const foreignKey of contract.foreignKeys) {
        if (inspectProcurementPhaseTwoCForeignKey(foreignKeys, foreignKey) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${foreignKey.constraintName} falta o tiene una definición incompatible.`,
            );
        }
    }
}

/**
 * Expansión 2C: converge solo columnas/FKs nullable sobre tablas históricas.
 * Las cinco tablas documentales nuevas se crean atómicamente por db push; si
 * alguna ya existe, el conjunto completo debe coincidir exactamente o se falla
 * cerrado. Nunca se reparan filas, se activan modos ni se acepta data loss.
 */
export async function applyProcurementPhaseTwoCSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    let existingTables = await readProcurementPhaseTwoCTables(db);
    if (existingTables.size === 0) {
        // Relectura para detectar un rollout concurrente que dejó un conjunto
        // parcial antes de delegar el CREATE TABLE a Prisma db push.
        existingTables = await readProcurementPhaseTwoCTables(db);
        if (existingTables.size === 0) {
            logger.info('Preflight DDL 2C: instalación vacía; db push creará el contrato completo.');
            return;
        }
    }
    if (!existingTables.has('Purchase') || !existingTables.has('PurchaseItem')) {
        throw new UnsafeSchemaStateError(
            'Procurement Fase 2C requiere Purchase y PurchaseItem completos; el schema parcial necesita intervención manual.',
        );
    }

    for (const definition of PHASE_TWO_C_BASE_COLUMNS) {
        await ensureProcurementPhaseTwoCColumn(db, logger, definition);
    }
    for (const definition of PHASE_TWO_C_BASE_INDEXES) {
        await ensureProcurementPhaseTwoCIndex(db, logger, definition);
    }
    await assertPurchaseItemInventoryReferencesAreSafe(db);
    for (const definition of PHASE_TWO_C_BASE_FOREIGN_KEYS) {
        await ensureProcurementPhaseTwoCForeignKey(db, logger, definition);
    }

    // Releer después del DDL base: una instancia concurrente pudo crear alguna
    // tabla documental mientras verificábamos columnas e índices históricos.
    existingTables = await readProcurementPhaseTwoCTables(db);
    const presentNewTables = PHASE_TWO_C_NEW_TABLE_NAMES.filter(table => existingTables.has(table));
    if (presentNewTables.length > 0 && presentNewTables.length !== PHASE_TWO_C_NEW_TABLE_NAMES.length) {
        throw new UnsafeSchemaStateError(
            `Procurement Fase 2C está parcial: existen ${presentNewTables.join(', ')}; se requieren las cinco tablas exactas.`,
        );
    }
    if (presentNewTables.length === PHASE_TWO_C_NEW_TABLE_NAMES.length) {
        await assertProcurementPhaseTwoCUniquesAreSafe(db);
        for (const contract of PHASE_TWO_C_NEW_TABLES) {
            await assertProcurementPhaseTwoCTable(db, contract);
        }
        await assertProcurementPhaseTwoCUniquesAreSafe(db);
    }

    logger.info('Preflight DDL 2C verificado: devoluciones y créditos listos sin DML ni activaciones.');
}

type PharmacyInventoryBaseTable = 'Tenant' | 'ProductBatchWarehouseStock';

interface PharmacyInventoryColumnDefinition {
    tableName: PharmacyInventoryBaseTable;
    contract: PharmacyInventoryColumnContract;
    ddl: Prisma.Sql;
}

interface PharmacyInventoryIndexContract {
    name: string;
    columns: string[];
    unique: boolean;
}

interface PharmacyInventoryForeignKeyContract {
    constraintName: string;
    columnName: string;
    referencedTableName: string;
    deleteRule: 'CASCADE' | 'RESTRICT';
}

interface PharmacyInventoryTableContract {
    tableName: 'ProductBatchHold';
    columns: PharmacyInventoryColumnContract[];
    indexes: PharmacyInventoryIndexContract[];
    foreignKeys: PharmacyInventoryForeignKeyContract[];
}

const PHARMACY_INVENTORY_BASE_COLUMNS: PharmacyInventoryColumnDefinition[] = [
    {
        tableName: 'Tenant',
        contract: {
            columnName: 'pharmacyInventoryMode',
            columnType: 'varchar(16)',
            nullable: false,
            defaultValue: 'OFF',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`Tenant\`
            ADD COLUMN \`pharmacyInventoryMode\` VARCHAR(16) NOT NULL DEFAULT 'OFF'
        `,
    },
    {
        tableName: 'Tenant',
        contract: {
            columnName: 'pharmacyInventoryActivatedAt',
            columnType: 'datetime(3)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`Tenant\`
            ADD COLUMN \`pharmacyInventoryActivatedAt\` DATETIME(3) NULL
        `,
    },
    {
        tableName: 'ProductBatchWarehouseStock',
        contract: {
            columnName: 'heldStock',
            columnType: 'decimal(18,4)',
            nullable: false,
            defaultValue: '0.0000',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`ProductBatchWarehouseStock\`
            ADD COLUMN \`heldStock\` DECIMAL(18, 4) NOT NULL DEFAULT 0
        `,
    },
];

const PHARMACY_INVENTORY_HOLD_TABLE: PharmacyInventoryTableContract = {
    tableName: 'ProductBatchHold',
    columns: [
        phaseTwoCIdColumn('id'),
        phaseTwoCIdColumn('tenantId'),
        phaseTwoCIdColumn('productId'),
        phaseTwoCIdColumn('batchId'),
        phaseTwoCIdColumn('warehouseId'),
        phaseTwoCDecimalColumn('quantityDelta'),
        phaseTwoCDecimalColumn('heldBefore'),
        phaseTwoCDecimalColumn('heldAfter'),
        phaseTwoCDecimalColumn('physicalStockSnapshot'),
        phaseTwoCDecimalColumn('sellableBefore'),
        phaseTwoCDecimalColumn('sellableAfter'),
        phaseTwoCVarcharColumn('holdReasonCode', 32),
        phaseTwoCIdColumn('referenceId', true),
        phaseTwoCVarcharColumn('referenceType', 64, { nullable: true }),
        phaseTwoCVarcharColumn('sourceKey', 191),
        phaseTwoCVarcharColumn('payloadHash', 64),
        { columnName: 'notes', columnType: 'text', nullable: true, defaultValue: null },
        phaseTwoCIdColumn('userId'),
        phaseTwoCCreatedAtColumn(),
    ],
    indexes: [
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
    ],
    foreignKeys: [
        {
            constraintName: 'ProductBatchHold_tenantId_fkey',
            columnName: 'tenantId',
            referencedTableName: 'Tenant',
            deleteRule: 'CASCADE',
        },
        {
            constraintName: 'ProductBatchHold_productId_fkey',
            columnName: 'productId',
            referencedTableName: 'Product',
            deleteRule: 'RESTRICT',
        },
        {
            constraintName: 'ProductBatchHold_batchId_fkey',
            columnName: 'batchId',
            referencedTableName: 'ProductBatch',
            deleteRule: 'RESTRICT',
        },
        {
            constraintName: 'ProductBatchHold_warehouseId_fkey',
            columnName: 'warehouseId',
            referencedTableName: 'Warehouse',
            deleteRule: 'RESTRICT',
        },
        {
            constraintName: 'ProductBatchHold_userId_fkey',
            columnName: 'userId',
            referencedTableName: 'User',
            deleteRule: 'RESTRICT',
        },
    ],
};

async function readPharmacyInventoryTables(
    db: DeploySchemaClient,
): Promise<Set<string>> {
    const rows = await db.query<Array<{ tableName: string }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (
            'Tenant',
            'ProductBatchWarehouseStock',
            'ProductBatchHold'
          )
    `);
    return new Set(rows.map(row => row.tableName));
}

async function ensurePharmacyInventoryColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: PharmacyInventoryColumnDefinition,
): Promise<void> {
    const read = async () => inspectPharmacyInventoryColumn(
        await readProcurementPhaseTwoBColumns(db, definition.tableName),
        definition.contract,
    );
    const initial = await read();
    const label = `${definition.tableName}.${definition.contract.columnName}`;
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(`${label} existe con tipo, nullabilidad o default incompatible.`);
    }
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: columna ${label}.`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${label} fue creada concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(`No se pudo verificar la definición final de ${label}.`);
    }
}

async function assertPharmacyInventoryHoldTable(
    db: DeploySchemaClient,
): Promise<void> {
    const contract = PHARMACY_INVENTORY_HOLD_TABLE;
    const [columns, indexes, foreignKeys] = await Promise.all([
        readProcurementPhaseTwoBColumns(db, contract.tableName),
        readProcurementPhaseTwoBIndexes(db, contract.tableName),
        readProcurementPhaseTwoBForeignKeys(db, contract.tableName),
    ]);

    for (const column of contract.columns) {
        if (inspectPharmacyInventoryColumn(columns, column) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${contract.tableName}.${column.columnName} falta o tiene una definición incompatible.`,
            );
        }
    }
    for (const index of contract.indexes) {
        const rows = indexes.filter(row => row.indexName === index.name);
        if (inspectPharmacyInventoryIndex(rows, index.name, index.columns, index.unique) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${index.name} falta o tiene columnas u opciones incompatibles.`,
            );
        }
    }
    for (const foreignKey of contract.foreignKeys) {
        if (inspectPharmacyInventoryForeignKey(foreignKeys, foreignKey) !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${foreignKey.constraintName} falta o tiene una definición incompatible.`,
            );
        }
    }
}

/**
 * Expansión de seguridad farmacéutica. Las columnas sobre tablas históricas se
 * convergen de forma idempotente con defaults inertes. ProductBatchHold es una
 * tabla completamente nueva: db push conserva el CREATE TABLE atómico, pero
 * cualquier tabla ya visible debe coincidir con el contrato completo.
 */
export async function applyPharmacyInventorySchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    let existingTables = await readPharmacyInventoryTables(db);
    if (existingTables.size === 0) {
        existingTables = await readPharmacyInventoryTables(db);
        if (existingTables.size === 0) {
            logger.info('Preflight DDL farmacia: instalación vacía; db push creará el contrato completo.');
            return;
        }
    }
    if (!existingTables.has('Tenant')) {
        throw new UnsafeSchemaStateError(
            'Hay estructuras farmacéuticas sin Tenant; el schema parcial requiere intervención manual.',
        );
    }
    if (existingTables.has('ProductBatchHold')
        && !existingTables.has('ProductBatchWarehouseStock')) {
        throw new UnsafeSchemaStateError(
            'ProductBatchHold existe sin ProductBatchWarehouseStock; el schema parcial requiere intervención manual.',
        );
    }

    for (const definition of PHARMACY_INVENTORY_BASE_COLUMNS) {
        if (existingTables.has(definition.tableName)) {
            await ensurePharmacyInventoryColumn(db, logger, definition);
        }
    }

    // Releer para detectar el CREATE TABLE de otra instancia durante el DDL base.
    existingTables = await readPharmacyInventoryTables(db);
    if (existingTables.has('ProductBatchHold')) {
        if (!existingTables.has('ProductBatchWarehouseStock')) {
            throw new UnsafeSchemaStateError(
                'ProductBatchHold existe sin ProductBatchWarehouseStock; el schema parcial requiere intervención manual.',
            );
        }
        await assertPharmacyInventoryHoldTable(db);
    }

    logger.info(
        'Preflight DDL farmacia verificado: stock retenido listo con modo OFF y sin DML ni activaciones.',
    );
}


type CashCloseJournalTableName = 'Shift' | 'JournalEntry';

interface CashCloseJournalColumnDefinition {
    tableName: CashCloseJournalTableName;
    contract: ProcurementPhaseTwoBColumnContract;
    ddl: Prisma.Sql;
}

interface CashCloseJournalUniqueDefinition {
    tableName: CashCloseJournalTableName;
    name: string;
    columns: string[];
    duplicateQuery: Prisma.Sql;
    ddl: Prisma.Sql;
}

const CASH_CLOSE_JOURNAL_BASELINE_COLUMNS: Array<{
    tableName: CashCloseJournalTableName;
    contract: ProcurementPhaseTwoBColumnContract;
}> = [
    {
        tableName: 'Shift',
        contract: {
            columnName: 'tenantId',
            columnType: 'varchar(191)',
            nullable: false,
            defaultValue: null,
        },
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'id',
            columnType: 'varchar(191)',
            nullable: false,
            defaultValue: null,
        },
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'tenantId',
            columnType: 'varchar(191)',
            nullable: false,
            defaultValue: null,
        },
    },
];

const CASH_CLOSE_JOURNAL_COLUMNS: CashCloseJournalColumnDefinition[] = [
    {
        tableName: 'Shift',
        contract: {
            columnName: 'closeEventId',
            columnType: 'varchar(128)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`Shift\`
            ADD COLUMN \`closeEventId\` VARCHAR(128) NULL
        `,
    },
    {
        tableName: 'Shift',
        contract: {
            columnName: 'closePayloadHash',
            columnType: 'varchar(64)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`Shift\`
            ADD COLUMN \`closePayloadHash\` VARCHAR(64) NULL
        `,
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'economicDate',
            columnType: 'datetime(3)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`JournalEntry\`
            ADD COLUMN \`economicDate\` DATETIME(3) NULL
        `,
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'postedAt',
            columnType: 'datetime(3)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`JournalEntry\`
            ADD COLUMN \`postedAt\` DATETIME(3) NULL
        `,
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'entryKind',
            columnType: 'varchar(32)',
            nullable: false,
            defaultValue: 'ORIGINAL',
        },
        ddl: Prisma.sql`
            ALTER TABLE \`JournalEntry\`
            ADD COLUMN \`entryKind\` VARCHAR(32) NOT NULL DEFAULT 'ORIGINAL'
        `,
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'postingKey',
            columnType: 'varchar(191)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`JournalEntry\`
            ADD COLUMN \`postingKey\` VARCHAR(191) NULL
        `,
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'payloadHash',
            columnType: 'varchar(64)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`JournalEntry\`
            ADD COLUMN \`payloadHash\` VARCHAR(64) NULL
        `,
    },
    {
        tableName: 'JournalEntry',
        contract: {
            columnName: 'reversalOfId',
            columnType: 'varchar(191)',
            nullable: true,
            defaultValue: null,
        },
        ddl: Prisma.sql`
            ALTER TABLE \`JournalEntry\`
            ADD COLUMN \`reversalOfId\` VARCHAR(191) NULL
        `,
    },
];

const CASH_CLOSE_JOURNAL_UNIQUES: CashCloseJournalUniqueDefinition[] = [
    {
        tableName: 'Shift',
        name: SHIFT_CLOSE_EVENT_UNIQUE_INDEX,
        columns: ['tenantId', 'closeEventId'],
        duplicateQuery: Prisma.sql`
            SELECT tenantId AS keyPartOne, closeEventId AS keyPartTwo, COUNT(*) AS duplicateCount
            FROM \`Shift\`
            WHERE closeEventId IS NOT NULL
            GROUP BY tenantId, closeEventId
            HAVING COUNT(*) > 1
            LIMIT 10
        `,
        ddl: Prisma.sql`
            CREATE UNIQUE INDEX \`Shift_tenantId_closeEventId_key\`
            ON \`Shift\`(\`tenantId\`, \`closeEventId\`)
        `,
    },
    {
        tableName: 'JournalEntry',
        name: JOURNAL_ENTRY_POSTING_KEY_UNIQUE_INDEX,
        columns: ['tenantId', 'postingKey'],
        duplicateQuery: Prisma.sql`
            SELECT tenantId AS keyPartOne, postingKey AS keyPartTwo, COUNT(*) AS duplicateCount
            FROM \`JournalEntry\`
            WHERE postingKey IS NOT NULL
            GROUP BY tenantId, postingKey
            HAVING COUNT(*) > 1
            LIMIT 10
        `,
        ddl: Prisma.sql`
            CREATE UNIQUE INDEX \`JournalEntry_tenantId_postingKey_key\`
            ON \`JournalEntry\`(\`tenantId\`, \`postingKey\`)
        `,
    },
    {
        tableName: 'JournalEntry',
        name: JOURNAL_ENTRY_REVERSAL_UNIQUE_INDEX,
        columns: ['reversalOfId'],
        duplicateQuery: Prisma.sql`
            SELECT reversalOfId AS keyPartOne, NULL AS keyPartTwo, COUNT(*) AS duplicateCount
            FROM \`JournalEntry\`
            WHERE reversalOfId IS NOT NULL
            GROUP BY reversalOfId
            HAVING COUNT(*) > 1
            LIMIT 10
        `,
        ddl: Prisma.sql`
            CREATE UNIQUE INDEX \`JournalEntry_reversalOfId_key\`
            ON \`JournalEntry\`(\`reversalOfId\`)
        `,
    },
];

async function readCashCloseJournalTables(
    db: DeploySchemaClient,
): Promise<Set<CashCloseJournalTableName>> {
    const rows = await db.query<Array<{ tableName: CashCloseJournalTableName }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('Shift', 'JournalEntry')
    `);
    return new Set(rows.map(row => row.tableName));
}

async function readCashCloseJournalColumns(
    db: DeploySchemaClient,
    tableName: CashCloseJournalTableName,
): Promise<CashCloseJournalColumnRow[]> {
    return db.query<CashCloseJournalColumnRow[]>(Prisma.sql`
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
          AND TABLE_NAME = ${tableName}
        ORDER BY ORDINAL_POSITION
    `);
}

async function readCashCloseJournalIndexes(
    db: DeploySchemaClient,
    tableName: CashCloseJournalTableName,
): Promise<CashCloseJournalIndexRow[]> {
    return db.query<CashCloseJournalIndexRow[]>(Prisma.sql`
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
          AND TABLE_NAME = ${tableName}
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `);
}

async function readJournalEntryForeignKeys(
    db: DeploySchemaClient,
): Promise<CashCloseJournalForeignKeyRow[]> {
    return db.query<CashCloseJournalForeignKeyRow[]>(Prisma.sql`
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
          AND rc.TABLE_NAME = 'JournalEntry'
        ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    `);
}

async function assertCashCloseJournalUniqueIsSafe(
    db: DeploySchemaClient,
    definition: CashCloseJournalUniqueDefinition,
): Promise<void> {
    const duplicates = await db.query<Array<{
        keyPartOne: string;
        keyPartTwo: string | null;
        duplicateCount: number | bigint;
    }>>(definition.duplicateQuery);
    if (duplicates.length === 0) return;

    const detail = duplicates
        .map(row => [row.keyPartOne, row.keyPartTwo]
            .filter((value): value is string => value !== null)
            .join('/') + ` (${String(row.duplicateCount)})`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `${definition.name} no puede crearse porque hay claves non-null duplicadas: ${detail}`,
    );
}

async function assertJournalEntryReversalsAreSafe(db: DeploySchemaClient): Promise<void> {
    const invalid = await db.query<Array<{
        reversalId: string;
        reversalTenantId: string;
        reversalOfId: string;
        originalTenantId: string | null;
        reason: 'MISSING_ORIGINAL' | 'CROSS_TENANT';
    }>>(Prisma.sql`
        SELECT
            reversal.id AS reversalId,
            reversal.tenantId AS reversalTenantId,
            reversal.reversalOfId,
            original.tenantId AS originalTenantId,
            CASE
                WHEN original.id IS NULL THEN 'MISSING_ORIGINAL'
                ELSE 'CROSS_TENANT'
            END AS reason
        FROM \`JournalEntry\` reversal
        LEFT JOIN \`JournalEntry\` original ON original.id = reversal.reversalOfId
        WHERE reversal.reversalOfId IS NOT NULL
          AND (original.id IS NULL OR original.tenantId <> reversal.tenantId)
        LIMIT 10
    `);
    if (invalid.length === 0) return;

    const detail = invalid
        .map(row => `${row.reversalId}->${row.reversalOfId} (${row.reason})`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `JournalEntry.reversalOfId contiene referencias inexistentes o cross-tenant: ${detail}`,
    );
}

function assertJournalEntryReversalEncoding(columns: CashCloseJournalColumnRow[]): void {
    const id = columns.filter(column => column.columnName === 'id');
    const reversal = columns.filter(column => column.columnName === 'reversalOfId');
    if (id.length !== 1 || reversal.length !== 1) {
        throw new UnsafeSchemaStateError(
            'No se pudo comparar el encoding de JournalEntry.id y reversalOfId.',
        );
    }
    if (id[0].characterSetName === null
        || id[0].collationName === null
        || reversal[0].characterSetName !== id[0].characterSetName
        || reversal[0].collationName !== id[0].collationName) {
        throw new UnsafeSchemaStateError(
            'JournalEntry.reversalOfId debe usar el mismo charset y collation que JournalEntry.id.',
        );
    }
}

async function ensureCashCloseJournalColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: CashCloseJournalColumnDefinition,
): Promise<void> {
    const read = async () => inspectCashCloseJournalColumn(
        await readCashCloseJournalColumns(db, definition.tableName),
        definition.contract,
    );
    const initial = await read();
    const label = `${definition.tableName}.${definition.contract.columnName}`;
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(`${label} existe con definición incompatible.`);
    }
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: columna ${label}.`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${label} fue creada concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(`No se pudo verificar la definición final de ${label}.`);
    }
}

async function ensureCashCloseJournalUnique(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: CashCloseJournalUniqueDefinition,
): Promise<void> {
    const read = async () => {
        const indexes = await readCashCloseJournalIndexes(db, definition.tableName);
        return inspectCashCloseJournalIndex(
            indexes.filter(index => index.indexName === definition.name),
            definition.name,
            definition.columns,
        );
    };
    const initial = await read();
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(`${definition.name} existe con definición incompatible.`);
    }
    await assertCashCloseJournalUniqueIsSafe(db, definition);
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: índice único ${definition.name}.`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${definition.name} fue creado concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${definition.name}.`,
        );
    }
    await assertCashCloseJournalUniqueIsSafe(db, definition);
}

async function ensureJournalEntryReversalForeignKey(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
): Promise<void> {
    const read = async () => inspectCashCloseJournalForeignKey(
        await readJournalEntryForeignKeys(db),
    );
    const initial = await read();
    if (initial === 'invalid') {
        throw new UnsafeSchemaStateError(
            `${JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY} existe con definición incompatible.`,
        );
    }
    await assertJournalEntryReversalsAreSafe(db);
    if (initial === 'missing') {
        logger.info(`Aplicando DDL seguro: FK ${JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY}.`);
        try {
            await db.execute(Prisma.sql`
                ALTER TABLE \`JournalEntry\`
                ADD CONSTRAINT \`JournalEntry_reversalOfId_fkey\`
                FOREIGN KEY (\`reversalOfId\`) REFERENCES \`JournalEntry\`(\`id\`)
                ON DELETE RESTRICT ON UPDATE CASCADE
            `);
        } catch (error) {
            if (await read() !== 'valid') throw error;
            logger.warn(`${JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY} fue creada concurrentemente; definición exacta verificada.`);
        }
    }
    if (await read() !== 'valid') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final de ${JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY}.`,
        );
    }
    await assertJournalEntryReversalsAreSafe(db);
}

/**
 * Converge los campos y restricciones expand-only de cierre/asientos antes de
 * db push. Tolera cualquier estado parcial compatible y falla cerrado ante
 * drift, duplicados, referencias huérfanas o reversos entre tenants.
 */
export async function applyCashCloseJournalSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    const tables = await readCashCloseJournalTables(db);
    if (tables.size === 0) {
        logger.info('Preflight cierre/asientos: tablas ausentes; db push creará el contrato completo.');
        return;
    }

    for (const baseline of CASH_CLOSE_JOURNAL_BASELINE_COLUMNS) {
        if (!tables.has(baseline.tableName)) continue;
        const state = inspectCashCloseJournalColumn(
            await readCashCloseJournalColumns(db, baseline.tableName),
            baseline.contract,
        );
        if (state !== 'valid') {
            throw new UnsafeSchemaStateError(
                `${baseline.tableName}.${baseline.contract.columnName} base falta o es incompatible.`,
            );
        }
    }

    // Prevalidar todo lo que ya existe antes del primer ALTER.
    for (const definition of CASH_CLOSE_JOURNAL_COLUMNS) {
        if (!tables.has(definition.tableName)) continue;
        const state = inspectCashCloseJournalColumn(
            await readCashCloseJournalColumns(db, definition.tableName),
            definition.contract,
        );
        if (state === 'invalid') {
            throw new UnsafeSchemaStateError(
                `${definition.tableName}.${definition.contract.columnName} existe con definición incompatible.`,
            );
        }
    }
    for (const definition of CASH_CLOSE_JOURNAL_UNIQUES) {
        if (!tables.has(definition.tableName)) continue;
        const indexes = await readCashCloseJournalIndexes(db, definition.tableName);
        const state = inspectCashCloseJournalIndex(
            indexes.filter(index => index.indexName === definition.name),
            definition.name,
            definition.columns,
        );
        if (state === 'invalid') {
            throw new UnsafeSchemaStateError(`${definition.name} existe con definición incompatible.`);
        }
        const relevantColumn = CASH_CLOSE_JOURNAL_COLUMNS.find(candidate => (
            candidate.tableName === definition.tableName
            && definition.columns.includes(candidate.contract.columnName)
        ));
        if (relevantColumn
            && inspectCashCloseJournalColumn(
                await readCashCloseJournalColumns(db, definition.tableName),
                relevantColumn.contract,
            ) === 'valid') {
            await assertCashCloseJournalUniqueIsSafe(db, definition);
        }
    }
    if (tables.has('JournalEntry')) {
        const foreignKeyState = inspectCashCloseJournalForeignKey(
            await readJournalEntryForeignKeys(db),
        );
        if (foreignKeyState === 'invalid') {
            throw new UnsafeSchemaStateError(
                `${JOURNAL_ENTRY_REVERSAL_FOREIGN_KEY} existe con definición incompatible.`,
            );
        }
        const reversalDefinition = CASH_CLOSE_JOURNAL_COLUMNS.find(definition => (
            definition.tableName === 'JournalEntry'
            && definition.contract.columnName === 'reversalOfId'
        ));
        const journalColumns = await readCashCloseJournalColumns(db, 'JournalEntry');
        if (reversalDefinition
            && inspectCashCloseJournalColumn(
                journalColumns,
                reversalDefinition.contract,
            ) === 'valid') {
            assertJournalEntryReversalEncoding(journalColumns);
            await assertJournalEntryReversalsAreSafe(db);
        }
    }

    for (const definition of CASH_CLOSE_JOURNAL_COLUMNS) {
        if (tables.has(definition.tableName)) {
            await ensureCashCloseJournalColumn(db, logger, definition);
        }
    }

    if (tables.has('JournalEntry')) {
        assertJournalEntryReversalEncoding(
            await readCashCloseJournalColumns(db, 'JournalEntry'),
        );
    }
    for (const definition of CASH_CLOSE_JOURNAL_UNIQUES) {
        if (tables.has(definition.tableName)) {
            await ensureCashCloseJournalUnique(db, logger, definition);
        }
    }
    if (tables.has('JournalEntry')) {
        await ensureJournalEntryReversalForeignKey(db, logger);
    }

    logger.info('Preflight cierre/asientos verificado: idempotencia, reversos y fechas listos.');
}

type AccountingDecimalTableName = 'Account' | 'JournalLine';
type AccountingDecimalColumnName = 'balance' | 'debit' | 'credit';

interface AccountingDecimalDefinition {
    tableName: AccountingDecimalTableName;
    columnName: AccountingDecimalColumnName;
    ddl: Prisma.Sql;
    unsafeValuesQuery: Prisma.Sql;
}

const ACCOUNTING_DECIMAL_DEFINITIONS: AccountingDecimalDefinition[] = [
    {
        tableName: 'Account',
        columnName: 'balance',
        ddl: Prisma.sql`
            ALTER TABLE \`Account\`
            MODIFY COLUMN \`balance\` DECIMAL(18, 4) NOT NULL DEFAULT 0
        `,
        unsafeValuesQuery: Prisma.sql`
            SELECT id AS recordId, CAST(balance AS CHAR) AS unsafeValue
            FROM \`Account\`
            WHERE balance < CAST('-99999999999999.9999' AS DECIMAL(18, 4))
               OR balance > CAST('99999999999999.9999' AS DECIMAL(18, 4))
            LIMIT 10
        `,
    },
    {
        tableName: 'JournalLine',
        columnName: 'debit',
        ddl: Prisma.sql`
            ALTER TABLE \`JournalLine\`
            MODIFY COLUMN \`debit\` DECIMAL(18, 4) NOT NULL DEFAULT 0
        `,
        unsafeValuesQuery: Prisma.sql`
            SELECT id AS recordId, CAST(debit AS CHAR) AS unsafeValue
            FROM \`JournalLine\`
            WHERE debit < CAST('-99999999999999.9999' AS DECIMAL(18, 4))
               OR debit > CAST('99999999999999.9999' AS DECIMAL(18, 4))
            LIMIT 10
        `,
    },
    {
        tableName: 'JournalLine',
        columnName: 'credit',
        ddl: Prisma.sql`
            ALTER TABLE \`JournalLine\`
            MODIFY COLUMN \`credit\` DECIMAL(18, 4) NOT NULL DEFAULT 0
        `,
        unsafeValuesQuery: Prisma.sql`
            SELECT id AS recordId, CAST(credit AS CHAR) AS unsafeValue
            FROM \`JournalLine\`
            WHERE credit < CAST('-99999999999999.9999' AS DECIMAL(18, 4))
               OR credit > CAST('99999999999999.9999' AS DECIMAL(18, 4))
            LIMIT 10
        `,
    },
];

async function readAccountingDecimalTables(
    db: DeploySchemaClient,
): Promise<Set<AccountingDecimalTableName>> {
    const rows = await db.query<Array<{ tableName: AccountingDecimalTableName }>>(Prisma.sql`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('Account', 'JournalLine')
    `);
    return new Set(rows.map(row => row.tableName));
}

async function readAccountingDecimalColumn(
    db: DeploySchemaClient,
    definition: Pick<AccountingDecimalDefinition, 'tableName' | 'columnName'>,
): Promise<AccountingDecimalColumnRow[]> {
    return db.query<AccountingDecimalColumnRow[]>(Prisma.sql`
        SELECT
            TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            DATA_TYPE AS dataType,
            COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable,
            NUMERIC_PRECISION AS numericPrecision,
            NUMERIC_SCALE AS numericScale,
            COLUMN_DEFAULT AS columnDefault,
            EXTRA AS extra,
            GENERATION_EXPRESSION AS generationExpression
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${definition.tableName}
          AND COLUMN_NAME = ${definition.columnName}
    `);
}

async function assertAccountingDecimalValuesFitTarget(
    db: DeploySchemaClient,
    definition: AccountingDecimalDefinition,
): Promise<void> {
    const unsafeValues = await db.query<Array<{ recordId: string; unsafeValue: string }>>(
        definition.unsafeValuesQuery,
    );
    if (unsafeValues.length === 0) return;

    const detail = unsafeValues
        .map(row => `${row.recordId}=${row.unsafeValue}`)
        .join(', ');
    throw new UnsafeSchemaStateError(
        `${definition.tableName}.${definition.columnName} contiene valores fuera del rango DECIMAL(18,4): ${detail}`,
    );
}

async function ensureAccountingDecimalColumn(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger,
    definition: AccountingDecimalDefinition,
): Promise<void> {
    const read = async () => readAccountingDecimalColumn(db, definition);
    const initialRows = await read();
    const decision = decideAccountingDecimalConvergence(initialRows);
    const label = `${definition.tableName}.${definition.columnName}`;

    if (decision === 'reject') {
        const state = inspectAccountingDecimalColumn(initialRows);
        throw new UnsafeSchemaStateError(
            `${label} tiene contrato ${state}; solo se acepta DECIMAL(14,2) legacy o DECIMAL(18,4) final, NOT NULL DEFAULT 0.`,
        );
    }

    if (decision === 'alter') {
        logger.info(`Aplicando widening seguro: ${label} DECIMAL(14,2) -> DECIMAL(18,4).`);
        try {
            await db.execute(definition.ddl);
        } catch (error) {
            if (inspectAccountingDecimalColumn(await read()) !== 'target') throw error;
            logger.warn(`${label} fue ampliada concurrentemente; definición final exacta verificada.`);
        }
    }

    if (inspectAccountingDecimalColumn(await read()) !== 'target') {
        throw new UnsafeSchemaStateError(
            `No se pudo verificar la definición final DECIMAL(18,4) de ${label}.`,
        );
    }
}

/**
 * Preflight del núcleo contable: valida contrato y rango antes de ampliar.
 * DECIMAL(14,2) -> DECIMAL(18,4) conserva 12 -> 14 dígitos enteros y 2 -> 4
 * decimales, por lo que no redondea ni reduce el dominio representable.
 */
export async function applyAccountingDecimalSchemaPreflight(
    db: DeploySchemaClient,
    logger: DeploySchemaLogger = console,
): Promise<void> {
    const tables = await readAccountingDecimalTables(db);
    if (tables.size === 0) {
        logger.info('Preflight contable: Account y JournalLine aún no existen; db push creará DECIMAL(18,4).');
        return;
    }

    // Primero validar todas las definiciones y todos los valores. Así no se
    // deja una ampliación parcial por drift o datos incompatibles conocidos.
    for (const definition of ACCOUNTING_DECIMAL_DEFINITIONS) {
        if (!tables.has(definition.tableName)) continue;
        const rows = await readAccountingDecimalColumn(db, definition);
        if (decideAccountingDecimalConvergence(rows) === 'reject') {
            const label = `${definition.tableName}.${definition.columnName}`;
            throw new UnsafeSchemaStateError(
                `${label} no coincide con DECIMAL(14,2) legacy ni DECIMAL(18,4) final.`,
            );
        }
    }
    for (const definition of ACCOUNTING_DECIMAL_DEFINITIONS) {
        if (!tables.has(definition.tableName)) continue;
        await assertAccountingDecimalValuesFitTarget(db, definition);
    }
    for (const definition of ACCOUNTING_DECIMAL_DEFINITIONS) {
        if (!tables.has(definition.tableName)) continue;
        await ensureAccountingDecimalColumn(db, logger, definition);
    }
    for (const definition of ACCOUNTING_DECIMAL_DEFINITIONS) {
        if (!tables.has(definition.tableName)) continue;
        await assertAccountingDecimalValuesFitTarget(db, definition);
    }

    logger.info('Preflight contable verificado: saldos, débitos y créditos usan DECIMAL(18,4) sin pérdida.');
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
        const stockCountExists = await stockCountTableExists(db);
        const productReturnExists = await productReturnTableExists(db);
        const paymentExists = await paymentTableExists(db);
        const retencionSufridaExists = await retencionSufridaTableExists(db);
        const purchaseExists = await purchaseTableExists(db);
        const productBatchHoldExists = await productBatchHoldTableExists(db);
        if (stockCountExists
            || productReturnExists
            || paymentExists
            || retencionSufridaExists
            || purchaseExists
            || productBatchHoldExists) {
            throw new UnsafeSchemaStateError(
                'Hay tablas de negocio sin Warehouse; el schema parcial requiere intervención manual.',
            );
        }
        // Shift/JournalEntry/Account/JournalLine pueden existir en snapshots
        // legacy anteriores a Warehouse. Sus cambios con unique/ALTER deben
        // converger igualmente antes del db push sin aceptar data loss.
        await applyCashCloseJournalSchemaPreflight(db, logger);
        await applyAccountingDecimalSchemaPreflight(db, logger);
        logger.info('Preflight DDL: Warehouse aún no existe; db push creará el schema completo.');
        return;
    }

    await ensureSellerColumn(db, logger);
    await assertAssignmentsAreSafe(db);
    await ensureSellerUniqueIndex(db, logger);
    await assertAssignmentsAreSafe(db);
    logger.info('Preflight DDL verificado: Warehouse.sellerId e índice único listos.');
    await applyStockCountSchemaPreflight(db, logger);
    await applyProductReturnSchemaPreflight(db, logger);
    await applyPaymentSchemaPreflight(db, logger);
    await applyRetencionSufridaSchemaPreflight(db, logger);
    await applyPurchaseInvoiceSchemaPreflight(db, logger);
    await applyPurchaseMatchResolutionSchemaPreflight(db, logger);
    await applyProcurementPhaseTwoBSchemaPreflight(db, logger);
    await applyProcurementPhaseTwoCSchemaPreflight(db, logger);
    await applyCashCloseJournalSchemaPreflight(db, logger);
    await applyAccountingDecimalSchemaPreflight(db, logger);
    await applyPharmacyInventorySchemaPreflight(db, logger);
}
