import Decimal from 'decimal.js';

/** Valores JSON de Prisma y snapshots locales: nunca usar coerción para crédito. */
const creditMoney = (value: unknown): Decimal => {
    const amount = new Decimal(value as Decimal.Value);
    // Customer usa Decimal(10, 2): tampoco permitir desbordes ni subcentavos.
    if (!amount.isFinite() || amount.isNegative() || amount.gt('99999999.99') || amount.decimalPlaces() > 2) throw new Error();
    return amount;
};

/** Preview del POS; executeSale vuelve a verificar deuda/límite bajo transacción. */
export const resolvePosCredit = (
    customer: { creditLimit: unknown; currentDebt: unknown; isBlocked: boolean } | null,
    amountDue: unknown,
) => {
    try {
        const limit = creditMoney(customer.creditLimit);
        const currentDebt = creditMoney(customer.currentDebt);
        const projectedDebt = creditMoney(currentDebt.plus(creditMoney(amountDue)));
        const debtPct = limit.gt(0) ? currentDebt.div(limit).times(100).toNumber() : 100;
        const projectedPct = limit.gt(0) ? projectedDebt.div(limit).times(100).toNumber() : 100;
        const color = debtPct >= 80 || customer.isBlocked ? 'red' : debtPct >= 50 ? 'yellow' : 'green';
        const projectedColor = projectedPct >= 100 ? 'red' : projectedPct >= 80 ? 'yellow' : 'green';
        return {
            limit: limit.toString(), currentDebt: currentDebt.toString(),
            projectedDebt: projectedDebt.toString(),
            available: Decimal.max(0, limit.minus(currentDebt)).toString(),
            exceedsLimit: projectedDebt.gt(limit),
            debtPct, projectedPct, color, projectedColor,
        };
    } catch {
        // Un saldo desconocido no equivale a cero ni habilita una venta.
        return null;
    }
};
