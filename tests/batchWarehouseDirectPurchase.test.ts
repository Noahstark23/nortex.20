import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    applyBatchWarehouseDelta,
} from '../backend/services/productBatchWarehouseLedgerService';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const routeStart = server.indexOf("app.post('/api/purchases'");
const routeEnd = server.indexOf('// POST /api/purchases/:id/pay', routeStart);
if (routeStart < 0 || routeEnd < 0) throw new Error('No se encontró POST /api/purchases');
const purchaseRoute = server.slice(routeStart, routeEnd);

const sqlText = (query: unknown): string => {
    const sql = query as { strings?: readonly string[]; sql?: string };
    return sql.strings?.join('?') ?? sql.sql ?? String(query);
};

const sqlValues = (query: unknown): readonly unknown[] =>
    (query as { values?: readonly unknown[] }).values ?? [];

interface StoredLedgerEntry {
    id: string;
    tenantId: string;
    productId: string;
    batchId: string;
    warehouseId: string;
    quantityDelta: Decimal;
    stockBefore: Decimal;
    stockAfter: Decimal;
    movementType: string;
    referenceId: string | null;
    referenceType: string | null;
    sourceKey: string;
    payloadHash: string;
    status: string;
    userId: string;
}

const makeSidecarTx = (options: {
    warehouseId?: string;
    ledgerCreateFailure?: Error;
} = {}) => {
    const warehouseId = options.warehouseId ?? 'warehouse-explicit';
    let stock = new Decimal(0);
    const ledgerRows: StoredLedgerEntry[] = [];

    const ledgerFindFirst = vi.fn(async ({ where }: { where: { tenantId: string; sourceKey: string } }) => {
        const row = ledgerRows.find((entry) =>
            entry.tenantId === where.tenantId && entry.sourceKey === where.sourceKey);
        return row
            ? {
                id: row.id,
                status: row.status,
                payloadHash: row.payloadHash,
                quantityDelta: row.quantityDelta,
                stockBefore: row.stockBefore,
                stockAfter: row.stockAfter,
            }
            : null;
    });
    const ledgerCreate = vi.fn(async ({ data }: { data: Omit<StoredLedgerEntry, 'id'> }) => {
        if (options.ledgerCreateFailure) throw options.ledgerCreateFailure;
        const row: StoredLedgerEntry = {
            ...data,
            id: `ledger-${ledgerRows.length + 1}`,
            quantityDelta: new Decimal(data.quantityDelta.toString()),
            stockBefore: new Decimal(data.stockBefore.toString()),
            stockAfter: new Decimal(data.stockAfter.toString()),
        };
        ledgerRows.push(row);
        return { id: row.id };
    });
    const warehouseFindFirst = vi.fn(async () => ({ id: warehouseId }));
    const userFindFirst = vi.fn(async () => ({ id: 'user-1' }));
    const balanceCreateMany = vi.fn(async () => ({ count: 1 }));
    const balanceUpdateMany = vi.fn(async ({ data }: {
        data: { stock: { increment: { toString(): string } } };
    }) => {
        stock = stock.plus(data.stock.increment.toString());
        return { count: 1 };
    });
    const auditCreate = vi.fn(async () => ({ id: 'audit-unexpected' }));
    const queryRaw = vi.fn(async (query: unknown) => {
        const text = sqlText(query);
        const values = sqlValues(query);
        if (text.includes('ProductBatchWarehouseStock')) {
            return [{ id: 'balance-1', productId: 'product-1', stock }];
        }
        if (text.includes('ProductBatchLedgerEntry')) {
            const [tenantId, sourceKey] = values.map(String);
            const row = ledgerRows.find((entry) =>
                entry.tenantId === tenantId && entry.sourceKey === sourceKey);
            return row ? [row] : [];
        }
        if (text.includes('ProductBatch')) {
            return [{ id: 'batch-1', productId: 'product-1' }];
        }
        if (text.includes('Product')) {
            return [{ id: 'product-1' }];
        }
        throw new Error(`SQL inesperado en prueba: ${text}`);
    });

    const tx = {
        productBatchLedgerEntry: {
            findFirst: ledgerFindFirst,
            create: ledgerCreate,
        },
        warehouse: { findFirst: warehouseFindFirst },
        user: { findFirst: userFindFirst },
        productBatchWarehouseStock: {
            createMany: balanceCreateMany,
            updateMany: balanceUpdateMany,
        },
        auditLog: { create: auditCreate },
        $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;

    return {
        tx,
        ledgerRows,
        getStock: () => stock.toFixed(4),
        mocks: {
            ledgerCreate,
            warehouseFindFirst,
            userFindFirst,
            balanceCreateMany,
            balanceUpdateMany,
            auditCreate,
        },
    };
};

const directPurchaseIntent = (overrides: {
    warehouseId?: string;
    delta?: string;
    sourceKey?: string;
} = {}) => ({
    tenantId: 'tenant-1',
    productId: 'product-1',
    batchId: 'batch-1',
    warehouseId: overrides.warehouseId ?? 'warehouse-explicit',
    delta: overrides.delta ?? '0.0001',
    movementType: 'DIRECT_PURCHASE' as const,
    referenceId: 'purchase-1',
    referenceType: 'PURCHASE',
    userId: 'user-1',
    reason: 'Compra Factura #FAC-1',
    sourceKey: overrides.sourceKey ?? 'direct-purchase:purchase-1:item:item-1',
    allowNegative: false,
});

describe('ingreso lote+bodega en compra directa', () => {
    it('OFF conserva el no-op y la ruta resuelve el modo una sola vez desde el tenant', async () => {
        const result = await applyBatchWarehouseDelta({
            tx: {} as Prisma.TransactionClient,
            mode: 'OFF',
            ...directPurchaseIntent(),
        });

        expect(result).toEqual({
            mode: 'OFF',
            status: 'OFF',
            applied: false,
            replay: false,
            ledgerEntryId: null,
            stockBefore: null,
            stockAfter: null,
            gap: null,
        });
        expect(purchaseRoute.match(/resolveBatchWarehouseLedgerMode\(/g)).toHaveLength(1);
        expect(purchaseRoute).toContain(
            'productsById.get(item.productId)?.requiresBatchTracking === true',
        );
        expect(purchaseRoute).toContain(
            'await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!)',
        );
        expect(purchaseRoute).not.toMatch(/req\.body[^;]*batchWarehouseLedgerMode/u);
    });

    it('SHADOW aplica el borde Decimal 0.0001 sin convertir el delta del core a Number', async () => {
        const fake = makeSidecarTx();
        const result = await applyBatchWarehouseDelta({
            tx: fake.tx,
            mode: 'SHADOW',
            ...directPurchaseIntent({ delta: '0.0001' }),
        });

        expect(result).toMatchObject({
            mode: 'SHADOW',
            status: 'APPLIED',
            applied: true,
            stockBefore: '0.0000',
            stockAfter: '0.0001',
        });
        expect(fake.getStock()).toBe('0.0001');
        expect(fake.ledgerRows[0]).toMatchObject({
            tenantId: 'tenant-1',
            warehouseId: 'warehouse-explicit',
            movementType: 'DIRECT_PURCHASE',
            referenceId: 'purchase-1',
            referenceType: 'PURCHASE',
            sourceKey: 'direct-purchase:purchase-1:item:item-1',
        });
        expect(fake.ledgerRows[0]?.quantityDelta.toFixed(4)).toBe('0.0001');
        expect(fake.mocks.auditCreate).not.toHaveBeenCalled();
        expect(fake.mocks.userFindFirst).toHaveBeenCalledWith({
            where: { id: 'user-1', tenantId: 'tenant-1', status: 'ACTIVE' },
            select: { id: true },
        });
        expect(purchaseRoute).toContain('delta: item.quantityExact');
        expect(purchaseRoute).not.toContain('delta: item.stockQuantity,\n                            movementType:');
    });

    it('dos líneas del mismo SKU/lote conservan ids y sourceKeys distintos', async () => {
        const modeResolutionStart = purchaseRoute.indexOf('const batchWarehouseLedgerMode =');
        const processedStart = purchaseRoute.indexOf('const processedItems = preparedItems.map');
        const purchaseCreate = purchaseRoute.indexOf('const purchase = await tx.purchase.create', processedStart);
        const processedBlock = purchaseRoute.slice(processedStart, purchaseCreate);
        const sidecarStart = purchaseRoute.indexOf(
            "if (batchWarehouseLedgerMode === 'SHADOW' || batchWarehouseLedgerMode === 'ENFORCED')",
            purchaseCreate,
        );
        const sidecarEnd = purchaseRoute.indexOf('// Evidencia física de la entrada directa', sidecarStart);
        const sidecarBlock = purchaseRoute.slice(sidecarStart, sidecarEnd);
        const persistedSpread = processedBlock.indexOf('...persisted');
        const authoritativeId = processedBlock.indexOf('id: crypto.randomUUID()');

        expect(modeResolutionStart).toBeGreaterThan(0);
        expect(persistedSpread).toBeGreaterThan(0);
        expect(authoritativeId).toBeGreaterThan(persistedSpread);
        // La identidad es más fuerte que el sidecar: toda compra directa recibe
        // UUID. Las líneas tracked en SHADOW/ENFORCED lo heredan y el ledger exige
        // ese mismo UUID antes de formar el sourceKey idempotente.
        expect(purchaseRoute).toContain('const isDirectPurchase = !linkedPurchaseOrder');
        expect(purchaseRoute).toContain(
            'const hasTrackedDirectPurchaseItem = isDirectPurchase && preparedItems.some',
        );
        expect(purchaseRoute).toContain(
            'productsById.get(item.productId)?.requiresBatchTracking === true',
        );
        expect(processedBlock).toContain('isDirectPurchase ? { id: crypto.randomUUID() }');
        expect(purchaseRoute).toContain(
            "batchWarehouseLedgerMode === 'SHADOW' || batchWarehouseLedgerMode === 'ENFORCED'",
        );
        expect(purchaseRoute).toContain('create: processedItems.map');
        expect(purchaseRoute).toContain("|| (left.id ?? '').localeCompare(right.id ?? '')");
        expect(sidecarStart).toBeGreaterThan(purchaseCreate);
        expect(sidecarEnd).toBeGreaterThan(sidecarStart);
        expect(sidecarBlock).toContain("batchWarehouseLedgerMode === 'SHADOW'");
        expect(sidecarBlock).toContain("batchWarehouseLedgerMode === 'ENFORCED'");
        expect(sidecarBlock).toContain("if (!item.id) throw new Error('PURCHASE_ITEM_ID_REQUIRED')");
        expect(sidecarBlock).toContain(
            'sourceKey: `direct-purchase:${purchase.id}:item:${item.id}`',
        );

        const fake = makeSidecarTx();
        const lineIds = ['item-a', 'item-b'];
        for (const itemId of lineIds) {
            await applyBatchWarehouseDelta({
                tx: fake.tx,
                mode: 'SHADOW',
                ...directPurchaseIntent({
                    sourceKey: `direct-purchase:purchase-1:item:${itemId}`,
                }),
            });
        }
        const replay = await applyBatchWarehouseDelta({
            tx: fake.tx,
            mode: 'SHADOW',
            ...directPurchaseIntent({
                sourceKey: 'direct-purchase:purchase-1:item:item-a',
            }),
        });

        expect(fake.getStock()).toBe('0.0002');
        expect(replay).toMatchObject({ replay: true, applied: true, status: 'APPLIED' });
        expect(fake.ledgerRows.map((row) => row.sourceKey)).toEqual([
            'direct-purchase:purchase-1:item:item-a',
            'direct-purchase:purchase-1:item:item-b',
        ]);
        expect(new Set(fake.ledgerRows.map((row) => row.sourceKey)).size).toBe(2);
    });

    it('usa la bodega operacional real tanto cuando es explícita como cuando cae al default', async () => {
        expect(purchaseRoute).toContain(
            'await resolveOperationalWarehouse(tx, authReq.tenantId!, warehouseId)',
        );
        expect(purchaseRoute).toContain('warehouseId: operationWarehouse?.id');
        expect(purchaseRoute).toContain('warehouseId: purchaseWarehouseId');

        for (const warehouseId of ['warehouse-explicit', 'warehouse-default']) {
            const fake = makeSidecarTx({ warehouseId });
            await applyBatchWarehouseDelta({
                tx: fake.tx,
                mode: 'SHADOW',
                ...directPurchaseIntent({ warehouseId }),
            });
            expect(fake.mocks.warehouseFindFirst).toHaveBeenCalledWith({
                where: { id: warehouseId, tenantId: 'tenant-1', isActive: true },
                select: { id: true },
            });
            expect(fake.ledgerRows[0]?.warehouseId).toBe(warehouseId);
        }
    });

    it('propaga un fallo del ledger dentro de la tx antes de Kardex y auditoría final', async () => {
        const fake = makeSidecarTx({ ledgerCreateFailure: new Error('ledger no disponible') });
        const afterSidecar = vi.fn();

        await expect((async () => {
            await applyBatchWarehouseDelta({
                tx: fake.tx,
                mode: 'SHADOW',
                ...directPurchaseIntent(),
            });
            afterSidecar();
        })()).rejects.toThrow('ledger no disponible');

        // El helper no traga el fallo después de tocar el saldo: la transacción
        // exterior de Prisma es quien revierte compra/stock/costo/lote de una vez.
        expect(fake.mocks.balanceUpdateMany).toHaveBeenCalledTimes(1);
        expect(fake.mocks.ledgerCreate).toHaveBeenCalledTimes(1);
        expect(afterSidecar).not.toHaveBeenCalled();

        const transactionStart = purchaseRoute.indexOf('const result = await prisma.$transaction');
        const batchUpsert = purchaseRoute.indexOf('const batch = await tx.productBatch.upsert');
        const sidecar = purchaseRoute.indexOf('await applyBatchWarehouseDelta', batchUpsert);
        const kardex = purchaseRoute.indexOf('await tx.kardexMovement.create', sidecar);
        const purchaseAudit = purchaseRoute.indexOf("action: 'PURCHASE_CREATED'", kardex);
        expect(transactionStart).toBeGreaterThan(0);
        expect(batchUpsert).toBeGreaterThan(transactionStart);
        expect(sidecar).toBeGreaterThan(batchUpsert);
        expect(kardex).toBeGreaterThan(sidecar);
        expect(purchaseAudit).toBeGreaterThan(kardex);
        expect(purchaseRoute.slice(sidecar, kardex)).not.toContain('.catch(');
    });
});
