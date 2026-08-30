import Decimal from 'decimal.js';

export type ReportDecimalValue = Decimal.Value | { toString(): string };

function value(input: ReportDecimalValue): Decimal {
    return new Decimal(input.toString());
}

export function formatReportMoney(input: ReportDecimalValue): string {
    return value(input).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function formatReportQuantity(input: ReportDecimalValue): string {
    return value(input).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
}

export function sumReportValues(inputs: readonly ReportDecimalValue[]): Decimal {
    return inputs.reduce<Decimal>((sum, input) => sum.plus(value(input)), new Decimal(0));
}

export function netReportValue(
    gross: ReportDecimalValue,
    reduction: ReportDecimalValue,
): Decimal {
    return value(gross).minus(value(reduction));
}

export function multiplyReportValues(
    left: ReportDecimalValue,
    right: ReportDecimalValue,
): Decimal {
    return value(left).mul(value(right));
}

export function divideReportValues(
    dividend: ReportDecimalValue,
    divisor: ReportDecimalValue,
): Decimal {
    return value(dividend).dividedBy(value(divisor));
}

export interface HistoricalReportVatInput {
    total: ReportDecimalValue;
    exemptTotal?: ReportDecimalValue | null;
    fiscalRegimeAtSale?: unknown;
    vatAmountAtSale?: ReportDecimalValue | null;
}

/** Regla tolerante para reportar snapshots históricos sin reinterpretar CUOTA_FIJA. */
export function calculateHistoricalReportVat(input: HistoricalReportVatInput): Decimal {
    const total = Decimal.max(value(input.total), 0);
    if (input.fiscalRegimeAtSale === 'CUOTA_FIJA') return new Decimal(0);
    const exempt = Decimal.min(
        Decimal.max(input.exemptTotal == null ? 0 : value(input.exemptTotal), 0),
        total,
    );
    const taxable = total.minus(exempt);
    if (input.vatAmountAtSale != null) {
        const snapshot = value(input.vatAmountAtSale);
        if (snapshot.isFinite() && snapshot.greaterThanOrEqualTo(0) && snapshot.lessThanOrEqualTo(taxable)) {
            return snapshot.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        }
    }
    const net = taxable.dividedBy('1.15').toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    return taxable.minus(net).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function calculateReportProfit(
    netSales: ReportDecimalValue,
    netVat: ReportDecimalValue,
    netCogs: ReportDecimalValue,
): Decimal {
    return value(netSales).minus(value(netVat)).minus(value(netCogs));
}

export interface ReportTotalsInput {
    grossSales: ReportDecimalValue;
    returnsTotal: ReportDecimalValue;
    grossVat: ReportDecimalValue;
    returnedVat: ReportDecimalValue;
    grossCogs: ReportDecimalValue;
    returnedCogs: ReportDecimalValue;
    transactionCount: number;
    quantityGross: ReportDecimalValue;
    quantityReturned: ReportDecimalValue;
    productGrossSales: ReportDecimalValue;
    allocatedReturnTotal: ReportDecimalValue;
}

export function calculateReportTotals(input: ReportTotalsInput) {
    const grossSales = value(input.grossSales);
    const returnsTotal = value(input.returnsTotal);
    const netSales = netReportValue(grossSales, returnsTotal);
    const vatCollected = netReportValue(input.grossVat, input.returnedVat);
    const netRevenue = netReportValue(netSales, vatCollected);
    const cogs = netReportValue(input.grossCogs, input.returnedCogs);
    const quantityNet = netReportValue(input.quantityGross, input.quantityReturned);
    const grossProfit = netReportValue(netRevenue, cogs);
    const averageTicket = input.transactionCount > 0
        ? grossSales.dividedBy(input.transactionCount)
        : new Decimal(0);
    const roundingAdjustment = grossSales
        .minus(value(input.productGrossSales))
        .minus(returnsTotal.minus(value(input.allocatedReturnTotal)));

    return {
        grossSales,
        returnsTotal,
        netSales,
        vatCollected,
        netRevenue,
        cogs,
        grossProfit,
        averageTicket,
        quantityNet,
        roundingAdjustment,
    };
}

export interface ProductReportTotalsInput {
    quantityGross: ReportDecimalValue;
    quantityReturned: ReportDecimalValue;
    grossSales: ReportDecimalValue;
    returnsTotal: ReportDecimalValue;
    grossVat: ReportDecimalValue;
    returnedVat: ReportDecimalValue;
    grossCogs: ReportDecimalValue;
    returnedCogs: ReportDecimalValue;
}

export function calculateProductReportTotals(input: ProductReportTotalsInput) {
    const quantityNet = netReportValue(input.quantityGross, input.quantityReturned);
    const netSales = netReportValue(input.grossSales, input.returnsTotal);
    const netVat = netReportValue(input.grossVat, input.returnedVat);
    const netCogs = netReportValue(input.grossCogs, input.returnedCogs);
    return {
        quantityNet,
        netSales,
        netVat,
        netCogs,
        grossProfit: calculateReportProfit(netSales, netVat, netCogs),
    };
}

export interface ReturnMoneyLineInput {
    lineTotal: ReportDecimalValue;
    baseQuantity: ReportDecimalValue;
    costAtSale: ReportDecimalValue | null;
    ivaExento: boolean | null;
}

export interface AllocateReturnMoneyInput {
    total: ReportDecimalValue;
    saleTotal: ReportDecimalValue;
    saleVat: ReportDecimalValue;
    fiscalRegimeAtSale: unknown;
    lines: readonly ReturnMoneyLineInput[];
    /**
     * Cuando una fila persistida es ilegible no se debe cargar todo el total
     * de la devolución a los productos que sí pudieron leerse. El llamador
     * puede limitar la asignación al valor de esas líneas y conservar el resto
     * como remanente auditable.
     */
    fullyAllocateTotal?: boolean;
}

export function allocateReturnMoney(input: AllocateReturnMoneyInput) {
    const total = Decimal.max(value(input.total), 0)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const rawLinesTotal = sumReportValues(input.lines.map((line) => line.lineTotal));
    const allocationTarget = input.fullyAllocateTotal === false
        ? Decimal.min(total, rawLinesTotal)
        : total;
    const saleTotal = Decimal.max(value(input.saleTotal), 0);
    const fallbackVatRatio = saleTotal.greaterThan(0)
        ? value(input.saleVat).dividedBy(saleTotal)
        : new Decimal(0);
    let allocated = new Decimal(0);

    const lines = input.lines.map((line, index) => {
        const lineAmount = rawLinesTotal.greaterThan(0)
            ? (index === input.lines.length - 1
                ? allocationTarget.minus(allocated)
                : allocationTarget
                    .mul(value(line.lineTotal))
                    .dividedBy(rawLinesTotal)
                    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP))
            : new Decimal(0);
        allocated = allocated.plus(lineAmount);

        const returnedCogs = line.costAtSale === null
            ? new Decimal(0)
            : value(line.costAtSale).mul(value(line.baseQuantity));
        const returnedVat = input.fiscalRegimeAtSale === 'CUOTA_FIJA' || line.ivaExento === true
            ? new Decimal(0)
            : line.ivaExento === false
                ? lineAmount.minus(
                    lineAmount.dividedBy('1.15').toDecimalPlaces(4, Decimal.ROUND_HALF_UP),
                )
                : lineAmount.mul(fallbackVatRatio);

        return { allocatedTotal: lineAmount, returnedVat, returnedCogs };
    });
    const unallocatedTotal = Decimal.max(total.minus(allocated), 0);

    return {
        total,
        lines,
        unallocatedTotal,
        unallocatedVat: unallocatedTotal.mul(fallbackVatRatio),
    };
}
