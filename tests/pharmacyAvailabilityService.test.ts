import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    MAX_PHARMACY_AVAILABILITY_PRODUCTS,
    PharmacyAvailabilityError,
    pharmacyExpiryCutoff,
    resolvePharmacyOperationalWarehouse,
    resolvePharmacyProductAvailability,
} from '../backend/services/pharmacyAvailabilityService';

const queryText = (query: unknown): string => {
    const sql = query as { strings?: readonly string[]; sql?: string };
    return sql.strings?.join('?') ?? sql.sql ?? String(query);
};

const queryValues = (query: unknown): readonly unknown[] => {
    const sql = query as { values?: readonly unknown[] };
    return sql.values ?? [];
};

interface FakeOptions {
    pharmacyMode?: string;
    batchMode?: string;
    authorityExists?: boolean;
    assignedWarehouse?: {
        id: string;
        name: string;
        isDefault: boolean | number;
        isActive?: boolean | number;
        assignedToUser: boolean | number;
    } | null;
    assignedWarehouses?: Array<{
        id: string;
        name: string;
        isDefault: boolean | number;
        isActive?: boolean | number;
        assignedToUser: boolean | number;
    }>;
    activeWarehouses?: Array<{
        id: string;
        name: string;
        isDefault: boolean | number;
        isActive: boolean | number;
        assignedToUser: boolean | number;
    }>;
    availabilityRows?: Array<{
        productId: string;
        physicalStock: Prisma.Decimal | string | number;
        sellableStock: Prisma.Decimal | string | number;
        requiresBatchTracking: boolean | number;
    }>;
}

const fakeDatabase = (options: FakeOptions = {}) => {
    const queries: unknown[] = [];
    const queryRaw = vi.fn(async (query: unknown) => {
        queries.push(query);
        const text = queryText(query);

        if (text.includes('FROM Tenant t')) {
            return options.authorityExists === false
                ? []
                : [{
                    pharmacyInventoryMode: options.pharmacyMode ?? 'OFF',
                    batchWarehouseLedgerMode: options.batchMode ?? 'OFF',
                }];
        }
        if (text.includes('FROM `User` u')) {
            if (text.includes('w.sellerId = u.id')) {
                if (options.assignedWarehouses) return options.assignedWarehouses;
                return options.assignedWarehouse ? [options.assignedWarehouse] : [];
            }
            return options.activeWarehouses ?? [
                {
                    id: 'warehouse-default',
                    name: 'Principal',
                    isDefault: 1,
                    isActive: 1,
                    assignedToUser: 0,
                },
            ];
        }
        if (text.includes('FROM Product p')) {
            return options.availabilityRows ?? [];
        }
        throw new Error(`Consulta inesperada: ${text}`);
    });

    return {
        db: { $queryRaw: queryRaw } as any,
        queries,
        queryRaw,
    };
};

describe('pharmacyExpiryCutoff', () => {
    it('mantiene vigente la fecha impresa hasta medianoche civil de Managua', () => {
        expect(pharmacyExpiryCutoff(new Date('2026-08-22T05:59:59.999Z')).toISOString())
            .toBe('2026-08-21T00:00:00.000Z');
        expect(pharmacyExpiryCutoff(new Date('2026-08-22T06:00:00.000Z')).toISOString())
            .toBe('2026-08-22T00:00:00.000Z');
    });

    it('rechaza una fecha inválida en vez de abrir la disponibilidad', () => {
        expect(() => pharmacyExpiryCutoff(new Date('invalid'))).toThrowError(
            expect.objectContaining({ code: 'INVALID_AS_OF' }),
        );
    });
});

describe('resolvePharmacyOperationalWarehouse', () => {
    it('prioriza la carga activa asignada y siempre la limita al tenant y usuario', async () => {
        const { db, queries } = fakeDatabase({
            assignedWarehouse: {
                id: 'warehouse-seller',
                name: 'Carga de Ana',
                isDefault: 0,
                assignedToUser: 1,
            },
        });

        await expect(resolvePharmacyOperationalWarehouse(db, 'tenant-a', 'user-a')).resolves.toEqual({
            id: 'warehouse-seller',
            name: 'Carga de Ana',
            isDefault: false,
            assignedToUser: true,
        });

        const text = queryText(queries[0]);
        const values = queryValues(queries[0]);
        expect(text).toContain('w.isActive = TRUE');
        expect(text).toContain('w.sellerId = u.id');
        expect(text).toContain('u.tenantId = ?');
        expect(text).toContain("u.status = 'ACTIVE'");
        expect(text).toContain('ORDER BY w.createdAt ASC, w.id ASC');
        expect(text).toContain('LIMIT 2');
        expect(values).toEqual(['user-a', 'tenant-a']);
        expect(queries).toHaveLength(1);
    });

    it('falla cerrado ante datos corruptos con dos cargas activas asignadas al mismo usuario', async () => {
        const { db, queries } = fakeDatabase({
            assignedWarehouses: [
                { id: 'warehouse-a', name: 'Carga A', isDefault: 0, assignedToUser: 1 },
                { id: 'warehouse-b', name: 'Carga B', isDefault: 0, assignedToUser: 1 },
            ],
        });

        await expect(resolvePharmacyOperationalWarehouse(db, 'tenant-a', 'user-a')).rejects
            .toMatchObject({ code: 'WAREHOUSE_REQUIRED' });
        expect(queries).toHaveLength(1);
    });

    it('sin carga asignada usa la única bodega activa y ordena el fallback como ventas', async () => {
        const { db, queries } = fakeDatabase({
            activeWarehouses: [
                {
                    id: 'warehouse-only',
                    name: 'Única',
                    isDefault: 0,
                    isActive: 1,
                    assignedToUser: 0,
                },
            ],
        });

        await expect(resolvePharmacyOperationalWarehouse(db, 'tenant-a', 'user-a')).resolves.toEqual({
            id: 'warehouse-only',
            name: 'Única',
            isDefault: false,
            assignedToUser: false,
        });
        expect(queries).toHaveLength(2);
        expect(queryText(queries[1])).toContain('ORDER BY w.isDefault DESC, w.createdAt ASC, w.id ASC');
        expect(queryText(queries[1])).toContain('LIMIT 1');
    });

    it('con varias bodegas usa la default igual que la venta real', async () => {
        const { db } = fakeDatabase({
            activeWarehouses: [
                {
                    id: 'warehouse-default',
                    name: 'Principal',
                    isDefault: 1,
                    isActive: 1,
                    assignedToUser: 0,
                },
            ],
        });

        await expect(resolvePharmacyOperationalWarehouse(db, 'tenant-a', 'user-a')).resolves
            .toMatchObject({ id: 'warehouse-default', isDefault: true, assignedToUser: false });
    });

    it('ignora defaults inactivas y usa la bodega activa que ventas promovería', async () => {
        const { db } = fakeDatabase({
            activeWarehouses: [{
                id: 'warehouse-active',
                name: 'Sucursal activa',
                isDefault: 0,
                isActive: 1,
                assignedToUser: 0,
            }],
        });

        await expect(resolvePharmacyOperationalWarehouse(db, 'tenant-a', 'user-a')).resolves
            .toMatchObject({ id: 'warehouse-active', isDefault: false });
    });

    it('falla cerrado cuando el usuario no tiene una bodega activa autorizada', async () => {
        const { db } = fakeDatabase({ activeWarehouses: [] });

        await expect(resolvePharmacyOperationalWarehouse(db, 'tenant-a', 'user-a')).rejects
            .toMatchObject({ code: 'WAREHOUSE_NOT_FOUND' });
    });
});

describe('resolvePharmacyProductAvailability', () => {
    it('en OFF no agrega overrides ni repite la lectura histórica de productos o bodegas', async () => {
        const { db, queries } = fakeDatabase({
            pharmacyMode: 'OFF',
            batchMode: 'ENFORCED',
        });

        const result = await resolvePharmacyProductAvailability(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            productIds: ['product-tracked', 'product-regular'],
        });

        expect(result.enforced).toBe(false);
        expect(result.warehouse).toBeNull();
        expect(result.byProductId.size).toBe(0);
        expect(queries).toHaveLength(1);
        expect(queries.some((query) => queryText(query).includes('FROM `User` u'))).toBe(false);
        expect(queries.some((query) => queryText(query).includes('FROM Product p'))).toBe(false);
    });

    it('en ENFORCED usa una sola agregación bulk, bodega operativa y Decimal exacto', async () => {
        const { db, queries } = fakeDatabase({
            pharmacyMode: 'ENFORCED',
            batchMode: 'ENFORCED',
            assignedWarehouse: {
                id: 'warehouse-seller',
                name: 'Carga de Ana',
                isDefault: 0,
                assignedToUser: 1,
            },
            availabilityRows: [
                {
                    productId: 'medicine',
                    physicalStock: '12.0000',
                    sellableStock: '5.1234',
                    requiresBatchTracking: 1,
                },
                {
                    productId: 'bag',
                    physicalStock: '0.3000',
                    sellableStock: '0.3000',
                    requiresBatchTracking: 0,
                },
                {
                    productId: 'medicine-without-valid-batch',
                    physicalStock: '4.0000',
                    sellableStock: '0',
                    requiresBatchTracking: 1,
                },
            ],
        });

        const result = await resolvePharmacyProductAvailability(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            productIds: ['medicine', 'bag', 'medicine-without-valid-batch'],
            asOf: new Date('2026-08-22T05:59:59.999Z'),
        });

        expect(result.enforced).toBe(true);
        expect(result.warehouse?.id).toBe('warehouse-seller');
        expect(result.byProductId.get('medicine')?.physicalStock.toFixed(4)).toBe('12.0000');
        expect(result.byProductId.get('medicine')?.sellableStock.toFixed(4)).toBe('5.1234');
        expect(result.byProductId.get('bag')?.sellableStock.toFixed(4)).toBe('0.3000');
        expect(result.byProductId.get('medicine-without-valid-batch')?.sellableStock.isZero()).toBe(true);

        const bulkQueries = queries.filter((query) => queryText(query).includes('FROM Product p'));
        expect(bulkQueries).toHaveLength(1);
        const sql = queryText(bulkQueries[0]);
        const values = queryValues(bulkQueries[0]);
        expect(sql).toContain('GREATEST(pbws.stock - pbws.heldStock, 0)');
        expect(sql).toContain('pb.expiryDate >= ?');
        expect(sql).toContain('pbws.tenantId = p.tenantId');
        expect(sql).toContain('pb.tenantId = p.tenantId');
        expect(sql).toContain('p.tenantId = ?');
        expect(values).toContain('warehouse-seller');
        expect(values).toContain('tenant-a');
        expect(values).toContain('medicine');
        expect(values).toContain('bag');
        expect(values).toContain('medicine-without-valid-batch');
        expect(values.some((value) => (
            value instanceof Date && value.toISOString() === '2026-08-21T00:00:00.000Z'
        ))).toBe(true);
    });

    it('no habilita farmacia si el ledger exacto sigue OFF o SHADOW', async () => {
        const { db, queries } = fakeDatabase({
            pharmacyMode: 'ENFORCED',
            batchMode: 'SHADOW',
        });

        await expect(resolvePharmacyProductAvailability(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            productIds: ['medicine'],
        })).rejects.toMatchObject({ code: 'BATCH_WAREHOUSE_LEDGER_REQUIRED' });
        expect(queries).toHaveLength(1);
    });

    it('comprueba que el usuario activo pertenece al tenant antes de leer productos', async () => {
        const { db, queries } = fakeDatabase({ authorityExists: false });

        await expect(resolvePharmacyProductAvailability(db, {
            tenantId: 'tenant-a',
            userId: 'user-from-other-tenant',
            productIds: ['medicine'],
        })).rejects.toMatchObject({ code: 'AUTHORITY_NOT_FOUND' });

        expect(queries).toHaveLength(1);
        expect(queryValues(queries[0])).toEqual(['user-from-other-tenant', 'tenant-a']);
    });

    it('deduplica IDs, los parametriza y nunca interpola texto hostil en el SQL', async () => {
        const hostileId = "product') OR 1=1 --";
        const { db, queries } = fakeDatabase({
            pharmacyMode: 'ENFORCED',
            batchMode: 'ENFORCED',
            assignedWarehouse: {
                id: 'warehouse-seller',
                name: 'Carga',
                isDefault: 0,
                assignedToUser: 1,
            },
        });

        await resolvePharmacyProductAvailability(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            productIds: [hostileId, hostileId],
        });

        const productQuery = queries.find((query) => queryText(query).includes('FROM Product p'))!;
        expect(queryText(productQuery)).not.toContain(hostileId);
        expect(queryValues(productQuery).filter((value) => value === hostileId)).toHaveLength(1);
    });

    it('limita el tamaño antes de consultar la base', async () => {
        const { db, queryRaw } = fakeDatabase();
        const productIds = Array.from(
            { length: MAX_PHARMACY_AVAILABILITY_PRODUCTS + 1 },
            (_, index) => `product-${index}`,
        );

        await expect(resolvePharmacyProductAvailability(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            productIds,
        })).rejects.toBeInstanceOf(PharmacyAvailabilityError);
        await expect(resolvePharmacyProductAvailability(db, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            productIds,
        })).rejects.toMatchObject({ code: 'TOO_MANY_PRODUCTS' });
        expect(queryRaw).not.toHaveBeenCalled();
    });

    it('queda integrado en ambos contratos de /api/products sin reemplazar stock físico', () => {
        const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
        const start = server.indexOf("app.get('/api/products'");
        const end = server.indexOf("app.get('/api/products/categories", start);
        const route = server.slice(start, end);

        expect(server).toContain('const withPharmacySellableStock = async');
        expect(route).toContain("req.query.includeSellableStock === 'true'");
        expect(server).toContain('if (offset === 0 && !result.enforced) return products;');
        expect(server).toContain('sellableStock: sellableStock.toDecimalPlaces(4).toNumber()');
        expect(route.match(/withPharmacySellableStock\(/g)).toHaveLength(2);
        expect(route).toContain('productsWithAvailability.map(redactBodegueroProduct)');
        expect(route).toContain("error.code === 'WAREHOUSE_REQUIRED'");
        expect(route).not.toContain('stock: sellableStock');
    });
});
