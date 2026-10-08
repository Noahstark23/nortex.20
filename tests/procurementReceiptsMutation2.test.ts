import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { QuantityValidationError } from '../utils/quantity';
import {
    normalizeProcurementReceiptLines,
    procurementReceiptPayloadVersion,
    ProcurementReceiptError,
    summarizeProcurementReceiptInspection,
} from '../backend/lib/procurementReceipts';

const EVENT_ID = '9b36c7e4-dc7e-41f3-a956-0d189d0ebc82';

const captureReceiptError = (action: () => unknown): ProcurementReceiptError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(ProcurementReceiptError);
        expect((error as ProcurementReceiptError).name).toBe('ProcurementReceiptError');
        return error as ProcurementReceiptError;
    }
    throw new Error('Se esperaba ProcurementReceiptError');
};

const expectReceiptError = (action: () => unknown, code: string, message: string): void => {
    expect(captureReceiptError(action)).toMatchObject({ code, httpStatus: 400, message });
};

describe('mutación F2B: esquema fresco de recepción inspeccionada', () => {
    it('revalúa schema y helpers concisos al cargar una instancia fresca', async () => {
        vi.resetModules();
        const fresh = await import('../backend/lib/procurementReceipts');
        const parsed = fresh.procurementReceiptRequestSchema.parse({
            clientEventId: EVENT_ID,
            warehouseId: ' warehouse-a ',
            supplierDeliveryRef: 'REF',
            items: [
                {
                    itemId: ' item-b ',
                    quantityReceived: ' 1 ',
                    quantityRejected: '0',
                    rejectionReasonCode: null,
                    rejectionNotes: '  ',
                    supplierFault: undefined,
                    batchNumber: 'L-2',
                },
                { itemId: 'item-a', quantityReceived: 2 },
            ],
        });
        expect(parsed).toMatchObject({
            warehouseId: 'warehouse-a',
            items: [{ itemId: 'item-b', quantityReceived: '1', rejectionNotes: '' }, {
                itemId: 'item-a', quantityReceived: 2,
            }],
        });
        const lines = fresh.normalizeProcurementReceiptLines(parsed.items);
        expect(lines.map(line => line.itemId)).toEqual(['item-a', 'item-b']);
        expect(fresh.procurementReceiptPayloadVersion(lines)).toBe(2);
        expect(fresh.sortProcurementReceiptExecutionLines([
            { ...lines[1], productId: 'product-b' },
            { ...lines[0], productId: 'product-a' },
        ]).map(line => line.productId)).toEqual(['product-a', 'product-b']);
    });

    it('protege límites y forma estricta en el schema fresco', async () => {
        vi.resetModules();
        const { procurementReceiptRequestSchema: schema } = await import('../backend/lib/procurementReceipts');
        const baseLine = {
            itemId: 'item-long',
            quantityReceived: '10',
            quantityRejected: '0',
            rejectionNotes: 'n',
            batchNumber: 'L',
            expiryDate: '2028-01-01',
        };
        expect(schema.safeParse({
            clientEventId: EVENT_ID,
            warehouseId: 'warehouse-long',
            supplierDeliveryRef: 'R',
            items: [baseLine, { ...baseLine, itemId: 'item-two' }],
        }).success).toBe(true);
        expect(schema.safeParse({
            clientEventId: EVENT_ID,
            warehouseId: 'w'.repeat(191),
            supplierDeliveryRef: 'r'.repeat(191),
            items: [{
                ...baseLine,
                itemId: 'i'.repeat(191),
                quantityReceived: `${'0'.repeat(63)}1`,
                rejectionNotes: 'n'.repeat(2_000),
                batchNumber: 'b'.repeat(100),
                expiryDate: 'e'.repeat(64),
            }],
        }).success).toBe(true);
        expect(schema.safeParse({
            clientEventId: EVENT_ID,
            items: Array.from({ length: 500 }, (_, index) => ({
                itemId: `item-${index}`,
                quantityReceived: '1',
            })),
        }).success).toBe(true);

        const invalid = [
            { clientEventId: EVENT_ID, items: [] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, quantityReceived: ' ' }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, quantityReceived: '1'.repeat(65) }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, itemId: ' ' }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, itemId: 'i'.repeat(192) }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, rejectionNotes: 'n'.repeat(2_001) }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, batchNumber: 'b'.repeat(101) }] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, expiryDate: 'e'.repeat(65) }] },
            { clientEventId: EVENT_ID, warehouseId: 'w'.repeat(192), items: [baseLine] },
            { clientEventId: EVENT_ID, supplierDeliveryRef: 'r'.repeat(192), items: [baseLine] },
            { clientEventId: EVENT_ID, items: [{ ...baseLine, tenantId: 'forjado' }] },
            { clientEventId: EVENT_ID, tenantId: 'forjado', items: [baseLine] },
            { clientEventId: EVENT_ID, items: [{}] },
            { clientEventId: EVENT_ID, items: Array.from({ length: 501 }, (_, index) => ({
                itemId: `item-${index}`,
                quantityReceived: '1',
            })) },
        ];
        for (const payload of invalid) expect(schema.safeParse(payload).success).toBe(false);
    });
});

describe('mutación F2B: inspección y cantidades exactas', () => {
    it('normaliza nota recortada y vacía sin inventar rechazo', () => {
        const withNote = normalizeProcurementReceiptLines([{
            itemId: 'item-a',
            quantityReceived: '1',
            quantityRejected: '0',
            rejectionNotes: '  ',
        }]);
        const withTrimmedNote = normalizeProcurementReceiptLines([{
            itemId: 'item-a',
            quantityReceived: '1',
            quantityRejected: '0.5',
            rejectionReasonCode: 'QUALITY',
            rejectionNotes: '  Sello roto  ',
            supplierFault: false,
        }]);
        expect(withNote[0].rejectionNotes).toBeNull();
        expect(withTrimmedNote[0].rejectionNotes).toBe('Sello roto');
    });

    it('acepta cero textual con espacios sin perder la rama no negativa', () => {
        expect(normalizeProcurementReceiptLines([{
            itemId: 'item-a',
            quantityReceived: ' 0 ',
            quantityRejected: ' 1 ',
            rejectionReasonCode: 'DAMAGE',
            supplierFault: true,
        }])[0]).toMatchObject({
            quantity: '0',
            deliveredQuantity: '1',
            rejectedQuantity: '1',
        });
    });

    it('no confunde el código ni la clase de un error del parser', () => {
        const wrongCode = new QuantityValidationError('TOO_MANY_DECIMALS', 'fallo inyectado');
        const isFinite = vi.spyOn(Decimal.prototype, 'isFinite').mockImplementationOnce(() => {
            throw wrongCode;
        });
        try {
            expect(captureReceiptError(() => normalizeProcurementReceiptLines([{
                itemId: 'item-a', quantityReceived: '0',
            }]))).toMatchObject({ code: 'TOO_MANY_DECIMALS', message: 'fallo inyectado' });
        } finally {
            isFinite.mockRestore();
        }

        const sentinel = Object.assign(new Error('sentinel-receipt'), {
            code: 'NON_POSITIVE_QUANTITY',
        });
        const greaterThan = vi.spyOn(Decimal.prototype, 'greaterThan').mockReturnValueOnce(true);
        const decimalPlaces = vi.spyOn(Decimal.prototype, 'decimalPlaces').mockImplementationOnce(() => {
            throw sentinel;
        });
        try {
            expect(() => normalizeProcurementReceiptLines([{
                itemId: 'item-a', quantityReceived: '0',
            }])).toThrow(sentinel);
        } finally {
            greaterThan.mockRestore();
            decimalPlaces.mockRestore();
        }
    });

    it.each([
        {
            title: 'entregado cero',
            line: { itemId: 'item-a', quantityReceived: 0 },
            code: 'NON_POSITIVE_DELIVERED_QUANTITY',
            message: 'La cantidad entregada debe ser mayor que cero',
        },
        {
            title: 'rechazo sin motivo',
            line: { itemId: 'item-a', quantityReceived: 0, quantityRejected: 1, supplierFault: true },
            code: 'REJECTION_REASON_REQUIRED',
            message: 'Seleccioná el motivo de rechazo de la mercadería',
        },
        {
            title: 'rechazo sin responsabilidad',
            line: {
                itemId: 'item-a', quantityReceived: 0, quantityRejected: 1,
                rejectionReasonCode: 'DAMAGE',
            },
            code: 'SUPPLIER_FAULT_REQUIRED',
            message: 'Indicá si el rechazo es responsabilidad del proveedor',
        },
        {
            title: 'motivo sin rechazo',
            line: {
                itemId: 'item-a', quantityReceived: 1, quantityRejected: 0,
                rejectionReasonCode: 'DAMAGE',
            },
            code: 'REJECTION_DETAILS_WITHOUT_QUANTITY',
            message: 'No agregués motivo, nota ni responsabilidad si no hay cantidad rechazada',
        },
        {
            title: 'nota sin rechazo',
            line: {
                itemId: 'item-a', quantityReceived: 1, quantityRejected: 0,
                rejectionNotes: 'nota',
            },
            code: 'REJECTION_DETAILS_WITHOUT_QUANTITY',
            message: 'No agregués motivo, nota ni responsabilidad si no hay cantidad rechazada',
        },
        {
            title: 'responsabilidad sin rechazo',
            line: {
                itemId: 'item-a', quantityReceived: 1, quantityRejected: 0,
                supplierFault: false,
            },
            code: 'REJECTION_DETAILS_WITHOUT_QUANTITY',
            message: 'No agregués motivo, nota ni responsabilidad si no hay cantidad rechazada',
        },
    ])('conserva diagnóstico para $title', ({ line, code, message }) => {
        expectReceiptError(() => normalizeProcurementReceiptLines([line] as never), code, message);
    });

    it('identifica v2 si una sola línea trae cada campo explícito de inspección', () => {
        for (const explicit of [
            { quantityRejected: 0 },
            { rejectionReasonCode: null },
            { rejectionNotes: undefined },
            { supplierFault: undefined },
        ]) {
            const lines = normalizeProcurementReceiptLines([{
                itemId: 'item-a', quantityReceived: 1, ...explicit,
            }]);
            expect(procurementReceiptPayloadVersion(lines)).toBe(2);
            expect(lines[0]).toHaveProperty('rejectedQuantity');
        }
    });

    it('distingue payload mixto y los tres resultados de inspección', () => {
        const legacy = normalizeProcurementReceiptLines([{ itemId: 'legacy', quantityReceived: 1 }]);
        const accepted = normalizeProcurementReceiptLines([{
            itemId: 'accepted', quantityReceived: 1, quantityRejected: 0,
        }]);
        const rejected = normalizeProcurementReceiptLines([{
            itemId: 'rejected', quantityReceived: 0, quantityRejected: 1,
            rejectionReasonCode: 'DAMAGE', supplierFault: true,
        }]);
        expect(procurementReceiptPayloadVersion([...legacy, ...accepted])).toBe(2);
        expect(summarizeProcurementReceiptInspection(accepted).inspectionOutcome).toBe('FULL_ACCEPT');
        expect(summarizeProcurementReceiptInspection(rejected)).toMatchObject({
            inspectionOutcome: 'FULL_REJECT',
            rejectedLineCount: 1,
            hasSupplierFault: true,
        });
        expect(summarizeProcurementReceiptInspection([...accepted, ...rejected]).inspectionOutcome)
            .toBe('PARTIAL_REJECT');
    });
});
