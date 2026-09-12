import type { SaleMode } from './quantity.js';

export interface ProductQuantityConfiguration {
    unit?: string | null;
    saleMode?: string | null;
    quantityStep?: string | number | { toString(): string } | null;
}

/**
 * Reglas para nuevas operaciones con el catálogo actual. La configuración
 * explícita prevalece; solo las unidades contables conocidas sin modo ni paso
 * heredan enteros. Las unidades desconocidas conservan el contrato fraccionario
 * anterior. No usar para reinterpretar snapshots de documentos ya emitidos.
 */
export const resolveProductQuantityRules = (
    product: ProductQuantityConfiguration,
): { saleMode: SaleMode; quantityStep: string } => {
    const configuredStep = product.quantityStep?.toString() || null;
    const legacyCounted = !product.saleMode
        && configuredStep === null
        && product.unit
        && ['unidad', 'unidades', 'caja', 'cajas'].includes(product.unit.trim().toLowerCase());
    const saleMode: SaleMode = product.saleMode === 'COUNTED' || legacyCounted
        ? 'COUNTED'
        : 'MEASURED';
    return {
        saleMode,
        quantityStep: configuredStep ?? (saleMode === 'COUNTED' ? '1' : '0.0001'),
    };
};
