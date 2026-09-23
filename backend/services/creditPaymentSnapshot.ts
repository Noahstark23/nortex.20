import Decimal from 'decimal.js';

export interface CreditPaymentSnapshot {
    replayed: boolean;
    paymentId: string;
    saleBalance: string;
    customerDebt: string | null;
}

export async function replayCreditPaymentSnapshot(
    tx: any,
    sale: { customerId: string | null; balance: unknown },
    tenantId: string,
    paymentId: string,
): Promise<CreditPaymentSnapshot> {
    const customer = sale.customerId
        ? await tx.$queryRaw<Array<{ currentDebt: unknown }>>`
            SELECT currentDebt FROM \`Customer\`
            WHERE id = ${sale.customerId} AND tenantId = ${tenantId}
            FOR UPDATE`
        : [];
    if (sale.customerId && customer.length === 0) throw new Error('PAYMENT_CUSTOMER_NOT_FOUND');
    return {
        replayed: true,
        paymentId,
        saleBalance: new Decimal(String(sale.balance)).toFixed(2),
        customerDebt: customer.length ? new Decimal(String(customer[0].currentDebt)).toFixed(2) : null,
    };
}

export function newCreditPaymentSnapshot(
    paymentId: string,
    balanceAfter: Decimal,
    debtAfter: Decimal | null,
): CreditPaymentSnapshot {
    return { replayed: false, paymentId, saleBalance: balanceAfter.toFixed(2), customerDebt: debtAfter?.toFixed(2) ?? null };
}

export function creditPaymentResponseBalances(snapshot: CreditPaymentSnapshot) {
    const balance = Number(snapshot.saleBalance);
    return {
        balance,
        customerDebt: snapshot.customerDebt === null ? null : Number(snapshot.customerDebt),
        status: balance > 0 ? 'CREDIT_PENDING' : 'PAID',
    };
}
