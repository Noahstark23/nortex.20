import type { SaleMode } from './quantity';

/** Resolver común del POS y servidor. No inferir la unidad por el nombre. */
export function resolveLegacySaleMode(product: {
    saleMode?: string | null;
    quantityStep?: unknown;
    unit?: string | null;
}): SaleMode {
    if (product.saleMode === 'COUNTED') return 'COUNTED';
    if (product.saleMode != null || product.quantityStep != null) return 'MEASURED';
    const unit = product.unit?.trim().toLowerCase();
    return unit === 'unidad' || unit === 'caja' || unit === 'cajas'
        ? 'COUNTED'
        : 'MEASURED';
}
