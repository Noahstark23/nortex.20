/**
 * Regla fiscal pura compartida por frontend y backend.
 *
 * El régimen se guarda como String para que el cambio de schema sea aditivo. Esta
 * frontera impide que valores desconocidos activen por accidente el tratamiento
 * de cuota fija: toda fila legacy o inválida conserva el comportamiento GENERAL.
 */
import Decimal from 'decimal.js';

export const FISCAL_REGIME_GENERAL = 'GENERAL' as const;
export const FISCAL_REGIME_CUOTA_FIJA = 'CUOTA_FIJA' as const;

export type FiscalRegime =
    | typeof FISCAL_REGIME_GENERAL
    | typeof FISCAL_REGIME_CUOTA_FIJA;

export function normalizeFiscalRegime(value: unknown): FiscalRegime {
    return value === FISCAL_REGIME_CUOTA_FIJA
        ? FISCAL_REGIME_CUOTA_FIJA
        : FISCAL_REGIME_GENERAL;
}

/**
 * Una versión ausente solo es segura mientras el tenant siga en v1 (estado de
 * migración GENERAL). Tras el primer cambio no podemos saber bajo qué régimen
 * nació una venta legacy en cola, así que debe conciliarse en vez de
 * reinterpretarse con la configuración actual.
 */
export function hasFiscalRegimeVersionConflict(
    observedVersion: number | null | undefined,
    currentVersion: number,
): boolean {
    return observedVersion == null
        ? currentVersion > 1
        : observedVersion !== currentVersion;
}

export interface SaleFiscalAmounts {
    fiscalRegime: FiscalRegime;
    /** IVA trasladado que se reconoce en el asiento y se congela en la venta. */
    vatAmount: Decimal;
    /** Ingreso reconocido: total menos el IVA efectivamente trasladado. */
    netRevenue: Decimal;
}

/** IVA incluido en una porción gravada; el precio de góndola ya trae el 15%. */
export function includedVatFromGross(taxableGross: Decimal.Value): Decimal {
    const gross = new Decimal(taxableGross).toDecimalPlaces(4);
    if (!gross.isFinite() || gross.isNegative()) {
        throw new Error('La venta gravada debe ser finita y no negativa');
    }
    const net = gross.dividedBy(new Decimal('0.15').plus(1)).toDecimalPlaces(4);
    return gross.minus(net).toDecimalPlaces(4);
}

/**
 * Aplica el régimen a un desglose GENERAL ya calculado por el motor fiscal.
 *
 * `generalVatAmount` conserva la regla existente de IVA incluido y exoneraciones.
 * En CUOTA_FIJA no se reclasifica la venta como exenta: simplemente no existe IVA
 * trasladado y el total completo es ingreso.
 */
export function resolveSaleFiscalAmounts(
    total: Decimal.Value,
    generalVatAmount: Decimal.Value,
    fiscalRegime: unknown = FISCAL_REGIME_GENERAL,
): SaleFiscalAmounts {
    const normalizedRegime = normalizeFiscalRegime(fiscalRegime);
    const normalizedTotal = new Decimal(total).toDecimalPlaces(4);
    const normalizedGeneralVat = new Decimal(generalVatAmount).toDecimalPlaces(4);

    if (!normalizedTotal.isFinite() || normalizedTotal.isNegative()) {
        throw new Error('El total de venta debe ser finito y no negativo');
    }
    if (
        !normalizedGeneralVat.isFinite()
        || normalizedGeneralVat.isNegative()
        || normalizedGeneralVat.greaterThan(normalizedTotal)
    ) {
        throw new Error('El IVA general debe estar entre cero y el total de venta');
    }

    const vatAmount = normalizedRegime === FISCAL_REGIME_CUOTA_FIJA
        ? new Decimal(0)
        : normalizedGeneralVat;

    return {
        fiscalRegime: normalizedRegime,
        vatAmount,
        netRevenue: normalizedTotal.minus(vatAmount).toDecimalPlaces(4),
    };
}

/** Lo que una venta YA GUARDADA dice de sí misma sobre su IVA. */
export interface SaleVatSnapshot {
    total: Decimal.Value;
    exemptTotal?: Decimal.Value | null;
    fiscalRegimeAtSale?: unknown;
    vatAmountAtSale?: Decimal.Value | null;
}

/**
 * IVA REALMENTE trasladado por UNA venta, leído de la venta misma.
 *
 * Existe porque los reportes no pueden seguir suponiendo que cada córdoba
 * vendido trae 15% adentro. Esa suposición (`total / 1.15` sobre el período
 * entero) le inventa al dueño un impuesto que nunca cobró en dos casos reales:
 * el negocio de CUOTA FIJA, que no traslada IVA en ninguna venta, y la venta
 * exonerada de canasta básica o medicinas de cualquier negocio.
 *
 * Las tres reglas son las MISMAS de `generateMonthlyReport` (nicaTax.ts), a
 * propósito: si el reporte de ventas y la declaración mensual usaran criterios
 * distintos, el dueño vería dos cifras de IVA y ninguna sería confiable.
 *   1. CUOTA_FIJA → cero, aunque una fila corrupta traiga un IVA guardado.
 *   2. Con snapshot (`vatAmountAtSale`) → manda el snapshot: es lo que se
 *      imprimió y se asentó el día de la venta, y cambiar de régimen hoy NO
 *      reescribe la historia.
 *   3. Sin snapshot (ventas anteriores a que el campo existiera) → se recalcula
 *      con el comportamiento histórico: 15% incluido sobre la parte gravada.
 */
export function vatCollectedFromSale(sale: SaleVatSnapshot): Decimal {
    const total = new Decimal(sale.total ?? 0).toDecimalPlaces(4);
    if (!total.isFinite() || total.isNegative()) {
        throw new Error('El total de venta debe ser finito y no negativo');
    }
    if (normalizeFiscalRegime(sale.fiscalRegimeAtSale) === FISCAL_REGIME_CUOTA_FIJA) {
        return new Decimal(0);
    }
    if (sale.vatAmountAtSale !== null && sale.vatAmountAtSale !== undefined) {
        const snapshot = new Decimal(sale.vatAmountAtSale).toDecimalPlaces(4);
        if (!snapshot.isFinite() || snapshot.isNegative() || snapshot.greaterThan(total)) {
            throw new Error('El IVA guardado debe estar entre cero y el total de venta');
        }
        return snapshot;
    }
    // Acotar el exento a [0, total] antes de restar: un dato inconsistente daría
    // un gravado negativo y `includedVatFromGross` tiraría.
    const exento = Decimal.min(
        Decimal.max(new Decimal(sale.exemptTotal ?? 0), new Decimal(0)),
        total,
    );
    return includedVatFromGross(total.minus(exento));
}
