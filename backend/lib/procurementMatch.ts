import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

// Se aplica al ejecutar el motor (no al importar el módulo) para que cada
// cálculo restaure explícitamente la precisión necesaria de Decimal.js. El
// importe máximo permitido puede superar los 20 dígitos significativos.
const configureProcurementDecimal = (): void => {
    Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
};

export const PROCUREMENT_MATCH_STATUSES = [
    'NOT_REQUIRED',
    'MATCHED',
    'EXCEPTION',
    'RESOLVED',
] as const;

export type ProcurementMatchStatus = typeof PROCUREMENT_MATCH_STATUSES[number];
export type ProcurementMatchPaymentMethod = 'CASH' | 'CREDIT';

export interface ProcurementOrderLineInput {
    id: string;
    orderedQuantity: Decimal.Value;
    orderedUnitCost: Decimal.Value;
}

export interface ProcurementReceiptLineInput {
    /** Identidad interna determinista; para proyección legacy no se persiste. */
    id: string;
    goodsReceiptItemId?: string | null;
    source?: 'FORMAL_RECEIPT' | 'LEGACY_PROJECTION';
    purchaseOrderItemId: string;
    acceptedQuantity: Decimal.Value;
    allocatedQuantity: Decimal.Value;
    receivedAt: Date | string;
}

export interface ProcurementInvoiceLineInput {
    /** Identidad estable de la línea de factura; no es productId. */
    key: string;
    purchaseOrderItemId: string;
    quantity: Decimal.Value;
    unitCost: Decimal.Value;
}

export interface CalculateProcurementMatchInput {
    purchaseOrderId: string | null;
    paymentMethod: string;
    /** Porcentaje congelado en la factura, p. ej. 2 = 2 %. */
    priceTolerancePercent: Decimal.Value;
    orderLines: ProcurementOrderLineInput[];
    receiptLines: ProcurementReceiptLineInput[];
    invoiceLines: ProcurementInvoiceLineInput[];
}

export interface ProcurementAllocationPlan {
    invoiceLineKey: string;
    purchaseOrderItemId: string;
    goodsReceiptItemId: string | null;
    source: 'FORMAL_RECEIPT' | 'LEGACY_PROJECTION';
    quantity: string;
    expectedUnitCostExact: string;
    actualUnitCostExact: string;
    /** Importe de esta asignación, no diferencia unitaria. */
    priceVarianceExact: string;
}

export interface ProcurementMatchedLine {
    invoiceLineKey: string;
    purchaseOrderItemId: string;
    orderedQuantity: string;
    acceptedQuantity: string;
    alreadyAllocatedQuantity: string;
    availableBefore: string;
    requestedQuantity: string;
    orderedUnitCost: string;
    invoiceUnitCost: string;
    unitCostVariance: string;
    allowedUnitCostVariance: string;
    expectedAmount: string;
    invoiceAmount: string;
    varianceAmount: string;
    /** Suma Decimal(18,4) de las variaciones de sus asignaciones. */
    priceVarianceExact: string;
    withinPriceTolerance: boolean;
    usesLegacyProjection: boolean;
    allocations: ProcurementAllocationPlan[];
}

export interface ProcurementMatchPlan {
    status: Extract<ProcurementMatchStatus, 'NOT_REQUIRED' | 'MATCHED' | 'EXCEPTION'>;
    paymentHold: boolean;
    priceTolerancePercent: string;
    expectedAmount: string;
    invoiceAmount: string;
    varianceAmount: string;
    lines: ProcurementMatchedLine[];
    allocations: ProcurementAllocationPlan[];
    exceptionCodes: Array<'PRICE_VARIANCE' | 'LEGACY_RECEIPT_TRACE'>;
}

export class ProcurementMatchError extends Error {
    constructor(
        readonly code: string,
        readonly httpStatus: number,
        message: string,
        readonly details?: Record<string, string>,
    ) {
        super(message);
        this.name = 'ProcurementMatchError';
    }
}

const normalizeId = (value: string, field: string): string => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        throw new ProcurementMatchError(
            'INVALID_MATCH_INPUT',
            400,
            `${field} es obligatorio para conciliar la factura`,
        );
    }
    return normalized;
};

const parseDecimal = (
    value: Decimal.Value,
    field: string,
    maximum: Decimal,
    maximumDecimalPlaces: number,
    allowZero: boolean,
): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new ProcurementMatchError(
            'INVALID_MATCH_DECIMAL',
            400,
            `${field} no es un decimal válido`,
        );
    }
    if (!parsed.isFinite()
        || (allowZero ? parsed.isNegative() : !parsed.greaterThan(0))
        || parsed.greaterThan(maximum)
        || parsed.decimalPlaces() > maximumDecimalPlaces) {
        throw new ProcurementMatchError(
            'INVALID_MATCH_DECIMAL',
            400,
            `${field} está fuera del rango o precisión permitidos`,
        );
    }
    return parsed;
};

const quantity = (value: Decimal.Value, field: string, allowZero = false): Decimal =>
    parseDecimal(value, field, new Decimal('99999999999999.9999'), 4, allowZero);

const unitCost = (value: Decimal.Value, field: string): Decimal =>
    parseDecimal(value, field, new Decimal('999999999999.999999'), 6, false);

const tolerancePercent = (value: Decimal.Value): Decimal => {
    const parsed = parseDecimal(value, 'priceTolerancePercent', new Decimal(100), 6, true);
    return parsed;
};

/** Redondeo único de importes que terminan en Purchase/JournalLine (2dp). */
export const toPostedProcurementAmount = (value: Decimal.Value): string => {
    configureProcurementDecimal();
    return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
};

/**
 * Suma importes ya en el mismo grano legal que Purchase: cada línea se liquida
 * a centavos antes de acumular. Redondear una sola vez el agregado exacto crea
 * PPV ficticia (p. ej. 1.005 + 1.005 = 2.02 por línea, no 2.01).
 */
export const summarizePostedProcurementAmounts = (
    lines: ReadonlyArray<{
        expectedAmount: Decimal.Value;
        invoiceAmount: Decimal.Value;
    }>,
): Pick<ProcurementMatchPlan, 'expectedAmount' | 'invoiceAmount' | 'varianceAmount'> => {
    configureProcurementDecimal();
    const totals = lines.reduce((current, line) => ({
        expected: current.expected.plus(toPostedProcurementAmount(line.expectedAmount)),
        invoice: current.invoice.plus(toPostedProcurementAmount(line.invoiceAmount)),
    }), { expected: new Decimal(0), invoice: new Decimal(0) });
    return {
        expectedAmount: totals.expected.toFixed(2),
        invoiceAmount: totals.invoice.toFixed(2),
        varianceAmount: totals.invoice.minus(totals.expected).toFixed(2),
    };
};

const receiptTimestamp = (value: Date | string): number => {
    const parsed = value instanceof Date ? value : new Date(value);
    const timestamp = parsed.getTime();
    if (Number.isNaN(timestamp)) {
        throw new ProcurementMatchError(
            'INVALID_RECEIPT_DATE',
            409,
            'Una recepción aceptada tiene una fecha inválida y requiere conciliación',
        );
    }
    return timestamp;
};

const emptyDirectMatchPlan = (tolerance: Decimal): ProcurementMatchPlan => ({
    status: 'NOT_REQUIRED',
    paymentHold: false,
    priceTolerancePercent: tolerance.toFixed(6),
    expectedAmount: '0.00',
    invoiceAmount: '0.00',
    varianceAmount: '0.00',
    lines: [],
    allocations: [],
    exceptionCodes: [],
});

/**
 * Construye el plan 3-way sin I/O. La identidad es PurchaseOrderItem.id de
 * extremo a extremo: dos líneas de la OC con el mismo SKU nunca comparten
 * recepción ni saldo. Las recepciones se consumen FIFO por receivedAt + id.
 */
export function calculateProcurementMatch(
    input: CalculateProcurementMatchInput,
): ProcurementMatchPlan {
    configureProcurementDecimal();
    const tolerance = tolerancePercent(input.priceTolerancePercent);
    if (input.purchaseOrderId === null) return emptyDirectMatchPlan(tolerance);

    normalizeId(input.purchaseOrderId, 'purchaseOrderId');
    const paymentMethod = input.paymentMethod.trim().toUpperCase();
    if (paymentMethod !== 'CASH' && paymentMethod !== 'CREDIT') {
        throw new ProcurementMatchError(
            'INVALID_MATCH_PAYMENT_METHOD',
            400,
            'La conciliación de OC solo admite compras CASH o CREDIT',
        );
    }
    if (input.orderLines.length === 0 || input.invoiceLines.length === 0) {
        throw new ProcurementMatchError(
            'EMPTY_MATCH_LINES',
            400,
            'La conciliación requiere líneas de orden y de factura',
        );
    }

    const orderLines = new Map<string, {
        orderedQuantity: Decimal;
        orderedUnitCost: Decimal;
    }>();
    for (const line of input.orderLines) {
        const id = normalizeId(line.id, 'purchaseOrderItemId');
        if (orderLines.has(id)) {
            throw new ProcurementMatchError(
                'DUPLICATE_ORDER_LINE',
                409,
                'La orden contiene una identidad de línea duplicada',
                { purchaseOrderItemId: id },
            );
        }
        orderLines.set(id, {
            orderedQuantity: quantity(line.orderedQuantity, `orderedQuantity:${id}`),
            orderedUnitCost: unitCost(line.orderedUnitCost, `orderedUnitCost:${id}`),
        });
    }

    const receiptIds = new Set<string>();
    const receiptsByOrderLine = new Map<string, Array<{
        id: string;
        goodsReceiptItemId: string | null;
        source: 'FORMAL_RECEIPT' | 'LEGACY_PROJECTION';
        acceptedQuantity: Decimal;
        allocatedQuantity: Decimal;
        availableQuantity: Decimal;
        timestamp: number;
    }>>();
    for (const receipt of input.receiptLines) {
        const id = normalizeId(receipt.id, 'goodsReceiptItemId');
        const orderLineId = normalizeId(receipt.purchaseOrderItemId, 'purchaseOrderItemId');
        if (receiptIds.has(id)) {
            throw new ProcurementMatchError(
                'DUPLICATE_RECEIPT_LINE',
                409,
                'La recepción contiene una identidad de línea duplicada',
                { goodsReceiptItemId: id },
            );
        }
        receiptIds.add(id);
        if (!orderLines.has(orderLineId)) {
            throw new ProcurementMatchError(
                'RECEIPT_OUTSIDE_PURCHASE_ORDER',
                409,
                'Una recepción aceptada no pertenece a una línea de esta orden',
                { goodsReceiptItemId: id, purchaseOrderItemId: orderLineId },
            );
        }
        const accepted = quantity(receipt.acceptedQuantity, `acceptedQuantity:${id}`);
        const allocated = quantity(receipt.allocatedQuantity, `allocatedQuantity:${id}`, true);
        const source = receipt.source ?? 'FORMAL_RECEIPT';
        const goodsReceiptItemId = receipt.goodsReceiptItemId === undefined
            ? id
            : receipt.goodsReceiptItemId;
        if ((source === 'FORMAL_RECEIPT' && !goodsReceiptItemId)
            || (source === 'LEGACY_PROJECTION' && goodsReceiptItemId !== null)) {
            throw new ProcurementMatchError(
                'INVALID_RECEIPT_SOURCE',
                409,
                'La fuente de recepción no coincide con su trazabilidad persistida',
                { receiptLineId: id },
            );
        }
        if (allocated.greaterThan(accepted)) {
            throw new ProcurementMatchError(
                'INVALID_RECEIPT_ALLOCATION',
                409,
                'Una recepción tiene más cantidad asignada que aceptada',
                { goodsReceiptItemId: id },
            );
        }
        const lines = receiptsByOrderLine.get(orderLineId) ?? [];
        lines.push({
            id,
            goodsReceiptItemId,
            source,
            acceptedQuantity: accepted,
            allocatedQuantity: allocated,
            availableQuantity: accepted.minus(allocated),
            timestamp: receiptTimestamp(receipt.receivedAt),
        });
        receiptsByOrderLine.set(orderLineId, lines);
    }
    for (const receipts of receiptsByOrderLine.values()) {
        receipts.sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
    }

    const invoiceKeys = new Set<string>();
    const normalizedInvoiceLines = input.invoiceLines.map((line) => {
        const key = normalizeId(line.key, 'invoiceLineKey');
        const orderLineId = normalizeId(line.purchaseOrderItemId, 'purchaseOrderItemId');
        if (invoiceKeys.has(key)) {
            throw new ProcurementMatchError(
                'DUPLICATE_INVOICE_LINE_KEY',
                400,
                'La factura contiene una identidad de línea duplicada',
                { invoiceLineKey: key },
            );
        }
        invoiceKeys.add(key);
        if (!orderLines.has(orderLineId)) {
            throw new ProcurementMatchError(
                'INVOICE_LINE_OUTSIDE_PURCHASE_ORDER',
                409,
                'Una línea de factura no pertenece a esta orden de compra',
                { invoiceLineKey: key, purchaseOrderItemId: orderLineId },
            );
        }
        return {
            key,
            purchaseOrderItemId: orderLineId,
            quantity: quantity(line.quantity, `invoiceQuantity:${key}`),
            unitCost: unitCost(line.unitCost, `invoiceUnitCost:${key}`),
        };
    });

    // El orden de entrada no debe cambiar qué recepción queda vinculada. La key
    // la fija el caller antes de persistir y por eso también hace estable el FIFO.
    normalizedInvoiceLines.sort((left, right) => left.key.localeCompare(right.key));

    const matchedLines: ProcurementMatchedLine[] = [];
    const allocations: ProcurementAllocationPlan[] = [];
    let hasPriceVariance = false;
    let hasLegacyProjection = false;

    for (const invoiceLine of normalizedInvoiceLines) {
        const orderLine = orderLines.get(invoiceLine.purchaseOrderItemId)!;
        const receipts = receiptsByOrderLine.get(invoiceLine.purchaseOrderItemId) ?? [];
        const accepted = receipts.reduce(
            (sum, receipt) => sum.plus(receipt.acceptedQuantity),
            new Decimal(0),
        );
        const alreadyAllocated = receipts.reduce(
            (sum, receipt) => sum.plus(receipt.allocatedQuantity),
            new Decimal(0),
        );
        const availableBefore = accepted.minus(alreadyAllocated);
        if (accepted.greaterThan(orderLine.orderedQuantity)) {
            throw new ProcurementMatchError(
                'RECEIPT_EXCEEDS_ORDERED_QUANTITY',
                409,
                'La cantidad aceptada excede la cantidad ordenada y requiere conciliación',
                { purchaseOrderItemId: invoiceLine.purchaseOrderItemId },
            );
        }
        if (invoiceLine.quantity.greaterThan(availableBefore)) {
            throw new ProcurementMatchError(
                'INVOICE_EXCEEDS_ACCEPTED_QUANTITY',
                409,
                'La factura excede la mercadería aceptada y aún no facturada',
                {
                    purchaseOrderItemId: invoiceLine.purchaseOrderItemId,
                    acceptedQuantity: accepted.toFixed(4),
                    alreadyAllocatedQuantity: alreadyAllocated.toFixed(4),
                    requestedQuantity: invoiceLine.quantity.toFixed(4),
                },
            );
        }

        let quantityToAllocate = invoiceLine.quantity;
        const lineAllocations: ProcurementAllocationPlan[] = [];
        for (const receipt of receipts) {
            if (quantityToAllocate.isZero()) break;
            if (receipt.availableQuantity.isZero()) continue;
            const allocatedNow = Decimal.min(receipt.availableQuantity, quantityToAllocate);
            const allocationVariance = invoiceLine.unitCost
                .minus(orderLine.orderedUnitCost)
                .mul(allocatedNow)
                .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
            const allocation: ProcurementAllocationPlan = {
                invoiceLineKey: invoiceLine.key,
                purchaseOrderItemId: invoiceLine.purchaseOrderItemId,
                goodsReceiptItemId: receipt.goodsReceiptItemId,
                source: receipt.source,
                quantity: allocatedNow.toFixed(4),
                expectedUnitCostExact: orderLine.orderedUnitCost.toFixed(6),
                actualUnitCostExact: invoiceLine.unitCost.toFixed(6),
                priceVarianceExact: allocationVariance.toFixed(4),
            };
            lineAllocations.push(allocation);
            allocations.push(allocation);
            hasLegacyProjection ||= receipt.source === 'LEGACY_PROJECTION';
            receipt.availableQuantity = receipt.availableQuantity.minus(allocatedNow);
            receipt.allocatedQuantity = receipt.allocatedQuantity.plus(allocatedNow);
            quantityToAllocate = quantityToAllocate.minus(allocatedNow);
        }
        // `invoiceLine.quantity <= availableBefore` ya fue verificado y el loop
        // consume exactamente ese mismo conjunto Decimal de recepciones. Por
        // construcción quantityToAllocate termina en cero; no se duplica una
        // rama inalcanzable que fingiría una defensa adicional.

        const costVariance = invoiceLine.unitCost.minus(orderLine.orderedUnitCost);
        const allowedCostVariance = orderLine.orderedUnitCost.mul(tolerance).div(100);
        const withinPriceTolerance = costVariance.abs().lessThanOrEqualTo(allowedCostVariance);
        hasPriceVariance ||= !withinPriceTolerance;

        const expected = orderLine.orderedUnitCost.mul(invoiceLine.quantity);
        const invoiced = invoiceLine.unitCost.mul(invoiceLine.quantity);
        const lineVarianceExact = lineAllocations.reduce(
            (sum, allocation) => sum.plus(allocation.priceVarianceExact),
            new Decimal(0),
        );
        const expectedAmount = toPostedProcurementAmount(expected);
        const invoiceAmount = toPostedProcurementAmount(invoiced);
        matchedLines.push({
            invoiceLineKey: invoiceLine.key,
            purchaseOrderItemId: invoiceLine.purchaseOrderItemId,
            orderedQuantity: orderLine.orderedQuantity.toFixed(4),
            acceptedQuantity: accepted.toFixed(4),
            alreadyAllocatedQuantity: alreadyAllocated.toFixed(4),
            availableBefore: availableBefore.toFixed(4),
            requestedQuantity: invoiceLine.quantity.toFixed(4),
            orderedUnitCost: orderLine.orderedUnitCost.toFixed(6),
            invoiceUnitCost: invoiceLine.unitCost.toFixed(6),
            unitCostVariance: costVariance.toFixed(6),
            allowedUnitCostVariance: allowedCostVariance.toFixed(6),
            expectedAmount,
            invoiceAmount,
            varianceAmount: new Decimal(invoiceAmount).minus(expectedAmount).toFixed(2),
            priceVarianceExact: lineVarianceExact.toFixed(4),
            withinPriceTolerance,
            usesLegacyProjection: lineAllocations.some(
                (allocation) => allocation.source === 'LEGACY_PROJECTION',
            ),
            allocations: lineAllocations,
        });
    }

    if (hasLegacyProjection && paymentMethod === 'CASH') {
        throw new ProcurementMatchError(
            'CASH_LEGACY_RECEIPT_TRACE_REQUIRES_RESOLUTION',
            409,
            'La compra de contado requiere una recepción formal antes de registrarse',
        );
    }
    if (hasPriceVariance && paymentMethod === 'CASH') {
        throw new ProcurementMatchError(
            'CASH_PRICE_VARIANCE_REQUIRES_RESOLUTION',
            409,
            'La compra de contado excede la tolerancia de precio y debe corregirse antes de registrarla',
        );
    }

    const postedAmounts = summarizePostedProcurementAmounts(matchedLines);
    return {
        status: hasPriceVariance || hasLegacyProjection ? 'EXCEPTION' : 'MATCHED',
        paymentHold: hasPriceVariance || hasLegacyProjection,
        priceTolerancePercent: tolerance.toFixed(6),
        ...postedAmounts,
        lines: matchedLines,
        allocations,
        exceptionCodes: [
            ...(hasPriceVariance ? ['PRICE_VARIANCE' as const] : []),
            ...(hasLegacyProjection ? ['LEGACY_RECEIPT_TRACE' as const] : []),
        ],
    };
}

export interface ProcurementResolutionRequest {
    clientEventId: string;
    reason: string;
}

export interface CanonicalProcurementResolution {
    clientEventId: string;
    reason: string;
    payloadHash: string;
}

/** Canonicaliza la intención que luego protege el unique de resolución. */
export function normalizeProcurementResolution(
    purchaseId: string,
    request: ProcurementResolutionRequest,
): CanonicalProcurementResolution {
    const normalizedPurchaseId = normalizeId(purchaseId, 'purchaseId');
    const clientEventId = normalizeId(request.clientEventId, 'clientEventId').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clientEventId)) {
        throw new ProcurementMatchError(
            'INVALID_RESOLUTION_CLIENT_EVENT_ID',
            400,
            'clientEventId debe ser un UUID válido',
        );
    }
    const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
    if (reason.length < 3 || reason.length > 1000) {
        throw new ProcurementMatchError(
            'INVALID_RESOLUTION_REASON',
            400,
            'reason debe contener entre 3 y 1000 caracteres',
        );
    }
    const payloadHash = createHash('sha256').update(JSON.stringify({
        version: 1,
        purchaseId: normalizedPurchaseId,
        reason,
    })).digest('hex');
    return { clientEventId, reason, payloadHash };
}
