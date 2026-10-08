import Decimal from 'decimal.js';
import type { ShiftCloseReportPayload } from './shiftCloseReport.js';
import {
    allocateReturnMoney,
    calculateHistoricalReportVat,
    calculateProductReportTotals,
    calculateReportTotals,
    formatReportMoney,
    formatReportQuantity,
    divideReportValues,
    multiplyReportValues,
    netReportValue,
    sumReportValues,
} from './reportMoney.js';

export const SALES_REPORT_MAX_DAYS = 366;
export const SALES_DOCUMENT_MAX_DAYS = 31;
export const SALES_EXPORT_MAX_DAYS = 31;
export const SALES_REPORT_MAX_RETURN_RECORDS = 5_000;
export const SALES_REPORT_MAX_RETURN_LINES_TOTAL = 20_000;
export const SALES_REPORT_MAX_PRODUCT_GROUPS = 5_000;
export const SALES_DOCUMENT_MAX_TRANSACTIONS = 1_000;
export const SALES_EXPORT_MAX_TRANSACTIONS = 2_000;
export const SALES_EXPORT_MAX_RETURNS = 2_000;
export const SALES_REPORT_MAX_ITEMS_PER_RETURN = 1_000;

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SalesReportError extends Error {
    constructor(
        readonly code: string,
        readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'SalesReportError';
    }
}

export interface SalesReportRange {
    startDate: string;
    endDate: string;
    start: Date;
    endExclusive: Date;
    days: number;
}

function civilDateOrdinal(value: string): number | null {
    if (!ISO_DATE.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() + 1 !== month
        || date.getUTCDate() !== day
    ) return null;
    return Math.floor(date.getTime() / MS_PER_DAY);
}

function dateFromOrdinal(ordinal: number): string {
    return new Date(ordinal * MS_PER_DAY).toISOString().slice(0, 10);
}

export function parseSalesReportRange(
    startValue: unknown,
    endValue: unknown,
    options: { maxDays?: number } = {},
): SalesReportRange {
    if (typeof startValue !== 'string' || typeof endValue !== 'string') {
        throw new SalesReportError(
            'REPORT_DATE_REQUIRED',
            400,
            'Indicá startDate y endDate en formato YYYY-MM-DD.',
        );
    }
    const startOrdinal = civilDateOrdinal(startValue);
    const endOrdinal = civilDateOrdinal(endValue);
    if (startOrdinal === null || endOrdinal === null) {
        throw new SalesReportError(
            'REPORT_DATE_INVALID',
            400,
            'Las fechas deben existir y usar el formato YYYY-MM-DD.',
        );
    }
    if (endOrdinal < startOrdinal) {
        throw new SalesReportError(
            'REPORT_DATE_ORDER_INVALID',
            400,
            'endDate no puede ser anterior a startDate.',
        );
    }
    const days = endOrdinal - startOrdinal + 1;
    const maxDays = options.maxDays ?? SALES_REPORT_MAX_DAYS;
    if (!Number.isInteger(maxDays) || maxDays < 1 || days > maxDays) {
        throw new SalesReportError(
            'REPORT_RANGE_TOO_LARGE',
            422,
            `El rango máximo permitido es de ${maxDays} días. Reducí el período.`,
        );
    }

    // Nicaragua usa UTC-6 sin horario de verano: el día civil empieza a las
    // 06:00Z. El fin siempre es exclusivo para no perder milisegundos ni
    // depender de la zona horaria del proceso.
    return {
        startDate: startValue,
        endDate: endValue,
        start: new Date(`${startValue}T06:00:00.000Z`),
        endExclusive: new Date(`${dateFromOrdinal(endOrdinal + 1)}T06:00:00.000Z`),
        days,
    };
}

export function defaultSalesReportRange(now: Date = new Date(), days = 30): SalesReportRange {
    if (!Number.isInteger(days) || days < 1 || days > SALES_REPORT_MAX_DAYS) {
        throw new SalesReportError('REPORT_RANGE_INVALID', 500, 'El rango predeterminado es inválido.');
    }
    const managuaDay = new Date(now.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);
    const endOrdinal = civilDateOrdinal(managuaDay)!;
    return parseSalesReportRange(dateFromOrdinal(endOrdinal - days + 1), managuaDay);
}

export type SalesReportScope =
    | { kind: 'tenant' }
    | { kind: 'seller'; userId: string }
    | { kind: 'shift-owner'; userId: string };

export interface SalesReportContext {
    tenantId: string;
    scope: SalesReportScope;
}

const MANAGEMENT_REPORT_ROLES = new Set([
    'OWNER',
    'ADMIN',
    'SUPER_ADMIN',
    'MANAGER',
    'ACCOUNTANT',
    'VIEWER',
]);

const OPERATIONAL_SHIFT_ROLES = new Set(['CASHIER', 'EMPLOYEE']);

export function resolveSalesReportScope(role: unknown, userId: unknown): SalesReportScope {
    if (typeof userId !== 'string' || !userId.trim()) {
        throw new SalesReportError('REPORT_PRINCIPAL_INVALID', 401, 'La sesión no tiene un usuario válido.');
    }
    if (typeof role !== 'string') {
        throw new SalesReportError('REPORT_ROLE_FORBIDDEN', 403, 'Tu rol no tiene acceso a reportes de ventas.');
    }
    if (MANAGEMENT_REPORT_ROLES.has(role)) return { kind: 'tenant' };
    if (role === 'VENDEDOR') return { kind: 'seller', userId };
    if (OPERATIONAL_SHIFT_ROLES.has(role)) return { kind: 'shift-owner', userId };
    throw new SalesReportError('REPORT_ROLE_FORBIDDEN', 403, 'Tu rol no tiene acceso a reportes de ventas.');
}

export function canReadShiftReport(role: unknown): boolean {
    return typeof role === 'string'
        && (MANAGEMENT_REPORT_ROLES.has(role)
            || role === 'VENDEDOR'
            || OPERATIONAL_SHIFT_ROLES.has(role));
}

export function isManagementReportScope(scope: SalesReportScope): boolean {
    return scope.kind === 'tenant';
}

type DecimalInput = Decimal.Value | { toString(): string } | null | undefined;

function decimal(value: DecimalInput, fallback = '0'): Decimal {
    try {
        const parsed = new Decimal(value == null ? fallback : value.toString());
        return parsed.isFinite() ? parsed : new Decimal(fallback);
    } catch {
        return new Decimal(fallback);
    }
}

function nonNegativeDecimal(value: unknown): Decimal | null {
    const parsed = decimal(value as DecimalInput, 'NaN');
    return parsed.isFinite() && parsed.greaterThanOrEqualTo(0) ? parsed : null;
}

export function moneyText(value: DecimalInput): string {
    return formatReportMoney(decimal(value));
}

export function quantityText(value: DecimalInput): string {
    return formatReportQuantity(decimal(value));
}

export function salesPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
        CASH: 'Efectivo',
        CARD: 'Tarjeta',
        QR: 'Código QR',
        CREDIT: 'Crédito',
        TRANSFER: 'Transferencia',
    };
    return labels[method] ?? method;
}

/** IVA congelado en la venta; solo usa la fórmula legacy cuando falta snapshot. */
export function saleVatFromSnapshot(input: {
    total: DecimalInput;
    exemptTotal?: DecimalInput;
    fiscalRegimeAtSale?: unknown;
    vatAmountAtSale?: DecimalInput;
}): Decimal {
    return calculateHistoricalReportVat({
        total: decimal(input.total),
        exemptTotal: decimal(input.exemptTotal),
        fiscalRegimeAtSale: input.fiscalRegimeAtSale,
        vatAmountAtSale: input.vatAmountAtSale == null
            ? null
            : decimal(input.vatAmountAtSale, 'NaN'),
    });
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null;
}

function text(value: unknown, fallback = ''): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function bool(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return null;
}

export interface ReturnedItemAuthority {
    saleItemId: string;
    productId: string;
    productName: string;
    unit: string;
    usedFallbackUnit?: boolean;
    saleMode: 'COUNTED' | 'MEASURED';
    presentation: 'BASE' | 'PACK';
    presentationQuantityAtSale: string | null;
    soldQuantityAtSale: string;
    costAtSale: string;
    ivaExento: boolean;
}

export interface ParsedReturnedItem {
    saleItemId: string | null;
    productId: string;
    productName: string;
    unit: string;
    usedFallbackUnit: boolean;
    saleMode: 'COUNTED' | 'MEASURED';
    presentation: 'BASE' | 'PACK';
    baseQuantity: string;
    displayQuantity: string;
    lineTotal: string;
    ivaExento: boolean | null;
}

export interface ParsedReturnedItems {
    items: ParsedReturnedItem[];
    invalidItemCount: number;
}

function parseJsonArray(value: unknown): unknown[] | null {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Lee tanto el formato moderno de ProductReturn como el histórico
 * `{productId,name,quantity,price}`. Una línea corrupta se omite y queda
 * contabilizada: el total autoritativo del documento nunca se pierde.
 */
export function parseReturnedItems(
    rawItems: unknown,
    authorities: ReadonlyMap<string, ReturnedItemAuthority> = new Map(),
): ParsedReturnedItems {
    const source = parseJsonArray(rawItems);
    if (!source) return { items: [], invalidItemCount: 1 };
    if (source.length > SALES_REPORT_MAX_ITEMS_PER_RETURN) {
        return { items: [], invalidItemCount: source.length };
    }
    const items: ParsedReturnedItem[] = [];
    let invalidItemCount = 0;

    for (const value of source) {
        const row = asRecord(value);
        if (!row) {
            invalidItemCount++;
            continue;
        }
        const saleItemId = text(row.saleItemId) || null;
        const authority = saleItemId ? authorities.get(saleItemId) : undefined;
        const quantity = nonNegativeDecimal(row.quantity);
        if (!quantity || !quantity.greaterThan(0)) {
            invalidItemCount++;
            continue;
        }

        const price = nonNegativeDecimal(row.refundUnitPrice)
            ?? nonNegativeDecimal(row.priceAtSale)
            ?? nonNegativeDecimal(row.price);
        const persistedLineTotal = nonNegativeDecimal(row.lineTotal);
        const lineTotal = persistedLineTotal ?? (price ? multiplyReportValues(price, quantity) : null);
        if (!lineTotal) {
            invalidItemCount++;
            continue;
        }

        const presentation = authority?.presentation
            ?? (row.presentation === 'PACK' || row.presentationAtSale === 'PACK' ? 'PACK' : 'BASE');
        const soldQuantity = nonNegativeDecimal(
            authority?.soldQuantityAtSale ?? row.soldQuantityAtSale,
        );
        const presentationQuantity = nonNegativeDecimal(
            authority?.presentationQuantityAtSale
                ?? row.presentationQuantityAtSale
                ?? row.presentationQuantity,
        );
        const displayQuantity = presentation === 'PACK'
            && soldQuantity?.greaterThan(0)
            && presentationQuantity
            ? divideReportValues(multiplyReportValues(quantity, presentationQuantity), soldQuantity)
            : quantity;
        const productId = authority?.productId
            ?? text(row.productId, 'legacy-product');
        const productName = authority?.productName
            ?? text(row.productNameAtSale ?? row.name, 'Producto legado');
        const unit = authority?.unit
            ?? text(row.unitAtSale ?? row.unit, 'unidad');
        const usedFallbackUnit = authority
            ? authority.usedFallbackUnit === true
            : !text(row.unitAtSale ?? row.unit);
        const saleMode = authority?.saleMode
            ?? (row.saleModeAtSale === 'COUNTED' ? 'COUNTED' : 'MEASURED');

        items.push({
            saleItemId,
            productId,
            productName,
            unit,
            usedFallbackUnit,
            saleMode,
            presentation,
            baseQuantity: quantityText(quantity),
            displayQuantity: quantityText(displayQuantity),
            lineTotal: lineTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
            ivaExento: authority?.ivaExento ?? bool(row.ivaExento),
        });
    }

    return { items, invalidItemCount };
}

export interface ReturnRecordInput {
    id: string;
    saleId: string;
    createdAt: Date | string;
    total: DecimalInput;
    items: unknown;
    paymentMethod: string;
    fiscalRegimeAtSale?: unknown;
    saleTotal?: DecimalInput;
    saleExemptTotal?: DecimalInput;
    saleVatAmountAtSale?: DecimalInput;
    reason?: string | null;
}

export interface AllocatedReturnLine extends ParsedReturnedItem {
    returnId: string;
    saleId: string;
    allocatedTotal: string;
    returnedVat: string;
    returnedCogs: string;
}

export interface FoldedReturnRecord {
    id: string;
    saleId: string;
    createdAt: string;
    businessDate: string;
    paymentMethod: string;
    total: string;
    vat: string;
    cogs: string;
    reason: string;
    invalidItemCount: number;
    unallocatedTotal: string;
    lines: AllocatedReturnLine[];
}

function businessDateFromInstant(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);
}

export function foldReturnRecords(
    records: readonly ReturnRecordInput[],
    authorities: ReadonlyMap<string, ReturnedItemAuthority> = new Map(),
): FoldedReturnRecord[] {
    let observedReturnLines = 0;
    return records.map((record) => {
        const parsed = parseReturnedItems(record.items, authorities);
        observedReturnLines += parsed.items.length + parsed.invalidItemCount;
        if (observedReturnLines > SALES_REPORT_MAX_RETURN_LINES_TOTAL) {
            throw new SalesReportError(
                'REPORT_RETURN_LINE_LIMIT_EXCEEDED',
                422,
                `El período supera ${SALES_REPORT_MAX_RETURN_LINES_TOTAL} líneas devueltas. Reducí el rango.`,
            );
        }
        const saleVat = saleVatFromSnapshot({
            total: record.saleTotal,
            exemptTotal: record.saleExemptTotal,
            fiscalRegimeAtSale: record.fiscalRegimeAtSale,
            vatAmountAtSale: record.saleVatAmountAtSale,
        });
        const allocatedMoney = allocateReturnMoney({
            total: decimal(record.total),
            saleTotal: decimal(record.saleTotal),
            saleVat,
            fiscalRegimeAtSale: record.fiscalRegimeAtSale,
            fullyAllocateTotal: parsed.invalidItemCount === 0,
            lines: parsed.items.map((item) => {
                const authority = item.saleItemId ? authorities.get(item.saleItemId) : undefined;
                return {
                    lineTotal: item.lineTotal,
                    baseQuantity: item.baseQuantity,
                    costAtSale: authority?.costAtSale ?? null,
                    ivaExento: item.ivaExento,
                };
            }),
        });

        const lines = parsed.items.map((item, index): AllocatedReturnLine => {
            const money = allocatedMoney.lines[index];

            return {
                ...item,
                returnId: record.id,
                saleId: record.saleId,
                allocatedTotal: money.allocatedTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
                returnedVat: money.returnedVat.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
                returnedCogs: money.returnedCogs.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
            };
        });
        const lineVat = sumReportValues(lines.map((item) => item.returnedVat));

        return {
            id: record.id,
            saleId: record.saleId,
            createdAt: record.createdAt instanceof Date
                ? record.createdAt.toISOString()
                : new Date(record.createdAt).toISOString(),
            businessDate: businessDateFromInstant(record.createdAt),
            paymentMethod: text(record.paymentMethod, 'UNKNOWN'),
            total: moneyText(allocatedMoney.total),
            vat: moneyText(sumReportValues([lineVat, allocatedMoney.unallocatedVat])),
            cogs: moneyText(sumReportValues(lines.map((item) => item.returnedCogs))),
            reason: text(record.reason, ''),
            invalidItemCount: parsed.invalidItemCount,
            unallocatedTotal: moneyText(allocatedMoney.unallocatedTotal),
            lines,
        };
    }).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export interface SalesAggregateInput {
    grossSales: DecimalInput;
    grossVat: DecimalInput;
    transactionCount: number | bigint | string;
    productGrossSales: DecimalInput;
    grossCogs: DecimalInput;
    discountTotal: DecimalInput;
    itemQuantityGross: DecimalInput;
}

export interface SalesPaymentAggregateInput {
    method: string;
    transactionCount: number | bigint | string;
    grossSales: DecimalInput;
}

export interface SalesProductAggregateInput {
    productId: string;
    productName: string;
    saleMode: string;
    presentation: string;
    baseUnit: string;
    displayUnit: string;
    usedFallbackUnit?: boolean;
    quantityGross: DecimalInput;
    baseQuantityGross: DecimalInput;
    grossSales: DecimalInput;
    grossVat?: DecimalInput;
    cogs: DecimalInput;
}

export interface SalesDailyAggregateInput {
    date: string;
    grossSales: DecimalInput;
    grossVat: DecimalInput;
    transactionCount: number | bigint | string;
}

export interface ExpenseDailyAggregateInput {
    date: string;
    expenses: DecimalInput;
}

export interface SalesReportSummary {
    grossSales: string;
    returnsTotal: string;
    netSales: string;
    vatCollected: string;
    netRevenue: string;
    cogs: string;
    grossProfit: string;
    transactionCount: number;
    returnCount: number;
    averageTicket: string;
    discountTotal: string;
    itemQuantityGross: string;
    itemQuantityReturned: string;
    itemQuantityNet: string;
    roundingAdjustment: string;
}

export interface SalesReportPaymentMethod {
    method: string;
    label: string;
    transactionCount: number;
    returnCount: number;
    grossSales: string;
    returnsTotal: string;
    netSales: string;
    /** ProductReturn no persiste refundMethod; se atribuye al método de la venta original. */
    returnsAttribution: 'ORIGINAL_SALE_METHOD';
}

export interface SalesReportProduct {
    productId: string;
    productName: string;
    saleMode: 'COUNTED' | 'MEASURED';
    presentation: 'BASE' | 'PACK';
    baseUnit: string;
    unit: string;
    displayUnit: string;
    usedFallbackUnit: boolean;
    quantityGross: string;
    quantitySold: string;
    quantityReturned: string;
    quantityNet: string;
    grossSales: string;
    returnsTotal: string;
    netSales: string;
    vatCollected: string;
    cogs: string;
    grossProfit: string;
}

export interface SalesReportBucket {
    date: string;
    grossSales: string;
    returnsTotal: string;
    netSales: string;
    vatCollected: string;
    transactionCount: number;
    returnCount: number;
    expenses: string;
}

export interface SalesReportMonthlyBucket extends Omit<SalesReportBucket, 'date'> {
    month: string;
}

export interface SalesReportData {
    business: {
        name: string;
        taxId: string;
        address: string;
        phone: string;
    };
    period: {
        startDate: string;
        endDate: string;
        start: string;
        endExclusive: string;
        timeZone: 'America/Managua';
        days: number;
    };
    summary: SalesReportSummary;
    paymentMethods: SalesReportPaymentMethod[];
    products: SalesReportProduct[];
    daily: SalesReportBucket[];
    monthly: SalesReportMonthlyBucket[];
    returns: FoldedReturnRecord[];
    totalVentas: number;
    ventasNetas: number;
    ivaRecaudado: number;
    totalCOGS: number;
    utilidadBruta: number;
    totalTransacciones: number;
    chartData: { name: string; ventas: number; gastos: number }[];
    quantityBreakdown: {
        productId: string;
        productName: string;
        saleMode: 'COUNTED' | 'MEASURED';
        presentation: 'BASE' | 'PACK';
        baseUnit: string;
        displayUnit: string;
        usedFallbackUnit: boolean;
        quantity: string;
    }[];
}

export interface FoldSalesReportInput {
    range: SalesReportRange;
    sales: SalesAggregateInput;
    paymentRows: readonly SalesPaymentAggregateInput[];
    productRows: readonly SalesProductAggregateInput[];
    dailyRows: readonly SalesDailyAggregateInput[];
    expenseRows: readonly ExpenseDailyAggregateInput[];
    returnRecords: readonly ReturnRecordInput[];
    returnedItemAuthorities?: ReadonlyMap<string, ReturnedItemAuthority>;
    business?: Partial<SalesReportData['business']>;
}

function integer(value: number | bigint | string): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function productKey(value: {
    productId: string;
    productName: string;
    saleMode: string;
    presentation: string;
    baseUnit: string;
    displayUnit: string;
}): string {
    return [
        value.productId,
        value.productName,
        value.saleMode,
        value.presentation,
        value.baseUnit,
        value.displayUnit,
    ].join('\u001f');
}

function shortDateLabel(date: string): string {
    const [, month, day] = date.split('-');
    const labels = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${day} ${labels[Number(month) - 1] ?? month}`;
}

export function foldSalesReportData(input: FoldSalesReportInput): SalesReportData {
    const returns = foldReturnRecords(input.returnRecords, input.returnedItemAuthorities);
    const transactionCount = integer(input.sales.transactionCount);
    const returnsTotal = sumReportValues(returns.map((row) => row.total));
    const returnedVat = sumReportValues(returns.map((row) => row.vat));
    const returnedCogs = sumReportValues(returns.map((row) => row.cogs));
    const itemQuantityReturned = sumReportValues(
        returns.flatMap((row) => row.lines.map((line) => line.baseQuantity)),
    );
    const allocatedReturnTotal = sumReportValues(
        returns.flatMap((row) => row.lines.map((line) => line.allocatedTotal)),
    );
    const totals = calculateReportTotals({
        grossSales: decimal(input.sales.grossSales),
        returnsTotal,
        grossVat: decimal(input.sales.grossVat),
        returnedVat,
        grossCogs: decimal(input.sales.grossCogs),
        returnedCogs,
        transactionCount,
        quantityGross: decimal(input.sales.itemQuantityGross),
        quantityReturned: itemQuantityReturned,
        productGrossSales: decimal(input.sales.productGrossSales),
        allocatedReturnTotal,
    });

    const paymentGroups = new Map<string, {
        transactionCount: number;
        returnCount: number;
        grossSales: Decimal;
        returnsTotal: Decimal;
    }>();
    for (const row of input.paymentRows) {
        const method = text(row.method, 'UNKNOWN');
        const group = paymentGroups.get(method) ?? {
            transactionCount: 0,
            returnCount: 0,
            grossSales: new Decimal(0),
            returnsTotal: new Decimal(0),
        };
        group.transactionCount += integer(row.transactionCount);
        group.grossSales = sumReportValues([group.grossSales, row.grossSales?.toString() ?? '0']);
        paymentGroups.set(method, group);
    }
    for (const row of returns) {
        const group = paymentGroups.get(row.paymentMethod) ?? {
            transactionCount: 0,
            returnCount: 0,
            grossSales: new Decimal(0),
            returnsTotal: new Decimal(0),
        };
        group.returnCount++;
        group.returnsTotal = sumReportValues([group.returnsTotal, row.total]);
        paymentGroups.set(row.paymentMethod, group);
    }
    const paymentMethods = [...paymentGroups]
        .map(([method, group]) => ({
            method,
            label: salesPaymentMethodLabel(method),
            transactionCount: group.transactionCount,
            returnCount: group.returnCount,
            grossSales: moneyText(group.grossSales),
            returnsTotal: moneyText(group.returnsTotal),
            netSales: moneyText(netReportValue(group.grossSales, group.returnsTotal)),
            returnsAttribution: 'ORIGINAL_SALE_METHOD' as const,
        }))
        .sort((left, right) => left.method.localeCompare(right.method));

    const productGroups = new Map<string, {
        productId: string;
        productName: string;
        saleMode: 'COUNTED' | 'MEASURED';
        presentation: 'BASE' | 'PACK';
        baseUnit: string;
        displayUnit: string;
        usedFallbackUnit: boolean;
        quantityGross: Decimal;
        quantityReturned: Decimal;
        grossSales: Decimal;
        returnsTotal: Decimal;
        grossVat: Decimal;
        returnedVat: Decimal;
        grossCogs: Decimal;
        returnedCogs: Decimal;
    }>();
    const ensureProduct = (value: {
        productId: string;
        productName: string;
        saleMode: string;
        presentation: string;
        baseUnit: string;
        displayUnit: string;
        usedFallbackUnit?: boolean;
    }) => {
        const normalized = {
            productId: value.productId || 'legacy-product',
            productName: value.productName || 'Producto legado',
            saleMode: value.saleMode === 'COUNTED' ? 'COUNTED' as const : 'MEASURED' as const,
            presentation: value.presentation === 'PACK' ? 'PACK' as const : 'BASE' as const,
            baseUnit: value.baseUnit || 'unidad',
            displayUnit: value.displayUnit || value.baseUnit || 'unidad',
            usedFallbackUnit: value.usedFallbackUnit === true,
        };
        const key = productKey(normalized);
        const existing = productGroups.get(key);
        if (existing) return existing;
        const created = {
            ...normalized,
            quantityGross: new Decimal(0),
            quantityReturned: new Decimal(0),
            grossSales: new Decimal(0),
            returnsTotal: new Decimal(0),
            grossVat: new Decimal(0),
            returnedVat: new Decimal(0),
            grossCogs: new Decimal(0),
            returnedCogs: new Decimal(0),
        };
        productGroups.set(key, created);
        return created;
    };

    for (const row of input.productRows) {
        const group = ensureProduct(row);
        group.quantityGross = sumReportValues([group.quantityGross, row.quantityGross?.toString() ?? '0']);
        group.grossSales = sumReportValues([group.grossSales, row.grossSales?.toString() ?? '0']);
        group.grossVat = sumReportValues([group.grossVat, row.grossVat?.toString() ?? '0']);
        group.grossCogs = sumReportValues([group.grossCogs, row.cogs?.toString() ?? '0']);
    }
    for (const returned of returns) {
        for (const line of returned.lines) {
            const displayUnit = line.presentation === 'PACK'
                ? `empaque(s) · base ${line.unit}`
                : line.usedFallbackUnit
                    ? `${line.unit} (fallback)`
                    : line.unit;
            const group = ensureProduct({
                productId: line.productId,
                productName: line.productName,
                saleMode: line.saleMode,
                presentation: line.presentation,
                baseUnit: line.unit,
                displayUnit,
                usedFallbackUnit: line.usedFallbackUnit,
            });
            group.quantityReturned = sumReportValues([group.quantityReturned, line.displayQuantity]);
            group.returnsTotal = sumReportValues([group.returnsTotal, line.allocatedTotal]);
            group.returnedVat = sumReportValues([group.returnedVat, line.returnedVat]);
            group.returnedCogs = sumReportValues([group.returnedCogs, line.returnedCogs]);
        }
    }
    const products = [...productGroups.values()]
        .map((group): SalesReportProduct => {
            const productTotals = calculateProductReportTotals({
                quantityGross: group.quantityGross,
                quantityReturned: group.quantityReturned,
                grossSales: group.grossSales,
                returnsTotal: group.returnsTotal,
                grossVat: group.grossVat,
                returnedVat: group.returnedVat,
                grossCogs: group.grossCogs,
                returnedCogs: group.returnedCogs,
            });
            return {
                productId: group.productId,
                productName: group.productName,
                saleMode: group.saleMode,
                presentation: group.presentation,
                baseUnit: group.baseUnit,
                unit: group.baseUnit,
                displayUnit: group.displayUnit,
                usedFallbackUnit: group.usedFallbackUnit,
                quantityGross: quantityText(group.quantityGross),
                quantitySold: quantityText(group.quantityGross),
                quantityReturned: quantityText(group.quantityReturned),
                quantityNet: quantityText(productTotals.quantityNet),
                grossSales: moneyText(group.grossSales),
                returnsTotal: moneyText(group.returnsTotal),
                netSales: moneyText(productTotals.netSales),
                vatCollected: moneyText(productTotals.netVat),
                cogs: moneyText(productTotals.netCogs),
                grossProfit: moneyText(productTotals.grossProfit),
            };
        })
        .sort((left, right) => left.productName.localeCompare(right.productName, 'es')
            || left.displayUnit.localeCompare(right.displayUnit, 'es')
            || left.presentation.localeCompare(right.presentation));

    const dailyGroups = new Map<string, {
        grossSales: Decimal;
        returnsTotal: Decimal;
        grossVat: Decimal;
        returnedVat: Decimal;
        transactionCount: number;
        returnCount: number;
        expenses: Decimal;
    }>();
    const ensureDay = (date: string) => {
        const existing = dailyGroups.get(date);
        if (existing) return existing;
        const created = {
            grossSales: new Decimal(0),
            returnsTotal: new Decimal(0),
            grossVat: new Decimal(0),
            returnedVat: new Decimal(0),
            transactionCount: 0,
            returnCount: 0,
            expenses: new Decimal(0),
        };
        dailyGroups.set(date, created);
        return created;
    };
    for (const row of input.dailyRows) {
        if (civilDateOrdinal(row.date) === null) continue;
        const group = ensureDay(row.date);
        group.grossSales = sumReportValues([group.grossSales, row.grossSales?.toString() ?? '0']);
        group.grossVat = sumReportValues([group.grossVat, row.grossVat?.toString() ?? '0']);
        group.transactionCount += integer(row.transactionCount);
    }
    for (const row of returns) {
        if (civilDateOrdinal(row.businessDate) === null) continue;
        const group = ensureDay(row.businessDate);
        group.returnsTotal = sumReportValues([group.returnsTotal, row.total]);
        group.returnedVat = sumReportValues([group.returnedVat, row.vat]);
        group.returnCount++;
    }
    for (const row of input.expenseRows) {
        if (civilDateOrdinal(row.date) === null) continue;
        ensureDay(row.date).expenses = sumReportValues([
            ensureDay(row.date).expenses,
            row.expenses?.toString() ?? '0',
        ]);
    }
    const daily = [...dailyGroups]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, group]): SalesReportBucket => ({
            date,
            grossSales: moneyText(group.grossSales),
            returnsTotal: moneyText(group.returnsTotal),
            netSales: moneyText(netReportValue(group.grossSales, group.returnsTotal)),
            vatCollected: moneyText(netReportValue(group.grossVat, group.returnedVat)),
            transactionCount: group.transactionCount,
            returnCount: group.returnCount,
            expenses: moneyText(group.expenses),
        }));

    const monthGroups = new Map<string, Omit<SalesReportBucket, 'date'>>();
    for (const row of daily) {
        const month = row.date.slice(0, 7);
        const existing = monthGroups.get(month) ?? {
            grossSales: '0',
            returnsTotal: '0',
            netSales: '0',
            vatCollected: '0',
            transactionCount: 0,
            returnCount: 0,
            expenses: '0',
        };
        monthGroups.set(month, {
            grossSales: moneyText(sumReportValues([existing.grossSales, row.grossSales])),
            returnsTotal: moneyText(sumReportValues([existing.returnsTotal, row.returnsTotal])),
            netSales: moneyText(sumReportValues([existing.netSales, row.netSales])),
            vatCollected: moneyText(sumReportValues([existing.vatCollected, row.vatCollected])),
            transactionCount: existing.transactionCount + row.transactionCount,
            returnCount: existing.returnCount + row.returnCount,
            expenses: moneyText(sumReportValues([existing.expenses, row.expenses])),
        });
    }
    const monthly = [...monthGroups]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, row]) => ({ month, ...row }));

    const summary: SalesReportSummary = {
        grossSales: moneyText(totals.grossSales),
        returnsTotal: moneyText(totals.returnsTotal),
        netSales: moneyText(totals.netSales),
        vatCollected: moneyText(totals.vatCollected),
        netRevenue: moneyText(totals.netRevenue),
        cogs: moneyText(totals.cogs),
        grossProfit: moneyText(totals.grossProfit),
        transactionCount,
        returnCount: returns.length,
        averageTicket: moneyText(totals.averageTicket),
        discountTotal: moneyText(input.sales.discountTotal),
        itemQuantityGross: quantityText(input.sales.itemQuantityGross),
        itemQuantityReturned: quantityText(itemQuantityReturned),
        itemQuantityNet: quantityText(totals.quantityNet),
        roundingAdjustment: moneyText(totals.roundingAdjustment),
    };

    return {
        business: {
            name: input.business?.name || 'Nortex',
            taxId: input.business?.taxId || '',
            address: input.business?.address || '',
            phone: input.business?.phone || '',
        },
        period: {
            startDate: input.range.startDate,
            endDate: input.range.endDate,
            start: input.range.start.toISOString(),
            endExclusive: input.range.endExclusive.toISOString(),
            timeZone: 'America/Managua',
            days: input.range.days,
        },
        summary,
        paymentMethods,
        products,
        daily,
        monthly,
        returns,
        // Compatibilidad con el dashboard histórico. Los cálculos se mantienen
        // en Decimal y solo se convierten en el borde JSON que consume Recharts.
        totalVentas: new Decimal(summary.grossSales).toNumber(),
        ventasNetas: new Decimal(summary.netRevenue).toNumber(),
        ivaRecaudado: new Decimal(summary.vatCollected).toNumber(),
        totalCOGS: new Decimal(summary.cogs).toNumber(),
        utilidadBruta: new Decimal(summary.grossProfit).toNumber(),
        totalTransacciones: summary.transactionCount,
        chartData: daily.map((row) => ({
            name: shortDateLabel(row.date),
            ventas: new Decimal(row.netSales).toNumber(),
            gastos: new Decimal(row.expenses).toNumber(),
        })),
        quantityBreakdown: products.map((row) => ({
            productId: row.productId,
            productName: row.productName,
            saleMode: row.saleMode,
            presentation: row.presentation,
            baseUnit: row.baseUnit,
            displayUnit: row.displayUnit,
            usedFallbackUnit: row.usedFallbackUnit,
            quantity: row.quantityGross,
        })),
    };
}

function validString(value: unknown, max = 1_000): value is string {
    return typeof value === 'string' && value.length <= max;
}

function validDecimalString(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 64) return false;
    const parsed = decimal(value, 'NaN');
    return parsed.isFinite();
}

function validCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Valida el JSON inmutable antes de mostrarlo; el HTML además escapa cada texto. */
export function parseShiftCloseReportPayload(value: unknown): ShiftCloseReportPayload | null {
    const report = asRecord(value);
    if (!report || report.version !== 1) return null;
    if (!validString(report.folio, 191) || civilDateOrdinal(report.businessDate as string) === null) return null;
    if (report.timeZone !== 'America/Managua' || !validString(report.generatedAt, 64)) return null;
    if (Number.isNaN(new Date(report.generatedAt).getTime())) return null;

    const business = asRecord(report.business);
    const shift = asRecord(report.shift);
    const summary = asRecord(report.summary);
    const cash = asRecord(report.cash);
    if (!business || !shift || !summary || !cash) return null;
    if (
        !validString(business.name)
        || !validString(business.taxId)
        || !(business.address === null || validString(business.address, 5_000))
        || !(business.phone === null || validString(business.phone))
    ) return null;
    if (
        !validString(shift.id, 191)
        || !validString(shift.openedAt, 64)
        || !validString(shift.closedAt, 64)
        || !validString(shift.openedBy)
        || !validString(shift.cashierName)
        || !validString(shift.closedBy)
        || !(shift.auditNotes === null || validString(shift.auditNotes, 5_000))
    ) return null;
    if (Number.isNaN(new Date(shift.openedAt).getTime()) || Number.isNaN(new Date(shift.closedAt).getTime())) return null;

    const summaryMoney = [
        'grossSales', 'returnsTotal', 'netSales', 'vatCollected', 'netRevenue',
        'cogs', 'grossProfit', 'averageTicket', 'discountTotal',
        'itemQuantityGross', 'itemQuantityReturned', 'itemQuantityNet', 'roundingAdjustment',
    ];
    if (summaryMoney.some((key) => !validDecimalString(summary[key]))) return null;
    if (!validCount(summary.transactionCount) || !validCount(summary.returnCount)) return null;

    const cashMoney = [
        'openingNio', 'cashSalesNio', 'cashRefundsNio', 'paidInNio', 'paidOutNio',
        'expectedNio', 'countedNio', 'differenceNio', 'openingUsd', 'paidInUsd',
        'paidOutUsd', 'expectedUsd', 'countedUsd', 'differenceUsd',
    ];
    if (cashMoney.some((key) => !validDecimalString(cash[key]))) return null;

    if (!Array.isArray(report.paymentMethods) || report.paymentMethods.length > 100) return null;
    for (const value of report.paymentMethods) {
        const row = asRecord(value);
        if (!row || !validString(row.method, 64) || !validString(row.label, 128)
            || !validCount(row.transactionCount) || !validDecimalString(row.grossSales)) return null;
    }
    if (!Array.isArray(report.products) || report.products.length > 10_000) return null;
    const productMoney = [
        'quantitySold', 'quantityReturned', 'quantityNet', 'grossSales',
        'returnsTotal', 'netSales', 'vatCollected', 'cogs', 'grossProfit',
    ];
    for (const value of report.products) {
        const row = asRecord(value);
        if (!row || !validString(row.productId, 191) || !validString(row.productName)
            || !validString(row.unit, 128) || !validString(row.saleMode, 32)
            || !validString(row.presentation, 32) || !validString(row.displayUnit, 256)
            || productMoney.some((key) => !validDecimalString(row[key]))) return null;
    }
    if (!Array.isArray(report.movementBreakdown) || report.movementBreakdown.length > 1_000) return null;
    for (const value of report.movementBreakdown) {
        const row = asRecord(value);
        if (!row || !validString(row.type, 32) || !validString(row.currency, 16)
            || !validString(row.category, 128) || !validCount(row.count)
            || !validDecimalString(row.amount)) return null;
    }

    return value as ShiftCloseReportPayload;
}
