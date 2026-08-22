import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { recordSale } from './accounting.js';
import { applyStockDelta } from './stockService.js';
import {
    allocateSaleItemBatchesFefo,
    BatchAllocationError,
    consumeProductBatchesFefo,
    type FefoAllocationResult,
} from './saleBatchAllocationService.js';
import { effectiveSaleModeAndStep } from './saleItemMeasurementService.js';
import { exactPedidoItemQuantity } from './publicOrderItemService.js';

type PrismaTx = Prisma.TransactionClient;

export type PedidoFulfillmentCode =
    | 'PEDIDO_NOT_FOUND'
    | 'PEDIDO_ALREADY_PREPARED'
    | 'PEDIDO_ALREADY_PROCESSED'
    | 'PEDIDO_PRODUCT_NOT_FOUND'
    | 'PEDIDO_RESERVATION_MISMATCH'
    | 'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED'
    | 'PEDIDO_ACCOUNTING_USER_NOT_FOUND'
    | 'PEDIDO_BATCH_STOCK_INSUFFICIENT';

export class PedidoFulfillmentError extends Error {
    constructor(
        public readonly code: PedidoFulfillmentCode,
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'PedidoFulfillmentError';
    }
}

const PRODUCT_SELECT = {
    id: true,
    name: true,
    unit: true,
    cost: true,
    ivaExento: true,
    saleMode: true,
    quantityStep: true,
    requiresBatchTracking: true,
} as const;

const withPedidoBatchError = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof BatchAllocationError) {
            throw new PedidoFulfillmentError(
                'PEDIDO_BATCH_STOCK_INSUFFICIENT',
                422,
                error.message,
            );
        }
        throw error;
    }
};

const PEDIDO_ITEM_SELECT = {
    id: true,
    pedidoId: true,
    productoId: true,
    cantidad: true,
    cantidadExact: true,
    presentationAtSale: true,
    presentationQuantityAtSale: true,
    productNameAtOrder: true,
    unitAtOrder: true,
    saleModeAtOrder: true,
    quantityStepAtOrder: true,
    unitPriceExactAtOrder: true,
    ivaExentoAtOrder: true,
    precioUnitario: true,
    subtotal: true,
} as const satisfies Prisma.PedidoItemSelect;

type FulfillmentProduct = {
    id: string;
    name: string;
    unit: string;
    cost: number;
    ivaExento: boolean;
    saleMode: string | null;
    quantityStep: { toString(): string } | null;
    requiresBatchTracking: boolean;
};

type PedidoSelector = {
    pedidoId: string;
    tenantId?: string;
    motorizadoId?: string;
};

const selectorWhere = (selector: PedidoSelector) => ({
    id: selector.pedidoId,
    ...(selector.tenantId ? { tenantId: selector.tenantId } : {}),
    ...(selector.motorizadoId ? { motorizadoId: selector.motorizadoId } : {}),
});

type LockedPedidoRow = { id: string };

/**
 * Primer lock de toda transición de fulfillment. El orden global es siempre:
 * Pedido → Product/warehouse stock → ProductBatch → Kardex. Así reserva,
 * cancelación y entrega no pueden decidir usando snapshots simultáneos del
 * mismo pedido ni invertir el orden de los locks de inventario.
 */
export async function lockPedidoForFulfillment(
    tx: Pick<PrismaTx, '$queryRaw'>,
    selector: PedidoSelector,
): Promise<void> {
    let locked: LockedPedidoRow[];
    if (selector.tenantId && selector.motorizadoId) {
        locked = await tx.$queryRaw<LockedPedidoRow[]>`
            SELECT id FROM \`Pedido\`
            WHERE id = ${selector.pedidoId}
              AND \`tenantId\` = ${selector.tenantId}
              AND \`motorizadoId\` = ${selector.motorizadoId}
            FOR UPDATE`;
    } else if (selector.tenantId) {
        locked = await tx.$queryRaw<LockedPedidoRow[]>`
            SELECT id FROM \`Pedido\`
            WHERE id = ${selector.pedidoId} AND \`tenantId\` = ${selector.tenantId}
            FOR UPDATE`;
    } else if (selector.motorizadoId) {
        locked = await tx.$queryRaw<LockedPedidoRow[]>`
            SELECT id FROM \`Pedido\`
            WHERE id = ${selector.pedidoId} AND \`motorizadoId\` = ${selector.motorizadoId}
            FOR UPDATE`;
    } else {
        locked = await tx.$queryRaw<LockedPedidoRow[]>`
            SELECT id FROM \`Pedido\` WHERE id = ${selector.pedidoId} FOR UPDATE`;
    }

    if (locked.length !== 1) {
        throw new PedidoFulfillmentError(
            'PEDIDO_NOT_FOUND',
            404,
            selector.motorizadoId
                ? 'Pedido no encontrado o no asignado a este motorizado.'
                : 'Pedido no encontrado.',
        );
    }
}

export const validatePedidoReservationTotals = (
    items: ReadonlyArray<{ productoId: string; cantidad: number; cantidadExact: { toString(): string } | null }>,
    reservations: ReadonlyArray<{ productId: string; quantity: number }>,
): void => {
    const expectedByProduct = new Map<string, Decimal>();
    for (const item of items) {
        expectedByProduct.set(
            item.productoId,
            (expectedByProduct.get(item.productoId) ?? new Decimal(0)).plus(exactPedidoItemQuantity(item)),
        );
    }
    const reservedByProduct = new Map<string, Decimal>();
    for (const movement of reservations) {
        reservedByProduct.set(
            movement.productId,
            (reservedByProduct.get(movement.productId) ?? new Decimal(0))
                .plus(new Decimal(movement.quantity).abs()),
        );
    }
    for (const [productId, exact] of expectedByProduct) {
        const reserved = reservedByProduct.get(productId) ?? new Decimal(0);
        if (reserved.equals(exact)) continue;
        throw new PedidoFulfillmentError(
            'PEDIDO_RESERVATION_MISMATCH',
            409,
            `La reserva de ${productId} no coincide con la cantidad exacta del pedido.`,
        );
    }
    for (const productId of reservedByProduct.keys()) {
        if (expectedByProduct.has(productId)) continue;
        throw new PedidoFulfillmentError(
            'PEDIDO_RESERVATION_MISMATCH',
            409,
            `La reserva contiene un producto ajeno al pedido: ${productId}.`,
        );
    }
};

export async function claimPedidoDelivery(
    tx: Pick<PrismaTx, 'pedido' | '$queryRaw'>,
    selector: PedidoSelector,
): Promise<void> {
    await lockPedidoForFulfillment(tx, selector);
    const claim = await tx.pedido.updateMany({
        where: {
            ...selectorWhere(selector),
            facturaId: null,
            estado: { notIn: ['entregado', 'cancelado'] },
        },
        data: { estado: 'entregado', entregadoAt: new Date() },
    });
    if (claim.count !== 1) {
        throw new PedidoFulfillmentError(
            'PEDIDO_ALREADY_PROCESSED',
            409,
            'El pedido ya fue procesado.',
        );
    }
}

const loadProducts = async (
    tx: PrismaTx,
    tenantId: string,
    productIds: string[],
): Promise<Map<string, FulfillmentProduct>> => {
    const uniqueIds = [...new Set(productIds)];
    const rows = await tx.product.findMany({
        where: { tenantId, id: { in: uniqueIds } },
        select: PRODUCT_SELECT,
    }) as unknown as FulfillmentProduct[];
    if (rows.length !== uniqueIds.length) {
        throw new PedidoFulfillmentError(
            'PEDIDO_PRODUCT_NOT_FOUND',
            409,
            'Un producto del pedido ya no existe en este negocio.',
        );
    }
    return new Map(rows.map((product) => [product.id, product]));
};

const writePedidoKardex = async (
    tx: PrismaTx,
    params: {
        tenantId: string;
        userId: string;
        pedidoId: string;
        productId: string;
        quantity: Decimal;
        stockBefore: number;
        stockAfter: number;
        warehouseId: string;
        referenceType: 'PEDIDO_RESERVA' | 'PEDIDO_VENTA';
        allocations: FefoAllocationResult['allocations'];
        unallocatedQuantity: Decimal;
    },
): Promise<void> => {
    let cursor = new Decimal(params.stockBefore);
    for (const allocation of params.allocations) {
        const after = cursor.minus(allocation.quantity);
        await tx.kardexMovement.create({
            data: {
                tenantId: params.tenantId,
                productId: params.productId,
                type: 'OUT',
                quantity: allocation.quantity.negated().toNumber(),
                stockBefore: cursor.toNumber(),
                stockAfter: after.toNumber(),
                referenceId: params.pedidoId,
                referenceType: params.referenceType,
                reason: `${params.referenceType === 'PEDIDO_RESERVA' ? 'Reserva' : 'Venta'} por entrega - lote ${allocation.batchNumber}`,
                userId: params.userId,
                batchId: allocation.batchId,
                warehouseId: params.warehouseId,
            },
        });
        cursor = after;
    }

    if (params.allocations.length === 0 || params.unallocatedQuantity.greaterThan(0)) {
        const quantity = params.allocations.length === 0
            ? params.quantity
            : params.unallocatedQuantity;
        const after = cursor.minus(quantity);
        await tx.kardexMovement.create({
            data: {
                tenantId: params.tenantId,
                productId: params.productId,
                type: 'OUT',
                quantity: quantity.negated().toNumber(),
                stockBefore: cursor.toNumber(),
                stockAfter: after.toNumber(),
                referenceId: params.pedidoId,
                referenceType: params.referenceType,
                reason: params.allocations.length === 0
                    ? `${params.referenceType === 'PEDIDO_RESERVA' ? 'Reserva' : 'Venta'} para entrega`
                    : 'Cantidad para entrega sin lote asignado',
                userId: params.userId,
                warehouseId: params.warehouseId,
            },
        });
        cursor = after;
    }

    if (cursor.minus(params.stockAfter).abs().greaterThan('0.000001')) {
        throw new PedidoFulfillmentError(
            'PEDIDO_RESERVATION_MISMATCH',
            500,
            'El detalle FEFO no coincide con el stock del pedido.',
        );
    }
};

export async function reservePedidoInTransaction(
    tx: PrismaTx,
    params: {
        pedidoId: string;
        tenantId: string;
        userId: string;
        nota?: string | null;
        lat?: number | null;
        lng?: number | null;
    },
) {
    await lockPedidoForFulfillment(tx, {
        pedidoId: params.pedidoId,
        tenantId: params.tenantId,
    });
    const pedido = await tx.pedido.findFirst({
        where: { id: params.pedidoId, tenantId: params.tenantId },
        include: { items: { select: PEDIDO_ITEM_SELECT } },
    });
    if (!pedido) {
        throw new PedidoFulfillmentError('PEDIDO_NOT_FOUND', 404, 'Pedido no encontrado.');
    }

    const transition = await tx.pedido.updateMany({
        where: {
            id: params.pedidoId,
            tenantId: params.tenantId,
            facturaId: null,
            estado: { notIn: ['preparando', 'entregado', 'cancelado'] },
        },
        data: { estado: 'preparando' },
    });
    if (transition.count !== 1) {
        throw new PedidoFulfillmentError(
            'PEDIDO_ALREADY_PREPARED',
            409,
            'El pedido ya está preparado, entregado o cancelado.',
        );
    }

    await tx.trackingEvento.create({
        data: {
            pedidoId: params.pedidoId,
            estado: 'preparando',
            nota: params.nota ?? null,
            lat: params.lat ?? null,
            lng: params.lng ?? null,
        },
    });

    const existing = await tx.kardexMovement.count({
        where: {
            tenantId: params.tenantId,
            referenceId: params.pedidoId,
            referenceType: 'PEDIDO_RESERVA',
        },
    });
    if (existing > 0) {
        return tx.pedido.findFirstOrThrow({ where: { id: params.pedidoId, tenantId: params.tenantId } });
    }

    const orderedItems = [...pedido.items].sort((left, right) => (
        left.productoId.localeCompare(right.productoId) || left.id.localeCompare(right.id)
    ));
    const products = await loadProducts(
        tx,
        params.tenantId,
        orderedItems.map((item) => item.productoId),
    );
    const tenant = await tx.tenant.findUnique({
        where: { id: params.tenantId },
        select: { allowNegativeStock: true },
    });
    const enforceStock = !(tenant?.allowNegativeStock ?? false);

    for (const item of orderedItems) {
        const product = products.get(item.productoId)!;
        const quantity = exactPedidoItemQuantity(item);
        const stock = await applyStockDelta(tx, {
            tenantId: params.tenantId,
            productId: product.id,
            delta: quantity.negated().toNumber(),
            enforceSufficient: enforceStock,
        });
        const allocation = product.requiresBatchTracking
            ? await withPedidoBatchError(() => consumeProductBatchesFefo(tx, {
                tenantId: params.tenantId,
                productId: product.id,
                quantity,
                enforceComplete: enforceStock,
            }))
            : { allocations: [], unallocatedQuantity: quantity };

        await writePedidoKardex(tx, {
            tenantId: params.tenantId,
            userId: params.userId,
            pedidoId: params.pedidoId,
            productId: product.id,
            quantity,
            stockBefore: stock.stockBefore,
            stockAfter: stock.stockAfter,
            warehouseId: stock.warehouseId,
            referenceType: 'PEDIDO_RESERVA',
            ...allocation,
        });
        if (product.requiresBatchTracking && allocation.unallocatedQuantity.greaterThan(0)) {
            await tx.auditLog.create({
                data: {
                    tenantId: params.tenantId,
                    userId: params.userId,
                    action: 'PEDIDO_BATCH_RECONCILIATION_REQUIRED',
                    details: JSON.stringify({
                        pedidoId: params.pedidoId,
                        productId: product.id,
                        unallocatedQuantity: allocation.unallocatedQuantity.toString(),
                    }),
                },
            });
        }
    }

    return tx.pedido.findFirstOrThrow({ where: { id: params.pedidoId, tenantId: params.tenantId } });
}

type PedidoReservationMovement = {
    id: string;
    productId: string;
    quantity: number;
    batchId: string | null;
    warehouseId: string | null;
    referenceType: 'PEDIDO_RESERVA' | 'PEDIDO_LIBERACION';
};

const reservationQuantity = (movement: PedidoReservationMovement): Decimal => {
    const quantity = new Decimal(movement.quantity);
    if (!quantity.isFinite() || !quantity.lessThan(0)) {
        throw new PedidoFulfillmentError(
            'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
            409,
            'La reserva contiene movimientos inválidos y requiere conciliación.',
        );
    }
    return quantity.abs().toDecimalPlaces(4);
};

const releaseQuantity = (movement: PedidoReservationMovement): Decimal => {
    const quantity = new Decimal(movement.quantity);
    if (!quantity.isFinite() || !quantity.greaterThan(0)) {
        throw new PedidoFulfillmentError(
            'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
            409,
            'La liberación histórica contiene movimientos inválidos y requiere conciliación.',
        );
    }
    return quantity.toDecimalPlaces(4);
};

const movementIdentity = (movement: PedidoReservationMovement): string => (
    `${movement.productId}:${movement.warehouseId ?? 'NO_WAREHOUSE'}:${movement.batchId ?? 'NO_BATCH'}`
);

export const isCompletePedidoReservationRelease = (
    reservations: readonly PedidoReservationMovement[],
    releases: readonly PedidoReservationMovement[],
): boolean => {
    if (reservations.length === 0) return releases.length === 0;
    if ([...reservations, ...releases].some((movement) => !movement.warehouseId)) return false;
    const expected = new Map<string, Decimal>();
    const restored = new Map<string, Decimal>();
    for (const movement of reservations) {
        const key = movementIdentity(movement);
        expected.set(key, (expected.get(key) ?? new Decimal(0)).plus(reservationQuantity(movement)));
    }
    for (const movement of releases) {
        const key = movementIdentity(movement);
        restored.set(key, (restored.get(key) ?? new Decimal(0)).plus(releaseQuantity(movement)));
    }
    if (expected.size !== restored.size) return false;
    return [...expected].every(([key, quantity]) => restored.get(key)?.equals(quantity) === true);
};

/**
 * Cancela un pedido y libera, dentro de la misma transacción, exactamente el
 * stock y los lotes que había consumido PEDIDO_RESERVA. El estado del pedido
 * funciona como claim idempotente: un replay de una cancelación ya confirmada
 * no vuelve a incrementar inventario.
 */
export async function cancelPedidoInTransaction(
    tx: PrismaTx,
    params: {
        pedidoId: string;
        tenantId: string;
        userId: string;
        nota?: string | null;
        lat?: number | null;
        lng?: number | null;
    },
) {
    await lockPedidoForFulfillment(tx, {
        pedidoId: params.pedidoId,
        tenantId: params.tenantId,
    });
    const pedido = await tx.pedido.findFirst({
        where: { id: params.pedidoId, tenantId: params.tenantId },
        include: {
            items: { select: PEDIDO_ITEM_SELECT },
            eventos: {
                where: { estado: 'preparando' },
                take: 1,
                select: { id: true },
            },
        },
    });
    if (!pedido) {
        throw new PedidoFulfillmentError('PEDIDO_NOT_FOUND', 404, 'Pedido no encontrado.');
    }
    if (pedido.facturaId || pedido.estado === 'entregado') {
        throw new PedidoFulfillmentError(
            'PEDIDO_ALREADY_PROCESSED',
            409,
            'Un pedido entregado o facturado no se puede cancelar desde entregas.',
        );
    }

    const movements = await tx.kardexMovement.findMany({
        where: {
            tenantId: params.tenantId,
            referenceId: params.pedidoId,
            referenceType: { in: ['PEDIDO_RESERVA', 'PEDIDO_LIBERACION'] },
        },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            productId: true,
            quantity: true,
            batchId: true,
            warehouseId: true,
            referenceType: true,
        },
    }) as PedidoReservationMovement[];
    const reservations = movements.filter((movement) => movement.referenceType === 'PEDIDO_RESERVA');
    const priorReleases = movements.filter((movement) => movement.referenceType === 'PEDIDO_LIBERACION');

    if (pedido.estado === 'cancelado') {
        if (isCompletePedidoReservationRelease(reservations, priorReleases)) {
            return { pedido, idempotentReplay: true, releasedQuantity: '0' };
        }
        throw new PedidoFulfillmentError(
            'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
            409,
            'El pedido está cancelado, pero su reserva no fue liberada completamente; requiere conciliación.',
        );
    }
    if (priorReleases.length > 0) {
        throw new PedidoFulfillmentError(
            'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
            409,
            'El pedido tiene liberaciones previas sin estado terminal y requiere conciliación.',
        );
    }

    if (
        reservations.length === 0
        && (pedido.estado === 'preparando' || pedido.eventos.length > 0)
    ) {
        throw new PedidoFulfillmentError(
            'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
            409,
            'El pedido figura preparado, pero no tiene evidencia completa de reserva para revertir.',
        );
    }
    if (reservations.length > 0) {
        validatePedidoReservationTotals(pedido.items, reservations);
        for (const movement of reservations) {
            reservationQuantity(movement);
            if (!movement.warehouseId) {
                throw new PedidoFulfillmentError(
                    'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
                    409,
                    'La reserva no identifica su bodega original y requiere conciliación.',
                );
            }
        }
    }

    const claim = await tx.pedido.updateMany({
        where: {
            id: params.pedidoId,
            tenantId: params.tenantId,
            facturaId: null,
            estado: { notIn: ['entregado', 'cancelado'] },
        },
        data: { estado: 'cancelado' },
    });
    if (claim.count !== 1) {
        const latest = await tx.pedido.findFirst({
            where: { id: params.pedidoId, tenantId: params.tenantId },
            include: { items: { select: PEDIDO_ITEM_SELECT } },
        });
        if (latest?.estado === 'cancelado') {
            return { pedido: latest, idempotentReplay: true, releasedQuantity: '0' };
        }
        throw new PedidoFulfillmentError(
            'PEDIDO_ALREADY_PROCESSED',
            409,
            'El pedido ya fue entregado, facturado o procesado por otra operación.',
        );
    }

    const groups = new Map<string, PedidoReservationMovement[]>();
    for (const movement of reservations) {
        const key = `${movement.productId}:${movement.warehouseId!}`;
        const group = groups.get(key) ?? [];
        group.push(movement);
        groups.set(key, group);
    }

    const released = [] as Array<{
        productId: string;
        warehouseId: string;
        quantity: string;
        batches: Array<{ batchId: string; quantity: string }>;
    }>;
    let releasedTotal = new Decimal(0);
    const orderedGroups = [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, group]) => group);
    for (const group of orderedGroups) {
        const productId = group[0].productId;
        const warehouseId = group[0].warehouseId!;
        const quantity = group.reduce(
            (sum, movement) => sum.plus(reservationQuantity(movement)),
            new Decimal(0),
        ).toDecimalPlaces(4);
        const stock = await applyStockDelta(tx, {
            tenantId: params.tenantId,
            productId,
            delta: quantity.toNumber(),
            enforceSufficient: false,
            warehouseId,
        });
        let cursor = new Decimal(stock.stockBefore);
        const batches: Array<{ batchId: string; quantity: string }> = [];
        for (const movement of group) {
            const movementQuantity = reservationQuantity(movement);
            if (movement.batchId) {
                const restored = await tx.productBatch.updateMany({
                    where: {
                        id: movement.batchId,
                        tenantId: params.tenantId,
                        productId,
                    },
                    data: { stock: { increment: movementQuantity.toNumber() } },
                });
                if (restored.count !== 1) {
                    throw new PedidoFulfillmentError(
                        'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
                        409,
                        'Un lote reservado ya no pertenece al pedido o al negocio; no se alteró inventario.',
                    );
                }
                batches.push({ batchId: movement.batchId, quantity: movementQuantity.toFixed(4) });
            }
            const after = cursor.plus(movementQuantity);
            await tx.kardexMovement.create({
                data: {
                    tenantId: params.tenantId,
                    productId,
                    type: 'RETURN',
                    quantity: movementQuantity.toNumber(),
                    stockBefore: cursor.toNumber(),
                    stockAfter: after.toNumber(),
                    referenceId: params.pedidoId,
                    referenceType: 'PEDIDO_LIBERACION',
                    reason: movement.batchId
                        ? 'Liberación de reserva por cancelación de pedido (lote original)'
                        : 'Liberación de reserva por cancelación de pedido',
                    userId: params.userId,
                    batchId: movement.batchId,
                    warehouseId,
                },
            });
            cursor = after;
        }
        if (cursor.minus(stock.stockAfter).abs().greaterThan('0.000001')) {
            throw new PedidoFulfillmentError(
                'PEDIDO_CANCELLATION_RECONCILIATION_REQUIRED',
                500,
                'La liberación de la reserva no coincide con el stock restaurado.',
            );
        }
        released.push({ productId, warehouseId, quantity: quantity.toFixed(4), batches });
        releasedTotal = releasedTotal.plus(quantity);
    }

    await tx.trackingEvento.create({
        data: {
            pedidoId: params.pedidoId,
            estado: 'cancelado',
            nota: params.nota ?? null,
            lat: params.lat ?? null,
            lng: params.lng ?? null,
        },
    });
    await tx.auditLog.create({
        data: {
            tenantId: params.tenantId,
            userId: params.userId,
            action: 'PEDIDO_CANCELLED',
            details: JSON.stringify({
                pedidoId: params.pedidoId,
                releasedQuantity: releasedTotal.toFixed(4),
                reservations: released,
            }),
        },
    });

    return {
        pedido: await tx.pedido.findFirstOrThrow({
            where: { id: params.pedidoId, tenantId: params.tenantId },
        }),
        idempotentReplay: false,
        releasedQuantity: releasedTotal.toFixed(4),
    };
}

const accountingUserForTenant = async (
    tx: PrismaTx,
    tenantId: string,
    requestedUserId?: string | null,
): Promise<string> => {
    if (requestedUserId) {
        const actor = await tx.user.findFirst({
            where: { id: requestedUserId, tenantId, status: 'ACTIVE' },
            select: { id: true },
        });
        if (actor) return actor.id;
    }
    const fallback = await tx.user.findFirst({
        where: {
            tenantId,
            status: 'ACTIVE',
            role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    if (!fallback) {
        throw new PedidoFulfillmentError(
            'PEDIDO_ACCOUNTING_USER_NOT_FOUND',
            409,
            'El negocio no tiene un usuario activo para registrar la entrega.',
        );
    }
    return fallback.id;
};

export async function completePedidoDeliveryInTransaction(
    tx: PrismaTx,
    params: PedidoSelector & {
        actorUserId?: string | null;
        auditUserId?: string;
        source: 'DELIVERY_DASHBOARD' | 'DRIVER_APP';
        nota?: string | null;
        lat?: number | null;
        lng?: number | null;
    },
) {
    // claimPedidoDelivery toma el row-lock antes de evaluar el estado. El
    // snapshot contable se carga solo después, todavía dentro de la misma tx.
    await claimPedidoDelivery(tx, params);
    const pedido = await tx.pedido.findFirst({
        where: selectorWhere(params),
        include: { items: { select: PEDIDO_ITEM_SELECT } },
    });
    if (!pedido) {
        throw new PedidoFulfillmentError(
            'PEDIDO_NOT_FOUND',
            404,
            params.motorizadoId
                ? 'Pedido no encontrado o no asignado a este motorizado.'
                : 'Pedido no encontrado.',
        );
    }
    const financialUserId = await accountingUserForTenant(
        tx,
        pedido.tenantId,
        params.actorUserId,
    );
    const auditUserId = params.auditUserId ?? params.actorUserId ?? financialUserId;

    await tx.trackingEvento.create({
        data: {
            pedidoId: pedido.id,
            estado: 'entregado',
            nota: params.nota ?? null,
            lat: params.lat ?? null,
            lng: params.lng ?? null,
        },
    });
    if (params.lat !== null && params.lat !== undefined && params.lng !== null && params.lng !== undefined) {
        await tx.auditLog.create({
            data: {
                tenantId: pedido.tenantId,
                userId: auditUserId,
                action: 'GPS_AUDIT_ALERT',
                details: JSON.stringify({
                    mensaje: 'Pedido entregado con coordenadas GPS.',
                    lat: params.lat,
                    lng: params.lng,
                    pedidoId: pedido.id,
                    source: params.source,
                    motorizadoId: params.motorizadoId ?? null,
                }),
            },
        });
    }

    const orderedItems = [...pedido.items].sort((left, right) => (
        left.productoId.localeCompare(right.productoId) || left.id.localeCompare(right.id)
    ));
    const products = await loadProducts(
        tx,
        pedido.tenantId,
        orderedItems.map((item) => item.productoId),
    );
    const reservations = await tx.kardexMovement.findMany({
        where: {
            tenantId: pedido.tenantId,
            referenceId: pedido.id,
            referenceType: 'PEDIDO_RESERVA',
        },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: { productId: true, quantity: true, batchId: true },
    });
    const wasReserved = reservations.length > 0;
    const tenant = wasReserved
        ? null
        : await tx.tenant.findUnique({
            where: { id: pedido.tenantId },
            select: { allowNegativeStock: true },
        });
    const enforceStock = !(tenant?.allowNegativeStock ?? false);

    if (wasReserved) {
        validatePedidoReservationTotals(pedido.items, reservations);
    }

    // Pool determinista de los lotes reservados. Si hay dos líneas del mismo
    // SKU (BASE + PACK), cada lote se asigna una sola vez y en orden histórico.
    const reservedBatchPool = new Map<string, Map<string, Decimal>>();
    for (const movement of reservations) {
        if (!movement.batchId) continue;
        const productPool = reservedBatchPool.get(movement.productId) ?? new Map<string, Decimal>();
        productPool.set(
            movement.batchId,
            (productPool.get(movement.batchId) ?? new Decimal(0)).plus(new Decimal(movement.quantity).abs()),
        );
        reservedBatchPool.set(movement.productId, productPool);
    }

    const exemptTotal = orderedItems.reduce((sum, item) => {
        const product = products.get(item.productoId)!;
        return (item.ivaExentoAtOrder ?? product.ivaExento)
            ? sum.plus(item.subtotal.toString())
            : sum;
    }, new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const sale = await tx.sale.create({
        data: {
            tenantId: pedido.tenantId,
            total: pedido.total,
            exemptTotal: exemptTotal.toFixed(2),
            status: 'COMPLETED',
            paymentMethod: 'CASH',
            soldById: params.actorUserId ?? null,
            customerName: pedido.clienteNombre,
        },
    });

    let costTotal = new Decimal(0);
    for (const item of orderedItems) {
        const product = products.get(item.productoId)!;
        const quantity = exactPedidoItemQuantity(item);
        const persistedCost = new Decimal(product.cost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const currentRules = effectiveSaleModeAndStep(product.saleMode, product.quantityStep);
        const orderMode = item.saleModeAtOrder === 'COUNTED'
            ? 'COUNTED'
            : item.saleModeAtOrder === 'MEASURED'
                ? 'MEASURED'
                : null;
        const rules = orderMode
            ? {
                saleMode: orderMode,
                quantityStep: item.quantityStepAtOrder?.toString()
                    ?? (orderMode === 'COUNTED' ? '1' : '0.0001'),
            }
            : currentRules;
        // Pedidos nuevos congelan 4dp. Para pedidos legacy reconstruimos desde
        // subtotal/cantidad, preservando C$10 / 3 en vez de C$3.33 x 3.
        const unitPriceExact = item.unitPriceExactAtOrder == null
            ? new Decimal(item.subtotal.toString())
                .dividedBy(quantity)
                .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            : new Decimal(item.unitPriceExactAtOrder.toString()).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        const saleItem = await tx.saleItem.create({
            data: {
                saleId: sale.id,
                productId: product.id,
                quantity: quantity.toNumber(),
                priceAtSale: new Decimal(item.precioUnitario.toString()).toFixed(2),
                unitPriceExactAtSale: unitPriceExact.toFixed(4),
                costAtSale: persistedCost.toFixed(2),
                discount: 0,
                ivaExento: item.ivaExentoAtOrder ?? product.ivaExento,
                productNameAtSale: item.productNameAtOrder?.trim() || product.name,
                unitAtSale: item.unitAtOrder?.trim() || product.unit,
                saleModeAtSale: rules.saleMode,
                quantityStepAtSale: rules.quantityStep,
                presentationAtSale: item.presentationAtSale ?? 'BASE',
                presentationQuantityAtSale: item.presentationQuantityAtSale?.toString() ?? quantity.toFixed(4),
            },
        });
        costTotal = costTotal.plus(persistedCost.mul(quantity));

        if (wasReserved) {
            const productPool = reservedBatchPool.get(product.id) ?? new Map<string, Decimal>();
            let remainingForLine = quantity;
            let allocatedForLine = new Decimal(0);
            for (const [batchId, available] of productPool) {
                if (!remainingForLine.greaterThan(0)) break;
                const allocated = Decimal.min(available, remainingForLine).toDecimalPlaces(4);
                if (!allocated.greaterThan(0)) continue;
                await tx.saleItemBatchAllocation.create({
                    data: {
                        tenantId: pedido.tenantId,
                        saleItemId: saleItem.id,
                        batchId,
                        quantity: allocated.toFixed(4),
                    },
                });
                productPool.set(batchId, available.minus(allocated));
                remainingForLine = remainingForLine.minus(allocated);
                allocatedForLine = allocatedForLine.plus(allocated);
            }
            if (product.requiresBatchTracking) {
                if (allocatedForLine.lessThan(quantity)) {
                    await tx.auditLog.create({
                        data: {
                            tenantId: pedido.tenantId,
                            userId: auditUserId,
                            action: 'SALE_BATCH_RECONCILIATION_REQUIRED',
                            details: JSON.stringify({
                                pedidoId: pedido.id,
                                saleId: sale.id,
                                saleItemId: saleItem.id,
                                productId: product.id,
                                unallocatedQuantity: quantity.minus(allocatedForLine).toString(),
                            }),
                        },
                    });
                }
            }
            continue;
        }

        const stock = await applyStockDelta(tx, {
            tenantId: pedido.tenantId,
            productId: product.id,
            delta: quantity.negated().toNumber(),
            enforceSufficient: enforceStock,
        });
        const allocation = product.requiresBatchTracking
            ? await withPedidoBatchError(() => allocateSaleItemBatchesFefo(tx, {
                tenantId: pedido.tenantId,
                productId: product.id,
                saleItemId: saleItem.id,
                quantity,
                enforceComplete: enforceStock,
            }))
            : { allocations: [], unallocatedQuantity: quantity };
        await writePedidoKardex(tx, {
            tenantId: pedido.tenantId,
            userId: financialUserId,
            pedidoId: pedido.id,
            productId: product.id,
            quantity,
            stockBefore: stock.stockBefore,
            stockAfter: stock.stockAfter,
            warehouseId: stock.warehouseId,
            referenceType: 'PEDIDO_VENTA',
            ...allocation,
        });
    }

    await tx.payment.create({
        data: {
            saleId: sale.id,
            amount: pedido.total,
            method: 'CASH',
            collectedBy: financialUserId,
        },
    });
    await recordSale(
        tx as Parameters<typeof recordSale>[0],
        pedido.tenantId,
        financialUserId,
        sale.id,
        Number(pedido.total),
        costTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        'CASH',
        exemptTotal.toNumber(),
    );
    await tx.pedido.update({ where: { id: pedido.id }, data: { facturaId: sale.id } });
    await tx.auditLog.create({
        data: {
            tenantId: pedido.tenantId,
            userId: auditUserId,
            action: 'SALE_CREATED',
            details: JSON.stringify({
                pedidoId: pedido.id,
                saleId: sale.id,
                total: pedido.total.toString(),
                source: params.source,
                paymentMethod: 'CASH',
                measuredItemCount: pedido.items.filter((item) => !exactPedidoItemQuantity(item).isInteger()).length,
            }),
        },
    });

    return {
        pedido: await tx.pedido.findFirstOrThrow({ where: { id: pedido.id, tenantId: pedido.tenantId } }),
        sale,
        costoEntrega: pedido.costoEntrega,
        clienteNombre: pedido.clienteNombre,
        tenantId: pedido.tenantId,
    };
}
