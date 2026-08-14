/**
 * NORTEX — utilidades de dinero del frontend (captura segura sin floats).
 *
 * Compartidas por POS / Inventory / etc. para que ningún input numérico use
 * type="number" (quirks de float y separador local). El input es texto
 * controlado y el estado se parsea con Decimal.js.
 */
import Decimal from 'decimal.js';

/** Deja solo dígitos y UN punto decimal. Apto para onChange de inputs de texto. */
export const sanitizeDecimalInput = (raw: string): string => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
};

/**
 * Parser tolerante a string vacío/parcial ("", ".") → Decimal(0). Nunca lanza.
 * El catch cubre por sí solo los estados intermedios de tecleo: `new Decimal('')`
 * y `new Decimal('.')` lanzan, así que no hace falta un ternario que los
 * intercepte antes (era código muerto — sus mutantes sobrevivían siempre).
 */
export const toDecimal = (v: string | number): Decimal => {
    try {
        const d = new Decimal(v);
        return d.isFinite() ? d : new Decimal(0);
    } catch {
        return new Decimal(0);
    }
};

// ============================================================================
// FORMATEO DE DINERO — vía única para renderizar un monto en la UI
// ============================================================================
//
// PROBLEMA QUE RESUELVE: el mismo dato salía "C$ 2,042,190.31" en Inventario y
// "$2,042,190.31" en Reportes, y en Finanzas convivían "C$0.00", "$10000" y
// "$200" en una sola pantalla. Para el usuario eso no lee como inconsistencia
// de formato: lee como "el sistema calcula mal". Es el problema de credibilidad
// más caro del producto, y se arregla con un solo helper obligatorio.
//
// REGLAS (no negociables):
//   - Córdobas → "C$ 1,234.56"   · Dólares → "US$ 1,234.56"
//   - NUNCA "$" solo: en Nicaragua es ambiguo (córdoba y dólar comparten glifo).
//   - Siempre 2 decimales y separador de miles.
//   - Redondeo por Decimal.js (ROUND_HALF_UP), nunca por float.

export type Currency = 'NIO' | 'USD';

/** Símbolo por moneda. `$` a secas no existe en el sistema, a propósito. */
const CURRENCY_SYMBOL: Record<Currency, string> = {
    NIO: 'C$',
    USD: 'US$',
};

export interface FormatMoneyOptions {
    /** Oculta el símbolo (para celdas de tabla que ya lo llevan en el encabezado). */
    symbol?: boolean;
    /** Cifras decimales. Default 2; 0 para totales redondos de dashboards. */
    decimals?: number;
    /** Antepone el signo + en positivos (deltas de KPI, movimientos de caja). */
    signed?: boolean;
}

/**
 * Única vía para renderizar dinero en la UI de Nortex.
 *
 * @example
 * formatMoney(1234.5)                    // "C$ 1,234.50"
 * formatMoney(1234.5, 'USD')             // "US$ 1,234.50"
 * formatMoney(-80, 'NIO', { signed: true })  // "-C$ 80.00"
 * formatMoney(1234.5, 'NIO', { symbol: false })  // "1,234.50"
 */
export const formatMoney = (
    value: Decimal.Value | null | undefined,
    currency: Currency = 'NIO',
    options: FormatMoneyOptions = {},
): string => {
    const { symbol = true, decimals = 2, signed = false } = options;

    // null/undefined/NaN → cero explícito. Un monto vacío en un ERP se muestra
    // como "C$ 0.00", nunca como "-" ni como cadena vacía: el usuario tiene que
    // poder distinguir "no hay plata" de "no cargó".
    // (No hace falta un guard aparte: toDecimal ya devuelve 0 ante null,
    // undefined, NaN y strings no numéricos. El guard extra era código muerto
    // — lo detectó la corrida de mutación: sus mutantes sobrevivían siempre.)
    const amount = toDecimal(value as string | number);

    const isNegative = amount.isNegative() && !amount.isZero();
    const absolute = amount.abs().toFixed(decimals, Decimal.ROUND_HALF_UP);

    // Separador de miles sobre la parte entera (es-NI usa coma para miles y
    // punto para decimales, igual que el formato de la DGI).
    const [integerPart, decimalPart] = absolute.split('.');
    const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const number = decimalPart ? `${withThousands}.${decimalPart}` : withThousands;

    const sign = isNegative ? '-' : signed ? '+' : '';
    return symbol ? `${sign}${CURRENCY_SYMBOL[currency]} ${number}` : `${sign}${number}`;
};

/** Atajo para dólares — evita que un call-site escriba 'USD' mal. */
export const formatUSD = (value: Decimal.Value | null | undefined, options: FormatMoneyOptions = {}): string =>
    formatMoney(value, 'USD', options);

/**
 * Formato corto para ejes de gráficos y KPIs apretados: C$ 1.2k / C$ 3.4M.
 * Solo para lectura visual — nunca para un monto que el usuario deba cuadrar.
 */
export const formatMoneyShort = (value: Decimal.Value | null | undefined, currency: Currency = 'NIO'): string => {
    const amount = toDecimal(value as string | number);
    const abs = amount.abs();
    const sign = amount.isNegative() && !amount.isZero() ? '-' : '';
    const symbol = CURRENCY_SYMBOL[currency];

    if (abs.gte(1_000_000)) return `${sign}${symbol} ${abs.div(1_000_000).toFixed(1)}M`;
    if (abs.gte(1_000)) return `${sign}${symbol} ${abs.div(1_000).toFixed(1)}k`;
    return `${sign}${symbol} ${abs.toFixed(0)}`;
};
