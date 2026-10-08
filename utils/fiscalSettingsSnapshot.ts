import {
    FISCAL_REGIME_GENERAL,
    normalizeFiscalRegime,
    type FiscalRegime,
} from './fiscalRegime';

export interface FiscalSettingsSnapshot {
    fiscalRegime: FiscalRegime;
    fiscalRegimeVersion: number;
}

export const DEFAULT_FISCAL_SETTINGS: FiscalSettingsSnapshot = Object.freeze({
    fiscalRegime: FISCAL_REGIME_GENERAL,
    fiscalRegimeVersion: 1,
});

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
);

export const normalizeFiscalRegimeVersion = (value: unknown, fallback = 1): number => {
    const normalizedFallback = Number.isSafeInteger(fallback) && fallback >= 1 ? fallback : 1;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
        ? value
        : normalizedFallback;
};

/**
 * Normaliza tanto el tenant cacheado como la respuesta del endpoint fiscal.
 * La envoltura `{ data: ... }` se tolera para que el consumidor no dependa de
 * detalles de transporte. Ausencias conservan el fallback; un régimen
 * desconocido, en cambio, cae deliberadamente a GENERAL.
 */
export function normalizeFiscalSettingsSnapshot(
    value: unknown,
    fallback: FiscalSettingsSnapshot = DEFAULT_FISCAL_SETTINGS,
): FiscalSettingsSnapshot {
    const root = asRecord(value);
    const wrapped = asRecord(root?.data);
    const source = wrapped ?? root;
    const normalizedFallback: FiscalSettingsSnapshot = {
        fiscalRegime: normalizeFiscalRegime(fallback.fiscalRegime),
        fiscalRegimeVersion: normalizeFiscalRegimeVersion(fallback.fiscalRegimeVersion),
    };

    if (!source) return normalizedFallback;

    return {
        fiscalRegime: Object.prototype.hasOwnProperty.call(source, 'fiscalRegime')
            ? normalizeFiscalRegime(source.fiscalRegime)
            : normalizedFallback.fiscalRegime,
        fiscalRegimeVersion: normalizeFiscalRegimeVersion(
            source.fiscalRegimeVersion,
            normalizedFallback.fiscalRegimeVersion,
        ),
    };
}
