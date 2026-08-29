import { describe, expect, it } from 'vitest';
import {
    assertMatchingProcurementReceiptReplay,
    buildProcurementReceiptPayloadHash,
    normalizeProcurementReceiptLines,
    procurementReceiptPayloadVersion,
    procurementReceiptRequestSchema,
    ProcurementReceiptError,
    sortProcurementReceiptExecutionLines,
    summarizeProcurementReceiptInspection,
    type CanonicalProcurementReceiptLine,
    type ProcurementReceiptRequest,
} from '../backend/lib/procurementReceipts';

const CLIENT_EVENT_ID = '9b36c7e4-dc7e-41f3-a956-0d189d0ebc82';

const request = (items: Array<Record<string, unknown>>) => procurementReceiptRequestSchema.parse({
    clientEventId: CLIENT_EVENT_ID,
    warehouseId: ' warehouse-1 ',
    items,
});

const captureReceiptError = (action: () => unknown): ProcurementReceiptError => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(ProcurementReceiptError);
        expect((error as Error).name).toBe('ProcurementReceiptError');
        return error as ProcurementReceiptError;
    }
    throw new Error('Se esperaba ProcurementReceiptError');
};

describe('contrato puro de recepciones de compras', () => {
    it('exige UUID, rechaza tenant del cliente y limita la forma del payload', () => {
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: 'no-es-uuid',
            items: [{ itemId: 'item-1', quantityReceived: '1' }],
        }).success).toBe(false);
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            tenantId: 'tenant-forjado',
            items: [{ itemId: 'item-1', quantityReceived: '1' }],
        }).success).toBe(false);
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            items: [],
        }).success).toBe(false);
    });

    it('canoniza identificadores y cantidades en el borde del contrato Zod', () => {
        const parsed = procurementReceiptRequestSchema.parse({
            clientEventId: CLIENT_EVENT_ID,
            warehouseId: ' warehouse-1 ',
            supplierDeliveryRef: 'R',
            items: [{ itemId: ' item-1 ', quantityReceived: ' 1.2500 ' }],
        });

        expect(parsed).toEqual({
            clientEventId: CLIENT_EVENT_ID,
            warehouseId: 'warehouse-1',
            supplierDeliveryRef: 'R',
            items: [{ itemId: 'item-1', quantityReceived: '1.2500' }],
        });

        const maxIdentifier = 'i'.repeat(191);
        const maxReference = 'r'.repeat(191);
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            warehouseId: maxIdentifier,
            supplierDeliveryRef: maxReference,
            items: [{ itemId: maxIdentifier, quantityReceived: 1 }],
        }).success).toBe(true);
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            warehouseId: `${maxIdentifier}x`,
            supplierDeliveryRef: `${maxReference}x`,
            items: [{ itemId: `${maxIdentifier}x`, quantityReceived: 1 }],
        }).success).toBe(false);
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            items: [{ itemId: 'item-1', quantityReceived: Number.POSITIVE_INFINITY }],
        }).success).toBe(false);
    });

    it('acepta como máximo 500 líneas y rechaza claves extra dentro de una línea', () => {
        const line = { itemId: 'item-1', quantityReceived: '1' };
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            items: Array.from({ length: 500 }, () => line),
        }).success).toBe(true);
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            items: Array.from({ length: 501 }, () => line),
        }).success).toBe(false);
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            items: [{ ...line, tenantId: 'tenant-forjado' }],
        }).success).toBe(false);
    });

    it('canoniza Decimal, lote, fecha y el orden del payload', () => {
        const first = normalizeProcurementReceiptLines(request([
            {
                itemId: ' item-b ',
                quantityReceived: '2.5000',
                batchNumber: ' L-02 ',
                expiryDate: '2027-08-12T18:30:00-06:00',
            },
            { itemId: 'item-a', quantityReceived: '1.2300', batchNumber: '' },
        ]).items);
        const reordered = normalizeProcurementReceiptLines(request([
            { itemId: 'item-a', quantityReceived: 1.23, batchNumber: null },
            {
                itemId: 'item-b',
                quantityReceived: '2.5',
                batchNumber: 'L-02',
                expiryDate: '2027-08-12',
            },
        ]).items);

        expect(first).toEqual([
            { itemId: 'item-a', quantity: '1.23', batchNumber: null, expiryDate: null },
            { itemId: 'item-b', quantity: '2.5', batchNumber: 'L-02', expiryDate: '2027-08-12' },
        ]);
        expect(reordered).toEqual(first);
        expect(buildProcurementReceiptPayloadHash({
            tenantId: 'tenant-1',
            purchaseOrderId: 'po-1',
            warehouseId: 'warehouse-1',
            lines: first,
        })).toBe(buildProcurementReceiptPayloadHash({
            tenantId: ' tenant-1 ',
            purchaseOrderId: ' po-1 ',
            warehouseId: ' warehouse-1 ',
            lines: [...reordered].reverse(),
        }));
    });

    it('normaliza espacios sin perder precisión y conserva la fecha civil impresa', () => {
        const normalized = normalizeProcurementReceiptLines([
            {
                itemId: ' item-c ',
                quantityReceived: '0.1000',
                batchNumber: ' L-03 ',
                expiryDate: ' 2027-08-12T18:30:00.12Z ',
            },
            {
                itemId: 'item-d',
                quantityReceived: 0.2,
                batchNumber: '   ',
                expiryDate: '   ',
            },
            {
                itemId: 'item-e',
                quantityReceived: '1',
                expiryDate: '1000-01-01',
            },
        ]);

        expect(normalized).toEqual([
            { itemId: 'item-c', quantity: '0.1', batchNumber: 'L-03', expiryDate: '2027-08-12' },
            { itemId: 'item-d', quantity: '0.2', batchNumber: null, expiryDate: null },
            { itemId: 'item-e', quantity: '1', batchNumber: null, expiryDate: '1000-01-01' },
        ]);
    });

    it('incluye tenant, OC y bodega en la huella canónica', () => {
        const lines = normalizeProcurementReceiptLines(request([
            { itemId: 'item-a', quantityReceived: '1' },
        ]).items);
        const hash = (tenantId: string, purchaseOrderId: string, warehouseId: string) =>
            buildProcurementReceiptPayloadHash({ tenantId, purchaseOrderId, warehouseId, lines });

        expect(hash('tenant-1', 'po-1', 'warehouse-1')).not.toBe(hash('tenant-2', 'po-1', 'warehouse-1'));
        expect(hash('tenant-1', 'po-1', 'warehouse-1')).not.toBe(hash('tenant-1', 'po-2', 'warehouse-1'));
        expect(hash('tenant-1', 'po-1', 'warehouse-1')).not.toBe(hash('tenant-1', 'po-1', 'warehouse-2'));
        expect(buildProcurementReceiptPayloadHash({
            tenantId: 'tenant-1',
            purchaseOrderId: 'po-1',
            warehouseId: 'warehouse-1',
            supplierDeliveryRef: 'REM-1',
            lines,
        })).not.toBe(hash('tenant-1', 'po-1', 'warehouse-1'));
    });

    it('produce una huella oro independiente del orden, incluyendo lote y vencimiento', () => {
        const lines: CanonicalProcurementReceiptLine[] = [
            { itemId: 'item-b', quantity: '4', batchNumber: null, expiryDate: null },
            { itemId: 'item-a', quantity: '3', batchNumber: 'L-1', expiryDate: null },
            { itemId: 'item-a', quantity: '2', batchNumber: null, expiryDate: '2028-01-01' },
            { itemId: 'item-a', quantity: '1', batchNumber: null, expiryDate: null },
        ];
        const hash = (candidateLines: CanonicalProcurementReceiptLine[], supplierDeliveryRef?: string | null) =>
            buildProcurementReceiptPayloadHash({
                tenantId: ' tenant-1 ',
                purchaseOrderId: ' po-1 ',
                warehouseId: ' warehouse-1 ',
                supplierDeliveryRef,
                lines: candidateLines,
            });

        expect(hash(lines, ' REM-1 ')).toBe(
            '64261116ceda037b9ee1be69b288be9a99367b2597f8628fa341b63c9ac5da7a',
        );
        expect(hash([...lines].reverse(), 'REM-1')).toBe(hash(lines, ' REM-1 '));
        expect(hash(lines, undefined)).toBe(hash(lines, null));
        expect(hash(lines, '   ')).toBe(hash(lines, null));
        expect(hash(lines.map((line, index) => index === 0 ? { ...line, quantity: '5' } : line), 'REM-1'))
            .not.toBe(hash(lines, 'REM-1'));
    });

    it('preserva v1 y canoniza una inspección v2 con Decimal de 0.0001', () => {
        const legacyLines = normalizeProcurementReceiptLines(request([
            { itemId: 'item-a', quantityReceived: '1.2500' },
        ]).items);
        const inspectedLines = normalizeProcurementReceiptLines(request([
            {
                itemId: 'item-b',
                quantityReceived: '0',
                quantityRejected: '0.0001',
                rejectionReasonCode: 'QUALITY',
                rejectionNotes: '  Sello roto  ',
                supplierFault: true,
            },
            {
                itemId: 'item-a',
                quantityReceived: '1.2500',
                quantityRejected: 0,
            },
        ]).items);

        expect(procurementReceiptPayloadVersion(legacyLines)).toBe(1);
        expect(procurementReceiptPayloadVersion(inspectedLines)).toBe(2);
        expect(inspectedLines).toEqual([
            {
                itemId: 'item-a',
                quantity: '1.25',
                batchNumber: null,
                expiryDate: null,
                deliveredQuantity: '1.25',
                rejectedQuantity: '0',
                rejectionReasonCode: null,
                rejectionNotes: null,
                supplierFault: null,
            },
            {
                itemId: 'item-b',
                quantity: '0',
                batchNumber: null,
                expiryDate: null,
                deliveredQuantity: '0.0001',
                rejectedQuantity: '0.0001',
                rejectionReasonCode: 'QUALITY',
                rejectionNotes: 'Sello roto',
                supplierFault: true,
            },
        ]);
        expect(summarizeProcurementReceiptInspection(inspectedLines)).toEqual({
            payloadVersion: 2,
            inspectionOutcome: 'PARTIAL_REJECT',
            inspectedLineCount: 2,
            rejectedLineCount: 1,
            hasSupplierFault: true,
        });
        expect(summarizeProcurementReceiptInspection(legacyLines)).toEqual({
            payloadVersion: 1,
            inspectionOutcome: 'FULL_ACCEPT',
            inspectedLineCount: 1,
            rejectedLineCount: 0,
            hasSupplierFault: false,
        });
    });

    it('produce una huella v2 oro estable y sensible a cada campo de inspección', () => {
        const first = normalizeProcurementReceiptLines(request([
            {
                itemId: 'item-b',
                quantityReceived: '0',
                quantityRejected: '2.5000',
                rejectionReasonCode: 'DAMAGE',
                rejectionNotes: '  Caja rota ',
                supplierFault: true,
            },
            {
                itemId: 'item-a',
                quantityReceived: '1.5000',
                quantityRejected: '0.5000',
                rejectionReasonCode: 'QUALITY',
                supplierFault: false,
                batchNumber: ' L-01 ',
                expiryDate: '2028-02-29T18:00:00-06:00',
            },
        ]).items);
        const equivalent = normalizeProcurementReceiptLines(request([
            {
                itemId: 'item-a',
                quantityReceived: 1.5,
                quantityRejected: 0.5,
                rejectionReasonCode: 'QUALITY',
                supplierFault: false,
                batchNumber: 'L-01',
                expiryDate: '2028-02-29',
            },
            {
                itemId: 'item-b',
                quantityReceived: 0,
                quantityRejected: 2.5,
                rejectionReasonCode: 'DAMAGE',
                rejectionNotes: 'Caja rota',
                supplierFault: true,
            },
        ]).items);
        const hash = (lines: CanonicalProcurementReceiptLine[]) => buildProcurementReceiptPayloadHash({
            tenantId: 'tenant-1',
            purchaseOrderId: 'po-1',
            warehouseId: 'warehouse-1',
            supplierDeliveryRef: 'REM-2',
            lines,
        });

        expect(hash(first)).toBe(hash(equivalent));
        expect(hash(first)).toBe('0383663d7b35dbbb2e3df9d814892eaf7a4db58dab81292cb9e6f12437b70d6c');
        expect(hash(first.map((line, index) => index === 0
            ? { ...line, supplierFault: true }
            : line))).not.toBe(hash(first));
        expect(hash(first.map((line, index) => index === 1
            ? { ...line, rejectionNotes: 'Otro daño' }
            : line))).not.toBe(hash(first));
    });

    it('rechaza inspecciones vacías o combinaciones engañosas de rechazo', () => {
        const cases: Array<{
            line: Record<string, unknown>;
            code: string;
        }> = [
            {
                line: { itemId: 'item-a', quantityReceived: 0 },
                code: 'NON_POSITIVE_DELIVERED_QUANTITY',
            },
            {
                line: { itemId: 'item-a', quantityReceived: 0, quantityRejected: 1, supplierFault: true },
                code: 'REJECTION_REASON_REQUIRED',
            },
            {
                line: {
                    itemId: 'item-a',
                    quantityReceived: 0,
                    quantityRejected: 1,
                    rejectionReasonCode: 'DAMAGE',
                },
                code: 'SUPPLIER_FAULT_REQUIRED',
            },
            {
                line: {
                    itemId: 'item-a',
                    quantityReceived: 1,
                    quantityRejected: 0,
                    rejectionReasonCode: 'DAMAGE',
                    supplierFault: false,
                },
                code: 'REJECTION_DETAILS_WITHOUT_QUANTITY',
            },
            {
                line: { itemId: 'item-a', quantityReceived: 1, quantityRejected: '-0.0001' },
                code: 'NON_POSITIVE_QUANTITY',
            },
        ];

        for (const candidate of cases) {
            const parsed = request([candidate.line]);
            expect(captureReceiptError(() => normalizeProcurementReceiptLines(parsed.items)).code)
                .toBe(candidate.code);
        }
        expect(procurementReceiptRequestSchema.safeParse({
            clientEventId: CLIENT_EVENT_ID,
            items: [{
                itemId: 'item-a',
                quantityReceived: 0,
                quantityRejected: 1,
                rejectionReasonCode: 'INVENTADO',
                supplierFault: true,
            }],
        }).success).toBe(false);
    });

    it('rechaza formatos, horas, calendarios y años incompatibles con MySQL', () => {
        const invalidFormats = [
            'x2027-08-12',
            '2027-08-12x',
            'x2027-08-12T18:30:00Z',
            '2027-08-12T18:30:00Zx',
            '2027-08-12T18:30:00.xZ',
            '2027-08-12T18:30:00',
        ];
        for (const expiryDate of invalidFormats) {
            const error = captureReceiptError(() => normalizeProcurementReceiptLines([
                { itemId: 'item-a', quantityReceived: '1', expiryDate },
            ]));
            expect(error).toMatchObject({
                code: 'INVALID_EXPIRY_DATE',
                httpStatus: 400,
                message: 'La fecha de vencimiento debe ser una fecha civil o incluir zona horaria',
            });
        }

        for (const expiryDate of ['2027-02-30', '2027-08-12T99:99:99Z', '0999-12-31']) {
            const error = captureReceiptError(() => normalizeProcurementReceiptLines([
                { itemId: 'item-a', quantityReceived: '1', expiryDate },
            ]));
            expect(error).toMatchObject({
                code: 'INVALID_EXPIRY_DATE',
                httpStatus: 400,
                message: 'La fecha de vencimiento no es válida',
            });
        }
    });

    it('traduce errores de cantidad y preserva fallos inesperados sin ocultarlos', () => {
        const duplicateError = captureReceiptError(() => normalizeProcurementReceiptLines([
            { itemId: 'item-a', quantityReceived: '1', batchNumber: 'L-01', expiryDate: '2028-01-01' },
            { itemId: ' item-a ', quantityReceived: '2', batchNumber: 'L-02', expiryDate: '2028-02-01' },
        ]));
        expect(duplicateError).toMatchObject({
            code: 'DUPLICATE_ITEM',
            httpStatus: 400,
            message: 'Una línea de la OC solo puede aparecer una vez por comprobante; registrá cada lote en una recepción separada',
        });

        const quantityError = captureReceiptError(() => normalizeProcurementReceiptLines(request([
            { itemId: 'item-a', quantityReceived: '0.00001' },
        ]).items));
        expect(quantityError).toMatchObject({
            code: 'TOO_MANY_DECIMALS',
            httpStatus: 400,
            message: 'La cantidad admite como máximo 4 decimales',
        });

        const unexpected = new Error('fallo inesperado de lectura');
        const poisonedLines = [{
            itemId: 'item-a',
            get quantityReceived(): string {
                throw unexpected;
            },
        }] as ProcurementReceiptRequest['items'];
        let caught: unknown;
        try {
            normalizeProcurementReceiptLines(poisonedLines);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBe(unexpected);
    });

    it('distingue replay exacto de conflicto y conserva el error público', () => {
        const replayError = captureReceiptError(() =>
            assertMatchingProcurementReceiptReplay({ payloadHash: 'otro' }, 'esperado'));
        expect(replayError).toMatchObject({
            code: 'RECEIPT_IDEMPOTENCY_CONFLICT',
            httpStatus: 409,
            message: 'clientEventId ya fue usado con una recepción distinta',
        });

        expect(() => assertMatchingProcurementReceiptReplay({ payloadHash: 'mismo' }, 'mismo')).not.toThrow();
        expect(() => assertMatchingProcurementReceiptReplay({ payloadHash: null }, 'mismo'))
            .toThrowError(ProcurementReceiptError);
    });

    it('ordena locks por producto, lote e ítem sin colapsar dos líneas del mismo SKU', () => {
        const lines = [
            { productId: 'product-b', itemId: 'item-a', quantity: '1', batchNumber: null, expiryDate: null },
            { productId: 'product-a', itemId: 'item-z', quantity: '1', batchNumber: 'L-2', expiryDate: null },
            { productId: 'product-a', itemId: 'item-y', quantity: '2', batchNumber: null, expiryDate: null },
            { productId: 'product-a', itemId: 'item-x', quantity: '3', batchNumber: null, expiryDate: null },
            { productId: 'product-a', itemId: 'item-w', quantity: '4', batchNumber: 'L-1', expiryDate: null },
        ];
        const originalOrder = lines.map(line => line.itemId);
        const sorted = sortProcurementReceiptExecutionLines(lines);

        expect(sorted.map(line => `${line.productId}:${line.batchNumber ?? '-'}:${line.itemId}`)).toEqual([
            'product-a:-:item-x',
            'product-a:-:item-y',
            'product-a:L-1:item-w',
            'product-a:L-2:item-z',
            'product-b:-:item-a',
        ]);
        expect(lines.map(line => line.itemId)).toEqual(originalOrder);
        expect(sorted).toHaveLength(5);
    });
});
