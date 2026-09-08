export type RefundMethod = 'CASH' | 'CARD' | 'QR' | 'TRANSFER';
export type CorrectionResolution = 'REFUND' | 'EXCHANGE' | 'STORE_CREDIT';
export type ReturnDisposition = 'RESTOCK' | 'QUARANTINE' | 'LOSS';

export interface SalesLedgerItem {
    id: string;
    invoiceNumber: number | null;
    invoiceSeries: string | null;
    createdAt: string;
    total: string | number;
    status: string;
    paymentMethod: string;
    customerName: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    _count: { items: number; productReturns: number; correctionRequests: number };
}

export interface ReturnableLine {
    saleItemId: string;
    productId: string;
    productNameAtSale: string;
    unitAtSale: string;
    returnableQuantity: string;
    quantityStep: string;
    refundUnitPrice: string;
}

export interface ReturnableSale {
    id: string;
    total: string | number;
    status: string;
    cancelledAt: string | null;
    customerId?: string | null;
    customerName?: string | null;
    invoiceNumber?: number | null;
    invoiceSeries?: string | null;
    allowedRefundMethods: RefundMethod[];
    items: ReturnableLine[];
}

export interface CorrectionRequest {
    id: string;
    saleId: string;
    kind: 'RETURN' | 'VOID';
    status: string;
    reason: string;
    resolution: CorrectionResolution | null;
    refundMethod: RefundMethod | null;
    requestedBy: string;
    approvedBy: string | null;
    createdAt: string;
    lines: Array<{
        id: string;
        saleItemId: string;
        quantity: string;
        disposition: ReturnDisposition;
        saleItem?: { productNameAtSale: string | null; unitAtSale: string | null };
    }>;
    sale?: {
        invoiceNumber: number | null;
        invoiceSeries: string | null;
        total: string | number;
        customerId: string | null;
        customerName: string | null;
        createdAt: string;
    };
}
