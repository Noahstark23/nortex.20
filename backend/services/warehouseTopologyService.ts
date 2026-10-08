import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

export class WarehouseTopologyError extends Error {
    constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

/** Operación administrativa excepcional: bloquea el catálogo antes de alterar ubicaciones. */
export async function lockWarehouseTopology(tx: Prisma.TransactionClient, tenantId: string) {
    const products = await tx.$queryRaw<Array<{ id: string; stock: number }>>(Prisma.sql`
        SELECT id, stock FROM \`Product\` WHERE tenantId = ${tenantId} ORDER BY id FOR UPDATE
    `);
    const warehouses = await tx.$queryRaw<Array<{ id: string; name: string; isDefault: boolean | number; isActive: boolean | number; sellerId: string | null }>>(Prisma.sql`
        SELECT id, name, isDefault, isActive, sellerId FROM \`Warehouse\`
        WHERE tenantId = ${tenantId} ORDER BY id FOR UPDATE
    `);
    return { products, warehouses };
}

/** Materializar una atribución existente no traslada mercadería ni modifica el agregado. */
export async function setDefaultWarehouseSafely(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; userId: string; warehouseId: string },
) {
    const { products, warehouses } = await lockWarehouseTopology(tx, input.tenantId);
    const target = warehouses.find(row => row.id === input.warehouseId && Boolean(row.isActive));
    if (!target) throw new WarehouseTopologyError(404, 'WAREHOUSE_NOT_FOUND', 'Bodega no encontrada o inactiva.');
    if (target.sellerId) throw new WarehouseTopologyError(400, 'SELLER_WAREHOUSE_NOT_DEFAULT', 'La carga de un vendedor no puede ser la bodega principal.');
    const defaults = warehouses.filter(row => Boolean(row.isDefault));
    if (defaults.length !== 1) throw new WarehouseTopologyError(409, 'WAREHOUSE_DEFAULT_INCONSISTENT', 'La ubicación principal necesita revisión antes de cambiarla.');
    const previous = defaults[0];
    if (previous.id === target.id) return tx.warehouse.findFirstOrThrow({ where: { id: target.id, tenantId: input.tenantId } });
    const openCount = await tx.stockCount.findFirst({
        where: { tenantId: input.tenantId, status: { in: ['OPEN', 'CLOSING'] } }, select: { id: true },
    });
    if (openCount) throw new WarehouseTopologyError(409, 'WAREHOUSE_COUNT_OPEN', 'Cerrá o cancelá las tomas físicas antes de cambiar la bodega principal.');
    const rows = await tx.productStock.findMany({
        where: { tenantId: input.tenantId }, select: { productId: true, warehouseId: true, stock: true },
        take: Math.max(1, products.length * warehouses.length),
    });
    const byProduct = new Map<string, typeof rows>();
    for (const row of rows) { const list = byProduct.get(row.productId) ?? []; list.push(row); byProduct.set(row.productId, list); }
    const materialized: Array<{ tenantId: string; productId: string; warehouseId: string; stock: number }> = [];
    for (const product of products) {
        const stockRows = byProduct.get(product.id) ?? [];
        if (!stockRows.some(row => row.warehouseId === previous.id)) {
            const implicit = stockRows.reduce((value, row) => value.minus(row.stock.toString()), new Decimal(product.stock.toString()));
            materialized.push({ tenantId: input.tenantId, productId: product.id, warehouseId: previous.id, stock: implicit.toNumber() });
        }
        if (!stockRows.some(row => row.warehouseId === target.id)) materialized.push({ tenantId: input.tenantId, productId: product.id, warehouseId: target.id, stock: 0 });
    }
    if (materialized.length > 0) await tx.productStock.createMany({ data: materialized });
    await tx.warehouse.updateMany({ where: { tenantId: input.tenantId, isDefault: true }, data: { isDefault: false } });
    const updated = await tx.warehouse.update({ where: { id: target.id }, data: { isDefault: true } });
    await tx.auditLog.create({ data: {
        tenantId: input.tenantId, userId: input.userId, action: 'WAREHOUSE_SET_DEFAULT',
        details: JSON.stringify({ before: { warehouseId: previous.id }, after: { warehouseId: target.id }, materialized }),
    } });
    return updated;
}

/** El caller adquirió lockWarehouseTopology en la misma transacción. */
export async function assertWarehouseCanDeactivate(tx: Prisma.TransactionClient, input: { tenantId: string; warehouseId: string; isDefault: boolean }) {
    if (input.isDefault) throw new WarehouseTopologyError(400, 'DEFAULT_WAREHOUSE_ACTIVE', 'No se puede desactivar la bodega principal. Elegí otra principal primero.');
    const count = await tx.stockCount.findFirst({ where: { tenantId: input.tenantId, warehouseId: input.warehouseId, status: { in: ['OPEN', 'CLOSING'] } }, select: { id: true } });
    if (count) throw new WarehouseTopologyError(409, 'WAREHOUSE_COUNT_OPEN', 'Cerrá o cancelá la toma física de esta bodega antes de desactivarla.');
    const nonzero = await tx.productStock.findFirst({ where: { tenantId: input.tenantId, warehouseId: input.warehouseId, stock: { not: 0 } }, select: { id: true } });
    if (nonzero) throw new WarehouseTopologyError(409, 'WAREHOUSE_HAS_STOCK', 'La bodega tiene saldos: transferí las existencias o revisá los negativos antes de desactivarla.');
}
