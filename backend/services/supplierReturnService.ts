import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import {
    assertSupplierReturnBatchLedgerResults,
    assertSupplierReturnReplay,
    buildSupplierReturnCommandId,
    buildSupplierReturnPayloadHash,
    normalizeSupplierReturnCommand,
    parseSupplierReturnStoredResult,
    planSupplierReturnPosting,
    SUPPLIER_RETURN_COMMAND_TYPE,
    SUPPLIER_RETURN_PAYLOAD_VERSION,
    SUPPLIER_RETURN_STATUS,
    SupplierReturnError,
    type CanonicalSupplierReturnCommand,
    type SupplierReturnPostingLine,
    type SupplierReturnSourceEvidence,
    type SupplierReturnStoredResult,
} from '../lib/supplierReturns.js';
import { buildBoundedBatchWarehouseSourceKey } from '../lib/batchWarehouseLedger.js';
import prisma from '../lib/prisma.js';
import type { CreateSupplierReturnInput } from '../validation/supplierReturnSchemas.js';
import { purchaseOrderRulesForProduct, purchaseOrderRulesForReceipt } from '../../utils/purchaseOrderQuantities.js';
import { applyStockDelta, StockError } from './stockService.js';
import {
    applyBatchWarehouseDelta,
    BatchWarehouseLedgerError,
    resolveBatchWarehouseLedgerMode,
} from './productBatchWarehouseLedgerService.js';

type PrismaTx = Prisma.TransactionClient;
type DecimalInput = Decimal.Value | { toString(): string };
type Database = PrismaClient;

export type SupplierReturnServiceErrorCode =
    | 'SUPPLIER_RETURN_INVALID_CONTEXT'
    | 'SUPPLIER_RETURN_ACTOR_FORBIDDEN'
    | 'SUPPLIER_RETURN_SUPPLIER_NOT_FOUND'
    | 'SUPPLIER_RETURN_WAREHOUSE_NOT_ACTIVE'
    | 'SUPPLIER_RETURN_PRODUCT_NOT_FOUND'
    | 'SUPPLIER_RETURN_STOCK_ROW_MISSING'
    | 'SUPPLIER_RETURN_LOCAL_STOCK_INSUFFICIENT'
    | 'SUPPLIER_RETURN_AGGREGATE_STOCK_INSUFFICIENT'
    | 'SUPPLIER_RETURN_BATCH_STOCK_INSUFFICIENT'
    | 'SUPPLIER_RETURN_CONCURRENT_WRITE';

export class SupplierReturnServiceError extends Error {
    constructor(
        readonly code: SupplierReturnServiceErrorCode,
        readonly httpStatus: 400 | 403 | 404 | 409,
        message: string,
    ) {
        super(message);
        this.name = 'SupplierReturnServiceError';
    }
}

interface LockedPurchaseRow {
    id: string;
    supplierId: string;
    purchaseOrderId: string | null;
    documentStatus: string;
}

interface LockedPurchaseItemRow {
    id: string;
    purchaseId: string;
    productId: string;
    productName: string;
    quantityExact: DecimalInput | null;
    purchaseOrderItemId: string | null;
    inventoryWarehouseId: string | null;
    inventoryBatchId: string | null;
    inventoryUnitCostExact: DecimalInput | null;
    batchNumber: string | null;
    expiryDate: Date | null;
}

interface LockedPurchaseOrderRow {
    id: string;
    supplierId: string;
}

interface LockedPurchaseOrderItemRow {
    id: string;
    purchaseOrderId: string;
    productId: string;
    productName: string;
    quantityOrdered: number;
    quantityReceived: number;
    quantityOrderedExact: DecimalInput | null;
    quantityReceivedExact: DecimalInput | null;
    unitAtOrder: string | null;
    saleModeAtOrder: string | null;
    quantityStepAtOrder: DecimalInput | null;
    unitCost: DecimalInput;
    unitCostExact: DecimalInput | null;
}

interface LockedGoodsReceiptRow {
    id: string;
    purchaseOrderId: string;
    warehouseId: string;
    status: string;
}

interface LockedGoodsReceiptItemRow {
    id: string;
    goodsReceiptId: string;
    purchaseOrderItemId: string;
    productId: string;
    quantityExact: DecimalInput;
    unitSnapshot: string;
    saleModeSnapshot: string | null;
    unitCostExact: DecimalInput;
    batchId: string | null;
    batchNumber: string | null;
    expiryDate: Date | null;
}

interface LockedAllocationRow {
    id: string;
    purchaseItemId: string;
    purchaseOrderItemId: string;
    goodsReceiptItemId: string | null;
    source: string;
    quantityExact: DecimalInput;
}

interface DirectPreviewRow {
    sourceId: string;
    purchaseId: string;
}

interface ReceiptPreviewRow {
    sourceId: string;
    goodsReceiptId: string;
    purchaseOrderId: string;
    purchaseOrderItemId: string;
}

interface AllocationPreviewRow {
    sourceId: string;
    purchaseId: string;
    purchaseItemId: string;
    purchaseOrderId: string;
    purchaseOrderItemId: string;
    goodsReceiptId: string | null;
    goodsReceiptItemId: string | null;
}

interface LockedWarehouseRow {
    id: string;
    name: string;
}

interface LockedProductRow {
    id: string;
    name: string;
    unit: string;
    saleMode: string | null;
    quantityStep: DecimalInput | null;
    requiresBatchTracking: boolean | number;
    requiresSerialTracking: boolean | number;
    cost: number;
    stock: number;
}

interface LockedProductStockRow {
    id: string;
    productId: string;
    warehouseId: string;
    stock: number;
}

interface LockedProductBatchRow {
    id: string;
    productId: string;
    batchNumber: string;
    expiryDate: Date;
    stock: number;
}

interface LockedBatchWarehouseStockRow {
    id: string;
    productId: string;
    batchId: string;
    warehouseId: string;
    stock: DecimalInput;
}

interface PriorReturnAggregateRow {
    sourceId: string;
    returnedExact: DecimalInput;
    invalidCount: bigint | number | string;
}

interface BatchHistoryRow {
    productId: string;
}

interface SerialHistoryRow {
    productId: string;
}

interface ShadowGapRow {
    batchId: string;
}

interface LockedSourceState {
    purchasesById: Map<string, LockedPurchaseRow>;
    purchaseItemsById: Map<string, LockedPurchaseItemRow>;
    purchaseOrdersById: Map<string, LockedPurchaseOrderRow>;
    purchaseOrderItemsById: Map<string, LockedPurchaseOrderItemRow>;
    receiptsById: Map<string, LockedGoodsReceiptRow>;
    receiptItemsById: Map<string, LockedGoodsReceiptItemRow>;
    allocationsById: Map<string, LockedAllocationRow>;
    allAllocations: LockedAllocationRow[];
    priorDirectByItemId: Map<string, Decimal>;
    priorUnmatchedByReceiptItemId: Map<string, Decimal>;
    priorMatchedByAllocationId: Map<string, Decimal>;
}

interface InventoryAuditSnapshot {
    supplierReturnItemId: string;
    productBefore: string;
    productAfter: string;
    warehouseBefore: string;
    warehouseAfter: string;
    batchBefore: string | null;
    batchAfter: string | null;
    batchWarehouseBefore: string | null;
    batchWarehouseAfter: string | null;
}

export interface SupplierReturnOperationalItem {
    id: string;
    sourceType: 'DIRECT_PURCHASE_ITEM' | 'GOODS_RECEIPT_UNMATCHED' | 'PURCHASE_MATCH_ALLOCATION';
    sourceId: string;
    productId: string;
    productNameAtReturn: string;
    warehouse: { id: string; name: string };
    batch: null | { id: string; batchNumber: string; expiryDate: string };
    quantityExact: string;
    unitAtReturn: string;
    saleModeAtReturn: string | null;
    quantityStepAtReturn: string | null;
    batchLedgerStatus: string;
    creditEligibility: 'NOTEABLE' | 'PENDING_INVOICE_LINK';
}

export interface SupplierReturnOperationalDto {
    id: string;
    supplierId: string;
    returnNumber: string;
    status: string;
    reasonCode: string;
    reason: string | null;
    supplierReference: string | null;
    batchLedgerMode: string;
    returnedBy: string;
    returnedAt: string;
    createdAt: string;
    items: SupplierReturnOperationalItem[];
}

export interface SupplierReturnResult {
    supplierReturn: SupplierReturnOperationalDto;
    replay: boolean;
}

export interface ExecuteSupplierReturnInput {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    supplierId: string;
    request: CreateSupplierReturnInput;
    now?: Date;
}

export interface ExecuteSupplierReturnTransactionInput extends Omit<ExecuteSupplierReturnInput, 'tx'> {
    db?: PrismaClient;
}

const supplierReturnSelect = Prisma.validator<Prisma.SupplierReturnSelect>()({
    id: true,
    tenantId: true,
    supplierId: true,
    returnNumber: true,
    status: true,
    reasonCode: true,
    reason: true,
    supplierReference: true,
    clientEventId: true,
    payloadVersion: true,
    payloadHash: true,
    batchLedgerMode: true,
    returnedBy: true,
    returnedAt: true,
    createdAt: true,
    items: {
        orderBy: [{ sourceHash: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            tenantId: true,
            supplierReturnId: true,
            sourceType: true,
            purchaseItemId: true,
            goodsReceiptItemId: true,
            purchaseMatchAllocationId: true,
            productId: true,
            productNameAtReturn: true,
            warehouseId: true,
            batchId: true,
            quantityExact: true,
            bookUnitCostExact: true,
            bookValueExact: true,
            unitAtReturn: true,
            saleModeAtReturn: true,
            quantityStepAtReturn: true,
            batchNumberAtReturn: true,
            expiryDateAtReturn: true,
            sourceHash: true,
            batchLedgerStatus: true,
            warehouse: { select: { id: true, name: true } },
        },
    },
});

type SupplierReturnRecord = Prisma.SupplierReturnGetPayload<{ select: typeof supplierReturnSelect }>;

const bool = (value: boolean | number): boolean => value === true || value === 1;

const isPrismaCode = (error: unknown, code: 'P2002' | 'P2034'): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === code
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === code;

const reconciliationRequired = (message = 'La fuente no tiene evidencia física exacta para devolverla'): never => {
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED',
        409,
        message,
    );
};

const incompleteResult = (): never => {
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_RESULT_INCOMPLETE',
        500,
        'El resultado idempotente de la devolución está incompleto o corrupto',
    );
};

const exactDecimal = (
    value: unknown,
    decimalPlaces: 4 | 6,
    label: string,
    options: { positive?: boolean } = {},
): Decimal => {
    if (value == null || typeof value === 'number' || typeof value === 'bigint') {
        return reconciliationRequired(`La evidencia ${label} no es exacta`);
    }
    let decimal: Decimal;
    try {
        decimal = new Decimal(typeof value === 'string' ? value.trim() : String(value));
    } catch {
        return reconciliationRequired(`La evidencia ${label} no es válida`);
    }
    const maximum = decimalPlaces === 4 ? '99999999999999.9999' : '999999999999.999999';
    if (
        !decimal.isFinite()
        || decimal.isNegative()
        || decimal.decimalPlaces() > decimalPlaces
        || decimal.greaterThan(maximum)
        || (options.positive === true && !decimal.greaterThan(0))
    ) return reconciliationRequired(`La evidencia ${label} no es conciliable`);
    return decimal;
};

const legacyStockDecimal = (value: unknown, label: string): Decimal => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return reconciliationRequired(`El saldo ${label} no es conciliable`);
    }
    const decimal = new Decimal(String(value));
    if (!decimal.isFinite()) return reconciliationRequired(`El saldo ${label} no es conciliable`);
    return decimal;
};

const canonicalBookCost = (value: unknown): string => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return reconciliationRequired('El costo libro actual del producto no es conciliable');
    }
    const cost = new Decimal(String(value));
    if (!cost.isFinite() || cost.isNegative() || cost.greaterThan('999999999999.999999')) {
        return reconciliationRequired('El costo libro actual del producto no es conciliable');
    }
    return cost.toFixed(6);
};

const returnNumberFor = (clientEventId: string): string => `DEV-${clientEventId.toUpperCase()}`;

export const buildSupplierReturnResultAuditId = (input: {
    tenantId: string;
    clientEventId: string;
}): string => createHash('sha256').update(JSON.stringify([
    SUPPLIER_RETURN_PAYLOAD_VERSION,
    'SUPPLIER_RETURN_RESULT',
    input.tenantId,
    input.clientEventId,
])).digest('hex');

const sourceIdFromItem = (item: SupplierReturnRecord['items'][number]): string => {
    if (
        item.sourceType === 'DIRECT_PURCHASE_ITEM'
        && item.purchaseItemId
        && item.goodsReceiptItemId === null
        && item.purchaseMatchAllocationId === null
    ) return item.purchaseItemId;
    if (
        item.sourceType === 'GOODS_RECEIPT_UNMATCHED'
        && item.purchaseItemId === null
        && item.goodsReceiptItemId
        && item.purchaseMatchAllocationId === null
    ) return item.goodsReceiptItemId;
    if (
        item.sourceType === 'PURCHASE_MATCH_ALLOCATION'
        && item.purchaseItemId === null
        && item.goodsReceiptItemId === null
        && item.purchaseMatchAllocationId
    ) return item.purchaseMatchAllocationId;
    return incompleteResult();
};

const validatePersistedItem = (
    record: SupplierReturnRecord,
    item: SupplierReturnRecord['items'][number],
    expected: CanonicalSupplierReturnCommand['lines'][number],
): void => {
    if (
        item.tenantId !== record.tenantId
        || item.supplierReturnId !== record.id
        || item.sourceType !== expected.sourceType
        || sourceIdFromItem(item) !== expected.sourceId
        || item.sourceHash !== expected.sourceHash
    ) return incompleteResult();
    const quantity = exactDecimal(item.quantityExact, 4, 'quantityExact', { positive: true });
    const cost = exactDecimal(item.bookUnitCostExact, 6, 'bookUnitCostExact');
    const value = exactDecimal(item.bookValueExact, 4, 'bookValueExact');
    const step = exactDecimal(item.quantityStepAtReturn, 4, 'quantityStepAtReturn', { positive: true });
    if (
        quantity.toFixed(4) !== expected.quantity
        || !cost.mul(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).equals(value)
        || !item.productId
        || !item.productNameAtReturn.trim()
        || !item.warehouseId
        || item.warehouse.id !== item.warehouseId
        || !item.warehouse.name.trim()
        || !item.unitAtReturn.trim()
        || (item.saleModeAtReturn !== 'COUNTED' && item.saleModeAtReturn !== 'MEASURED')
        || !step.greaterThan(0)
    ) return incompleteResult();
    if (item.batchId === null) {
        if (
            item.batchLedgerStatus !== 'NOT_APPLICABLE'
            || item.batchNumberAtReturn !== null
            || item.expiryDateAtReturn !== null
        ) return incompleteResult();
    } else if (
        item.batchLedgerStatus !== 'APPLIED'
        || !item.batchNumberAtReturn?.trim()
        || item.expiryDateAtReturn === null
        || Number.isNaN(item.expiryDateAtReturn.getTime())
    ) return incompleteResult();
};

const serializeOperationalReturn = (
    record: SupplierReturnRecord,
    replay: boolean,
): SupplierReturnResult => ({
    replay,
    supplierReturn: {
        id: record.id,
        supplierId: record.supplierId,
        returnNumber: record.returnNumber,
        status: record.status,
        reasonCode: record.reasonCode,
        reason: record.reason,
        supplierReference: record.supplierReference,
        batchLedgerMode: record.batchLedgerMode,
        returnedBy: record.returnedBy,
        returnedAt: record.returnedAt.toISOString(),
        createdAt: record.createdAt.toISOString(),
        items: record.items.map((item) => ({
            id: item.id,
            sourceType: item.sourceType as SupplierReturnOperationalItem['sourceType'],
            sourceId: sourceIdFromItem(item),
            productId: item.productId,
            productNameAtReturn: item.productNameAtReturn,
            warehouse: item.warehouse,
            batch: item.batchId === null ? null : {
                id: item.batchId,
                batchNumber: item.batchNumberAtReturn!,
                expiryDate: item.expiryDateAtReturn!.toISOString(),
            },
            quantityExact: item.quantityExact.toFixed(4),
            unitAtReturn: item.unitAtReturn,
            saleModeAtReturn: item.saleModeAtReturn,
            quantityStepAtReturn: item.quantityStepAtReturn?.toFixed(4) ?? null,
            batchLedgerStatus: item.batchLedgerStatus,
            creditEligibility: item.sourceType === 'GOODS_RECEIPT_UNMATCHED'
                ? 'PENDING_INVOICE_LINK'
                : 'NOTEABLE',
        })),
    },
});

const findReturnByClientEvent = async (
    database: Pick<PrismaTx, 'supplierReturn'> | Pick<PrismaClient, 'supplierReturn'>,
    tenantId: string,
    clientEventId: string,
): Promise<SupplierReturnRecord | null> => database.supplierReturn.findFirst({
    where: { tenantId, clientEventId },
    select: supplierReturnSelect,
}) as Promise<SupplierReturnRecord | null>;

const loadReplay = async (
    database: Pick<PrismaTx, 'supplierReturn' | 'auditLog'> | Pick<PrismaClient, 'supplierReturn' | 'auditLog'>,
    command: CanonicalSupplierReturnCommand,
    payloadHash: string,
): Promise<SupplierReturnResult | null> => {
    const existing = await findReturnByClientEvent(database, command.tenantId, command.clientEventId);
    if (!existing) return null;
    assertSupplierReturnReplay(existing, payloadHash);
    if (
        existing.supplierId !== command.supplierId
        || existing.status !== SUPPLIER_RETURN_STATUS
        || existing.returnNumber !== returnNumberFor(command.clientEventId)
        || existing.items.length !== command.lines.length
    ) return incompleteResult();
    const itemsByHash = new Map(existing.items.map(item => [item.sourceHash, item]));
    for (const expected of command.lines) {
        const item = itemsByHash.get(expected.sourceHash);
        if (!item) return incompleteResult();
        validatePersistedItem(existing, item, expected);
    }

    const commandId = buildSupplierReturnCommandId(command);
    const resultAuditId = buildSupplierReturnResultAuditId(command);
    const resultAudit = await database.auditLog.findFirst({
        where: { id: resultAuditId, tenantId: command.tenantId },
        select: { action: true, details: true, userId: true },
    });
    if (!resultAudit || resultAudit.action !== 'SUPPLIER_RETURN_POSTED' || resultAudit.userId !== existing.returnedBy) {
        return incompleteResult();
    }
    const stored = parseSupplierReturnStoredResult(resultAudit.details, {
        commandId,
        payloadHash,
        supplierId: command.supplierId,
        lines: command.lines,
    });
    if (
        stored.response.supplierReturnId !== existing.id
        || stored.response.returnNumber !== existing.returnNumber
        || stored.response.lines.length !== existing.items.length
    ) return incompleteResult();
    for (const storedLine of stored.response.lines) {
        const item = itemsByHash.get(storedLine.sourceHash);
        if (
            !item
            || item.id !== storedLine.supplierReturnItemId
            || item.quantityExact.toFixed(4) !== storedLine.quantityExact
        ) return incompleteResult();
    }
    return serializeOperationalReturn(existing, true);
};

const assertActiveActor = async (
    database: Pick<PrismaTx, 'user'> | Pick<PrismaClient, 'user'>,
    input: { tenantId: string; userId: string },
): Promise<void> => {
    const actor = await database.user.findFirst({
        where: { id: input.userId, tenantId: input.tenantId, status: 'ACTIVE' },
        select: { id: true },
    });
    if (!actor) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_ACTOR_FORBIDDEN',
            403,
            'El usuario no está activo en este negocio para devolver mercadería',
        );
    }
};

const sourceNotFound = (): never => {
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_SOURCE_NOT_FOUND',
        404,
        'No se encontró una de las fuentes de la devolución',
    );
};

const scopeMismatch = (): never => {
    throw new SupplierReturnError(
        'SUPPLIER_RETURN_SOURCE_SCOPE_MISMATCH',
        409,
        'La fuente no pertenece al proveedor autenticado',
    );
};

const uniqueSorted = (values: readonly (string | null | undefined)[]): string[] =>
    [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
        .sort((left, right) => left.localeCompare(right));

const mapById = <TRow extends { id: string }>(rows: readonly TRow[]): Map<string, TRow> =>
    new Map(rows.map(row => [row.id, row]));

const assertRowsFound = (expectedIds: readonly string[], actualIds: Iterable<string>): void => {
    const actual = new Set(actualIds);
    if (expectedIds.some(id => !actual.has(id))) sourceNotFound();
};

const loadPriorReturnAggregate = async (
    tx: PrismaTx,
    input: {
        tenantId: string;
        ids: readonly string[];
        column: 'purchaseItemId' | 'goodsReceiptItemId' | 'purchaseMatchAllocationId';
        sourceType: 'DIRECT_PURCHASE_ITEM' | 'GOODS_RECEIPT_UNMATCHED' | 'PURCHASE_MATCH_ALLOCATION';
    },
): Promise<Map<string, Decimal>> => {
    if (input.ids.length === 0) return new Map();
    const column = Prisma.raw(`sri.\`${input.column}\``);
    const rows = await tx.$queryRaw<PriorReturnAggregateRow[]>(Prisma.sql`
        SELECT ${column} AS sourceId,
               COALESCE(SUM(CASE
                   WHEN sr.status = ${SUPPLIER_RETURN_STATUS}
                    AND sri.sourceType = ${input.sourceType}
                   THEN sri.quantityExact ELSE 0 END), 0) AS returnedExact,
               SUM(CASE
                   WHEN sr.status <> ${SUPPLIER_RETURN_STATUS}
                     OR sri.sourceType <> ${input.sourceType}
                   THEN 1 ELSE 0 END) AS invalidCount
        FROM \`SupplierReturnItem\` sri
        INNER JOIN \`SupplierReturn\` sr
                ON sr.id = sri.supplierReturnId
               AND sr.tenantId = sri.tenantId
        WHERE sri.tenantId = ${input.tenantId}
          AND ${column} IN (${Prisma.join(input.ids)})
        GROUP BY ${column}
        ORDER BY ${column}
        FOR UPDATE
    `);
    const result = new Map<string, Decimal>();
    for (const row of rows) {
        let invalid = false;
        try {
            invalid = new Decimal(String(row.invalidCount)).greaterThan(0);
        } catch {
            invalid = true;
        }
        if (invalid) reconciliationRequired('El historial de devoluciones de la fuente no es conciliable');
        result.set(row.sourceId, exactDecimal(row.returnedExact, 4, 'returnedExact'));
    }
    return result;
};

/**
 * Congela todas las fuentes y su historial antes de calcular cupos. Los ids se
 * descubren con lecturas tenant-scoped y los locks se toman en orden canónico.
 */
const lockSourceState = async (
    tx: PrismaTx,
    command: CanonicalSupplierReturnCommand,
): Promise<LockedSourceState> => {
    const directIds = uniqueSorted(command.lines
        .filter(line => line.sourceType === 'DIRECT_PURCHASE_ITEM')
        .map(line => line.sourceId));
    const unmatchedIds = uniqueSorted(command.lines
        .filter(line => line.sourceType === 'GOODS_RECEIPT_UNMATCHED')
        .map(line => line.sourceId));
    const selectedAllocationIds = uniqueSorted(command.lines
        .filter(line => line.sourceType === 'PURCHASE_MATCH_ALLOCATION')
        .map(line => line.sourceId));

    const directPreview = directIds.length === 0 ? [] : await tx.$queryRaw<DirectPreviewRow[]>(Prisma.sql`
        SELECT pi.id AS sourceId, pi.purchaseId
        FROM \`PurchaseItem\` pi
        INNER JOIN \`Purchase\` p ON p.id = pi.purchaseId
        WHERE p.tenantId = ${command.tenantId}
          AND pi.id IN (${Prisma.join(directIds)})
        ORDER BY pi.id
    `);
    const receiptPreview = unmatchedIds.length === 0 ? [] : await tx.$queryRaw<ReceiptPreviewRow[]>(Prisma.sql`
        SELECT gri.id AS sourceId, gri.goodsReceiptId,
               gr.purchaseOrderId, gri.purchaseOrderItemId
        FROM \`GoodsReceiptItem\` gri
        INNER JOIN \`GoodsReceipt\` gr
                ON gr.id = gri.goodsReceiptId
               AND gr.tenantId = gri.tenantId
        WHERE gri.tenantId = ${command.tenantId}
          AND gri.id IN (${Prisma.join(unmatchedIds)})
        ORDER BY gri.id
    `);
    const allocationPreview = selectedAllocationIds.length === 0 ? [] : await tx.$queryRaw<AllocationPreviewRow[]>(Prisma.sql`
        SELECT pma.id AS sourceId, pi.purchaseId, pma.purchaseItemId,
               p.purchaseOrderId, pma.purchaseOrderItemId,
               gri.goodsReceiptId, pma.goodsReceiptItemId
        FROM \`PurchaseMatchAllocation\` pma
        INNER JOIN \`PurchaseItem\` pi ON pi.id = pma.purchaseItemId
        INNER JOIN \`Purchase\` p ON p.id = pi.purchaseId
        LEFT JOIN \`GoodsReceiptItem\` gri
               ON gri.id = pma.goodsReceiptItemId
              AND gri.tenantId = pma.tenantId
        WHERE pma.tenantId = ${command.tenantId}
          AND p.tenantId = ${command.tenantId}
          AND pma.id IN (${Prisma.join(selectedAllocationIds)})
        ORDER BY pma.id
    `);
    assertRowsFound(directIds, directPreview.map(row => row.sourceId));
    assertRowsFound(unmatchedIds, receiptPreview.map(row => row.sourceId));
    assertRowsFound(selectedAllocationIds, allocationPreview.map(row => row.sourceId));

    const purchaseIds = uniqueSorted([
        ...directPreview.map(row => row.purchaseId),
        ...allocationPreview.map(row => row.purchaseId),
    ]);
    const purchaseOrderIds = uniqueSorted([
        ...receiptPreview.map(row => row.purchaseOrderId),
        ...allocationPreview.map(row => row.purchaseOrderId),
    ]);
    const purchaseItemIds = uniqueSorted([
        ...directIds,
        ...allocationPreview.map(row => row.purchaseItemId),
    ]);
    const purchaseOrderItemIds = uniqueSorted([
        ...receiptPreview.map(row => row.purchaseOrderItemId),
        ...allocationPreview.map(row => row.purchaseOrderItemId),
    ]);
    const goodsReceiptIds = uniqueSorted([
        ...receiptPreview.map(row => row.goodsReceiptId),
        ...allocationPreview.map(row => row.goodsReceiptId),
    ]);
    const relevantReceiptItemIds = uniqueSorted([
        ...unmatchedIds,
        ...allocationPreview.map(row => row.goodsReceiptItemId),
    ]);

    const purchases = purchaseIds.length === 0 ? [] : await tx.$queryRaw<LockedPurchaseRow[]>(Prisma.sql`
        SELECT id, supplierId, purchaseOrderId, documentStatus
        FROM \`Purchase\`
        WHERE tenantId = ${command.tenantId}
          AND id IN (${Prisma.join(purchaseIds)})
        ORDER BY id
        FOR UPDATE
    `);
    assertRowsFound(purchaseIds, purchases.map(row => row.id));
    const purchaseOrders = purchaseOrderIds.length === 0 ? [] : await tx.$queryRaw<LockedPurchaseOrderRow[]>(Prisma.sql`
        SELECT id, supplierId
        FROM \`PurchaseOrder\`
        WHERE tenantId = ${command.tenantId}
          AND id IN (${Prisma.join(purchaseOrderIds)})
        ORDER BY id
        FOR UPDATE
    `);
    assertRowsFound(purchaseOrderIds, purchaseOrders.map(row => row.id));
    const purchaseItems = purchaseItemIds.length === 0 ? [] : await tx.$queryRaw<LockedPurchaseItemRow[]>(Prisma.sql`
        SELECT id, purchaseId, productId, productName, quantityExact,
               purchaseOrderItemId, inventoryWarehouseId, inventoryBatchId,
               inventoryUnitCostExact, batchNumber, expiryDate
        FROM \`PurchaseItem\`
        WHERE id IN (${Prisma.join(purchaseItemIds)})
        ORDER BY id
        FOR UPDATE
    `);
    assertRowsFound(purchaseItemIds, purchaseItems.map(row => row.id));
    const purchaseOrderItems = purchaseOrderItemIds.length === 0 ? [] : await tx.$queryRaw<LockedPurchaseOrderItemRow[]>(Prisma.sql`
        SELECT id, purchaseOrderId, productId, productName,
               quantityOrdered, quantityReceived,
               quantityOrderedExact, quantityReceivedExact,
               unitAtOrder, saleModeAtOrder, quantityStepAtOrder,
               unitCost, unitCostExact
        FROM \`PurchaseOrderItem\`
        WHERE id IN (${Prisma.join(purchaseOrderItemIds)})
        ORDER BY id
        FOR UPDATE
    `);
    assertRowsFound(purchaseOrderItemIds, purchaseOrderItems.map(row => row.id));
    const receipts = goodsReceiptIds.length === 0 ? [] : await tx.$queryRaw<LockedGoodsReceiptRow[]>(Prisma.sql`
        SELECT id, purchaseOrderId, warehouseId, status
        FROM \`GoodsReceipt\`
        WHERE tenantId = ${command.tenantId}
          AND id IN (${Prisma.join(goodsReceiptIds)})
        ORDER BY id
        FOR UPDATE
    `);
    assertRowsFound(goodsReceiptIds, receipts.map(row => row.id));
    const receiptItems = relevantReceiptItemIds.length === 0 ? [] : await tx.$queryRaw<LockedGoodsReceiptItemRow[]>(Prisma.sql`
        SELECT id, goodsReceiptId, purchaseOrderItemId, productId,
               quantityExact, unitSnapshot, saleModeSnapshot, unitCostExact,
               batchId, batchNumber, expiryDate
        FROM \`GoodsReceiptItem\`
        WHERE tenantId = ${command.tenantId}
          AND id IN (${Prisma.join(relevantReceiptItemIds)})
        ORDER BY id
        FOR UPDATE
    `);
    assertRowsFound(relevantReceiptItemIds, receiptItems.map(row => row.id));

    // Bloquea también todas las asignaciones del mismo recibo físico: ese
    // conjunto es parte del cap compartido unmatched→matched.
    const allAllocations = selectedAllocationIds.length === 0 && relevantReceiptItemIds.length === 0
        ? []
        : await tx.$queryRaw<LockedAllocationRow[]>(Prisma.sql`
            SELECT id, purchaseItemId, purchaseOrderItemId, goodsReceiptItemId,
                   source, quantityExact
            FROM \`PurchaseMatchAllocation\`
            WHERE tenantId = ${command.tenantId}
              AND (
                ${selectedAllocationIds.length === 0
                    ? Prisma.sql`FALSE`
                    : Prisma.sql`id IN (${Prisma.join(selectedAllocationIds)})`}
                OR
                ${relevantReceiptItemIds.length === 0
                    ? Prisma.sql`FALSE`
                    : Prisma.sql`goodsReceiptItemId IN (${Prisma.join(relevantReceiptItemIds)})`}
              )
            ORDER BY id
            FOR UPDATE
        `);
    assertRowsFound(selectedAllocationIds, allAllocations.map(row => row.id));

    const allAllocationIds = uniqueSorted(allAllocations.map(row => row.id));
    const priorDirectByItemId = await loadPriorReturnAggregate(tx, {
        tenantId: command.tenantId,
        ids: directIds,
        column: 'purchaseItemId',
        sourceType: 'DIRECT_PURCHASE_ITEM',
    });
    const priorUnmatchedByReceiptItemId = await loadPriorReturnAggregate(tx, {
        tenantId: command.tenantId,
        ids: relevantReceiptItemIds,
        column: 'goodsReceiptItemId',
        sourceType: 'GOODS_RECEIPT_UNMATCHED',
    });
    const priorMatchedByAllocationId = await loadPriorReturnAggregate(tx, {
        tenantId: command.tenantId,
        ids: allAllocationIds,
        column: 'purchaseMatchAllocationId',
        sourceType: 'PURCHASE_MATCH_ALLOCATION',
    });

    return {
        purchasesById: mapById(purchases),
        purchaseItemsById: mapById(purchaseItems),
        purchaseOrdersById: mapById(purchaseOrders),
        purchaseOrderItemsById: mapById(purchaseOrderItems),
        receiptsById: mapById(receipts),
        receiptItemsById: mapById(receiptItems),
        allocationsById: mapById(allAllocations),
        allAllocations,
        priorDirectByItemId,
        priorUnmatchedByReceiptItemId,
        priorMatchedByAllocationId,
    };
};

interface SupplierReturnSourceDescriptor {
    line: CanonicalSupplierReturnCommand['lines'][number];
    productId: string;
    warehouseId: string;
    batchId: string | null;
    availableToReturn: Decimal;
    descriptionAtReturn: string;
    sourceUnit: string | null;
    sourceSaleMode: string | null;
    sourceExactCost: Decimal;
    purchaseId: string | null;
    sourcePurchaseItemId: string | null;
    purchaseMatchAllocationId: string | null;
    purchaseOrderItemId: string | null;
    inventoryWarehouseId: string | null;
    inventoryBatchId: string | null;
    inventoryUnitCostExact: string | null;
    physicalReceiptItemId: string | null;
    physicalAccepted: Decimal | null;
    physicalPreviouslyReturned: Decimal | null;
    sourceBatchNumber: string | null;
    sourceExpiryDate: Date | null;
}

const assertSupplierScope = (actualSupplierId: string, expectedSupplierId: string): void => {
    if (actualSupplierId !== expectedSupplierId) scopeMismatch();
};

const priorFor = (values: ReadonlyMap<string, Decimal>, id: string): Decimal =>
    values.get(id) ?? new Decimal(0);

const buildSourceDescriptors = (
    command: CanonicalSupplierReturnCommand,
    state: LockedSourceState,
): SupplierReturnSourceDescriptor[] => {
    const allocationsByReceiptItem = new Map<string, LockedAllocationRow[]>();
    for (const allocation of state.allAllocations) {
        if (allocation.goodsReceiptItemId === null) continue;
        const bucket = allocationsByReceiptItem.get(allocation.goodsReceiptItemId) ?? [];
        bucket.push(allocation);
        allocationsByReceiptItem.set(allocation.goodsReceiptItemId, bucket);
    }

    const receiptCap = (receiptItem: LockedGoodsReceiptItemRow): {
        accepted: Decimal;
        allocated: Decimal;
        previouslyReturned: Decimal;
    } => {
        const accepted = exactDecimal(receiptItem.quantityExact, 4, 'goodsReceipt.quantityExact', { positive: true });
        let allocated = new Decimal(0);
        let matchedReturned = new Decimal(0);
        for (const allocation of allocationsByReceiptItem.get(receiptItem.id) ?? []) {
            if (
                allocation.source !== 'FORMAL_RECEIPT'
                || allocation.goodsReceiptItemId !== receiptItem.id
                || allocation.purchaseOrderItemId !== receiptItem.purchaseOrderItemId
            ) reconciliationRequired('La conciliación de la recepción no conserva su origen físico exacto');
            allocated = allocated.plus(exactDecimal(
                allocation.quantityExact,
                4,
                'allocation.quantityExact',
                { positive: true },
            ));
            matchedReturned = matchedReturned.plus(priorFor(state.priorMatchedByAllocationId, allocation.id));
        }
        const unmatchedReturned = priorFor(state.priorUnmatchedByReceiptItemId, receiptItem.id);
        if (
            allocated.greaterThan(accepted)
            || unmatchedReturned.greaterThan(accepted)
            || matchedReturned.greaterThan(allocated)
            || unmatchedReturned.plus(matchedReturned).greaterThan(accepted)
        ) reconciliationRequired('El cupo físico histórico de la recepción no es conciliable');
        return {
            accepted,
            allocated,
            previouslyReturned: unmatchedReturned.plus(matchedReturned),
        };
    };

    return command.lines.map((line): SupplierReturnSourceDescriptor => {
        if (line.sourceType === 'DIRECT_PURCHASE_ITEM') {
            const item = state.purchaseItemsById.get(line.sourceId) ?? sourceNotFound();
            const purchase = state.purchasesById.get(item.purchaseId) ?? sourceNotFound();
            assertSupplierScope(purchase.supplierId, command.supplierId);
            if (
                purchase.documentStatus !== 'POSTED'
                || purchase.purchaseOrderId !== null
                || item.purchaseOrderItemId !== null
            ) reconciliationRequired('La línea no es una compra directa posteada');
            const entered = exactDecimal(item.quantityExact, 4, 'purchaseItem.quantityExact', { positive: true });
            const returned = priorFor(state.priorDirectByItemId, item.id);
            if (returned.greaterThan(entered)) reconciliationRequired('La compra directa ya excede su cupo histórico');
            const inventoryUnitCost = exactDecimal(
                item.inventoryUnitCostExact,
                6,
                'purchaseItem.inventoryUnitCostExact',
            );
            if (!item.inventoryWarehouseId) {
                throw new SupplierReturnError(
                    'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED',
                    409,
                    'La compra directa no conserva evidencia exacta de bodega, lote y costo',
                );
            }
            return {
                line,
                productId: item.productId,
                warehouseId: item.inventoryWarehouseId,
                batchId: item.inventoryBatchId,
                availableToReturn: entered.minus(returned),
                descriptionAtReturn: item.productName,
                sourceUnit: null,
                sourceSaleMode: null,
                sourceExactCost: inventoryUnitCost,
                purchaseId: purchase.id,
                sourcePurchaseItemId: item.id,
                purchaseMatchAllocationId: null,
                purchaseOrderItemId: null,
                inventoryWarehouseId: item.inventoryWarehouseId,
                inventoryBatchId: item.inventoryBatchId,
                inventoryUnitCostExact: inventoryUnitCost.toFixed(6),
                physicalReceiptItemId: null,
                physicalAccepted: null,
                physicalPreviouslyReturned: null,
                sourceBatchNumber: item.batchNumber,
                sourceExpiryDate: item.expiryDate,
            };
        }

        if (line.sourceType === 'GOODS_RECEIPT_UNMATCHED') {
            const receiptItem = state.receiptItemsById.get(line.sourceId) ?? sourceNotFound();
            const receipt = state.receiptsById.get(receiptItem.goodsReceiptId) ?? sourceNotFound();
            const orderItem = state.purchaseOrderItemsById.get(receiptItem.purchaseOrderItemId) ?? sourceNotFound();
            const order = state.purchaseOrdersById.get(receipt.purchaseOrderId) ?? sourceNotFound();
            assertSupplierScope(order.supplierId, command.supplierId);
            if (
                receipt.status !== 'POSTED'
                || orderItem.purchaseOrderId !== order.id
                || receiptItem.productId !== orderItem.productId
            ) reconciliationRequired('La recepción no conserva una fuente posteada coherente');
            const cap = receiptCap(receiptItem);
            const unmatchedReturned = priorFor(state.priorUnmatchedByReceiptItemId, receiptItem.id);
            const available = cap.accepted.minus(cap.allocated).minus(unmatchedReturned);
            if (available.isNegative()) reconciliationRequired('El saldo unmatched de la recepción no es conciliable');
            return {
                line,
                productId: receiptItem.productId,
                warehouseId: receipt.warehouseId,
                batchId: receiptItem.batchId,
                availableToReturn: available,
                descriptionAtReturn: orderItem.productName,
                sourceUnit: receiptItem.unitSnapshot,
                sourceSaleMode: receiptItem.saleModeSnapshot,
                sourceExactCost: exactDecimal(receiptItem.unitCostExact, 6, 'goodsReceipt.unitCostExact'),
                purchaseId: null,
                sourcePurchaseItemId: null,
                purchaseMatchAllocationId: null,
                purchaseOrderItemId: orderItem.id,
                inventoryWarehouseId: null,
                inventoryBatchId: null,
                inventoryUnitCostExact: null,
                physicalReceiptItemId: receiptItem.id,
                physicalAccepted: cap.accepted,
                physicalPreviouslyReturned: cap.previouslyReturned,
                sourceBatchNumber: receiptItem.batchNumber,
                sourceExpiryDate: receiptItem.expiryDate,
            };
        }

        const allocation = state.allocationsById.get(line.sourceId) ?? sourceNotFound();
        const purchaseItem = state.purchaseItemsById.get(allocation.purchaseItemId) ?? sourceNotFound();
        const purchase = state.purchasesById.get(purchaseItem.purchaseId) ?? sourceNotFound();
        const orderItem = state.purchaseOrderItemsById.get(allocation.purchaseOrderItemId) ?? sourceNotFound();
        const order = state.purchaseOrdersById.get(orderItem.purchaseOrderId) ?? sourceNotFound();
        const receiptItem = allocation.goodsReceiptItemId === null
            ? reconciliationRequired('La asignación no conserva recepción formal')
            : state.receiptItemsById.get(allocation.goodsReceiptItemId) ?? sourceNotFound();
        const receipt = state.receiptsById.get(receiptItem.goodsReceiptId) ?? sourceNotFound();
        assertSupplierScope(purchase.supplierId, command.supplierId);
        assertSupplierScope(order.supplierId, command.supplierId);
        if (
            purchase.documentStatus !== 'POSTED'
            || purchase.purchaseOrderId !== order.id
            || purchaseItem.purchaseOrderItemId !== orderItem.id
            || allocation.source !== 'FORMAL_RECEIPT'
            || allocation.purchaseOrderItemId !== orderItem.id
            || receipt.purchaseOrderId !== order.id
            || receipt.status !== 'POSTED'
            || receiptItem.purchaseOrderItemId !== orderItem.id
            || purchaseItem.productId !== orderItem.productId
            || receiptItem.productId !== orderItem.productId
        ) reconciliationRequired('La asignación factura-recepción no conserva evidencia formal coherente');
        const allocated = exactDecimal(allocation.quantityExact, 4, 'allocation.quantityExact', { positive: true });
        const returned = priorFor(state.priorMatchedByAllocationId, allocation.id);
        if (returned.greaterThan(allocated)) reconciliationRequired('La asignación ya excede su cupo histórico');
        const cap = receiptCap(receiptItem);
        return {
            line,
            productId: receiptItem.productId,
            warehouseId: receipt.warehouseId,
            batchId: receiptItem.batchId,
            availableToReturn: allocated.minus(returned),
            descriptionAtReturn: orderItem.productName,
            sourceUnit: receiptItem.unitSnapshot,
            sourceSaleMode: receiptItem.saleModeSnapshot,
            sourceExactCost: exactDecimal(receiptItem.unitCostExact, 6, 'goodsReceipt.unitCostExact'),
            purchaseId: purchase.id,
            sourcePurchaseItemId: purchaseItem.id,
            purchaseMatchAllocationId: allocation.id,
            purchaseOrderItemId: orderItem.id,
            inventoryWarehouseId: null,
            inventoryBatchId: null,
            inventoryUnitCostExact: null,
            physicalReceiptItemId: receiptItem.id,
            physicalAccepted: cap.accepted,
            physicalPreviouslyReturned: cap.previouslyReturned,
            sourceBatchNumber: receiptItem.batchNumber,
            sourceExpiryDate: receiptItem.expiryDate,
        };
    });
};

const lockSupplier = async (
    tx: PrismaTx,
    input: { tenantId: string; supplierId: string },
): Promise<void> => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM \`Supplier\`
        WHERE id = ${input.supplierId} AND tenantId = ${input.tenantId}
        FOR UPDATE
    `);
    if (!rows[0]) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_SUPPLIER_NOT_FOUND',
            404,
            'El proveedor no existe en este negocio',
        );
    }
};

const lockWarehouses = async (
    tx: PrismaTx,
    tenantId: string,
    warehouseIds: readonly string[],
): Promise<Map<string, LockedWarehouseRow>> => {
    const ids = uniqueSorted(warehouseIds);
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<LockedWarehouseRow[]>(Prisma.sql`
        SELECT id, name
        FROM \`Warehouse\`
        WHERE tenantId = ${tenantId}
          AND isActive = TRUE
          AND id IN (${Prisma.join(ids)})
        ORDER BY id
        FOR UPDATE
    `);
    if (rows.length !== ids.length) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_WAREHOUSE_NOT_ACTIVE',
            409,
            'Una bodega de la devolución no existe o está inactiva',
        );
    }
    return mapById(rows);
};

interface LockedInventoryAuthority {
    productsById: Map<string, LockedProductRow>;
    productStocksByPair: Map<string, LockedProductStockRow>;
    batchesById: Map<string, LockedProductBatchRow>;
    batchWarehouseStocksByPair: Map<string, LockedBatchWarehouseStockRow>;
    planned: SupplierReturnPostingLine[];
}

const pairKey = (left: string, right: string): string => `${left}\u0000${right}`;

const assertExactStockSufficient = (
    available: Decimal,
    requested: Decimal,
    error: () => never,
): void => {
    if (available.isNegative() || requested.greaterThan(available)) error();
};

const sourceEvidence = (
    descriptor: SupplierReturnSourceDescriptor,
    input: {
        command: CanonicalSupplierReturnCommand;
        product: LockedProductRow;
        state: LockedSourceState;
        batchesById: Map<string, LockedProductBatchRow>;
        batchHistory: ReadonlySet<string>;
        serialHistory: ReadonlySet<string>;
        shadowGaps: ReadonlySet<string>;
    },
): SupplierReturnSourceEvidence => {
    const { product } = input;
    const rules = descriptor.purchaseOrderItemId === null
        ? purchaseOrderRulesForProduct(product)
        : purchaseOrderRulesForReceipt(
            input.state.purchaseOrderItemsById.get(descriptor.purchaseOrderItemId) ?? sourceNotFound(),
            product,
        );
    const unitAtReturn = descriptor.purchaseOrderItemId === null
        ? product.unit
        : (input.state.purchaseOrderItemsById.get(descriptor.purchaseOrderItemId)?.unitAtOrder ?? product.unit);
    if (
        typeof unitAtReturn !== 'string'
        || !unitAtReturn.trim()
        || (descriptor.sourceUnit !== null && descriptor.sourceUnit !== unitAtReturn)
        || (descriptor.sourceSaleMode !== null && descriptor.sourceSaleMode !== rules.saleMode)
        || (descriptor.purchaseOrderItemId !== null
            && (descriptor.sourceUnit === null || descriptor.sourceSaleMode === null))
    ) reconciliationRequired('Los snapshots de unidad/cantidad de la fuente no son coherentes');

    const tracked = bool(product.requiresBatchTracking)
        || input.batchHistory.has(product.id)
        || descriptor.batchId !== null;
    const serial = bool(product.requiresSerialTracking) || input.serialHistory.has(product.id);
    const batch = descriptor.batchId === null ? null : input.batchesById.get(descriptor.batchId) ?? sourceNotFound();
    if (batch && batch.productId !== product.id) {
        reconciliationRequired('El lote físico no pertenece al producto de la fuente');
    }
    if (batch) {
        if (
            descriptor.sourceBatchNumber === null
            || descriptor.sourceExpiryDate === null
            || descriptor.sourceBatchNumber !== batch.batchNumber
            || descriptor.sourceExpiryDate.getTime() !== batch.expiryDate.getTime()
        ) reconciliationRequired('Los snapshots del lote no coinciden con el lote físico');
    } else if (descriptor.sourceBatchNumber !== null || descriptor.sourceExpiryDate !== null) {
        reconciliationRequired('La fuente conserva un lote ambiguo');
    }

    // `sourceExactCost` se leyó/validó bajo lock. El costo libro de la salida
    // es el costo actual bloqueado del producto, no un costo histórico igualado.
    void descriptor.sourceExactCost;
    return {
        tenantId: input.command.tenantId,
        supplierId: input.command.supplierId,
        sourceType: descriptor.line.sourceType,
        sourceId: descriptor.line.sourceId,
        sourceStatus: 'POSTED',
        productId: product.id,
        warehouseId: descriptor.warehouseId,
        batchId: descriptor.batchId,
        availableToReturnExact: descriptor.availableToReturn.toFixed(4),
        bookUnitCostExact: canonicalBookCost(product.cost),
        descriptionAtReturn: descriptor.descriptionAtReturn,
        unitAtReturn: unitAtReturn.trim(),
        saleModeAtReturn: rules.saleMode,
        quantityStepAtReturn: new Decimal(rules.quantityStep).toFixed(4),
        batchNumberAtReturn: batch?.batchNumber ?? null,
        expiryDateAtReturn: batch?.expiryDate.toISOString() ?? null,
        requiresBatchTracking: tracked,
        hasSerialTracking: serial,
        hasShadowGap: descriptor.batchId !== null && input.shadowGaps.has(descriptor.batchId),
        purchaseId: descriptor.purchaseId,
        sourcePurchaseItemId: descriptor.sourcePurchaseItemId,
        purchaseMatchAllocationId: descriptor.purchaseMatchAllocationId,
        inventoryWarehouseId: descriptor.inventoryWarehouseId,
        inventoryBatchId: descriptor.inventoryBatchId,
        inventoryUnitCostExact: descriptor.inventoryUnitCostExact,
        physicalReceiptItemId: descriptor.physicalReceiptItemId,
        physicalAcceptedQuantityExact: descriptor.physicalAccepted?.toFixed(4),
        physicalPreviouslyReturnedExact: descriptor.physicalPreviouslyReturned?.toFixed(4),
    };
};

const lockInventoryAuthority = async (
    tx: PrismaTx,
    input: {
        command: CanonicalSupplierReturnCommand;
        state: LockedSourceState;
        descriptors: readonly SupplierReturnSourceDescriptor[];
        batchLedgerMode: 'OFF' | 'SHADOW' | 'ENFORCED';
    },
): Promise<LockedInventoryAuthority> => {
    const productIds = uniqueSorted(input.descriptors.map(source => source.productId));
    const products = await tx.$queryRaw<LockedProductRow[]>(Prisma.sql`
        SELECT id, name, unit, saleMode, quantityStep,
               requiresBatchTracking, requiresSerialTracking, cost, stock
        FROM \`Product\`
        WHERE tenantId = ${input.command.tenantId}
          AND id IN (${Prisma.join(productIds)})
        ORDER BY id
        FOR UPDATE
    `);
    if (products.length !== productIds.length) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_PRODUCT_NOT_FOUND',
            404,
            'Un producto de la devolución no existe en este negocio',
        );
    }
    const productsById = mapById(products);

    const warehouseIds = uniqueSorted(input.descriptors.map(source => source.warehouseId));
    const productStocks = await tx.$queryRaw<LockedProductStockRow[]>(Prisma.sql`
        SELECT id, productId, warehouseId, stock
        FROM \`ProductStock\`
        WHERE tenantId = ${input.command.tenantId}
          AND productId IN (${Prisma.join(productIds)})
          AND warehouseId IN (${Prisma.join(warehouseIds)})
        ORDER BY productId, warehouseId, id
        FOR UPDATE
    `);
    const productStocksByPair = new Map(productStocks.map(row => [pairKey(row.productId, row.warehouseId), row]));
    for (const descriptor of input.descriptors) {
        if (!productStocksByPair.has(pairKey(descriptor.productId, descriptor.warehouseId))) {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_STOCK_ROW_MISSING',
                409,
                'La bodega no conserva un saldo explícito para este producto',
            );
        }
    }

    const batchIds = uniqueSorted(input.descriptors.map(source => source.batchId));
    const batches = batchIds.length === 0 ? [] : await tx.$queryRaw<LockedProductBatchRow[]>(Prisma.sql`
        SELECT id, productId, batchNumber, expiryDate, stock
        FROM \`ProductBatch\`
        WHERE tenantId = ${input.command.tenantId}
          AND id IN (${Prisma.join(batchIds)})
        ORDER BY id
        FOR UPDATE
    `);
    assertRowsFound(batchIds, batches.map(row => row.id));
    const batchesById = mapById(batches);

    const batchHistoryRows = await tx.$queryRaw<BatchHistoryRow[]>(Prisma.sql`
        SELECT productId
        FROM \`ProductBatch\`
        WHERE tenantId = ${input.command.tenantId}
          AND productId IN (${Prisma.join(productIds)})
        ORDER BY productId, id
        FOR UPDATE
    `);
    const serialHistoryRows = await tx.$queryRaw<SerialHistoryRow[]>(Prisma.sql`
        SELECT productId
        FROM \`SerialNumber\`
        WHERE tenantId = ${input.command.tenantId}
          AND productId IN (${Prisma.join(productIds)})
        ORDER BY productId, id
        FOR UPDATE
    `);
    const shadowGapRows = batchIds.length === 0 ? [] : await tx.$queryRaw<ShadowGapRow[]>(Prisma.sql`
        SELECT batchId
        FROM \`ProductBatchLedgerEntry\`
        WHERE tenantId = ${input.command.tenantId}
          AND batchId IN (${Prisma.join(batchIds)})
          AND status = 'SHADOW_GAP'
        ORDER BY batchId, id
        FOR UPDATE
    `);
    const batchHistory = new Set(batchHistoryRows.map(row => row.productId));
    const serialHistory = new Set(serialHistoryRows.map(row => row.productId));
    const shadowGaps = new Set(shadowGapRows.map(row => row.batchId));
    const sources = input.descriptors.map(descriptor => sourceEvidence(descriptor, {
        command: input.command,
        product: productsById.get(descriptor.productId) ?? sourceNotFound(),
        state: input.state,
        batchesById,
        batchHistory,
        serialHistory,
        shadowGaps,
    }));
    const planned = planSupplierReturnPosting({
        command: input.command,
        batchLedgerMode: input.batchLedgerMode,
        sources,
    });

    const requestedByProduct = new Map<string, Decimal>();
    const requestedByWarehouse = new Map<string, Decimal>();
    const requestedByBatch = new Map<string, Decimal>();
    const requestedByBatchWarehouse = new Map<string, Decimal>();
    for (const line of planned) {
        const quantity = new Decimal(line.quantityExact);
        requestedByProduct.set(line.productId, (requestedByProduct.get(line.productId) ?? new Decimal(0)).plus(quantity));
        const warehouseKey = pairKey(line.productId, line.warehouseId);
        requestedByWarehouse.set(warehouseKey, (requestedByWarehouse.get(warehouseKey) ?? new Decimal(0)).plus(quantity));
        if (line.batchId !== null) {
            requestedByBatch.set(line.batchId, (requestedByBatch.get(line.batchId) ?? new Decimal(0)).plus(quantity));
            const batchWarehouseKey = pairKey(line.batchId, line.warehouseId);
            requestedByBatchWarehouse.set(
                batchWarehouseKey,
                (requestedByBatchWarehouse.get(batchWarehouseKey) ?? new Decimal(0)).plus(quantity),
            );
        }
    }
    for (const [productId, requested] of requestedByProduct) {
        const product = productsById.get(productId) ?? sourceNotFound();
        assertExactStockSufficient(legacyStockDecimal(product.stock, 'global'), requested, () => {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_AGGREGATE_STOCK_INSUFFICIENT',
                409,
                'No hay stock agregado suficiente para devolver al proveedor',
            );
        });
    }
    for (const [key, requested] of requestedByWarehouse) {
        const stock = productStocksByPair.get(key);
        if (!stock) {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_STOCK_ROW_MISSING',
                409,
                'La bodega no conserva un saldo explícito para este producto',
            );
        }
        assertExactStockSufficient(legacyStockDecimal(stock.stock, 'de bodega'), requested, () => {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_LOCAL_STOCK_INSUFFICIENT',
                409,
                'No hay stock suficiente del producto en la bodega de origen',
            );
        });
    }
    for (const [batchId, requested] of requestedByBatch) {
        const batch = batchesById.get(batchId) ?? sourceNotFound();
        assertExactStockSufficient(legacyStockDecimal(batch.stock, 'global del lote'), requested, () => {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_BATCH_STOCK_INSUFFICIENT',
                409,
                'No hay stock agregado suficiente del lote para devolverlo',
            );
        });
    }

    const batchWarehouseStocks = batchIds.length === 0 ? [] : await tx.$queryRaw<LockedBatchWarehouseStockRow[]>(Prisma.sql`
        SELECT id, productId, batchId, warehouseId, stock
        FROM \`ProductBatchWarehouseStock\`
        WHERE tenantId = ${input.command.tenantId}
          AND batchId IN (${Prisma.join(batchIds)})
          AND warehouseId IN (${Prisma.join(warehouseIds)})
        ORDER BY batchId, warehouseId, id
        FOR UPDATE
    `);
    const batchWarehouseStocksByPair = new Map(batchWarehouseStocks.map(row => [pairKey(row.batchId, row.warehouseId), row]));
    if (input.batchLedgerMode === 'ENFORCED') {
        for (const [key, requested] of requestedByBatchWarehouse) {
            const stock = batchWarehouseStocksByPair.get(key);
            if (!stock) reconciliationRequired('El lote no tiene un saldo explícito en la bodega de origen');
            const available = exactDecimal(stock.stock, 4, 'batchWarehouse.stock');
            assertExactStockSufficient(available, requested, () => reconciliationRequired(
                'No hay saldo lote-bodega suficiente para una devolución exacta',
            ));
        }
    }

    return {
        productsById,
        productStocksByPair,
        batchesById,
        batchWarehouseStocksByPair,
        planned,
    };
};

const commandFromInput = (
    input: Omit<ExecuteSupplierReturnInput, 'tx' | 'now'>,
): CanonicalSupplierReturnCommand => normalizeSupplierReturnCommand({
    tenantId: input.tenantId,
    userId: input.userId,
    supplierId: input.supplierId,
    clientEventId: input.request.clientEventId,
    reasonCode: input.request.reasonCode,
    reason: input.request.reason,
    supplierReference: input.request.supplierReference,
    lines: input.request.lines,
});

const sourceForeignKeys = (line: SupplierReturnPostingLine): {
    purchaseItemId: string | null;
    goodsReceiptItemId: string | null;
    purchaseMatchAllocationId: string | null;
} => {
    if (line.sourceType === 'DIRECT_PURCHASE_ITEM') {
        return { purchaseItemId: line.sourceId, goodsReceiptItemId: null, purchaseMatchAllocationId: null };
    }
    if (line.sourceType === 'GOODS_RECEIPT_UNMATCHED') {
        return { purchaseItemId: null, goodsReceiptItemId: line.sourceId, purchaseMatchAllocationId: null };
    }
    return { purchaseItemId: null, goodsReceiptItemId: null, purchaseMatchAllocationId: line.sourceId };
};

const translateInventoryError = (error: unknown): never => {
    if (error instanceof StockError) {
        if (error.code === 'PRODUCT_NOT_FOUND') {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_PRODUCT_NOT_FOUND',
                404,
                'Un producto de la devolución no existe en este negocio',
            );
        }
        if (error.code === 'WAREHOUSE_NOT_FOUND' || error.code === 'WAREHOUSE_REQUIRED') {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_WAREHOUSE_NOT_ACTIVE',
                409,
                'Una bodega de la devolución no existe o está inactiva',
            );
        }
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_AGGREGATE_STOCK_INSUFFICIENT',
            409,
            'No hay stock suficiente para devolver al proveedor',
        );
    }
    if (error instanceof BatchWarehouseLedgerError) {
        if (error.httpStatus === 500) throw error;
        reconciliationRequired(error.message);
    }
    throw error;
};

const postInventory = async (
    tx: PrismaTx,
    input: {
        command: CanonicalSupplierReturnCommand;
        supplierReturnId: string;
        itemIdsByHash: ReadonlyMap<string, string>;
        batchLedgerMode: 'OFF' | 'SHADOW' | 'ENFORCED';
        authority: LockedInventoryAuthority;
    },
): Promise<InventoryAuditSnapshot[]> => {
    const localBalances = new Map<string, Decimal>();
    for (const [key, stock] of input.authority.productStocksByPair) {
        localBalances.set(key, legacyStockDecimal(stock.stock, 'de bodega'));
    }
    const batchBalances = new Map<string, Decimal>();
    for (const [batchId, batch] of input.authority.batchesById) {
        batchBalances.set(batchId, legacyStockDecimal(batch.stock, 'global del lote'));
    }
    const batchLedgerResults: Array<{ sourceHash: string; ledgerStatus: unknown }> = [];
    const snapshots: InventoryAuditSnapshot[] = [];

    try {
        for (const line of input.authority.planned) {
            const itemId = input.itemIdsByHash.get(line.sourceHash) ?? incompleteResult();
            const quantity = new Decimal(line.quantityExact);
            const delta = quantity.negated();
            const localKey = pairKey(line.productId, line.warehouseId);
            const warehouseBefore = localBalances.get(localKey) ?? reconciliationRequired(
                'El saldo local desapareció durante la devolución',
            );
            const warehouseAfter = warehouseBefore.minus(quantity);

            const stockResult = await applyStockDelta(tx, {
                tenantId: input.command.tenantId,
                productId: line.productId,
                delta: delta.toNumber(),
                enforceSufficient: true,
                warehouseId: line.warehouseId,
            });
            if (stockResult.warehouseId !== line.warehouseId) {
                reconciliationRequired('La salida fue aplicada en una bodega distinta de la evidencia');
            }
            localBalances.set(localKey, warehouseAfter);

            let batchBefore: Decimal | null = null;
            let batchAfter: Decimal | null = null;
            let batchWarehouseBefore: string | null = null;
            let batchWarehouseAfter: string | null = null;
            if (line.batchId !== null) {
                batchBefore = batchBalances.get(line.batchId) ?? reconciliationRequired(
                    'El lote desapareció durante la devolución',
                );
                batchAfter = batchBefore.minus(quantity);
                const batchResult = await applyBatchWarehouseDelta({
                    tx,
                    mode: input.batchLedgerMode,
                    tenantId: input.command.tenantId,
                    productId: line.productId,
                    batchId: line.batchId,
                    warehouseId: line.warehouseId,
                    delta: line.batchMovement?.delta ?? delta.toFixed(4),
                    movementType: 'PURCHASE_RETURN',
                    referenceId: itemId,
                    referenceType: 'SUPPLIER_RETURN_ITEM',
                    userId: input.command.userId,
                    reason: input.command.reason,
                    sourceKey: buildBoundedBatchWarehouseSourceKey(
                        `supplier-return:${input.supplierReturnId}:item:${itemId}`,
                        line.batchId,
                    ),
                    allowNegative: false,
                });
                batchLedgerResults.push({ sourceHash: line.sourceHash, ledgerStatus: batchResult.status });
                if (batchResult.status !== 'APPLIED') {
                    reconciliationRequired('El lote no pudo salir exactamente de la bodega de origen');
                }
                batchWarehouseBefore = batchResult.stockBefore;
                batchWarehouseAfter = batchResult.stockAfter;

                const decremented = await tx.productBatch.updateMany({
                    where: {
                        id: line.batchId,
                        tenantId: input.command.tenantId,
                        productId: line.productId,
                        stock: { gte: quantity.toNumber() },
                    },
                    data: { stock: { decrement: quantity.toNumber() } },
                });
                if (decremented.count !== 1) {
                    throw new SupplierReturnServiceError(
                        'SUPPLIER_RETURN_BATCH_STOCK_INSUFFICIENT',
                        409,
                        'El stock agregado del lote cambió durante la devolución',
                    );
                }
                batchBalances.set(line.batchId, batchAfter);
            }

            await tx.kardexMovement.create({
                data: {
                    tenantId: input.command.tenantId,
                    productId: line.productId,
                    type: line.kardexMovementType,
                    quantity: delta.toNumber(),
                    stockBefore: stockResult.stockBefore,
                    stockAfter: stockResult.stockAfter,
                    referenceId: input.supplierReturnId,
                    referenceType: line.kardexReferenceType,
                    reason: input.command.reason,
                    userId: input.command.userId,
                    batchId: line.batchId,
                    warehouseId: line.warehouseId,
                },
            });
            snapshots.push({
                supplierReturnItemId: itemId,
                productBefore: new Decimal(String(stockResult.stockBefore)).toFixed(4),
                productAfter: new Decimal(String(stockResult.stockAfter)).toFixed(4),
                warehouseBefore: warehouseBefore.toFixed(4),
                warehouseAfter: warehouseAfter.toFixed(4),
                batchBefore: batchBefore?.toFixed(4) ?? null,
                batchAfter: batchAfter?.toFixed(4) ?? null,
                batchWarehouseBefore,
                batchWarehouseAfter,
            });
        }
    } catch (error) {
        return translateInventoryError(error);
    }

    assertSupplierReturnBatchLedgerResults({
        planned: input.authority.planned,
        results: batchLedgerResults,
    });
    return snapshots;
};

const buildStoredResult = (input: {
    command: CanonicalSupplierReturnCommand;
    payloadHash: string;
    supplierReturnId: string;
    returnNumber: string;
    itemIdsByHash: ReadonlyMap<string, string>;
}): SupplierReturnStoredResult => ({
    version: SUPPLIER_RETURN_PAYLOAD_VERSION,
    commandType: SUPPLIER_RETURN_COMMAND_TYPE,
    commandId: buildSupplierReturnCommandId(input.command),
    payloadHash: input.payloadHash,
    response: {
        supplierReturnId: input.supplierReturnId,
        returnNumber: input.returnNumber,
        supplierId: input.command.supplierId,
        status: SUPPLIER_RETURN_STATUS,
        lines: input.command.lines.map(line => ({
            supplierReturnItemId: input.itemIdsByHash.get(line.sourceHash) ?? incompleteResult(),
            sourceHash: line.sourceHash,
            quantityExact: line.quantity,
        })),
    },
});

/** Ejecuta dentro de una transacción ya abierta; no acepta tenant desde HTTP. */
export async function executeSupplierReturn(
    input: ExecuteSupplierReturnInput,
): Promise<SupplierReturnResult> {
    const command = commandFromInput(input);
    const payloadHash = buildSupplierReturnPayloadHash(command);
    await assertActiveActor(input.tx, command);
    const fastReplay = await loadReplay(input.tx, command, payloadHash);
    if (fastReplay) return fastReplay;

    const batchLedgerMode = await resolveBatchWarehouseLedgerMode(input.tx, command.tenantId);
    await lockSupplier(input.tx, command);
    const sourceState = await lockSourceState(input.tx, command);
    const descriptors = buildSourceDescriptors(command, sourceState);
    await lockWarehouses(input.tx, command.tenantId, descriptors.map(source => source.warehouseId));

    // Cierra la carrera con un comando ganador antes de reclamar el encabezado.
    const lockedReplay = await loadReplay(input.tx, command, payloadHash);
    if (lockedReplay) return lockedReplay;

    const now = input.now ?? new Date();
    const supplierReturnId = randomUUID();
    const returnNumber = returnNumberFor(command.clientEventId);
    await input.tx.supplierReturn.create({
        data: {
            id: supplierReturnId,
            tenantId: command.tenantId,
            supplierId: command.supplierId,
            returnNumber,
            status: SUPPLIER_RETURN_STATUS,
            reasonCode: command.reasonCode,
            reason: command.reason,
            supplierReference: command.supplierReference,
            clientEventId: command.clientEventId,
            payloadVersion: SUPPLIER_RETURN_PAYLOAD_VERSION,
            payloadHash,
            batchLedgerMode,
            returnedBy: command.userId,
            returnedAt: now,
            createdAt: now,
        },
        select: { id: true },
    });

    const authority = await lockInventoryAuthority(input.tx, {
        command,
        state: sourceState,
        descriptors,
        batchLedgerMode,
    });
    const itemIdsByHash = new Map(authority.planned.map(line => [line.sourceHash, randomUUID()]));
    await input.tx.supplierReturnItem.createMany({
        data: authority.planned.map(line => ({
            id: itemIdsByHash.get(line.sourceHash)!,
            tenantId: command.tenantId,
            supplierReturnId,
            sourceType: line.sourceType,
            ...sourceForeignKeys(line),
            productId: line.productId,
            productNameAtReturn: line.productNameAtReturn,
            warehouseId: line.warehouseId,
            batchId: line.batchId,
            quantityExact: line.quantityExact,
            bookUnitCostExact: line.bookUnitCostExact,
            bookValueExact: line.bookValueExact,
            unitAtReturn: line.unitAtReturn,
            saleModeAtReturn: line.saleModeAtReturn,
            quantityStepAtReturn: line.quantityStepAtReturn,
            batchNumberAtReturn: line.batchNumberAtReturn,
            expiryDateAtReturn: line.expiryDateAtReturn === null ? null : new Date(line.expiryDateAtReturn),
            sourceHash: line.sourceHash,
            batchLedgerStatus: line.batchLedgerStatus,
            createdAt: now,
        })),
    });

    const snapshots = await postInventory(input.tx, {
        command,
        supplierReturnId,
        itemIdsByHash,
        batchLedgerMode,
        authority,
    });
    const storedResult = buildStoredResult({
        command,
        payloadHash,
        supplierReturnId,
        returnNumber,
        itemIdsByHash,
    });
    await input.tx.auditLog.create({
        data: {
            id: buildSupplierReturnResultAuditId(command),
            tenantId: command.tenantId,
            userId: command.userId,
            action: 'SUPPLIER_RETURN_POSTED',
            details: JSON.stringify({
                ...storedResult,
                audit: {
                    before: snapshots.map(snapshot => ({
                        supplierReturnItemId: snapshot.supplierReturnItemId,
                        product: snapshot.productBefore,
                        warehouse: snapshot.warehouseBefore,
                        batch: snapshot.batchBefore,
                        batchWarehouse: snapshot.batchWarehouseBefore,
                    })),
                    after: snapshots.map(snapshot => ({
                        supplierReturnItemId: snapshot.supplierReturnItemId,
                        product: snapshot.productAfter,
                        warehouse: snapshot.warehouseAfter,
                        batch: snapshot.batchAfter,
                        batchWarehouse: snapshot.batchWarehouseAfter,
                    })),
                },
            }),
            createdAt: now,
        },
    });

    const created = await input.tx.supplierReturn.findFirst({
        where: { id: supplierReturnId, tenantId: command.tenantId },
        select: supplierReturnSelect,
    }) as SupplierReturnRecord | null;
    if (!created) return incompleteResult();
    if (created.items.length !== command.lines.length) return incompleteResult();
    return serializeOperationalReturn(created, false);
}

/** Frontera request-safe con replay P2002 fuera del snapshot perdedor. */
export async function executeSupplierReturnTransaction({
    db = prisma,
    ...input
}: ExecuteSupplierReturnTransactionInput): Promise<SupplierReturnResult> {
    const command = commandFromInput(input);
    const payloadHash = buildSupplierReturnPayloadHash(command);
    await assertActiveActor(db, command);
    const fastReplay = await loadReplay(db, command, payloadHash);
    if (fastReplay) return fastReplay;

    try {
        return await db.$transaction(
            tx => executeSupplierReturn({ tx, ...input }),
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
    } catch (error) {
        if (isPrismaCode(error, 'P2034')) {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_CONCURRENT_WRITE',
                409,
                'La devolución chocó con otro movimiento; intentá nuevamente',
            );
        }
        if (!isPrismaCode(error, 'P2002')) throw error;
        await assertActiveActor(db, command);
        const replay = await loadReplay(db, command, payloadHash);
        if (replay) return replay;
        throw error;
    }
}

export interface ListSupplierReturnsInput {
    db?: Database;
    tenantId: string;
    supplierId: string;
    purchaseOrderId?: string | null;
    cursor?: string | null;
    take?: number;
}

export interface SupplierReturnTimelinePage {
    items: SupplierReturnOperationalDto[];
    nextCursor: string | null;
}

const boundedTake = (value: number | undefined, fallback = 25): number => {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_INVALID_CONTEXT',
            400,
            'take debe ser un entero entre 1 y 100',
        );
    }
    return value;
};

const cleanOptionalId = (value: string | null | undefined, label: string): string | null => {
    if (value == null) return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_INVALID_CONTEXT',
            400,
            `${label} no es válido`,
        );
    }
    return normalized;
};

/** Timeline físico redacted; jamás expone costo libro, hashes ni CxP. */
export async function listSupplierReturns({
    db = prisma,
    tenantId,
    supplierId,
    purchaseOrderId: rawPurchaseOrderId,
    cursor: rawCursor,
    take: rawTake,
}: ListSupplierReturnsInput): Promise<SupplierReturnTimelinePage> {
    const commandScope = normalizeSupplierReturnCommand({
        tenantId,
        userId: 'read-context',
        supplierId,
        clientEventId: '00000000-0000-4000-8000-000000000000',
        reasonCode: 'OTHER',
        reason: 'read context',
        lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'read-context', quantity: '1' }],
    });
    const take = boundedTake(rawTake);
    const purchaseOrderId = cleanOptionalId(rawPurchaseOrderId, 'purchaseOrderId');
    const cursor = cleanOptionalId(rawCursor, 'cursor');
    const supplier = await db.supplier.findFirst({
        where: { id: commandScope.supplierId, tenantId: commandScope.tenantId },
        select: { id: true },
    });
    if (!supplier) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_SUPPLIER_NOT_FOUND',
            404,
            'El proveedor no existe en este negocio',
        );
    }
    if (cursor) {
        const cursorRow = await db.supplierReturn.findFirst({
            where: { id: cursor, tenantId: commandScope.tenantId, supplierId: commandScope.supplierId },
            select: { id: true },
        });
        if (!cursorRow) {
            throw new SupplierReturnServiceError(
                'SUPPLIER_RETURN_INVALID_CONTEXT',
                400,
                'cursor no pertenece a este timeline',
            );
        }
    }
    const rows = await db.supplierReturn.findMany({
        where: {
            tenantId: commandScope.tenantId,
            supplierId: commandScope.supplierId,
            ...(purchaseOrderId === null ? {} : {
                items: {
                    some: {
                        OR: [
                            { purchaseItem: { purchase: { purchaseOrderId } } },
                            { goodsReceiptItem: { receipt: { purchaseOrderId } } },
                            {
                                purchaseMatchAllocation: {
                                    purchaseItem: { purchase: { purchaseOrderId } },
                                },
                            },
                        ],
                    },
                },
            }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
        select: supplierReturnSelect,
    }) as SupplierReturnRecord[];
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
        items: page.map(row => serializeOperationalReturn(row, false).supplierReturn),
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
}

export type SupplierReturnEligibleBlockCode =
    | 'SOURCE_RECONCILIATION_REQUIRED'
    | 'SERIAL_UNSUPPORTED'
    | 'BATCH_RECONCILIATION_REQUIRED'
    | 'BATCH_LEDGER_OFF'
    | 'SHADOW_GAP'
    | 'STOCK_ROW_MISSING'
    | 'STOCK_INSUFFICIENT'
    | 'NO_AVAILABLE_QUANTITY';

export interface SupplierReturnEligibleLine {
    sourceType: 'GOODS_RECEIPT_UNMATCHED' | 'PURCHASE_MATCH_ALLOCATION';
    sourceId: string;
    purchaseOrderId: string;
    goodsReceiptItemId: string;
    purchaseMatchAllocationId: string | null;
    product: { id: string; name: string };
    warehouse: { id: string; name: string };
    batch: null | { id: string; batchNumber: string; expiryDate: string };
    quantity: {
        acceptedExact: string;
        allocatedExact: string;
        returnedExact: string;
        availableExact: string;
        physicalRemainingExact: string;
    };
    unitAtReturn: string;
    saleModeAtReturn: string | null;
    quantityStepAtReturn: string | null;
    blockCode: SupplierReturnEligibleBlockCode | null;
}

export interface SupplierReturnEligibleContext {
    purchaseOrderId: string;
    supplierId: string;
    batchLedgerMode: string;
    eligibleLines: SupplierReturnEligibleLine[];
    truncated: boolean;
}

export interface GetSupplierReturnEligibleLinesInput {
    db?: Database;
    tenantId: string;
    supplierId: string;
    purchaseOrderId: string;
    take?: number;
}

interface EligibleReceiptRow {
    goodsReceiptItemId: string;
    purchaseOrderItemId: string;
    productId: string;
    productName: string;
    productUnit: string;
    productSaleMode: string | null;
    productQuantityStep: DecimalInput | null;
    requiresBatchTracking: boolean | number;
    requiresSerialTracking: boolean | number;
    warehouseId: string;
    warehouseName: string;
    quantityExact: DecimalInput;
    orderUnit: string | null;
    orderSaleMode: string | null;
    orderQuantityStep: DecimalInput | null;
    orderQuantityOrdered: number;
    orderQuantityReceived: number;
    orderQuantityOrderedExact: DecimalInput | null;
    orderQuantityReceivedExact: DecimalInput | null;
    unitSnapshot: string;
    saleModeSnapshot: string | null;
    batchId: string | null;
    batchNumber: string | null;
    expiryDate: Date | null;
    currentBatchNumber: string | null;
    currentBatchExpiryDate: Date | null;
    currentBatchStock: number | null;
}

interface EligibleAllocationRow extends LockedAllocationRow {
    purchaseStatus: string;
    purchaseOrderId: string | null;
    purchaseSupplierId: string;
    purchaseItemProductId: string;
}

const loadReadPriorAggregate = async (
    db: Database,
    input: {
        tenantId: string;
        ids: readonly string[];
        column: 'goodsReceiptItemId' | 'purchaseMatchAllocationId';
        sourceType: 'GOODS_RECEIPT_UNMATCHED' | 'PURCHASE_MATCH_ALLOCATION';
    },
): Promise<Map<string, Decimal>> => {
    if (input.ids.length === 0) return new Map();
    const column = Prisma.raw(`sri.\`${input.column}\``);
    const rows = await db.$queryRaw<PriorReturnAggregateRow[]>(Prisma.sql`
        SELECT ${column} AS sourceId,
               COALESCE(SUM(CASE
                   WHEN sr.status = ${SUPPLIER_RETURN_STATUS}
                    AND sri.sourceType = ${input.sourceType}
                   THEN sri.quantityExact ELSE 0 END), 0) AS returnedExact,
               SUM(CASE
                   WHEN sr.status <> ${SUPPLIER_RETURN_STATUS}
                     OR sri.sourceType <> ${input.sourceType}
                   THEN 1 ELSE 0 END) AS invalidCount
        FROM \`SupplierReturnItem\` sri
        INNER JOIN \`SupplierReturn\` sr
                ON sr.id = sri.supplierReturnId
               AND sr.tenantId = sri.tenantId
        WHERE sri.tenantId = ${input.tenantId}
          AND ${column} IN (${Prisma.join(input.ids)})
        GROUP BY ${column}
        ORDER BY ${column}
    `);
    const result = new Map<string, Decimal>();
    for (const row of rows) {
        if (new Decimal(String(row.invalidCount)).greaterThan(0)) {
            reconciliationRequired('El historial de devoluciones de la fuente no es conciliable');
        }
        result.set(row.sourceId, exactDecimal(row.returnedExact, 4, 'returnedExact'));
    }
    return result;
};

/**
 * Contexto autoritativo para captura: selecciona la identidad válida después
 * del matching y deja las ambigüedades históricas visibles como blockCode.
 */
export async function getSupplierReturnEligibleLines({
    db = prisma,
    tenantId,
    supplierId,
    purchaseOrderId: rawPurchaseOrderId,
    take: rawTake,
}: GetSupplierReturnEligibleLinesInput): Promise<SupplierReturnEligibleContext> {
    const purchaseOrderId = cleanOptionalId(rawPurchaseOrderId, 'purchaseOrderId');
    if (purchaseOrderId === null) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_INVALID_CONTEXT',
            400,
            'purchaseOrderId es requerido',
        );
    }
    const scope = normalizeSupplierReturnCommand({
        tenantId,
        userId: 'read-context',
        supplierId,
        clientEventId: '00000000-0000-4000-8000-000000000000',
        reasonCode: 'OTHER',
        reason: 'read context',
        lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'read-context', quantity: '1' }],
    });
    const take = boundedTake(rawTake, 100);
    const supplier = await db.supplier.findFirst({
        where: { id: scope.supplierId, tenantId: scope.tenantId },
        select: { id: true },
    });
    if (!supplier) {
        throw new SupplierReturnServiceError(
            'SUPPLIER_RETURN_SUPPLIER_NOT_FOUND',
            404,
            'El proveedor no existe en este negocio',
        );
    }
    const purchaseOrder = await db.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, tenantId: scope.tenantId, supplierId: scope.supplierId },
        select: { id: true },
    });
    if (!purchaseOrder) sourceNotFound();
    const batchLedgerMode = await resolveBatchWarehouseLedgerMode(db, scope.tenantId);

    const receiptRows = await db.$queryRaw<EligibleReceiptRow[]>(Prisma.sql`
        SELECT gri.id AS goodsReceiptItemId,
               gri.purchaseOrderItemId,
               gri.productId,
               p.name AS productName,
               p.unit AS productUnit,
               p.saleMode AS productSaleMode,
               p.quantityStep AS productQuantityStep,
               p.requiresBatchTracking,
               p.requiresSerialTracking,
               gr.warehouseId,
               w.name AS warehouseName,
               gri.quantityExact,
               poi.unitAtOrder AS orderUnit,
               poi.saleModeAtOrder AS orderSaleMode,
               poi.quantityStepAtOrder AS orderQuantityStep,
               poi.quantityOrdered AS orderQuantityOrdered,
               poi.quantityReceived AS orderQuantityReceived,
               poi.quantityOrderedExact AS orderQuantityOrderedExact,
               poi.quantityReceivedExact AS orderQuantityReceivedExact,
               gri.unitSnapshot,
               gri.saleModeSnapshot,
               gri.batchId,
               gri.batchNumber,
               gri.expiryDate,
               pb.batchNumber AS currentBatchNumber,
               pb.expiryDate AS currentBatchExpiryDate,
               pb.stock AS currentBatchStock
        FROM \`GoodsReceiptItem\` gri
        INNER JOIN \`GoodsReceipt\` gr
                ON gr.id = gri.goodsReceiptId
               AND gr.tenantId = gri.tenantId
        INNER JOIN \`PurchaseOrder\` po
                ON po.id = gr.purchaseOrderId
               AND po.tenantId = gr.tenantId
        INNER JOIN \`PurchaseOrderItem\` poi
                ON poi.id = gri.purchaseOrderItemId
               AND poi.purchaseOrderId = po.id
        INNER JOIN \`Product\` p
                ON p.id = gri.productId
               AND p.tenantId = gri.tenantId
        INNER JOIN \`Warehouse\` w
                ON w.id = gr.warehouseId
               AND w.tenantId = gr.tenantId
        LEFT JOIN \`ProductBatch\` pb
               ON pb.id = gri.batchId
              AND pb.tenantId = gri.tenantId
        WHERE gri.tenantId = ${scope.tenantId}
          AND po.id = ${purchaseOrderId}
          AND po.supplierId = ${scope.supplierId}
          AND gr.status = 'POSTED'
        ORDER BY gr.receivedAt, gri.id
        LIMIT ${take + 1}
    `);
    const truncated = receiptRows.length > take;
    const receipts = truncated ? receiptRows.slice(0, take) : receiptRows;
    const receiptItemIds = uniqueSorted(receipts.map(row => row.goodsReceiptItemId));
    if (receiptItemIds.length === 0) {
        return {
            purchaseOrderId,
            supplierId: scope.supplierId,
            batchLedgerMode,
            eligibleLines: [],
            truncated,
        };
    }

    const allocations = await db.$queryRaw<EligibleAllocationRow[]>(Prisma.sql`
        SELECT pma.id, pma.purchaseItemId, pma.purchaseOrderItemId,
               pma.goodsReceiptItemId, pma.source, pma.quantityExact,
               p.documentStatus AS purchaseStatus,
               p.purchaseOrderId,
               p.supplierId AS purchaseSupplierId,
               pi.productId AS purchaseItemProductId
        FROM \`PurchaseMatchAllocation\` pma
        INNER JOIN \`PurchaseItem\` pi ON pi.id = pma.purchaseItemId
        INNER JOIN \`Purchase\` p
                ON p.id = pi.purchaseId
               AND p.tenantId = pma.tenantId
        WHERE pma.tenantId = ${scope.tenantId}
          AND pma.goodsReceiptItemId IN (${Prisma.join(receiptItemIds)})
        ORDER BY pma.goodsReceiptItemId, pma.id
    `);
    const allocationIds = uniqueSorted(allocations.map(row => row.id));
    const priorUnmatched = await loadReadPriorAggregate(db, {
        tenantId: scope.tenantId,
        ids: receiptItemIds,
        column: 'goodsReceiptItemId',
        sourceType: 'GOODS_RECEIPT_UNMATCHED',
    });
    const priorMatched = await loadReadPriorAggregate(db, {
        tenantId: scope.tenantId,
        ids: allocationIds,
        column: 'purchaseMatchAllocationId',
        sourceType: 'PURCHASE_MATCH_ALLOCATION',
    });

    const productIds = uniqueSorted(receipts.map(row => row.productId));
    const warehouseIds = uniqueSorted(receipts.map(row => row.warehouseId));
    const batchIds = uniqueSorted(receipts.map(row => row.batchId));
    const [batchHistoryRows, serialHistoryRows, localStocks, batchLocalStocks, gapRows] = await Promise.all([
        db.productBatch.findMany({
            where: { tenantId: scope.tenantId, productId: { in: productIds } },
            distinct: ['productId'],
            select: { productId: true },
        }),
        db.serialNumber.findMany({
            where: { tenantId: scope.tenantId, productId: { in: productIds } },
            distinct: ['productId'],
            select: { productId: true },
        }),
        db.productStock.findMany({
            where: {
                tenantId: scope.tenantId,
                productId: { in: productIds },
                warehouseId: { in: warehouseIds },
            },
            select: { productId: true, warehouseId: true, stock: true },
        }),
        batchIds.length === 0 ? Promise.resolve([]) : db.productBatchWarehouseStock.findMany({
            where: {
                tenantId: scope.tenantId,
                batchId: { in: batchIds },
                warehouseId: { in: warehouseIds },
            },
            select: { batchId: true, warehouseId: true, stock: true },
        }),
        batchIds.length === 0 ? Promise.resolve([]) : db.productBatchLedgerEntry.findMany({
            where: { tenantId: scope.tenantId, batchId: { in: batchIds }, status: 'SHADOW_GAP' },
            distinct: ['batchId'],
            select: { batchId: true },
        }),
    ]);
    const batchHistory = new Set(batchHistoryRows.map(row => row.productId));
    const serialHistory = new Set(serialHistoryRows.map(row => row.productId));
    const gaps = new Set(gapRows.map(row => row.batchId));
    const localByPair = new Map(localStocks.map(row => [pairKey(row.productId, row.warehouseId), row.stock]));
    const batchLocalByPair = new Map(batchLocalStocks.map(row => [pairKey(row.batchId, row.warehouseId), row.stock]));
    const allocationsByReceipt = new Map<string, EligibleAllocationRow[]>();
    for (const allocation of allocations) {
        if (!allocation.goodsReceiptItemId) continue;
        const bucket = allocationsByReceipt.get(allocation.goodsReceiptItemId) ?? [];
        bucket.push(allocation);
        allocationsByReceipt.set(allocation.goodsReceiptItemId, bucket);
    }

    const eligibleLines: SupplierReturnEligibleLine[] = [];
    for (const receipt of receipts) {
        const accepted = exactDecimal(receipt.quantityExact, 4, 'goodsReceipt.quantityExact', { positive: true });
        const receiptAllocations = allocationsByReceipt.get(receipt.goodsReceiptItemId) ?? [];
        let allocated = new Decimal(0);
        let matchedReturned = new Decimal(0);
        let relationshipCorrupt = false;
        for (const allocation of receiptAllocations) {
            const quantity = exactDecimal(allocation.quantityExact, 4, 'allocation.quantityExact', { positive: true });
            allocated = allocated.plus(quantity);
            matchedReturned = matchedReturned.plus(priorFor(priorMatched, allocation.id));
            if (
                allocation.source !== 'FORMAL_RECEIPT'
                || allocation.purchaseOrderItemId !== receipt.purchaseOrderItemId
                || allocation.purchaseOrderId !== purchaseOrderId
                || allocation.purchaseSupplierId !== scope.supplierId
                || allocation.purchaseStatus !== 'POSTED'
                || allocation.purchaseItemProductId !== receipt.productId
            ) relationshipCorrupt = true;
        }
        const unmatchedReturned = priorFor(priorUnmatched, receipt.goodsReceiptItemId);
        const physicalReturned = unmatchedReturned.plus(matchedReturned);
        const physicalRemaining = Decimal.max(0, accepted.minus(physicalReturned));
        if (
            allocated.greaterThan(accepted)
            || matchedReturned.greaterThan(allocated)
            || physicalReturned.greaterThan(accepted)
        ) relationshipCorrupt = true;

        let rules: { saleMode: 'COUNTED' | 'MEASURED'; quantityStep: string } | null = null;
        try {
            rules = purchaseOrderRulesForReceipt({
                id: receipt.purchaseOrderItemId,
                productId: receipt.productId,
                productName: receipt.productName,
                quantityOrdered: receipt.orderQuantityOrdered,
                quantityReceived: receipt.orderQuantityReceived,
                quantityOrderedExact: receipt.orderQuantityOrderedExact,
                quantityReceivedExact: receipt.orderQuantityReceivedExact,
                unitAtOrder: receipt.orderUnit,
                saleModeAtOrder: receipt.orderSaleMode,
                quantityStepAtOrder: receipt.orderQuantityStep,
            }, {
                id: receipt.productId,
                name: receipt.productName,
                unit: receipt.productUnit,
                saleMode: receipt.productSaleMode,
                quantityStep: receipt.productQuantityStep,
            });
        } catch {
            relationshipCorrupt = true;
        }
        const expectedUnit = receipt.orderUnit ?? receipt.productUnit;
        if (
            rules === null
            || receipt.unitSnapshot !== expectedUnit
            || receipt.saleModeSnapshot !== rules.saleMode
        ) relationshipCorrupt = true;
        const tracked = bool(receipt.requiresBatchTracking)
            || batchHistory.has(receipt.productId)
            || receipt.batchId !== null;
        const serialized = bool(receipt.requiresSerialTracking) || serialHistory.has(receipt.productId);
        let commonBlock: SupplierReturnEligibleBlockCode | null = relationshipCorrupt
            ? 'SOURCE_RECONCILIATION_REQUIRED'
            : serialized
                ? 'SERIAL_UNSUPPORTED'
                : null;
        if (commonBlock === null && tracked) {
            if (
                receipt.batchId === null
                || receipt.batchNumber === null
                || receipt.expiryDate === null
                || receipt.currentBatchNumber !== receipt.batchNumber
                || receipt.currentBatchExpiryDate?.getTime() !== receipt.expiryDate.getTime()
            ) commonBlock = 'BATCH_RECONCILIATION_REQUIRED';
            else if (batchLedgerMode === 'OFF') commonBlock = 'BATCH_LEDGER_OFF';
            else if (gaps.has(receipt.batchId)) commonBlock = 'SHADOW_GAP';
        }
        const localStock = localByPair.get(pairKey(receipt.productId, receipt.warehouseId));
        if (commonBlock === null && localStock === undefined) commonBlock = 'STOCK_ROW_MISSING';
        if (commonBlock === null && legacyStockDecimal(localStock, 'de bodega').lessThanOrEqualTo(0)) {
            commonBlock = 'STOCK_INSUFFICIENT';
        }
        if (commonBlock === null && receipt.batchId !== null) {
            const batchLocal = batchLocalByPair.get(pairKey(receipt.batchId, receipt.warehouseId));
            if (batchLocal === undefined) commonBlock = 'BATCH_RECONCILIATION_REQUIRED';
            else if (
                exactDecimal(batchLocal, 4, 'batchWarehouse.stock').lessThanOrEqualTo(0)
                || receipt.currentBatchStock == null
                || legacyStockDecimal(receipt.currentBatchStock, 'global del lote').lessThanOrEqualTo(0)
            ) commonBlock = 'STOCK_INSUFFICIENT';
        }

        const base = {
            purchaseOrderId,
            goodsReceiptItemId: receipt.goodsReceiptItemId,
            product: { id: receipt.productId, name: receipt.productName },
            warehouse: { id: receipt.warehouseId, name: receipt.warehouseName },
            batch: receipt.batchId === null ? null : {
                id: receipt.batchId,
                batchNumber: receipt.batchNumber ?? '',
                expiryDate: receipt.expiryDate?.toISOString() ?? '',
            },
            unitAtReturn: receipt.unitSnapshot,
            saleModeAtReturn: receipt.saleModeSnapshot,
            quantityStepAtReturn: rules === null ? null : new Decimal(rules.quantityStep).toFixed(4),
        };
        for (const allocation of receiptAllocations) {
            const allocationQuantity = exactDecimal(allocation.quantityExact, 4, 'allocation.quantityExact', { positive: true });
            const returned = priorFor(priorMatched, allocation.id);
            const available = Decimal.max(0, Decimal.min(allocationQuantity.minus(returned), physicalRemaining));
            eligibleLines.push({
                ...base,
                sourceType: 'PURCHASE_MATCH_ALLOCATION',
                sourceId: allocation.id,
                purchaseMatchAllocationId: allocation.id,
                quantity: {
                    acceptedExact: accepted.toFixed(4),
                    allocatedExact: allocationQuantity.toFixed(4),
                    returnedExact: returned.toFixed(4),
                    availableExact: available.toFixed(4),
                    physicalRemainingExact: physicalRemaining.toFixed(4),
                },
                blockCode: commonBlock ?? (available.isZero() ? 'NO_AVAILABLE_QUANTITY' : null),
            });
        }
        const unmatchedAvailable = Decimal.max(0, accepted.minus(allocated).minus(unmatchedReturned));
        if (receiptAllocations.length === 0 || unmatchedAvailable.greaterThan(0)) {
            eligibleLines.push({
                ...base,
                sourceType: 'GOODS_RECEIPT_UNMATCHED',
                sourceId: receipt.goodsReceiptItemId,
                purchaseMatchAllocationId: null,
                quantity: {
                    acceptedExact: accepted.toFixed(4),
                    allocatedExact: allocated.toFixed(4),
                    returnedExact: unmatchedReturned.toFixed(4),
                    availableExact: unmatchedAvailable.toFixed(4),
                    physicalRemainingExact: physicalRemaining.toFixed(4),
                },
                blockCode: commonBlock ?? (unmatchedAvailable.isZero() ? 'NO_AVAILABLE_QUANTITY' : null),
            });
        }
    }

    eligibleLines.sort((left, right) => left.product.name.localeCompare(right.product.name)
        || left.goodsReceiptItemId.localeCompare(right.goodsReceiptItemId)
        || left.sourceType.localeCompare(right.sourceType)
        || left.sourceId.localeCompare(right.sourceId));
    return {
        purchaseOrderId,
        supplierId: scope.supplierId,
        batchLedgerMode,
        eligibleLines,
        truncated,
    };
}
