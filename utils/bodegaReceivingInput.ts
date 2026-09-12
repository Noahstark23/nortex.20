import Decimal from 'decimal.js';

export const BODEGA_DECIMAL_HINT = 'Usá coma o punto decimal, sin separadores de miles.';

/** Convierte solo un separador decimal inequívoco. Nunca borra dígitos ni signos. */
export function normalizeBodegaDecimalInput(raw: string): string {
    const trimmed = raw.trim();
    return /^\d*(?:[.,]\d*)?$/.test(trimmed) ? trimmed.replace(',', '.') : raw;
}

/** Los parciales y formatos ambiguos se conservan en pantalla, pero no se envían. */
export function parseBodegaDecimalInput(value: string | number): Decimal {
    const text = String(value).trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(BODEGA_DECIMAL_HINT);
    return new Decimal(text);
}
