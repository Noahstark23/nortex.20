import { type Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    BatchWarehouseLedgerError,
    buildBatchWarehousePayloadHash,
    type BatchWarehouseDeltaIntent,
    type BatchWarehouseLedgerMode,
} from '../backend/lib/batchWarehouseLedger';
import {
    applyBatchWarehouseDelta,
    executeBatchWarehouseDelta,
    resolveBatchWarehouseLedgerMode,
} from '../backend/services/productBatchWarehouseLedgerService';

const baseIntent = (overrides: Partial<BatchWarehouseDeltaIntent> = {}): BatchWarehouseDeltaIntent => ({
    tenantId: 'tenant-1',
    productId: 'product-1',
    batchId: 'batch-1',
    warehouseId: 'warehouse-1',
    delta: '1.0000',
    movementType: 'GOODS_RECEIPT',
    referenceId: 'receipt-1',
    referenceType: 'GOODS_RECEIPT',
    userId: 'user-1',
    reason: 'Recepción formal',
    sourceKey: 'goods-receipt:receipt-1:item-1',
    ...overrides,
});

interface ExistingEntry {
    id: string;
    status: 'APPLIED' | 'SHADOW_GAP';
    payloadHash: string;
    quantityDelta: Decimal;
    stockBefore: Decimal;
    stockAfter: Decimal;
}

interface FakeTxOptions {
    mode?: unknown;
    tenantExists?: boolean;
    warehouseExists?: boolean;
    userExists?: boolean;
    userStatus?: string;
    productExists?: boolean;
    batchExists?: boolean;
    batchProductId?: string;
    balanceProductId?: string;
    balanceExists?: boolean;
    initialStock?: string;
    fastReplay?: ExistingEntry | null;
    lockedReplay?: ExistingEntry | null;
    updateCount?: number;
    ledgerCreateError?: unknown;
    auditCreateError?: unknown;
}

const queryText = (query: unknown): string => {
    const sql = query as { strings?: readonly string[]; sql?: string };
    return sql.strings?.join('?') ?? sql.sql ?? String(query);
};

const queryValues = (query: unknown): readonly unknown[] => {
    const sql = query as { values?: readonly unknown[] };
    return sql.values ?? [];
};

const makeEntry = (
    request: BatchWarehouseDeltaIntent = baseIntent(),
    overrides: Partial<ExistingEntry> = {},
): ExistingEntry => ({
    id: 'ledger-existing',
    status: 'APPLIED',
    payloadHash: buildBatchWarehousePayloadHash(request),
    quantityDelta: new Decimal(request.delta.toString()),
    stockBefore: new Decimal('2'),
    stockAfter: new Decimal('3'),
    ...overrides,
});

const fakeTx = (options: FakeTxOptions = {}) => {
    const events: string[] = [];
    const auditRows: Array<{ action: string; details: string | null }> = [];
    const ledgerRows: Array<Record<string, unknown>> = [];
    const state = { stock: new Decimal(options.initialStock ?? '0') };

    const tenantFind = vi.fn(async () => {
        events.push('tenant-mode');
        return options.tenantExists === false
            ? null
            : { batchWarehouseLedgerMode: options.mode ?? 'SHADOW' };
    });
    const ledgerFind = vi.fn(async () => {
        events.push('fast-replay');
        return options.fastReplay ?? null;
    });
    const warehouseFind = vi.fn(async (args: unknown) => {
        events.push('warehouse');
        return options.warehouseExists === false ? null : { id: 'warehouse-1', args };
    });
    const userFind = vi.fn(async (args: unknown) => {
        events.push('user');
        return options.userExists === false || (options.userStatus && options.userStatus !== 'ACTIVE')
            ? null
            : { id: 'user-1', status: options.userStatus ?? 'ACTIVE', args };
    });
    const queryRaw = vi.fn(async (query: unknown) => {
        const text = queryText(query);
        if (text.includes('ProductBatchWarehouseStock')) {
            events.push('lock-balance');
            return options.balanceExists === false
                ? []
                : [{
                    id: 'balance-1',
                    productId: options.balanceProductId ?? 'product-1',
                    stock: state.stock,
                }];
        }
        if (text.includes('ProductBatchLedgerEntry')) {
            events.push('lock-ledger');
            return options.lockedReplay ? [options.lockedReplay] : [];
        }
        if (text.includes('ProductBatch')) {
            events.push('lock-batch');
            return options.batchExists === false
                ? []
                : [{ id: 'batch-1', productId: options.batchProductId ?? 'product-1' }];
        }
        if (text.includes('Product')) {
            events.push('lock-product');
            return options.productExists === false ? [] : [{ id: 'product-1' }];
        }
        throw new Error(`SQL inesperado en fake: ${text}`);
    });
    const balanceCreateMany = vi.fn(async (_args: unknown) => {
        events.push('materialize-balance');
        return { count: 1 };
    });
    const balanceUpdateMany = vi.fn(async (args: unknown) => {
        events.push('update-balance');
        const typed = args as { data: { stock: { increment: { toString(): string } } } };
        if ((options.updateCount ?? 1) === 1) {
            state.stock = state.stock.plus(typed.data.stock.increment.toString());
        }
        return { count: options.updateCount ?? 1 };
    });
    const ledgerCreate = vi.fn(async (args: unknown) => {
        events.push('ledger');
        if (options.ledgerCreateError) throw options.ledgerCreateError;
        const data = (args as { data: Record<string, unknown> }).data;
        ledgerRows.push(data);
        return { id: 'ledger-created' };
    });
    const auditCreate = vi.fn(async (args: unknown) => {
        events.push('audit');
        if (options.auditCreateError) throw options.auditCreateError;
        const data = (args as { data: { action: string; details?: string | null } }).data;
        auditRows.push({ action: data.action, details: data.details ?? null });
        return { id: 'audit-created' };
    });

    const tx = {
        tenant: { findFirst: tenantFind },
        productBatchLedgerEntry: { findFirst: ledgerFind, create: ledgerCreate },
        warehouse: { findFirst: warehouseFind },
        user: { findFirst: userFind },
        productBatchWarehouseStock: {
            createMany: balanceCreateMany,
            updateMany: balanceUpdateMany,
        },
        auditLog: { create: auditCreate },
        $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;

    return {
        tx,
        events,
        state,
        auditRows,
        ledgerRows,
        mocks: {
            tenantFind,
            ledgerFind,
            warehouseFind,
            userFind,
            queryRaw,
            balanceCreateMany,
            balanceUpdateMany,
            ledgerCreate,
            auditCreate,
        },
    };
};

const expectServiceError = async (
    promise: Promise<unknown>,
    code: BatchWarehouseLedgerError['code'],
    httpStatus: BatchWarehouseLedgerError['httpStatus'],
): Promise<BatchWarehouseLedgerError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(BatchWarehouseLedgerError);
        expect(error).toMatchObject({ code, httpStatus });
        return error as BatchWarehouseLedgerError;
    }
    throw new Error('Se esperaba BatchWarehouseLedgerError');
};

describe('resolveBatchWarehouseLedgerMode', () => {
    it('lee el modo con alcance de tenant y falla cerrado si es corrupto', async () => {
        const valid = fakeTx({ mode: 'ENFORCED' });
        await expect(resolveBatchWarehouseLedgerMode(valid.tx, ' tenant-1 ')).resolves.toBe('ENFORCED');
        expect(valid.mocks.tenantFind).toHaveBeenCalledWith({
            where: { id: 'tenant-1' },
            select: { batchWarehouseLedgerMode: true },
        });

        const invalid = fakeTx({ mode: 'UNKNOWN' });
        await expectServiceError(
            resolveBatchWarehouseLedgerMode(invalid.tx, 'tenant-1'),
            'BATCH_WAREHOUSE_INVALID_MODE',
            500,
        );
    });

    it('distingue tenant inexistente de un identificador inválido', async () => {
        await expectServiceError(
            resolveBatchWarehouseLedgerMode(fakeTx({ tenantExists: false }).tx, 'tenant-foreign'),
            'BATCH_WAREHOUSE_TENANT_NOT_FOUND',
            404,
        );
        await expectServiceError(
            resolveBatchWarehouseLedgerMode(fakeTx().tx, '   '),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
        );
    });

    it('permite resolver una vez y aplicar varias líneas sin N lecturas de Tenant', async () => {
        const fake = fakeTx({ mode: 'SHADOW' });
        const mode = await resolveBatchWarehouseLedgerMode(fake.tx, 'tenant-1');
        await applyBatchWarehouseDelta({ tx: fake.tx, mode, ...baseIntent() });
        await applyBatchWarehouseDelta({
            tx: fake.tx,
            mode,
            ...baseIntent({
                delta: '2',
                sourceKey: 'goods-receipt:receipt-1:item-2',
            }),
        });
        expect(fake.mocks.tenantFind).toHaveBeenCalledTimes(1);
        expect(fake.state.stock.toFixed(4)).toBe('3.0000');
    });
});

describe('applyBatchWarehouseDelta', () => {
    it('OFF es un no-op explícito sin tocar entidades ni crear filas', async () => {
        const fake = fakeTx({ mode: 'OFF' });
        await expect(applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent() })).resolves.toEqual({
            mode: 'OFF',
            status: 'OFF',
            applied: false,
            replay: false,
            ledgerEntryId: null,
            stockBefore: null,
            stockAfter: null,
            gap: null,
        });
        expect(fake.events).toEqual(['tenant-mode']);
    });

    it('reutiliza un modo resuelto y respeta Product -> ProductBatch -> balance', async () => {
        const fake = fakeTx({ initialStock: '1' });
        const result = await applyBatchWarehouseDelta({
            tx: fake.tx,
            mode: 'SHADOW',
            ...baseIntent({ delta: '0.0001' }),
        });

        expect(result).toMatchObject({
            mode: 'SHADOW',
            status: 'APPLIED',
            stockBefore: '1.0000',
            stockAfter: '1.0001',
        });
        expect(fake.mocks.tenantFind).not.toHaveBeenCalled();
        expect(fake.events).toEqual([
            'fast-replay',
            'warehouse',
            'user',
            'lock-product',
            'lock-batch',
            'materialize-balance',
            'lock-balance',
            'lock-ledger',
            'update-balance',
            'ledger',
        ]);
        expect(fake.state.stock.toFixed(4)).toBe('1.0001');
        expect(fake.ledgerRows[0]).toMatchObject({
            tenantId: 'tenant-1',
            productId: 'product-1',
            batchId: 'batch-1',
            warehouseId: 'warehouse-1',
            sourceKey: 'goods-receipt:receipt-1:item-1',
        });
        expect((fake.ledgerRows[0]?.quantityDelta as Decimal).toFixed(4)).toBe('0.0001');
        expect(fake.auditRows).toHaveLength(0);
        expect(fake.mocks.balanceCreateMany).toHaveBeenCalledWith({
            data: [{
                tenantId: 'tenant-1',
                productId: 'product-1',
                batchId: 'batch-1',
                warehouseId: 'warehouse-1',
                stock: new Decimal(0),
            }],
            skipDuplicates: true,
        });
    });

    it('materializa en cero y nunca infiere una bodega desde el stock global ambiguo', async () => {
        const fake = fakeTx({ mode: 'SHADOW', initialStock: '0' });
        await applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent({ delta: '2' }) });
        const call = fake.mocks.balanceCreateMany.mock.calls[0]?.[0] as {
            data: Array<{ stock: Decimal }>;
            skipDuplicates: boolean;
        };
        expect(call.data[0]?.stock.toFixed(4)).toBe('0.0000');
        expect(call.skipDuplicates).toBe(true);
    });

    it('falla cerrado si un modo pre-resuelto es inválido en runtime', async () => {
        const fake = fakeTx();
        await expectServiceError(
            applyBatchWarehouseDelta({
                tx: fake.tx,
                mode: 'BROKEN' as BatchWarehouseLedgerMode,
                ...baseIntent(),
            }),
            'BATCH_WAREHOUSE_INVALID_MODE',
            500,
        );
        expect(fake.events).toEqual([]);
    });

    it('hace replay exacto antes de locks y rechaza payload divergente con 409', async () => {
        const request = baseIntent();
        const exact = fakeTx({ fastReplay: makeEntry(request) });
        await expect(applyBatchWarehouseDelta({ tx: exact.tx, ...request })).resolves.toMatchObject({
            status: 'APPLIED',
            replay: true,
            ledgerEntryId: 'ledger-existing',
            stockBefore: '2.0000',
            stockAfter: '3.0000',
        });
        expect(exact.events).toEqual(['tenant-mode', 'fast-replay']);

        const conflict = fakeTx({ fastReplay: makeEntry(request, { payloadHash: 'otro' }) });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: conflict.tx, ...request }),
            'BATCH_WAREHOUSE_IDEMPOTENCY_CONFLICT',
            409,
        );
        expect(conflict.events).toEqual(['tenant-mode', 'fast-replay']);
    });

    it('cierra la carrera con una segunda lectura bloqueante antes de mutar', async () => {
        const request = baseIntent();
        const fake = fakeTx({ lockedReplay: makeEntry(request) });
        await expect(applyBatchWarehouseDelta({ tx: fake.tx, ...request })).resolves.toMatchObject({
            status: 'APPLIED',
            replay: true,
        });
        expect(fake.events.at(-1)).toBe('lock-ledger');
        expect(fake.mocks.balanceUpdateMany).not.toHaveBeenCalled();
        expect(fake.mocks.ledgerCreate).not.toHaveBeenCalled();
        expect(fake.mocks.auditCreate).not.toHaveBeenCalled();
    });

    it.each([
        {
            title: 'producto cross-tenant',
            options: { productExists: false },
            code: 'BATCH_WAREHOUSE_PRODUCT_NOT_FOUND' as const,
        },
        {
            title: 'lote cross-tenant',
            options: { batchExists: false },
            code: 'BATCH_WAREHOUSE_BATCH_NOT_FOUND' as const,
        },
        {
            title: 'lote de otro producto',
            options: { batchProductId: 'product-foreign' },
            code: 'BATCH_WAREHOUSE_BATCH_PRODUCT_MISMATCH' as const,
        },
    ])('rechaza $title sin crear balance', async ({ options, code }) => {
        const fake = fakeTx(options);
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent() }),
            code,
            code === 'BATCH_WAREHOUSE_BATCH_PRODUCT_MISMATCH' ? 409 : 404,
        );
        expect(fake.mocks.balanceCreateMany).not.toHaveBeenCalled();
        for (const call of fake.mocks.queryRaw.mock.calls) {
            expect(queryValues(call[0])).toContain('tenant-1');
        }
    });

    it.each([
        {
            title: 'bodega ajena/inactiva',
            options: { warehouseExists: false },
            code: 'BATCH_WAREHOUSE_WAREHOUSE_NOT_FOUND' as const,
        },
        {
            title: 'usuario ajeno',
            options: { userExists: false },
            code: 'BATCH_WAREHOUSE_USER_NOT_FOUND' as const,
        },
        {
            title: 'usuario inactivo',
            options: { userStatus: 'INACTIVE' },
            code: 'BATCH_WAREHOUSE_USER_NOT_FOUND' as const,
        },
    ])('rechaza $title con lectura tenant-scoped', async ({ options, code }) => {
        const fake = fakeTx(options);
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent() }),
            code,
            404,
        );
        expect(fake.mocks.balanceCreateMany).not.toHaveBeenCalled();
        if (code === 'BATCH_WAREHOUSE_WAREHOUSE_NOT_FOUND') {
            expect(fake.mocks.warehouseFind).toHaveBeenCalledWith({
                where: { id: 'warehouse-1', tenantId: 'tenant-1', isActive: true },
                select: { id: true },
            });
        } else {
            expect(fake.mocks.userFind).toHaveBeenCalledWith({
                where: { id: 'user-1', tenantId: 'tenant-1', status: 'ACTIVE' },
                select: { id: true },
            });
        }
    });

    it('SHADOW consume sourceKey con un evento gap sin falsificar saldo', async () => {
        const fake = fakeTx({ mode: 'SHADOW', initialStock: '0.5000' });
        const result = await applyBatchWarehouseDelta({
            tx: fake.tx,
            ...baseIntent({ delta: '-1.0000', reason: 'etiqueta interna sensible 991' }),
        });

        expect(result).toEqual({
            mode: 'SHADOW',
            status: 'SHADOW_GAP',
            applied: false,
            replay: false,
            ledgerEntryId: 'ledger-created',
            stockBefore: '0.5000',
            stockAfter: '0.5000',
            gap: '0.5000',
        });
        expect(fake.state.stock.toFixed(4)).toBe('0.5000');
        expect(fake.mocks.balanceUpdateMany).not.toHaveBeenCalled();
        expect(fake.mocks.ledgerCreate).toHaveBeenCalledTimes(1);
        expect(fake.ledgerRows[0]).toMatchObject({
            status: 'SHADOW_GAP',
            sourceKey: 'goods-receipt:receipt-1:item-1',
        });
        expect((fake.ledgerRows[0]?.stockBefore as Decimal).toFixed(4)).toBe('0.5000');
        expect((fake.ledgerRows[0]?.stockAfter as Decimal).toFixed(4)).toBe('0.5000');
        expect(fake.auditRows).toHaveLength(1);
        expect(fake.auditRows[0]?.action).toBe('BATCH_WAREHOUSE_SHADOW_GAP');
        const details = JSON.parse(fake.auditRows[0]?.details ?? '{}') as Record<string, unknown>;
        expect(details).toMatchObject({
            sourceKey: 'goods-receipt:receipt-1:item-1',
            before: { stock: '0.5000' },
            after: { stock: '0.5000' },
            requestedAfter: { stock: '-0.5000' },
            gap: '0.5000',
        });
        expect(fake.auditRows[0]?.details).not.toContain('etiqueta interna sensible');
        expect(fake.auditRows[0]?.details).not.toContain('barcode');
    });

    it('replay exacto de SHADOW_GAP no vuelve a auditar y conserva el gap', async () => {
        const request = baseIntent({ delta: '-1.0000' });
        const fake = fakeTx({
            mode: 'ENFORCED', // El evento nació en SHADOW; el modo puede cambiar luego.
            fastReplay: makeEntry(request, {
                status: 'SHADOW_GAP',
                quantityDelta: new Decimal('-1'),
                stockBefore: new Decimal('0.5'),
                stockAfter: new Decimal('0.5'),
            }),
        });
        await expect(applyBatchWarehouseDelta({ tx: fake.tx, ...request })).resolves.toEqual({
            mode: 'ENFORCED',
            status: 'SHADOW_GAP',
            applied: false,
            replay: true,
            ledgerEntryId: 'ledger-existing',
            stockBefore: '0.5000',
            stockAfter: '0.5000',
            gap: '0.5000',
        });
        expect(fake.events).toEqual(['tenant-mode', 'fast-replay']);
        expect(fake.mocks.auditCreate).not.toHaveBeenCalled();
    });

    it.each([
        makeEntry(baseIntent(), {
            status: 'INVALID' as ExistingEntry['status'],
        }),
        makeEntry(baseIntent(), {
            stockAfter: new Decimal('99'),
        }),
        makeEntry(baseIntent({ delta: '-1' }), {
            status: 'SHADOW_GAP',
            quantityDelta: new Decimal('-1'),
            stockBefore: new Decimal('2'),
            stockAfter: new Decimal('2'),
        }),
    ])('falla cerrado ante un evento persistido con invariantes corruptas', async (existing) => {
        const request = existing.status === 'SHADOW_GAP'
            ? baseIntent({ delta: '-1' })
            : baseIntent();
        const fake = fakeTx({ fastReplay: existing });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: fake.tx, ...request }),
            'BATCH_WAREHOUSE_LEDGER_CORRUPT',
            500,
        );
        expect(fake.mocks.balanceUpdateMany).not.toHaveBeenCalled();
    });

    it('ENFORCED rechaza insuficiencia con 409 y no deja audit ni ledger', async () => {
        const fake = fakeTx({ mode: 'ENFORCED', initialStock: '0.9999' });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent({ delta: '-1.0000' }) }),
            'BATCH_WAREHOUSE_INSUFFICIENT_STOCK',
            409,
        );
        expect(fake.mocks.balanceUpdateMany).not.toHaveBeenCalled();
        expect(fake.mocks.ledgerCreate).not.toHaveBeenCalled();
        expect(fake.mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('allowNegative explícito aplica saldo negativo con ledger inmutable', async () => {
        const fake = fakeTx({ mode: 'ENFORCED', initialStock: '0' });
        const result = await applyBatchWarehouseDelta({
            tx: fake.tx,
            ...baseIntent({ delta: '-0.0001', allowNegative: true }),
        });
        expect(result).toMatchObject({ status: 'APPLIED', stockAfter: '-0.0001' });
        expect(fake.state.stock.toFixed(4)).toBe('-0.0001');
        const update = fake.mocks.balanceUpdateMany.mock.calls[0]?.[0] as {
            where: Record<string, unknown>;
        };
        expect(update.where).not.toHaveProperty('stock');
    });

    it('usa guard atómico gte para una salida suficiente', async () => {
        const fake = fakeTx({ mode: 'ENFORCED', initialStock: '2' });
        await applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent({ delta: '-1.0000' }) });
        const update = fake.mocks.balanceUpdateMany.mock.calls[0]?.[0] as {
            where: { id: string; tenantId: string; stock: { gte: Decimal } };
        };
        expect(update.where).toMatchObject({ id: 'balance-1', tenantId: 'tenant-1' });
        expect(update.where.stock.gte.toFixed(4)).toBe('1.0000');
    });

    it('clasifica un update perdido sin escribir ledger', async () => {
        const positive = fakeTx({ updateCount: 0 });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: positive.tx, ...baseIntent() }),
            'BATCH_WAREHOUSE_CONCURRENT_WRITE',
            409,
        );
        expect(positive.mocks.ledgerCreate).not.toHaveBeenCalled();

        const negative = fakeTx({ mode: 'ENFORCED', initialStock: '2', updateCount: 0 });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: negative.tx, ...baseIntent({ delta: '-1' }) }),
            'BATCH_WAREHOUSE_INSUFFICIENT_STOCK',
            409,
        );
        expect(negative.mocks.ledgerCreate).not.toHaveBeenCalled();
    });

    it('convierte overflow del saldo resultante en 409 estable', async () => {
        const fake = fakeTx({ initialStock: '99999999999999.9999' });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent({ delta: '0.0001' }) }),
            'BATCH_WAREHOUSE_BALANCE_OVERFLOW',
            409,
        );
        expect(fake.mocks.balanceUpdateMany).not.toHaveBeenCalled();
        expect(fake.mocks.ledgerCreate).not.toHaveBeenCalled();
    });

    it('falla si createMany no deja una fila bloqueable', async () => {
        const fake = fakeTx({ balanceExists: false });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent() }),
            'BATCH_WAREHOUSE_CONCURRENT_WRITE',
            409,
        );
        expect(fake.mocks.balanceUpdateMany).not.toHaveBeenCalled();
    });

    it('falla si una fila materializada apunta a otro producto', async () => {
        const fake = fakeTx({ balanceProductId: 'product-foreign' });
        await expectServiceError(
            applyBatchWarehouseDelta({ tx: fake.tx, ...baseIntent() }),
            'BATCH_WAREHOUSE_BATCH_PRODUCT_MISMATCH',
            409,
        );
        expect(fake.mocks.balanceUpdateMany).not.toHaveBeenCalled();
    });
});

describe('executeBatchWarehouseDelta', () => {
    it('relee un P2002 fuera de la transacción abortada y devuelve replay exacto', async () => {
        const request = baseIntent();
        const p2002 = { code: 'P2002' };
        const existing = makeEntry(request);
        const freshFind = vi.fn(async () => existing);
        const tenantFind = vi.fn(async () => ({ batchWarehouseLedgerMode: 'SHADOW' }));
        const db = {
            $transaction: vi.fn(async () => { throw p2002; }),
            productBatchLedgerEntry: { findFirst: freshFind },
            tenant: { findFirst: tenantFind },
        } as unknown as PrismaClient;

        await expect(executeBatchWarehouseDelta({ db, ...request })).resolves.toMatchObject({
            status: 'APPLIED',
            ledgerEntryId: 'ledger-existing',
        });
        expect(freshFind).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 'tenant-1', sourceKey: request.sourceKey },
        }));
    });

    it('clasifica P2002 divergente y no disfraza un P2002 ajeno', async () => {
        const request = baseIntent();
        const conflictDb = {
            $transaction: vi.fn(async () => { throw { code: 'P2002' }; }),
            productBatchLedgerEntry: {
                findFirst: vi.fn(async () => makeEntry(request, { payloadHash: 'distinto' })),
            },
            tenant: { findFirst: vi.fn(async () => ({ batchWarehouseLedgerMode: 'SHADOW' })) },
        } as unknown as PrismaClient;
        await expectServiceError(
            executeBatchWarehouseDelta({ db: conflictDb, ...request }),
            'BATCH_WAREHOUSE_IDEMPOTENCY_CONFLICT',
            409,
        );

        const unrelated = { code: 'P2002', meta: { target: 'otro_indice' } };
        const unrelatedDb = {
            $transaction: vi.fn(async () => { throw unrelated; }),
            productBatchLedgerEntry: { findFirst: vi.fn(async () => null) },
        } as unknown as PrismaClient;
        await expect(executeBatchWarehouseDelta({ db: unrelatedDb, ...request })).rejects.toBe(unrelated);
    });

    it('la transacción revierte el ledger gap si falla su AuditLog obligatorio', async () => {
        const auditFailure = new Error('audit no disponible');
        const fake = fakeTx({ mode: 'SHADOW', initialStock: '0.5', auditCreateError: auditFailure });
        const db = {
            $transaction: vi.fn(async (
                operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
            ) => {
                const stockSnapshot = fake.state.stock;
                const ledgerSnapshot = fake.ledgerRows.length;
                try {
                    return await operation(fake.tx);
                } catch (error) {
                    fake.state.stock = stockSnapshot;
                    fake.ledgerRows.splice(ledgerSnapshot);
                    throw error;
                }
            }),
            productBatchLedgerEntry: { findFirst: fake.mocks.ledgerFind },
            tenant: { findFirst: fake.mocks.tenantFind },
        } as unknown as PrismaClient;

        await expect(executeBatchWarehouseDelta({
            db,
            ...baseIntent({ delta: '-1' }),
        })).rejects.toBe(auditFailure);
        expect(fake.state.stock.toFixed(4)).toBe('0.5000');
        expect(fake.ledgerRows).toHaveLength(0);
    });
});
