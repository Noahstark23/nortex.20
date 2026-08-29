import Decimal from 'decimal.js';

export interface PurchaseMoneyLineInput {
    /** Importe de la línea antes de IVA, calculado con cantidad/costo autoritativos. */
    lineNet: Decimal.Value;
    taxable: boolean;
}

export interface PurchaseMoneyLine {
    lineNet: Decimal;
    lineTax: Decimal;
    creditableTax: Decimal;
    lineTotal: Decimal;
}

export interface PurchaseMoneySummary {
    lines: PurchaseMoneyLine[];
    subtotal: Decimal;
    tax: Decimal;
    creditableTax: Decimal;
    total: Decimal;
}

const moneyAtCent = (value: Decimal.Value, field: string): Decimal => {
    let amount: Decimal;
    try {
        amount = new Decimal(value);
    } catch {
        throw new Error(`${field} debe ser un decimal válido`);
    }
    if (!amount.isFinite() || amount.isNegative()) {
        throw new Error(`${field} debe ser finito y no negativo`);
    }
    return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
};

/**
 * Totales autoritativos de una factura de compra.
 *
 * La factura se liquida en centavos: cada base y cada IVA se redondean antes de
 * sumar. Así una línea gravada de C$0.10 produce IVA C$0.02 y total C$0.12; el
 * subledger de CxP y el mayor nunca reciben el C$0.1150 que no podrían pagar.
 */
export function calculatePurchaseMoney(
    inputs: PurchaseMoneyLineInput[],
    allowsCreditableTax: boolean,
): PurchaseMoneySummary {
    if (inputs.length === 0) {
        throw new Error('La compra requiere al menos una línea monetaria');
    }

    let subtotal = new Decimal(0);
    let tax = new Decimal(0);
    let creditableTax = new Decimal(0);
    let total = new Decimal(0);

    const lines = inputs.map((input, index): PurchaseMoneyLine => {
        const lineNet = moneyAtCent(input.lineNet, `lineNet[${index}]`);
        const lineTax = input.taxable
            ? lineNet.mul('0.15').toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            : new Decimal(0);
        const lineCreditableTax = allowsCreditableTax ? lineTax : new Decimal(0);
        // La suma de dos importes ya materializados en centavos permanece exacta.
        const lineTotal = lineNet.plus(lineTax);

        subtotal = subtotal.plus(lineNet);
        tax = tax.plus(lineTax);
        creditableTax = creditableTax.plus(lineCreditableTax);
        total = total.plus(lineTotal);

        return { lineNet, lineTax, creditableTax: lineCreditableTax, lineTotal };
    });

    return {
        lines,
        subtotal,
        tax,
        creditableTax,
        total,
    };
}
