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

/** Parser tolerante a string vacío/parcial ("", ".") → Decimal(0). Nunca lanza. */
export const toDecimal = (v: string | number): Decimal => {
    try {
        const d = new Decimal(v === '' || v === '.' ? 0 : v);
        return d.isFinite() ? d : new Decimal(0);
    } catch {
        return new Decimal(0);
    }
};
