import { describe, expect, it } from 'vitest';
import {
    assertMatchingStockTransferReplay,
    buildStockTransferPayloadHash,
    normalizeStockTransferCommand,
    StockTransferError,
} from '../backend/lib/stockTransferCommand';

const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const request = (overrides: Record<string, unknown> = {}) => ({
    clientEventId: eventId,
    fromWarehouseId: ' warehouse-a ',
    toWarehouseId: 'warehouse-b',
    notes: '  Traslado semanal  ',
    items: [
        { productId: 'product-b', quantity: '2.5000' },
        { productId: 'product-a', quantity: '0.1000' },
    ],
    ...overrides,
});

describe('comando puro de StockTransfer', () => {
    it('canonicaliza UUID, notas, cantidades y orden de productos sin Number', () => {
        const canonical = normalizeStockTransferCommand(request() as never);
        expect(canonical).toEqual({
            clientEventId: eventId,
            fromWarehouseId: 'warehouse-a',
            toWarehouseId: 'warehouse-b',
            notes: 'Traslado semanal',
            items: [
                { productId: 'product-a', quantity: '0.1000' },
                { productId: 'product-b', quantity: '2.5000' },
            ],
        });
    });

    it('produce la misma huella ante orden/formato equivalentes', () => {
        const left = normalizeStockTransferCommand(request() as never);
        const right = normalizeStockTransferCommand(request({
            items: [
                { productId: 'product-a', quantity: '0.1' },
                { productId: 'product-b', quantity: '2.5' },
            ],
        }) as never);
        expect(buildStockTransferPayloadHash({ tenantId: 'tenant-a', command: left }))
            .toBe(buildStockTransferPayloadHash({ tenantId: 'tenant-a', command: right }));
    });

    it.each([
        ['tenant', { tenantId: 'tenant-b' }],
        ['origen', { fromWarehouseId: 'warehouse-c' }],
        ['destino', { toWarehouseId: 'warehouse-c' }],
        ['cantidad', { items: [{ productId: 'product-a', quantity: '0.2' }, { productId: 'product-b', quantity: '2.5' }] }],
        ['notas', { notes: 'Otro traslado' }],
    ])('incluye %s en la huella tenant-scoped', (_label, change) => {
        const baseCommand = normalizeStockTransferCommand(request() as never);
        const changedCommand = normalizeStockTransferCommand(request(change) as never);
        const base = buildStockTransferPayloadHash({ tenantId: 'tenant-a', command: baseCommand });
        const changed = buildStockTransferPayloadHash({
            tenantId: 'tenantId' in change ? String(change.tenantId) : 'tenant-a',
            command: changedCommand,
        });
        expect(changed).not.toBe(base);
    });

    it('rechaza Number, UUID inválido, bodega igual y productos duplicados', () => {
        expect(() => normalizeStockTransferCommand(request({
            items: [{ productId: 'product-a', quantity: 0.1 }],
        }) as never)).toThrowError(expect.objectContaining({ code: 'INVALID_TRANSFER_QUANTITY' }));
        expect(() => normalizeStockTransferCommand(request({ clientEventId: 'retry-1' }) as never))
            .toThrowError(expect.objectContaining({ code: 'INVALID_CLIENT_EVENT_ID' }));
        expect(() => normalizeStockTransferCommand(request({
            fromWarehouseId: 'warehouse-a',
            toWarehouseId: 'warehouse-a',
        }) as never)).toThrowError(expect.objectContaining({ code: 'SAME_WAREHOUSE' }));
        expect(() => normalizeStockTransferCommand(request({
            items: [{ productId: 'product-a', quantity: '1' }, { productId: 'product-a', quantity: '2' }],
        }) as never)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_TRANSFER_PRODUCT' }));
        expect(() => normalizeStockTransferCommand(request({
            items: [{ productId: 'product-a', quantity: '1'.repeat(65) }],
        }) as never)).toThrowError(expect.objectContaining({ code: 'INVALID_TRANSFER_QUANTITY' }));
    });

    it('solo acepta replay con hash y versión v1 exactos', () => {
        const command = normalizeStockTransferCommand(request() as never);
        const hash = buildStockTransferPayloadHash({ tenantId: 'tenant-a', command });
        expect(() => assertMatchingStockTransferReplay({ payloadHash: hash, payloadVersion: 1 }, hash))
            .not.toThrow();
        for (const existing of [
            { payloadHash: 'otro', payloadVersion: 1 },
            { payloadHash: hash, payloadVersion: 2 },
            { payloadHash: null, payloadVersion: 1 },
        ]) {
            expect(() => assertMatchingStockTransferReplay(existing, hash)).toThrowError(expect.objectContaining({
                name: 'StockTransferError',
                code: 'STOCK_TRANSFER_IDEMPOTENCY_CONFLICT',
                httpStatus: 409,
            } satisfies Partial<StockTransferError>));
        }
    });
});
