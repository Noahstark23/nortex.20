import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    assertMatchingPurchaseOrderCloseShortReplay,
    buildPurchaseOrderCloseShortPayloadHash,
    closedShortQuantityForPurchaseOrderItem,
    derivePurchaseOrderFulfillmentStatus,
    normalizePurchaseOrderCloseShortLines,
    normalizePurchaseOrderCloseShortRequest,
    PurchaseOrderCloseShortError,
    rejectedQuantityForPurchaseOrderItem,
    remainingOpenQuantityForPurchaseOrderItem,
    type CanonicalPurchaseOrderCloseShortLine,
} from '../backend/lib/purchaseOrderCloseShort';

const EVENT_ID = 'd95d65da-c109-4e21-9384-08120c954b23';

const item = (overrides: Record<string, unknown> = {}) => ({
    id: 'item-a',
    productId: 'product-a',
    productName: 'Carne molida',
    quantityOrdered: 10,
    quantityReceived: 0,
    quantityOrderedExact: '10',
    quantityReceivedExact: '0',
    quantityRejectedExact: '0',
    quantityClosedShortExact: '0',
    unitAtOrder: 'kg',
    saleModeAtOrder: 'MEASURED',
    quantityStepAtOrder: '0.0001',
    ...overrides,
});

const product = (overrides: Record<string, unknown> = {}) => ({
    id: 'product-a',
    name: 'Carne molida',
    unit: 'kg',
    saleMode: 'MEASURED',
    quantityStep: '0.0001',
    ...overrides,
});

const line = (overrides: Partial<CanonicalPurchaseOrderCloseShortLine> = {}): CanonicalPurchaseOrderCloseShortLine => ({
    itemId: 'item-a',
    quantity: '1',
    reasonCode: 'SUPPLIER_SHORTAGE',
    supplierFault: null,
    note: null,
    ...overrides,
});

const captureCloseShortError = (action: () => unknown): PurchaseOrderCloseShortError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(PurchaseOrderCloseShortError);
        expect((error as PurchaseOrderCloseShortError).name).toBe('PurchaseOrderCloseShortError');
        return error as PurchaseOrderCloseShortError;
    }
    throw new Error('Se esperaba PurchaseOrderCloseShortError');
};

const expectCloseShortError = (
    action: () => unknown,
    code: string,
    message: string,
    httpStatus = 409,
): void => {
    expect(captureCloseShortError(action)).toMatchObject({ code, httpStatus, message });
};

describe('mutación: esquema e inicialización de cierre corto', () => {
    it('revalúa schemas, orden y helpers concisos en una instancia fresca', async () => {
        vi.resetModules();
        const fresh = await import('../backend/lib/purchaseOrderCloseShort');
        const parsed = fresh.purchaseOrderCloseShortRequestSchema.parse({
            clientEventId: EVENT_ID,
            reasonSummaryCode: 'SUPPLIER_SHORTAGE',
            note: '  Resumen  ',
            items: [
                {
                    itemId: ' item-b ',
                    quantity: ' 2.5 ',
                    reasonCode: 'DELIVERY_CANCELLED',
                    supplierFault: true,
                    note: '  Nota B  ',
                },
                {
                    itemId: 'item-a',
                    quantity: '1',
                    reasonCode: 'SUPPLIER_SHORTAGE',
                },
            ],
        });
        expect(parsed).toMatchObject({
            note: 'Resumen',
            items: [
                { itemId: 'item-b', quantity: '2.5', note: 'Nota B' },
                { itemId: 'item-a', quantity: '1' },
            ],
        });

        const canonical = fresh.normalizePurchaseOrderCloseShortRequest(parsed);
        expect(canonical.lines.map(entry => entry.itemId)).toEqual(['item-a', 'item-b']);
        expect(fresh.rejectedQuantityForPurchaseOrderItem(item({ quantityRejectedExact: '1.25' })).toString())
            .toBe('1.25');
        expect(fresh.closedShortQuantityForPurchaseOrderItem(item({ quantityClosedShortExact: '2.5' })).toString())
            .toBe('2.5');
        expect(fresh.buildPurchaseOrderCloseShortPayloadHash({
            tenantId: 'tenant-a',
            purchaseOrderId: 'po-a',
            reasonSummaryCode: canonical.reasonSummaryCode,
            note: canonical.note,
            lines: canonical.lines,
        })).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('protege todos los bordes persistibles del schema fresco', async () => {
        vi.resetModules();
        const { purchaseOrderCloseShortRequestSchema: schema } =
            await import('../backend/lib/purchaseOrderCloseShort');
        const baseLine = {
            itemId: 'item-long',
            quantity: '10',
            reasonCode: 'SUPPLIER_SHORTAGE',
            note: 'n',
        };
        expect(schema.safeParse({
            clientEventId: EVENT_ID,
            note: 'n',
            items: [baseLine, { ...baseLine, itemId: 'item-two' }],
        }).success).toBe(true);
        expect(schema.safeParse({
            clientEventId: EVENT_ID,
            note: 'n'.repeat(2_000),
            items: [{
                ...baseLine,
                itemId: 'i'.repeat(191),
                quantity: `${'0'.repeat(63)}1`,
                note: 'n'.repeat(2_000),
            }],
        }).success).toBe(true);
        expect(schema.safeParse({
            clientEventId: EVENT_ID,
            items: Array.from({ length: 500 }, (_, index) => ({
                ...baseLine,
                itemId: `item-${index}`,
            })),
        }).success).toBe(true);

        const invalidPayloads = [
            { clientEventId: EVENT_ID, items: [] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, quantity: ' ' }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, quantity: '1'.repeat(65) }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, itemId: ' ' }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, itemId: 'i'.repeat(192) }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, note: 'n'.repeat(2_001) }] },
            { clientEventId: EVENT_ID, note: 'n'.repeat(2_001), items: [baseLine] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, extra: true }] },
            { clientEventId: EVENT_ID, tenantId: 'forjado', items: [baseLine] },
            { clientEventId: EVENT_ID, items: [{}] },
            { clientEventId: EVENT_ID, items: Array.from({ length: 501 }, (_, index) => ({
                ...baseLine,
                itemId: `item-${index}`,
            })) },
        ];
        for (const payload of invalidPayloads) {
            expect(schema.safeParse(payload).success).toBe(false);
        }
    });
});

describe('mutación: cantidades y estados de cierre corto', () => {
    it('normaliza opcionales vacíos y conserva los textos recortados', () => {
        const normalized = normalizePurchaseOrderCloseShortRequest({
            clientEventId: `  ${EVENT_ID.toUpperCase()}  `,
            reasonSummaryCode: undefined,
            note: '   ',
            items: [{
                itemId: ' item-a ',
                quantity: '1',
                reasonCode: 'SUPPLIER_SHORTAGE',
                supplierFault: undefined,
                note: '  Razón exacta  ',
            }],
        });
        expect(normalized).toEqual({
            clientEventId: EVENT_ID,
            reasonSummaryCode: null,
            note: null,
            lines: [{
                itemId: 'item-a',
                quantity: '1',
                reasonCode: 'SUPPLIER_SHORTAGE',
                supplierFault: null,
                note: 'Razón exacta',
            }],
        });
    });

    it('conserva el diagnóstico completo de una línea duplicada', () => {
        expectCloseShortError(
            () => normalizePurchaseOrderCloseShortRequest({
                clientEventId: EVENT_ID,
                items: [
                    { itemId: 'item-a', quantity: '1', reasonCode: 'SUPPLIER_SHORTAGE' },
                    { itemId: ' item-a ', quantity: '2', reasonCode: 'DELIVERY_CANCELLED' },
                ],
            }),
            'DUPLICATE_ITEM',
            'Hay líneas repetidas en el cierre corto',
            400,
        );
    });

    it('no reclasifica como cantidad un error inesperado del parser', () => {
        const sentinel = new Error('sentinel-parser');
        const poisonous = new Proxy({}, {
            getPrototypeOf: () => { throw sentinel; },
        });
        expect(() => normalizePurchaseOrderCloseShortRequest({
            clientEventId: EVENT_ID,
            items: [{
                itemId: 'item-a',
                quantity: poisonous as never,
                reasonCode: 'SUPPLIER_SHORTAGE',
            }],
        } as never)).toThrow(sentinel);
    });

    it.each([
        {
            title: 'toString corrupto',
            field: 'quantityRejectedExact',
            value: { toString: () => { throw new Error('corrupto'); } },
            action: rejectedQuantityForPurchaseOrderItem,
            message: 'La cantidad rechazada no es válida',
        },
        {
            title: 'rechazo no finito',
            field: 'quantityRejectedExact',
            value: 'NaN',
            action: rejectedQuantityForPurchaseOrderItem,
            message: 'La cantidad rechazada no es válida',
        },
        {
            title: 'cierre negativo',
            field: 'quantityClosedShortExact',
            value: '-0.0001',
            action: closedShortQuantityForPurchaseOrderItem,
            message: 'La cantidad cerrada corta no es válida',
        },
        {
            title: 'cierre con 5dp',
            field: 'quantityClosedShortExact',
            value: '1.00001',
            action: closedShortQuantityForPurchaseOrderItem,
            message: 'La cantidad cerrada corta no es válida',
        },
    ])('falla cerrado para $title', ({ field, value, action, message }) => {
        expectCloseShortError(
            () => action(item({ [field]: value })),
            'CORRUPT_PURCHASE_ORDER_QUANTITY',
            message,
        );
    });

    it('acepta cero legacy y cuatro decimales exactos', () => {
        expect(rejectedQuantityForPurchaseOrderItem(item({ quantityRejectedExact: null })).toString()).toBe('0');
        expect(closedShortQuantityForPurchaseOrderItem(item({ quantityClosedShortExact: undefined })).toString()).toBe('0');
        expect(closedShortQuantityForPurchaseOrderItem(item({ quantityClosedShortExact: '1.0001' })).toString())
            .toBe('1.0001');
    });

    it('nombra estados históricos imposibles y orden sin líneas', () => {
        expectCloseShortError(
            () => remainingOpenQuantityForPurchaseOrderItem(item({ quantityOrderedExact: '0' })),
            'CORRUPT_PURCHASE_ORDER_QUANTITY',
            'Las cantidades históricas de Carne molida son inconsistentes',
        );
        expectCloseShortError(
            () => derivePurchaseOrderFulfillmentStatus([]),
            'PURCHASE_ORDER_WITHOUT_ITEMS',
            'La orden de compra no tiene líneas',
        );
    });

    it('distingue every/some con órdenes mixtas completas e incompletas', () => {
        expect(derivePurchaseOrderFulfillmentStatus([
            item({ id: 'item-full', quantityReceivedExact: '10' }),
            item({ id: 'item-open' }),
        ])).toBe('PARTIALLY_RECEIVED');
        expect(derivePurchaseOrderFulfillmentStatus([
            item({ id: 'item-short', quantityReceivedExact: '9', quantityClosedShortExact: '1' }),
            item({ id: 'item-full', quantityReceivedExact: '10' }),
        ])).toBe('CLOSED_SHORT');
    });
});

describe('mutación: normalización, huella y errores de cierre corto', () => {
    it('ordena escrituras sin mutar input y aplica fallback de unidad legacy', () => {
        const lines = [line({ itemId: 'item-b' }), line({ itemId: 'item-a' })];
        const orderItems = [
            item({
                id: 'item-b', productId: 'product-b', unitAtOrder: ' kg ',
            }),
            item({
                id: 'item-a', productId: 'product-a', unitAtOrder: null,
                saleModeAtOrder: null, quantityStepAtOrder: null,
            }),
        ];
        const normalized = normalizePurchaseOrderCloseShortLines(lines, orderItems, [
            product({ id: 'product-b', unit: 'lb' }),
            product({ id: 'product-a', unit: ' lb ' }),
        ]);
        expect(normalized.map(entry => entry.item.id)).toEqual(['item-a', 'item-b']);
        expect(normalized.map(entry => entry.unitSnapshot)).toEqual(['lb', 'kg']);
        expect(lines.map(entry => entry.itemId)).toEqual(['item-b', 'item-a']);
    });

    it('rechaza pertenencia y producto con diagnóstico exacto', () => {
        expectCloseShortError(
            () => normalizePurchaseOrderCloseShortLines([line({ itemId: 'missing' })], [item()], [product()]),
            'ITEM_NOT_IN_ORDER',
            'Una línea no pertenece a esta orden de compra',
            400,
        );
        expectCloseShortError(
            () => normalizePurchaseOrderCloseShortLines([line()], [item()], []),
            'PRODUCT_NOT_IN_TENANT',
            'Uno o más productos no pertenecen a tu negocio',
            400,
        );
    });

    it('conserva diagnósticos de paso y sobrecierre', () => {
        expectCloseShortError(
            () => normalizePurchaseOrderCloseShortLines(
                [line({ quantity: '0.5' })],
                [item({ saleModeAtOrder: 'COUNTED', quantityStepAtOrder: '1', unitAtOrder: 'unidad' })],
                [product({ unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' })],
            ),
            'COUNTED_REQUIRES_INTEGER',
            'Los productos contables requieren cantidades y pasos enteros',
            400,
        );
        expectCloseShortError(
            () => normalizePurchaseOrderCloseShortLines(
                [line({ quantity: '4.0002' })],
                [item({ quantityReceivedExact: '4.9999', quantityClosedShortExact: '1' })],
                [product()],
            ),
            'OVER_CLOSE_SHORT',
            'No podés cerrar más de lo pendiente: a "Carne molida" le quedan 4.0001',
        );
    });

    it('no reclasifica como cantidad un fallo inesperado de validación', () => {
        const sentinel = new Error('sentinel-validation');
        const modulo = vi.spyOn(Decimal.prototype, 'modulo').mockImplementationOnce(() => {
            throw sentinel;
        });
        try {
            expect(() => normalizePurchaseOrderCloseShortLines(
                [line()],
                [item({ unitAtOrder: null, saleModeAtOrder: null, quantityStepAtOrder: null })],
                [product()],
            )).toThrow(sentinel);
        } finally {
            modulo.mockRestore();
        }
    });

    it('canoniza la huella desordenada y cada identidad tenant-scoped', () => {
        const unordered = [line({ itemId: 'item-z' }), line({ itemId: 'item-a', quantity: '2.0' })];
        const hash = (overrides: Record<string, unknown> = {}) =>
            buildPurchaseOrderCloseShortPayloadHash({
                tenantId: ' tenant-a ',
                purchaseOrderId: ' po-a ',
                reasonSummaryCode: null,
                note: '   ',
                lines: unordered,
                ...overrides,
            } as never);
        expect(hash()).toBe(hash({
            tenantId: 'tenant-a',
            purchaseOrderId: 'po-a',
            lines: [...unordered].reverse(),
            note: null,
        }));
        expect(hash()).not.toBe(hash({ purchaseOrderId: 'po-b' }));
        expect(unordered.map(entry => entry.itemId)).toEqual(['item-z', 'item-a']);
    });

    it('conserva nombre, código, estado y mensaje del conflicto', () => {
        const error = captureCloseShortError(() =>
            assertMatchingPurchaseOrderCloseShortReplay({ payloadHash: null }, 'nuevo'));
        expect(error).toMatchObject({
            code: 'CLOSE_SHORT_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
            message: 'clientEventId ya fue usado con un cierre corto distinto',
        });
    });
});
