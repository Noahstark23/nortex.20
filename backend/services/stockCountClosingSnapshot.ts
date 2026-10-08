import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

export class StockCountSnapshotError extends Error {
    readonly statusCode = 409;
    readonly code = 'STOCK_COUNT_RECOUNT_REQUIRED';
}

/** El caller mantiene bloqueado Product; se leen saldos actuales, no el snapshot de la tx. */
export async function readStockCountWarehouseBook(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; productId: string; warehouseId: string; isDefault: boolean; aggregateStock: Decimal.Value },
): Promise<Decimal> {
    const rows = await tx.$queryRaw<Array<{ warehouseId: string; stock: Decimal.Value }>>(Prisma.sql`
        SELECT warehouseId, stock FROM \`ProductStock\`
        WHERE tenantId = ${input.tenantId} AND productId = ${input.productId}
        ORDER BY warehouseId FOR UPDATE
    `);
    const explicit = rows.find(row => row.warehouseId === input.warehouseId);
    if (explicit) return new Decimal(explicit.stock).toDecimalPlaces(4);
    if (!input.isDefault) return new Decimal(0);
    return rows.reduce((remaining, row) => remaining.minus(new Decimal(row.stock).toDecimalPlaces(4)), new Decimal(input.aggregateStock).toDecimalPlaces(4));
}

/** Compara saldos bajo Product lock; no depende de fechas comerciales retroactivas. */
export function assertStockCountCaptureFresh(input: {
    productName: string;
    currentBook: Decimal.Value;
    bookStockAtCapture: Decimal.Value | null | undefined;
}): void {
    if (input.bookStockAtCapture == null) throw new StockCountSnapshotError(
        `La captura de "${input.productName}" necesita confirmación. Volvé a contarlo y guardá la cantidad antes de cerrar.`,
    );
    // ProductStock conserva Float legacy; las cantidades físicas y el snapshot
    // usan cuatro decimales. El ruido binario no representa un movimiento.
    if (!new Decimal(input.currentBook).toDecimalPlaces(4).equals(new Decimal(input.bookStockAtCapture).toDecimalPlaces(4))) throw new StockCountSnapshotError(
        `El saldo de "${input.productName}" cambió después de su captura. Volvé a contarlo y guardá la cantidad antes de cerrar.`,
    );
}
