import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

/**
 * Una línea sin salePrice no autoriza ninguna mutación del catálogo. El precio
 * solo cambia cuando el cliente expresa esta intención y el rol ya fue validado
 * por el handler de compras.
 */
export interface PurchaseSalePriceInput {
    productId: string;
    salePrice?: string | null;
}

export interface PurchaseSalePriceIntent {
    productId: string;
    salePrice: string;
}

export interface PurchaseSalePriceChange {
    productId: string;
    priceBefore: string;
    priceAfter: string;
}

export type PurchaseSalePriceErrorCode =
    | 'INVALID_PURCHASE_SALE_PRICE'
    | 'CONFLICTING_PURCHASE_SALE_PRICE'
    | 'PURCHASE_PRODUCT_NOT_FOUND'
    | 'PURCHASE_PRICE_UPDATE_FAILED';

export class PurchaseSalePriceError extends Error {
    constructor(
        public readonly code: PurchaseSalePriceErrorCode,
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'PurchaseSalePriceError';
    }
}

export function canSetPurchaseSalePrice(role: string | null | undefined): boolean {
    return role === 'OWNER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function hasPurchaseSalePriceIntent(items: readonly PurchaseSalePriceInput[]): boolean {
    return items.some((item) => item.salePrice !== undefined && item.salePrice !== null);
}

function parseRequestedSalePrice(value: string): Decimal {
    let price: Decimal;
    try {
        price = new Decimal(value);
    } catch {
        throw new PurchaseSalePriceError(
            'INVALID_PURCHASE_SALE_PRICE',
            400,
            'El precio de venta debe ser un número válido',
        );
    }
    const persistedNumber = price.toNumber();
    // Product.price sigue siendo Float legacy: validar el número que realmente
    // se persistirá captura NaN/Infinity, overflow y underflow sin guardas
    // Decimal redundantes (cada rama representa una frontera distinta).
    if (!Number.isFinite(persistedNumber) || persistedNumber <= 0) {
        throw new PurchaseSalePriceError(
            'INVALID_PURCHASE_SALE_PRICE',
            400,
            'El precio de venta debe ser finito y mayor que cero',
        );
    }
    return price;
}

/**
 * Consolida la intención por producto. Dos líneas del mismo SKU pueden repetir
 * el mismo precio (incluido con otra escala, p. ej. 10 y 10.00), pero nunca
 * decidir dos precios distintos para la misma escritura de catálogo.
 *
 * El handler llama esta función dentro de prisma.$transaction para que tanto el
 * rechazo del conflicto como cualquier efecto posterior pertenezcan a una sola
 * unidad ACID.
 */
export function resolvePurchaseSalePriceIntents(
    items: readonly PurchaseSalePriceInput[],
): PurchaseSalePriceIntent[] {
    const byProduct = new Map<string, Decimal>();

    for (const item of items) {
        if (item.salePrice === undefined || item.salePrice === null) continue;
        const requested = parseRequestedSalePrice(item.salePrice);
        const previous = byProduct.get(item.productId);
        if (previous && !previous.equals(requested)) {
            throw new PurchaseSalePriceError(
                'CONFLICTING_PURCHASE_SALE_PRICE',
                400,
                `El producto ${item.productId} tiene precios de venta distintos en la misma compra`,
            );
        }
        byProduct.set(item.productId, requested);
    }

    return [...byProduct.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([productId, salePrice]) => ({ productId, salePrice: salePrice.toString() }));
}

/** Construye before/after exclusivamente desde una lectura SELECT ... FOR UPDATE. */
export function buildPurchaseSalePriceChange(
    productId: string,
    lockedPrice: Decimal.Value,
    intent: PurchaseSalePriceIntent | undefined,
): PurchaseSalePriceChange | null {
    if (!intent) return null;
    const priceBefore = new Decimal(lockedPrice);
    const priceAfter = parseRequestedSalePrice(intent.salePrice);
    if (priceBefore.equals(priceAfter)) return null;
    return {
        productId,
        priceBefore: priceBefore.toString(),
        priceAfter: priceAfter.toString(),
    };
}

/**
 * Las facturas vinculadas a una OC no ejecutan applyStockDelta. Por eso toman
 * aquí sus propios locks Product, siempre ordenados por productId, antes de
 * actualizar el precio. La compra directa integra el mismo before/after con el
 * lock que ya toma su bucle de inventario y no llama esta función.
 */
export async function applyLinkedPurchaseSalePriceIntents(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    intents: readonly PurchaseSalePriceIntent[];
}): Promise<PurchaseSalePriceChange[]> {
    const { tx, tenantId } = params;
    const changes: PurchaseSalePriceChange[] = [];
    const intents = [...params.intents].sort((left, right) => left.productId.localeCompare(right.productId));
    if (intents.length === 0) return changes;

    // Un solo locking read evita N+1 y ORDER BY fija el orden de adquisición de
    // row-locks aun cuando el payload original venga invertido.
    const lockedRows = await tx.$queryRaw<Array<{ id: string; price: Decimal.Value }>>(Prisma.sql`
            SELECT id, price
            FROM \`Product\`
            WHERE \`tenantId\` = ${tenantId}
              AND id IN (${Prisma.join(intents.map((intent) => intent.productId))})
            ORDER BY id
            FOR UPDATE
    `);
    const lockedById = new Map(lockedRows.map((row) => [row.id, row]));
    const missingIntent = intents.find((intent) => !lockedById.has(intent.productId));
    if (missingIntent || lockedRows.length !== intents.length) {
        throw new PurchaseSalePriceError(
            'PURCHASE_PRODUCT_NOT_FOUND',
            404,
            `Producto no encontrado: ${missingIntent?.productId ?? 'desconocido'}`,
        );
    }

    for (const intent of intents) {
        const locked = lockedById.get(intent.productId)!;
        const change = buildPurchaseSalePriceChange(intent.productId, locked.price, intent);
        if (change) changes.push(change);
    }
    if (changes.length === 0) return changes;

    // Todos los valores viajan parametrizados. El CASE permite un precio distinto
    // por SKU en una sola escritura y el count confirma que el tenant/ids siguen
    // siendo exactamente los que acabamos de bloquear.
    const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE \`Product\`
        SET price = CASE id
            ${Prisma.join(changes.map((change) => Prisma.sql`
                WHEN ${change.productId} THEN ${new Decimal(change.priceAfter).toNumber()}
            `), ' ')}
            ELSE price
        END
        WHERE \`tenantId\` = ${tenantId}
          AND id IN (${Prisma.join(changes.map((change) => change.productId))})
    `);
    if (Number(updated) !== changes.length) {
        throw new PurchaseSalePriceError(
            'PURCHASE_PRICE_UPDATE_FAILED',
            409,
            'No se pudieron actualizar todos los precios de venta de la compra',
        );
    }

    return changes;
}

/**
 * Una fila inmutable por SKU cambiado permite reconstruir exactamente quién,
 * desde qué compra y de qué precio a qué precio modificó el catálogo.
 */
export async function createPurchaseSalePriceAudits(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    userId: string;
    purchaseId: string;
    purchaseOrderId: string | null;
    invoiceNumber: string;
    changes: readonly PurchaseSalePriceChange[];
}): Promise<void> {
    const { tx, tenantId, userId, purchaseId, purchaseOrderId, invoiceNumber, changes } = params;
    if (changes.length === 0) return;

    await tx.auditLog.createMany({
        data: changes.map((change) => ({
            tenantId,
            userId,
            action: 'PRICE_CHANGED',
            details: JSON.stringify({
                productId: change.productId,
                priceBefore: change.priceBefore,
                priceAfter: change.priceAfter,
                source: 'PURCHASE',
                purchaseId,
                purchaseOrderId,
                invoiceNumber,
            }),
        })),
    });
}
