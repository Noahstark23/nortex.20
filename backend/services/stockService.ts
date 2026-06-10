/**
 * NORTEX — Stock Service
 *
 * Mutación ATÓMICA de inventario. Reemplaza el patrón leer→validar→escribir
 * (TOCTOU) por un único UPDATE condicional:
 *
 *   UPDATE Product SET stock = stock - :qty
 *   WHERE id = :id AND tenantId = :tenant AND stock >= :qty
 *
 * La validación de suficiencia y la escritura son LA MISMA sentencia SQL:
 * no existe ventana para dirty reads. El UPDATE toma el row-lock de InnoDB,
 * que se mantiene hasta el COMMIT de la transacción; la lectura posterior
 * (dentro de la misma tx) ve la propia escritura de forma estable — de ahí
 * salen stockBefore/stockAfter para el Kardex sin condición de carrera.
 *
 * Modos:
 *  - enforceSufficient=true  (POS/online): rechaza si stock < qty.
 *  - enforceSufficient=false (offline-sync/devoluciones): aplica el delta
 *    aunque el stock quede negativo — la venta física ya ocurrió y el Kardex
 *    debe reflejar la realidad para auditoría.
 */

import { Prisma } from '@prisma/client';

export class StockError extends Error {
    constructor(
        public readonly code: 'PRODUCT_NOT_FOUND' | 'INSUFFICIENT_STOCK',
        message: string
    ) {
        super(message);
        this.name = 'StockError';
    }
}

export interface StockDeltaResult {
    stockBefore: number;
    stockAfter: number;
}

export async function applyStockDelta(
    tx: Prisma.TransactionClient,
    params: {
        tenantId: string;
        productId: string;
        /** Negativo = salida (venta), positivo = entrada (devolución/compra) */
        delta: number;
        enforceSufficient: boolean;
    }
): Promise<StockDeltaResult> {
    const { tenantId, productId, delta, enforceSufficient } = params;

    if (delta === 0 || !Number.isFinite(delta)) {
        throw new StockError('INSUFFICIENT_STOCK', `Delta de stock inválido: ${delta}`);
    }

    const qtyOut = -delta;
    const where: Prisma.ProductWhereInput =
        delta < 0 && enforceSufficient
            ? { id: productId, tenantId, stock: { gte: qtyOut } }
            : { id: productId, tenantId };

    const updated = await tx.product.updateMany({
        where,
        data: { stock: delta < 0 ? { decrement: qtyOut } : { increment: delta } },
    });

    if (updated.count === 0) {
        // Distinguir causa sin ampliar la ventana: el producto no existe para
        // este tenant, o existe pero el guard de suficiencia rechazó el UPDATE.
        const existing = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { stock: true },
        });
        if (!existing) {
            throw new StockError('PRODUCT_NOT_FOUND', `Producto ${productId} no encontrado`);
        }
        throw new StockError(
            'INSUFFICIENT_STOCK',
            `Stock insuficiente para producto ${productId}. Disponible: ${Number(existing.stock)}`
        );
    }

    // Read-back consistente: el row-lock del UPDATE impide que otra tx
    // modifique la fila antes de nuestro COMMIT.
    const after = await tx.product.findFirstOrThrow({
        where: { id: productId, tenantId },
        select: { stock: true },
    });
    const stockAfter = Number(after.stock);

    return { stockBefore: stockAfter - delta, stockAfter };
}
