import { validateQuantity } from './quantity';

export interface StockTransferQuantityRules {
    saleMode?: string | null;
    quantityStep?: string | number | { toString(): string } | null;
}

/**
 * Contrato compartido para mover existencias entre bodegas. Solo COUNTED
 * explícito fuerza enteros; las filas legacy conservan el paso fraccionario
 * efectivo de 0.0001 igual que ventas, conteos, compras y ajustes.
 */
export const validateStockTransferQuantity = (
    input: unknown,
    product: StockTransferQuantityRules,
) => {
    const saleMode = product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED';
    const quantityStep = product.quantityStep?.toString()
        || (saleMode === 'COUNTED' ? '1' : '0.0001');
    return validateQuantity(input, { saleMode, quantityStep });
};
