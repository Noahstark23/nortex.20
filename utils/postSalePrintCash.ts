import Decimal from 'decimal.js';

interface PostSalePrintCashInput {
    paymentMethod: string;
    cashReceived?: Decimal.Value | null;
    change?: Decimal.Value | null;
}

interface PostSalePrintCashOutput {
    cashReceived?: number;
    change?: number;
}

function roundMoney(value: Decimal.Value): number {
    return new Decimal(value).toDecimalPlaces(2).toNumber();
}

/**
 * El ticket necesita conservar el efectivo recibido aunque el pago haya sido
 * exacto. El vuelto solo se imprime cuando existe de verdad.
 */
export const buildPostSalePrintCash = ({
    paymentMethod,
    cashReceived,
    change,
}: PostSalePrintCashInput): PostSalePrintCashOutput => {
    if (paymentMethod !== 'CASH') {
        return {};
    }

    try {
        // Decimal rechaza undefined y representa null como cero; la validación
        // de positividad de abajo cubre ambos casos sin ramas equivalentes.
        const received = new Decimal(cashReceived!);
        if (!received.isFinite() || received.lessThanOrEqualTo(0)) return {};

        let resolvedChange: Decimal;
        try {
            resolvedChange = new Decimal(change!);
        } catch {
            return { cashReceived: roundMoney(received) };
        }
        if (!resolvedChange.isFinite() || resolvedChange.lessThanOrEqualTo(0)) {
            return { cashReceived: roundMoney(received) };
        }

        return {
            cashReceived: roundMoney(received),
            change: roundMoney(resolvedChange),
        };
    } catch {
        return {};
    }
};
