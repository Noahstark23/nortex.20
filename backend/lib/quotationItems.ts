import Decimal from 'decimal.js';
import { QuantityValidationError, validateQuantity, type SaleMode } from '../../utils/quantity.js';

type DecimalLike = Decimal.Value | { toString(): string };

export interface QuotationProductAuthority {
    id: string;
    name: string;
    price: DecimalLike;
    unit: string | null;
    ivaExento: boolean;
    saleMode: string | null;
    quantityStep: DecimalLike | null;
}

export interface RawQuotationItem {
    id?: string;
    productId?: string;
    quantity: Decimal.Value;
    price?: Decimal.Value;
    name?: string;
}

export interface StoredQuotationItemLike {
    id?: string;
    productId: string;
    quantity: number;
    quantityExact: DecimalLike | null;
    price: DecimalLike;
    unitPriceExact?: DecimalLike | null;
    unitAtQuote?: string | null;
    saleModeAtQuote?: string | null;
    quantityStepAtQuote?: DecimalLike | null;
    presentationAtQuote?: string | null;
    presentationQuantityAtQuote?: DecimalLike | null;
    ivaExentoAtQuote?: boolean | null;
    name: string;
}

export interface ResolvedQuotationItem {
    productId: string;
    name: string;
    unit: string;
    saleMode: SaleMode;
    quantityStep: string;
    ivaExento: boolean;
    price: Decimal;
    quantityExact: Decimal;
    quantityLegacy: number;
    presentationAtQuote: 'BASE';
    presentationQuantityAtQuote: Decimal;
}

export class QuotationItemError extends Error {
    constructor(
        public readonly code: 'PRODUCT_NOT_FOUND' | 'INVALID_QUANTITY' | 'INVALID_INPUT',
        message: string,
    ) {
        super(message);
        this.name = 'QuotationItemError';
    }
}

const quantityRulesForQuotationProduct = (
    product: Pick<QuotationProductAuthority, 'saleMode' | 'quantityStep'>,
): { saleMode: SaleMode; quantityStep: Decimal.Value } => ({
    saleMode: product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
    quantityStep: product.quantityStep?.toString() || (product.saleMode === 'COUNTED' ? '1' : '0.0001'),
});

export const legacyQuotationQuantity = (exactQuantity: Decimal.Value): number => {
    const exact = new Decimal(exactQuantity);
    if (exact.isInteger() && exact.lessThanOrEqualTo(2_147_483_647)) return exact.toNumber();
    return Decimal.min(exact.ceil(), 2_147_483_647).toNumber();
};

export const resolveQuotationItems = (
    items: RawQuotationItem[],
    products: readonly QuotationProductAuthority[],
): ResolvedQuotationItem[] => {
    const productById = new Map(products.map((product) => [product.id, product]));

    return items.map((item) => {
        const productId = String(item.productId ?? item.id ?? '').trim();
        if (!productId) {
            throw new QuotationItemError('INVALID_INPUT', 'Cada item debe indicar un producto');
        }
        const product = productById.get(productId);
        if (!product) {
            throw new QuotationItemError('PRODUCT_NOT_FOUND', `Producto no encontrado en este negocio: ${productId}`);
        }

        let quantityExact: Decimal;
        try {
            quantityExact = validateQuantity(item.quantity, quantityRulesForQuotationProduct(product));
        } catch (error) {
            if (error instanceof QuantityValidationError) {
                throw new QuotationItemError('INVALID_QUANTITY', `${product.name}: ${error.message}`);
            }
            throw error;
        }

        return {
            productId: product.id,
            name: product.name,
            unit: product.unit?.trim() || 'unidad',
            saleMode: quantityRulesForQuotationProduct(product).saleMode,
            quantityStep: quantityRulesForQuotationProduct(product).quantityStep.toString(),
            ivaExento: product.ivaExento === true,
            price: new Decimal(product.price.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
            quantityExact,
            quantityLegacy: legacyQuotationQuantity(quantityExact),
            presentationAtQuote: 'BASE',
            presentationQuantityAtQuote: quantityExact,
        };
    });
};

export const serializeQuotationItemsForClient = (
    items: StoredQuotationItemLike[],
    products: readonly QuotationProductAuthority[],
) => {
    const productById = new Map(products.map((product) => [product.id, product]));

    return items.map((item) => {
        const product = productById.get(item.productId);
        const effectiveQuantity = item.quantityExact
            ? new Decimal(item.quantityExact.toString())
            : new Decimal(item.quantity);
        const exactPrice = new Decimal((item.unitPriceExact ?? item.price).toString())
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        const unit = item.unitAtQuote?.trim() || product?.unit?.trim() || 'unidad';
        const saleMode = item.saleModeAtQuote === 'COUNTED'
            ? 'COUNTED'
            : item.saleModeAtQuote === 'MEASURED'
                ? 'MEASURED'
                : product?.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED';
        const quantityStep = item.quantityStepAtQuote?.toString()
            || product?.quantityStep?.toString()
            || (saleMode === 'COUNTED' ? '1' : '0.0001');
        const presentationAtQuote = item.presentationAtQuote === 'PACK' ? 'PACK' : 'BASE';
        const presentationQuantity = item.presentationQuantityAtQuote
            ? new Decimal(item.presentationQuantityAtQuote.toString())
            : effectiveQuantity;
        // El POS identifica PACK comparando presentation.unit con packUnit. La
        // etiqueta genérica evita consultar/reinterpretar el empaque actual;
        // quotationItemId hace que el servidor use el snapshot persistido.
        const presentationUnit = presentationAtQuote === 'PACK' ? 'empaque' : unit;
        return {
            id: item.productId,
            productId: item.productId,
            quotationItemId: item.id,
            cartLineId: item.id ? `quotation:${item.id}` : undefined,
            name: item.name,
            price: Number(exactPrice.toFixed(4)),
            basePrice: Number(exactPrice.toFixed(4)),
            unitPriceExact: exactPrice.toFixed(4),
            quantity: Number(effectiveQuantity.toString()),
            quantityExact: effectiveQuantity.toString(),
            unit,
            saleMode,
            quantityStep,
            presentationAtQuote,
            presentation: {
                quantity: presentationQuantity.toString(),
                unit: presentationUnit,
            },
            ...(presentationAtQuote === 'PACK' ? { packUnit: presentationUnit } : {}),
            ivaExento: item.ivaExentoAtQuote ?? product?.ivaExento === true,
        };
    });
};
