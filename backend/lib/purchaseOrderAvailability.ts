import Decimal from 'decimal.js';

export interface ReceivedPurchaseOrderItem {
    productId: string;
    productName: string;
    quantityReceived: number | string;
}

export interface PreviouslyInvoicedPurchaseItem {
    productId: string;
    quantity: number | string;
}

export interface PurchaseOrderInvoiceAvailability {
    productName: string;
    remaining: Decimal;
}

/**
 * Calcula cuántas unidades ya recibidas siguen disponibles para facturar.
 * Agrega por producto para tolerar OCs históricas con líneas duplicadas y
 * descuenta todas las facturas parciales vinculadas previamente.
 */
export function calculatePurchaseOrderInvoiceAvailability(
    receivedItems: ReceivedPurchaseOrderItem[],
    priorInvoices: { items: PreviouslyInvoicedPurchaseItem[] }[],
): Map<string, PurchaseOrderInvoiceAvailability> {
    const availability = new Map<string, PurchaseOrderInvoiceAvailability>();

    for (const item of receivedItems) {
        const current = availability.get(item.productId);
        if (current) {
            current.remaining = current.remaining.plus(item.quantityReceived.toString());
        } else {
            availability.set(item.productId, {
                productName: item.productName,
                remaining: new Decimal(item.quantityReceived.toString()),
            });
        }
    }

    for (const invoice of priorInvoices) {
        for (const item of invoice.items) {
            const current = availability.get(item.productId);
            if (current) current.remaining = current.remaining.minus(item.quantity.toString());
        }
    }

    return availability;
}
