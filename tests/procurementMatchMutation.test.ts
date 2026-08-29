import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    calculateProcurementMatch,
    normalizeProcurementResolution,
    ProcurementMatchError,
    type CalculateProcurementMatchInput,
} from '../backend/lib/procurementMatch';

const EVENT_ID = '018f6d75-0d8c-7a7a-8b4b-e2b25a80eb12';

const validInput = (
    overrides: Partial<CalculateProcurementMatchInput> = {},
): CalculateProcurementMatchInput => ({
    purchaseOrderId: 'po-1',
    paymentMethod: 'CREDIT',
    priceTolerancePercent: '0',
    orderLines: [{ id: 'po-line-1', orderedQuantity: '10', orderedUnitCost: '10' }],
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
        quantity: '1',
        unitCost: '10',
    }],
    ...overrides,
});

const domainError = (callback: () => unknown): ProcurementMatchError => {
    try {
        callback();
    } catch (error) {
        expect(error).toBeInstanceOf(ProcurementMatchError);
        return error as ProcurementMatchError;
    }
    throw new Error('Se esperaba ProcurementMatchError');
};

const expectDomainError = (
    callback: () => unknown,
    expected: {
        code: string;
        status: number;
        message: string;
        details?: Record<string, string>;
    },
) => {
    const error = domainError(callback);
    expect({
        name: error.name,
        code: error.code,
        status: error.httpStatus,
        message: error.message,
        details: error.details,
    }).toEqual({
        name: 'ProcurementMatchError',
        ...expected,
        details: expected.details,
    });
};

describe('mutación: validación completa del motor de conciliación', () => {
    it('mantiene el contrato al cargar el motor en una instancia fresca', async () => {
        vi.resetModules();
        const freshModule = await import('../backend/lib/procurementMatch');

        expect(freshModule.calculateProcurementMatch(validInput({
            purchaseOrderId: null,
            orderLines: [],
            receiptLines: [],
            invoiceLines: [],
        }))).toEqual({
            status: 'NOT_REQUIRED',
            paymentHold: false,
            priceTolerancePercent: '0.000000',
            expectedAmount: '0.00',
            invoiceAmount: '0.00',
            varianceAmount: '0.00',
            lines: [],
            allocations: [],
            exceptionCodes: [],
        });
        expect(freshModule.calculateProcurementMatch(validInput())).toMatchObject({
            status: 'MATCHED',
            expectedAmount: '10.00',
            invoiceAmount: '10.00',
            varianceAmount: '0.00',
        });
    });

    it.each([
        {
            name: 'purchaseOrderId no string',
            input: () => validInput({ purchaseOrderId: undefined as unknown as string }),
            message: 'purchaseOrderId es obligatorio para conciliar la factura',
        },
        {
            name: 'id de línea OC vacío',
            input: () => validInput({
                orderLines: [{ id: ' ', orderedQuantity: '10', orderedUnitCost: '10' }],
            }),
            message: 'purchaseOrderItemId es obligatorio para conciliar la factura',
        },
        {
            name: 'id de recepción vacío',
            input: () => validInput({
                receiptLines: [{
                    id: ' ', purchaseOrderItemId: 'po-line-1', acceptedQuantity: '1',
                    allocatedQuantity: '0', receivedAt: '2026-08-27T10:00:00.000Z',
                }],
            }),
            message: 'goodsReceiptItemId es obligatorio para conciliar la factura',
        },
        {
            name: 'línea OC de recepción vacía',
            input: () => validInput({
                receiptLines: [{
                    id: 'receipt-line-1', purchaseOrderItemId: ' ', acceptedQuantity: '1',
                    allocatedQuantity: '0', receivedAt: '2026-08-27T10:00:00.000Z',
                }],
            }),
            message: 'purchaseOrderItemId es obligatorio para conciliar la factura',
        },
        {
            name: 'key de factura vacío',
            input: () => validInput({
                invoiceLines: [{
                    key: ' ', purchaseOrderItemId: 'po-line-1', quantity: '1', unitCost: '10',
                }],
            }),
            message: 'invoiceLineKey es obligatorio para conciliar la factura',
        },
        {
            name: 'línea OC de factura vacía',
            input: () => validInput({
                invoiceLines: [{
                    key: 'invoice-line-1', purchaseOrderItemId: ' ', quantity: '1', unitCost: '10',
                }],
            }),
            message: 'purchaseOrderItemId es obligatorio para conciliar la factura',
        },
    ])('rechaza $name con identidad y mensaje estables', ({ input, message }) => {
        expectDomainError(() => calculateProcurementMatch(input()), {
            code: 'INVALID_MATCH_INPUT', status: 400, message,
        });
    });

    it.each([
        {
            name: 'tolerancia no decimal',
            input: () => validInput({ priceTolerancePercent: Symbol('bad') as unknown as string }),
            message: 'priceTolerancePercent no es un decimal válido',
        },
        {
            name: 'tolerancia negativa',
            input: () => validInput({ priceTolerancePercent: '-0.000001' }),
            message: 'priceTolerancePercent está fuera del rango o precisión permitidos',
        },
        {
            name: 'cantidad ordenada cero',
            input: () => validInput({
                orderLines: [{ id: 'po-line-1', orderedQuantity: '0', orderedUnitCost: '10' }],
            }),
            message: 'orderedQuantity:po-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'cantidad ordenada sobre máximo',
            input: () => validInput({
                orderLines: [{
                    id: 'po-line-1', orderedQuantity: '100000000000000', orderedUnitCost: '10',
                }],
            }),
            message: 'orderedQuantity:po-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'cantidad ordenada con 5dp',
            input: () => validInput({
                orderLines: [{ id: 'po-line-1', orderedQuantity: '1.00001', orderedUnitCost: '10' }],
            }),
            message: 'orderedQuantity:po-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'costo ordenado no finito',
            input: () => validInput({
                orderLines: [{ id: 'po-line-1', orderedQuantity: '10', orderedUnitCost: 'Infinity' }],
            }),
            message: 'orderedUnitCost:po-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'costo ordenado sobre máximo',
            input: () => validInput({
                orderLines: [{
                    id: 'po-line-1', orderedQuantity: '10', orderedUnitCost: '1000000000000',
                }],
            }),
            message: 'orderedUnitCost:po-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'costo ordenado con 7dp',
            input: () => validInput({
                orderLines: [{ id: 'po-line-1', orderedQuantity: '10', orderedUnitCost: '1.0000001' }],
            }),
            message: 'orderedUnitCost:po-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'cantidad aceptada cero',
            input: () => validInput({
                receiptLines: [{
                    id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1', acceptedQuantity: '0',
                    allocatedQuantity: '0', receivedAt: '2026-08-27T10:00:00.000Z',
                }],
            }),
            message: 'acceptedQuantity:receipt-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'cantidad asignada negativa',
            input: () => validInput({
                receiptLines: [{
                    id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1', acceptedQuantity: '1',
                    allocatedQuantity: '-0.0001', receivedAt: '2026-08-27T10:00:00.000Z',
                }],
            }),
            message: 'allocatedQuantity:receipt-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'cantidad facturada con 5dp',
            input: () => validInput({
                invoiceLines: [{
                    key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1',
                    quantity: '1.00001', unitCost: '10',
                }],
            }),
            message: 'invoiceQuantity:invoice-line-1 está fuera del rango o precisión permitidos',
        },
        {
            name: 'costo facturado cero',
            input: () => validInput({
                invoiceLines: [{
                    key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1', quantity: '1', unitCost: '0',
                }],
            }),
            message: 'invoiceUnitCost:invoice-line-1 está fuera del rango o precisión permitidos',
        },
    ])('rechaza $name sin coerción silenciosa', ({ input, message }) => {
        expectDomainError(() => calculateProcurementMatch(input()), {
            code: message.includes('no es') ? 'INVALID_MATCH_DECIMAL' : 'INVALID_MATCH_DECIMAL',
            status: 400,
            message,
        });
    });

    it('restaura precisión 40 y admite exactamente los máximos 18,4/18,6', () => {
        Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });
        const maximumQuantity = '99999999999999.9999';
        const maximumUnitCost = '999999999999.999999';
        const result = calculateProcurementMatch(validInput({
            orderLines: [{
                id: 'po-line-1',
                orderedQuantity: maximumQuantity,
                orderedUnitCost: maximumUnitCost,
            }],
            receiptLines: [{
                id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: maximumQuantity, allocatedQuantity: '0',
                receivedAt: new Date('2026-08-27T10:00:00.000Z'),
            }],
            invoiceLines: [{
                key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1',
                quantity: maximumQuantity, unitCost: maximumUnitCost,
            }],
        }));
        expect(result).toMatchObject({
            status: 'MATCHED',
            expectedAmount: '99999999999999999800000000.00',
            invoiceAmount: '99999999999999999800000000.00',
            varianceAmount: '0.00',
        });
    });

    it('restaura precisión aun si otro módulo redujo Decimal a 20 dígitos', () => {
        Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });
        const quantity = '99999999999999.9999';
        const unitCost = '123456789012.345678';
        const result = calculateProcurementMatch(validInput({
            orderLines: [{ id: 'po-line-1', orderedQuantity: quantity, orderedUnitCost: unitCost }],
            receiptLines: [{
                id: 'receipt-line-1', purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: quantity, allocatedQuantity: '0',
                receivedAt: '2026-08-27T10:00:00.000Z',
            }],
            invoiceLines: [{
                key: 'invoice-line-1', purchaseOrderItemId: 'po-line-1',
                quantity, unitCost,
            }],
        }));
        expect(result.expectedAmount).toBe('12345678901234567787654321.10');
        expect(result.invoiceAmount).toBe('12345678901234567787654321.10');
    });

    it('normaliza método con espacios/minúsculas y rechaza cualquier tercer método', () => {
        expect(calculateProcurementMatch(validInput({ paymentMethod: ' credit ' })).status).toBe('MATCHED');
        expectDomainError(() => calculateProcurementMatch(validInput({ paymentMethod: 'TRANSFER' })), {
            code: 'INVALID_MATCH_PAYMENT_METHOD',
            status: 400,
            message: 'La conciliación de OC solo admite compras CASH o CREDIT',
        });
    });

    it.each([
        { orderLines: [], invoiceLines: validInput().invoiceLines },
        { orderLines: validInput().orderLines, invoiceLines: [] },
    ])('exige por separado líneas de orden y factura', ({ orderLines, invoiceLines }) => {
        expectDomainError(() => calculateProcurementMatch(validInput({ orderLines, invoiceLines })), {
            code: 'EMPTY_MATCH_LINES',
            status: 400,
            message: 'La conciliación requiere líneas de orden y de factura',
        });
    });

    it('rechaza fecha de recepción inválida con error de conciliación', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            receiptLines: [{
                ...validInput().receiptLines[0],
                receivedAt: 'fecha-imposible',
            }],
        })), {
            code: 'INVALID_RECEIPT_DATE',
            status: 409,
            message: 'Una recepción aceptada tiene una fecha inválida y requiere conciliación',
        });
    });
});

describe('mutación: identidad durable, trazabilidad y asignación', () => {
    it('rechaza identidades de línea OC duplicadas', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            orderLines: [
                { id: 'po-line-1', orderedQuantity: '10', orderedUnitCost: '10' },
                { id: 'po-line-1', orderedQuantity: '2', orderedUnitCost: '11' },
            ],
        })), {
            code: 'DUPLICATE_ORDER_LINE', status: 409,
            message: 'La orden contiene una identidad de línea duplicada',
            details: { purchaseOrderItemId: 'po-line-1' },
        });
    });

    it('rechaza identidades de recepción duplicadas', () => {
        const receipt = validInput().receiptLines[0];
        expectDomainError(() => calculateProcurementMatch(validInput({
            receiptLines: [receipt, { ...receipt }],
        })), {
            code: 'DUPLICATE_RECEIPT_LINE', status: 409,
            message: 'La recepción contiene una identidad de línea duplicada',
            details: { goodsReceiptItemId: 'receipt-line-1' },
        });
    });

    it('rechaza una recepción de otra línea de OC', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            receiptLines: [{
                ...validInput().receiptLines[0], purchaseOrderItemId: 'po-line-other',
            }],
        })), {
            code: 'RECEIPT_OUTSIDE_PURCHASE_ORDER', status: 409,
            message: 'Una recepción aceptada no pertenece a una línea de esta orden',
            details: {
                goodsReceiptItemId: 'receipt-line-1', purchaseOrderItemId: 'po-line-other',
            },
        });
    });

    it.each([
        {
            name: 'formal sin id durable',
            receipt: {
                ...validInput().receiptLines[0], source: 'FORMAL_RECEIPT' as const,
                goodsReceiptItemId: null,
            },
        },
        {
            name: 'legacy con id formal',
            receipt: {
                ...validInput().receiptLines[0], source: 'LEGACY_PROJECTION' as const,
                goodsReceiptItemId: 'receipt-line-1',
            },
        },
    ])('rechaza fuente contradictoria: $name', ({ receipt }) => {
        expectDomainError(() => calculateProcurementMatch(validInput({ receiptLines: [receipt] })), {
            code: 'INVALID_RECEIPT_SOURCE', status: 409,
            message: 'La fuente de recepción no coincide con su trazabilidad persistida',
            details: { receiptLineId: 'receipt-line-1' },
        });
    });

    it('defaultea una recepción normal a FORMAL_RECEIPT con su id', () => {
        const result = calculateProcurementMatch(validInput());
        expect(result.lines[0].usesLegacyProjection).toBe(false);
        expect(result.allocations).toEqual([expect.objectContaining({
            goodsReceiptItemId: 'receipt-line-1', source: 'FORMAL_RECEIPT', quantity: '1.0000',
        })]);
    });

    it('rechaza una recepción sobreasignada con evidencia exacta', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            receiptLines: [{
                ...validInput().receiptLines[0], acceptedQuantity: '1', allocatedQuantity: '1.0001',
            }],
        })), {
            code: 'INVALID_RECEIPT_ALLOCATION', status: 409,
            message: 'Una recepción tiene más cantidad asignada que aceptada',
            details: { goodsReceiptItemId: 'receipt-line-1' },
        });
    });

    it('rechaza keys de factura duplicadas', () => {
        const invoice = validInput().invoiceLines[0];
        expectDomainError(() => calculateProcurementMatch(validInput({
            invoiceLines: [invoice, { ...invoice }],
        })), {
            code: 'DUPLICATE_INVOICE_LINE_KEY', status: 400,
            message: 'La factura contiene una identidad de línea duplicada',
            details: { invoiceLineKey: 'invoice-line-1' },
        });
    });

    it('rechaza una factura de otra línea de OC', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            invoiceLines: [{
                ...validInput().invoiceLines[0], purchaseOrderItemId: 'po-line-other',
            }],
        })), {
            code: 'INVOICE_LINE_OUTSIDE_PURCHASE_ORDER', status: 409,
            message: 'Una línea de factura no pertenece a esta orden de compra',
            details: {
                invoiceLineKey: 'invoice-line-1', purchaseOrderItemId: 'po-line-other',
            },
        });
    });

    it('ordena las líneas facturadas por key antes de consumir FIFO', () => {
        const result = calculateProcurementMatch(validInput({
            orderLines: [{ id: 'po-line-1', orderedQuantity: '2', orderedUnitCost: '10' }],
            receiptLines: [{
                ...validInput().receiptLines[0], acceptedQuantity: '2',
            }],
            invoiceLines: [
                { key: 'invoice-z', purchaseOrderItemId: 'po-line-1', quantity: '1', unitCost: '10' },
                { key: 'invoice-a', purchaseOrderItemId: 'po-line-1', quantity: '1', unitCost: '10' },
            ],
        }));
        expect(result.lines.map((line) => line.invoiceLineKey)).toEqual(['invoice-a', 'invoice-z']);
        expect(result.allocations.map((line) => line.invoiceLineKey)).toEqual(['invoice-a', 'invoice-z']);
    });

    it('rechaza cantidad recibida mayor que la orden con evidencia exacta', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            orderLines: [{ id: 'po-line-1', orderedQuantity: '1', orderedUnitCost: '10' }],
            receiptLines: [{
                ...validInput().receiptLines[0], acceptedQuantity: '1.0001',
            }],
        })), {
            code: 'RECEIPT_EXCEEDS_ORDERED_QUANTITY', status: 409,
            message: 'La cantidad aceptada excede la cantidad ordenada y requiere conciliación',
            details: { purchaseOrderItemId: 'po-line-1' },
        });
    });

    it('rechaza factura sobre disponibilidad con todas las cantidades exactas', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            receiptLines: [{
                ...validInput().receiptLines[0], acceptedQuantity: '2', allocatedQuantity: '0.5000',
            }],
            invoiceLines: [{
                ...validInput().invoiceLines[0], quantity: '1.5001',
            }],
        })), {
            code: 'INVOICE_EXCEEDS_ACCEPTED_QUANTITY', status: 409,
            message: 'La factura excede la mercadería aceptada y aún no facturada',
            details: {
                purchaseOrderItemId: 'po-line-1',
                acceptedQuantity: '2.0000',
                alreadyAllocatedQuantity: '0.5000',
                requestedQuantity: '1.5001',
            },
        });
    });

    it('no crea allocations cero después de completar la cantidad solicitada', () => {
        const result = calculateProcurementMatch(validInput({
            receiptLines: [
                { ...validInput().receiptLines[0], id: 'receipt-a', acceptedQuantity: '1' },
                { ...validInput().receiptLines[0], id: 'receipt-b', acceptedQuantity: '1' },
            ],
        }));
        expect(result.allocations).toEqual([expect.objectContaining({
            goodsReceiptItemId: 'receipt-a', quantity: '1.0000',
        })]);
    });

    it('omite una recepción sin disponibilidad y consume la siguiente', () => {
        const result = calculateProcurementMatch(validInput({
            receiptLines: [
                {
                    ...validInput().receiptLines[0], id: 'receipt-a',
                    acceptedQuantity: '1', allocatedQuantity: '1',
                },
                {
                    ...validInput().receiptLines[0], id: 'receipt-b',
                    acceptedQuantity: '1', allocatedQuantity: '0',
                },
            ],
        }));
        expect(result.allocations).toEqual([expect.objectContaining({
            goodsReceiptItemId: 'receipt-b', quantity: '1.0000',
        })]);
    });

    it('marca legacy si una línea mezcla recepción formal y proyección histórica', () => {
        const result = calculateProcurementMatch(validInput({
            orderLines: [{ id: 'po-line-1', orderedQuantity: '2', orderedUnitCost: '10' }],
            receiptLines: [
                {
                    ...validInput().receiptLines[0], id: 'receipt-formal',
                    acceptedQuantity: '1', source: 'FORMAL_RECEIPT',
                    goodsReceiptItemId: 'receipt-formal',
                },
                {
                    ...validInput().receiptLines[0], id: 'legacy:po-line-1',
                    acceptedQuantity: '1', source: 'LEGACY_PROJECTION',
                    goodsReceiptItemId: null,
                    receivedAt: '2026-08-27T11:00:00.000Z',
                },
            ],
            invoiceLines: [{
                ...validInput().invoiceLines[0], quantity: '2',
            }],
        }));
        expect(result.lines[0].usesLegacyProjection).toBe(true);
        expect(result.lines[0].allocations.map((line) => line.source)).toEqual([
            'FORMAL_RECEIPT', 'LEGACY_PROJECTION',
        ]);
        expect(result).toMatchObject({
            status: 'EXCEPTION', paymentHold: true,
            exceptionCodes: ['LEGACY_RECEIPT_TRACE'],
        });
    });

    it('devuelve mensajes estables para los dos rechazos CASH', () => {
        expectDomainError(() => calculateProcurementMatch(validInput({
            paymentMethod: 'CASH',
            receiptLines: [{
                ...validInput().receiptLines[0], source: 'LEGACY_PROJECTION',
                goodsReceiptItemId: null,
            }],
        })), {
            code: 'CASH_LEGACY_RECEIPT_TRACE_REQUIRES_RESOLUTION', status: 409,
            message: 'La compra de contado requiere una recepción formal antes de registrarse',
        });
        expectDomainError(() => calculateProcurementMatch(validInput({
            paymentMethod: 'CASH',
            invoiceLines: [{ ...validInput().invoiceLines[0], unitCost: '10.000001' }],
        })), {
            code: 'CASH_PRICE_VARIANCE_REQUIRES_RESOLUTION', status: 409,
            message: 'La compra de contado excede la tolerancia de precio y debe corregirse antes de registrarla',
        });
    });
});

describe('mutación: resolución idempotente', () => {
    it('rechaza purchaseId y clientEventId vacíos con el campo exacto', () => {
        expectDomainError(() => normalizeProcurementResolution(' ', {
            clientEventId: EVENT_ID, reason: 'abc',
        }), {
            code: 'INVALID_MATCH_INPUT', status: 400,
            message: 'purchaseId es obligatorio para conciliar la factura',
        });
        expectDomainError(() => normalizeProcurementResolution('purchase-1', {
            clientEventId: undefined as unknown as string, reason: 'abc',
        }), {
            code: 'INVALID_MATCH_INPUT', status: 400,
            message: 'clientEventId es obligatorio para conciliar la factura',
        });
    });

    it.each([
        `x${EVENT_ID}`,
        `${EVENT_ID}x`,
        '018f6d75-0d8c-0a7a-8b4b-e2b25a80eb12',
    ])('rechaza UUID no exacto: %s', (clientEventId) => {
        expectDomainError(() => normalizeProcurementResolution('purchase-1', {
            clientEventId, reason: 'abc',
        }), {
            code: 'INVALID_RESOLUTION_CLIENT_EVENT_ID', status: 400,
            message: 'clientEventId debe ser un UUID válido',
        });
    });

    it('acepta exactamente 3 y 1000 caracteres de razón', () => {
        expect(normalizeProcurementResolution('purchase-1', {
            clientEventId: EVENT_ID, reason: 'abc',
        }).reason).toBe('abc');
        expect(normalizeProcurementResolution('purchase-1', {
            clientEventId: EVENT_ID, reason: 'x'.repeat(1000),
        }).reason).toHaveLength(1000);
    });

    it.each([
        { reason: 'ab', label: '2 caracteres' },
        { reason: 'x'.repeat(1001), label: '1001 caracteres' },
        { reason: undefined as unknown as string, label: 'no string' },
    ])('rechaza reason de $label con código y mensaje estables', ({ reason }) => {
        expectDomainError(() => normalizeProcurementResolution('purchase-1', {
            clientEventId: EVENT_ID, reason,
        }), {
            code: 'INVALID_RESOLUTION_REASON', status: 400,
            message: 'reason debe contener entre 3 y 1000 caracteres',
        });
    });
});
