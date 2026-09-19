import { validateQuantity } from './quantity';
import { resolveProductQuantityRules, type ProductQuantityConfiguration } from './productQuantityRules';

export interface StockTransferQuantityRules extends ProductQuantityConfiguration {}

/**
 * Contrato compartido para mover existencias entre bodegas; conserva el modo
 * y paso del catálogo, incluido el fallback de unidades contables heredadas.
 */
export const validateStockTransferQuantity = (
    input: unknown,
    product: StockTransferQuantityRules,
) => {
    return validateQuantity(input, resolveProductQuantityRules(product));
};
