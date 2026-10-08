import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
    FISCAL_REGIME_CUOTA_FIJA,
    FISCAL_REGIME_GENERAL,
    includedVatFromGross,
    resolveSaleFiscalAmounts,
} from '../utils/fiscalRegime';
import {
    DEFAULT_FISCAL_SETTINGS,
    normalizeFiscalRegimeVersion,
    normalizeFiscalSettingsSnapshot,
} from '../utils/fiscalSettingsSnapshot';

describe('snapshot fiscal del frontend', () => {
    it('preserva GENERAL v1 para tenants y respuestas legacy', () => {
        expect(normalizeFiscalSettingsSnapshot(undefined)).toEqual(DEFAULT_FISCAL_SETTINGS);
        expect(normalizeFiscalSettingsSnapshot({})).toEqual({
            fiscalRegime: FISCAL_REGIME_GENERAL,
            fiscalRegimeVersion: 1,
        });
    });

    it('acepta la respuesta autoritativa directa o envuelta', () => {
        const expected = {
            fiscalRegime: FISCAL_REGIME_CUOTA_FIJA,
            fiscalRegimeVersion: 4,
        } as const;

        expect(normalizeFiscalSettingsSnapshot(expected)).toEqual(expected);
        expect(normalizeFiscalSettingsSnapshot({ data: expected })).toEqual(expected);
    });

    it('conserva el fallback cuando la respuesta parcial omite la versión', () => {
        expect(normalizeFiscalSettingsSnapshot(
            { fiscalRegime: FISCAL_REGIME_CUOTA_FIJA },
            { fiscalRegime: FISCAL_REGIME_GENERAL, fiscalRegimeVersion: 7 },
        )).toEqual({
            fiscalRegime: FISCAL_REGIME_CUOTA_FIJA,
            fiscalRegimeVersion: 7,
        });
    });

    it('un régimen desconocido no activa cuota fija por accidente', () => {
        expect(normalizeFiscalSettingsSnapshot(
            { fiscalRegime: 'OTRO', fiscalRegimeVersion: 8 },
            { fiscalRegime: FISCAL_REGIME_CUOTA_FIJA, fiscalRegimeVersion: 7 },
        )).toEqual({
            fiscalRegime: FISCAL_REGIME_GENERAL,
            fiscalRegimeVersion: 8,
        });
    });

    it.each([undefined, null, 0, -1, 1.5, Number.NaN, '3'])(
        'rechaza una versión fiscal no entera y positiva: %s',
        (value) => {
            expect(normalizeFiscalRegimeVersion(value, 5)).toBe(5);
        },
    );

    it('desglosa solo las líneas gravadas después del descuento global', () => {
        const discountFactor = new Decimal('0.90');
        const total = new Decimal(115).plus(50).mul(discountFactor);
        const exempt = new Decimal(50).mul(discountFactor);
        const generalVat = includedVatFromGross(total.minus(exempt));

        const general = resolveSaleFiscalAmounts(total, generalVat, FISCAL_REGIME_GENERAL);
        const fixedQuota = resolveSaleFiscalAmounts(total, generalVat, FISCAL_REGIME_CUOTA_FIJA);

        expect(total.toFixed(2)).toBe('148.50');
        expect(general.vatAmount.toFixed(4)).toBe('13.5000');
        expect(general.netRevenue.toFixed(4)).toBe('135.0000');
        expect(fixedQuota.vatAmount.toFixed(4)).toBe('0.0000');
        expect(fixedQuota.netRevenue.toFixed(4)).toBe('148.5000');
    });
});
