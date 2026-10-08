import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

export const SUPPLIER_CREDIT_NOTE_COMMAND_TYPE = 'SUPPLIER_CREDIT_NOTE_POST' as const;
export const SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION = 1 as const;
export const SUPPLIER_CREDIT_NOTE_TYPE = 'RETURN' as const;
export const SUPPLIER_CREDIT_NOTE_STATUS = 'POSTED' as const;
export const SUPPLIER_CREDIT_FISCAL_REGIMES = ['GENERAL', 'CUOTA_FIJA'] as const;

export type SupplierCreditFiscalRegime = typeof SUPPLIER_CREDIT_FISCAL_REGIMES[number];

export type SupplierCreditNoteErrorCode =
    | 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT'
    | 'SUPPLIER_CREDIT_NOTE_RETURN_NOT_POSTED'
    | 'SUPPLIER_CREDIT_NOTE_RETURN_ITEM_ALREADY_CREDITED'
    | 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'
    | 'SUPPLIER_CREDIT_NOTE_PURCHASE_INELIGIBLE'
    | 'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED'
    | 'SUPPLIER_CREDIT_NOTE_IDEMPOTENCY_CONFLICT'
    | 'SUPPLIER_CREDIT_NOTE_RESULT_INCOMPLETE'
    | 'MULTIPLE_SOURCE_INVOICE_DATES'
    | 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED';

export class SupplierCreditNoteError extends Error {
    constructor(
        readonly code: SupplierCreditNoteErrorCode,
        readonly httpStatus: 400 | 409 | 500,
        message: string,
    ) {
        super(message);
        this.name = 'SupplierCreditNoteError';
    }
}

const invalidInput = (message: string): never => {
    throw new SupplierCreditNoteError('SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400, message);
};

const reconciliationRequired = (message: string): never => {
    throw new SupplierCreditNoteError(
        'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED',
        409,
        message,
    );
};

const identifier = (value: unknown, field: string): string => {
    if (typeof value !== 'string') return invalidInput(`${field} debe ser texto`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return invalidInput(`${field} no es válido`);
    }
    return normalized;
};

const storedIdentifier = (value: unknown): string => {
    if (typeof value !== 'string') return reconciliationRequired('La evidencia de la nota está incompleta');
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || normalized !== value
        || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return reconciliationRequired('La evidencia de la nota está incompleta');
    }
    return normalized;
};

const optionalStoredIdentifier = (value: unknown): string | null => {
    if (value == null) return null;
    return storedIdentifier(value);
};

const optionalText = (value: unknown, field: string, maxLength: number): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string') return invalidInput(`${field} debe ser texto`);
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        return invalidInput(`${field} no es válido`);
    }
    return normalized;
};

const uuid = (value: unknown): string => {
    const normalized = identifier(value, 'clientEventId').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
        return invalidInput('clientEventId debe ser UUID');
    }
    return normalized;
};

const sha256 = (value: unknown): string => createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');

const sha256Value = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

const MAX_JOURNAL_AMOUNT = new Decimal('999999999999.99');
const MAX_DECIMAL_18_4 = new Decimal('99999999999999.9999');

const derivedSignedDecimal18 = (value: Decimal, message: string): string => {
    if (value.abs().greaterThan(MAX_DECIMAL_18_4)) return reconciliationRequired(message);
    return value.toFixed(4);
};

const money = (value: unknown, field: string, positive = false): string => {
    if (typeof value !== 'string') return invalidInput(`${field} debe enviarse como texto decimal exacto`);
    const source = value.trim();
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(source)) {
        return invalidInput(`${field} debe caber en Decimal(18,4) y tener máximo dos decimales`);
    }
    const parsed = new Decimal(source);
    if (positive && !parsed.greaterThan(0)) return invalidInput(`${field} debe ser mayor que cero`);
    return parsed.toFixed(2);
};

const quantity = (value: unknown, field = 'quantity'): string => {
    if (typeof value !== 'string') return invalidInput(`${field} debe enviarse como texto decimal exacto`);
    const source = value.trim();
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u.test(source)) {
        return invalidInput(`${field} debe caber en Decimal(18,4)`);
    }
    const parsed = new Decimal(source);
    if (!parsed.greaterThan(0)) return invalidInput(`${field} debe ser mayor que cero`);
    return parsed.toFixed(4);
};

const evidenceDecimal = (value: unknown, places: 2 | 4 | 6, field: string): string => {
    if (typeof value === 'number' || typeof value === 'bigint' || value == null) {
        return reconciliationRequired(`La evidencia ${field} no es exacta`);
    }
    let parsed: Decimal;
    try {
        parsed = new Decimal(typeof value === 'string' ? value.trim() : String(value));
    } catch {
        return reconciliationRequired(`La evidencia ${field} no es exacta`);
    }
    const max = places === 6 ? '999999999999.999999' : '99999999999999.9999';
    if (!parsed.isFinite() || parsed.isNegative() || parsed.decimalPlaces() > places || parsed.greaterThan(max)) {
        return reconciliationRequired(`La evidencia ${field} no es exacta`);
    }
    return parsed.toFixed(places);
};

const dateOnly = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        return invalidInput(`${field} debe usar YYYY-MM-DD`);
    }
    const parsed = new Date(`${value}T12:00:00.000Z`);
    if (value < '1000-01-01' || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        return invalidInput(`${field} no es una fecha civil válida`);
    }
    return value;
};

const storedDateOnly = (value: unknown): string => {
    try {
        return dateOnly(value, 'storedDate');
    } catch {
        return reconciliationRequired('La evidencia de fechas está incompleta');
    }
};

const record = (value: unknown): value is Record<string, unknown> =>
    Object(value) === value && !Array.isArray(value);

export interface SupplierCreditNoteCommandInput {
    tenantId: unknown;
    userId: unknown;
    supplierId: unknown;
    clientEventId: unknown;
    creditNoteNumber: unknown;
    invoiceDate: unknown;
    creditNoteDate: unknown;
    devolutionDate: unknown;
    postingDate: unknown;
    fiscalRegimeAtCredit: unknown;
    currencyAtIssue: unknown;
    reason: unknown;
    supplierReference?: unknown;
    subtotal: unknown;
    tax: unknown;
    creditableTax: unknown;
    total: unknown;
    lines: unknown;
    applications: unknown;
}

export interface CanonicalSupplierCreditNoteRequestLine {
    supplierReturnItemId: string;
    quantity: string;
    subtotal: string;
    tax: string;
    creditableTax: string;
    total: string;
}

export interface CanonicalSupplierCreditApplicationRequest {
    purchaseId: string;
    amount: string;
}

export interface CanonicalSupplierCreditNoteRequest {
    version: 1;
    tenantId: string;
    userId: string;
    supplierId: string;
    clientEventId: string;
    creditNoteNumber: string;
    invoiceDate: string;
    creditNoteDate: string;
    devolutionDate: string;
    postingDate: string;
    fiscalRegimeAtCredit: SupplierCreditFiscalRegime;
    currencyAtIssue: 'NIO';
    reason: string;
    supplierReference: string | null;
    subtotal: string;
    tax: string;
    creditableTax: string;
    total: string;
    lines: CanonicalSupplierCreditNoteRequestLine[];
    applications: CanonicalSupplierCreditApplicationRequest[];
}

const fiscalRegimeSet: ReadonlySet<unknown> = new Set(SUPPLIER_CREDIT_FISCAL_REGIMES);

export function normalizeSupplierCreditNoteRequest(
    input: SupplierCreditNoteCommandInput,
): CanonicalSupplierCreditNoteRequest {
    const fiscalRegimeAtCredit = fiscalRegimeSet.has(input.fiscalRegimeAtCredit)
        ? input.fiscalRegimeAtCredit as SupplierCreditFiscalRegime
        : invalidInput('fiscalRegimeAtCredit no es válido');
    if (input.currencyAtIssue !== 'NIO') return invalidInput('La nota v1 solo admite moneda NIO');
    if (typeof input.reason !== 'string') return invalidInput('reason debe ser texto');
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 1_000 || /[\u0000-\u001f\u007f]/u.test(reason)) {
        return invalidInput('reason debe tener entre 3 y 1000 caracteres');
    }
    if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
        return invalidInput('lines debe contener entre 1 y 100 líneas');
    }
    const lines = input.lines.map((raw): CanonicalSupplierCreditNoteRequestLine => {
        if (!record(raw)) return invalidInput('Cada línea debe ser un objeto');
        const subtotal = money(raw.subtotal, 'line.subtotal');
        const tax = money(raw.tax, 'line.tax');
        const creditableTax = money(raw.creditableTax, 'line.creditableTax');
        const total = money(raw.total, 'line.total');
        if (!new Decimal(subtotal).plus(tax).equals(total) || new Decimal(creditableTax).greaterThan(tax)) {
            return invalidInput('Los importes de una línea no concilian');
        }
        return {
            supplierReturnItemId: identifier(raw.supplierReturnItemId, 'supplierReturnItemId'),
            quantity: quantity(raw.quantity),
            subtotal,
            tax,
            creditableTax,
            total,
        };
    }).sort((left, right) => left.supplierReturnItemId.localeCompare(right.supplierReturnItemId));
    for (let index = 1; index < lines.length; index += 1) {
        if (lines[index - 1].supplierReturnItemId === lines[index].supplierReturnItemId) {
            return invalidInput('No se puede repetir una línea de devolución');
        }
    }

    if (!Array.isArray(input.applications) || input.applications.length < 1 || input.applications.length > 100) {
        return invalidInput('applications debe contener entre 1 y 100 aplicaciones');
    }
    const applications = input.applications.map((raw): CanonicalSupplierCreditApplicationRequest => {
        if (!record(raw)) return invalidInput('Cada aplicación debe ser un objeto');
        return {
            purchaseId: identifier(raw.purchaseId, 'purchaseId'),
            amount: money(raw.amount, 'application.amount', true),
        };
    }).sort((left, right) => left.purchaseId.localeCompare(right.purchaseId));
    for (let index = 1; index < applications.length; index += 1) {
        if (applications[index - 1].purchaseId === applications[index].purchaseId) {
            return invalidInput('No se puede repetir una compra en las aplicaciones');
        }
    }

    const subtotal = money(input.subtotal, 'subtotal');
    const tax = money(input.tax, 'tax');
    const creditableTax = money(input.creditableTax, 'creditableTax');
    const total = money(input.total, 'total', true);
    const lineSubtotal = lines.reduce((sum, line) => sum.plus(line.subtotal), new Decimal(0));
    const lineTax = lines.reduce((sum, line) => sum.plus(line.tax), new Decimal(0));
    const lineCreditableTax = lines.reduce((sum, line) => sum.plus(line.creditableTax), new Decimal(0));
    const lineTotal = lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
    if (
        !new Decimal(subtotal).equals(lineSubtotal)
        || !new Decimal(tax).equals(lineTax)
        || !new Decimal(creditableTax).equals(lineCreditableTax)
        || !new Decimal(total).equals(lineTotal)
        || !new Decimal(subtotal).plus(tax).equals(total)
        || new Decimal(creditableTax).greaterThan(tax)
    ) return invalidInput('Los totales de la nota no concilian exactamente con sus líneas');
    if (fiscalRegimeAtCredit === 'CUOTA_FIJA' && !new Decimal(creditableTax).isZero()) {
        return invalidInput('CUOTA_FIJA no admite reversión automática de IVA acreditable');
    }
    const applicationTotal = applications.reduce((sum, application) => sum.plus(application.amount), new Decimal(0));
    if (!applicationTotal.equals(total)) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED',
            409,
            'Las aplicaciones deben sumar exactamente el total de la nota',
        );
    }

    const invoiceDate = dateOnly(input.invoiceDate, 'invoiceDate');
    const creditNoteDate = dateOnly(input.creditNoteDate, 'creditNoteDate');
    const devolutionDate = dateOnly(input.devolutionDate, 'devolutionDate');
    const postingDate = dateOnly(input.postingDate, 'postingDate');
    if (creditNoteDate < invoiceDate || creditNoteDate < devolutionDate || postingDate < creditNoteDate) {
        return invalidInput('La secuencia de fechas de la nota no es válida');
    }
    if (
        creditNoteDate.slice(0, 7) !== devolutionDate.slice(0, 7)
        || postingDate.slice(0, 7) !== devolutionDate.slice(0, 7)
    ) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'La nota, devolución y contabilización deben pertenecer al mismo período fiscal',
        );
    }

    return {
        version: SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION,
        tenantId: identifier(input.tenantId, 'tenantId'),
        userId: identifier(input.userId, 'userId'),
        supplierId: identifier(input.supplierId, 'supplierId'),
        clientEventId: uuid(input.clientEventId),
        creditNoteNumber: identifier(input.creditNoteNumber, 'creditNoteNumber'),
        invoiceDate,
        creditNoteDate,
        devolutionDate,
        postingDate,
        fiscalRegimeAtCredit,
        currencyAtIssue: 'NIO',
        reason,
        supplierReference: optionalText(input.supplierReference, 'supplierReference', 191),
        subtotal,
        tax,
        creditableTax,
        total,
        lines,
        applications,
    };
}

export interface SupplierCreditReturnItemSnapshot {
    supplierReturnItemId: unknown;
    supplierReturnId: unknown;
    tenantId: unknown;
    supplierId: unknown;
    returnStatus: unknown;
    devolutionDateManagua: unknown;
    sourceHash: unknown;
    sourceType: unknown;
    goodsReceiptItemId: unknown;
    quantityExact: unknown;
    bookUnitCostExact: unknown;
    bookValueExact: unknown;
    productNameAtReturn: unknown;
    unitAtReturn: unknown;
    sourcePurchaseId: unknown;
    sourcePurchaseItemId: unknown;
    purchaseMatchAllocationId: unknown;
    alreadyCredited: unknown;
    originalQtyExact: unknown;
    originalSubtotal: unknown;
    originalTax: unknown;
    originalCreditableTax: unknown;
    creditedQtyExact: unknown;
    creditedSubtotal: unknown;
    creditedTax: unknown;
    creditedCreditableTax: unknown;
    resolvedInvoiceLinks?: unknown;
}

export interface SupplierCreditResolvedInvoiceLink {
    tenantId: unknown;
    supplierId: unknown;
    goodsReceiptItemId: unknown;
    sourcePurchaseId: unknown;
    sourcePurchaseItemId: unknown;
    purchaseMatchAllocationId: unknown;
    quantityExact: unknown;
}

export interface SupplierCreditPurchaseSnapshot {
    purchaseId: unknown;
    tenantId: unknown;
    supplierId: unknown;
    paymentMethod: unknown;
    documentStatus: unknown;
    invoiceDateManagua: unknown;
    fiscalRegimeAtPurchase: unknown;
    balanceDue: unknown;
    retentionAdjustmentRequired?: unknown;
}

export interface SupplierCreditNoteCanonicalLine extends CanonicalSupplierCreditNoteRequestLine {
    supplierReturnId: string;
    sourcePurchaseId: string;
    sourcePurchaseItemId: string | null;
    purchaseMatchAllocationId: string | null;
    sourceType: 'DIRECT_PURCHASE_ITEM' | 'GOODS_RECEIPT_UNMATCHED' | 'PURCHASE_MATCH_ALLOCATION';
    goodsReceiptItemId: string | null;
    sourceHash: string;
    bookUnitCostExact: string;
    bookValueExact: string;
    inventoryReversalExact: string;
    priceVarianceReversalExact: string;
    descriptionAtCredit: string;
    unitAtCredit: string;
}

export interface SupplierCreditApplicationPlan extends CanonicalSupplierCreditApplicationRequest {
    balanceBefore: string;
    balanceAfter: string;
    settled: boolean;
}

export interface SupplierCreditJournalLine {
    accountCode: '1.1.4' | '1.1.5' | '2.1.1' | '5.1.3';
    debit: string;
    credit: string;
}

export interface CanonicalSupplierCreditNoteCommand extends Omit<CanonicalSupplierCreditNoteRequest, 'lines' | 'applications'> {
    type: typeof SUPPLIER_CREDIT_NOTE_TYPE;
    status: typeof SUPPLIER_CREDIT_NOTE_STATUS;
    inventoryReversalExact: string;
    priceVarianceReversalExact: string;
    remainingCredit: '0.00';
    lines: SupplierCreditNoteCanonicalLine[];
    applications: CanonicalSupplierCreditApplicationRequest[];
}

export interface SupplierCreditNotePostingPlan {
    command: CanonicalSupplierCreditNoteCommand;
    applications: SupplierCreditApplicationPlan[];
    journalLines: SupplierCreditJournalLine[];
}

const assertPurchaseEligible = (
    purchase: SupplierCreditPurchaseSnapshot,
    request: CanonicalSupplierCreditNoteRequest,
): { purchaseId: string; invoiceDate: string; fiscalRegime: SupplierCreditFiscalRegime; balanceDue: string } => {
    const purchaseId = storedIdentifier(purchase.purchaseId);
    if (storedIdentifier(purchase.tenantId) !== request.tenantId
        || storedIdentifier(purchase.supplierId) !== request.supplierId) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_PURCHASE_INELIGIBLE',
            409,
            'La compra no pertenece al proveedor de la nota',
        );
    }
    if (purchase.paymentMethod !== 'CREDIT' || purchase.documentStatus !== 'POSTED' || purchase.balanceDue == null) {
        throw new SupplierCreditNoteError(
            'SUPPLIER_CREDIT_NOTE_PURCHASE_INELIGIBLE',
            409,
            'La nota solo puede aplicarse a compras CREDIT y POSTED con saldo materializado',
        );
    }
    if (purchase.retentionAdjustmentRequired !== false) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'La compra requiere revisión manual de retenciones antes de acreditar',
        );
    }
    if (!fiscalRegimeSet.has(purchase.fiscalRegimeAtPurchase)) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'La compra no tiene un régimen fiscal conciliable',
        );
    }
    return {
        purchaseId,
        invoiceDate: storedDateOnly(purchase.invoiceDateManagua),
        fiscalRegime: purchase.fiscalRegimeAtPurchase as SupplierCreditFiscalRegime,
        balanceDue: evidenceDecimal(purchase.balanceDue, 4, 'balanceDue'),
    };
};

interface PurchaseItemCreditCeiling {
    originalQuantity: string;
    originalSubtotal: string;
    originalTax: string;
    originalCreditableTax: string;
    initialCreditedQuantity: string;
    initialCreditedSubtotal: string;
    initialCreditedTax: string;
    initialCreditedCreditableTax: string;
    creditedQuantity: Decimal;
    creditedSubtotal: Decimal;
    creditedTax: Decimal;
    creditedCreditableTax: Decimal;
}

const ceilingMoney = (value: unknown, field: string): string => {
    const exact = evidenceDecimal(value, 2, field);
    return new Decimal(exact).toFixed(2);
};

const buildCreditCeiling = (item: SupplierCreditReturnItemSnapshot): PurchaseItemCreditCeiling => {
    const originalQuantity = evidenceDecimal(item.originalQtyExact, 4, 'originalQtyExact');
    const originalSubtotal = ceilingMoney(item.originalSubtotal, 'originalSubtotal');
    const originalTax = ceilingMoney(item.originalTax, 'originalTax');
    const originalCreditableTax = ceilingMoney(item.originalCreditableTax, 'originalCreditableTax');
    const creditedQuantity = new Decimal(evidenceDecimal(item.creditedQtyExact, 4, 'creditedQtyExact'));
    const creditedSubtotal = new Decimal(ceilingMoney(item.creditedSubtotal, 'creditedSubtotal'));
    const creditedTax = new Decimal(ceilingMoney(item.creditedTax, 'creditedTax'));
    const creditedCreditableTax = new Decimal(ceilingMoney(
        item.creditedCreditableTax,
        'creditedCreditableTax',
    ));
    if (
        !new Decimal(originalQuantity).greaterThan(0)
        || creditedQuantity.greaterThan(originalQuantity)
        || creditedSubtotal.greaterThan(originalSubtotal)
        || creditedTax.greaterThan(originalTax)
        || creditedCreditableTax.greaterThan(originalCreditableTax)
        || new Decimal(originalCreditableTax).greaterThan(originalTax)
    ) return reconciliationRequired('Los topes originales de la factura no concilian');
    return {
        originalQuantity,
        originalSubtotal,
        originalTax,
        originalCreditableTax,
        initialCreditedQuantity: creditedQuantity.toFixed(4),
        initialCreditedSubtotal: creditedSubtotal.toFixed(2),
        initialCreditedTax: creditedTax.toFixed(2),
        initialCreditedCreditableTax: creditedCreditableTax.toFixed(2),
        creditedQuantity,
        creditedSubtotal,
        creditedTax,
        creditedCreditableTax,
    };
};

const sameCreditCeiling = (
    left: PurchaseItemCreditCeiling,
    right: PurchaseItemCreditCeiling,
): boolean => left.originalQuantity === right.originalQuantity
    && left.originalSubtotal === right.originalSubtotal
    && left.originalTax === right.originalTax
    && left.originalCreditableTax === right.originalCreditableTax
    && left.initialCreditedQuantity === right.initialCreditedQuantity
    && left.initialCreditedSubtotal === right.initialCreditedSubtotal
    && left.initialCreditedTax === right.initialCreditedTax
    && left.initialCreditedCreditableTax === right.initialCreditedCreditableTax;

const proportionalAmount = (input: {
    originalAmount: string;
    creditedAmount: Decimal;
    originalQuantity: string;
    requestedQuantity: Decimal;
    remainingQuantity: Decimal;
}): Decimal => {
    const original = new Decimal(input.originalAmount);
    const remaining = original.minus(input.creditedAmount);
    const amount = input.requestedQuantity.equals(input.remainingQuantity)
        ? remaining
        : original.mul(input.requestedQuantity)
            .div(input.originalQuantity)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (amount.isNegative() || amount.greaterThan(remaining)) {
        return reconciliationRequired('La distribución acumulada excede el importe original');
    }
    return amount;
};

const resolveInvoiceLink = (
    item: SupplierCreditReturnItemSnapshot,
    request: CanonicalSupplierCreditNoteRequest,
    returnQuantity: string,
): {
    sourceType: SupplierCreditNoteCanonicalLine['sourceType'];
    goodsReceiptItemId: string | null;
    sourcePurchaseId: string;
    sourcePurchaseItemId: string;
    purchaseMatchAllocationId: string | null;
} => {
    if (
        item.sourceType !== 'DIRECT_PURCHASE_ITEM'
        && item.sourceType !== 'GOODS_RECEIPT_UNMATCHED'
        && item.sourceType !== 'PURCHASE_MATCH_ALLOCATION'
    ) return reconciliationRequired('El tipo de fuente física no es conciliable');
    const sourceType = item.sourceType;
    if (sourceType !== 'GOODS_RECEIPT_UNMATCHED') {
        if (item.resolvedInvoiceLinks !== undefined) {
            return reconciliationRequired('Solo una recepción no facturada admite vínculo resuelto');
        }
        return {
            sourceType,
            goodsReceiptItemId: optionalStoredIdentifier(item.goodsReceiptItemId),
            sourcePurchaseId: storedIdentifier(item.sourcePurchaseId),
            sourcePurchaseItemId: storedIdentifier(item.sourcePurchaseItemId),
            purchaseMatchAllocationId: optionalStoredIdentifier(item.purchaseMatchAllocationId),
        };
    }
    if (!Array.isArray(item.resolvedInvoiceLinks) || item.resolvedInvoiceLinks.length !== 1) {
        return reconciliationRequired('La recepción devuelta requiere un único vínculo de factura exacto');
    }
    const rawLink = item.resolvedInvoiceLinks[0];
    if (!record(rawLink)) return reconciliationRequired('El vínculo de factura está incompleto');
    const link = rawLink as unknown as SupplierCreditResolvedInvoiceLink;
    const goodsReceiptItemId = storedIdentifier(item.goodsReceiptItemId);
    if (
        storedIdentifier(link.tenantId) !== request.tenantId
        || storedIdentifier(link.supplierId) !== request.supplierId
        || storedIdentifier(link.goodsReceiptItemId) !== goodsReceiptItemId
        || new Decimal(evidenceDecimal(link.quantityExact, 4, 'matchedQuantityExact')).lessThan(returnQuantity)
    ) return reconciliationRequired('El vínculo de factura no cubre toda la devolución física');
    return {
        sourceType,
        goodsReceiptItemId,
        sourcePurchaseId: storedIdentifier(link.sourcePurchaseId),
        sourcePurchaseItemId: storedIdentifier(link.sourcePurchaseItemId),
        purchaseMatchAllocationId: storedIdentifier(link.purchaseMatchAllocationId),
    };
};

const buildJournalLines = (input: {
    total: string;
    creditableTax: string;
    inventoryReversalExact: string;
}): SupplierCreditJournalLine[] => {
    const total = new Decimal(input.total);
    const tax = new Decimal(input.creditableTax);
    const inventory = new Decimal(input.inventoryReversalExact)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const residual = total.minus(tax).minus(inventory);
    if (
        total.greaterThan(MAX_JOURNAL_AMOUNT)
        || tax.greaterThan(MAX_JOURNAL_AMOUNT)
        || inventory.abs().greaterThan(MAX_JOURNAL_AMOUNT)
        || residual.abs().greaterThan(MAX_JOURNAL_AMOUNT)
    ) return reconciliationRequired('El asiento excede Decimal(14,2)');
    const lines: SupplierCreditJournalLine[] = [{
        accountCode: '2.1.1',
        debit: total.toFixed(2),
        credit: '0.00',
    }];
    if (!tax.isZero()) lines.push({ accountCode: '1.1.5', debit: '0.00', credit: tax.toFixed(2) });
    if (!inventory.isZero()) lines.push({ accountCode: '1.1.4', debit: '0.00', credit: inventory.toFixed(2) });
    if (residual.isPositive()) {
        lines.push({ accountCode: '5.1.3', debit: '0.00', credit: residual.toFixed(2) });
    } else if (residual.isNegative()) {
        lines.push({ accountCode: '5.1.3', debit: residual.abs().toFixed(2), credit: '0.00' });
    }
    return lines;
};

export function planSupplierCreditNotePosting(input: {
    request: CanonicalSupplierCreditNoteRequest;
    returnItems: readonly SupplierCreditReturnItemSnapshot[];
    purchases: readonly SupplierCreditPurchaseSnapshot[];
    fiscalPeriodOpen: boolean;
    retentionAdjustmentRequired: boolean;
    fiscalRegimeAtPosting: unknown;
}): SupplierCreditNotePostingPlan {
    if (input.fiscalPeriodOpen !== true || input.retentionAdjustmentRequired !== false) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'El período fiscal o las retenciones requieren revisión contable',
        );
    }
    if (input.returnItems.length !== input.request.lines.length) {
        return reconciliationRequired('No se encontraron todas las líneas físicas de la nota');
    }
    const purchasesById = new Map<string, SupplierCreditPurchaseSnapshot>();
    for (const purchase of input.purchases) {
        const id = storedIdentifier(purchase.purchaseId);
        if (purchasesById.has(id)) return reconciliationRequired('La evidencia de compras está duplicada');
        purchasesById.set(id, purchase);
    }
    if (purchasesById.size !== input.request.applications.length) {
        return reconciliationRequired('Las compras bloqueadas no coinciden con las aplicaciones');
    }

    const applicationPurchaseIds = new Set(input.request.applications.map((application) => application.purchaseId));
    const eligiblePurchases = new Map<string, ReturnType<typeof assertPurchaseEligible>>();
    for (const application of input.request.applications) {
        const purchase = purchasesById.get(application.purchaseId);
        if (!purchase) return reconciliationRequired('No se encontró una compra aplicada');
        eligiblePurchases.set(application.purchaseId, assertPurchaseEligible(purchase, input.request));
    }

    const itemsById = new Map<string, SupplierCreditReturnItemSnapshot>();
    for (const item of input.returnItems) {
        const id = storedIdentifier(item.supplierReturnItemId);
        if (itemsById.has(id)) return reconciliationRequired('La evidencia física está duplicada');
        itemsById.set(id, item);
    }
    const returnDates: string[] = [];
    const invoiceDates = new Set<string>();
    const sourceFiscalRegimes = new Set<SupplierCreditFiscalRegime>();
    const creditCeilings = new Map<string, PurchaseItemCreditCeiling>();
    const canonicalLines = input.request.lines.map((line): SupplierCreditNoteCanonicalLine => {
        const item = itemsById.get(line.supplierReturnItemId);
        if (!item) return reconciliationRequired('No se encontró una línea física de la nota');
        if (storedIdentifier(item.tenantId) !== input.request.tenantId
            || storedIdentifier(item.supplierId) !== input.request.supplierId) {
            return reconciliationRequired('La línea física no pertenece al proveedor de la nota');
        }
        if (item.returnStatus !== SUPPLIER_CREDIT_NOTE_STATUS) {
            throw new SupplierCreditNoteError(
                'SUPPLIER_CREDIT_NOTE_RETURN_NOT_POSTED',
                409,
                'La nota solo puede acreditar devoluciones físicas POSTED',
            );
        }
        if (item.alreadyCredited === true) {
            throw new SupplierCreditNoteError(
                'SUPPLIER_CREDIT_NOTE_RETURN_ITEM_ALREADY_CREDITED',
                409,
                'Una línea física solo puede acreditarse completa una vez en v1',
            );
        }
        if (item.alreadyCredited !== false || !sha256Value(item.sourceHash)) {
            return reconciliationRequired('La línea física no tiene integridad demostrable');
        }
        const quantityExact = evidenceDecimal(item.quantityExact, 4, 'quantityExact');
        if (line.quantity !== quantityExact) {
            return reconciliationRequired('La nota debe acreditar la cantidad física completa');
        }
        const bookUnitCostExact = evidenceDecimal(item.bookUnitCostExact, 6, 'bookUnitCostExact');
        const bookValueExact = evidenceDecimal(item.bookValueExact, 4, 'bookValueExact');
        const expectedBookValue = new Decimal(bookUnitCostExact)
            .mul(quantityExact)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            .toFixed(4);
        if (bookValueExact !== expectedBookValue) {
            return reconciliationRequired('El valor libro de la línea física no concilia');
        }
        const invoiceLink = resolveInvoiceLink(item, input.request, quantityExact);
        const {
            sourcePurchaseId,
            sourcePurchaseItemId,
            purchaseMatchAllocationId,
        } = invoiceLink;
        if (!applicationPurchaseIds.has(sourcePurchaseId)) {
            return reconciliationRequired('Cada factura fuente debe recibir una aplicación explícita');
        }
        const sourcePurchase = eligiblePurchases.get(sourcePurchaseId);
        if (!sourcePurchase) return reconciliationRequired('La factura fuente no es acreditable');
        invoiceDates.add(sourcePurchase.invoiceDate);
        sourceFiscalRegimes.add(sourcePurchase.fiscalRegime);
        returnDates.push(storedDateOnly(item.devolutionDateManagua));

        const snapshotCeiling = buildCreditCeiling(item);
        const currentCeiling = creditCeilings.get(sourcePurchaseItemId);
        if (currentCeiling && !sameCreditCeiling(currentCeiling, snapshotCeiling)) {
            return reconciliationRequired('Los topes repetidos de la línea de factura no coinciden');
        }
        const ceiling = currentCeiling ?? snapshotCeiling;
        if (!currentCeiling) creditCeilings.set(sourcePurchaseItemId, ceiling);
        const requestedQuantity = new Decimal(quantityExact);
        const remainingQuantity = new Decimal(ceiling.originalQuantity).minus(ceiling.creditedQuantity);
        if (requestedQuantity.greaterThan(remainingQuantity)) {
            return reconciliationRequired('La cantidad acreditada excede la cantidad original pendiente');
        }
        const derivedSubtotal = proportionalAmount({
            originalAmount: ceiling.originalSubtotal,
            creditedAmount: ceiling.creditedSubtotal,
            originalQuantity: ceiling.originalQuantity,
            requestedQuantity,
            remainingQuantity,
        });
        const derivedTax = proportionalAmount({
            originalAmount: ceiling.originalTax,
            creditedAmount: ceiling.creditedTax,
            originalQuantity: ceiling.originalQuantity,
            requestedQuantity,
            remainingQuantity,
        });
        const derivedCreditableTax = proportionalAmount({
            originalAmount: ceiling.originalCreditableTax,
            creditedAmount: ceiling.creditedCreditableTax,
            originalQuantity: ceiling.originalQuantity,
            requestedQuantity,
            remainingQuantity,
        });
        if (
            line.subtotal !== derivedSubtotal.toFixed(2)
            || line.tax !== derivedTax.toFixed(2)
            || line.creditableTax !== derivedCreditableTax.toFixed(2)
            || line.total !== derivedSubtotal.plus(derivedTax).toFixed(2)
        ) return reconciliationRequired('Los importes de la nota no corresponden a la cantidad devuelta');
        ceiling.creditedQuantity = ceiling.creditedQuantity.plus(requestedQuantity);
        ceiling.creditedSubtotal = ceiling.creditedSubtotal.plus(derivedSubtotal);
        ceiling.creditedTax = ceiling.creditedTax.plus(derivedTax);
        ceiling.creditedCreditableTax = ceiling.creditedCreditableTax.plus(derivedCreditableTax);
        const linePriceVariance = new Decimal(line.total)
            .minus(line.creditableTax)
            .minus(bookValueExact);
        return {
            ...line,
            supplierReturnId: storedIdentifier(item.supplierReturnId),
            sourcePurchaseId,
            sourcePurchaseItemId,
            purchaseMatchAllocationId,
            sourceType: invoiceLink.sourceType,
            goodsReceiptItemId: invoiceLink.goodsReceiptItemId,
            sourceHash: item.sourceHash,
            bookUnitCostExact,
            bookValueExact,
            inventoryReversalExact: bookValueExact,
            priceVarianceReversalExact: derivedSignedDecimal18(
                linePriceVariance,
                'La reversión de PPV de una línea excede Decimal(18,4)',
            ),
            descriptionAtCredit: storedIdentifier(item.productNameAtReturn),
            unitAtCredit: (() => {
                const unit = storedIdentifier(item.unitAtReturn);
                return unit.length <= 32 ? unit : reconciliationRequired('La unidad física excede el contrato');
            })(),
        };
    });

    if (invoiceDates.size !== 1) {
        throw new SupplierCreditNoteError(
            'MULTIPLE_SOURCE_INVOICE_DATES',
            409,
            'Las facturas fuente deben compartir invoiceDate en v1',
        );
    }
    if (
        sourceFiscalRegimes.size !== 1
        || !fiscalRegimeSet.has(input.fiscalRegimeAtPosting)
        || [...sourceFiscalRegimes][0] !== input.request.fiscalRegimeAtCredit
        || input.fiscalRegimeAtPosting !== input.request.fiscalRegimeAtCredit
    ) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'El régimen fiscal de las facturas no coincide con el período de la nota',
        );
    }
    const canonicalInvoiceDate = [...invoiceDates][0];
    if (input.request.invoiceDate !== canonicalInvoiceDate) {
        return reconciliationRequired('invoiceDate no coincide con la factura fuente');
    }
    returnDates.sort();
    if (returnDates.some((date) => date.slice(0, 7) !== returnDates[0].slice(0, 7))) {
        throw new SupplierCreditNoteError(
            'FISCAL_ADJUSTMENT_REVIEW_REQUIRED',
            409,
            'Las devoluciones agrupadas deben pertenecer al mismo período fiscal',
        );
    }
    const canonicalDevolutionDate = returnDates[returnDates.length - 1];
    if (input.request.devolutionDate !== canonicalDevolutionDate) {
        return reconciliationRequired('devolutionDate debe ser la fecha máxima de las devoluciones incluidas');
    }

    const applicationPlans = input.request.applications.map((application): SupplierCreditApplicationPlan => {
        const purchase = eligiblePurchases.get(application.purchaseId)!;
        const balanceAfter = new Decimal(purchase.balanceDue).minus(application.amount);
        if (balanceAfter.isNegative()) {
            throw new SupplierCreditNoteError(
                'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED',
                409,
                'Una aplicación excede el saldo materializado de la compra',
            );
        }
        return {
            ...application,
            balanceBefore: purchase.balanceDue,
            balanceAfter: balanceAfter.toFixed(4),
            settled: balanceAfter.isZero(),
        };
    });
    const inventoryReversalExact = derivedSignedDecimal18(canonicalLines.reduce(
        (sum, line) => sum.plus(line.inventoryReversalExact),
        new Decimal(0),
    ), 'La reversión de inventario excede Decimal(18,4)');
    const priceVarianceReversalExact = derivedSignedDecimal18(new Decimal(input.request.total)
        .minus(input.request.creditableTax)
        .minus(inventoryReversalExact), 'La reversión de PPV excede Decimal(18,4)');
    const command: CanonicalSupplierCreditNoteCommand = {
        ...input.request,
        type: SUPPLIER_CREDIT_NOTE_TYPE,
        status: SUPPLIER_CREDIT_NOTE_STATUS,
        inventoryReversalExact,
        priceVarianceReversalExact,
        remainingCredit: '0.00',
        lines: canonicalLines,
        applications: input.request.applications,
    };
    const journalLines = buildJournalLines(command);
    const debit = journalLines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0));
    const credit = journalLines.reduce((sum, line) => sum.plus(line.credit), new Decimal(0));
    if (!debit.equals(credit)) return reconciliationRequired('El asiento de la nota no está balanceado');
    return { command, applications: applicationPlans, journalLines };
}

export const buildSupplierCreditNoteCommandId = (
    command: Pick<CanonicalSupplierCreditNoteRequest, 'tenantId' | 'clientEventId'>,
): string => sha256([
    SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION,
    SUPPLIER_CREDIT_NOTE_COMMAND_TYPE,
    command.tenantId,
    command.clientEventId,
]);

/** Incluye snapshots físicos/contables y aplicaciones; excluye UUID y actor del replay. */
export const buildSupplierCreditNotePayloadHash = (
    command: CanonicalSupplierCreditNoteCommand,
): string => sha256({
    version: command.version,
    tenantId: command.tenantId,
    supplierId: command.supplierId,
    creditNoteNumber: command.creditNoteNumber,
    type: command.type,
    status: command.status,
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
    inventoryReversalExact: command.inventoryReversalExact,
    priceVarianceReversalExact: command.priceVarianceReversalExact,
    remainingCredit: command.remainingCredit,
    lines: command.lines,
    applications: command.applications,
});

export interface SupplierCreditNoteStoredResult {
    version: 1;
    commandType: typeof SUPPLIER_CREDIT_NOTE_COMMAND_TYPE;
    commandId: string;
    payloadHash: string;
    response: {
        supplierCreditNoteId: string;
        creditNoteNumber: string;
        supplierId: string;
        status: typeof SUPPLIER_CREDIT_NOTE_STATUS;
        total: string;
        remainingCredit: '0.00';
        returnItemIds: string[];
        applications: CanonicalSupplierCreditApplicationRequest[];
    };
}

const incompleteStoredResult = (): never => {
    throw new SupplierCreditNoteError(
        'SUPPLIER_CREDIT_NOTE_RESULT_INCOMPLETE',
        500,
        'El resultado idempotente de la nota está incompleto o corrupto',
    );
};

export const serializeSupplierCreditNoteStoredResult = (result: SupplierCreditNoteStoredResult): string =>
    JSON.stringify(result);

export function parseSupplierCreditNoteStoredResult(
    details: string | null,
    expected: {
        commandId: string;
        payloadHash: string;
        supplierId: string;
        total: string;
        returnItemIds: readonly string[];
        applications: readonly CanonicalSupplierCreditApplicationRequest[];
    },
): SupplierCreditNoteStoredResult {
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(details as string);
    } catch {
        // El sentinel null conserva el fallo cerrado.
    }
    if (!record(parsed)
        || parsed.version !== SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION
        || parsed.commandType !== SUPPLIER_CREDIT_NOTE_COMMAND_TYPE
        || parsed.commandId !== expected.commandId
        || parsed.payloadHash !== expected.payloadHash
        || !sha256Value(parsed.commandId)
        || !sha256Value(parsed.payloadHash)
        || !record(parsed.response)) return incompleteStoredResult();
    const response = parsed.response;
    if (typeof response.supplierCreditNoteId !== 'string'
        || !response.supplierCreditNoteId
        || typeof response.creditNoteNumber !== 'string'
        || !response.creditNoteNumber
        || response.supplierId !== expected.supplierId
        || response.status !== SUPPLIER_CREDIT_NOTE_STATUS
        || response.total !== expected.total
        || response.remainingCredit !== '0.00'
        || !Array.isArray(response.returnItemIds)
        || response.returnItemIds.length !== expected.returnItemIds.length
        || !Array.isArray(response.applications)
        || response.applications.length !== expected.applications.length) return incompleteStoredResult();
    for (let index = 0; index < expected.returnItemIds.length; index += 1) {
        if (response.returnItemIds[index] !== expected.returnItemIds[index]) return incompleteStoredResult();
    }
    const applications = response.applications.map((raw, index) => {
        if (!record(raw)
            || raw.purchaseId !== expected.applications[index].purchaseId
            || raw.amount !== expected.applications[index].amount) return incompleteStoredResult();
        return { purchaseId: raw.purchaseId, amount: raw.amount };
    });
    return {
        version: SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION,
        commandType: SUPPLIER_CREDIT_NOTE_COMMAND_TYPE,
        commandId: expected.commandId,
        payloadHash: expected.payloadHash,
        response: {
            supplierCreditNoteId: response.supplierCreditNoteId,
            creditNoteNumber: response.creditNoteNumber,
            supplierId: expected.supplierId,
            status: SUPPLIER_CREDIT_NOTE_STATUS,
            total: expected.total,
            remainingCredit: '0.00',
            returnItemIds: [...expected.returnItemIds],
            applications,
        },
    };
}

export function assertSupplierCreditNoteReplay(
    existing: { payloadVersion: number | null; payloadHash: string | null },
    expectedPayloadHash: string,
): void {
    if (
        existing.payloadVersion === SUPPLIER_CREDIT_NOTE_PAYLOAD_VERSION
        && existing.payloadHash === expectedPayloadHash
    ) return;
    throw new SupplierCreditNoteError(
        'SUPPLIER_CREDIT_NOTE_IDEMPOTENCY_CONFLICT',
        409,
        'clientEventId ya fue usado con otra nota de crédito de proveedor',
    );
}
