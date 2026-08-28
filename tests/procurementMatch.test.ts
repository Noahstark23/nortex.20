import { describe, expect, it } from 'vitest';
import {
    calculateProcurementMatch,
    normalizeProcurementResolution,
    ProcurementMatchError,
    toPostedProcurementAmount,
    type CalculateProcurementMatchInput,
} from '../backend/lib/procurementMatch';

const baseInput = (
    overrides: Partial<CalculateProcurementMatchInput> = {},
): CalculateProcurementMatchInput => ({
    purchaseOrderId: 'po-1',
    paymentMethod: 'CREDIT',
    priceTolerancePercent: '2.5',
    orderLines: [{
        id: 'po-line-1',
        orderedQuantity: '10',
        orderedUnitCost: '10',
    }],
    receiptLines: [{
        id: 'receipt-line-1',
        purchaseOrderItemId: 'po-line-1',
        acceptedQuantity: '10',
        allocatedQuantity: '0',
        receivedAt: '2026-08-27T10:00:00.000Z',
    }],
    invoiceLines: [{
        key: 'invoice-line-1',
        purchaseOrderItemId: 'po-line-1',
        quantity: '2',
        unitCost: '10',
    }],
    ...overrides,
});

const captureMatchError = (callback: () => unknown): ProcurementMatchError => {
    try {
        callback();
    } catch (error) {
        expect(error).toBeInstanceOf(ProcurementMatchError);
        return error as ProcurementMatchError;
    }
    throw new Error('Se esperaba ProcurementMatchError');
};

describe('motor puro de conciliación 3-way', () => {
    it('marca una compra directa como NOT_REQUIRED sin inventar asignaciones', () => {
        const result = calculateProcurementMatch(baseInput({
            purchaseOrderId: null,
            orderLines: [],
            receiptLines: [],
            invoiceLines: [],
        }));

        expect(result).toEqual({
            status: 'NOT_REQUIRED',
            paymentHold: false,
            priceTolerancePercent: '2.500000',
            expectedAmount: '0.00',
            invoiceAmount: '0.00',
            varianceAmount: '0.00',
            lines: [],
            allocations: [],
            exceptionCodes: [],
        });
    });

    it.each([
        ['10.250000', '0.250000'],
        ['9.750000', '-0.250000'],
    ])('acepta el borde exacto de tolerancia: %s', (actual, variance) => {
        const result = calculateProcurementMatch(baseInput({
            invoiceLines: [{
                key: 'invoice-line-1',
                purchaseOrderItemId: 'po-line-1',
                quantity: '2',
                unitCost: actual,
            }],
        }));

        expect(result.status).toBe('MATCHED');
        expect(result.paymentHold).toBe(false);
        expect(result.lines[0]).toMatchObject({
            unitCostVariance: variance,
            allowedUnitCostVariance: '0.250000',
            withinPriceTolerance: true,
        });
    });

    it.each(['10.250001', '9.749999'])(
        'marca excepción al salir una millonésima del borde: %s',
        (actual) => {
            const result = calculateProcurementMatch(baseInput({
                invoiceLines: [{
                    key: 'invoice-line-1',
                    purchaseOrderItemId: 'po-line-1',
                    quantity: '2',
                    unitCost: actual,
                }],
            }));

            expect(result.status).toBe('EXCEPTION');
            expect(result.paymentHold).toBe(true);
            expect(result.exceptionCodes).toEqual(['PRICE_VARIANCE']);
            expect(result.lines[0].withinPriceTolerance).toBe(false);
        },
    );

    it('rechaza CASH fuera de tolerancia antes de devolver un plan persistible', () => {
        const error = captureMatchError(() => calculateProcurementMatch(baseInput({
            paymentMethod: 'CASH',
            invoiceLines: [{
                key: 'invoice-line-1',
                purchaseOrderItemId: 'po-line-1',
                quantity: '1',
                unitCost: '10.250001',
            }],
        })));

        expect(error.code).toBe('CASH_PRICE_VARIANCE_REQUIRES_RESOLUTION');
        expect(error.httpStatus).toBe(409);
    });

    it('no mezcla dos líneas de OC aunque representen el mismo SKU fuera del motor', () => {
        const error = captureMatchError(() => calculateProcurementMatch(baseInput({
            orderLines: [
                { id: 'po-line-a', orderedQuantity: '5', orderedUnitCost: '10' },
                { id: 'po-line-b', orderedQuantity: '5', orderedUnitCost: '10' },
            ],
            receiptLines: [{
                id: 'receipt-a',
                purchaseOrderItemId: 'po-line-a',
                acceptedQuantity: '5',
                allocatedQuantity: '0',
                receivedAt: '2026-08-27T10:00:00.000Z',
            }],
            invoiceLines: [{
                key: 'invoice-b',
                purchaseOrderItemId: 'po-line-b',
                quantity: '1',
                unitCost: '10',
            }],
        })));

        expect(error.code).toBe('INVOICE_EXCEEDS_ACCEPTED_QUANTITY');
        expect(error.details).toMatchObject({ purchaseOrderItemId: 'po-line-b' });
    });

    it('limita la factura al aceptado menos lo previamente asignado', () => {
        const exact = calculateProcurementMatch(baseInput({
            receiptLines: [{
                id: 'receipt-line-1',
                purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '5',
                allocatedQuantity: '2.2500',
                receivedAt: '2026-08-27T10:00:00.000Z',
            }],
            invoiceLines: [{
                key: 'invoice-line-1',
                purchaseOrderItemId: 'po-line-1',
                quantity: '2.7500',
                unitCost: '10',
            }],
        }));
        expect(exact.lines[0]).toMatchObject({
            acceptedQuantity: '5.0000',
            alreadyAllocatedQuantity: '2.2500',
            availableBefore: '2.7500',
        });

        const error = captureMatchError(() => calculateProcurementMatch(baseInput({
            receiptLines: [{
                id: 'receipt-line-1',
                purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '5',
                allocatedQuantity: '2.2500',
                receivedAt: '2026-08-27T10:00:00.000Z',
            }],
            invoiceLines: [{
                key: 'invoice-line-1',
                purchaseOrderItemId: 'po-line-1',
                quantity: '2.7501',
                unitCost: '10',
            }],
        })));
        expect(error.code).toBe('INVOICE_EXCEEDS_ACCEPTED_QUANTITY');
    });

    it('asigna FIFO por receivedAt y usa id como desempate determinista', () => {
        const result = calculateProcurementMatch(baseInput({
            receiptLines: [
                {
                    id: 'receipt-z',
                    purchaseOrderItemId: 'po-line-1',
                    acceptedQuantity: '1',
                    allocatedQuantity: '0',
                    receivedAt: '2026-08-27T09:00:00.000Z',
                },
                {
                    id: 'receipt-b',
                    purchaseOrderItemId: 'po-line-1',
                    acceptedQuantity: '2',
                    allocatedQuantity: '0',
                    receivedAt: '2026-08-27T10:00:00.000Z',
                },
                {
                    id: 'receipt-a',
                    purchaseOrderItemId: 'po-line-1',
                    acceptedQuantity: '2',
                    allocatedQuantity: '0',
                    receivedAt: '2026-08-27T10:00:00.000Z',
                },
            ],
            invoiceLines: [{
                key: 'invoice-line-1',
                purchaseOrderItemId: 'po-line-1',
                quantity: '4',
                unitCost: '10',
            }],
        }));

        expect(result.allocations.map(({ goodsReceiptItemId, quantity }) => ({
            goodsReceiptItemId,
            quantity,
        }))).toEqual([
            { goodsReceiptItemId: 'receipt-z', quantity: '1.0000' },
            { goodsReceiptItemId: 'receipt-a', quantity: '2.0000' },
            { goodsReceiptItemId: 'receipt-b', quantity: '1.0000' },
        ]);
    });

    it('el plan es determinista aunque cambie el orden de las recepciones de entrada', () => {
        const receipts = [
            {
                id: 'receipt-2', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '2', allocatedQuantity: '0', receivedAt: '2026-08-28T10:00:00Z',
            },
            {
                id: 'receipt-1', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '2', allocatedQuantity: '0', receivedAt: '2026-08-27T10:00:00Z',
            },
        ];
        const left = calculateProcurementMatch(baseInput({ receiptLines: receipts }));
        const right = calculateProcurementMatch(baseInput({ receiptLines: [...receipts].reverse() }));
        expect(right).toEqual(left);
    });

    it('rechaza datos corruptos de recepción sin normalizarlos silenciosamente', () => {
        const allocated = captureMatchError(() => calculateProcurementMatch(baseInput({
            receiptLines: [{
                id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '1', allocatedQuantity: '1.0001',
                receivedAt: '2026-08-27T10:00:00Z',
            }],
        })));
        expect(allocated.code).toBe('INVALID_RECEIPT_ALLOCATION');

        const overReceived = captureMatchError(() => calculateProcurementMatch(baseInput({
            receiptLines: [{
                id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '10.0001', allocatedQuantity: '0',
                receivedAt: '2026-08-27T10:00:00Z',
            }],
        })));
        expect(overReceived.code).toBe('RECEIPT_EXCEEDS_ORDERED_QUANTITY');
    });

    it('conserva costos 18,6, variación 18,4 y redondea posteos HALF_UP a 2dp', () => {
        const result = calculateProcurementMatch(baseInput({
            priceTolerancePercent: '100',
            orderLines: [{
                id: 'po-line-1', orderedQuantity: '1', orderedUnitCost: '1.005000',
            }],
            receiptLines: [{
                id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '1', allocatedQuantity: '0', receivedAt: '2026-08-27T10:00:00Z',
            }],
            invoiceLines: [{
                key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1',
                quantity: '1', unitCost: '1.015001',
            }],
        }));

        expect(result.lines[0]).toMatchObject({
            orderedUnitCost: '1.005000',
            invoiceUnitCost: '1.015001',
            priceVarianceExact: '0.0100',
            expectedAmount: '1.01',
            invoiceAmount: '1.02',
            varianceAmount: '0.01',
        });
        expect(result.allocations[0]).toMatchObject({
            expectedUnitCostExact: '1.005000',
            actualUnitCostExact: '1.015001',
            priceVarianceExact: '0.0100',
        });
        expect(toPostedProcurementAmount('-1.005')).toBe('-1.01');
    });

    it('suma los centavos posteados por línea y no inventa PPV en un MATCHED', () => {
        const result = calculateProcurementMatch(baseInput({
            orderLines: [
                { id: 'po-line-1', orderedQuantity: '1', orderedUnitCost: '1.005000' },
                { id: 'po-line-2', orderedQuantity: '1', orderedUnitCost: '1.005000' },
            ],
            receiptLines: [
                {
                    id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1',
                    acceptedQuantity: '1', allocatedQuantity: '0', receivedAt: '2026-08-27T10:00:00Z',
                },
                {
                    id: 'receipt-line-2', purchaseOrderItemId: 'po-line-2',
                    acceptedQuantity: '1', allocatedQuantity: '0', receivedAt: '2026-08-27T10:01:00Z',
                },
            ],
            invoiceLines: [
                {
                    key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1',
                    quantity: '1', unitCost: '1.005000',
                },
                {
                    key: 'invoice-line-2', purchaseOrderItemId: 'po-line-2',
                    quantity: '1', unitCost: '1.005000',
                },
            ],
        }));

        expect(result.status).toBe('MATCHED');
        expect(result.lines.map((line) => line.expectedAmount)).toEqual(['1.01', '1.01']);
        expect(result.lines.map((line) => line.invoiceAmount)).toEqual(['1.01', '1.01']);
        expect(result).toMatchObject({
            expectedAmount: '2.02',
            invoiceAmount: '2.02',
            varianceAmount: '0.00',
        });
    });

    it('redondea una línea una sola vez aunque se asigne a dos recepciones', () => {
        const result = calculateProcurementMatch(baseInput({
            orderLines: [{
                id: 'po-line-1', orderedQuantity: '2', orderedUnitCost: '1.005000',
            }],
            receiptLines: [
                {
                    id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1',
                    acceptedQuantity: '1', allocatedQuantity: '0', receivedAt: '2026-08-27T10:00:00Z',
                },
                {
                    id: 'receipt-line-2', purchaseOrderItemId: 'po-line-1',
                    acceptedQuantity: '1', allocatedQuantity: '0', receivedAt: '2026-08-27T10:01:00Z',
                },
            ],
            invoiceLines: [{
                key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1',
                quantity: '2', unitCost: '1.005000',
            }],
        }));

        expect(result.allocations).toHaveLength(2);
        expect(result.lines[0].expectedAmount).toBe('2.01');
        expect(result).toMatchObject({
            expectedAmount: '2.01',
            invoiceAmount: '2.01',
            varianceAmount: '0.00',
        });
    });

    it('proyecta recepción legacy solo con fuente explícita y retiene CREDIT', () => {
        const result = calculateProcurementMatch(baseInput({
            receiptLines: [{
                id: 'legacy:po-line-1',
                goodsReceiptItemId: null,
                source: 'LEGACY_PROJECTION',
                purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '3',
                allocatedQuantity: '0',
                receivedAt: '1970-01-01T00:00:00.000Z',
            }],
            invoiceLines: [{
                key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1',
                quantity: '1', unitCost: '10',
            }],
        }));

        expect(result.status).toBe('EXCEPTION');
        expect(result.paymentHold).toBe(true);
        expect(result.exceptionCodes).toEqual(['LEGACY_RECEIPT_TRACE']);
        expect(result.lines[0].usesLegacyProjection).toBe(true);
        expect(result.allocations[0]).toMatchObject({
            goodsReceiptItemId: null,
            source: 'LEGACY_PROJECTION',
        });
    });

    it('rechaza CASH con proyección legacy aunque el precio coincida', () => {
        const error = captureMatchError(() => calculateProcurementMatch(baseInput({
            paymentMethod: 'CASH',
            receiptLines: [{
                id: 'legacy:po-line-1', goodsReceiptItemId: null,
                source: 'LEGACY_PROJECTION', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '3', allocatedQuantity: '0', receivedAt: new Date(0),
            }],
        })));

        expect(error.code).toBe('CASH_LEGACY_RECEIPT_TRACE_REQUIRES_RESOLUTION');
        expect(error.httpStatus).toBe(409);
    });

    it('rechaza una fuente de recepción que contradice su referencia durable', () => {
        const error = captureMatchError(() => calculateProcurementMatch(baseInput({
            receiptLines: [{
                id: 'legacy:po-line-1', goodsReceiptItemId: 'formal-id',
                source: 'LEGACY_PROJECTION', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '1', allocatedQuantity: '0', receivedAt: new Date(0),
            }],
        })));
        expect(error.code).toBe('INVALID_RECEIPT_SOURCE');
    });
});

describe('intención idempotente de resolución', () => {
    const eventId = '018f6d75-0d8c-7a7a-8b4b-e2b25a80eb12';

    it('normaliza reason y UUID y produce una huella estable por compra', () => {
        const left = normalizeProcurementResolution(' purchase-1 ', {
            clientEventId: eventId.toUpperCase(),
            reason: '  Factura verificada con el proveedor  ',
        });
        const right = normalizeProcurementResolution('purchase-1', {
            clientEventId: eventId,
            reason: 'Factura verificada con el proveedor',
        });

        expect(left).toEqual(right);
        expect(left.clientEventId).toBe(eventId);
        expect(left.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('cambia la huella cuando cambia compra o razón', () => {
        const base = normalizeProcurementResolution('purchase-1', {
            clientEventId: eventId,
            reason: 'Costo confirmado',
        });
        expect(normalizeProcurementResolution('purchase-2', {
            clientEventId: eventId,
            reason: 'Costo confirmado',
        }).payloadHash).not.toBe(base.payloadHash);
        expect(normalizeProcurementResolution('purchase-1', {
            clientEventId: eventId,
            reason: 'Costo corregido',
        }).payloadHash).not.toBe(base.payloadHash);
    });

    it.each([
        [{ clientEventId: 'no-uuid', reason: 'Motivo válido' }, 'INVALID_RESOLUTION_CLIENT_EVENT_ID'],
        [{ clientEventId: eventId, reason: '  ' }, 'INVALID_RESOLUTION_REASON'],
        [{ clientEventId: eventId, reason: 'x'.repeat(1001) }, 'INVALID_RESOLUTION_REASON'],
    ])('rechaza resolución inválida con código estable', (request, code) => {
        expect(captureMatchError(() => normalizeProcurementResolution(
            'purchase-1',
            request,
        )).code).toBe(code);
    });
});
