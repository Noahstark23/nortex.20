import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    assertMatchingStockTransferReplay,
    buildStockTransferPayloadHash,
    normalizeStockTransferCommand,
    StockTransferError,
    type CanonicalStockTransferCommand,
} from '../backend/lib/stockTransferCommand';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const validRequest = (overrides: Record<string, unknown> = {}) => ({
    clientEventId: EVENT_ID,
    fromWarehouseId: 'warehouse-a',
    toWarehouseId: 'warehouse-b',
    notes: null,
    items: [{ productId: 'product-a', quantity: '1' }],
    ...overrides,
});

const captureTransferError = (action: () => unknown): StockTransferError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(StockTransferError);
        expect((error as StockTransferError).name).toBe('StockTransferError');
        return error as StockTransferError;
    }
    throw new Error('Se esperaba StockTransferError');
};

const expectTransferError = (
    action: () => unknown,
    code: string,
    message: string,
): void => {
    expect(captureTransferError(action)).toMatchObject({
        code,
        httpStatus: 400,
        message,
    });
};

describe('mutación: validación completa del comando de transferencia', () => {
    it.each([
        {
            title: 'request null',
            input: null,
            code: 'INVALID_TRANSFER_COMMAND',
            message: 'La transferencia no es válida',
        },
        {
            title: 'request primitivo',
            input: 'transferencia',
            code: 'INVALID_TRANSFER_COMMAND',
            message: 'La transferencia no es válida',
        },
        {
            title: 'clientEventId no textual',
            input: validRequest({ clientEventId: 7 }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'clientEventId debe ser texto',
        },
        {
            title: 'clientEventId vacío',
            input: validRequest({ clientEventId: '   ' }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'clientEventId no es válido',
        },
        {
            title: 'UUID con forma inválida',
            input: validRequest({ clientEventId: 'retry-1' }),
            code: 'INVALID_CLIENT_EVENT_ID',
            message: 'clientEventId debe ser un UUID válido',
        },
        {
            title: 'origen no textual',
            input: validRequest({ fromWarehouseId: null }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'fromWarehouseId debe ser texto',
        },
        {
            title: 'destino vacío',
            input: validRequest({ toWarehouseId: '   ' }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'toWarehouseId no es válido',
        },
        {
            title: 'identificador demasiado largo',
            input: validRequest({ fromWarehouseId: 'w'.repeat(192) }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'fromWarehouseId no es válido',
        },
        {
            title: 'identificador con control',
            input: validRequest({ toWarehouseId: 'warehouse\nsecret' }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'toWarehouseId no es válido',
        },
        {
            title: 'bodegas iguales',
            input: validRequest({ fromWarehouseId: 'same', toWarehouseId: ' same ' }),
            code: 'SAME_WAREHOUSE',
            message: 'Origen y destino no pueden ser la misma bodega',
        },
        {
            title: 'items no array',
            input: validRequest({ items: null }),
            code: 'INVALID_TRANSFER_ITEMS',
            message: 'La transferencia requiere entre 1 y 50 ítems',
        },
        {
            title: 'items vacíos',
            input: validRequest({ items: [] }),
            code: 'INVALID_TRANSFER_ITEMS',
            message: 'La transferencia requiere entre 1 y 50 ítems',
        },
        {
            title: 'más de 50 items',
            input: validRequest({
                items: Array.from({ length: 51 }, (_, index) => ({
                    productId: `product-${index}`,
                    quantity: '1',
                })),
            }),
            code: 'INVALID_TRANSFER_ITEMS',
            message: 'La transferencia requiere entre 1 y 50 ítems',
        },
        {
            title: 'item null',
            input: validRequest({ items: [null] }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'productId debe ser texto',
        },
        {
            title: 'producto vacío',
            input: validRequest({ items: [{ productId: ' ', quantity: '1' }] }),
            code: 'INVALID_TRANSFER_CONTEXT',
            message: 'productId no es válido',
        },
        {
            title: 'producto repetido',
            input: validRequest({ items: [
                { productId: 'product-a', quantity: '1' },
                { productId: ' product-a ', quantity: '2' },
            ] }),
            code: 'DUPLICATE_TRANSFER_PRODUCT',
            message: 'No repitás un producto en la misma transferencia',
        },
        {
            title: 'cantidad Number',
            input: validRequest({ items: [{ productId: 'product-a', quantity: 0.1 }] }),
            code: 'INVALID_TRANSFER_QUANTITY',
            message: 'La cantidad debe enviarse como texto decimal exacto',
        },
        {
            title: 'cantidad vacía',
            input: validRequest({ items: [{ productId: 'product-a', quantity: '   ' }] }),
            code: 'INVALID_TRANSFER_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        },
        {
            title: 'cantidad demasiado larga',
            input: validRequest({ items: [{ productId: 'product-a', quantity: '1'.repeat(65) }] }),
            code: 'INVALID_TRANSFER_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        },
        {
            title: 'cantidad decimal inválida',
            input: validRequest({ items: [{ productId: 'product-a', quantity: 'no-decimal' }] }),
            code: 'INVALID_QUANTITY',
            message: 'La cantidad no tiene un formato decimal válido',
        },
    ])('rechaza $title con diagnóstico estable', ({ input, code, message }) => {
        expectTransferError(
            () => normalizeStockTransferCommand(input as never),
            code,
            message,
        );
    });

    it('acepta exactamente 191 caracteres de contexto, 50 items y 64 de cantidad', () => {
        const identifier = `w${'a'.repeat(190)}`;
        const quantity = `${'0'.repeat(63)}1`;
        const normalized = normalizeStockTransferCommand(validRequest({
            fromWarehouseId: identifier,
            items: Array.from({ length: 50 }, (_, index) => ({
                productId: `product-${String(index).padStart(2, '0')}`,
                quantity: index === 0 ? quantity : '1',
            })),
        }) as never);

        expect(normalized.fromWarehouseId).toHaveLength(191);
        expect(normalized.items).toHaveLength(50);
        expect(normalized.items[0]).toEqual({ productId: 'product-00', quantity: '1.0000' });
    });

    it('normaliza notas y cantidad con sus bordes exactos', () => {
        expect(normalizeStockTransferCommand(validRequest({ notes: undefined }) as never).notes).toBeNull();
        expect(normalizeStockTransferCommand(validRequest({ notes: null }) as never).notes).toBeNull();
        expect(normalizeStockTransferCommand(validRequest({ notes: '   ' }) as never).notes).toBeNull();
        expect(normalizeStockTransferCommand(validRequest({
            notes: '  Nota exacta  ',
            items: [{ productId: ' product-a ', quantity: ' 0.1 ' }],
        }) as never)).toMatchObject({
            notes: 'Nota exacta',
            items: [{ productId: 'product-a', quantity: '0.1000' }],
        });
        expect(normalizeStockTransferCommand(validRequest({ notes: 'n'.repeat(500) }) as never).notes)
            .toHaveLength(500);
        expectTransferError(
            () => normalizeStockTransferCommand(validRequest({ notes: 7 }) as never),
            'INVALID_TRANSFER_NOTES',
            'notes debe ser texto',
        );
        for (const notes of ['n'.repeat(501), 'visible\u0000oculto']) {
            expectTransferError(
                () => normalizeStockTransferCommand(validRequest({ notes }) as never),
                'INVALID_TRANSFER_NOTES',
                'notes admite máximo 500 caracteres',
            );
        }
    });

    it('no reclasifica como cantidad un fallo inesperado del parser compartido', () => {
        const sentinel = new Error('sentinel-transfer-quantity');
        const decimalPlaces = vi.spyOn(Decimal.prototype, 'decimalPlaces').mockImplementationOnce(() => {
            throw sentinel;
        });
        try {
            expect(() => normalizeStockTransferCommand(validRequest() as never)).toThrow(sentinel);
        } finally {
            decimalPlaces.mockRestore();
        }
    });
});

describe('mutación: huella, orden e inicialización del comando', () => {
    const canonical = (items: CanonicalStockTransferCommand['items']): CanonicalStockTransferCommand => ({
        clientEventId: EVENT_ID,
        fromWarehouseId: 'warehouse-a',
        toWarehouseId: 'warehouse-b',
        notes: 'Traslado',
        items,
    });

    it('ordena dentro de la huella aun si recibe un comando canónico desordenado', () => {
        const unordered = canonical([
            { productId: 'product-z', quantity: '2.0000' },
            { productId: 'product-a', quantity: '1.0000' },
        ]);
        const ordered = canonical([...unordered.items].reverse());
        expect(buildStockTransferPayloadHash({ tenantId: ' tenant-a ', command: unordered }))
            .toBe(buildStockTransferPayloadHash({ tenantId: 'tenant-a', command: ordered }));
        expect(unordered.items.map(item => item.productId)).toEqual(['product-z', 'product-a']);
    });

    it('valida tenant y conserva mensaje completo del conflicto idempotente', () => {
        expectTransferError(
            () => buildStockTransferPayloadHash({ tenantId: null as never, command: canonical([]) }),
            'INVALID_TRANSFER_CONTEXT',
            'tenantId debe ser texto',
        );
        const error = captureTransferError(() =>
            assertMatchingStockTransferReplay({ payloadHash: 'anterior', payloadVersion: 1 }, 'nuevo'));
        expect(error).toMatchObject({
            code: 'STOCK_TRANSFER_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
            message: 'clientEventId ya fue usado con una transferencia distinta',
        });
    });

    it('revalúa regex y helpers concisos al cargar una instancia fresca', async () => {
        vi.resetModules();
        const fresh = await import('../backend/lib/stockTransferCommand');
        const normalized = fresh.normalizeStockTransferCommand(validRequest({
            clientEventId: `  ${EVENT_ID.toUpperCase()}  `,
        }) as never);
        expect(normalized.clientEventId).toBe(EVENT_ID);
        expect(fresh.buildStockTransferPayloadHash({ tenantId: 'tenant-a', command: normalized }))
            .toMatch(/^[0-9a-f]{64}$/u);

        const malformed = [
            `x${EVENT_ID}`,
            `${EVENT_ID}x`,
            'a-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'zzzzzzzz-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'aaaaaaaa-a-4aaa-8aaa-aaaaaaaaaaaa',
            'aaaaaaaa-zzzz-4aaa-8aaa-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-4zzz-8aaa-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-4aaa-8zzz-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-4aaa-8aaa-a',
            'aaaaaaaa-aaaa-4aaa-8aaa-zzzzzzzzzzzz',
        ];
        for (const clientEventId of malformed) {
            expect(() => fresh.normalizeStockTransferCommand(validRequest({ clientEventId }) as never))
                .toThrowError(expect.objectContaining({ code: 'INVALID_CLIENT_EVENT_ID' }));
        }
    });
});
