import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    assertBatchWarehouseReplay,
    BATCH_WAREHOUSE_MOVEMENT_TYPES,
    BatchWarehouseLedgerError,
    buildBatchWarehousePayloadHash,
    buildCanonicalBatchWarehousePayload,
    canonicalBatchWarehouseBalance,
    canonicalBatchWarehouseDecimal,
    normalizeBatchWarehouseDeltaIntent,
    normalizeBatchWarehouseLedgerMode,
    type BatchWarehouseDeltaIntent,
} from '../backend/lib/batchWarehouseLedger';

it('congela PURCHASE_RETURN como movimiento lote-bodega acotado', () => {
    expect(BATCH_WAREHOUSE_MOVEMENT_TYPES).toContain('PURCHASE_RETURN');
    expect('PURCHASE_RETURN').toHaveLength(15);
    expect(normalizeBatchWarehouseDeltaIntent(intent({
        movementType: 'PURCHASE_RETURN',
        delta: '-0.0001',
        referenceId: 'supplier-return-item-1',
        referenceType: 'SUPPLIER_RETURN_ITEM',
        sourceKey: 'supplier-return:item-1',
    }))).toMatchObject({
        movementType: 'PURCHASE_RETURN',
        delta: '-0.0001',
        referenceType: 'SUPPLIER_RETURN_ITEM',
    });
});

const intent = (overrides: Partial<BatchWarehouseDeltaIntent> = {}): BatchWarehouseDeltaIntent => ({
    tenantId: ' tenant-1 ',
    productId: 'product-1',
    batchId: 'batch-1',
    warehouseId: 'warehouse-1',
    delta: '1.2500',
    movementType: 'GOODS_RECEIPT',
    referenceId: 'receipt-1',
    referenceType: 'goods_receipt',
    userId: 'user-1',
    reason: ' recepción formal ',
    sourceKey: 'goods-receipt:receipt-1:item-1',
    ...overrides,
});

const expectLedgerError = (
    operation: () => unknown,
    code: BatchWarehouseLedgerError['code'],
    httpStatus: BatchWarehouseLedgerError['httpStatus'],
    message?: string,
): BatchWarehouseLedgerError => {
    try {
        operation();
    } catch (error) {
        expect(error).toBeInstanceOf(BatchWarehouseLedgerError);
        expect(error).toMatchObject({ code, httpStatus });
        expect((error as BatchWarehouseLedgerError).name).toBe('BatchWarehouseLedgerError');
        if (message !== undefined) expect((error as BatchWarehouseLedgerError).message).toBe(message);
        return error as BatchWarehouseLedgerError;
    }
    throw new Error('Se esperaba BatchWarehouseLedgerError');
};

describe('cantidades exactas del subledger lote-bodega', () => {
    it('canoniza Decimal(18,4) sin pasar por Number y conserva el borde 0.0001', () => {
        expect(canonicalBatchWarehouseDecimal('0.0001')).toBe('0.0001');
        expect(canonicalBatchWarehouseDecimal(' 1.2500 ')).toBe('1.2500');
        expect(canonicalBatchWarehouseDecimal(new Decimal('12.3'))).toBe('12.3000');
        expect(canonicalBatchWarehouseDecimal({ toString: () => '-2.75' })).toBe('-2.7500');
        expect(canonicalBatchWarehouseBalance('0')).toBe('0.0000');
        expect(canonicalBatchWarehouseBalance('-0.0001')).toBe('-0.0001');
        expect(canonicalBatchWarehouseBalance('99999999999999.9999')).toBe('99999999999999.9999');
    });

    it('rechaza Number, cero, fracciones de más de 4 decimales y overflow', () => {
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal(0.1 as never),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'La cantidad debe enviarse como texto decimal exacto',
        );
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal(1n as never),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'La cantidad debe enviarse como texto decimal exacto',
        );
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal(null as never),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'La cantidad debe enviarse como texto decimal exacto',
        );
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal('0'),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'El delta debe ser distinto de cero',
        );
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal('1.00001'),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'La cantidad admite como máximo cuatro decimales',
        );
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal('100000000000000'),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'La cantidad excede Decimal(18,4)',
        );
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal('no-decimal'),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'La cantidad decimal no es válida',
        );
        expectLedgerError(
            () => canonicalBatchWarehouseDecimal('Infinity'),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'La cantidad decimal debe ser finita',
        );
    });
});

describe('payload canónico e idempotencia lote-bodega', () => {
    it('normaliza identificadores, referencia, razón y escala decimal', () => {
        expect(normalizeBatchWarehouseDeltaIntent(intent())).toEqual({
            tenantId: 'tenant-1',
            productId: 'product-1',
            batchId: 'batch-1',
            warehouseId: 'warehouse-1',
            delta: '1.2500',
            movementType: 'GOODS_RECEIPT',
            referenceId: 'receipt-1',
            referenceType: 'GOODS_RECEIPT',
            userId: 'user-1',
            reason: 'recepción formal',
            sourceKey: 'goods-receipt:receipt-1:item-1',
            allowNegative: false,
        });
    });

    it('normaliza opcionales ausentes o vacíos sin inventar intención', () => {
        expect(normalizeBatchWarehouseDeltaIntent(intent({
            referenceId: undefined,
            referenceType: undefined,
            reason: undefined,
        }))).toMatchObject({ referenceId: null, referenceType: null, reason: null });
        expect(normalizeBatchWarehouseDeltaIntent(intent({
            referenceId: '   ',
            referenceType: '   ',
            reason: '   ',
        }))).toMatchObject({ referenceId: null, referenceType: null, reason: null });
    });

    it('acepta los límites exactos de identificadores y razón', () => {
        const normalized = normalizeBatchWarehouseDeltaIntent(intent({
            tenantId: `t${'a'.repeat(190)}`,
            sourceKey: `s${'a'.repeat(190)}`,
            referenceId: `r${'a'.repeat(190)}`,
            referenceType: `R${'A'.repeat(63)}`,
            reason: 'a'.repeat(2_000),
        }));
        expect(normalized.tenantId).toHaveLength(191);
        expect(normalized.sourceKey).toHaveLength(191);
        expect(normalized.referenceId).toHaveLength(191);
        expect(normalized.referenceType).toHaveLength(64);
        expect(normalized.reason).toHaveLength(2_000);
    });

    it.each([
        {
            title: 'tenant no textual',
            overrides: { tenantId: null as never },
            message: 'tenantId debe ser texto',
        },
        {
            title: 'producto vacío',
            overrides: { productId: '   ' },
            message: 'productId no es válido',
        },
        {
            title: 'lote con control',
            overrides: { batchId: 'batch\ninternal' },
            message: 'batchId no es válido',
        },
        {
            title: 'bodega demasiado larga',
            overrides: { warehouseId: 'w'.repeat(192) },
            message: 'warehouseId no es válido',
        },
        {
            title: 'usuario vacío',
            overrides: { userId: '' },
            message: 'userId no es válido',
        },
        {
            title: 'sourceKey no textual',
            overrides: { sourceKey: null as never },
            message: 'sourceKey debe ser texto',
        },
        {
            title: 'referenceId no textual',
            overrides: { referenceId: 7 as never },
            message: 'referenceId debe ser texto',
        },
        {
            title: 'referenceType no textual',
            overrides: { referenceType: 7 as never },
            message: 'referenceType debe ser texto',
        },
        {
            title: 'razón no textual',
            overrides: { reason: 7 as never },
            message: 'reason debe ser texto',
        },
        {
            title: 'razón demasiado larga',
            overrides: { reason: 'a'.repeat(2_001) },
            message: 'reason no es válido',
        },
        {
            title: 'razón con NUL',
            overrides: { reason: 'nota\u0000oculta' },
            message: 'reason no es válido',
        },
    ])('rechaza $title', ({ overrides, message }) => {
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent(overrides)),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            message,
        );
    });

    it('produce una huella v1 dorada y entradas decimales equivalentes no divergen', () => {
        const canonical = buildCanonicalBatchWarehousePayload(intent());
        expect(canonical.version).toBe(1);
        expect(buildBatchWarehousePayloadHash(intent())).toBe(
            'ad59d15c994df5e734e0b0b7667ee4d32cb6cf6a996017332086f3a970622f89',
        );
        expect(buildBatchWarehousePayloadHash(intent({ delta: new Decimal('1.25') })))
            .toBe(buildBatchWarehousePayloadHash(intent({ delta: '1.2500' })));
    });

    it('incluye usuario, razón y allowNegative en la intención exacta', () => {
        const base = buildBatchWarehousePayloadHash(intent());
        expect(buildBatchWarehousePayloadHash(intent({ userId: 'user-2' }))).not.toBe(base);
        expect(buildBatchWarehousePayloadHash(intent({ reason: 'otra razón' }))).not.toBe(base);
        expect(buildBatchWarehousePayloadHash(intent({ allowNegative: true }))).not.toBe(base);
        expect(buildBatchWarehousePayloadHash(intent({ sourceKey: 'receipt:otra' }))).not.toBe(base);
    });

    it('valida sourceKey, movimiento y pareja de referencia', () => {
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ sourceKey: 'clave con espacio' })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'sourceKey no es válido',
        );
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ sourceKey: '!clave-valida' })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'sourceKey no es válido',
        );
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ sourceKey: 'clave-valida!' })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'sourceKey no es válido',
        );
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ movementType: 'INVENTADO' as never })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'El tipo de movimiento lote-bodega no es válido',
        );
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ referenceType: null })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'referenceId y referenceType deben enviarse juntos',
        );
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ referenceId: null })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'referenceId y referenceType deben enviarse juntos',
        );
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ referenceType: '!TYPE' })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'referenceType no es válido',
        );
        expectLedgerError(
            () => normalizeBatchWarehouseDeltaIntent(intent({ referenceType: 'TYPE!' })),
            'BATCH_WAREHOUSE_INVALID_INPUT',
            400,
            'referenceType no es válido',
        );
        expect(normalizeBatchWarehouseDeltaIntent(intent({
            sourceKey: 'a:b_c.d/e-f',
            referenceType: 'A',
        }))).toMatchObject({ sourceKey: 'a:b_c.d/e-f', referenceType: 'A' });
    });

    it('acepta replay exacto y convierte reutilización divergente en 409 estable', () => {
        expect(() => assertBatchWarehouseReplay({ payloadHash: 'igual' }, 'igual')).not.toThrow();
        expectLedgerError(
            () => assertBatchWarehouseReplay({ payloadHash: 'anterior' }, 'nuevo'),
            'BATCH_WAREHOUSE_IDEMPOTENCY_CONFLICT',
            409,
            'sourceKey ya fue usado con un movimiento lote-bodega distinto',
        );
    });
});

describe('modo del subledger lote-bodega', () => {
    it.each(['OFF', 'SHADOW', 'ENFORCED'] as const)('acepta %s', (mode) => {
        expect(normalizeBatchWarehouseLedgerMode(mode)).toBe(mode);
    });

    it.each(['', 'shadow', 'ENFORCE', null, 1])('falla cerrado para modo inválido %j', (mode) => {
        expectLedgerError(
            () => normalizeBatchWarehouseLedgerMode(mode),
            'BATCH_WAREHOUSE_INVALID_MODE',
            500,
            'La configuración del subledger lote-bodega no es válida',
        );
    });
});
