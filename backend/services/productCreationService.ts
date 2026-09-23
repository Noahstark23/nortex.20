import Decimal from 'decimal.js';
import { type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CreateProductSchema } from '../validation/schemas.js';
import { applyStockDelta, asegurarBodegaPorDefecto } from './stockService.js';
import { assertAggregateBatchMutationAllowed } from '../lib/manualBatchMovements.js';
import { resolveBatchWarehouseLedgerMode } from './productBatchWarehouseLedgerService.js';
import { recordInitialInventory } from './accounting.js';

export type ProductCreationPrincipal = { tenantId: string; userId: string };
export type ProductCreationInput = z.infer<typeof CreateProductSchema>;
export class DuplicateProductCode extends Error {
    constructor(public productId: string) { super('SKU ya existe en tu inventario'); }
}
/** Input has passed CreateProductSchema, including authoritative quantity validation. */
export async function createProductInTransaction(tx: Prisma.TransactionClient, principal: ProductCreationPrincipal, input: ProductCreationInput) {
    const {
        name, sku, description, brand, category, price, cost, stock, minStock, unit,
        saleMode, quantityStep, productFamily, isPublished, imageUrl,
        requiresBatchTracking, reorderPoint, maxStock, defaultSupplierId,
        wholesalePrice, wholesaleMinQty, packUnit, packSize, packPrice, ivaExento,
    } = input;

    const decimalOrNull = (value: unknown): number | null =>
        value === undefined || value === null || value === '' ? null : new Decimal(value as Decimal.Value).toNumber();
    const wp = decimalOrNull(wholesalePrice);
    const wq = decimalOrNull(wholesaleMinQty);
    const pUnit = typeof packUnit === 'string' && packUnit.trim() !== '' ? packUnit.trim() : null;
    const pSize = decimalOrNull(packSize);
    const pPrice = decimalOrNull(packPrice);
    if (pPrice !== null && pSize === null) {
        throw new Error('El precio de empaque requiere definir el tamaño del empaque (unidades por caja/fardo)');
    }

    const initialStock = new Decimal(stock ?? '0').toNumber();
    const initialMinStock = new Decimal(minStock ?? '5').toNumber();
    const reorder = new Decimal(reorderPoint ?? '0').toNumber();
    const maximum = new Decimal(maxStock ?? '0').toNumber();

    if (initialStock > 0 && Boolean(requiresBatchTracking)) {
        const authoritativeBatchMode = await resolveBatchWarehouseLedgerMode(tx, principal.tenantId);
        assertAggregateBatchMutationAllowed({
            mode: authoritativeBatchMode,
            requiresBatchTracking: true,
            delta: initialStock,
        });
    }
    if (defaultSupplierId) {
        const supplier = await tx.supplier.findFirst({
            where: { id: defaultSupplierId, tenantId: principal.tenantId },
            select: { id: true },
        });
        if (!supplier) throw new Error('PROVEEDOR_NO_ENCONTRADO');
    }

    // Nace en cero y el stock inicial entra por el mismo camino atómico
    // que cualquier otro movimiento, manteniendo ProductStock y Kardex.
    const created = await tx.product.create({
        data: {
            tenantId: principal.tenantId,
            name,
            sku: sku.toUpperCase(),
            description: description || null,
            brand: brand || null,
            category: category || null,
            price: new Decimal(price).toNumber(),
            cost: new Decimal(cost ?? 0).toNumber(),
            stock: 0,
            minStock: initialMinStock,
            unit,
            saleMode: saleMode ?? null,
            quantityStep: quantityStep || null,
            productFamily: productFamily ?? null,
            isPublished: Boolean(isPublished),
            ivaExento: Boolean(ivaExento),
            imageUrl: imageUrl || null,
            requiresBatchTracking: Boolean(requiresBatchTracking),
            reorderPoint: reorder,
            maxStock: maximum,
            defaultSupplierId: defaultSupplierId || null,
            wholesalePrice: wp,
            wholesaleMinQty: wq,
            packUnit: pUnit,
            packSize: pSize,
            packPrice: pPrice,
            createdBy: principal.userId,
        },
    });

    if (initialStock > 0) {
        const stockResult = await applyStockDelta(tx, {
            tenantId: principal.tenantId,
            productId: created.id,
            delta: initialStock,
            enforceSufficient: false,
        });
        await tx.kardexMovement.create({
            data: {
                tenantId: principal.tenantId,
                productId: created.id,
                type: 'IN',
                quantity: initialStock,
                stockBefore: stockResult.stockBefore,
                stockAfter: stockResult.stockAfter,
                referenceType: 'INITIAL',
                reason: 'Stock inicial al crear producto',
                userId: principal.userId,
                warehouseId: stockResult.warehouseId,
            },
        });
        await recordInitialInventory(tx, principal.tenantId, principal.userId, created.id, initialStock, created.cost);
    }

    await tx.auditLog.create({
        data: {
            tenantId: principal.tenantId,
            userId: principal.userId,
            action: 'PRODUCT_CREATED',
            details: JSON.stringify({
                productId: created.id,
                after: {
                    sku: created.sku,
                    name: created.name,
                    unit: created.unit,
                    saleMode: created.saleMode,
                    quantityStep: created.quantityStep?.toString() ?? null,
                    productFamily: created.productFamily,
                    stock: initialStock,
                },
            }),
        },
    });

    return tx.product.findUniqueOrThrow({ where: { id: created.id, tenantId: principal.tenantId } });

}

export async function executeProductCreation(db: PrismaClient, principal: ProductCreationPrincipal, raw: unknown) {
    const input = CreateProductSchema.parse(raw);
    const existing = await db.product.findUnique({ where: { tenantId_sku: { tenantId: principal.tenantId, sku: input.sku.toUpperCase() } } });
    if (existing) throw new DuplicateProductCode(existing.id);
    if (new Decimal(input.stock).gt(0)) {
        if (input.requiresBatchTracking) assertAggregateBatchMutationAllowed({ mode: await resolveBatchWarehouseLedgerMode(db, principal.tenantId), requiresBatchTracking: true, delta: new Decimal(input.stock).toNumber() });
        await asegurarBodegaPorDefecto(db, principal.tenantId);
    }
    try { return await db.$transaction(tx => createProductInTransaction(tx, principal, input)); }
    catch (error) {
        if ((error as {code?: string})?.code === 'P2002') {
            const duplicate = await db.product.findUnique({ where: { tenantId_sku: { tenantId: principal.tenantId, sku: input.sku.toUpperCase() } } });
            if (duplicate) throw new DuplicateProductCode(duplicate.id);
        }
        throw error;
    }
}
