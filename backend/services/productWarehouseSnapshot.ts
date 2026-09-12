import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma';

const WAREHOUSE_LIMIT = 100;

export interface ProductWarehouseSnapshot {
    productId: string;
    totalStock: string;
    unit: string;
    warehouses: Array<{
        id: string; name: string; isDefault: boolean; isActive: boolean;
        stock: string; implicit: boolean;
    }>;
    hasMore: boolean;
    unlistedStock?: string;
}

/**
 * Desglose físico de una sola ficha. No calcula disponibilidad vendible por lote
 * ni materializa bodegas/saldos durante la lectura. Los índices existentes de
 * Warehouse [tenantId,isActive,name] y ProductStock [productId,warehouseId]
 * acotan el catálogo y las filas; la suma completa permanece en MySQL.
 */
export async function readProductWarehouseSnapshot(
    input: { tenantId: string; productId: string },
    db: Pick<PrismaClient, '$transaction'> = prisma,
): Promise<ProductWarehouseSnapshot | null> {
    return db.$transaction(async tx => {
        const [product] = await tx.$queryRaw<Array<{ id: string; unit: string; stock: Prisma.Decimal }>>(Prisma.sql`
            SELECT id, unit, CAST(stock AS DECIMAL(65,4)) AS stock
            FROM Product WHERE tenantId = ${input.tenantId} AND id = ${input.productId} LIMIT 1
        `);
        if (!product) return null;

        const page = await tx.warehouse.findMany({
            where: { tenantId: input.tenantId, isActive: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }], take: WAREHOUSE_LIMIT + 1,
            select: { id: true, name: true, isDefault: true, isActive: true },
        });
        const listed = page.slice(0, WAREHOUSE_LIMIT);
        const [aggregate] = await tx.$queryRaw<Array<{ stock: Prisma.Decimal }>>(Prisma.sql`
            SELECT COALESCE(SUM(CAST(stock AS DECIMAL(65,4))), 0) AS stock
            FROM ProductStock WHERE tenantId = ${input.tenantId} AND productId = ${input.productId}
        `);
        const rows = listed.length ? await tx.$queryRaw<Array<{ warehouseId: string; stock: Prisma.Decimal }>>(Prisma.sql`
            SELECT warehouseId, CAST(stock AS DECIMAL(65,4)) AS stock
            FROM ProductStock WHERE tenantId = ${input.tenantId} AND productId = ${input.productId}
                AND warehouseId IN (${Prisma.join(listed.map(warehouse => warehouse.id))}) LIMIT ${WAREHOUSE_LIMIT}
        `) : [];
        const explicit = new Map(rows.map(row => [row.warehouseId, new Decimal(row.stock.toString())]));
        const total = new Decimal(product.stock.toString());
        const residual = total.minus(aggregate.stock.toString());
        let shown = new Decimal(0);
        const warehouses = listed.map(warehouse => {
            const stored = explicit.get(warehouse.id);
            const implicit = stored === undefined && warehouse.isDefault;
            const stock = stored ?? (implicit ? residual : new Decimal(0));
            shown = shown.plus(stock);
            return { ...warehouse, stock: stock.toFixed(4), implicit };
        });
        // También expone un descuadre legado; nunca inventa una ubicación ni
        // reemplaza un cero explícito por el residual del agregado.
        const unlisted = total.minus(shown);
        return {
            productId: product.id, totalStock: total.toFixed(4), unit: product.unit,
            warehouses, hasMore: page.length > WAREHOUSE_LIMIT,
            ...(unlisted.isZero() ? {} : { unlistedStock: unlisted.toFixed(4) }),
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 5_000 });
}
