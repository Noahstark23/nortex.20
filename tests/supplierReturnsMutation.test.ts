import { beforeEach, describe, expect, it, vi } from 'vitest';

const EVENT_ID = '018f2f89-6f3f-7ca1-8a00-123456789abc';

beforeEach(() => {
    vi.resetModules();
});

describe('mutación dirigida del contrato SupplierReturn', () => {
    it('carga fresca y congela constantes, payload, hashes y serialización literales', async () => {
        const domain = await import('../backend/lib/supplierReturns');
        expect(domain.SUPPLIER_RETURN_COMMAND_TYPE).toBe('SUPPLIER_RETURN_POST');
        expect(domain.SUPPLIER_RETURN_PAYLOAD_VERSION).toBe(1);
        expect(domain.SUPPLIER_RETURN_STATUS).toBe('POSTED');
        expect(domain.SUPPLIER_RETURN_SOURCE_TYPES).toEqual([
            'DIRECT_PURCHASE_ITEM', 'GOODS_RECEIPT_UNMATCHED', 'PURCHASE_MATCH_ALLOCATION',
        ]);
        expect(domain.SUPPLIER_RETURN_REASON_CODES).toEqual([
            'DAMAGE', 'EXPIRED', 'QUALITY', 'WRONG_ITEM', 'OVER_DELIVERY', 'OTHER',
        ]);
        const command = domain.normalizeSupplierReturnCommand({
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            clientEventId: EVENT_ID,
            reasonCode: 'QUALITY',
            reason: 'Calidad fuera de especificación',
            supplierReference: 'DEV-001',
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-1', quantity: '2' }],
        });
        expect(command).toEqual({
            version: 1,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            clientEventId: EVENT_ID,
            reasonCode: 'QUALITY',
            reason: 'Calidad fuera de especificación',
            supplierReference: 'DEV-001',
            lines: [{
                sourceType: 'DIRECT_PURCHASE_ITEM',
                sourceId: 'purchase-item-1',
                sourceHash: '118600f162775cb09cc1fed68c7353a3b5548faa5a3eddcea6a8e130b01c0cc7',
                quantity: '2.0000',
            }],
        });
        expect(domain.buildSupplierReturnSourceHash({
            tenantId: 'tenant-1', sourceType: 'DIRECT_PURCHASE_ITEM', sourceId: 'purchase-item-1',
        })).toBe('118600f162775cb09cc1fed68c7353a3b5548faa5a3eddcea6a8e130b01c0cc7');
        expect(domain.buildSupplierReturnCommandId(command))
            .toBe('1236a940593f6cbcfbd4a748c7c8f1f049e776ff880a9ddda64b93aef7aaf034');
        expect(domain.buildSupplierReturnPayloadHash(command))
            .toBe('97046847181b2f57dad41d64c53ec471594f7c40e8663589d941a99209fab857');
        const stored = {
            version: 1 as const,
            commandType: 'SUPPLIER_RETURN_POST' as const,
            commandId: '1236a940593f6cbcfbd4a748c7c8f1f049e776ff880a9ddda64b93aef7aaf034',
            payloadHash: '97046847181b2f57dad41d64c53ec471594f7c40e8663589d941a99209fab857',
            response: {
                supplierReturnId: 'return-1', returnNumber: 'DEV-0001', supplierId: 'supplier-1', status: 'POSTED' as const,
                lines: [{
                    supplierReturnItemId: 'return-item-1',
                    sourceHash: command.lines[0].sourceHash,
                    quantityExact: '2.0000',
                }],
            },
        };
        const serialized = domain.serializeSupplierReturnStoredResult(stored);
        expect(serialized).toBe(JSON.stringify(stored));
        expect(domain.parseSupplierReturnStoredResult(serialized, {
            commandId: stored.commandId,
            payloadHash: stored.payloadHash,
            supplierId: 'supplier-1',
            lines: command.lines,
        })).toEqual(stored);
    });

    it('congela el plan completo, incluidos opcionales nulos y movimientos', async () => {
        const domain = await import('../backend/lib/supplierReturns');
        const command = domain.normalizeSupplierReturnCommand({
            tenantId: 'tenant-1', userId: 'user-1', supplierId: 'supplier-1', clientEventId: EVENT_ID,
            reasonCode: 'QUALITY', reason: 'Calidad incorrecta',
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'purchase-item-1', quantity: '2' }],
        });
        expect(domain.planSupplierReturnPosting({
            command,
            batchLedgerMode: 'SHADOW',
            sources: [{
                tenantId: 'tenant-1', supplierId: 'supplier-1', sourceType: 'DIRECT_PURCHASE_ITEM',
                sourceId: 'purchase-item-1', sourceStatus: 'POSTED', productId: 'product-1',
                warehouseId: 'warehouse-1', batchId: 'batch-1', availableToReturnExact: '2',
                bookUnitCostExact: '12', descriptionAtReturn: 'Carne de res', unitAtReturn: 'LB',
                saleModeAtReturn: 'MEASURED', quantityStepAtReturn: '0.0001',
                batchNumberAtReturn: null, expiryDateAtReturn: null,
                requiresBatchTracking: true, hasSerialTracking: false, hasShadowGap: false,
                purchaseId: 'purchase-1', sourcePurchaseItemId: 'purchase-item-1', purchaseMatchAllocationId: null,
                inventoryWarehouseId: 'warehouse-1', inventoryBatchId: 'batch-1', inventoryUnitCostExact: '10',
            }],
        })).toEqual([{
            sourceType: 'DIRECT_PURCHASE_ITEM',
            sourceId: 'purchase-item-1',
            sourceHash: command.lines[0].sourceHash,
            productId: 'product-1',
            warehouseId: 'warehouse-1',
            batchId: 'batch-1',
            quantityExact: '2.0000',
            bookUnitCostExact: '12.000000',
            bookValueExact: '24.0000',
            productNameAtReturn: 'Carne de res',
            unitAtReturn: 'LB',
            saleModeAtReturn: 'MEASURED',
            quantityStepAtReturn: '0.0001',
            batchNumberAtReturn: null,
            expiryDateAtReturn: null,
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
            physicalReceiptItemId: null,
        }]);
    });

    it('congela mensajes públicos y límites léxicos', async () => {
        const domain = await import('../backend/lib/supplierReturns');
        const base = {
            tenantId: 'tenant-1', userId: 'user-1', supplierId: 'supplier-1', clientEventId: EVENT_ID,
            reasonCode: 'QUALITY', reason: 'Calidad incorrecta',
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '1' }],
        };
        const cases: Array<[Record<string, unknown>, string]> = [
            [{ ...base, tenantId: null }, 'tenantId debe ser texto'],
            [{ ...base, tenantId: '' }, 'tenantId no es válido'],
            [{ ...base, tenantId: 't'.repeat(192) }, 'tenantId no es válido'],
            [{ ...base, tenantId: 'tenant\n2' }, 'tenantId no es válido'],
            [{ ...base, userId: null }, 'userId debe ser texto'],
            [{ ...base, supplierId: null }, 'supplierId debe ser texto'],
            [{ ...base, clientEventId: null }, 'clientEventId debe ser texto'],
            [{ ...base, clientEventId: 'not-uuid' }, 'clientEventId debe ser UUID'],
            [{ ...base, clientEventId: `x${EVENT_ID}` }, 'clientEventId debe ser UUID'],
            [{ ...base, clientEventId: `${EVENT_ID}x` }, 'clientEventId debe ser UUID'],
            [{ ...base, reasonCode: 'X' }, 'reasonCode no es válido'],
            [{ ...base, reason: null }, 'reason debe ser texto'],
            [{ ...base, reason: 'ab' }, 'reason debe tener entre 3 y 1000 caracteres'],
            [{ ...base, lines: [] }, 'lines debe contener entre 1 y 100 líneas'],
            [{ ...base, lines: [null] }, 'Cada línea debe ser un objeto'],
            [{ ...base, lines: [{ sourceType: 'X', purchaseItemId: 'p', quantity: '1' }] }, 'sourceType no es válido'],
            [{ ...base, lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', goodsReceiptItemId: 'g', quantity: '1' }] }, 'Cada línea debe identificar una sola fuente'],
            [{ ...base, lines: [{ sourceType: 'GOODS_RECEIPT_UNMATCHED', goodsReceiptItemId: 'g', purchaseItemId: 'p', quantity: '1' }] }, 'Cada línea debe identificar una sola fuente'],
            [{ ...base, lines: [{ sourceType: 'PURCHASE_MATCH_ALLOCATION', purchaseMatchAllocationId: 'm', goodsReceiptItemId: 'g', quantity: '1' }] }, 'Cada línea debe identificar una sola fuente'],
            [{ ...base, lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', quantity: '1' }] }, 'purchaseItemId debe ser texto'],
            [{ ...base, lines: [{ sourceType: 'GOODS_RECEIPT_UNMATCHED', quantity: '1' }] }, 'goodsReceiptItemId debe ser texto'],
            [{ ...base, lines: [{ sourceType: 'PURCHASE_MATCH_ALLOCATION', quantity: '1' }] }, 'purchaseMatchAllocationId debe ser texto'],
            [{ ...base, lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: 1 }] }, 'quantity debe enviarse como texto decimal exacto'],
            [{ ...base, lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '1e2' }] }, 'quantity debe caber en Decimal(18,4)'],
            [{ ...base, lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '0' }] }, 'quantity debe ser mayor que cero'],
            [{ ...base, supplierReference: 1 }, 'supplierReference debe ser texto'],
            [{ ...base, supplierReference: 'r'.repeat(192) }, 'supplierReference no es válido'],
            [{ ...base, supplierReference: 'r\u0000x' }, 'supplierReference no es válido'],
        ];
        for (const [input, message] of cases) {
            expect(() => domain.normalizeSupplierReturnCommand(input as never)).toThrowError(message);
        }
        expect(domain.normalizeSupplierReturnCommand({ ...base, reason: 'abc' }).reason).toBe('abc');
        expect(domain.normalizeSupplierReturnCommand({
            ...base,
            lines: Array.from({ length: 100 }, (_, index) => ({
                sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: `p-${index}`, quantity: '1',
            })),
        }).lines).toHaveLength(100);
        expect(() => domain.normalizeSupplierReturnCommand({
            ...base,
            lines: Array.from({ length: 101 }, (_, index) => ({
                sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: `p-${index}`, quantity: '1',
            })),
        })).toThrowError('lines debe contener entre 1 y 100 líneas');
        expect(() => domain.normalizeSupplierReturnCommand({
            ...base,
            lines: [
                { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '1' },
                { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '2' },
            ],
        })).toThrowError('No se puede repetir una fuente en la misma devolución');
        expect(() => domain.assertSupplierReturnReplay({ payloadVersion: 2, payloadHash: null }, 'a'.repeat(64)))
            .toThrowError('clientEventId ya fue usado con otra devolución a proveedor');
        expect(() => domain.parseSupplierReturnStoredResult(null, {
            commandId: 'a'.repeat(64), payloadHash: 'b'.repeat(64), supplierId: 'supplier-1', lines: [],
        })).toThrowError('El resultado idempotente de la devolución está incompleto o corrupto');
    });
});
