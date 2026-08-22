import Decimal from 'decimal.js';
import { QuantityValidationError, validateQuantity } from '../../utils/quantity.js';
import {
    calculateAuthoritativeUnitPrice,
    effectiveSaleModeAndStep,
} from './saleItemMeasurementService.js';

type DecimalLike = Decimal.Value | { toString(): string };

export interface PublicOrderProductAuthority {
    id: string;
    tenantId: string;
    isPublished: boolean;
    name: string;
    unit: string;
    price: number;
    cost: number;
    ivaExento: boolean;
    saleMode: string | null;
    quantityStep: DecimalLike | null;
    wholesalePrice: number | null;
    wholesaleMinQty: number | null;
    packUnit: string | null;
    packSize: number | null;
    packPrice: number | null;
    requiresBatchTracking: boolean;
}

export interface PublicOrderItemInput {
    productId: string;
    quantity: Decimal.Value;
    presentation?: 'BASE' | 'PACK';
}

export interface ResolvedPublicOrderItem {
    productId: string;
    productName: string;
    unit: string;
    saleMode: 'COUNTED' | 'MEASURED';
    quantityStep: string;
    quantityExact: Decimal;
    quantityLegacy: number;
    unitPrice: Decimal;
    cost: Decimal;
    subtotal: Decimal;
    ivaExento: boolean;
    requiresBatchTracking: boolean;
    presentationAtSale: 'BASE' | 'PACK';
    presentationQuantityAtSale: Decimal;
}

export type PublicOrderItemErrorCode =
    | 'PRODUCT_NOT_FOUND'
    | 'PRODUCT_NOT_PUBLIC'
    | 'INVALID_QUANTITY'
    | 'INVALID_PRODUCT_CONFIGURATION'
    | 'DUPLICATE_PRODUCT'
    | 'RECONCILIATION_REQUIRED';

export class PublicOrderItemError extends Error {
    constructor(
        public readonly code: PublicOrderItemErrorCode,
        message: string,
        public readonly httpStatus = 400,
    ) {
        super(message);
        this.name = 'PublicOrderItemError';
    }
}

/** Sombra Int compatible; ningún cálculo nuevo vuelve a leerla. */
export const legacyPublicOrderQuantity = (quantity: Decimal.Value): number => {
    const exact = new Decimal(quantity);
    if (exact.isInteger() && exact.lessThanOrEqualTo(2_147_483_647)) return exact.toNumber();
    return Decimal.min(exact.ceil(), 2_147_483_647).toNumber();
};

const productRules = (product: PublicOrderProductAuthority) =>
    effectiveSaleModeAndStep(product.saleMode, product.quantityStep?.toString() ?? null);

const validateForProduct = (
    product: PublicOrderProductAuthority,
    quantity: Decimal.Value,
): Decimal => {
    const rules = productRules(product);
    try {
        return validateQuantity(quantity, rules);
    } catch (error) {
        if (error instanceof QuantityValidationError) {
            throw new PublicOrderItemError(
                'INVALID_QUANTITY',
                `${product.name}: ${error.message}`,
            );
        }
        throw error;
    }
};

/**
 * Resuelve cantidades y precio público únicamente desde producto persistido.
 * `quantity` representa unidades de la presentación elegida; para PACK el
 * factor siempre sale de Product.packSize, nunca del navegador.
 */
export const resolvePublicOrderItems = (
    tenantId: string,
    items: readonly PublicOrderItemInput[],
    products: readonly PublicOrderProductAuthority[],
): ResolvedPublicOrderItem[] => {
    const productById = new Map(products.map((product) => [product.id, product]));
    const seen = new Set<string>();

    return items.map((item) => {
        const presentation = item.presentation ?? 'BASE';
        const lineIdentity = `${item.productId}:${presentation}`;
        if (seen.has(lineIdentity)) {
            throw new PublicOrderItemError(
                'DUPLICATE_PRODUCT',
                `El producto ${item.productId} aparece más de una vez en presentación ${presentation}`,
            );
        }
        seen.add(lineIdentity);

        const product = productById.get(item.productId);
        if (!product || product.tenantId !== tenantId) {
            throw new PublicOrderItemError(
                'PRODUCT_NOT_FOUND',
                'Producto no encontrado en este negocio',
                404,
            );
        }
        if (!product.isPublished) {
            throw new PublicOrderItemError(
                'PRODUCT_NOT_PUBLIC',
                `${product.name} no está disponible en el catálogo público`,
                404,
            );
        }
        if (!product.unit.trim()) {
            throw new PublicOrderItemError(
                'INVALID_PRODUCT_CONFIGURATION',
                `${product.name} no tiene unidad base configurada`,
                409,
            );
        }

        let presentationQuantity: Decimal;
        let quantityExact: Decimal;
        if (presentation === 'PACK') {
            if (!product.packUnit?.trim() || product.packSize === null) {
                throw new PublicOrderItemError(
                    'INVALID_PRODUCT_CONFIGURATION',
                    `${product.name} no tiene una presentación de empaque válida`,
                    409,
                );
            }
            try {
                presentationQuantity = validateQuantity(item.quantity, {
                    saleMode: 'COUNTED',
                    quantityStep: '1',
                });
                const factor = validateQuantity(product.packSize, {
                    saleMode: 'MEASURED',
                    quantityStep: '0.0001',
                });
                quantityExact = validateForProduct(product, presentationQuantity.mul(factor));
            } catch (error) {
                if (error instanceof PublicOrderItemError) throw error;
                if (error instanceof QuantityValidationError) {
                    throw new PublicOrderItemError(
                        'INVALID_QUANTITY',
                        `${product.name}: ${error.message}`,
                    );
                }
                throw error;
            }
        } else {
            quantityExact = validateForProduct(product, item.quantity);
            presentationQuantity = quantityExact;
        }

        let unitPrice: Decimal;
        try {
            unitPrice = calculateAuthoritativeUnitPrice(product, quantityExact, false, presentation);
        } catch (error) {
            throw new PublicOrderItemError(
                'INVALID_PRODUCT_CONFIGURATION',
                error instanceof Error ? error.message : `Precio inválido para ${product.name}`,
                409,
            );
        }
        const cost = new Decimal(product.cost);
        if (!cost.isFinite() || cost.isNegative()) {
            throw new PublicOrderItemError(
                'INVALID_PRODUCT_CONFIGURATION',
                `${product.name} tiene un costo inválido`,
                409,
            );
        }
        const rules = productRules(product);

        return {
            productId: product.id,
            productName: product.name,
            unit: product.unit,
            saleMode: rules.saleMode,
            quantityStep: rules.quantityStep,
            quantityExact,
            quantityLegacy: legacyPublicOrderQuantity(quantityExact),
            unitPrice,
            cost: cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
            subtotal: unitPrice.mul(quantityExact).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
            ivaExento: product.ivaExento === true,
            requiresBatchTracking: product.requiresBatchTracking,
            presentationAtSale: presentation,
            presentationQuantityAtSale: presentationQuantity,
        };
    });
};

export const exactPedidoItemQuantity = (item: {
    cantidad: number;
    cantidadExact: DecimalLike | null;
}): Decimal => {
    try {
        return validateQuantity(item.cantidadExact?.toString() ?? item.cantidad, {
            // La regla histórica ya se validó al originar el Pedido. Aquí solo
            // se exige una cantidad Decimal(18,4) positiva sin reinterpretarla
            // con una configuración de producto que pudo cambiar después.
            saleMode: 'MEASURED',
            quantityStep: '0.0001',
        });
    } catch (error) {
        throw new PublicOrderItemError(
            'INVALID_QUANTITY',
            error instanceof Error ? error.message : 'Cantidad de pedido inválida',
            409,
        );
    }
};

export interface StoredPublicOrderItem {
    productId?: unknown;
    name?: unknown;
    quantity?: unknown;
    quantityExact?: unknown;
    price?: unknown;
    unitPriceExact?: unknown;
    unit?: unknown;
    saleMode?: unknown;
    quantityStep?: unknown;
    presentationAtSale?: unknown;
    presentationQuantityAtSale?: unknown;
    ivaExento?: unknown;
}

export interface PublicOrderQuotationItem {
    productId: string;
    name: string;
    quantityExact: Decimal;
    quantityLegacy: number;
    unitPriceExact: Decimal;
    priceLegacy: Decimal;
    lineTotal: Decimal;
    unit: string;
    saleMode: 'COUNTED' | 'MEASURED';
    quantityStep: Decimal;
    presentationAtQuote: 'BASE' | 'PACK';
    presentationQuantityAtQuote: Decimal;
    ivaExento: boolean;
}

/**
 * Interpreta el snapshot ya aceptado del pedido sin consultar la configuracion
 * actual del producto. Esto preserva tanto la cantidad exacta como el precio
 * pactado aunque luego cambien el paso, el modo o el precio del catalogo.
 */
export const publicOrderItemsForQuotation = (
    raw: unknown,
): PublicOrderQuotationItem[] => {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new PublicOrderItemError('INVALID_QUANTITY', 'El pedido no contiene items validos', 409);
    }

    return raw.map((untrusted, index) => {
        if (!untrusted || typeof untrusted !== 'object') {
            throw new PublicOrderItemError('INVALID_QUANTITY', `Item ${index + 1} invalido`, 409);
        }
        const item = untrusted as StoredPublicOrderItem;
        const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!productId || !name) {
            throw new PublicOrderItemError('INVALID_QUANTITY', `Item ${index + 1} incompleto`, 409);
        }

        // Los pedidos anteriores al contrato de snapshots no pueden
        // reinterpretarse con defaults: hacerlo cambiaría precio, IVA, modo o
        // presentación sin evidencia. Se envían a conciliación explícita.
        if (
            item.quantityExact === undefined
            || item.quantityExact === null
            || item.unitPriceExact === undefined
            || item.unitPriceExact === null
            || typeof item.unit !== 'string'
            || !item.unit.trim()
            || (item.saleMode !== 'COUNTED' && item.saleMode !== 'MEASURED')
            || item.quantityStep === undefined
            || item.quantityStep === null
            || (item.presentationAtSale !== 'BASE' && item.presentationAtSale !== 'PACK')
            || item.presentationQuantityAtSale === undefined
            || item.presentationQuantityAtSale === null
            || typeof item.ivaExento !== 'boolean'
        ) {
            throw new PublicOrderItemError(
                'RECONCILIATION_REQUIRED',
                `${name}: el pedido es anterior a los snapshots exactos y requiere conciliación`,
                409,
            );
        }

        let quantityExact: Decimal;
        try {
            quantityExact = validateQuantity(
                item.quantityExact,
                { saleMode: 'MEASURED', quantityStep: '0.0001' },
            );
        } catch (error) {
            throw new PublicOrderItemError(
                'INVALID_QUANTITY',
                error instanceof Error ? `${name}: ${error.message}` : `${name}: cantidad invalida`,
                409,
            );
        }

        const rawPrice = item.unitPriceExact;
        let unitPriceExact: Decimal;
        try {
            unitPriceExact = new Decimal(String(rawPrice));
        } catch {
            throw new PublicOrderItemError('INVALID_QUANTITY', `${name}: precio historico invalido`, 409);
        }
        if (!unitPriceExact.isFinite() || !unitPriceExact.greaterThan(0) || unitPriceExact.decimalPlaces() > 4) {
            throw new PublicOrderItemError('INVALID_QUANTITY', `${name}: precio historico invalido`, 409);
        }
        unitPriceExact = unitPriceExact.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

        const unit = item.unit.trim();
        const saleMode = item.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED';
        let quantityStep: Decimal;
        try {
            quantityStep = new Decimal(String(item.quantityStep ?? (saleMode === 'COUNTED' ? 1 : '0.0001')));
        } catch {
            throw new PublicOrderItemError('INVALID_QUANTITY', `${name}: paso histórico inválido`, 409);
        }
        if (
            !quantityStep.isFinite()
            || !quantityStep.greaterThan(0)
            || quantityStep.decimalPlaces() > 4
            || (saleMode === 'COUNTED' && !quantityStep.isInteger())
        ) {
            throw new PublicOrderItemError('INVALID_QUANTITY', `${name}: paso histórico inválido`, 409);
        }
        try {
            quantityExact = validateQuantity(quantityExact, { saleMode, quantityStep });
        } catch (error) {
            throw new PublicOrderItemError(
                'INVALID_QUANTITY',
                error instanceof Error ? `${name}: ${error.message}` : `${name}: cantidad histórica inválida`,
                409,
            );
        }
        const presentationAtQuote = item.presentationAtSale === 'PACK' ? 'PACK' : 'BASE';
        let presentationQuantityAtQuote: Decimal;
        try {
            presentationQuantityAtQuote = validateQuantity(
                item.presentationQuantityAtSale,
                presentationAtQuote === 'PACK'
                    ? { saleMode: 'COUNTED', quantityStep: '1' }
                    : { saleMode: 'MEASURED', quantityStep: '0.0001' },
            );
        } catch (error) {
            throw new PublicOrderItemError(
                'INVALID_QUANTITY',
                error instanceof Error ? `${name}: ${error.message}` : `${name}: presentación histórica inválida`,
                409,
            );
        }
        if (presentationAtQuote === 'BASE' && !presentationQuantityAtQuote.equals(quantityExact)) {
            throw new PublicOrderItemError(
                'INVALID_QUANTITY',
                `${name}: la presentación base no coincide con la cantidad exacta`,
                409,
            );
        }

        return {
            productId,
            name,
            quantityExact,
            quantityLegacy: legacyPublicOrderQuantity(quantityExact),
            unitPriceExact,
            priceLegacy: unitPriceExact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
            lineTotal: unitPriceExact.mul(quantityExact).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
            unit,
            saleMode,
            quantityStep,
            presentationAtQuote,
            presentationQuantityAtQuote,
            ivaExento: item.ivaExento,
        };
    });
};
