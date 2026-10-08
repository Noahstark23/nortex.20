/** Importes exactos en texto; una revisión no demuestra que la venta se registró. */
export interface SalePromotionSnapshot {
    id: string; version: number; name: string; percent: string; configHash: string;
    normalUnitPrice: string; unitPrice: string; startsAt: string; endsAt: string;
}
export interface PromotionCheckoutQuote {
    id: string; version: number; offlineId: string; expiresAt: string;
    total: string; vatAmount: string; exemptTotal: string; hasPromotions: boolean;
    fiscalRegime: string; fiscalRegimeVersion: number;
    warnings?: string[];
    lines: Array<{ productId: string; name: string; quantity: string; presentation: 'BASE' | 'PACK';
        presentationQuantity: string; unit: string; unitPrice: string; lineTotal: string; promotion: SalePromotionSnapshot | null }>;
}
export interface PromotionCheckoutResponse { enabled: boolean; quote: PromotionCheckoutQuote | null }
export interface PromotionQuoteReference { id: string; version: number }
export interface PromotionOperationResponse {
    status: 'COMMITTED' | 'NOT_FOUND';
    sale?: { id: string; total: string; paymentMethod: string; invoiceNumber: number | null; invoiceSeries: string | null;
        createdAt: string; vatAmountAtSale: string | null; fiscalRegimeAtSale: string | null; fiscalRegimeVersionAtSale: number | null;
        items: Array<{ productId: string; quantity: number; productNameAtSale: string | null; priceAtSale: string;
            unitPriceExactAtSale: string | null; discount: number; ivaExento: boolean; unitAtSale: string | null;
            presentationAtSale: string | null; presentationQuantityAtSale: string | null;
            promotionSnapshot: SalePromotionSnapshot | null }> };
}
export type PromotionOperationCancellation = PromotionOperationResponse | { status: 'CANCELLED' };
