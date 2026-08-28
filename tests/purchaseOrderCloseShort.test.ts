import { describe, expect, it } from 'vitest';
import {
    assertMatchingPurchaseOrderCloseShortReplay,
    buildPurchaseOrderCloseShortPayloadHash,
    derivePurchaseOrderFulfillmentStatus,
    normalizePurchaseOrderCloseShortLines,
    normalizePurchaseOrderCloseShortRequest,
    purchaseOrderCloseShortRequestSchema,
    PurchaseOrderCloseShortError,
    remainingOpenQuantityForPurchaseOrderItem,
} from '../backend/lib/purchaseOrderCloseShort';

const EVENT_ID = 'd95d65da-c109-4e21-9384-08120c954b23';

const makeItem = (overrides: Record<string, unknown> = {}) => ({
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

const product = {
    id: 'product-a',
    name: 'Carne molida',
    unit: 'kg',
    saleMode: 'MEASURED',
    quantityStep: '0.0001',
};

const parse = (items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
    purchaseOrderCloseShortRequestSchema.parse({ clientEventId: EVENT_ID, items, ...extra });

const captureError = (action: () => unknown): PurchaseOrderCloseShortError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(PurchaseOrderCloseShortError);
        return error as PurchaseOrderCloseShortError;
    }
    throw new Error('Se esperaba PurchaseOrderCloseShortError');
};

describe('contrato puro de cierre corto de orden de compra', () => {
    it('valida forma estricta, UUID, reason codes y límites de persistencia', () => {
        expect(purchaseOrderCloseShortRequestSchema.safeParse({
            clientEventId: 'no-uuid',
            items: [{ itemId: 'item-a', quantity: '1', reasonCode: 'SUPPLIER_SHORTAGE' }],
        }).success).toBe(false);
        expect(purchaseOrderCloseShortRequestSchema.safeParse({
            clientEventId: EVENT_ID,
            tenantId: 'tenant-forjado',
            items: [{ itemId: 'item-a', quantity: '1', reasonCode: 'SUPPLIER_SHORTAGE' }],
        }).success).toBe(false);
        expect(purchaseOrderCloseShortRequestSchema.safeParse({
            clientEventId: EVENT_ID,
            items: [{ itemId: 'item-a', quantity: '1', reasonCode: 'INVENTADO' }],
        }).success).toBe(false);
        expect(purchaseOrderCloseShortRequestSchema.safeParse({
            clientEventId: EVENT_ID,
            items: Array.from({ length: 501 }, (_, index) => ({
                itemId: `item-${index}`,
                quantity: '1',
                reasonCode: 'SUPPLIER_SHORTAGE',
            })),
        }).success).toBe(false);
        expect(purchaseOrderCloseShortRequestSchema.safeParse({
            clientEventId: EVENT_ID,
            items: [{ itemId: 'item-a', quantity: 1, reasonCode: 'SUPPLIER_SHORTAGE' }],
        }).success).toBe(false);
    });

    it('canoniza orden, Decimal y texto para una huella oro tenant-scoped', () => {
        const first = normalizePurchaseOrderCloseShortRequest(parse([
            {
                itemId: ' item-b ',
                quantity: '2.5000',
                reasonCode: 'DELIVERY_CANCELLED',
                supplierFault: true,
                note: '  Caja rota ',
            },
            { itemId: 'item-a', quantity: '0.0001', reasonCode: 'SUPPLIER_SHORTAGE' },
        ], { reasonSummaryCode: 'SUPPLIER_SHORTAGE', note: '  Cierre final  ' }));
        const equivalent = normalizePurchaseOrderCloseShortRequest(parse([
            { itemId: 'item-a', quantity: '0.0001', reasonCode: 'SUPPLIER_SHORTAGE' },
            {
                itemId: 'item-b',
                quantity: '2.5',
                reasonCode: 'DELIVERY_CANCELLED',
                supplierFault: true,
                note: 'Caja rota',
            },
        ], { reasonSummaryCode: 'SUPPLIER_SHORTAGE', note: 'Cierre final' }));
        const hash = (lines: typeof first.lines, tenantId = 'tenant-a') =>
            buildPurchaseOrderCloseShortPayloadHash({
                tenantId,
                purchaseOrderId: 'po-a',
                reasonSummaryCode: first.reasonSummaryCode,
                note: first.note,
                lines,
            });

        expect(first).toEqual({
            clientEventId: EVENT_ID,
            reasonSummaryCode: 'SUPPLIER_SHORTAGE',
            note: 'Cierre final',
            lines: [
                {
                    itemId: 'item-a',
                    quantity: '0.0001',
                    reasonCode: 'SUPPLIER_SHORTAGE',
                    supplierFault: null,
                    note: null,
                },
                {
                    itemId: 'item-b',
                    quantity: '2.5',
                    reasonCode: 'DELIVERY_CANCELLED',
                    supplierFault: true,
                    note: 'Caja rota',
                },
            ],
        });
        expect(hash(first.lines)).toBe(hash(equivalent.lines));
        expect(hash(first.lines)).toBe('e6345f3b8e8dbfe4dfcca2705f9d43789eaab4c808c8abe8873051048b889b33');
        expect(hash(first.lines)).not.toBe(hash(first.lines, 'tenant-b'));
        expect(hash(first.lines.map((line, index) => index === 0
            ? { ...line, reasonCode: 'QUALITY_REJECTION' }
            : line))).not.toBe(hash(first.lines));
    });

    it('rechaza cantidades no positivas, duplicados y distingue replay de conflicto', () => {
        for (const quantity of ['0', '-0.0001', '0.00001']) {
            expect(() => normalizePurchaseOrderCloseShortRequest(parse([
                { itemId: 'item-a', quantity, reasonCode: 'SUPPLIER_SHORTAGE' },
            ]))).toThrowError(PurchaseOrderCloseShortError);
        }
        expect(captureError(() => normalizePurchaseOrderCloseShortRequest(parse([
            { itemId: 'item-a', quantity: '1', reasonCode: 'SUPPLIER_SHORTAGE' },
            { itemId: ' item-a ', quantity: '2', reasonCode: 'DELIVERY_CANCELLED' },
        ]))).code).toBe('DUPLICATE_ITEM');

        expect(() => assertMatchingPurchaseOrderCloseShortReplay({ payloadHash: 'same' }, 'same'))
            .not.toThrow();
        expect(captureError(() =>
            assertMatchingPurchaseOrderCloseShortReplay({ payloadHash: 'other' }, 'same')))
            .toMatchObject({ code: 'CLOSE_SHORT_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
    });

    it('calcula open como ordered-accepted-closedShort e ignora rechazo acumulado', () => {
        expect(remainingOpenQuantityForPurchaseOrderItem(makeItem({
            quantityReceivedExact: '3.25',
            quantityClosedShortExact: '1.5',
            quantityRejectedExact: '99.9999',
        })).toString()).toBe('5.25');

        expect(() => remainingOpenQuantityForPurchaseOrderItem(makeItem({
            quantityReceivedExact: '9',
            quantityClosedShortExact: '2',
        }))).toThrowError(PurchaseOrderCloseShortError);
    });

    it('deriva APPROVED, PARTIALLY_RECEIVED, RECEIVED y CLOSED_SHORT sin facturar rechazos', () => {
        expect(derivePurchaseOrderFulfillmentStatus([
            makeItem({ quantityRejectedExact: '4' }),
        ])).toBe('APPROVED');
        expect(derivePurchaseOrderFulfillmentStatus([
            makeItem({ quantityReceivedExact: '1' }),
        ])).toBe('PARTIALLY_RECEIVED');
        expect(derivePurchaseOrderFulfillmentStatus([
            makeItem({ quantityReceivedExact: '10' }),
        ])).toBe('RECEIVED');
        expect(derivePurchaseOrderFulfillmentStatus([
            makeItem({ quantityReceivedExact: '7.5', quantityClosedShortExact: '2.5' }),
        ])).toBe('CLOSED_SHORT');
        expect(derivePurchaseOrderFulfillmentStatus([
            makeItem({ quantityClosedShortExact: '2.5' }),
            makeItem({ id: 'item-b', quantityOrderedExact: '2', quantityOrdered: 2 }),
        ])).toBe('PARTIALLY_RECEIVED');
    });

    it('valida snapshot/paso, saldo y snapshots exactos sin restar rechazado', () => {
        const canonical = normalizePurchaseOrderCloseShortRequest(parse([
            { itemId: 'item-a', quantity: '0.0001', reasonCode: 'QUALITY_REJECTION', supplierFault: false },
        ])).lines;
        const normalized = normalizePurchaseOrderCloseShortLines(
            canonical,
            [makeItem({
                quantityReceivedExact: '4.9999',
                quantityRejectedExact: '12',
                quantityClosedShortExact: '1',
            })],
            [product],
        );

        expect(normalized[0]).toMatchObject({
            quantity: '0.0001',
            unitSnapshot: 'kg',
            saleModeSnapshot: 'MEASURED',
            quantityStepSnapshot: '0.0001',
        });
        expect(normalized[0].ordered.toString()).toBe('10');
        expect(normalized[0].acceptedBefore.toString()).toBe('4.9999');
        expect(normalized[0].rejectedBefore.toString()).toBe('12');
        expect(normalized[0].closedShortAfter.toString()).toBe('1.0001');
        expect(normalized[0].remainingBefore.toString()).toBe('4.0001');
        expect(normalized[0].remainingAfter.toString()).toBe('4');

        expect(captureError(() => normalizePurchaseOrderCloseShortLines(
            normalizePurchaseOrderCloseShortRequest(parse([
                { itemId: 'item-a', quantity: '4.0002', reasonCode: 'SUPPLIER_SHORTAGE' },
            ])).lines,
            [makeItem({ quantityReceivedExact: '4.9999', quantityClosedShortExact: '1' })],
            [product],
        ))).toMatchObject({ code: 'OVER_CLOSE_SHORT', httpStatus: 409 });

        expect(captureError(() => normalizePurchaseOrderCloseShortLines(
            normalizePurchaseOrderCloseShortRequest(parse([
                { itemId: 'item-a', quantity: '0.5', reasonCode: 'SUPPLIER_SHORTAGE' },
            ])).lines,
            [makeItem({ saleModeAtOrder: 'COUNTED', quantityStepAtOrder: '1', unitAtOrder: 'unidad' })],
            [{ ...product, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' }],
        )).code).toBe('COUNTED_REQUIRES_INTEGER');
    });
});
