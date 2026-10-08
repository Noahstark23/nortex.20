/**
 * Traslación del IVA en una factura de COMPRA — regla pura compartida por
 * frontend y backend.
 *
 * Una compra tiene tres ejes fiscales independientes, no dos:
 *
 *   1. Exención del PRODUCTO (`Product.ivaExento`): la línea no causa IVA nunca.
 *   2. Traslación del PROVEEDOR (este módulo): el emisor de la factura puede no
 *      trasladar IVA aunque el producto esté gravado — cuota fija, proveedor no
 *      inscrito, importación con IVA liquidado en aduana, exoneración documentada.
 *   3. Acreditabilidad del COMPRADOR (`Tenant.fiscalRegime`): cuota fija paga el
 *      IVA pero no lo acredita, así que lo capitaliza en el costo.
 *
 * Sin el eje 2 una factura de C$1,000 sin IVA se registraba en C$1,150: inflaba
 * la CxP, sacaba C$150 de más de la gaveta y acreditaba un crédito fiscal que
 * nunca existió. El tratamiento se CONGELA en el documento igual que
 * `fiscalRegimeAtPurchase`: nunca se re-deriva del proveedor al leer, porque un
 * proveedor que cambia de régimen no reinterpreta sus facturas viejas.
 */
import Decimal from 'decimal.js';

export const PURCHASE_TAX_TRASLADADO = 'IVA_TRASLADADO' as const;
export const PURCHASE_TAX_SIN_TRASLADO = 'SIN_TRASLADO' as const;

export type PurchaseTaxTreatment =
    | typeof PURCHASE_TAX_TRASLADADO
    | typeof PURCHASE_TAX_SIN_TRASLADO;

export const PURCHASE_TAX_TREATMENTS: readonly PurchaseTaxTreatment[] = [
    PURCHASE_TAX_TRASLADADO,
    PURCHASE_TAX_SIN_TRASLADO,
];

export const PURCHASE_NO_TAX_REASONS = [
    'PROVEEDOR_CUOTA_FIJA',
    'PROVEEDOR_NO_INSCRITO',
    'IMPORTACION_IVA_ADUANA',
    'EXONERACION_DOCUMENTADA',
] as const;

export type PurchaseNoTaxReason = (typeof PURCHASE_NO_TAX_REASONS)[number];

/** Tasa única del IVA de compras. El cliente NO conserva su propia copia. */
export const PURCHASE_IVA_RATE = '0.15';

export function isPurchaseTaxTreatment(value: unknown): value is PurchaseTaxTreatment {
    return value === PURCHASE_TAX_TRASLADADO || value === PURCHASE_TAX_SIN_TRASLADO;
}

export function isPurchaseNoTaxReason(value: unknown): value is PurchaseNoTaxReason {
    return PURCHASE_NO_TAX_REASONS.some((reason) => reason === value);
}

/**
 * Lectura de una fila ALMACENADA. Fail-closed hacia el histórico: toda compra
 * anterior a este campo, y cualquier valor corrupto, conserva el significado con
 * el que se registró — el IVA se trasladó. Las ENTRADAS no pasan por acá: el
 * schema Zod rechaza un valor fuera del vocabulario en vez de asumirlo.
 */
export function normalizeStoredPurchaseTaxTreatment(value: unknown): PurchaseTaxTreatment {
    return value === PURCHASE_TAX_SIN_TRASLADO
        ? PURCHASE_TAX_SIN_TRASLADO
        : PURCHASE_TAX_TRASLADADO;
}

export function normalizeStoredPurchaseNoTaxReason(value: unknown): PurchaseNoTaxReason | null {
    return isPurchaseNoTaxReason(value) ? value : null;
}

/** Único lugar donde se decide si una factura causa IVA. */
export function purchaseTransfersTax(treatment: unknown): boolean {
    return normalizeStoredPurchaseTaxTreatment(treatment) === PURCHASE_TAX_TRASLADADO;
}

/**
 * IVA de UNA línea, ya materializado en centavos.
 *
 * La línea causa IVA solo si el documento lo traslada Y el producto está gravado.
 * Cualquiera de los dos ejes en falso da cero: no hay orden de precedencia que
 * inventar ni un caso donde un producto exento cause impuesto.
 */
export function purchaseLineTax(
    lineNet: Decimal.Value,
    taxable: boolean,
    treatment: unknown,
): Decimal {
    const base = new Decimal(lineNet);
    if (!base.isFinite() || base.isNegative()) {
        throw new Error('La base de la línea debe ser finita y no negativa');
    }
    if (!taxable || !purchaseTransfersTax(treatment)) return new Decimal(0);
    return base.mul(PURCHASE_IVA_RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export interface PurchaseTaxTreatmentIntent {
    treatment: PurchaseTaxTreatment;
    reason: PurchaseNoTaxReason | null;
}

/**
 * SUGERENCIA para la UI a partir de la categoría fiscal del proveedor, que es
 * texto libre y descriptivo. Nunca es autoridad: el operador confirma contra el
 * papel que tiene en la mano y el backend valida lo que llega, no lo que el
 * proveedor "es" hoy.
 */
export function suggestPurchaseTaxTreatment(
    supplierFiscalCategory: string | null | undefined,
): PurchaseTaxTreatmentIntent {
    // Sin centinela `?? ''`: un default de cadena cae en la misma rama que la
    // ausencia, así que era un mutante equivalente que ninguna prueba podía
    // distinguir. El encadenamiento opcional sí falla si se lo quita.
    const category = supplierFiscalCategory?.trim().toUpperCase();
    if (category === 'CUOTA_FIJA') {
        return { treatment: PURCHASE_TAX_SIN_TRASLADO, reason: 'PROVEEDOR_CUOTA_FIJA' };
    }
    if (category === 'EXEMPT') {
        return { treatment: PURCHASE_TAX_SIN_TRASLADO, reason: 'EXONERACION_DOCUMENTADA' };
    }
    return { treatment: PURCHASE_TAX_TRASLADADO, reason: null };
}

/**
 * Coherencia del par tratamiento/motivo. Devuelve el código de error o `null`.
 * La misma regla vale para el schema HTTP, el asistente y la re-verificación
 * previa a escribir: un motivo sin traslación ausente no puede volverse "otro"
 * valor por defecto.
 */
export function purchaseTaxTreatmentIssue(
    treatment: unknown,
    reason: unknown,
): 'REASON_REQUIRED' | 'REASON_NOT_APPLICABLE' | null {
    if (purchaseTransfersTax(treatment)) {
        return reason == null ? null : 'REASON_NOT_APPLICABLE';
    }
    return isPurchaseNoTaxReason(reason) ? null : 'REASON_REQUIRED';
}
