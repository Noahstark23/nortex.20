/**
 * Reglas puras para el cobro en efectivo del POS.
 *
 * Los montos se conservan como Decimal de entrada a salida. Esto evita que el
 * vuelto dependa de la representacion binaria de Number (por ejemplo, 0.1 +
 * 0.2) y permite compartir exactamente las mismas reglas entre UI y pruebas.
 */
import Decimal from 'decimal.js';

export type CashReceivedErrorCode =
    | 'EMPTY_RECEIVED'
    | 'INVALID_RECEIVED'
    | 'INVALID_TOTAL'
    | 'INSUFFICIENT_RECEIVED';

export interface CashReceivedSuccess {
    ok: true;
    received: Decimal;
    total: Decimal;
    change: Decimal;
}

export interface CashReceivedError {
    ok: false;
    code: CashReceivedErrorCode;
    message: string;
    shortfall?: Decimal;
}

export type CashReceivedValidation = CashReceivedSuccess | CashReceivedError;

export function isCashReceivedError(
    validation: CashReceivedValidation,
): validation is CashReceivedError {
    return validation.ok === false;
}

const parseFiniteDecimal = (input: unknown): Decimal | null => {
    if (input instanceof Decimal) {
        return input.isFinite() ? new Decimal(input) : null;
    }
    if (typeof input !== 'string' && typeof input !== 'number') return null;
    try {
        const value = new Decimal(input);
        return value.isFinite() ? value : null;
    } catch {
        return null;
    }
};

/**
 * Valida el ultimo paso de un cobro en efectivo.
 *
 * Una entrada vacia se distingue de una entrada mal formada para que la UI
 * pueda pedir el monto sin mostrar un error tecnico. Un resultado valido trae
 * el vuelto ya calculado con Decimal.js.
 */
export const validateCashReceived = (receivedInput: unknown, totalInput: unknown): CashReceivedValidation => {
    if (
        receivedInput === null
        || receivedInput === undefined
        || (typeof receivedInput === 'string' && receivedInput.trim() === '')
    ) {
        return {
            ok: false,
            code: 'EMPTY_RECEIVED',
            message: 'Ingresá el efectivo recibido',
        };
    }

    const total = parseFiniteDecimal(totalInput);
    if (total === null || !total.greaterThan(0)) {
        return {
            ok: false,
            code: 'INVALID_TOTAL',
            message: 'El total de la venta no es válido',
        };
    }

    const received = parseFiniteDecimal(receivedInput);
    if (received === null || received.isNegative()) {
        return {
            ok: false,
            code: 'INVALID_RECEIVED',
            message: 'El efectivo recibido no es válido',
        };
    }

    if (received.lessThan(total)) {
        return {
            ok: false,
            code: 'INSUFFICIENT_RECEIVED',
            message: 'El efectivo recibido es menor que el total',
            shortfall: total.minus(received),
        };
    }

    return {
        ok: true,
        received,
        total,
        change: received.minus(total),
    };
};

const NIO_DENOMINATIONS = ['20', '50', '100', '200', '500', '1000'] as const;
const PRACTICAL_ROUNDING_STEPS = ['50', '100', '500', '1000'] as const;

function nextStrictMultiple(total: Decimal, step: Decimal): Decimal {
    return total.div(step).floor().plus(1).times(step);
}

/**
 * Sugiere montos practicos para cobrar en cordobas, sin incluir el total exacto.
 *
 * Politica:
 * - incluye cada denominacion NIO que por si sola cubra la venta;
 * - agrega el siguiente monto redondo de C$50, C$100, C$500 y C$1,000 para
 *   representar combinaciones comunes de billetes;
 * - ordena, deduplica y recorta al maximo solicitado.
 *
 * Ejemplos: C$19 -> 20/50/100; C$85 -> 100/200/500;
 * C$645 -> 650/700/1,000.
 */
export const suggestNioCashAmounts = (totalInput: unknown, maxSuggestions = 3): Decimal[] => {
    const total = parseFiniteDecimal(totalInput);
    if (total === null || !total.greaterThan(0) || !Number.isFinite(maxSuggestions)) {
        return [];
    }
    const suggestionLimit = Math.max(0, Math.floor(maxSuggestions));

    const candidates = [
        ...NIO_DENOMINATIONS.map(value => new Decimal(value)),
        ...PRACTICAL_ROUNDING_STEPS.map(value => nextStrictMultiple(total, new Decimal(value))),
    ];

    const unique = new Map<string, Decimal>();
    for (const candidate of candidates) {
        // Estrictamente mayor: el total exacto se ofrece en su propio boton y
        // no debe reaparecer entre las denominaciones sugeridas.
        if (!candidate.greaterThan(total)) continue;
        unique.set(candidate.toString(), candidate);
    }

    return [...unique.values()]
        .sort((left, right) => left.comparedTo(right))
        .slice(0, suggestionLimit);
};
