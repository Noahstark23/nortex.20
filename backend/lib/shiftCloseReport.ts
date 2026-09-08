import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import {
    calculateProductReportTotals,
    calculateReportTotals,
    formatReportMoney,
    formatReportQuantity,
    sumReportValues,
} from './reportMoney.js';

export const SHIFT_CLOSE_REPORT_VERSION = 1 as const;
export const MANAGUA_TIME_ZONE = 'America/Managua' as const;

export interface ShiftClosePaymentInput {
    method: string;
    transactionCount: number;
    grossSales: Decimal.Value;
}

export interface ShiftCloseProductInput {
    productId: string;
    productName: string;
    unit: string;
    saleMode: string;
    presentation: string;
    displayUnit?: string;
    quantity: Decimal.Value;
    amount: Decimal.Value;
    cogs: Decimal.Value;
    vat?: Decimal.Value;
}

export interface ShiftCloseMovementInput {
    type: string;
    currency: string;
    category: string;
    count: number;
    amount: Decimal.Value;
}

export interface BuildShiftCloseReportInput {
    folio: string;
    businessDate: string;
    generatedAt: Date;
    business: {
        name: string;
        taxId: string;
        address: string | null;
        phone: string | null;
    };
    shift: {
        id: string;
        openedAt: Date;
        closedAt: Date;
        openedBy: string;
        cashierName: string;
        closedBy: string;
        auditNotes: string | null;
    };
    payments: readonly ShiftClosePaymentInput[];
    soldProducts: readonly ShiftCloseProductInput[];
    returnedProducts: readonly ShiftCloseProductInput[];
    returns: {
        count: number;
        total: Decimal.Value;
        vat: Decimal.Value;
        cogs: Decimal.Value;
    };
    fiscal: {
        vatCollectedBeforeReturns: Decimal.Value;
        discountTotal: Decimal.Value;
    };
    cash: {
        openingNio: Decimal.Value;
        expectedNio: Decimal.Value;
        countedNio: Decimal.Value;
        differenceNio: Decimal.Value;
        openingUsd: Decimal.Value;
        expectedUsd: Decimal.Value;
        countedUsd: Decimal.Value;
        differenceUsd: Decimal.Value;
        cashRefundsNio: Decimal.Value;
    };
    movements: readonly ShiftCloseMovementInput[];
}

const money = formatReportMoney;
const quantity = formatReportQuantity;
const moneyUsd = (value: Decimal.Value) => new Decimal(value).toFixed(4, Decimal.ROUND_HALF_UP);

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

function productKey(product: ShiftCloseProductInput): string {
    return [
        product.productId,
        product.productName,
        product.unit,
        product.saleMode,
        product.presentation,
        product.displayUnit ?? product.unit,
    ].join('\u001f');
}

function mergeProducts(
    soldProducts: readonly ShiftCloseProductInput[],
    returnedProducts: readonly ShiftCloseProductInput[],
) {
    const groups = new Map<string, {
        productId: string;
        productName: string;
        unit: string;
        saleMode: string;
        presentation: string;
        displayUnit: string;
        quantitySold: Decimal;
        quantityReturned: Decimal;
        grossSales: Decimal;
        returnsTotal: Decimal;
        soldCogs: Decimal;
        returnedCogs: Decimal;
        soldVat: Decimal;
        returnedVat: Decimal;
    }>();

    const ensure = (product: ShiftCloseProductInput) => {
        const key = productKey(product);
        const existing = groups.get(key);
        if (existing) return existing;
        const created = {
            productId: product.productId,
            productName: product.productName,
            unit: product.unit,
            saleMode: product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
            presentation: product.presentation === 'PACK' ? 'PACK' : 'BASE',
            displayUnit: product.displayUnit || product.unit || 'unidad',
            quantitySold: new Decimal(0),
            quantityReturned: new Decimal(0),
            grossSales: new Decimal(0),
            returnsTotal: new Decimal(0),
            soldCogs: new Decimal(0),
            returnedCogs: new Decimal(0),
            soldVat: new Decimal(0),
            returnedVat: new Decimal(0),
        };
        groups.set(key, created);
        return created;
    };

    for (const product of soldProducts) {
        const group = ensure(product);
        group.quantitySold = sumReportValues([group.quantitySold, product.quantity]);
        group.grossSales = sumReportValues([group.grossSales, product.amount]);
        group.soldCogs = sumReportValues([group.soldCogs, product.cogs]);
        group.soldVat = sumReportValues([group.soldVat, product.vat ?? 0]);
    }
    for (const product of returnedProducts) {
        const group = ensure(product);
        group.quantityReturned = sumReportValues([group.quantityReturned, product.quantity]);
        group.returnsTotal = sumReportValues([group.returnsTotal, product.amount]);
        group.returnedCogs = sumReportValues([group.returnedCogs, product.cogs]);
        group.returnedVat = sumReportValues([group.returnedVat, product.vat ?? 0]);
    }

    return [...groups.values()]
        .map((group) => {
            const totals = calculateProductReportTotals({
                quantityGross: group.quantitySold,
                quantityReturned: group.quantityReturned,
                grossSales: group.grossSales,
                returnsTotal: group.returnsTotal,
                grossVat: group.soldVat,
                returnedVat: group.returnedVat,
                grossCogs: group.soldCogs,
                returnedCogs: group.returnedCogs,
            });
            return {
                productId: group.productId,
                productName: group.productName,
                unit: group.unit,
                saleMode: group.saleMode,
                presentation: group.presentation,
                displayUnit: group.displayUnit,
                quantitySold: quantity(group.quantitySold),
                quantityReturned: quantity(group.quantityReturned),
                quantityNet: quantity(totals.quantityNet),
                grossSales: money(group.grossSales),
                returnsTotal: money(group.returnsTotal),
                netSales: money(totals.netSales),
                vatCollected: money(totals.netVat),
                cogs: money(totals.netCogs),
                grossProfit: money(totals.grossProfit),
            };
        })
        .sort((left, right) => left.productName.localeCompare(right.productName, 'es')
            || left.displayUnit.localeCompare(right.displayUnit, 'es'));
}

export function buildShiftCloseReport(input: BuildShiftCloseReportInput) {
    const payments = input.payments
        .map((payment) => ({
            method: payment.method,
            label: salesPaymentMethodLabel(payment.method),
            transactionCount: payment.transactionCount,
            grossSales: money(payment.grossSales),
        }))
        .sort((left, right) => left.method.localeCompare(right.method));
    const grossSales = sumReportValues(input.payments.map((payment) => payment.grossSales));
    const transactionCount = input.payments.reduce(
        (sum, payment) => sum + payment.transactionCount,
        0,
    );
    const returnsTotal = new Decimal(input.returns.total);
    const soldCogs = sumReportValues(input.soldProducts.map((product) => product.cogs));
    const quantitySold = sumReportValues(input.soldProducts.map((product) => product.quantity));
    const quantityReturned = sumReportValues(input.returnedProducts.map((product) => product.quantity));
    const cashSales = sumReportValues(input.payments
        .filter((payment) => payment.method === 'CASH')
        .map((payment) => payment.grossSales));

    const movementBreakdown = input.movements
        .map((movement) => ({
            type: movement.type,
            currency: movement.currency || 'NIO',
            category: movement.category || 'SIN_CATEGORIA',
            count: movement.count,
            amount: movement.currency === 'USD' ? moneyUsd(movement.amount) : money(movement.amount),
        }))
        .sort((left, right) => left.currency.localeCompare(right.currency)
            || left.type.localeCompare(right.type)
            || left.category.localeCompare(right.category));

    const movementTotal = (
        currency: string,
        type: string,
        options: { excludeCashRefunds?: boolean } = {},
    ) => input.movements
        .filter((movement) => (movement.currency || 'NIO') === currency
            && movement.type === type
            && (!options.excludeCashRefunds || movement.category !== 'DEVOLUCION'))
        .map((movement) => movement.amount);

    const products = mergeProducts(input.soldProducts, input.returnedProducts);
    const productSalesTotal = sumReportValues(products.map((product) => product.grossSales));
    const totals = calculateReportTotals({
        grossSales,
        returnsTotal,
        grossVat: input.fiscal.vatCollectedBeforeReturns,
        returnedVat: input.returns.vat,
        grossCogs: soldCogs,
        returnedCogs: input.returns.cogs,
        transactionCount,
        quantityGross: quantitySold,
        quantityReturned,
        productGrossSales: productSalesTotal,
        allocatedReturnTotal: returnsTotal,
    });

    return {
        version: SHIFT_CLOSE_REPORT_VERSION,
        folio: input.folio,
        businessDate: input.businessDate,
        timeZone: MANAGUA_TIME_ZONE,
        generatedAt: input.generatedAt.toISOString(),
        business: { ...input.business },
        shift: {
            id: input.shift.id,
            openedAt: input.shift.openedAt.toISOString(),
            closedAt: input.shift.closedAt.toISOString(),
            openedBy: input.shift.openedBy,
            cashierName: input.shift.cashierName,
            closedBy: input.shift.closedBy,
            auditNotes: input.shift.auditNotes?.trim() || null,
        },
        summary: {
            grossSales: money(totals.grossSales),
            returnsTotal: money(totals.returnsTotal),
            netSales: money(totals.netSales),
            vatCollected: money(totals.vatCollected),
            netRevenue: money(totals.netRevenue),
            cogs: money(totals.cogs),
            grossProfit: money(totals.grossProfit),
            transactionCount,
            returnCount: input.returns.count,
            averageTicket: money(totals.averageTicket),
            discountTotal: money(input.fiscal.discountTotal),
            itemQuantityGross: quantity(quantitySold),
            itemQuantityReturned: quantity(quantityReturned),
            itemQuantityNet: quantity(totals.quantityNet),
            roundingAdjustment: money(totals.roundingAdjustment),
        },
        paymentMethods: payments,
        products,
        cash: {
            openingNio: money(input.cash.openingNio),
            cashSalesNio: money(cashSales),
            cashRefundsNio: money(input.cash.cashRefundsNio),
            paidInNio: money(sumReportValues(movementTotal('NIO', 'IN'))),
            // Los reembolsos tienen su propia columna. Excluirlos de "Salidas"
            // evita que el arqueo visual los reste dos veces; siguen completos
            // en movementBreakdown y dentro del efectivo esperado autoritativo.
            paidOutNio: money(sumReportValues(movementTotal('NIO', 'OUT', { excludeCashRefunds: true }))),
            expectedNio: money(input.cash.expectedNio),
            countedNio: money(input.cash.countedNio),
            differenceNio: money(input.cash.differenceNio),
            openingUsd: moneyUsd(input.cash.openingUsd),
            paidInUsd: moneyUsd(sumReportValues(movementTotal('USD', 'IN'))),
            paidOutUsd: moneyUsd(sumReportValues(movementTotal('USD', 'OUT'))),
            expectedUsd: moneyUsd(input.cash.expectedUsd),
            countedUsd: moneyUsd(input.cash.countedUsd),
            differenceUsd: moneyUsd(input.cash.differenceUsd),
        },
        movementBreakdown,
    };
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, canonicalize(child)]),
        );
    }
    return value;
}

export function canonicalShiftCloseReportJson(report: unknown): string {
    return JSON.stringify(canonicalize(report));
}

export function hashShiftCloseReport(report: unknown): string {
    return createHash('sha256').update(canonicalShiftCloseReportJson(report)).digest('hex');
}

export type ShiftCloseReportPayload = ReturnType<typeof buildShiftCloseReport>;
