import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { normalizeCalendarDateInput } from '../lib/calendarDate.js';
import { managuaBusinessDate } from '../lib/managuaBusinessDate.js';
import {
    assertSupplierCreditNoteReplay,
    buildSupplierCreditNoteCommandId,
    buildSupplierCreditNotePayloadHash,
    normalizeSupplierCreditNoteRequest,
    parseSupplierCreditNoteStoredResult,
    planSupplierCreditNotePosting,
    SUPPLIER_CREDIT_NOTE_COMMAND_TYPE,
    SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION,
    SUPPLIER_CREDIT_NOTE_STATUS,
    SupplierCreditNoteError,
    type CanonicalSupplierCreditApplicationRequest,
    type CanonicalSupplierCreditNoteCommand,
    type SupplierCreditFiscalRegime,
    type SupplierCreditNoteCommandInput,
    type SupplierCreditNoteStoredResult,
} from '../lib/supplierCreditNotes.js';
import { assertPeriodOpen, PeriodLockedError, recordSupplierCreditNote } from './accounting.js';

type PrismaTx = Prisma.TransactionClient;
type Database = PrismaClient;
type DecimalInput = Decimal.Value | { toString(): string };

const SUPPLIER_CREDIT_FISCAL_REGIMES = new Set<string>(['GENERAL', 'CUOTA_FIJA']);

export type SupplierCreditNoteServiceErrorCode =
    | 'SUPPLIER_CREDIT_NOTE_INVALID_CONTEXT'
    | 'SUPPLIER_CREDIT_NOTE_ACTOR_FORBIDDEN'
    | 'SUPPLIER_CREDIT_NOTE_SUPPLIER_NOT_FOUND'
    | 'SUPPLIER_CREDIT_NOTE_TENANT_NOT_FOUND'
    | 'SUPPLIER_CREDIT_NOTE_CONCURRENT_WRITE';

export class SupplierCreditNoteServiceError extends Error {
    constructor(
        readonly code: SupplierCreditNoteServiceErrorCode,
        readonly httpStatus: 400 | 403 | 404 | 409,
        message: string,
    ) {
        super(message);
        this.name = 'SupplierCreditNoteServiceError';
    }
}

export type SupplierCreditNoteRequest = Omit<
    SupplierCreditNoteCommandInput,
    'tenantId' | 'userId' | 'supplierId' | 'fiscalRegimeAtCredit' | 'currencyAtIssue'
>;

export interface SupplierCreditNoteResult {
    supplierCreditNote: {
        id: string;
        supplierId: string;
        creditNoteNumber: string;
        status: typeof SUPPLIER_CREDIT_NOTE_STATUS;
        total: string;
        remainingCredit: '0.00';
    };
    returnItemIds: string[];
    applications: CanonicalSupplierCreditApplicationRequest[];
    replay: boolean;
}

export interface ExecuteSupplierCreditNoteInput {
    tx: PrismaTx;
    tenantId: string;
    userId: string;
    supplierId: string;
    request: SupplierCreditNoteRequest;
    now?: Date;
}

export interface ExecuteSupplierCreditNoteTransactionInput extends Omit<ExecuteSupplierCreditNoteInput, 'tx'> {
    db?: PrismaClient;
}

interface RequestedTargets {
    clientEventId: string;
    purchaseIds: string[];
    returnItemIds: string[];
}

interface LockedTenantRow {
    id: string;
}

interface LockedSupplierRow {
    id: string;
}

interface LockedPurchaseRow {
    id: string;
}

interface LockedReturnItemRow {
    supplierReturnId: string;
    supplierReturnItemId: string;
}

interface LockedAllocationRow {
    id: string;
    goodsReceiptItemId: string | null;
}

const supplierCreditNoteSelect = Prisma.validator<Prisma.SupplierCreditNoteSelect>()({
    id: true,
    tenantId: true,
    supplierId: true,
    creditNoteNumber: true,
    type: true,
    status: true,
    invoiceDate: true,
    creditNoteDate: true,
    devolutionDate: true,
    postingDate: true,
    fiscalRegimeAtCredit: true,
    currencyAtIssue: true,
    subtotal: true,
    tax: true,
    creditableTax: true,
    total: true,
    inventoryReversalExact: true,
    priceVarianceReversalExact: true,
    remainingCredit: true,
    reason: true,
    supplierReference: true,
    clientEventId: true,
    payloadVersion: true,
    payloadHash: true,
    createdBy: true,
    createdAt: true,
    applications: {
        orderBy: [{ purchaseId: 'asc' }, { id: 'asc' }],
        select: {
            purchaseId: true,
            amount: true,
        },
    },
    lines: {
        orderBy: [{ supplierReturnItemId: 'asc' }, { id: 'asc' }],
        select: {
            supplierReturnItemId: true,
            sourcePurchaseItemId: true,
            purchaseMatchAllocationId: true,
            sourceHash: true,
            quantityExact: true,
            bookUnitCostExact: true,
            bookValueExact: true,
            subtotal: true,
            tax: true,
            creditableTax: true,
            total: true,
            inventoryReversalExact: true,
            priceVarianceReversalExact: true,
            descriptionAtCredit: true,
            unitAtCredit: true,
            sourcePurchaseItem: {
                select: {
                    purchaseId: true,
                },
            },
            purchaseMatchAllocation: {
                select: {
                    purchaseItem: {
                        select: {
                            purchaseId: true,
                        },
                    },
                },
            },
            supplierReturnItem: {
                select: {
                    supplierReturnId: true,
                    sourceType: true,
                    goodsReceiptItemId: true,
                    sourceHash: true,
                },
            },
        },
    },
});

type SupplierCreditNoteRecord = Prisma.SupplierCreditNoteGetPayload<{ select: typeof supplierCreditNoteSelect }>;

const purchaseSelect = Prisma.validator<Prisma.PurchaseSelect>()({
    id: true,
    tenantId: true,
    supplierId: true,
    status: true,
    paymentMethod: true,
    documentStatus: true,
    date: true,
    fiscalRegimeAtPurchase: true,
    balanceDue: true,
    paidAt: true,
    settledAt: true,
});

type LockedPurchaseRecord = Prisma.PurchaseGetPayload<{ select: typeof purchaseSelect }>;

const purchaseItemAuthoritySelect = Prisma.validator<Prisma.PurchaseItemSelect>()({
    id: true,
    purchaseId: true,
    quantity: true,
    quantityExact: true,
    totalCost: true,
    taxAmountExact: true,
    creditableTaxExact: true,
});

type PurchaseItemAuthority = Prisma.PurchaseItemGetPayload<{ select: typeof purchaseItemAuthoritySelect }>;

const supplierReturnItemSelect = Prisma.validator<Prisma.SupplierReturnItemSelect>()({
    id: true,
    tenantId: true,
    supplierReturnId: true,
    sourceType: true,
    purchaseItemId: true,
    goodsReceiptItemId: true,
    purchaseMatchAllocationId: true,
    quantityExact: true,
    bookUnitCostExact: true,
    bookValueExact: true,
    productNameAtReturn: true,
    unitAtReturn: true,
    sourceHash: true,
    supplierReturn: {
        select: {
            supplierId: true,
            status: true,
            returnedAt: true,
        },
    },
    purchaseItem: {
        select: purchaseItemAuthoritySelect,
    },
    purchaseMatchAllocation: {
        select: {
            id: true,
            quantityExact: true,
            purchaseItem: {
                select: purchaseItemAuthoritySelect,
            },
        },
    },
    creditNoteLine: {
        select: { id: true },
    },
});

type SupplierReturnItemRecord = Prisma.SupplierReturnItemGetPayload<{ select: typeof supplierReturnItemSelect }>;

const allocationSelect = Prisma.validator<Prisma.PurchaseMatchAllocationSelect>()({
    id: true,
    tenantId: true,
    goodsReceiptItemId: true,
    quantityExact: true,
    purchaseItem: {
        select: {
            ...purchaseItemAuthoritySelect,
            purchase: { select: { supplierId: true } },
        },
    },
});

type AllocationRecord = Prisma.PurchaseMatchAllocationGetPayload<{ select: typeof allocationSelect }>;

type ActorDatabase = Pick<PrismaTx, 'user'> | Pick<Database, 'user'>;
type ReplayDatabase = Pick<PrismaTx, 'user' | 'auditLog' | 'supplierCreditNote'>
    | Pick<Database, 'user' | 'auditLog' | 'supplierCreditNote'>;

const asIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

const managuaDateOnly = (value: Date): string => asIsoDate(managuaBusinessDate(value));

const isPrismaCode = (error: unknown, code: 'P2002'): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === code
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === code;

const invalidContext = (message: string): never => {
    throw new SupplierCreditNoteServiceError('SUPPLIER_CREDIT_NOTE_INVALID_CONTEXT', 400, message);
};

const incompleteResult = (): never => {
    throw new SupplierCreditNoteError(
        'SUPPLIER_CREDIT_NOTE_RESULT_INCOMPLETE',
        500,
        'El resultado idempotente de la nota está incompleto o corrupto',
    );
};

const record = (value: unknown): value is Record<string, unknown> =>
    Object(value) === value && !Array.isArray(value);

const canonicalIdentifier = (value: unknown, field: string): string => {
    if (typeof value !== 'string') {
        throw new SupplierCreditNoteError('SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400, `${field} debe ser texto`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new SupplierCreditNoteError('SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400, `${field} no es válido`);
    }
    return normalized;
};

const canonicalClientEventId = (value: unknown): string => {
    const normalized = canonicalIdentifier(value, 'clientEventId').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_INVALID_INPUT',
            400,
            'clientEventId debe ser UUID',
        );
    }
    return normalized;
};

const asDecimal = (value: DecimalInput | null | undefined): Decimal =>
    new Decimal(value == null ? 0 : value.toString());

const quantityFromPurchaseItem = (item: PurchaseItemAuthority): string =>
    item.quantityExact !== null
        ? new Decimal(item.quantityExact.toString()).toFixed(4)
        : new Decimal(item.quantity).toFixed(4);

const monetaryExactOrNull = (
    value: Prisma.Decimal | null,
    decimalPlaces: 2 | 4,
): string | null => (value === null ? null : new Decimal(value.toString()).toFixed(decimalPlaces));

const normalizeRequest = (
    input: {
        tenantId: string;
        userId: string;
        supplierId: string;
        fiscalRegimeAtCredit: SupplierCreditFiscalRegime;
        request: SupplierCreditNoteRequest;
    },
) => normalizeSupplierCreditNoteRequest({
    ...input.request,
    tenantId: input.tenantId,
    userId: input.userId,
    supplierId: input.supplierId,
    fiscalRegimeAtCredit: input.fiscalRegimeAtCredit,
    currencyAtIssue: 'NIO',
});

const replayComparableRequest = (request: ReturnType<typeof normalizeSupplierCreditNoteRequest>) => ({
    supplierId: request.supplierId,
    creditNoteNumber: request.creditNoteNumber,
    invoiceDate: request.invoiceDate,
    creditNoteDate: request.creditNoteDate,
    devolutionDate: request.devolutionDate,
    postingDate: request.postingDate,
    fiscalRegimeAtCredit: request.fiscalRegimeAtCredit,
    currencyAtIssue: request.currencyAtIssue,
    reason: request.reason,
    supplierReference: request.supplierReference,
    subtotal: request.subtotal,
    tax: request.tax,
    creditableTax: request.creditableTax,
    total: request.total,
    lines: request.lines,
    applications: request.applications,
});

const replayComparableCommand = (command: CanonicalSupplierCreditNoteCommand) => ({
    supplierId: command.supplierId,
    creditNoteNumber: command.creditNoteNumber,
    invoiceDate: command.invoiceDate,
    creditNoteDate: command.creditNoteDate,
    devolutionDate: command.devolutionDate,
    postingDate: command.postingDate,
    fiscalRegimeAtCredit: command.fiscalRegimeAtCredit,
    currencyAtIssue: command.currencyAtIssue,
    reason: command.reason,
    supplierReference: command.supplierReference,
    subtotal: command.subtotal,
    tax: command.tax,
    creditableTax: command.creditableTax,
    total: command.total,
    lines: command.lines.map((line) => ({
        supplierReturnItemId: line.supplierReturnItemId,
        quantity: line.quantity,
        subtotal: line.subtotal,
        tax: line.tax,
        creditableTax: line.creditableTax,
        total: line.total,
    })),
    applications: command.applications,
});

const serializeStoredResult = (
    stored: SupplierCreditNoteStoredResult,
    replay: boolean,
): SupplierCreditNoteResult => ({
    replay,
    supplierCreditNote: {
        id: stored.response.supplierCreditNoteId,
        supplierId: stored.response.supplierId,
        creditNoteNumber: stored.response.creditNoteNumber,
        status: stored.response.status,
        total: stored.response.total,
        remainingCredit: stored.response.remainingCredit,
    },
    returnItemIds: [...stored.response.returnItemIds],
    applications: stored.response.applications.map((application) => ({
        purchaseId: application.purchaseId,
        amount: application.amount,
    })),
});

const extractTargets = (request: SupplierCreditNoteRequest): RequestedTargets => {
    if (!record(request)) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_INVALID_INPUT',
            400,
            'El payload de la nota debe ser un objeto',
        );
    }
    if (!Array.isArray(request.lines) || request.lines.length < 1 || request.lines.length > 100) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_INVALID_INPUT',
            400,
            'lines debe contener entre 1 y 100 líneas',
        );
    }
    if (!Array.isArray(request.applications) || request.applications.length < 1 || request.applications.length > 100) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_INVALID_INPUT',
            400,
            'applications debe contener entre 1 y 100 aplicaciones',
        );
    }
    const purchaseIds = [...new Set(request.applications.map((application) => {
        if (!record(application)) {
            throw new SupplierCreditNoteError(
                'SUPPLIER_CREDIT_NOTE_INVALID_INPUT',
                400,
                'Cada aplicación debe ser un objeto',
            );
        }
        return canonicalIdentifier(application.purchaseId, 'purchaseId');
    }))].sort((left, right) => left.localeCompare(right));
    const returnItemIds = [...new Set(request.lines.map((line) => {
        if (!record(line)) {
            throw new SupplierCreditNoteError(
                'SUPPLIER_CREDIT_NOTE_INVALID_INPUT',
                400,
                'Cada línea debe ser un objeto',
            );
        }
        return canonicalIdentifier(line.supplierReturnItemId, 'supplierReturnItemId');
    }))].sort((left, right) => left.localeCompare(right));
    return {
        clientEventId: canonicalClientEventId(request.clientEventId),
        purchaseIds,
        returnItemIds,
    };
};

export const buildSupplierCreditNoteResultAuditId = (input: {
    tenantId: string;
    clientEventId: string;
}): string => createHash('sha256').update(JSON.stringify([
    SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION,
    'SUPPLIER_CREDIT_NOTE_RESULT',
    input.tenantId,
    input.clientEventId,
])).digest('hex');

const assertActiveActor = async (
    database: ActorDatabase,
    input: { tenantId: string; userId: string },
): Promise<void> => {
    const actor = await database.user.findFirst({
        where: {
            id: input.userId,
            tenantId: input.tenantId,
            status: 'ACTIVE',
        },
        select: { id: true },
    });
    if (!actor) {
        throw new SupplierCreditNoteServiceError(
            'SUPPLIER_CREDIT_NOTE_ACTOR_FORBIDDEN',
            403,
            'El usuario no está activo en este negocio para postear notas de crédito de proveedor',
        );
    }
};

const findCreditNoteByClientEvent = async (
    database: Pick<PrismaTx, 'supplierCreditNote'> | Pick<Database, 'supplierCreditNote'>,
    tenantId: string,
    clientEventId: string,
): Promise<SupplierCreditNoteRecord | null> => database.supplierCreditNote.findFirst({
    where: { tenantId, clientEventId },
    select: supplierCreditNoteSelect,
}) as Promise<SupplierCreditNoteRecord | null>;

const reconstructCommandFromRecord = (existing: SupplierCreditNoteRecord): CanonicalSupplierCreditNoteCommand => {
    if (
        existing.type !== 'RETURN'
        || existing.status !== SUPPLIER_CREDIT_NOTE_STATUS
        || !SUPPLIER_CREDIT_FISCAL_REGIMES.has(existing.fiscalRegimeAtCredit)
        || existing.currencyAtIssue !== 'NIO'
        || existing.reason === null
        || !existing.reason.trim()
        || !new Decimal(existing.remainingCredit.toString()).isZero()
    ) return incompleteResult();

    const lines: CanonicalSupplierCreditNoteCommand['lines'] = existing.lines.map((line) => {
        const sourceType = line.supplierReturnItem.sourceType;
        if (
            sourceType !== 'DIRECT_PURCHASE_ITEM'
            && sourceType !== 'GOODS_RECEIPT_UNMATCHED'
            && sourceType !== 'PURCHASE_MATCH_ALLOCATION'
        ) return incompleteResult();
        if (line.sourceHash !== line.supplierReturnItem.sourceHash) return incompleteResult();
        const sourcePurchaseId = line.sourcePurchaseItem?.purchaseId
            ?? line.purchaseMatchAllocation?.purchaseItem.purchaseId
            ?? null;
        if (!sourcePurchaseId) return incompleteResult();
        return {
            supplierReturnItemId: line.supplierReturnItemId,
            quantity: new Decimal(line.quantityExact.toString()).toFixed(4),
            subtotal: new Decimal(line.subtotal.toString()).toFixed(2),
            tax: new Decimal(line.tax.toString()).toFixed(2),
            creditableTax: new Decimal(line.creditableTax.toString()).toFixed(2),
            total: new Decimal(line.total.toString()).toFixed(2),
            supplierReturnId: line.supplierReturnItem.supplierReturnId,
            sourcePurchaseId,
            sourcePurchaseItemId: line.sourcePurchaseItemId,
            purchaseMatchAllocationId: line.purchaseMatchAllocationId,
            sourceType,
            goodsReceiptItemId: line.supplierReturnItem.goodsReceiptItemId,
            sourceHash: line.sourceHash,
            bookUnitCostExact: new Decimal(line.bookUnitCostExact.toString()).toFixed(6),
            bookValueExact: new Decimal(line.bookValueExact.toString()).toFixed(4),
            inventoryReversalExact: new Decimal(line.inventoryReversalExact.toString()).toFixed(4),
            priceVarianceReversalExact: new Decimal(line.priceVarianceReversalExact.toString()).toFixed(4),
            descriptionAtCredit: line.descriptionAtCredit,
            unitAtCredit: line.unitAtCredit,
        };
    });
    return {
        version: SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION,
        tenantId: existing.tenantId,
        userId: existing.createdBy,
        supplierId: existing.supplierId,
        clientEventId: existing.clientEventId,
        creditNoteNumber: existing.creditNoteNumber,
        invoiceDate: asIsoDate(existing.invoiceDate),
        creditNoteDate: asIsoDate(existing.creditNoteDate),
        devolutionDate: asIsoDate(existing.devolutionDate),
        postingDate: asIsoDate(existing.postingDate),
        fiscalRegimeAtCredit: existing.fiscalRegimeAtCredit as SupplierCreditFiscalRegime,
        currencyAtIssue: 'NIO',
        reason: existing.reason.trim(),
        supplierReference: existing.supplierReference?.trim() || null,
        subtotal: new Decimal(existing.subtotal.toString()).toFixed(2),
        tax: new Decimal(existing.tax.toString()).toFixed(2),
        creditableTax: new Decimal(existing.creditableTax.toString()).toFixed(2),
        total: new Decimal(existing.total.toString()).toFixed(2),
        type: 'RETURN',
        status: SUPPLIER_CREDIT_NOTE_STATUS,
        inventoryReversalExact: new Decimal(existing.inventoryReversalExact.toString()).toFixed(4),
        priceVarianceReversalExact: new Decimal(existing.priceVarianceReversalExact.toString()).toFixed(4),
        remainingCredit: '0.00',
        lines,
        applications: existing.applications.map((application) => ({
            purchaseId: application.purchaseId,
            amount: new Decimal(application.amount.toString()).toFixed(2),
        })),
    };
};

const loadReplay = async (
    database: ReplayDatabase,
    input: {
        tenantId: string;
        userId: string;
        supplierId: string;
        request: SupplierCreditNoteRequest;
        clientEventId: string;
    },
): Promise<SupplierCreditNoteResult | null> => {
    const existing = await findCreditNoteByClientEvent(database, input.tenantId, input.clientEventId);
    if (!existing) return null;

    const command = reconstructCommandFromRecord(existing);
    const normalizedRequest = normalizeRequest({
        tenantId: input.tenantId,
        userId: input.userId,
        supplierId: input.supplierId,
        fiscalRegimeAtCredit: command.fiscalRegimeAtCredit,
        request: input.request,
    });
    if (
        JSON.stringify(replayComparableRequest(normalizedRequest))
        !== JSON.stringify(replayComparableCommand(command))
    ) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_IDEMPOTENCY_CONFLICT',
            409,
            'clientEventId ya fue usado con otra nota de crédito de proveedor',
        );
    }

    const payloadHash = buildSupplierCreditNotePayloadHash(command);
    assertSupplierCreditNoteReplay(existing, payloadHash);
    const commandId = buildSupplierCreditNoteCommandId(command);
    const resultAudit = await database.auditLog.findFirst({
        where: {
            id: buildSupplierCreditNoteResultAuditId({
                tenantId: input.tenantId,
                clientEventId: input.clientEventId,
            }),
            tenantId: input.tenantId,
        },
        select: {
            action: true,
            details: true,
            userId: true,
        },
    });
    if (
        !resultAudit
        || resultAudit.action !== 'SUPPLIER_CREDIT_NOTE_POSTED'
        || resultAudit.userId !== existing.createdBy
    ) return incompleteResult();

    const stored = parseSupplierCreditNoteStoredResult(resultAudit.details, {
        commandId,
        payloadHash,
        supplierId: command.supplierId,
        total: command.total,
        returnItemIds: command.lines.map((line) => line.supplierReturnItemId),
        applications: command.applications,
    });
    if (
        stored.response.supplierCreditNoteId !== existing.id
        || stored.response.creditNoteNumber !== existing.creditNoteNumber
    ) return incompleteResult();
    return serializeStoredResult(stored, true);
};

const lockSingleTenant = async (tx: PrismaTx, tenantId: string): Promise<void> => {
    const rows = await tx.$queryRaw<LockedTenantRow[]>(Prisma.sql`
        SELECT \`id\`
        FROM \`Tenant\`
        WHERE \`id\` = ${tenantId}
        LIMIT 1
        FOR UPDATE
    `);
    if (rows.length !== 1) {
        throw new SupplierCreditNoteServiceError(
            'SUPPLIER_CREDIT_NOTE_TENANT_NOT_FOUND',
            404,
            'Tenant no encontrado',
        );
    }
};

const lockSingleSupplier = async (
    tx: PrismaTx,
    tenantId: string,
    supplierId: string,
): Promise<void> => {
    const rows = await tx.$queryRaw<LockedSupplierRow[]>(Prisma.sql`
        SELECT \`id\`
        FROM \`Supplier\`
        WHERE \`id\` = ${supplierId}
          AND \`tenantId\` = ${tenantId}
        LIMIT 1
        FOR UPDATE
    `);
    if (rows.length !== 1) {
        throw new SupplierCreditNoteServiceError(
            'SUPPLIER_CREDIT_NOTE_SUPPLIER_NOT_FOUND',
            404,
            'Proveedor no encontrado',
        );
    }
};

const lockPurchases = async (
    tx: PrismaTx,
    tenantId: string,
    purchaseIds: readonly string[],
): Promise<void> => {
    const rows = await tx.$queryRaw<LockedPurchaseRow[]>(Prisma.sql`
        SELECT \`id\`
        FROM \`Purchase\`
        WHERE \`tenantId\` = ${tenantId}
          AND \`id\` IN (${Prisma.join(purchaseIds)})
        ORDER BY \`id\` ASC
        FOR UPDATE
    `);
    if (rows.length !== purchaseIds.length) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED',
            409,
            'No se encontraron todas las compras aplicadas',
        );
    }
};

const lockReturnItems = async (
    tx: PrismaTx,
    tenantId: string,
    returnItemIds: readonly string[],
): Promise<LockedReturnItemRow[]> => tx.$queryRaw<LockedReturnItemRow[]>(Prisma.sql`
    SELECT
        sr.\`id\` AS \`supplierReturnId\`,
        sri.\`id\` AS \`supplierReturnItemId\`
    FROM \`SupplierReturn\` sr
    INNER JOIN \`SupplierReturnItem\` sri
        ON sri.\`supplierReturnId\` = sr.\`id\`
    WHERE sri.\`tenantId\` = ${tenantId}
      AND sri.\`id\` IN (${Prisma.join(returnItemIds)})
    ORDER BY sr.\`id\` ASC, sri.\`id\` ASC
    FOR UPDATE
`);

const lockAllocationsByIds = async (
    tx: PrismaTx,
    tenantId: string,
    allocationIds: readonly string[],
): Promise<void> => {
    if (allocationIds.length === 0) return;
    await tx.$queryRaw<LockedAllocationRow[]>(Prisma.sql`
        SELECT \`id\`, \`goodsReceiptItemId\`
        FROM \`PurchaseMatchAllocation\`
        WHERE \`tenantId\` = ${tenantId}
          AND \`id\` IN (${Prisma.join(allocationIds)})
        ORDER BY \`id\` ASC
        FOR UPDATE
    `);
};

const lockAllocationsByGoodsReceipt = async (
    tx: PrismaTx,
    tenantId: string,
    goodsReceiptItemIds: readonly string[],
): Promise<void> => {
    if (goodsReceiptItemIds.length === 0) return;
    await tx.$queryRaw<LockedAllocationRow[]>(Prisma.sql`
        SELECT \`id\`, \`goodsReceiptItemId\`
        FROM \`PurchaseMatchAllocation\`
        WHERE \`tenantId\` = ${tenantId}
          AND \`goodsReceiptItemId\` IN (${Prisma.join(goodsReceiptItemIds)})
        ORDER BY \`goodsReceiptItemId\` ASC, \`id\` ASC
        FOR UPDATE
    `);
};

const lockExistingCreditsByReturnItems = async (
    tx: PrismaTx,
    tenantId: string,
    returnItemIds: readonly string[],
): Promise<void> => {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT \`id\`
        FROM \`SupplierCreditNoteLine\`
        WHERE \`tenantId\` = ${tenantId}
          AND \`supplierReturnItemId\` IN (${Prisma.join(returnItemIds)})
        ORDER BY \`supplierReturnItemId\` ASC, \`id\` ASC
        FOR UPDATE
    `);
};

const lockExistingCreditsBySourceItems = async (
    tx: PrismaTx,
    tenantId: string,
    sourcePurchaseItemIds: readonly string[],
): Promise<void> => {
    if (sourcePurchaseItemIds.length === 0) return;
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT \`id\`
        FROM \`SupplierCreditNoteLine\`
        WHERE \`tenantId\` = ${tenantId}
          AND \`sourcePurchaseItemId\` IN (${Prisma.join(sourcePurchaseItemIds)})
        ORDER BY \`sourcePurchaseItemId\` ASC, \`id\` ASC
        FOR UPDATE
    `);
};

const deriveFiscalRegimeAtCredit = (
    purchases: readonly LockedPurchaseRecord[],
    expectedCount: number,
    tenantFiscalRegime: string,
): SupplierCreditFiscalRegime => {
    if (purchases.length !== expectedCount) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED',
            409,
            'No se encontraron todas las compras aplicadas',
        );
    }
    if (!SUPPLIER_CREDIT_FISCAL_REGIMES.has(tenantFiscalRegime)) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'El tenant no tiene un régimen fiscal conciliable para la nota',
        );
    }
    const regimes = new Set<string>();
    for (const purchase of purchases) {
        if (!SUPPLIER_CREDIT_FISCAL_REGIMES.has(purchase.fiscalRegimeAtPurchase)) {
            throw new SupplierCreditNoteError(
                'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
                409,
                'La compra no tiene un régimen fiscal conciliable',
            );
        }
        regimes.add(purchase.fiscalRegimeAtPurchase);
    }
    if (regimes.size !== 1) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'Las compras aplicadas pertenecen a más de un régimen fiscal',
        );
    }
    const [purchaseRegime] = [...regimes];
    if (purchaseRegime !== tenantFiscalRegime) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'El régimen fiscal vigente del tenant ya no coincide con la compra original',
        );
    }
    return purchaseRegime as SupplierCreditFiscalRegime;
};

const resolveSourcePurchaseItem = (
    item: SupplierReturnItemRecord,
    resolvedLinksByGoodsReceiptItemId: ReadonlyMap<string, AllocationRecord[]>,
): PurchaseItemAuthority | null => {
    if (item.sourceType === 'DIRECT_PURCHASE_ITEM') return item.purchaseItem;
    if (item.sourceType === 'PURCHASE_MATCH_ALLOCATION') return item.purchaseMatchAllocation?.purchaseItem ?? null;
    if (item.sourceType !== 'GOODS_RECEIPT_UNMATCHED' || !item.goodsReceiptItemId) return null;
    const links = resolvedLinksByGoodsReceiptItemId.get(item.goodsReceiptItemId) ?? [];
    return links.length === 1 ? links[0].purchaseItem : null;
};

const buildReturnItemSnapshots = (
    input: {
        request: ReturnType<typeof normalizeSupplierCreditNoteRequest>;
        items: SupplierReturnItemRecord[];
        creditedBySourcePurchaseItemId: ReadonlyMap<string, {
            quantityExact: string;
            subtotal: string;
            tax: string;
            creditableTax: string;
        }>;
        resolvedLinksByGoodsReceiptItemId: ReadonlyMap<string, AllocationRecord[]>;
    },
) => {
    const itemsById = new Map(input.items.map((item) => [item.id, item]));
    return input.request.lines.map((line) => {
        const item = itemsById.get(line.supplierReturnItemId);
        if (!item) {
            throw new SupplierCreditNoteError(
                'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED',
                409,
                'No se encontraron todas las líneas físicas de la nota',
            );
        }
        const sourcePurchaseItem = resolveSourcePurchaseItem(item, input.resolvedLinksByGoodsReceiptItemId);
        const sourcePurchaseId = item.sourceType === 'DIRECT_PURCHASE_ITEM'
            ? item.purchaseItem?.purchaseId ?? null
            : item.sourceType === 'PURCHASE_MATCH_ALLOCATION'
                ? item.purchaseMatchAllocation?.purchaseItem.purchaseId ?? null
                : null;
        const credited = sourcePurchaseItem
            ? input.creditedBySourcePurchaseItemId.get(sourcePurchaseItem.id)
            : null;
        const resolvedInvoiceLinks = item.sourceType === 'GOODS_RECEIPT_UNMATCHED' && item.goodsReceiptItemId
            ? (input.resolvedLinksByGoodsReceiptItemId.get(item.goodsReceiptItemId) ?? []).map((allocation) => ({
                tenantId: allocation.tenantId,
                supplierId: allocation.purchaseItem.purchase.supplierId,
                goodsReceiptItemId: allocation.goodsReceiptItemId,
                sourcePurchaseId: allocation.purchaseItem.purchaseId,
                sourcePurchaseItemId: allocation.purchaseItem.id,
                purchaseMatchAllocationId: allocation.id,
                quantityExact: new Decimal(allocation.quantityExact.toString()).toFixed(4),
            }))
            : undefined;
        return {
            supplierReturnItemId: item.id,
            supplierReturnId: item.supplierReturnId,
            tenantId: item.tenantId,
            supplierId: item.supplierReturn.supplierId,
            returnStatus: item.supplierReturn.status,
            devolutionDateManagua: managuaDateOnly(item.supplierReturn.returnedAt),
            sourceHash: item.sourceHash,
            sourceType: item.sourceType,
            goodsReceiptItemId: item.goodsReceiptItemId,
            quantityExact: new Decimal(item.quantityExact.toString()).toFixed(4),
            bookUnitCostExact: new Decimal(item.bookUnitCostExact.toString()).toFixed(6),
            bookValueExact: new Decimal(item.bookValueExact.toString()).toFixed(4),
            productNameAtReturn: item.productNameAtReturn,
            unitAtReturn: item.unitAtReturn,
            sourcePurchaseId,
            sourcePurchaseItemId: sourcePurchaseItem?.id ?? null,
            purchaseMatchAllocationId: item.purchaseMatchAllocationId,
            alreadyCredited: item.creditNoteLine !== null,
            originalQtyExact: sourcePurchaseItem ? quantityFromPurchaseItem(sourcePurchaseItem) : null,
            originalSubtotal: sourcePurchaseItem ? new Decimal(sourcePurchaseItem.totalCost.toString()).toFixed(2) : null,
            originalTax: sourcePurchaseItem ? monetaryExactOrNull(sourcePurchaseItem.taxAmountExact, 2) : null,
            originalCreditableTax: sourcePurchaseItem ? monetaryExactOrNull(sourcePurchaseItem.creditableTaxExact, 2) : null,
            creditedQtyExact: sourcePurchaseItem ? credited?.quantityExact ?? '0.0000' : null,
            creditedSubtotal: sourcePurchaseItem ? credited?.subtotal ?? '0.00' : null,
            creditedTax: sourcePurchaseItem ? credited?.tax ?? '0.00' : null,
            creditedCreditableTax: sourcePurchaseItem ? credited?.creditableTax ?? '0.00' : null,
            resolvedInvoiceLinks,
        };
    });
};

const assertPostingPeriodOpen = async (
    tx: PrismaTx,
    tenantId: string,
    postingDate: string,
): Promise<void> => {
    try {
        await assertPeriodOpen(tx, tenantId, normalizeCalendarDateInput(postingDate));
    } catch (error) {
        if (!(error instanceof PeriodLockedError)) throw error;
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            error.message,
        );
    }
};

const buildStoredResult = (
    command: CanonicalSupplierCreditNoteCommand,
    createdCreditNoteId: string,
): SupplierCreditNoteStoredResult => ({
    version: SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION,
    commandType: SUPPLIER_CREDIT_NOTE_COMMAND_TYPE,
    commandId: buildSupplierCreditNoteCommandId(command),
    payloadHash: buildSupplierCreditNotePayloadHash(command),
    response: {
        supplierCreditNoteId: createdCreditNoteId,
        creditNoteNumber: command.creditNoteNumber,
        supplierId: command.supplierId,
        status: SUPPLIER_CREDIT_NOTE_STATUS,
        total: command.total,
        remainingCredit: '0.00',
        returnItemIds: command.lines.map((line) => line.supplierReturnItemId),
        applications: command.applications,
    },
});

/**
 * Postea una nota de crédito de proveedor dentro de la misma transacción que
 * actualiza CxP, asiento y auditoría. No calcula nada en el router.
 */
export async function executeSupplierCreditNote({
    tx,
    tenantId,
    userId,
    supplierId,
    request,
    now = new Date(),
}: ExecuteSupplierCreditNoteInput): Promise<SupplierCreditNoteResult> {
    const scopedTenantId = tenantId.trim();
    const scopedUserId = userId.trim();
    const scopedSupplierId = supplierId.trim();
    if (!scopedTenantId || !scopedUserId || !scopedSupplierId) {
        invalidContext('tenantId, userId y supplierId son obligatorios');
    }
    if (Number.isNaN(now.getTime())) invalidContext('La fecha actual no es válida');

    const targets = extractTargets(request);

    await assertActiveActor(tx, {
        tenantId: scopedTenantId,
        userId: scopedUserId,
    });
    await lockSingleTenant(tx, scopedTenantId);
    await lockSingleSupplier(tx, scopedTenantId, scopedSupplierId);

    const replayBeforeLocks = await loadReplay(tx, {
        tenantId: scopedTenantId,
        userId: scopedUserId,
        supplierId: scopedSupplierId,
        request,
        clientEventId: targets.clientEventId,
    });
    if (replayBeforeLocks) return replayBeforeLocks;

    await lockPurchases(tx, scopedTenantId, targets.purchaseIds);
    const purchases = await tx.purchase.findMany({
        where: {
            tenantId: scopedTenantId,
            id: { in: targets.purchaseIds },
        },
        select: purchaseSelect,
    }) as LockedPurchaseRecord[];
    const tenant = await tx.tenant.findFirst({
        where: { id: scopedTenantId },
        select: { fiscalRegime: true },
    });
    if (!tenant) {
        throw new SupplierCreditNoteServiceError(
            'SUPPLIER_CREDIT_NOTE_TENANT_NOT_FOUND',
            404,
            'Tenant no encontrado',
        );
    }
    const fiscalRegimeAtCredit = deriveFiscalRegimeAtCredit(
        purchases,
        targets.purchaseIds.length,
        tenant.fiscalRegime,
    );
    const normalizedRequest = normalizeRequest({
        tenantId: scopedTenantId,
        userId: scopedUserId,
        supplierId: scopedSupplierId,
        fiscalRegimeAtCredit,
        request,
    });

    const replayAfterPurchaseLock = await loadReplay(tx, {
        tenantId: scopedTenantId,
        userId: scopedUserId,
        supplierId: scopedSupplierId,
        request,
        clientEventId: normalizedRequest.clientEventId,
    });
    if (replayAfterPurchaseLock) return replayAfterPurchaseLock;

    const lockedReturnItems = await lockReturnItems(tx, scopedTenantId, normalizedRequest.lines.map((line) => line.supplierReturnItemId));
    if (lockedReturnItems.length !== normalizedRequest.lines.length) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED',
            409,
            'No se encontraron todas las líneas físicas de la nota',
        );
    }
    const returnItems = await tx.supplierReturnItem.findMany({
        where: {
            tenantId: scopedTenantId,
            id: { in: normalizedRequest.lines.map((line) => line.supplierReturnItemId) },
        },
        select: supplierReturnItemSelect,
    }) as SupplierReturnItemRecord[];

    const directAllocationIds = [...new Set(returnItems
        .map((item) => item.purchaseMatchAllocationId)
        .filter((value): value is string => value !== null))].sort((left, right) => left.localeCompare(right));
    const unmatchedGoodsReceiptItemIds = [...new Set(returnItems
        .filter((item) => item.sourceType === 'GOODS_RECEIPT_UNMATCHED' && item.goodsReceiptItemId)
        .map((item) => item.goodsReceiptItemId as string))].sort((left, right) => left.localeCompare(right));
    await lockAllocationsByIds(tx, scopedTenantId, directAllocationIds);
    await lockAllocationsByGoodsReceipt(tx, scopedTenantId, unmatchedGoodsReceiptItemIds);
    const unresolvedAllocationLinks = unmatchedGoodsReceiptItemIds.length === 0
        ? []
        : await tx.purchaseMatchAllocation.findMany({
            where: {
                tenantId: scopedTenantId,
                goodsReceiptItemId: { in: unmatchedGoodsReceiptItemIds },
            },
            select: allocationSelect,
        }) as AllocationRecord[];
    const resolvedLinksByGoodsReceiptItemId = new Map<string, AllocationRecord[]>();
    for (const link of unresolvedAllocationLinks) {
        if (!link.goodsReceiptItemId) continue;
        const current = resolvedLinksByGoodsReceiptItemId.get(link.goodsReceiptItemId) ?? [];
        current.push(link);
        resolvedLinksByGoodsReceiptItemId.set(link.goodsReceiptItemId, current);
    }

    const sourcePurchaseItemIds = [...new Set([
        ...returnItems
            .map((item) => item.purchaseItem?.id ?? item.purchaseMatchAllocation?.purchaseItem.id ?? null)
            .filter((value): value is string => value !== null),
        ...unresolvedAllocationLinks.map((link) => link.purchaseItem.id),
    ])].sort((left, right) => left.localeCompare(right));
    await lockExistingCreditsByReturnItems(
        tx,
        scopedTenantId,
        normalizedRequest.lines.map((line) => line.supplierReturnItemId),
    );
    await lockExistingCreditsBySourceItems(tx, scopedTenantId, sourcePurchaseItemIds);
    const creditedBySourcePurchaseItemId = new Map<string, {
        quantityExact: string;
        subtotal: string;
        tax: string;
        creditableTax: string;
    }>();
    if (sourcePurchaseItemIds.length > 0) {
        const priorLines = await tx.supplierCreditNoteLine.findMany({
            where: {
                tenantId: scopedTenantId,
                sourcePurchaseItemId: { in: sourcePurchaseItemIds },
            },
            select: {
                sourcePurchaseItemId: true,
                quantityExact: true,
                subtotal: true,
                tax: true,
                creditableTax: true,
            },
        });
        for (const priorLine of priorLines) {
            if (!priorLine.sourcePurchaseItemId) continue;
            const current = creditedBySourcePurchaseItemId.get(priorLine.sourcePurchaseItemId) ?? {
                quantityExact: '0.0000',
                subtotal: '0.00',
                tax: '0.00',
                creditableTax: '0.00',
            };
            creditedBySourcePurchaseItemId.set(priorLine.sourcePurchaseItemId, {
                quantityExact: new Decimal(current.quantityExact).plus(priorLine.quantityExact.toString()).toFixed(4),
                subtotal: new Decimal(current.subtotal).plus(priorLine.subtotal.toString()).toFixed(2),
                tax: new Decimal(current.tax).plus(priorLine.tax.toString()).toFixed(2),
                creditableTax: new Decimal(current.creditableTax).plus(priorLine.creditableTax.toString()).toFixed(2),
            });
        }
    }

    const retentionRows = await tx.fiscalRetention.findMany({
        where: {
            tenantId: scopedTenantId,
            purchaseId: { in: normalizedRequest.applications.map((application) => application.purchaseId) },
        },
        select: { purchaseId: true },
    });
    const retentionPurchaseIds = new Set(retentionRows
        .map((row) => row.purchaseId)
        .filter((value): value is string => value !== null));
    await assertPostingPeriodOpen(tx, scopedTenantId, normalizedRequest.postingDate);
    const plan = planSupplierCreditNotePosting({
        request: normalizedRequest,
        returnItems: buildReturnItemSnapshots({
            request: normalizedRequest,
            items: returnItems,
            creditedBySourcePurchaseItemId,
            resolvedLinksByGoodsReceiptItemId,
        }),
        purchases: purchases.map((purchase) => ({
            purchaseId: purchase.id,
            tenantId: purchase.tenantId,
            supplierId: purchase.supplierId,
            paymentMethod: purchase.paymentMethod,
            documentStatus: purchase.documentStatus,
            invoiceDateManagua: asIsoDate(purchase.date),
            fiscalRegimeAtPurchase: purchase.fiscalRegimeAtPurchase,
            balanceDue: purchase.balanceDue?.toFixed(4) ?? null,
            retentionAdjustmentRequired: retentionPurchaseIds.has(purchase.id) ? true : false,
        })),
        fiscalPeriodOpen: true,
        // La revisión manual solo es necesaria cuando alguna compra aplicada
        // tiene retenciones. El booleano estaba invertido: rechazaba todas las
        // notas SIN retenciones y dejaba el caso riesgoso depender únicamente
        // del guard por compra.
        retentionAdjustmentRequired: retentionPurchaseIds.size > 0,
        fiscalRegimeAtPosting: fiscalRegimeAtCredit,
    });

    const payloadHash = buildSupplierCreditNotePayloadHash(plan.command);
    let createdCreditNote: Awaited<ReturnType<PrismaTx['supplierCreditNote']['create']>>;
    try {
        createdCreditNote = await tx.supplierCreditNote.create({
            data: {
                tenantId: scopedTenantId,
                supplierId: scopedSupplierId,
                creditNoteNumber: plan.command.creditNoteNumber,
                type: plan.command.type,
                status: plan.command.status,
                invoiceDate: normalizeCalendarDateInput(plan.command.invoiceDate),
                creditNoteDate: normalizeCalendarDateInput(plan.command.creditNoteDate),
                devolutionDate: normalizeCalendarDateInput(plan.command.devolutionDate),
                postingDate: normalizeCalendarDateInput(plan.command.postingDate),
                fiscalRegimeAtCredit: plan.command.fiscalRegimeAtCredit,
                currencyAtIssue: plan.command.currencyAtIssue,
                subtotal: plan.command.subtotal,
                tax: plan.command.tax,
                creditableTax: plan.command.creditableTax,
                total: plan.command.total,
                inventoryReversalExact: plan.command.inventoryReversalExact,
                priceVarianceReversalExact: plan.command.priceVarianceReversalExact,
                remainingCredit: plan.command.remainingCredit,
                reason: plan.command.reason,
                supplierReference: plan.command.supplierReference,
                clientEventId: plan.command.clientEventId,
                payloadVersion: plan.command.version,
                payloadHash,
                createdBy: scopedUserId,
            },
        });
    } catch (error) {
        if (!isPrismaCode(error, 'P2002')) throw error;
        const replay = await loadReplay(tx, {
            tenantId: scopedTenantId,
            userId: scopedUserId,
            supplierId: scopedSupplierId,
            request,
            clientEventId: normalizedRequest.clientEventId,
        });
        if (replay) return replay;
        throw error;
    }

    const createdLineCount = await tx.supplierCreditNoteLine.createMany({
        data: plan.command.lines.map((line) => ({
            tenantId: scopedTenantId,
            creditNoteId: createdCreditNote.id,
            supplierReturnItemId: line.supplierReturnItemId,
            sourcePurchaseItemId: line.sourcePurchaseItemId,
            purchaseMatchAllocationId: line.purchaseMatchAllocationId,
            sourceHash: line.sourceHash,
            quantityExact: line.quantity,
            bookUnitCostExact: line.bookUnitCostExact,
            bookValueExact: line.bookValueExact,
            subtotal: line.subtotal,
            tax: line.tax,
            creditableTax: line.creditableTax,
            total: line.total,
            inventoryReversalExact: line.inventoryReversalExact,
            priceVarianceReversalExact: line.priceVarianceReversalExact,
            descriptionAtCredit: line.descriptionAtCredit,
            unitAtCredit: line.unitAtCredit,
        })),
    });
    if (createdLineCount.count !== plan.command.lines.length) {
        throw new SupplierCreditNoteServiceError(
            'SUPPLIER_CREDIT_NOTE_CONCURRENT_WRITE',
            409,
            'No se pudieron persistir todas las líneas de la nota de crédito',
        );
    }

    const createdApplicationCount = await tx.supplierCreditApplication.createMany({
        data: plan.applications.map((application) => ({
            tenantId: scopedTenantId,
            supplierId: scopedSupplierId,
            creditNoteId: createdCreditNote.id,
            purchaseId: application.purchaseId,
            amount: application.amount,
            createdBy: scopedUserId,
            appliedAt: now,
        })),
    });
    if (createdApplicationCount.count !== plan.applications.length) {
        throw new SupplierCreditNoteServiceError(
            'SUPPLIER_CREDIT_NOTE_CONCURRENT_WRITE',
            409,
            'No se pudieron persistir todas las aplicaciones de la nota de crédito',
        );
    }

    await recordSupplierCreditNote(
        tx,
        scopedTenantId,
        scopedUserId,
        createdCreditNote.id,
        plan.journalLines,
        normalizeCalendarDateInput(plan.command.postingDate),
    );

    const purchasesById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
    const purchaseAudit: Array<{
        purchaseId: string;
        balanceApplied: string;
        before: {
            status: string;
            balanceDue: string | null;
            paidAt: string | null;
            settledAt: string | null;
        };
        after: {
            status: string;
            balanceDue: string;
            paidAt: string | null;
            settledAt: string | null;
        };
    }> = [];
    for (const application of plan.applications) {
        const purchase = purchasesById.get(application.purchaseId);
        if (!purchase) {
            throw new SupplierCreditNoteError(
                'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED',
                409,
                'No se encontró una compra aplicada',
            );
        }
        const nextStatus = application.settled ? 'COMPLETED' : 'PARTIALLY_PAID';
        const update = await tx.purchase.updateMany({
            where: {
                id: purchase.id,
                tenantId: scopedTenantId,
            },
            data: {
                balanceDue: new Decimal(application.balanceAfter),
                status: nextStatus,
                settledAt: application.settled ? now : null,
            },
        });
        if (update.count !== 1) {
            throw new SupplierCreditNoteServiceError(
                'SUPPLIER_CREDIT_NOTE_CONCURRENT_WRITE',
                409,
                'No se pudo actualizar el saldo bloqueado de una compra aplicada',
            );
        }
        purchaseAudit.push({
            purchaseId: purchase.id,
            balanceApplied: application.amount,
            before: {
                status: purchase.status,
                balanceDue: purchase.balanceDue?.toFixed(4) ?? null,
                paidAt: purchase.paidAt?.toISOString() ?? null,
                settledAt: purchase.settledAt?.toISOString() ?? null,
            },
            after: {
                status: nextStatus,
                balanceDue: application.balanceAfter,
                paidAt: purchase.paidAt?.toISOString() ?? null,
                settledAt: application.settled ? now.toISOString() : null,
            },
        });
    }

    const stored = buildStoredResult(plan.command, createdCreditNote.id);
    await tx.auditLog.create({
        data: {
            id: buildSupplierCreditNoteResultAuditId({
                tenantId: scopedTenantId,
                clientEventId: plan.command.clientEventId,
            }),
            tenantId: scopedTenantId,
            userId: scopedUserId,
            action: 'SUPPLIER_CREDIT_NOTE_POSTED',
            details: JSON.stringify({
                ...stored,
                creditNote: {
                    inventoryReversalExact: plan.command.inventoryReversalExact,
                    priceVarianceReversalExact: plan.command.priceVarianceReversalExact,
                    postingDate: plan.command.postingDate,
                    devolutionDate: plan.command.devolutionDate,
                    invoiceDate: plan.command.invoiceDate,
                    fiscalRegimeAtCredit: plan.command.fiscalRegimeAtCredit,
                    currencyAtIssue: plan.command.currencyAtIssue,
                },
                purchases: purchaseAudit,
            }),
        },
    });

    return serializeStoredResult(stored, false);
}

/**
 * Wrapper recomendado para HTTP. Si un commit concurrente gana el clientEventId,
 * la relectura final ocurre fuera del rollback con snapshot fresco.
 */
export async function executeSupplierCreditNoteTransaction({
    db = prisma,
    tenantId,
    userId,
    supplierId,
    request,
    now,
}: ExecuteSupplierCreditNoteTransactionInput): Promise<SupplierCreditNoteResult> {
    const scopedTenantId = tenantId.trim();
    const scopedUserId = userId.trim();
    const scopedSupplierId = supplierId.trim();
    const { clientEventId } = extractTargets(request);
    await assertActiveActor(db, {
        tenantId: scopedTenantId,
        userId: scopedUserId,
    });
    try {
        return await db.$transaction(
            (tx) => executeSupplierCreditNote({
                tx,
                tenantId: scopedTenantId,
                userId: scopedUserId,
                supplierId: scopedSupplierId,
                request,
                now,
            }),
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
    } catch (error) {
        const concurrentBusinessError = error instanceof SupplierCreditNoteError
            && [
                'SUPPLIER_CREDIT_NOTE_RETURN_ITEM_ALREADY_CREDITED',
                'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED',
                'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED',
            ].includes(error.code);
        if (!isPrismaCode(error, 'P2002') && !concurrentBusinessError) throw error;
        const replay = await loadReplay(db, {
            tenantId: scopedTenantId,
            userId: scopedUserId,
            supplierId: scopedSupplierId,
            request,
            clientEventId,
        });
        if (!replay) throw error;
        return replay;
    }
}
