import Decimal from 'decimal.js';

/** El origen financiero del stock inicial se concilia después; no se presume aporte de capital. */
export function buildInitialInventoryJournalLines(quantity: Decimal.Value, unitCost: Decimal.Value) {
    const qty = new Decimal(quantity);
    const cost = new Decimal(unitCost);
    if (!qty.isFinite() || qty.lte(0) || !cost.isFinite() || cost.lt(0)) {
        throw new Error('Existencia o costo inicial inválido');
    }
    const amount = qty.mul(cost).toDecimalPlaces(4);
    return amount.isZero() ? [] : [
        { accountCode: '1.1.4', debit: amount.toNumber(), credit: 0 },
        { accountCode: '3.1.4', debit: 0, credit: amount.toNumber() },
    ];
}
