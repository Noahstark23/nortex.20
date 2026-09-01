import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { managuaCalendarDateFloor } from '../lib/managuaBusinessDate.js';

type Database = Pick<PrismaClient, '$queryRaw'> | Pick<Prisma.TransactionClient, '$queryRaw'>;

export const MAX_PHARMACY_AVAILABILITY_PRODUCTS = 1_000;

export type PharmacyInventoryMode = 'OFF' | 'ENFORCED';
export type PharmacyBatchWarehouseMode = 'OFF' | 'SHADOW' | 'ENFORCED';

export type PharmacyAvailabilityErrorCode =
    | 'INVALID_AUTHORITY'
    | 'INVALID_AS_OF'
    | 'INVALID_PRODUCT_IDS'
    | 'TOO_MANY_PRODUCTS'
    | 'AUTHORITY_NOT_FOUND'
    | 'INVALID_CONFIGURATION'
    | 'BATCH_WAREHOUSE_LEDGER_REQUIRED'
    | 'WAREHOUSE_REQUIRED'
    | 'WAREHOUSE_NOT_FOUND';

export class PharmacyAvailabilityError extends Error {
    constructor(
        public readonly code: PharmacyAvailabilityErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'PharmacyAvailabilityError';
    }
}

export interface PharmacyOperationalWarehouse {
    id: string;
    name: string;
    isDefault: boolean;
    assignedToUser: boolean;
}

export interface PharmacyProductAvailability {
    productId: string;
    /** Existencia física agregada histórica (`Product.stock`). */
    physicalStock: Decimal;
    /** Existencia que el POS puede ofrecer bajo la política vigente. */
    sellableStock: Decimal;
    requiresBatchTracking: boolean;
}

export interface PharmacyAvailabilityResult {
    pharmacyInventoryMode: PharmacyInventoryMode;
    batchWarehouseLedgerMode: PharmacyBatchWarehouseMode;
    enforced: boolean;
    warehouse: PharmacyOperationalWarehouse | null;
    byProductId: ReadonlyMap<string, PharmacyProductAvailability>;
}

interface TenantModeRow {
    pharmacyInventoryMode: string;
    batchWarehouseLedgerMode: string;
}

interface WarehouseRow {
    id: string;
    name: string;
    isDefault: boolean | number;
    isActive: boolean | number;
    assignedToUser: boolean | number;
}

interface AvailabilityRow {
    productId: string;
    physicalStock: Prisma.Decimal | Decimal | string | number;
    sellableStock: Prisma.Decimal | Decimal | string | number;
    requiresBatchTracking: boolean | number;
}

const requireServerAuthority = (tenantId: string, userId: string): void => {
    if (
        typeof tenantId !== 'string'
        || typeof userId !== 'string'
        || !tenantId.trim()
        || !userId.trim()
    ) {
        throw new PharmacyAvailabilityError(
            'INVALID_AUTHORITY',
            'La disponibilidad farmacéutica requiere tenant y usuario autenticados.',
        );
    }
};

const normalizeProductIds = (productIds: readonly string[]): string[] => {
    if (!Array.isArray(productIds)) {
        throw new PharmacyAvailabilityError(
            'INVALID_PRODUCT_IDS',
            'La lista de productos no es válida.',
        );
    }

    if (productIds.length > MAX_PHARMACY_AVAILABILITY_PRODUCTS) {
        throw new PharmacyAvailabilityError(
            'TOO_MANY_PRODUCTS',
            `La consulta admite hasta ${MAX_PHARMACY_AVAILABILITY_PRODUCTS} productos.`,
        );
    }

    const uniqueIds = new Set<string>();
    for (const value of productIds) {
        if (
            typeof value !== 'string'
            || value.trim().length === 0
            || value.length > 191
        ) {
            throw new PharmacyAvailabilityError(
                'INVALID_PRODUCT_IDS',
                'Cada producto debe tener un identificador válido.',
            );
        }
        uniqueIds.add(value);
    }

    return [...uniqueIds];
};

const normalizeBatchMode = (value: string): PharmacyBatchWarehouseMode => {
    if (value === 'OFF' || value === 'SHADOW' || value === 'ENFORCED') return value;
    throw new PharmacyAvailabilityError(
        'INVALID_CONFIGURATION',
        'La configuración del ledger lote-bodega no es reconocida.',
    );
};

const normalizePharmacyMode = (value: string): PharmacyInventoryMode => {
    if (value === 'OFF' || value === 'ENFORCED') return value;
    throw new PharmacyAvailabilityError(
        'INVALID_CONFIGURATION',
        'La configuración de inventario farmacéutico no es reconocida.',
    );
};

/**
 * Devuelve el inicio UTC del día CIVIL vigente en Managua.
 *
 * Los lotes históricos pueden estar guardados a medianoche UTC, mientras los
 * nuevos se normalizan a mediodía UTC. Usar el inicio del mismo calendario
 * incluye ambos formatos durante toda la fecha impresa del vencimiento.
 */
export const pharmacyExpiryCutoff = (asOf: Date = new Date()): Date => {
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
        throw new PharmacyAvailabilityError('INVALID_AS_OF', 'La fecha de consulta no es válida.');
    }
    return managuaCalendarDateFloor(asOf);
};

/**
 * Misma autoridad operativa de ventas: primero la carga activa asignada al
 * vendedor. Sin carga asignada, la venta cae en la bodega default (o en la más
 * antigua si un tenant legacy todavía no tiene default). La lectura no crea ni
 * promueve bodegas, pero selecciona exactamente la fila que resolvería ventas.
 */
export async function resolvePharmacyOperationalWarehouse(
    db: Database,
    tenantId: string,
    userId: string,
): Promise<PharmacyOperationalWarehouse> {
    requireServerAuthority(tenantId, userId);

    const assignedRows = await db.$queryRaw<WarehouseRow[]>(Prisma.sql`
        SELECT
            w.id,
            w.name,
            w.isDefault,
            w.isActive,
            TRUE AS assignedToUser
        FROM \`User\` u
        INNER JOIN Warehouse w
            ON w.tenantId = u.tenantId
           AND w.sellerId = u.id
           AND w.isActive = TRUE
        WHERE u.id = ${userId}
          AND u.tenantId = ${tenantId}
          AND u.status = 'ACTIVE'
        ORDER BY w.createdAt ASC, w.id ASC
        LIMIT 2
    `);
    if (assignedRows.length > 1) {
        throw new PharmacyAvailabilityError(
            'WAREHOUSE_REQUIRED',
            'El usuario tiene más de una carga activa asignada; corregí la asignación de bodegas.',
        );
    }
    const assignedWarehouse = assignedRows[0];
    if (assignedWarehouse) {
        return {
            id: assignedWarehouse.id,
            name: assignedWarehouse.name,
            isDefault: Boolean(assignedWarehouse.isDefault),
            assignedToUser: true,
        };
    }

    const fallbackRows = await db.$queryRaw<WarehouseRow[]>(Prisma.sql`
        SELECT
            w.id,
            w.name,
            w.isDefault,
            w.isActive,
            FALSE AS assignedToUser
        FROM \`User\` u
        INNER JOIN Warehouse w
            ON w.tenantId = u.tenantId
           AND w.isActive = TRUE
        WHERE u.id = ${userId}
          AND u.tenantId = ${tenantId}
          AND u.status = 'ACTIVE'
        ORDER BY w.isDefault DESC, w.createdAt ASC, w.id ASC
        LIMIT 1
    `);

    const warehouse = fallbackRows[0];
    if (!warehouse) {
        throw new PharmacyAvailabilityError(
            'WAREHOUSE_NOT_FOUND',
            'La bodega que usaría la venta no existe o está inactiva.',
        );
    }

    return {
        id: warehouse.id,
        name: warehouse.name,
        isDefault: Boolean(warehouse.isDefault),
        assignedToUser: Boolean(warehouse.assignedToUser),
    };
}

const rowsToAvailabilityMap = (
    rows: AvailabilityRow[],
): ReadonlyMap<string, PharmacyProductAvailability> => new Map(
    rows.map((row) => {
        const physicalStock = new Decimal(row.physicalStock.toString());
        const sellableStock = new Decimal(row.sellableStock.toString());
        return [row.productId, {
            productId: row.productId,
            physicalStock,
            sellableStock,
            requiresBatchTracking: Boolean(row.requiresBatchTracking),
        }];
    }),
);

export interface ResolvePharmacyAvailabilityParams {
    /** Ambos valores vienen del JWT autenticado, nunca del body/query. */
    tenantId: string;
    userId: string;
    productIds: readonly string[];
    asOf?: Date;
}

/**
 * Disponibilidad bulk para fusionar con DTOs de producto sin reemplazar stock.
 *
 * OFF devuelve un mapa vacío para que el caller conserve su DTO histórico sin
 * una segunda lectura redundante. En ENFORCED los productos sin lote conservan
 * Product.stock y los controlados por lote suman, en UNA consulta,
 * max(stock físico - retenido, 0) de lotes no vencidos en la bodega operativa.
 */
export async function resolvePharmacyProductAvailability(
    db: Database,
    params: ResolvePharmacyAvailabilityParams,
): Promise<PharmacyAvailabilityResult> {
    requireServerAuthority(params.tenantId, params.userId);
    const productIds = normalizeProductIds(params.productIds);

    const configs = await db.$queryRaw<TenantModeRow[]>(Prisma.sql`
        SELECT
            t.pharmacyInventoryMode,
            t.batchWarehouseLedgerMode
        FROM Tenant t
        INNER JOIN \`User\` u
            ON u.tenantId = t.id
           AND u.id = ${params.userId}
           AND u.status = 'ACTIVE'
        WHERE t.id = ${params.tenantId}
        LIMIT 1
    `);
    const config = configs[0];
    if (!config) {
        throw new PharmacyAvailabilityError(
            'AUTHORITY_NOT_FOUND',
            'No se pudo comprobar el tenant y usuario autenticados.',
        );
    }

    const pharmacyInventoryMode = normalizePharmacyMode(config.pharmacyInventoryMode);
    const batchWarehouseLedgerMode = normalizeBatchMode(config.batchWarehouseLedgerMode);

    if (pharmacyInventoryMode === 'ENFORCED' && batchWarehouseLedgerMode !== 'ENFORCED') {
        throw new PharmacyAvailabilityError(
            'BATCH_WAREHOUSE_LEDGER_REQUIRED',
            'La farmacia requiere el ledger lote-bodega en modo ENFORCED.',
        );
    }

    if (productIds.length === 0) {
        return {
            pharmacyInventoryMode,
            batchWarehouseLedgerMode,
            enforced: pharmacyInventoryMode === 'ENFORCED',
            warehouse: null,
            byProductId: new Map(),
        };
    }

    if (pharmacyInventoryMode === 'OFF') {
        return {
            pharmacyInventoryMode,
            batchWarehouseLedgerMode,
            enforced: false,
            warehouse: null,
            byProductId: new Map(),
        };
    }

    const warehouse = await resolvePharmacyOperationalWarehouse(
        db,
        params.tenantId,
        params.userId,
    );
    const expiryCutoff = pharmacyExpiryCutoff(params.asOf);
    const rows = await db.$queryRaw<AvailabilityRow[]>(Prisma.sql`
        SELECT
            p.id AS productId,
            p.stock AS physicalStock,
            p.requiresBatchTracking,
            CASE
                WHEN p.requiresBatchTracking = TRUE THEN COALESCE(SUM(
                    CASE
                        WHEN pb.id IS NOT NULL
                         AND pb.expiryDate >= ${expiryCutoff}
                            THEN GREATEST(pbws.stock - pbws.heldStock, 0)
                        ELSE 0
                    END
                ), 0)
                ELSE p.stock
            END AS sellableStock
        FROM Product p
        LEFT JOIN ProductBatchWarehouseStock pbws
            ON pbws.tenantId = p.tenantId
           AND pbws.productId = p.id
           AND pbws.warehouseId = ${warehouse.id}
        LEFT JOIN ProductBatch pb
            ON pb.id = pbws.batchId
           AND pb.tenantId = p.tenantId
           AND pb.productId = p.id
        WHERE p.tenantId = ${params.tenantId}
          AND p.id IN (${Prisma.join(productIds)})
        GROUP BY p.id, p.stock, p.requiresBatchTracking
    `);

    return {
        pharmacyInventoryMode,
        batchWarehouseLedgerMode,
        enforced: true,
        warehouse,
        byProductId: rowsToAvailabilityMap(rows),
    };
}
