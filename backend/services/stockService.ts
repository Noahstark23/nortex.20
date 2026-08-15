/**
 * NORTEX — Stock Service (multi-bodega, Fase 2: fundación)
 *
 * INVARIANTE: `Product.stock` sigue siendo el AGREGADO autoritativo (Σ bodegas).
 * Toda la lógica existente (guard de suficiencia, POS, reportes, Oráculo, RAG)
 * sigue leyendo/escribiendo ese agregado exactamente como antes. El desglose por
 * bodega (`ProductStock`) se mantiene DEBAJO con doble escritura en la misma tx.
 *
 * Mutación ATÓMICA de inventario (sin cambios en el contrato):
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
 *
 * Multi-bodega:
 *  - `warehouseId` opcional. Si no viene, se usa la bodega DEFAULT del tenant
 *    (se crea "Principal" de forma perezosa si no existe) → todos los callers
 *    existentes siguen funcionando sin cambios.
 *  - Backfill perezoso: la PRIMERA vez que se toca la bodega default para un
 *    producto sin fila ProductStock, la fila se crea con el stock agregado YA
 *    actualizado (stockAfter) — la bodega principal absorbe el total legado.
 *    Para bodegas no-default, la fila nace con el delta.
 *  - La suficiencia se garantiza sobre el AGREGADO (invariante de dinero). La
 *    suficiencia POR BODEGA llega con las transferencias (Fase 3).
 */

import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

/**
 * Costo promedio ponderado móvil (moving average) — función PURA.
 *
 * `nuevoPromedio = (stockViejo*costoViejo + cantidadEntrante*costoEntrante) / stockNuevo`
 *
 * C1 (auditoría): SOLO se pondera si el stock viejo es POSITIVO. Con stock
 * negativo (backorder por `allowNegativeStock`), `stockViejo*costoViejo` es un
 * "costo de deuda" IRREAL que corrompe el promedio; en ese caso el stock
 * resultante proviene íntegramente de la entrada → el costo ES el de la compra.
 * También cae al costo de compra si el stock nuevo no es positivo (sigue en
 * backorder) o si no había stock previo. Nunca divide por ≤ 0.
 *
 * El caller debe pasar `oldCost` LEÍDO CON LA FILA BLOQUEADA (C2): un costo del
 * snapshot (pre-lock) puede estar stale bajo compras concurrentes del mismo SKU.
 */
export function weightedAverageCost(
    oldStock: Decimal.Value,
    oldCost: Decimal.Value,
    qtyIn: Decimal.Value,
    unitCost: Decimal.Value,
): Decimal {
    const os = new Decimal(oldStock);
    const uc = new Decimal(unitCost);
    const newStock = os.plus(qtyIn);
    if (os.lessThanOrEqualTo(0) || newStock.lessThanOrEqualTo(0)) {
        return uc.toDecimalPlaces(4);
    }
    return os.mul(oldCost).plus(new Decimal(qtyIn).mul(uc)).dividedBy(newStock).toDecimalPlaces(4);
}

export class StockError extends Error {
    constructor(
        public readonly code: 'PRODUCT_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'WAREHOUSE_NOT_FOUND',
        message: string
    ) {
        super(message);
        this.name = 'StockError';
    }
}

export interface StockDeltaResult {
    stockBefore: number;
    stockAfter: number;
    /** Bodega donde se aplicó el movimiento (default del tenant si no se especificó). */
    warehouseId: string;
}

export const DEFAULT_WAREHOUSE_NAME = 'Principal';

/**
 * Garantiza la bodega por defecto ANTES de abrir una transacción.
 *
 * `resolveDefaultWarehouseId` ya trae un catch de P2002 para la carrera, pero
 * ese catch NO sirve adentro de una transacción: bajo REPEATABLE READ la fila
 * que acaba de crear el otro request es invisible para este snapshot, el
 * `findFirst` del catch devuelve null y el error se relanza igual. Medido en
 * carga: 10 ventas simultáneas de un tenant nuevo → 8 fallaban con
 * `Warehouse_tenantId_name_key`.
 *
 * Llamar a esto fuera de la tx (con el cliente normal, no con `tx`) deja la
 * fila creada y commiteada, así que adentro solo queda el camino de lectura.
 * Solo crea si el tenant NO tiene ninguna bodega: si ya tiene una, la lógica
 * de promoción de `resolveDefaultWarehouseId` es la que manda.
 */
export async function asegurarBodegaPorDefecto(
    db: { warehouse: { findFirst: Function; createMany: Function } },
    tenantId: string,
): Promise<void> {
    const alguna = await db.warehouse.findFirst({ where: { tenantId }, select: { id: true } });
    if (alguna) return;
    await db.warehouse.createMany({
        data: [{ tenantId, name: DEFAULT_WAREHOUSE_NAME, isDefault: true }],
        skipDuplicates: true, // INSERT IGNORE: si otro request ganó, no lanza
    });
}

/**
 * Resuelve la bodega default del tenant, creándola ("Principal") si no existe.
 * Idempotente bajo carrera: el @@unique([tenantId, name]) hace que el perdedor
 * de la carrera re-lea la fila creada por el ganador.
 */
export async function resolveDefaultWarehouseId(
    tx: Prisma.TransactionClient,
    tenantId: string
): Promise<string> {
    const existing = await tx.warehouse.findFirst({
        where: { tenantId, isDefault: true },
        select: { id: true },
    });
    if (existing) return existing.id;

    // Sin default: si hay alguna bodega, promover la más antigua; si no, crear "Principal".
    const any = await tx.warehouse.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    if (any) {
        await tx.warehouse.update({ where: { id: any.id }, data: { isDefault: true } });
        return any.id;
    }

    try {
        const created = await tx.warehouse.create({
            data: { tenantId, name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
            select: { id: true },
        });
        return created.id;
    } catch (err) {
        // Carrera: otro request creó "Principal" al mismo tiempo → usarla.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            const winner = await tx.warehouse.findFirst({
                where: { tenantId, name: DEFAULT_WAREHOUSE_NAME },
                select: { id: true },
            });
            if (winner) return winner.id;
        }
        throw err;
    }
}

/**
 * Doble escritura del desglose por bodega. `isDefault` decide el seed del
 * backfill perezoso: la default absorbe lo que del agregado NO está atribuido
 * a otras bodegas (stockAfter − Σ filas de otras bodegas) — restar es clave
 * para no contar doble lo que ya vive en bodegas explícitas. Una bodega
 * no-default nace con el delta.
 */
async function applyWarehouseDelta(
    tx: Prisma.TransactionClient,
    params: {
        tenantId: string;
        productId: string;
        warehouseId: string;
        delta: number;
        stockAfter: number;
        isDefault: boolean;
    }
): Promise<void> {
    const { tenantId, productId, warehouseId, delta, stockAfter, isDefault } = params;

    const updated = await tx.productStock.updateMany({
        where: { productId, warehouseId, tenantId },
        data: { stock: { increment: delta } },
    });
    if (updated.count > 0) return;

    // No hay fila aún → crearla (backfill perezoso). El seed de la default se
    // calcula restando lo atribuido a otras bodegas; el SUM viaja con FOR UPDATE
    // para serializar contra movimientos concurrentes de esas filas (el seed
    // ocurre a lo sumo una vez por producto, el costo extra es puntual).
    let seed: number;
    if (isDefault) {
        const rows = await tx.$queryRaw<{ total: number | null }[]>(Prisma.sql`
            SELECT COALESCE(SUM(stock), 0) AS total
            FROM \`ProductStock\`
            WHERE productId = ${productId} AND tenantId = ${tenantId} AND warehouseId <> ${warehouseId}
            FOR UPDATE
        `);
        const others = Number(rows[0]?.total ?? 0);
        seed = stockAfter - others;
    } else {
        seed = delta;
    }

    try {
        await tx.productStock.create({
            data: { tenantId, productId, warehouseId, stock: seed },
        });
    } catch (err) {
        // Carrera: otro request creó la fila al mismo tiempo → el perdedor solo
        // aporta su delta (el ganador ya sembró el legado; la suma queda correcta).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await tx.productStock.updateMany({
                where: { productId, warehouseId, tenantId },
                data: { stock: { increment: delta } },
            });
            return;
        }
        throw err;
    }
}


/**
 * Materializa la fila ProductStock de una bodega si aún no existe (backfill
 * perezoso, misma semántica que applyWarehouseDelta): la default nace con
 * agregado − Σ otras filas (SUM con FOR UPDATE); una no-default nace en 0.
 * Race-safe: P2002 = otro request la creó → no-op. La usan las transferencias
 * para poder debitar una bodega cuyo stock era implícito.
 */
export async function materializeWarehouseRow(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; productId: string; warehouseId: string; isDefault: boolean }
): Promise<void> {
    const { tenantId, productId, warehouseId, isDefault } = params;
    const existing = await tx.productStock.findFirst({ where: { productId, warehouseId, tenantId }, select: { id: true } });
    if (existing) return;

    let seed = 0;
    if (isDefault) {
        const prod = await tx.product.findFirstOrThrow({ where: { id: productId, tenantId }, select: { stock: true } });
        const rows = await tx.$queryRaw<{ total: number | null }[]>(Prisma.sql`
            SELECT COALESCE(SUM(stock), 0) AS total
            FROM \`ProductStock\`
            WHERE productId = ${productId} AND tenantId = ${tenantId} AND warehouseId <> ${warehouseId}
            FOR UPDATE
        `);
        seed = Number(prod.stock) - Number(rows[0]?.total ?? 0);
    }
    try {
        await tx.productStock.create({ data: { tenantId, productId, warehouseId, stock: seed } });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
        throw err;
    }
}

export async function applyStockDelta(
    tx: Prisma.TransactionClient,
    params: {
        tenantId: string;
        productId: string;
        /** Negativo = salida (venta), positivo = entrada (devolución/compra) */
        delta: number;
        enforceSufficient: boolean;
        /** Bodega del movimiento. Omitir = bodega default del tenant. */
        warehouseId?: string;
    }
): Promise<StockDeltaResult> {
    const { tenantId, productId, delta, enforceSufficient } = params;

    if (delta === 0 || !Number.isFinite(delta)) {
        throw new StockError('INSUFFICIENT_STOCK', `Delta de stock inválido: ${delta}`);
    }

    // Resolver bodega ANTES de mutar (falla temprano si la bodega no es del tenant).
    let warehouseId: string;
    let isDefault: boolean;
    if (params.warehouseId) {
        const wh = await tx.warehouse.findFirst({
            where: { id: params.warehouseId, tenantId, isActive: true },
            select: { id: true, isDefault: true },
        });
        if (!wh) {
            throw new StockError('WAREHOUSE_NOT_FOUND', `Bodega ${params.warehouseId} no encontrada`);
        }
        warehouseId = wh.id;
        isDefault = wh.isDefault;
    } else {
        warehouseId = await resolveDefaultWarehouseId(tx, tenantId);
        isDefault = true;
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
        // Se lee también el nombre: este mensaje termina en la pantalla del
        // cajero con el cliente enfrente, y un id (`cmg7x2...`) no le dice nada
        // ni le indica qué línea del carrito arreglar.
        const existing = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { stock: true, name: true },
        });
        if (!existing) {
            throw new StockError('PRODUCT_NOT_FOUND', `Producto ${productId} no encontrado`);
        }
        throw new StockError(
            'INSUFFICIENT_STOCK',
            `Stock insuficiente de "${existing.name}". Disponible: ${Number(existing.stock)}, se pidió ${qtyOut}.`
        );
    }

    // Read-back consistente: el row-lock del UPDATE impide que otra tx
    // modifique la fila antes de nuestro COMMIT.
    const after = await tx.product.findFirstOrThrow({
        where: { id: productId, tenantId },
        select: { stock: true },
    });
    const stockAfter = Number(after.stock);

    // Desglose por bodega (misma tx → atómico con el agregado).
    await applyWarehouseDelta(tx, { tenantId, productId, warehouseId, delta, stockAfter, isDefault });

    return { stockBefore: stockAfter - delta, stockAfter, warehouseId };
}
