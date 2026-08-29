import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    assertSupplierReturnBatchLedgerResults,
    assertSupplierReturnReplay,
    buildSupplierReturnCommandId,
    buildSupplierReturnPayloadHash,
    buildSupplierReturnSourceHash,
    normalizeSupplierReturnCommand,
    parseSupplierReturnStoredResult,
    planSupplierReturnPosting,
    serializeSupplierReturnStoredResult,
    SupplierReturnError,
    type CanonicalSupplierReturnCommand,
    type SupplierReturnCommandInput,
    type SupplierReturnSourceEvidence,
    type SupplierReturnStoredResult,
} from '../backend/lib/supplierReturns';

const EVENT_ID = '018f2f89-6f3f-7ca1-8a00-123456789abc';

const commandInput = (overrides: Partial<SupplierReturnCommandInput> = {}): SupplierReturnCommandInput => ({
    tenantId: ' tenant-1 ',
    userId: ' user-1 ',
    supplierId: ' supplier-1 ',
    clientEventId: EVENT_ID.toUpperCase(),
    reasonCode: 'QUALITY',
    reason: ' Calidad fuera de especificación ',
    supplierReference: ' DEV-001 ',
    lines: [
        { sourceType: 'PURCHASE_MATCH_ALLOCATION', purchaseMatchAllocationId: 'allocation-1', quantity: '4' },
        { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-1', quantity: ' 2.0000 ' },
        { sourceType: 'GOODS_RECEIPT_UNMATCHED', goodsReceiptItemId: 'receipt-item-1', quantity: '3' },
    ],
    ...overrides,
});

const canonicalCommand = (overrides: Partial<SupplierReturnCommandInput> = {}): CanonicalSupplierReturnCommand =>
    normalizeSupplierReturnCommand(commandInput(overrides));

const sourceEvidence = (overrides: Partial<SupplierReturnSourceEvidence> = {}): SupplierReturnSourceEvidence => ({
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    sourceType: 'DIRECT_PURCHASE_ITEM',
    sourceId: 'purchase-item-1',
    sourceStatus: 'POSTED',
    productId: 'product-2',
    warehouseId: 'warehouse-1',
    batchId: 'batch-1',
    availableToReturnExact: '5.0000',
    bookUnitCostExact: '12.000000',
    descriptionAtReturn: 'Carne de res',
    unitAtReturn: 'LB',
    saleModeAtReturn: 'MEASURED',
    quantityStepAtReturn: '0.0001',
    batchNumberAtReturn: 'LOT-1',
    expiryDateAtReturn: '2026-09-30',
    requiresBatchTracking: true,
    hasSerialTracking: false,
    hasShadowGap: false,
    purchaseId: 'purchase-1',
    sourcePurchaseItemId: 'purchase-item-1',
    purchaseMatchAllocationId: null,
    inventoryWarehouseId: 'warehouse-1',
    inventoryBatchId: 'batch-1',
    inventoryUnitCostExact: '10.000000',
    ...overrides,
});

const evidenceForCommand = (): SupplierReturnSourceEvidence[] => [
    sourceEvidence(),
    sourceEvidence({
        sourceType: 'GOODS_RECEIPT_UNMATCHED',
        sourceId: 'receipt-item-1',
        productId: 'product-1',
        batchId: null,
        availableToReturnExact: '8.0000',
        requiresBatchTracking: false,
        purchaseId: null,
        sourcePurchaseItemId: null,
        inventoryWarehouseId: undefined,
        inventoryBatchId: undefined,
        inventoryUnitCostExact: undefined,
        physicalReceiptItemId: 'receipt-item-1',
        physicalAcceptedQuantityExact: '10.0000',
        physicalPreviouslyReturnedExact: '2.0000',
    }),
    sourceEvidence({
        sourceType: 'PURCHASE_MATCH_ALLOCATION',
        sourceId: 'allocation-1',
        productId: 'product-1',
        batchId: null,
        availableToReturnExact: '4.0000',
        requiresBatchTracking: false,
        purchaseId: 'purchase-1',
        sourcePurchaseItemId: 'purchase-item-2',
        purchaseMatchAllocationId: 'allocation-1',
        inventoryWarehouseId: undefined,
        inventoryBatchId: undefined,
        inventoryUnitCostExact: undefined,
        physicalReceiptItemId: 'receipt-item-1',
        physicalAcceptedQuantityExact: '10.0000',
        physicalPreviouslyReturnedExact: '2.0000',
    }),
];

const expectReturnError = (
    operation: () => unknown,
    code: SupplierReturnError['code'],
    httpStatus: SupplierReturnError['httpStatus'],
    message?: string,
): SupplierReturnError => {
    try {
        operation();
    } catch (error) {
        expect(error).toBeInstanceOf(SupplierReturnError);
        expect(error).toMatchObject({ name: 'SupplierReturnError', code, httpStatus });
        if (message !== undefined) expect((error as SupplierReturnError).message).toBe(message);
        return error as SupplierReturnError;
    }
    throw new Error('Se esperaba SupplierReturnError');
};

describe('comando puro de devolución a proveedor', () => {
    it('canoniza UUID, contexto, textos, cantidad, orden y unión discriminada', () => {
        const command = canonicalCommand();
        expect(command).toMatchObject({
            version: 1,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            clientEventId: EVENT_ID,
            reasonCode: 'QUALITY',
            reason: 'Calidad fuera de especificación',
            supplierReference: 'DEV-001',
        });
        expect(command.lines.map((line) => [line.sourceType, line.sourceId, line.quantity])).toEqual([
            ['DIRECT_PURCHASE_ITEM', 'purchase-item-1', '2.0000'],
            ['GOODS_RECEIPT_UNMATCHED', 'receipt-item-1', '3.0000'],
            ['PURCHASE_MATCH_ALLOCATION', 'allocation-1', '4.0000'],
        ]);
        expect(command.lines.every((line) => /^[a-f0-9]{64}$/u.test(line.sourceHash))).toBe(true);
    });

    it('crea identidad tenant-scoped; UUID y actor no cambian la huella económica', () => {
        const base = canonicalCommand();
        const otherActor = canonicalCommand({ userId: 'user-2' });
        const otherEvent = canonicalCommand({ clientEventId: '018f2f89-6f3f-7ca1-8a00-123456789abd' });
        expect(buildSupplierReturnPayloadHash(otherActor)).toBe(buildSupplierReturnPayloadHash(base));
        expect(buildSupplierReturnPayloadHash(otherEvent)).toBe(buildSupplierReturnPayloadHash(base));
        expect(buildSupplierReturnCommandId(otherEvent)).not.toBe(buildSupplierReturnCommandId(base));
        expect(buildSupplierReturnPayloadHash(canonicalCommand({ reason: 'Otro motivo económico' })))
            .not.toBe(buildSupplierReturnPayloadHash(base));
        expect(buildSupplierReturnSourceHash({
            tenantId: 'tenant-2', sourceType: 'DIRECT_PURCHASE_ITEM', sourceId: 'purchase-item-1',
        })).not.toBe(base.lines[0].sourceHash);
    });

    it('normaliza referencia nula o vacía y acepta los límites exactos', () => {
        expect(canonicalCommand({ supplierReference: null }).supplierReference).toBeNull();
        expect(canonicalCommand({ supplierReference: '   ' }).supplierReference).toBeNull();
        expect(canonicalCommand({
            tenantId: `t${'a'.repeat(190)}`,
            reason: 'r'.repeat(1_000),
            supplierReference: 's'.repeat(191),
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '99999999999999.9999' }],
        })).toMatchObject({ reason: 'r'.repeat(1_000), supplierReference: 's'.repeat(191) });
    });

    it.each([
        ['tenant no texto', { tenantId: null }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['UUID inválido', { clientEventId: 'not-uuid' }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['reasonCode inválido', { reasonCode: 'INVENTED' }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['reason no texto', { reason: null }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['reason corto', { reason: 'ab' }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['reason largo', { reason: 'a'.repeat(1_001) }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['reference no texto', { supplierReference: 2 }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['sin líneas', { lines: [] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['línea primitiva', { lines: [null] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['source inválido', { lines: [{ sourceType: 'X', purchaseItemId: 'p', quantity: '1' }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['cantidad Number', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: 1 }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['cantidad cero', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '0' }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['cantidad exponencial', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '1e2' }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['cantidad con 5 decimales', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '0.00001' }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['cantidad overflow', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '100000000000000' }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['fuentes mezcladas', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', goodsReceiptItemId: 'g', quantity: '1' }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['fuentes mezcladas allocation', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', purchaseMatchAllocationId: 'm', quantity: '1' }] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
        ['fuente duplicada', { lines: [
            { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '1' },
            { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '2' },
        ] }, 'SUPPLIER_RETURN_INVALID_INPUT'],
    ])('rechaza %s', (_title, overrides, code) => {
        expectReturnError(
            () => canonicalCommand(overrides as Partial<SupplierReturnCommandInput>),
            code as SupplierReturnError['code'],
            400,
        );
    });
});

describe('plan físico tenant-scoped de devolución', () => {
    it('permite costo origen 10/current book 12, usa costo libro y ordena locks', () => {
        const plan = planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().reverse(),
        });
        expect(plan.map((line) => line.productId)).toEqual(['product-1', 'product-1', 'product-2']);
        const direct = plan.find((line) => line.sourceType === 'DIRECT_PURCHASE_ITEM')!;
        expect(direct).toMatchObject({
            quantityExact: '2.0000',
            bookUnitCostExact: '12.000000',
            bookValueExact: '24.0000',
            productNameAtReturn: 'Carne de res',
            unitAtReturn: 'LB',
            saleModeAtReturn: 'MEASURED',
            quantityStepAtReturn: '0.0001',
            batchNumberAtReturn: 'LOT-1',
            expiryDateAtReturn: '2026-09-30',
            sourcePurchaseId: 'purchase-1',
            sourcePurchaseItemId: 'purchase-item-1',
            purchaseMatchAllocationId: null,
            creditEligibility: 'NOTEABLE',
            batchLedgerStatus: 'APPLIED',
            kardexMovementType: 'PURCHASE_RETURN',
            kardexReferenceType: 'SUPPLIER_RETURN',
            batchMovement: {
                movementType: 'PURCHASE_RETURN',
                referenceType: 'SUPPLIER_RETURN_ITEM',
                delta: '-2.0000',
                allowNegative: false,
            },
        });
        expect(plan.find((line) => line.sourceType === 'GOODS_RECEIPT_UNMATCHED')?.creditEligibility)
            .toBe('PENDING_INVOICE_LINK');
        expect(plan.find((line) => line.sourceType === 'PURCHASE_MATCH_ALLOCATION')?.creditEligibility)
            .toBe('NOTEABLE');
    });

    it('unifica el cupo físico unmatched y allocation por GoodsReceiptItem', () => {
        const sources = evidenceForCommand();
        sources[1] = sourceEvidence({ ...sources[1], physicalPreviouslyReturnedExact: '4.0000' });
        sources[2] = sourceEvidence({ ...sources[2], physicalPreviouslyReturnedExact: '4.0000' });
        expectReturnError(
            () => planSupplierReturnPosting({ command: canonicalCommand(), batchLedgerMode: 'ENFORCED', sources }),
            'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
            409,
        );
    });

    it('respeta saleMode y quantityStep actuales sin truncar pesables', () => {
        const half = canonicalCommand({
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-1', quantity: '0.5' }],
        });
        expect(() => planSupplierReturnPosting({
            command: half,
            batchLedgerMode: 'ENFORCED',
            sources: [sourceEvidence({ saleModeAtReturn: 'MEASURED', quantityStepAtReturn: '0.0001' })],
        })).not.toThrow();
        expectReturnError(() => planSupplierReturnPosting({
            command: half,
            batchLedgerMode: 'ENFORCED',
            sources: [sourceEvidence({ saleModeAtReturn: 'COUNTED', quantityStepAtReturn: '1' })],
        }), 'SUPPLIER_RETURN_INVALID_INPUT', 400);
    });

    it('valida resultados APPLIED en forma todo-o-nada y acepta no loteados sin resultados', () => {
        const plan = planSupplierReturnPosting({
            command: canonicalCommand(), batchLedgerMode: 'ENFORCED', sources: evidenceForCommand(),
        });
        const direct = plan.find((line) => line.batchMovement !== null)!;
        expect(() => assertSupplierReturnBatchLedgerResults({
            planned: plan,
            results: [{ sourceHash: direct.sourceHash, ledgerStatus: 'APPLIED' }],
        })).not.toThrow();
        expectReturnError(() => assertSupplierReturnBatchLedgerResults({ planned: plan, results: [] }),
            'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409);
        expectReturnError(() => assertSupplierReturnBatchLedgerResults({
            planned: plan,
            results: [{ sourceHash: direct.sourceHash, ledgerStatus: 'SHADOW_GAP' }],
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409);
        expectReturnError(() => assertSupplierReturnBatchLedgerResults({
            planned: plan,
            results: [
                { sourceHash: direct.sourceHash, ledgerStatus: 'APPLIED' },
                { sourceHash: 'unexpected', ledgerStatus: 'APPLIED' },
            ],
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409);
        expect(() => assertSupplierReturnBatchLedgerResults({
            planned: plan.filter((line) => line.batchMovement === null), results: [],
        })).not.toThrow();
    });

    it.each([
        ['fuente faltante', () => evidenceForCommand().slice(0, 2), 'SUPPLIER_RETURN_SOURCE_NOT_FOUND', 404],
        ['fuente duplicada', () => [sourceEvidence(), sourceEvidence(), evidenceForCommand()[1]], 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['otro tenant', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ tenantId: 'tenant-2' })), 'SUPPLIER_RETURN_SOURCE_SCOPE_MISMATCH', 409],
        ['otro proveedor', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ supplierId: 'supplier-2' })), 'SUPPLIER_RETURN_SOURCE_SCOPE_MISMATCH', 409],
        ['documento no posted', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ sourceStatus: 'VOIDED' })), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['serial', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ hasSerialTracking: true })), 'SUPPLIER_RETURN_SERIAL_UNSUPPORTED', 409],
        ['shadow gap', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ hasShadowGap: true })), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['requiresBatchTracking corrupto', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ requiresBatchTracking: null })), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['hasSerialTracking corrupto', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ hasSerialTracking: 'false' })), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['hasShadowGap corrupto', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ hasShadowGap: undefined })), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['excede source individual', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ availableToReturnExact: '1.9999' })), 'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE', 409],
        ['lote requerido faltante', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ batchId: null, inventoryBatchId: null })), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['direct sin purchase', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ purchaseId: null })), 'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED', 409],
        ['direct item divergente', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ sourcePurchaseItemId: 'purchase-item-2' })), 'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED', 409],
        ['direct bodega divergente', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ inventoryWarehouseId: 'warehouse-2' })), 'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED', 409],
        ['direct lote divergente', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ inventoryBatchId: 'batch-2' })), 'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED', 409],
        ['direct costo origen faltante', () => evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ inventoryUnitCostExact: null })), 'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED', 409],
        ['unmatched contaminado', () => evidenceForCommand().map((row, index) => index === 1 ? sourceEvidence({ ...row, purchaseId: 'purchase-1' }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['unmatched purchase item contaminado', () => evidenceForCommand().map((row, index) => index === 1 ? sourceEvidence({ ...row, sourcePurchaseItemId: 'purchase-item-1' }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['unmatched allocation contaminada', () => evidenceForCommand().map((row, index) => index === 1 ? sourceEvidence({ ...row, purchaseMatchAllocationId: 'allocation-1' }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['unmatched receipt divergente', () => evidenceForCommand().map((row, index) => index === 1 ? sourceEvidence({ ...row, physicalReceiptItemId: 'receipt-item-2' }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['allocation sin purchase', () => evidenceForCommand().map((row, index) => index === 2 ? sourceEvidence({ ...row, purchaseId: null }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['allocation sin purchase item', () => evidenceForCommand().map((row, index) => index === 2 ? sourceEvidence({ ...row, sourcePurchaseItemId: null }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['allocation id divergente', () => evidenceForCommand().map((row, index) => index === 2 ? sourceEvidence({ ...row, purchaseMatchAllocationId: 'allocation-2' }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
        ['allocation sin receipt físico', () => evidenceForCommand().map((row, index) => index === 2 ? sourceEvidence({ ...row, physicalReceiptItemId: null }) : row), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409],
    ])('falla cerrado: %s', (_title, sourceFactory, code, status) => {
        expectReturnError(
            () => planSupplierReturnPosting({
                command: canonicalCommand(), batchLedgerMode: 'ENFORCED', sources: sourceFactory(),
            }),
            code as SupplierReturnError['code'],
            status as SupplierReturnError['httpStatus'],
        );
    });

    it('rechaza cualquier lote con ledger OFF', () => {
        expectReturnError(
            () => planSupplierReturnPosting({
                command: canonicalCommand(), batchLedgerMode: 'OFF', sources: evidenceForCommand(),
            }),
            'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED',
            409,
        );
    });

    it('permite OFF únicamente cuando no existe lote físico', () => {
        const command = canonicalCommand({
            lines: [{ sourceType: 'GOODS_RECEIPT_UNMATCHED', goodsReceiptItemId: 'receipt-item-1', quantity: '1' }],
        });
        const result = planSupplierReturnPosting({
            command,
            batchLedgerMode: 'OFF',
            sources: [evidenceForCommand()[1]],
        });
        expect(result[0]).toMatchObject({ batchId: null, batchLedgerStatus: 'NOT_APPLICABLE', batchMovement: null });
    });

    it('rechaza fuentes extra o con discriminante persistido inválido', () => {
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: [...evidenceForCommand(), sourceEvidence({ sourceId: 'extra' })],
        }), 'SUPPLIER_RETURN_SOURCE_NOT_FOUND', 404, 'No se encontró una de las fuentes de la devolución');
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ sourceType: 'INVALID' })),
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
        'La fuente no tiene evidencia física exacta para devolverla');
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index
                ? row
                : sourceEvidence({ sourceId: 'purchase-item-missing' })),
        }), 'SUPPLIER_RETURN_SOURCE_NOT_FOUND', 404,
        'No se encontró una de las fuentes de la devolución');
    });

    it('mantiene mensajes operativos estables para los rechazos físicos', () => {
        const cases: Array<[
            SupplierReturnSourceEvidence[],
            SupplierReturnError['code'],
            string,
        ]> = [
            [evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ supplierId: 'supplier-2' })),
                'SUPPLIER_RETURN_SOURCE_SCOPE_MISMATCH', 'La fuente no pertenece al proveedor autenticado'],
            [evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ hasSerialTracking: true })),
                'SUPPLIER_RETURN_SERIAL_UNSUPPORTED', 'Las devoluciones de productos serializados no están habilitadas en v1'],
            [evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ availableToReturnExact: '1' })),
                'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE', 'La cantidad devuelta excede el neto disponible de la fuente'],
            [evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ purchaseId: null })),
                'SUPPLIER_RETURN_DIRECT_EVIDENCE_REQUIRED', 'La compra directa no conserva evidencia exacta de bodega, lote y costo'],
        ];
        for (const [sources, code, message] of cases) {
            expectReturnError(() => planSupplierReturnPosting({
                command: canonicalCommand(), batchLedgerMode: 'ENFORCED', sources,
            }), code, 409, message);
        }
        const capped = evidenceForCommand();
        capped[1] = sourceEvidence({ ...capped[1], physicalPreviouslyReturnedExact: '4' });
        capped[2] = sourceEvidence({ ...capped[2], physicalPreviouslyReturnedExact: '4' });
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(), batchLedgerMode: 'ENFORCED', sources: capped,
        }), 'SUPPLIER_RETURN_QUANTITY_EXCEEDS_AVAILABLE', 409,
        'La devolución excede el total físico aceptado de la recepción');
    });

    it('falla cerrado ante evidencia Decimal/identificador corrupta con mensajes estables', () => {
        for (const availableToReturnExact of [1, 1n, null]) {
            expectReturnError(() => planSupplierReturnPosting({
                command: canonicalCommand(),
                batchLedgerMode: 'ENFORCED',
                sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ availableToReturnExact })),
            }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
            'La evidencia exacta de la fuente está incompleta');
        }
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ availableToReturnExact: 'not-decimal' })),
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
        'La evidencia exacta de la fuente está incompleta');
        for (const availableToReturnExact of ['-1', 'Infinity', '1.00001', '100000000000000']) {
            expectReturnError(() => planSupplierReturnPosting({
                command: canonicalCommand(),
                batchLedgerMode: 'ENFORCED',
                sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ availableToReturnExact })),
            }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
            'La evidencia availableToReturnExact no es conciliable');
        }
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ warehouseId: 'bad\nwarehouse' })),
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
        'La fuente no tiene evidencia física exacta para devolverla');
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ productId: null })),
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
        'La fuente no tiene evidencia física exacta para devolverla');
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ bookUnitCostExact: '1000000000000' })),
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
        'La evidencia bookUnitCostExact no es conciliable');
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ inventoryUnitCostExact: '-1' })),
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
        'La evidencia inventoryUnitCostExact no es conciliable');
        expectReturnError(() => planSupplierReturnPosting({
            command: canonicalCommand(),
            batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ quantityStepAtReturn: '-1' })),
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409,
        'La evidencia quantityStepAtReturn no es conciliable');

        const directCommand = canonicalCommand({
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-1', quantity: '2' }],
        });
        expect(planSupplierReturnPosting({
            command: directCommand,
            batchLedgerMode: 'ENFORCED',
            sources: [sourceEvidence({
                availableToReturnExact: new Decimal('5'),
                bookUnitCostExact: new Decimal('12'),
                inventoryUnitCostExact: new Decimal('10'),
                quantityStepAtReturn: new Decimal('0.0001'),
            })],
        })[0]).toMatchObject({
            quantityExact: '2.0000',
            bookUnitCostExact: '12.000000',
            quantityStepAtReturn: '0.0001',
        });
        expect(planSupplierReturnPosting({
            command: directCommand,
            batchLedgerMode: 'ENFORCED',
            sources: [sourceEvidence({ availableToReturnExact: ' 5 ' })],
        })[0].quantityExact).toBe('2.0000');
        expect(planSupplierReturnPosting({
            command: directCommand,
            batchLedgerMode: 'ENFORCED',
            sources: [sourceEvidence({ availableToReturnExact: '1000000000000.0000' })],
        })[0].quantityExact).toBe('2.0000');
    });

    it('rechaza snapshots textuales vacíos, largos o con control', () => {
        for (const productId of ['', 'p'.repeat(192), 'p\u0000hidden']) {
            expectReturnError(() => planSupplierReturnPosting({
                command: canonicalCommand(), batchLedgerMode: 'ENFORCED',
                sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ productId })),
            }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409);
        }
        expect(planSupplierReturnPosting({
            command: canonicalCommand(), batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({ productId: ' p ' })),
        }).find((line) => line.sourceId === 'purchase-item-1')?.productId).toBe('p');
        expect(planSupplierReturnPosting({
            command: canonicalCommand(), batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({
                productId: 'p'.repeat(191),
                warehouseId: 'w'.repeat(191),
                inventoryWarehouseId: 'w'.repeat(191),
                descriptionAtReturn: 'd'.repeat(191),
            })),
        }).find((line) => line.sourceId === 'purchase-item-1')).toMatchObject({
            productId: 'p'.repeat(191),
            warehouseId: 'w'.repeat(191),
            productNameAtReturn: 'd'.repeat(191),
        });
        for (const warehouseId of [7, '', 'w'.repeat(192)]) {
            expectReturnError(() => planSupplierReturnPosting({
                command: canonicalCommand(), batchLedgerMode: 'ENFORCED',
                sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({
                    warehouseId,
                    inventoryWarehouseId: warehouseId,
                })),
            }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409);
        }
        expect(planSupplierReturnPosting({
            command: canonicalCommand(), batchLedgerMode: 'ENFORCED',
            sources: evidenceForCommand().map((row, index) => index ? row : sourceEvidence({
                warehouseId: ' warehouse-1 ',
            })),
        }).find((line) => line.sourceId === 'purchase-item-1')?.warehouseId).toBe('warehouse-1');
    });

    it('rechaza evidencia física inconsistente entre las dos vistas de una recepción', () => {
        for (const mismatch of [
            { physicalAcceptedQuantityExact: '11' },
            { physicalPreviouslyReturnedExact: '3' },
        ]) {
            const sources = evidenceForCommand();
            sources[2] = sourceEvidence({ ...sources[2], ...mismatch });
            expectReturnError(() => planSupplierReturnPosting({
                command: canonicalCommand(), batchLedgerMode: 'ENFORCED', sources,
            }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409);
        }
        for (const [field, value, message] of [
            ['physicalAcceptedQuantityExact', '-1', 'La evidencia physicalAcceptedQuantityExact no es conciliable'],
            ['physicalPreviouslyReturnedExact', '-1', 'La evidencia physicalPreviouslyReturnedExact no es conciliable'],
        ] as const) {
            const sources = evidenceForCommand();
            sources[1] = sourceEvidence({ ...sources[1], [field]: value });
            expectReturnError(() => planSupplierReturnPosting({
                command: canonicalCommand(), batchLedgerMode: 'ENFORCED', sources,
            }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409, message);
        }
    });

    it('rechaza overflow de bookValue Decimal(18,4)', () => {
        const command = canonicalCommand({
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-1', quantity: '101' }],
        });
        expectReturnError(() => planSupplierReturnPosting({
            command,
            batchLedgerMode: 'ENFORCED',
            sources: [sourceEvidence({
                availableToReturnExact: '101',
                bookUnitCostExact: '999999999999.999999',
                inventoryUnitCostExact: '1',
            })],
        }), 'SUPPLIER_RETURN_SOURCE_RECONCILIATION_REQUIRED', 409);
    });

    it('ordena ejecución por producto, bodega, lote y sourceHash', () => {
        const ids = ['item-a', 'item-b', 'item-c', 'item-d', 'item-e'];
        const command = canonicalCommand({
            lines: ids.map((purchaseItemId) => ({ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId, quantity: '1' })),
        });
        const locations = [
            ['product-2', 'warehouse-1', 'batch-1'],
            ['product-1', 'warehouse-2', 'batch-1'],
            ['product-1', 'warehouse-1', 'batch-2'],
            ['product-1', 'warehouse-1', 'batch-1'],
            ['product-1', 'warehouse-1', 'batch-1'],
        ];
        const sources = ids.map((sourceId, index) => sourceEvidence({
            sourceId,
            sourcePurchaseItemId: sourceId,
            productId: locations[index][0],
            warehouseId: locations[index][1],
            batchId: locations[index][2],
            inventoryWarehouseId: locations[index][1],
            inventoryBatchId: locations[index][2],
        }));
        const result = planSupplierReturnPosting({ command, batchLedgerMode: 'ENFORCED', sources });
        const tuples = result.map((line) => [line.productId, line.warehouseId, line.batchId, line.sourceHash]);
        expect(tuples).toEqual([...tuples].sort((left, right) => left[0]!.localeCompare(right[0]!)
            || left[1]!.localeCompare(right[1]!)
            || left[2]!.localeCompare(right[2]!)
            || left[3]!.localeCompare(right[3]!)));
        expect(result.map((line) => line.sourceId)).not.toEqual(ids);

        const nullableBatchCommand = canonicalCommand({
            lines: [
                { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'item-a', quantity: '1' },
                { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'item-b', quantity: '1' },
            ],
        });
        const nullableBatchPlan = planSupplierReturnPosting({
            command: nullableBatchCommand,
            batchLedgerMode: 'ENFORCED',
            sources: [
                sourceEvidence({
                    sourceId: 'item-a', sourcePurchaseItemId: 'item-a', productId: 'same',
                    batchId: null, inventoryBatchId: null, requiresBatchTracking: false,
                }),
                sourceEvidence({
                    sourceId: 'item-b', sourcePurchaseItemId: 'item-b', productId: 'same',
                    batchId: 'A', inventoryBatchId: 'A', requiresBatchTracking: true,
                }),
            ],
        });
        expect(nullableBatchPlan.map((line) => [line.sourceId, line.batchId])).toEqual([
            ['item-a', null],
            ['item-b', 'A'],
        ]);
        const reverseNullableBatchPlan = planSupplierReturnPosting({
            command: nullableBatchCommand,
            batchLedgerMode: 'ENFORCED',
            sources: [
                sourceEvidence({
                    sourceId: 'item-a', sourcePurchaseItemId: 'item-a', productId: 'same',
                    batchId: 'A', inventoryBatchId: 'A', requiresBatchTracking: true,
                }),
                sourceEvidence({
                    sourceId: 'item-b', sourcePurchaseItemId: 'item-b', productId: 'same',
                    batchId: null, inventoryBatchId: null, requiresBatchTracking: false,
                }),
            ],
        });
        expect(reverseNullableBatchPlan.map((line) => [line.sourceId, line.batchId])).toEqual([
            ['item-b', null],
            ['item-a', 'A'],
        ]);
    });
});

describe('replay e integridad persistida de devolución', () => {
    const fixture = () => {
        const command = canonicalCommand({
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-1', quantity: '2' }],
        });
        const commandId = buildSupplierReturnCommandId(command);
        const payloadHash = buildSupplierReturnPayloadHash(command);
        const result: SupplierReturnStoredResult = {
            version: 1,
            commandType: 'SUPPLIER_RETURN_POST',
            commandId,
            payloadHash,
            response: {
                supplierReturnId: 'return-1',
                returnNumber: 'DEV-0001',
                supplierId: command.supplierId,
                status: 'POSTED',
                lines: [{
                    supplierReturnItemId: 'return-item-1',
                    sourceHash: command.lines[0].sourceHash,
                    quantityExact: command.lines[0].quantity,
                }],
            },
        };
        const expected = {
            commandId,
            payloadHash,
            supplierId: command.supplierId,
            lines: command.lines,
        };
        return { command, result, expected };
    };

    it('serializa y reconstruye exactamente el resultado', () => {
        const { result, expected } = fixture();
        expect(parseSupplierReturnStoredResult(serializeSupplierReturnStoredResult(result), expected)).toEqual(result);
    });

    it.each([null, '', 'not-json', 'null', '7', '[]'])('rechaza resultado corrupto %s', (details) => {
        expectReturnError(
            () => parseSupplierReturnStoredResult(details, fixture().expected),
            'SUPPLIER_RETURN_RESULT_INCOMPLETE',
            500,
        );
    });

    it.each([
        ['version', 2],
        ['commandType', 'OTHER'],
        ['commandId', '0'.repeat(64)],
        ['payloadHash', '0'.repeat(64)],
        ['response', null],
    ])('rechaza campo persistido divergente %s', (field, value) => {
        const { result, expected } = fixture();
        expectReturnError(
            () => parseSupplierReturnStoredResult(JSON.stringify({ ...result, [field]: value }), expected),
            'SUPPLIER_RETURN_RESULT_INCOMPLETE',
            500,
        );
    });

    it('rechaza respuesta o líneas parciales y no reordena la evidencia', () => {
        const { result, expected } = fixture();
        const corruptResponses = [
            { ...result.response, supplierReturnId: null },
            { ...result.response, supplierReturnId: 7 },
            { ...result.response, supplierReturnId: '' },
            { ...result.response, returnNumber: null },
            { ...result.response, returnNumber: 7 },
            { ...result.response, returnNumber: '' },
            { ...result.response, supplierId: 'supplier-2' },
            { ...result.response, status: 'DRAFT' },
            { ...result.response, lines: null },
            { ...result.response, lines: [] },
            { ...result.response, lines: [null] },
            { ...result.response, lines: [{ ...result.response.lines[0], supplierReturnItemId: null }] },
            { ...result.response, lines: [{ ...result.response.lines[0], supplierReturnItemId: 7 }] },
            { ...result.response, lines: [{ ...result.response.lines[0], supplierReturnItemId: '' }] },
            { ...result.response, lines: [{ ...result.response.lines[0], sourceHash: '0'.repeat(64) }] },
            { ...result.response, lines: [{ ...result.response.lines[0], quantityExact: '3.0000' }] },
        ];
        for (const response of corruptResponses) {
            expectReturnError(() => parseSupplierReturnStoredResult(JSON.stringify({ ...result, response }), expected),
                'SUPPLIER_RETURN_RESULT_INCOMPLETE', 500);
        }
    });

    it('rechaza hashes almacenados no canónicos aunque coincidan con expected', () => {
        const { result, expected } = fixture();
        for (const badHash of ['x', `x${'a'.repeat(64)}`, `${'a'.repeat(64)}x`, 7 as never]) {
            expectReturnError(() => parseSupplierReturnStoredResult(JSON.stringify({
                ...result, commandId: badHash,
            }), { ...expected, commandId: badHash as string }), 'SUPPLIER_RETURN_RESULT_INCOMPLETE', 500);
            expectReturnError(() => parseSupplierReturnStoredResult(JSON.stringify({
                ...result, payloadHash: badHash,
            }), { ...expected, payloadHash: badHash as string }), 'SUPPLIER_RETURN_RESULT_INCOMPLETE', 500);
            expectReturnError(() => parseSupplierReturnStoredResult(JSON.stringify({
                ...result,
                response: { ...result.response, lines: [{ ...result.response.lines[0], sourceHash: badHash }] },
            }), {
                ...expected,
                lines: [{ ...expected.lines[0], sourceHash: badHash as string }],
            }), 'SUPPLIER_RETURN_RESULT_INCOMPLETE', 500);
        }
    });

    it('acepta replay exacto y rechaza versión/hash distintos', () => {
        const { result } = fixture();
        expect(() => assertSupplierReturnReplay({ payloadVersion: 1, payloadHash: result.payloadHash }, result.payloadHash))
            .not.toThrow();
        expectReturnError(
            () => assertSupplierReturnReplay({ payloadVersion: 2, payloadHash: result.payloadHash }, result.payloadHash),
            'SUPPLIER_RETURN_IDEMPOTENCY_CONFLICT',
            409,
        );
        expectReturnError(
            () => assertSupplierReturnReplay({ payloadVersion: 1, payloadHash: '0'.repeat(64) }, result.payloadHash),
            'SUPPLIER_RETURN_IDEMPOTENCY_CONFLICT',
            409,
        );
    });
});
