/**
 * Textos de presentación de la traslación del IVA en compras.
 *
 * Viven SEPARADOS de `purchaseTaxTreatment.ts` a propósito: ese módulo está bajo
 * pruebas de mutación porque decide dinero, y una red de mutación que persigue
 * copy obliga a aseverar cada palabra en un test. Eso no caza ningún bug — solo
 * congela la redacción y castiga cualquier mejora de texto. Acá la fuente de
 * verdad sigue siendo el vocabulario tipado del módulo puro: `Record` completo
 * significa que agregar un motivo sin su etiqueta no compila.
 */
import type { PurchaseNoTaxReason, PurchaseTaxTreatment } from './purchaseTaxTreatment';

export const PURCHASE_TAX_TREATMENT_LABELS: Record<PurchaseTaxTreatment, string> = {
    IVA_TRASLADADO: 'La factura traslada IVA (15%)',
    SIN_TRASLADO: 'La factura no trae IVA',
};

export const PURCHASE_NO_TAX_REASON_LABELS: Record<PurchaseNoTaxReason, string> = {
    PROVEEDOR_CUOTA_FIJA: 'Proveedor de cuota fija: no traslada IVA',
    PROVEEDOR_NO_INSCRITO: 'Proveedor no inscrito o recibo simple',
    IMPORTACION_IVA_ADUANA: 'Importación: el IVA se liquida en aduana',
    EXONERACION_DOCUMENTADA: 'Exoneración documentada',
};
