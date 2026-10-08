import Decimal from 'decimal.js';

export interface ReceivedPurchaseOrderItem {
    productId: string;
    productName: string;
    quantityReceived: number | string;
    quantityReceivedExact?: number | string | Decimal | null;
}

export interface PreviouslyInvoicedPurchaseItem {
    productId: string;
    quantity: number | string;
    quantityExact?: number | string | Decimal | null;
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
        const received = new Decimal(
            item.quantityReceivedExact?.toString() ?? item.quantityReceived.toString(),
        );
        const current = availability.get(item.productId);
        if (current) {
            current.remaining = current.remaining.plus(received);
        } else {
            availability.set(item.productId, {
                productName: item.productName,
                remaining: received,
            });
        }
    }

    for (const invoice of priorInvoices) {
        for (const item of invoice.items) {
            const current = availability.get(item.productId);
            if (current) {
                const invoiced = item.quantityExact?.toString() ?? item.quantity.toString();
                current.remaining = current.remaining.minus(invoiced);
            }
        }
    }

    return availability;
}
