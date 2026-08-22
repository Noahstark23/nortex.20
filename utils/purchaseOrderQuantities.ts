/**
 * Reglas puras de cantidades para órdenes de compra.
 *
 * El navegador puede usar estas funciones para orientar la captura, pero el
 * servidor siempre vuelve a cargar los productos del tenant y ejecuta la misma
 * validación antes de persistir o mover inventario.
 */
import Decimal from 'decimal.js';
import {
    QUANTITY_DECIMAL_PLACES,
    QuantityValidationError,
    validateQuantity,
    type SaleMode,
} from './quantity';

export type PurchaseOrderQuantityErrorCode =
    | 'INVALID_LINE'
    | 'DUPLICATE_PRODUCT'
    | 'PRODUCT_NOT_IN_TENANT'
    | 'INVALID_UNIT_COST'
    | 'DUPLICATE_ITEM'
    | 'ITEM_NOT_IN_ORDER'
    | 'INVALID_PRODUCT_RULES'
    | 'INVALID_ORDER_SNAPSHOT'
    | 'CORRUPT_ORDER_QUANTITY'
    | 'OVER_RECEIPT';

export class PurchaseOrderQuantityError extends Error {
    constructor(
        public readonly code: PurchaseOrderQuantityErrorCode,
        message: string,
        public readonly context: Record<string, string> = {},
    ) {
        super(message);
        this.name = 'PurchaseOrderQuantityError';
    }
}

type DecimalLike = Decimal.Value | { toString(): string };

export interface PurchaseOrderProductAuthority {
    id: string;
    name: string;
    unit: string;
    saleMode: string | null;
    quantityStep: DecimalLike | null;
}

export interface PurchaseOrderItemAuthority {
    id: string;
    productId: string;
    productName: string;
    quantityOrdered: DecimalLike;
    quantityReceived: DecimalLike;
    quantityOrderedExact?: DecimalLike | null;
    quantityReceivedExact?: DecimalLike | null;
    unitAtOrder?: string | null;
    saleModeAtOrder?: string | null;
    quantityStepAtOrder?: DecimalLike | null;
}

export interface PurchaseOrderQuantityRules {
    saleMode: SaleMode;
    quantityStep: string;
}

export interface NormalizedPurchaseOrderLine {
    productId: string;
    productName: string;
    quantity: Decimal;
    unitCost: Decimal;
    unitAtOrder: string;
    saleModeAtOrder: SaleMode;
    quantityStepAtOrder: string;
}

export interface NormalizedReceiptLine<TItem extends PurchaseOrderItemAuthority = PurchaseOrderItemAuthority> {
    item: TItem;
    quantity: Decimal;
    ordered: Decimal;
    receivedBefore: Decimal;
    receivedAfter: Decimal;
    remainingBefore: Decimal;
    rules: PurchaseOrderQuantityRules;
    unitAtOrder: string;
}

const MAX_UNIT_COST = new Decimal('99999999.99');

const parseIdentifier = (value: unknown, field: 'productId' | 'itemId'): string => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new PurchaseOrderQuantityError('INVALID_LINE', `${field} es requerido`);
    }
    return value.trim();
};

const parseUnitCost = (value: unknown): Decimal => {
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new PurchaseOrderQuantityError('INVALID_UNIT_COST', 'El costo unitario no es válido');
    }
    if (typeof value === 'string' && value.trim() === '') {
        throw new PurchaseOrderQuantityError('INVALID_UNIT_COST', 'El costo unitario no es válido');
    }

    let cost: Decimal;
    try {
        cost = new Decimal(typeof value === 'string' ? value.trim() : value.toString());
    } catch {
        throw new PurchaseOrderQuantityError('INVALID_UNIT_COST', 'El costo unitario no es válido');
    }
    if (!cost.isFinite() || cost.isNegative() || cost.decimalPlaces() > 2 || cost.greaterThan(MAX_UNIT_COST)) {
        throw new PurchaseOrderQuantityError(
            'INVALID_UNIT_COST',
            'El costo unitario debe ser finito, no negativo y tener hasta 2 decimales',
        );
    }
    return cost;
};

/** D6: solo COUNTED explícito exige enteros; el legado null conserva fracciones. */
export const purchaseOrderRulesForProduct = (
    product: Pick<PurchaseOrderProductAuthority, 'saleMode' | 'quantityStep'>,
): PurchaseOrderQuantityRules => {
    if (product.saleMode !== null && product.saleMode !== 'COUNTED' && product.saleMode !== 'MEASURED') {
        throw new PurchaseOrderQuantityError(
            'INVALID_PRODUCT_RULES',
            'El producto tiene un modo de cantidad inválido',
        );
    }
    const saleMode: SaleMode = product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED';
    return {
        saleMode,
        quantityStep: product.quantityStep?.toString()
            || (saleMode === 'COUNTED' ? '1' : '0.0001'),
    };
};

const quantityError = (error: unknown, label: string): never => {
    if (error instanceof QuantityValidationError) {
        throw new PurchaseOrderQuantityError('INVALID_LINE', `${label}: ${error.message}`, {
            quantityCode: error.code,
        });
    }
    throw error;
};

/** Extrae ids válidos y rechaza productos repetidos antes de consultar la BD. */
export const extractPurchaseOrderProductIds = (items: unknown[]): string[] => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const raw of items) {
        if (!raw || typeof raw !== 'object') {
            throw new PurchaseOrderQuantityError('INVALID_LINE', 'Cada ítem debe ser un objeto');
        }
        const id = parseIdentifier((raw as { productId?: unknown }).productId, 'productId');
        if (seen.has(id)) {
            throw new PurchaseOrderQuantityError(
                'DUPLICATE_PRODUCT',
                'No se puede repetir el mismo producto en una orden de compra',
                { productId: id },
            );
        }
        seen.add(id);
        ids.push(id);
    }
    return ids;
};

/** Normaliza creación con producto, modo, paso, unidad y costo autoritativos. */
export const normalizePurchaseOrderLines = (
    rawItems: unknown[],
    products: PurchaseOrderProductAuthority[],
): NormalizedPurchaseOrderLine[] => {
    const ids = extractPurchaseOrderProductIds(rawItems);
    const productById = new Map(products.map(product => [product.id, product]));

    return rawItems.map((raw, index) => {
        const item = raw as { quantity?: unknown; unitCost?: unknown };
        const productId = ids[index];
        const product = productById.get(productId);
        if (!product) {
            throw new PurchaseOrderQuantityError(
                'PRODUCT_NOT_IN_TENANT',
                'Uno o más productos no pertenecen a tu negocio',
                { productId },
            );
        }
        if (typeof product.unit !== 'string' || product.unit.trim() === '') {
            throw new PurchaseOrderQuantityError(
                'INVALID_PRODUCT_RULES',
                `${product.name} no tiene una unidad base válida`,
                { productId },
            );
        }
        const rules = purchaseOrderRulesForProduct(product);
        let quantity: Decimal;
        try {
            quantity = validateQuantity(item.quantity, rules);
        } catch (error) {
            return quantityError(error, product.name);
        }

        return {
            productId,
            productName: product.name,
            quantity,
            unitCost: parseUnitCost(item.unitCost),
            unitAtOrder: product.unit.trim(),
            saleModeAtOrder: rules.saleMode,
            quantityStepAtOrder: rules.quantityStep,
        };
    });
};

const exactOrLegacy = (
    exact: DecimalLike | null | undefined,
    legacy: DecimalLike,
    label: string,
): Decimal => {
    let value: Decimal;
    try {
        value = new Decimal(exact == null ? legacy.toString() : exact.toString());
    } catch {
        throw new PurchaseOrderQuantityError('CORRUPT_ORDER_QUANTITY', `${label} no es válida`);
    }
    if (!value.isFinite() || value.isNegative() || value.decimalPlaces() > QUANTITY_DECIMAL_PLACES) {
        throw new PurchaseOrderQuantityError('CORRUPT_ORDER_QUANTITY', `${label} no es válida`);
    }
    return value;
};

export const orderedQuantityForItem = (item: PurchaseOrderItemAuthority): Decimal =>
    exactOrLegacy(item.quantityOrderedExact, item.quantityOrdered, 'La cantidad ordenada');

export const receivedQuantityForItem = (item: PurchaseOrderItemAuthority): Decimal =>
    exactOrLegacy(item.quantityReceivedExact, item.quantityReceived, 'La cantidad recibida');

/**
 * Usa el snapshot completo para filas nuevas. Solo si todo el snapshot falta
 * (fila histórica) toma la configuración actual del producto tenant-scoped.
 */
export const purchaseOrderRulesForReceipt = (
    item: PurchaseOrderItemAuthority,
    product: PurchaseOrderProductAuthority,
): PurchaseOrderQuantityRules => {
    const hasMode = item.saleModeAtOrder != null;
    const hasStep = item.quantityStepAtOrder != null;
    const hasUnit = item.unitAtOrder != null;
    const hasAnySnapshot = hasMode || hasStep || hasUnit;
    if (hasAnySnapshot && !(hasMode && hasStep && hasUnit)) {
        throw new PurchaseOrderQuantityError(
            'INVALID_ORDER_SNAPSHOT',
            `La orden de ${item.productName} tiene un snapshot de cantidad o unidad incompleto`,
        );
    }
    if (!hasAnySnapshot) {
        if (typeof product.unit !== 'string' || product.unit.trim() === '') {
            throw new PurchaseOrderQuantityError(
                'INVALID_PRODUCT_RULES',
                `${product.name} no tiene una unidad base válida`,
                { productId: product.id },
            );
        }
        return purchaseOrderRulesForProduct(product);
    }
    if (typeof item.unitAtOrder !== 'string' || item.unitAtOrder.trim() === '') {
        throw new PurchaseOrderQuantityError(
            'INVALID_ORDER_SNAPSHOT',
            `La orden de ${item.productName} tiene una unidad inválida`,
        );
    }
    if (item.saleModeAtOrder !== 'COUNTED' && item.saleModeAtOrder !== 'MEASURED') {
        throw new PurchaseOrderQuantityError(
            'INVALID_ORDER_SNAPSHOT',
            `La orden de ${item.productName} tiene un modo de cantidad inválido`,
        );
    }
    const rules: PurchaseOrderQuantityRules = {
        saleMode: item.saleModeAtOrder,
        quantityStep: item.quantityStepAtOrder!.toString(),
    };
    // Valida también la forma del paso aunque la cantidad concreta se valide después.
    try {
        validateQuantity(rules.quantityStep, rules);
    } catch (error) {
        return quantityError(error, item.productName);
    }
    return rules;
};

/** Valida líneas de recepción y calcula saldos exclusivamente con Decimal. */
export const normalizePurchaseOrderReceiptLines = <TItem extends PurchaseOrderItemAuthority>(
    rawLines: unknown[],
    orderItems: TItem[],
    products: PurchaseOrderProductAuthority[],
): NormalizedReceiptLine<TItem>[] => {
    const itemById = new Map(orderItems.map(item => [item.id, item]));
    const productById = new Map(products.map(product => [product.id, product]));
    const seen = new Set<string>();

    return rawLines.map(raw => {
        if (!raw || typeof raw !== 'object') {
            throw new PurchaseOrderQuantityError('INVALID_LINE', 'Cada recepción debe ser un objeto');
        }
        const candidate = raw as { itemId?: unknown; quantityReceived?: unknown };
        const itemId = parseIdentifier(candidate.itemId, 'itemId');
        if (seen.has(itemId)) {
            throw new PurchaseOrderQuantityError(
                'DUPLICATE_ITEM',
                'Hay líneas repetidas del mismo ítem en la recepción',
                { itemId },
            );
        }
        seen.add(itemId);
        const item = itemById.get(itemId);
        if (!item) {
            throw new PurchaseOrderQuantityError(
                'ITEM_NOT_IN_ORDER',
                'Una línea no pertenece a esta orden de compra',
                { itemId },
            );
        }
        const product = productById.get(item.productId);
        if (!product) {
            throw new PurchaseOrderQuantityError(
                'PRODUCT_NOT_IN_TENANT',
                'Uno o más productos no pertenecen a tu negocio',
                { productId: item.productId },
            );
        }
        const rules = purchaseOrderRulesForReceipt(item, product);
        let quantity: Decimal;
        try {
            quantity = validateQuantity(candidate.quantityReceived, rules);
        } catch (error) {
            return quantityError(error, item.productName);
        }

        const ordered = orderedQuantityForItem(item);
        const receivedBefore = receivedQuantityForItem(item);
        if (!ordered.greaterThan(0) || receivedBefore.greaterThan(ordered)) {
            throw new PurchaseOrderQuantityError(
                'CORRUPT_ORDER_QUANTITY',
                `Las cantidades históricas de ${item.productName} son inconsistentes`,
            );
        }
        try {
            validateQuantity(ordered, rules);
            if (!receivedBefore.isZero()) validateQuantity(receivedBefore, rules);
        } catch {
            throw new PurchaseOrderQuantityError(
                'CORRUPT_ORDER_QUANTITY',
                `Las cantidades históricas de ${item.productName} no respetan el modo o paso congelado`,
            );
        }
        const remainingBefore = ordered.minus(receivedBefore);
        if (quantity.greaterThan(remainingBefore)) {
            throw new PurchaseOrderQuantityError(
                'OVER_RECEIPT',
                `No podés recibir más de lo pedido: a "${item.productName}" le quedan ${remainingBefore.toString()} por recibir`,
                { itemId, productName: item.productName, remaining: remainingBefore.toString() },
            );
        }

        return {
            item,
            quantity,
            ordered,
            receivedBefore,
            receivedAfter: receivedBefore.plus(quantity),
            remainingBefore,
            rules,
            unitAtOrder: item.unitAtOrder?.trim() || product.unit.trim(),
        };
    });
};

/** Sanitizador de input: un punto decimal y como máximo cuatro decimales. */
export const sanitizePurchaseQuantityInput = (raw: string): string => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    if (dot < 0) return cleaned;
    const integer = cleaned.slice(0, dot);
    const fraction = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, QUANTITY_DECIMAL_PLACES);
    return `${integer}.${fraction}`;
};
