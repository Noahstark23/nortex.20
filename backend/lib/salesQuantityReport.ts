import Decimal from 'decimal.js';

type DecimalLike = Decimal.Value | { toString(): string };

export interface SalesQuantityLineLike {
    productId?: string | null;
    productNameAtSale?: string | null;
    unitAtSale?: string | null;
    saleModeAtSale?: string | null;
    presentationAtSale?: string | null;
    presentationQuantityAtSale?: DecimalLike | null;
    quantity: DecimalLike;
}

export interface SalesQuantityBreakdownRow {
    productId: string;
    productName: string;
    saleMode: 'COUNTED' | 'MEASURED';
    presentation: 'BASE' | 'PACK';
    baseUnit: string;
    displayUnit: string;
    usedFallbackUnit: boolean;
    quantity: string;
}

const decimal = (value: DecimalLike): Decimal => new Decimal(value.toString());

const normalizeQuantity = (value: Decimal): string => value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();

const normalizeBaseUnit = (unitAtSale: string | null | undefined): { baseUnit: string; usedFallbackUnit: boolean } => {
    const unit = typeof unitAtSale === 'string' ? unitAtSale.trim() : '';
    if (unit) return { baseUnit: unit, usedFallbackUnit: false };
    return { baseUnit: 'unidad', usedFallbackUnit: true };
};

export const buildSalesQuantityBreakdown = (
    items: readonly SalesQuantityLineLike[],
): SalesQuantityBreakdownRow[] => {
    const groups = new Map<string, {
        productId: string;
        productName: string;
        saleMode: 'COUNTED' | 'MEASURED';
        presentation: 'BASE' | 'PACK';
        baseUnit: string;
        displayUnit: string;
        usedFallbackUnit: boolean;
        quantity: Decimal;
    }>();

    for (const item of items) {
        const { baseUnit, usedFallbackUnit } = normalizeBaseUnit(item.unitAtSale);
        const saleMode = item.saleModeAtSale === 'COUNTED' ? 'COUNTED' : 'MEASURED';
        const presentation = item.presentationAtSale === 'PACK' ? 'PACK' : 'BASE';
        const effectiveQuantity = presentation === 'PACK' && item.presentationQuantityAtSale != null
            ? decimal(item.presentationQuantityAtSale)
            : decimal(item.quantity);
        const productId = String(item.productId ?? 'legacy-product');
        const productName = String(item.productNameAtSale || 'Producto legado');
        const displayUnit = presentation === 'PACK'
            ? `empaque(s) · base ${usedFallbackUnit ? `${baseUnit} (fallback)` : baseUnit}`
            : usedFallbackUnit ? `${baseUnit} (fallback)` : baseUnit;
        const key = [productId, productName, saleMode, presentation, displayUnit].join('::');
        const existing = groups.get(key);

        if (existing) {
            existing.quantity = existing.quantity.plus(effectiveQuantity);
            continue;
        }

        groups.set(key, {
            productId,
            productName,
            saleMode,
            presentation,
            baseUnit,
            displayUnit,
            usedFallbackUnit,
            quantity: effectiveQuantity,
        });
    }

    return [...groups.values()]
        .map((entry) => ({
            productId: entry.productId,
            productName: entry.productName,
            saleMode: entry.saleMode,
            presentation: entry.presentation,
            baseUnit: entry.baseUnit,
            displayUnit: entry.displayUnit,
            usedFallbackUnit: entry.usedFallbackUnit,
            quantity: normalizeQuantity(entry.quantity),
        }))
        .sort((left, right) =>
            left.productName.localeCompare(right.productName)
            || left.displayUnit.localeCompare(right.displayUnit)
            || left.presentation.localeCompare(right.presentation),
        );
};
