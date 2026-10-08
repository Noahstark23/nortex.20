import Decimal from 'decimal.js';
import { daysUntilManaguaCalendarDate } from './managuaBusinessDate.js';

export interface PharmacyExpiryAlertBatchInput {
    id: string;
    productId: string;
    batchNumber: string;
    expiryDate: Date;
    stock: Decimal.Value;
    product: { name: string; sku: string };
}

export interface PharmacyExpiryAlertExactBalance {
    stock: Decimal.Value;
    heldStock: Decimal.Value;
}

export type PharmacyExpiryAlertStatus = 'EXPIRED' | 'CRITICAL' | 'UPCOMING';

/**
 * DTO explícito para el dashboard: separa físico, retenido y vendible y
 * clasifica por día civil, nunca por la hora/zona del navegador.
 */
export function buildPharmacyExpiryAlert(params: {
    batch: PharmacyExpiryAlertBatchInput;
    exactBalance?: PharmacyExpiryAlertExactBalance;
    pharmacyEnforced: boolean;
    asOf: Date;
}) {
    const { batch, pharmacyEnforced, asOf } = params;
    const daysUntilExpiry = daysUntilManaguaCalendarDate(batch.expiryDate, asOf);
    const exact = params.exactBalance;
    const legacyPhysicalStock = new Decimal(batch.stock.toString());
    const physicalStock = pharmacyEnforced
        ? new Decimal(exact?.stock?.toString() ?? 0)
        : legacyPhysicalStock;
    const heldStock = pharmacyEnforced
        ? new Decimal(exact?.heldStock?.toString() ?? 0)
        : new Decimal(0);
    const sellableStock = daysUntilExpiry < 0
        ? new Decimal(0)
        : Decimal.max(physicalStock.minus(heldStock), 0);
    const status: PharmacyExpiryAlertStatus = daysUntilExpiry < 0
        ? 'EXPIRED'
        : daysUntilExpiry <= 30
            ? 'CRITICAL'
            : 'UPCOMING';

    return {
        id: batch.id,
        productId: batch.productId,
        productName: batch.product.name,
        sku: batch.product.sku,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        daysUntilExpiry,
        status,
        // Alias compatible para clientes anteriores del endpoint.
        stock: physicalStock.toDecimalPlaces(4).toNumber(),
        physicalStock: physicalStock.toDecimalPlaces(4).toNumber(),
        heldStock: heldStock.toDecimalPlaces(4).toNumber(),
        sellableStock: sellableStock.toDecimalPlaces(4).toNumber(),
        readinessMismatch: pharmacyEnforced
            && (!exact || !physicalStock.equals(legacyPhysicalStock)),
    };
}
