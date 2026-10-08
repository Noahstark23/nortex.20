import Decimal from 'decimal.js';
import { purchaseLineTax, type PurchaseTaxTreatment } from '../../utils/purchaseTaxTreatment';

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
    /** Verdad fiscal de la línea: gravada por producto, aunque el IVA sea cero. */
    taxable: boolean;
}

export interface PurchaseMoneySummary {
    lines: PurchaseMoneyLine[];
    subtotal: Decimal;
    /** Base de las líneas GRAVADAS, sin importar si el documento trasladó IVA. */
    taxableSubtotal: Decimal;
    /** Base de las líneas exentas por producto. */
    exemptSubtotal: Decimal;
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
 *
 * `taxTreatment` es la traslación congelada del documento. Con `SIN_TRASLADO` no
 * existe IVA que acreditar ni capitalizar: el total es igual al subtotal, así que
 * la CxP, la gaveta y el mayor reciben exactamente lo que dice el papel.
 * `taxableSubtotal`/`exemptSubtotal` se conservan por separado porque bajo
 * `SIN_TRASLADO` toda línea tiene IVA cero y el libro fiscal no podría distinguir
 * una base exenta de una gravada sin traslación.
 */
export function calculatePurchaseMoney(
    inputs: PurchaseMoneyLineInput[],
    allowsCreditableTax: boolean,
    taxTreatment: PurchaseTaxTreatment,
): PurchaseMoneySummary {
    if (inputs.length === 0) {
        throw new Error('La compra requiere al menos una línea monetaria');
    }

    let subtotal = new Decimal(0);
    let taxableSubtotal = new Decimal(0);
    let exemptSubtotal = new Decimal(0);
    let tax = new Decimal(0);
    let creditableTax = new Decimal(0);
    let total = new Decimal(0);

    const lines = inputs.map((input, index): PurchaseMoneyLine => {
        const lineNet = moneyAtCent(input.lineNet, `lineNet[${index}]`);
        const lineTax = purchaseLineTax(lineNet, input.taxable, taxTreatment);
        const lineCreditableTax = allowsCreditableTax ? lineTax : new Decimal(0);
        // La suma de dos importes ya materializados en centavos permanece exacta.
        const lineTotal = lineNet.plus(lineTax);

        subtotal = subtotal.plus(lineNet);
        if (input.taxable) {
            taxableSubtotal = taxableSubtotal.plus(lineNet);
        } else {
            exemptSubtotal = exemptSubtotal.plus(lineNet);
        }
        tax = tax.plus(lineTax);
        creditableTax = creditableTax.plus(lineCreditableTax);
        total = total.plus(lineTotal);

        return {
            lineNet,
            lineTax,
            creditableTax: lineCreditableTax,
            lineTotal,
            taxable: input.taxable,
        };
    });

    return {
        lines,
        subtotal,
        taxableSubtotal,
        exemptSubtotal,
        tax,
        creditableTax,
        total,
    };
}
