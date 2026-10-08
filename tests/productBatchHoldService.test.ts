import { type Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    assertProductBatchHoldReplay,
    buildCanonicalProductBatchHoldPayload,
    buildProductBatchHoldPayloadHash,
    canonicalProductBatchHoldBalance,
    canonicalProductBatchHoldDelta,
    normalizeProductBatchHoldDeltaIntent,
    ProductBatchHoldError,
    type ProductBatchHoldDeltaIntent,
} from '../backend/lib/productBatchHold';
import {
    applyProductBatchHoldDelta,
    executeProductBatchHoldDelta,
} from '../backend/services/productBatchHoldService';

const baseIntent = (
    overrides: Partial<ProductBatchHoldDeltaIntent> = {},
): ProductBatchHoldDeltaIntent => ({
    tenantId: 'tenant-1',
    productId: 'product-1',
    batchId: 'batch-1',
    warehouseId: 'warehouse-1',
    quantityDelta: '1.0000',
    holdReasonCode: 'CUSTOMER_RETURN_QUARANTINE',
    referenceId: 'return-1',
    referenceType: 'PRODUCT_RETURN',
    sourceKey: 'product-return:return-1:item:item-1:batch:batch-1',
    userId: 'user-1',
    notes: 'Pendiente de inspección',
    ...overrides,
});

interface ExistingHold {
    id: string;
    payloadHash: string;
    quantityDelta: Decimal;
    heldBefore: Decimal;
    heldAfter: Decimal;
    physicalStockSnapshot: Decimal;
    sellableBefore: Decimal;
    sellableAfter: Decimal;
}

interface FakeTxOptions {
    tenantType?: string;
    pharmacyMode?: string;
    batchMode?: string;
    tenantExists?: boolean;
    warehouseExists?: boolean;
    userExists?: boolean;
    productExists?: boolean;
    batchExists?: boolean;
    batchProductId?: string;
    balanceExists?: boolean;
    balanceProductId?: string;
    physicalStock?: string;
    heldStock?: string;
    fastReplay?: ExistingHold | null;
    lockedReplay?: ExistingHold | null;
    updateCount?: number;
    holdCreateError?: unknown;
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

const makeExisting = (
    intent: ProductBatchHoldDeltaIntent = baseIntent(),
    overrides: Partial<ExistingHold> = {},
): ExistingHold => ({
    id: 'hold-existing',
    payloadHash: buildProductBatchHoldPayloadHash(intent),
    quantityDelta: new Decimal(intent.quantityDelta.toString()),
    heldBefore: new Decimal('1'),
    heldAfter: new Decimal('2'),
    physicalStockSnapshot: new Decimal('5'),
    sellableBefore: new Decimal('4'),
    sellableAfter: new Decimal('3'),
    ...overrides,
});

const fakeTx = (options: FakeTxOptions = {}) => {
    const events: string[] = [];
    const holdRows: Array<Record<string, unknown>> = [];
    const auditRows: Array<{ action: string; details: string | null }> = [];
    const state = {
        stock: new Decimal(options.physicalStock ?? '5'),
        heldStock: new Decimal(options.heldStock ?? '1'),
    };

    const tenantFind = vi.fn(async () => {
        events.push('tenant-mode');
        return options.tenantExists === false
            ? null
            : {
                type: options.tenantType ?? 'FARMACIA',
                pharmacyInventoryMode: options.pharmacyMode ?? 'ENFORCED',
                batchWarehouseLedgerMode: options.batchMode ?? 'ENFORCED',
            };
    });
    const holdFind = vi.fn(async () => {
        events.push('fast-replay');
        return options.fastReplay ?? null;
    });
    const warehouseFind = vi.fn(async (args: unknown) => {
        events.push('warehouse');
        return options.warehouseExists === false ? null : { id: 'warehouse-1', args };
    });
    const userFind = vi.fn(async (args: unknown) => {
        events.push('user');
        return options.userExists === false ? null : { id: 'user-1', args };
    });
    const queryRaw = vi.fn(async (query: unknown) => {
        const text = queryText(query);
        if (text.includes('Tenant')) {
            events.push('lock-tenant');
            return options.tenantExists === false
                ? []
                : [{
                    type: options.tenantType ?? 'FARMACIA',
                    pharmacyInventoryMode: options.pharmacyMode ?? 'ENFORCED',
                    batchWarehouseLedgerMode: options.batchMode ?? 'ENFORCED',
                }];
        }
        if (text.includes('ProductBatchWarehouseStock')) {
            events.push('lock-balance');
            return options.balanceExists === false
                ? []
                : [{
                    id: 'balance-1',
                    productId: options.balanceProductId ?? 'product-1',
                    stock: state.stock,
                    heldStock: state.heldStock,
                }];
        }
        if (text.includes('ProductBatchHold')) {
            events.push('lock-hold');
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
    const balanceUpdate = vi.fn(async (args: unknown) => {
        events.push('update-balance');
        const typed = args as { data: { heldStock: { increment: { toString(): string } } } };
        if ((options.updateCount ?? 1) === 1) {
            state.heldStock = state.heldStock.plus(typed.data.heldStock.increment.toString());
        }
        return { count: options.updateCount ?? 1 };
    });
    const holdCreate = vi.fn(async (args: unknown) => {
        events.push('hold');
        if (options.holdCreateError) throw options.holdCreateError;
        holdRows.push((args as { data: Record<string, unknown> }).data);
        return { id: 'hold-created' };
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
        productBatchHold: { findFirst: holdFind, create: holdCreate },
        warehouse: { findFirst: warehouseFind },
        user: { findFirst: userFind },
        productBatchWarehouseStock: { updateMany: balanceUpdate },
        auditLog: { create: auditCreate },
        $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;

    return {
        tx,
        events,
        state,
        holdRows,
        auditRows,
        mocks: {
            tenantFind,
            holdFind,
            warehouseFind,
            userFind,
            queryRaw,
            balanceUpdate,
            holdCreate,
            auditCreate,
        },
    };
};

const expectHoldError = async (
    promise: Promise<unknown>,
    code: ProductBatchHoldError['code'],
    httpStatus: ProductBatchHoldError['httpStatus'],
): Promise<ProductBatchHoldError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(ProductBatchHoldError);
        expect(error).toMatchObject({ code, httpStatus });
        return error as ProductBatchHoldError;
    }
    throw new Error('Se esperaba ProductBatchHoldError');
};

describe('productBatchHold intent', () => {
    it('normaliza una intención exacta y produce una huella determinista', () => {
        const normalized = normalizeProductBatchHoldDeltaIntent(baseIntent({
            tenantId: ' tenant-1 ',
            quantityDelta: ' 1 ',
            holdReasonCode: ' customer_return_quarantine ',
            referenceType: ' product_return ',
            notes: ' revisar ',
        }));
        expect(normalized).toMatchObject({
            tenantId: 'tenant-1',
            quantityDelta: '1.0000',
            holdReasonCode: 'CUSTOMER_RETURN_QUARANTINE',
            referenceType: 'PRODUCT_RETURN',
            notes: 'revisar',
        });
        expect(buildProductBatchHoldPayloadHash(normalized)).toMatch(/^[0-9a-f]{64}$/u);
        expect(buildProductBatchHoldPayloadHash(normalized)).toBe(
            buildProductBatchHoldPayloadHash(normalized),
        );
    });

    it('expone payload canónico completo con versión estable', () => {
        expect(buildCanonicalProductBatchHoldPayload(baseIntent({
            quantityDelta: { toString: () => '2.5' },
            notes: '  observación  ',
        }))).toEqual({
            version: 1,
            tenantId: 'tenant-1',
            productId: 'product-1',
            batchId: 'batch-1',
            warehouseId: 'warehouse-1',
            quantityDelta: '2.5000',
            holdReasonCode: 'CUSTOMER_RETURN_QUARANTINE',
            referenceId: 'return-1',
            referenceType: 'PRODUCT_RETURN',
            sourceKey: 'product-return:return-1:item:item-1:batch:batch-1',
            userId: 'user-1',
            notes: 'observación',
        });
    });

    it('expone errores con nombre y mensaje exactos', () => {
        const error = new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_INVALID_INPUT',
            400,
            'quantityDelta debe ser distinto de cero',
        );
        expect(error.name).toBe('ProductBatchHoldError');
        expect(error.code).toBe('PRODUCT_BATCH_HOLD_INVALID_INPUT');
        expect(error.httpStatus).toBe(400);
        expect(error.message).toBe('quantityDelta debe ser distinto de cero');
    });

    it.each([
        ['number', { quantityDelta: 1 as unknown as string }],
        ['cero', { quantityDelta: '0' }],
        ['precisión excesiva', { quantityDelta: '0.00001' }],
        ['referencia ausente', { referenceId: '' }],
        ['reason inválido', { holdReasonCode: 'RETURN HOLD' }],
        ['sourceKey inválido', { sourceKey: 'bad key' }],
    ])('rechaza %s antes de consultar la base', (_title, overrides) => {
        expect(() => normalizeProductBatchHoldDeltaIntent(baseIntent(overrides))).toThrowError(
            expect.objectContaining({ code: 'PRODUCT_BATCH_HOLD_INVALID_INPUT' }),
        );
    });

    it('normaliza balances exactos y rechaza límites corruptos con mensaje exacto', () => {
        expect(canonicalProductBatchHoldBalance('7')).toBe('7.0000');
        expect(canonicalProductBatchHoldDelta({ toString: () => '-1.25' })).toBe('-1.2500');
        expect(() => canonicalProductBatchHoldBalance('abc')).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                'quantityDelta no es un decimal válido',
            ),
        );
        expect(() => canonicalProductBatchHoldDelta('0')).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                'quantityDelta debe ser distinto de cero',
            ),
        );
        expect(() => canonicalProductBatchHoldBalance(null as unknown as string)).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                'quantityDelta debe enviarse como texto decimal exacto',
            ),
        );
        expect(() => canonicalProductBatchHoldBalance({ toString: () => 'Infinity' })).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                'quantityDelta debe ser finito',
            ),
        );
        expect(() => canonicalProductBatchHoldBalance('100000000000000.0000')).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                'quantityDelta excede Decimal(18,4)',
            ),
        );
        expect(() => canonicalProductBatchHoldBalance(1n as unknown as string)).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                'quantityDelta debe enviarse como texto decimal exacto',
            ),
        );
        expect(() => canonicalProductBatchHoldDelta('0.00001')).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                'quantityDelta admite como máximo cuatro decimales',
            ),
        );
    });

    it.each([
        ['tenantId debe ser texto', { tenantId: 7 as unknown as string }],
        ['productId no es válido', { productId: 'x'.repeat(192) }],
        ['batchId no es válido', { batchId: 'batch-\u0000-1' }],
        ['warehouseId no es válido', { warehouseId: 'x'.repeat(192) }],
        ['userId debe ser texto', { userId: null as unknown as string }],
        ['referenceId no es válido', { referenceId: '' }],
        ['holdReasonCode no es válido', { holdReasonCode: '1BAD' }],
        ['referenceType no es válido', { referenceType: 'PRODUCT-RETURN' }],
        ['sourceKey no es válido', { sourceKey: '_bad-prefix' }],
        ['notes debe ser texto', { notes: 7 as unknown as string }],
        ['notes no es válido', { notes: `${'x'.repeat(2001)}` }],
    ])('reporta validación exacta: %s', (expectedMessage, overrides) => {
        expect(() => normalizeProductBatchHoldDeltaIntent(baseIntent(overrides))).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                expectedMessage,
            ),
        );
    });

    it('acepta fronteras exactas y colapsa notes vacío a null', () => {
        const normalized = normalizeProductBatchHoldDeltaIntent(baseIntent({
            productId: 'p'.repeat(191),
            notes: '   ',
            holdReasonCode: 'A'.repeat(32),
            referenceType: 'R'.repeat(64),
        }));
        expect(normalized.productId).toHaveLength(191);
        expect(normalized.notes).toBeNull();
        expect(normalized.holdReasonCode).toBe('A'.repeat(32));
        expect(normalized.referenceType).toBe('R'.repeat(64));
    });

    it.each([
        ['holdReasonCode debe ser texto', { holdReasonCode: 9 as unknown as string }],
        ['referenceType debe ser texto', { referenceType: 9 as unknown as string }],
        ['sourceKey debe ser texto', { sourceKey: 9 as unknown as string }],
    ])('preserva la etiqueta exacta del campo textual: %s', (expectedMessage, overrides) => {
        expect(() => normalizeProductBatchHoldDeltaIntent(baseIntent(overrides))).toThrowError(
            new ProductBatchHoldError(
                'PRODUCT_BATCH_HOLD_INVALID_INPUT',
                400,
                expectedMessage,
            ),
        );
    });

    it('acepta notes explícitamente nulo y el borde exacto de 2,000 caracteres', () => {
        const normalized = normalizeProductBatchHoldDeltaIntent(baseIntent({
            notes: 'n'.repeat(2000),
        }));
        expect(normalized.notes).toBe('n'.repeat(2000));
        expect(normalizeProductBatchHoldDeltaIntent(baseIntent({ notes: null })).notes).toBeNull();
    });

    it('detecta replay divergente con el mensaje de conflicto exacto', () => {
        expect(() => assertProductBatchHoldReplay(
            { payloadHash: 'otro-hash' },
            'hash-esperado',
        )).toThrowError(new ProductBatchHoldError(
            'PRODUCT_BATCH_HOLD_IDEMPOTENCY_CONFLICT',
            409,
            'sourceKey ya fue usado con una retención lote-bodega distinta',
        ));
    });
});

describe('applyProductBatchHoldDelta', () => {
    it('retiene sin alterar físico y deja libro + AuditLog en la misma tx', async () => {
        const fake = fakeTx({ physicalStock: '5', heldStock: '1' });
        const result = await applyProductBatchHoldDelta({
            tx: fake.tx,
            ...baseIntent({ notes: 'dato privado de inspección 991' }),
        });

        expect(result).toEqual({
            holdId: 'hold-created',
            replay: false,
            quantityDelta: '1.0000',
            physicalStockSnapshot: '5.0000',
            heldBefore: '1.0000',
            heldAfter: '2.0000',
            sellableBefore: '4.0000',
            sellableAfter: '3.0000',
        });
        expect(fake.state.stock.toFixed(4)).toBe('5.0000');
        expect(fake.state.heldStock.toFixed(4)).toBe('2.0000');
        expect(fake.events).toEqual([
            'lock-tenant',
            'fast-replay',
            'warehouse',
            'user',
            'lock-product',
            'lock-batch',
            'lock-balance',
            'lock-hold',
            'update-balance',
            'hold',
            'audit',
        ]);
        expect(fake.holdRows[0]).toMatchObject({
            tenantId: 'tenant-1',
            productId: 'product-1',
            batchId: 'batch-1',
            warehouseId: 'warehouse-1',
            holdReasonCode: 'CUSTOMER_RETURN_QUARANTINE',
            referenceId: 'return-1',
            referenceType: 'PRODUCT_RETURN',
            sourceKey: 'product-return:return-1:item:item-1:batch:batch-1',
        });
        expect((fake.holdRows[0]?.physicalStockSnapshot as Decimal).toFixed(4)).toBe('5.0000');
        expect((fake.holdRows[0]?.heldAfter as Decimal).toFixed(4)).toBe('2.0000');
        expect(fake.auditRows).toHaveLength(1);
        expect(fake.auditRows[0]?.action).toBe('PRODUCT_BATCH_HOLD_APPLIED');
        expect(fake.auditRows[0]?.details).not.toContain('dato privado');
        expect(JSON.parse(fake.auditRows[0]?.details ?? '{}')).toMatchObject({
            before: { heldStock: '1.0000', sellableStock: '4.0000' },
            after: { heldStock: '2.0000', sellableStock: '3.0000' },
        });
    });

    it.each([
        ['tenant no farmacia', { tenantType: 'RETAIL' }, 'PRODUCT_BATCH_HOLD_TENANT_NOT_PHARMACY'],
        ['farmacia OFF', { pharmacyMode: 'OFF' }, 'PRODUCT_BATCH_HOLD_MODE_NOT_ENFORCED'],
        ['ledger SHADOW', { batchMode: 'SHADOW' }, 'PRODUCT_BATCH_HOLD_MODE_NOT_ENFORCED'],
        ['modo corrupto', { pharmacyMode: 'UNKNOWN' }, 'PRODUCT_BATCH_HOLD_MODE_NOT_ENFORCED'],
    ] as const)('falla cerrado con %s', async (_title, options, code) => {
        const fake = fakeTx(options);
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: fake.tx, ...baseIntent() }),
            code,
            409,
        );
        expect(fake.events).toEqual(['lock-tenant']);
    });

    it('distingue tenant inexistente y valida bodega/usuario dentro del tenant', async () => {
        await expectHoldError(
            applyProductBatchHoldDelta({
                tx: fakeTx({ tenantExists: false }).tx,
                ...baseIntent(),
            }),
            'PRODUCT_BATCH_HOLD_TENANT_NOT_FOUND',
            404,
        );

        const warehouse = fakeTx({ warehouseExists: false });
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: warehouse.tx, ...baseIntent() }),
            'PRODUCT_BATCH_HOLD_WAREHOUSE_NOT_FOUND',
            404,
        );
        expect(warehouse.mocks.warehouseFind).toHaveBeenCalledWith({
            where: { id: 'warehouse-1', tenantId: 'tenant-1', isActive: true },
            select: { id: true },
        });

        const user = fakeTx({ userExists: false });
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: user.tx, ...baseIntent() }),
            'PRODUCT_BATCH_HOLD_USER_NOT_FOUND',
            404,
        );
        expect(user.mocks.userFind).toHaveBeenCalledWith({
            where: { id: 'user-1', tenantId: 'tenant-1', status: 'ACTIVE' },
            select: { id: true },
        });
    });

    it.each([
        [{ productExists: false }, 'PRODUCT_BATCH_HOLD_PRODUCT_NOT_FOUND', 404],
        [{ batchExists: false }, 'PRODUCT_BATCH_HOLD_BATCH_NOT_FOUND', 404],
        [{ batchProductId: 'product-2' }, 'PRODUCT_BATCH_HOLD_BATCH_PRODUCT_MISMATCH', 409],
        [{ balanceExists: false }, 'PRODUCT_BATCH_HOLD_BALANCE_NOT_FOUND', 409],
        [{ balanceProductId: 'product-2' }, 'PRODUCT_BATCH_HOLD_BALANCE_SCOPE_MISMATCH', 409],
    ] as const)('rechaza alcance inconsistente %o', async (options, code, status) => {
        const fake = fakeTx(options);
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: fake.tx, ...baseIntent() }),
            code,
            status,
        );
        expect(fake.mocks.balanceUpdate).not.toHaveBeenCalled();
        for (const call of fake.mocks.queryRaw.mock.calls) {
            expect(queryValues(call[0])).toContain('tenant-1');
        }
    });

    it('rechaza over-hold y under-release sin tocar proyección ni libro', async () => {
        const over = fakeTx({ physicalStock: '1', heldStock: '0.5000' });
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: over.tx, ...baseIntent({ quantityDelta: '0.5001' }) }),
            'PRODUCT_BATCH_HOLD_INSUFFICIENT_PHYSICAL_STOCK',
            409,
        );
        expect(over.mocks.balanceUpdate).not.toHaveBeenCalled();
        expect(over.mocks.holdCreate).not.toHaveBeenCalled();

        const under = fakeTx({ physicalStock: '5', heldStock: '0.5000' });
        await expectHoldError(
            applyProductBatchHoldDelta({
                tx: under.tx,
                ...baseIntent({ quantityDelta: '-0.5001', holdReasonCode: 'INSPECTION_RELEASE' }),
            }),
            'PRODUCT_BATCH_HOLD_INSUFFICIENT_HELD_STOCK',
            409,
        );
        expect(under.mocks.balanceUpdate).not.toHaveBeenCalled();
    });

    it('registra una liberación como otro evento append-only', async () => {
        const fake = fakeTx({ physicalStock: '5', heldStock: '2' });
        const result = await applyProductBatchHoldDelta({
            tx: fake.tx,
            ...baseIntent({
                quantityDelta: '-1.2500',
                holdReasonCode: 'INSPECTION_RELEASE',
                sourceKey: 'hold-release:inspection-1:batch:batch-1',
            }),
        });
        expect(result).toMatchObject({
            quantityDelta: '-1.2500',
            heldBefore: '2.0000',
            heldAfter: '0.7500',
            sellableBefore: '3.0000',
            sellableAfter: '4.2500',
        });
        expect(fake.auditRows[0]?.action).toBe('PRODUCT_BATCH_HOLD_RELEASED');
        expect(fake.state.stock.toFixed(4)).toBe('5.0000');
    });

    it('hace replay exacto antes de locks y rechaza sourceKey divergente', async () => {
        const intent = baseIntent();
        const exact = fakeTx({ fastReplay: makeExisting(intent) });
        await expect(applyProductBatchHoldDelta({ tx: exact.tx, ...intent })).resolves.toMatchObject({
            holdId: 'hold-existing',
            replay: true,
            heldAfter: '2.0000',
        });
        expect(exact.events).toEqual(['lock-tenant', 'fast-replay']);
        expect(exact.mocks.balanceUpdate).not.toHaveBeenCalled();

        const conflict = fakeTx({
            fastReplay: makeExisting(intent, { payloadHash: 'hash-distinto' }),
        });
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: conflict.tx, ...intent }),
            'PRODUCT_BATCH_HOLD_IDEMPOTENCY_CONFLICT',
            409,
        );
    });

    it('cierra la carrera con replay bloqueante después del balance', async () => {
        const intent = baseIntent();
        const fake = fakeTx({ lockedReplay: makeExisting(intent) });
        await expect(applyProductBatchHoldDelta({ tx: fake.tx, ...intent })).resolves.toMatchObject({
            replay: true,
        });
        expect(fake.events.slice(-2)).toEqual(['lock-balance', 'lock-hold']);
        expect(fake.mocks.balanceUpdate).not.toHaveBeenCalled();
        expect(fake.mocks.holdCreate).not.toHaveBeenCalled();
    });

    it('falla cerrado ante proyección o evento persistido corruptos', async () => {
        const balance = fakeTx({ physicalStock: '1', heldStock: '1.0001' });
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: balance.tx, ...baseIntent() }),
            'PRODUCT_BATCH_HOLD_BALANCE_CORRUPT',
            500,
        );

        const intent = baseIntent();
        const record = fakeTx({
            fastReplay: makeExisting(intent, { sellableAfter: new Decimal('99') }),
        });
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: record.tx, ...intent }),
            'PRODUCT_BATCH_HOLD_RECORD_CORRUPT',
            500,
        );
    });

    it('usa compare-and-set de físico y retenido y clasifica una escritura perdida', async () => {
        const fake = fakeTx({ physicalStock: '5', heldStock: '1', updateCount: 0 });
        await expectHoldError(
            applyProductBatchHoldDelta({ tx: fake.tx, ...baseIntent() }),
            'PRODUCT_BATCH_HOLD_CONCURRENT_WRITE',
            409,
        );
        const update = fake.mocks.balanceUpdate.mock.calls[0]?.[0] as {
            where: { stock: Decimal; heldStock: Decimal };
        };
        expect(update.where.stock.toFixed(4)).toBe('5.0000');
        expect(update.where.heldStock.toFixed(4)).toBe('1.0000');
        expect(fake.mocks.holdCreate).not.toHaveBeenCalled();
        expect(fake.mocks.auditCreate).not.toHaveBeenCalled();
    });
});

describe('executeProductBatchHoldDelta', () => {
    it('relee un P2002 fuera de la transacción y devuelve replay aunque el modo ya cambió', async () => {
        const intent = baseIntent();
        const existing = makeExisting(intent);
        const db = {
            $transaction: vi.fn(async () => { throw { code: 'P2002' }; }),
            productBatchHold: { findFirst: vi.fn(async () => existing) },
        } as unknown as PrismaClient;

        await expect(executeProductBatchHoldDelta({ db, ...intent })).resolves.toMatchObject({
            holdId: 'hold-existing',
            replay: true,
        });
    });

    it('no disfraza un P2002 ajeno', async () => {
        const original = { code: 'P2002', meta: { target: 'otro_indice' } };
        const db = {
            $transaction: vi.fn(async () => { throw original; }),
            productBatchHold: { findFirst: vi.fn(async () => null) },
        } as unknown as PrismaClient;
        await expect(executeProductBatchHoldDelta({ db, ...baseIntent() })).rejects.toBe(original);
    });

    it('revierte proyección y libro si falla el AuditLog obligatorio', async () => {
        const auditFailure = new Error('audit no disponible');
        const fake = fakeTx({ auditCreateError: auditFailure });
        const db = {
            $transaction: vi.fn(async (
                operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
            ) => {
                const heldSnapshot = fake.state.heldStock;
                const holdSnapshot = fake.holdRows.length;
                try {
                    return await operation(fake.tx);
                } catch (error) {
                    fake.state.heldStock = heldSnapshot;
                    fake.holdRows.splice(holdSnapshot);
                    throw error;
                }
            }),
            tenant: { findFirst: fake.mocks.tenantFind },
            productBatchHold: { findFirst: fake.mocks.holdFind },
        } as unknown as PrismaClient;

        await expect(executeProductBatchHoldDelta({ db, ...baseIntent() })).rejects.toBe(auditFailure);
        expect(fake.state.heldStock.toFixed(4)).toBe('1.0000');
        expect(fake.holdRows).toHaveLength(0);
    });
});
