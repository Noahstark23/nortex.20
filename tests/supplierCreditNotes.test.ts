import { describe, expect, it } from 'vitest';
import {
    assertSupplierCreditNoteReplay,
    buildSupplierCreditNoteCommandId,
    buildSupplierCreditNotePayloadHash,
    normalizeSupplierCreditNoteRequest,
    parseSupplierCreditNoteStoredResult,
    planSupplierCreditNotePosting,
    serializeSupplierCreditNoteStoredResult,
    SupplierCreditNoteError,
    type CanonicalSupplierCreditNoteRequest,
    type SupplierCreditNoteCommandInput,
    type SupplierCreditNoteStoredResult,
    type SupplierCreditPurchaseSnapshot,
    type SupplierCreditReturnItemSnapshot,
} from '../backend/lib/supplierCreditNotes';

const EVENT_ID = '018f2f89-6f3f-7ca1-8a00-123456789abc';

const creditInput = (overrides: Partial<SupplierCreditNoteCommandInput> = {}): SupplierCreditNoteCommandInput => ({
    tenantId: ' tenant-1 ',
    userId: ' user-1 ',
    supplierId: ' supplier-1 ',
    clientEventId: EVENT_ID.toUpperCase(),
    creditNoteNumber: ' NC-001 ',
    invoiceDate: '2026-08-01',
    creditNoteDate: '2026-08-27',
    devolutionDate: '2026-08-20',
    postingDate: '2026-08-27',
    fiscalRegimeAtCredit: 'GENERAL',
    currencyAtIssue: 'NIO',
    reason: ' Mercadería devuelta ',
    supplierReference: ' PROV-NC-1 ',
    subtotal: '18',
    tax: '2.70',
    creditableTax: '2.7',
    total: '20.70',
    lines: [
        {
            supplierReturnItemId: 'return-item-2',
            quantity: '1', subtotal: '8', tax: '1.20', creditableTax: '1.20', total: '9.20',
        },
        {
            supplierReturnItemId: 'return-item-1',
            quantity: '1.0000', subtotal: '10', tax: '1.5', creditableTax: '1.50', total: '11.50',
        },
    ],
    applications: [{ purchaseId: 'purchase-1', amount: '20.7' }],
    ...overrides,
});

const request = (overrides: Partial<SupplierCreditNoteCommandInput> = {}): CanonicalSupplierCreditNoteRequest =>
    normalizeSupplierCreditNoteRequest(creditInput(overrides));

const returnItem = (overrides: Partial<SupplierCreditReturnItemSnapshot> = {}): SupplierCreditReturnItemSnapshot => ({
    supplierReturnItemId: 'return-item-1',
    supplierReturnId: 'return-1',
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    returnStatus: 'POSTED',
    devolutionDateManagua: '2026-08-18',
    sourceHash: 'a'.repeat(64),
    sourceType: 'DIRECT_PURCHASE_ITEM',
    goodsReceiptItemId: null,
    quantityExact: '1.0000',
    bookUnitCostExact: '7.005000',
    bookValueExact: '7.0050',
    productNameAtReturn: 'Carne de res',
    unitAtReturn: 'LB',
    sourcePurchaseId: 'purchase-1',
    sourcePurchaseItemId: 'purchase-item-1',
    purchaseMatchAllocationId: null,
    alreadyCredited: false,
    originalQtyExact: '2.0000',
    originalSubtotal: '20.00',
    originalTax: '3.00',
    originalCreditableTax: '3.00',
    creditedQtyExact: '0.0000',
    creditedSubtotal: '0.00',
    creditedTax: '0.00',
    creditedCreditableTax: '0.00',
    ...overrides,
});

const returnItems = (): SupplierCreditReturnItemSnapshot[] => [
    returnItem(),
    returnItem({
        supplierReturnItemId: 'return-item-2',
        supplierReturnId: 'return-2',
        devolutionDateManagua: '2026-08-20',
        sourceHash: 'b'.repeat(64),
        sourceType: 'PURCHASE_MATCH_ALLOCATION',
        bookUnitCostExact: '6.004000',
        bookValueExact: '6.0040',
        productNameAtReturn: 'Pollo entero',
        unitAtReturn: 'UND',
        sourcePurchaseItemId: 'purchase-item-2',
        purchaseMatchAllocationId: 'match-2',
        originalSubtotal: '16.00',
        originalTax: '2.40',
        originalCreditableTax: '2.40',
    }),
];

const purchase = (overrides: Partial<SupplierCreditPurchaseSnapshot> = {}): SupplierCreditPurchaseSnapshot => ({
    purchaseId: 'purchase-1',
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    paymentMethod: 'CREDIT',
    documentStatus: 'POSTED',
    invoiceDateManagua: '2026-08-01',
    fiscalRegimeAtPurchase: 'GENERAL',
    balanceDue: '30.0000',
    retentionAdjustmentRequired: false,
    ...overrides,
});

const plan = (overrides: Partial<Parameters<typeof planSupplierCreditNotePosting>[0]> = {}) =>
    planSupplierCreditNotePosting({
        request: request(),
        returnItems: returnItems(),
        purchases: [purchase()],
        fiscalPeriodOpen: true,
        retentionAdjustmentRequired: false,
        fiscalRegimeAtPosting: 'GENERAL',
        ...overrides,
    });

const expectCreditError = (
    operation: () => unknown,
    code: SupplierCreditNoteError['code'],
    httpStatus: SupplierCreditNoteError['httpStatus'],
): SupplierCreditNoteError => {
    try {
        operation();
    } catch (error) {
        expect(error).toBeInstanceOf(SupplierCreditNoteError);
        expect(error).toMatchObject({ name: 'SupplierCreditNoteError', code, httpStatus });
        return error as SupplierCreditNoteError;
    }
    throw new Error('Se esperaba SupplierCreditNoteError');
};

describe('normalización fiscal de nota de crédito de proveedor', () => {
    it('canoniza orden, montos <=2dp, UUID, texto y fechas separadas', () => {
        expect(request()).toMatchObject({
            version: 1,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            clientEventId: EVENT_ID,
            creditNoteNumber: 'NC-001',
            invoiceDate: '2026-08-01',
            creditNoteDate: '2026-08-27',
            devolutionDate: '2026-08-20',
            postingDate: '2026-08-27',
            subtotal: '18.00',
            tax: '2.70',
            creditableTax: '2.70',
            total: '20.70',
            reason: 'Mercadería devuelta',
            supplierReference: 'PROV-NC-1',
        });
        expect(request().lines.map((line) => line.supplierReturnItemId))
            .toEqual(['return-item-1', 'return-item-2']);
        expect(request().applications).toEqual([{ purchaseId: 'purchase-1', amount: '20.70' }]);
    });

    it('normaliza referencia nula/vacía y acepta límites monetarios', () => {
        expect(request({ supplierReference: null }).supplierReference).toBeNull();
        expect(request({ supplierReference: '  ' }).supplierReference).toBeNull();
        const max = '99999999999999.99';
        const maxRequest = request({
            subtotal: max,
            tax: '0',
            creditableTax: '0',
            total: max,
            lines: [{
                supplierReturnItemId: 'r', quantity: '0.0001', subtotal: max, tax: '0', creditableTax: '0', total: max,
            }],
            applications: [{ purchaseId: 'p', amount: max }],
        });
        expect(maxRequest.total).toBe(max);
    });

    it.each([
        ['moneda', { currencyAtIssue: 'USD' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['régimen', { fiscalRegimeAtCredit: 'INVENTED' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['UUID', { clientEventId: 'bad' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['reason no texto', { reason: null }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['reason corto', { reason: 'ab' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['sin líneas', { lines: [] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['línea primitiva', { lines: [null] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['cantidad Number', { lines: [{ supplierReturnItemId: 'r', quantity: 1, subtotal: '1', tax: '0', creditableTax: '0', total: '1' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['importe Number', { lines: [{ supplierReturnItemId: 'r', quantity: '1', subtotal: 1, tax: '0', creditableTax: '0', total: '1' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['importe 3dp', { lines: [{ supplierReturnItemId: 'r', quantity: '1', subtotal: '1.001', tax: '0', creditableTax: '0', total: '1.001' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['total cero', { subtotal: '0', tax: '0', creditableTax: '0', total: '0', lines: [{ supplierReturnItemId: 'r', quantity: '1', subtotal: '0', tax: '0', creditableTax: '0', total: '0' }], applications: [{ purchaseId: 'p', amount: '0' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['línea no concilia', { lines: [{ supplierReturnItemId: 'r', quantity: '1', subtotal: '1', tax: '1', creditableTax: '0', total: '1' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['IVA acreditable excede IVA', { lines: [{ supplierReturnItemId: 'r', quantity: '1', subtotal: '1', tax: '1', creditableTax: '1.01', total: '2' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['línea duplicada', { lines: [
            { supplierReturnItemId: 'r', quantity: '1', subtotal: '1', tax: '0', creditableTax: '0', total: '1' },
            { supplierReturnItemId: 'r', quantity: '1', subtotal: '1', tax: '0', creditableTax: '0', total: '1' },
        ], subtotal: '2', tax: '0', creditableTax: '0', total: '2', applications: [{ purchaseId: 'p', amount: '2' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['totales header divergen', { subtotal: '19' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['sin aplicaciones', { applications: [] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['aplicación primitiva', { applications: [null] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['aplicación duplicada', { applications: [{ purchaseId: 'p', amount: '10' }, { purchaseId: 'p', amount: '10.70' }] }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['aplicaciones no agotan', { applications: [{ purchaseId: 'p', amount: '20.69' }] }, 'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED', 409],
        ['fecha imposible', { creditNoteDate: '2026-02-30' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['nota antes factura', { creditNoteDate: '2026-07-31' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['posting antes nota', { postingDate: '2026-08-26' }, 'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400],
        ['otro período', { postingDate: '2026-09-01' }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED', 409],
    ])('rechaza %s', (_title, overrides, code, status) => {
        expectCreditError(
            () => request(overrides as Partial<SupplierCreditNoteCommandInput>),
            code as SupplierCreditNoteError['code'],
            status as SupplierCreditNoteError['httpStatus'],
        );
    });

    it('CUOTA_FIJA exige IVA acreditable cero', () => {
        expectCreditError(() => request({ fiscalRegimeAtCredit: 'CUOTA_FIJA' }),
            'SUPPLIER_CREDIT_NOTE_INVALID_INPUT', 400);
        expect(request({
            fiscalRegimeAtCredit: 'CUOTA_FIJA',
            creditableTax: '0',
            lines: [
                { supplierReturnItemId: 'return-item-1', quantity: '1', subtotal: '10', tax: '1.5', creditableTax: '0', total: '11.5' },
                { supplierReturnItemId: 'return-item-2', quantity: '1', subtotal: '8', tax: '1.2', creditableTax: '0', total: '9.2' },
            ],
        }).creditableTax).toBe('0.00');
    });
});

describe('plan atómico de nota, aplicación y asiento', () => {
    it('deriva snapshots, costo libro, PPV, aplicaciones y asiento balanceado', () => {
        const result = plan();
        expect(result.command).toMatchObject({
            type: 'RETURN',
            status: 'POSTED',
            inventoryReversalExact: '13.0090',
            priceVarianceReversalExact: '4.9910',
            remainingCredit: '0.00',
        });
        expect(result.command.lines[0]).toMatchObject({
            supplierReturnItemId: 'return-item-1',
            sourcePurchaseItemId: 'purchase-item-1',
            bookUnitCostExact: '7.005000',
            bookValueExact: '7.0050',
            inventoryReversalExact: '7.0050',
            priceVarianceReversalExact: '2.9950',
            descriptionAtCredit: 'Carne de res',
            unitAtCredit: 'LB',
        });
        expect(result.applications).toEqual([{
            purchaseId: 'purchase-1',
            amount: '20.70',
            balanceBefore: '30.0000',
            balanceAfter: '9.3000',
            settled: false,
        }]);
        expect(result.journalLines).toEqual([
            { accountCode: '2.1.1', debit: '20.70', credit: '0.00' },
            { accountCode: '1.1.5', debit: '0.00', credit: '2.70' },
            { accountCode: '1.1.4', debit: '0.00', credit: '13.01' },
            { accountCode: '5.1.3', debit: '0.00', credit: '4.99' },
        ]);
    });

    it('usa residual final y nunca excede el centavo original entre parciales', () => {
        const residualRequest = request({
            subtotal: '0.01', tax: '0', creditableTax: '0', total: '0.01',
            lines: [{ supplierReturnItemId: 'return-item-1', quantity: '1', subtotal: '0.01', tax: '0', creditableTax: '0', total: '0.01' }],
            applications: [{ purchaseId: 'purchase-1', amount: '0.01' }],
            devolutionDate: '2026-08-20',
        });
        const result = planSupplierCreditNotePosting({
            request: residualRequest,
            returnItems: [returnItem({
                devolutionDateManagua: '2026-08-20',
                originalQtyExact: '3',
                originalSubtotal: '0.01', originalTax: '0', originalCreditableTax: '0',
                creditedQtyExact: '2', creditedSubtotal: '0', creditedTax: '0', creditedCreditableTax: '0',
                bookUnitCostExact: '0', bookValueExact: '0',
            })],
            purchases: [purchase({ balanceDue: '0.01' })],
            fiscalPeriodOpen: true,
            retentionAdjustmentRequired: false,
            fiscalRegimeAtPosting: 'GENERAL',
        });
        expect(result.command.lines[0].subtotal).toBe('0.01');
        expect(result.applications[0]).toMatchObject({ balanceAfter: '0.0000', settled: true });
        expect(result.journalLines).toEqual([
            { accountCode: '2.1.1', debit: '0.01', credit: '0.00' },
            { accountCode: '5.1.3', debit: '0.00', credit: '0.01' },
        ]);
    });

    it('acumula dos return items de la misma PurchaseItem sin resetear topes', () => {
        const multiRequest = request({
            subtotal: '0.01', tax: '0', creditableTax: '0', total: '0.01',
            lines: [
                { supplierReturnItemId: 'return-item-1', quantity: '1', subtotal: '0', tax: '0', creditableTax: '0', total: '0' },
                { supplierReturnItemId: 'return-item-2', quantity: '2', subtotal: '0.01', tax: '0', creditableTax: '0', total: '0.01' },
            ],
            applications: [{ purchaseId: 'purchase-1', amount: '0.01' }],
        });
        const items = [
            returnItem({
                bookUnitCostExact: '0', bookValueExact: '0',
                originalQtyExact: '3', originalSubtotal: '0.01', originalTax: '0', originalCreditableTax: '0',
            }),
            returnItem({
                supplierReturnItemId: 'return-item-2', supplierReturnId: 'return-2', sourceHash: 'b'.repeat(64),
                devolutionDateManagua: '2026-08-20', quantityExact: '2',
                bookUnitCostExact: '0', bookValueExact: '0',
                sourcePurchaseItemId: 'purchase-item-1',
                originalQtyExact: '3', originalSubtotal: '0.01', originalTax: '0', originalCreditableTax: '0',
            }),
        ];
        const result = planSupplierCreditNotePosting({
            request: multiRequest,
            returnItems: items,
            purchases: [purchase({ balanceDue: '0.01' })],
            fiscalPeriodOpen: true,
            retentionAdjustmentRequired: false,
            fiscalRegimeAtPosting: 'GENERAL',
        });
        expect(result.command.lines.map((line) => line.subtotal)).toEqual(['0.00', '0.01']);
        expect(result.command.subtotal).toBe('0.01');
    });

    it('redondea inventario una vez y debita PPV cuando el costo libro excede la nota', () => {
        const negative = plan({
            returnItems: returnItems().map((item, index) => returnItem({
                ...item,
                bookUnitCostExact: index === 0 ? '15.000000' : '10.000000',
                bookValueExact: index === 0 ? '15.0000' : '10.0000',
            })),
        });
        expect(negative.command.priceVarianceReversalExact).toBe('-7.0000');
        expect(negative.journalLines.at(-1)).toEqual({
            accountCode: '5.1.3', debit: '7.00', credit: '0.00',
        });
    });

    it.each([
        ['período cerrado', { fiscalPeriodOpen: false }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['retención global', { retentionAdjustmentRequired: true }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['retención global omitida', { retentionAdjustmentRequired: undefined }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['línea faltante', { returnItems: returnItems().slice(0, 1) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['tenant cruzado', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ tenantId: 'tenant-2' })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['return no posted', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ returnStatus: 'DRAFT' })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_NOT_POSTED'],
        ['return ya acreditado', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ alreadyCredited: true })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_ITEM_ALREADY_CREDITED'],
        ['flag alreadyCredited corrupto', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ alreadyCredited: null })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['hash corrupto', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ sourceHash: 'bad' })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['cantidad parcial', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ quantityExact: '2' })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['book value corrupto', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ bookValueExact: '7.0049' })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['purchase item faltante', { returnItems: returnItems().map((item, index) => index ? item : returnItem({ sourcePurchaseItemId: null })) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['CASH', { purchases: [purchase({ paymentMethod: 'CASH' })] }, 'SUPPLIER_CREDIT_NOTE_PURCHASE_INELIGIBLE'],
        ['purchase VOIDED', { purchases: [purchase({ documentStatus: 'VOIDED' })] }, 'SUPPLIER_CREDIT_NOTE_PURCHASE_INELIGIBLE'],
        ['balance no materializado', { purchases: [purchase({ balanceDue: null })] }, 'SUPPLIER_CREDIT_NOTE_PURCHASE_INELIGIBLE'],
        ['retención purchase', { purchases: [purchase({ retentionAdjustmentRequired: true })] }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['retención purchase omitida', { purchases: [purchase({ retentionAdjustmentRequired: undefined })] }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['saldo insuficiente', { purchases: [purchase({ balanceDue: '20.69' })] }, 'SUPPLIER_CREDIT_NOTE_APPLICATION_RECONCILIATION_REQUIRED'],
        ['régimen purchase distinto', { purchases: [purchase({ fiscalRegimeAtPurchase: 'CUOTA_FIJA' })] }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['régimen posting distinto', { fiscalRegimeAtPosting: 'CUOTA_FIJA' }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['invoiceDate input arbitrario', { request: request({ invoiceDate: '2026-08-02' }) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['devolutionDate no máxima', { request: request({ devolutionDate: '2026-08-19' }) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
        ['retornos en períodos distintos', { returnItems: returnItems().map((item, index) => index ? returnItem({ ...item, devolutionDateManagua: '2026-07-31' }) : item) }, 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED'],
        ['importe libre', { request: request({
            subtotal: '18.01', total: '20.71',
            lines: [
                { supplierReturnItemId: 'return-item-1', quantity: '1', subtotal: '10.01', tax: '1.5', creditableTax: '1.5', total: '11.51' },
                { supplierReturnItemId: 'return-item-2', quantity: '1', subtotal: '8', tax: '1.2', creditableTax: '1.2', total: '9.2' },
            ],
            applications: [{ purchaseId: 'purchase-1', amount: '20.71' }],
        }) }, 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED'],
    ])('falla cerrado: %s', (_title, overrides, code) => {
        expectCreditError(
            () => plan(overrides as Partial<Parameters<typeof planSupplierCreditNotePosting>[0]>),
            code as SupplierCreditNoteError['code'],
            409,
        );
    });

    it('rechaza múltiples fechas de facturas fuente', () => {
        const multiRequest = request({
            applications: [{ purchaseId: 'purchase-1', amount: '11.50' }, { purchaseId: 'purchase-2', amount: '9.20' }],
        });
        const items = returnItems();
        items[1] = returnItem({ ...items[1], sourcePurchaseId: 'purchase-2' });
        expectCreditError(() => planSupplierCreditNotePosting({
            request: multiRequest,
            returnItems: items,
            purchases: [purchase(), purchase({ purchaseId: 'purchase-2', invoiceDateManagua: '2026-08-02' })],
            fiscalPeriodOpen: true,
            retentionAdjustmentRequired: false,
            fiscalRegimeAtPosting: 'GENERAL',
        }), 'MULTIPLE_SOURCE_INVOICE_DATES', 409);
    });

    it('resuelve unmatched con exactamente una allocation que cubre toda la salida', () => {
        const unmatchedRequest = request({
            subtotal: '10', tax: '1.50', creditableTax: '1.50', total: '11.50',
            lines: [{ supplierReturnItemId: 'return-item-1', quantity: '1', subtotal: '10', tax: '1.50', creditableTax: '1.50', total: '11.50' }],
            applications: [{ purchaseId: 'purchase-1', amount: '11.50' }],
            devolutionDate: '2026-08-18',
        });
        const link = {
            tenantId: 'tenant-1', supplierId: 'supplier-1', goodsReceiptItemId: 'receipt-item-1',
            sourcePurchaseId: 'purchase-1', sourcePurchaseItemId: 'purchase-item-1',
            purchaseMatchAllocationId: 'allocation-1', quantityExact: '1.0000',
        };
        const unmatched = returnItem({
            sourceType: 'GOODS_RECEIPT_UNMATCHED',
            goodsReceiptItemId: 'receipt-item-1',
            sourcePurchaseId: null,
            sourcePurchaseItemId: null,
            purchaseMatchAllocationId: null,
            resolvedInvoiceLinks: [link],
        });
        const valid = planSupplierCreditNotePosting({
            request: unmatchedRequest,
            returnItems: [unmatched],
            purchases: [purchase({ balanceDue: '11.50' })],
            fiscalPeriodOpen: true,
            retentionAdjustmentRequired: false,
            fiscalRegimeAtPosting: 'GENERAL',
        });
        expect(valid.command.lines[0]).toMatchObject({
            sourceType: 'GOODS_RECEIPT_UNMATCHED',
            goodsReceiptItemId: 'receipt-item-1',
            sourcePurchaseItemId: 'purchase-item-1',
            purchaseMatchAllocationId: 'allocation-1',
        });
        for (const resolvedInvoiceLinks of [[], [link, { ...link, purchaseMatchAllocationId: 'allocation-2' }]]) {
            expectCreditError(() => planSupplierCreditNotePosting({
                request: unmatchedRequest,
                returnItems: [{ ...unmatched, resolvedInvoiceLinks }],
                purchases: [purchase({ balanceDue: '11.50' })],
                fiscalPeriodOpen: true,
                retentionAdjustmentRequired: false,
                fiscalRegimeAtPosting: 'GENERAL',
            }), 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED', 409);
        }
        expectCreditError(() => planSupplierCreditNotePosting({
            request: unmatchedRequest,
            returnItems: [{ ...unmatched, resolvedInvoiceLinks: [{ ...link, quantityExact: '0.9999' }] }],
            purchases: [purchase({ balanceDue: '11.50' })],
            fiscalPeriodOpen: true,
            retentionAdjustmentRequired: false,
            fiscalRegimeAtPosting: 'GENERAL',
        }), 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED', 409);
    });

    it('bloquea importes que no caben en JournalLine Decimal(14,2)', () => {
        const huge = '1000000000000.00';
        const hugeRequest = request({
            subtotal: huge, tax: '0', creditableTax: '0', total: huge,
            lines: [{ supplierReturnItemId: 'return-item-1', quantity: '1', subtotal: huge, tax: '0', creditableTax: '0', total: huge }],
            applications: [{ purchaseId: 'purchase-1', amount: huge }],
            devolutionDate: '2026-08-18',
        });
        expectCreditError(() => planSupplierCreditNotePosting({
            request: hugeRequest,
            returnItems: [returnItem({
                originalQtyExact: '1', originalSubtotal: huge, originalTax: '0', originalCreditableTax: '0',
                bookUnitCostExact: '0', bookValueExact: '0',
            })],
            purchases: [purchase({ balanceDue: huge })],
            fiscalPeriodOpen: true,
            retentionAdjustmentRequired: false,
            fiscalRegimeAtPosting: 'GENERAL',
        }), 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED', 409);
    });

    it('bloquea overflow derivado por línea/agregado antes de persistir Decimal(18,4)', () => {
        const overflowRequest = request({
            subtotal: '2', tax: '0', creditableTax: '0', total: '2',
            lines: [
                { supplierReturnItemId: 'return-item-1', quantity: '100', subtotal: '1', tax: '0', creditableTax: '0', total: '1' },
                { supplierReturnItemId: 'return-item-2', quantity: '100', subtotal: '1', tax: '0', creditableTax: '0', total: '1' },
            ],
            applications: [{ purchaseId: 'purchase-1', amount: '2' }],
        });
        const hugeBook = '60000000000000.0000';
        const items = returnItems().map((item, index) => returnItem({
            ...item,
            quantityExact: '100',
            bookUnitCostExact: '600000000000.000000',
            bookValueExact: hugeBook,
            originalQtyExact: '100',
            originalSubtotal: '1', originalTax: '0', originalCreditableTax: '0',
            sourcePurchaseItemId: `purchase-item-${index + 1}`,
        }));
        expectCreditError(() => planSupplierCreditNotePosting({
            request: overflowRequest,
            returnItems: items,
            purchases: [purchase({ balanceDue: '2' })],
            fiscalPeriodOpen: true,
            retentionAdjustmentRequired: false,
            fiscalRegimeAtPosting: 'GENERAL',
        }), 'SUPPLIER_CREDIT_NOTE_RETURN_RECONCILIATION_REQUIRED', 409);
    });

    it('incluye snapshots económicos en hash, pero excluye actor y UUID', () => {
        const base = plan().command;
        const otherActor = plan({ request: request({ userId: 'user-2' }) }).command;
        const otherEvent = plan({ request: request({ clientEventId: '018f2f89-6f3f-7ca1-8a00-123456789abd' }) }).command;
        expect(buildSupplierCreditNotePayloadHash(otherActor)).toBe(buildSupplierCreditNotePayloadHash(base));
        expect(buildSupplierCreditNotePayloadHash(otherEvent)).toBe(buildSupplierCreditNotePayloadHash(base));
        expect(buildSupplierCreditNoteCommandId(otherEvent)).not.toBe(buildSupplierCreditNoteCommandId(base));
        const changed = plan({
            returnItems: returnItems().map((item, index) => index ? item : returnItem({ productNameAtReturn: 'Otro snapshot' })),
        }).command;
        expect(buildSupplierCreditNotePayloadHash(changed)).not.toBe(buildSupplierCreditNotePayloadHash(base));
    });
});

describe('replay e integridad persistida de nota', () => {
    const fixture = () => {
        const command = plan().command;
        const commandId = buildSupplierCreditNoteCommandId(command);
        const payloadHash = buildSupplierCreditNotePayloadHash(command);
        const result: SupplierCreditNoteStoredResult = {
            version: 1,
            commandType: 'SUPPLIER_CREDIT_NOTE_POST',
            commandId,
            payloadHash,
            response: {
                supplierCreditNoteId: 'credit-note-1',
                creditNoteNumber: command.creditNoteNumber,
                supplierId: command.supplierId,
                status: 'POSTED',
                total: command.total,
                remainingCredit: '0.00',
                returnItemIds: command.lines.map((line) => line.supplierReturnItemId),
                applications: command.applications,
            },
        };
        const expected = {
            commandId,
            payloadHash,
            supplierId: command.supplierId,
            total: command.total,
            returnItemIds: result.response.returnItemIds,
            applications: command.applications,
        };
        return { result, expected };
    };

    it('serializa y reconstruye el resultado completo y ordenado', () => {
        const { result, expected } = fixture();
        expect(parseSupplierCreditNoteStoredResult(
            serializeSupplierCreditNoteStoredResult(result), expected,
        )).toEqual(result);
    });

    it.each([null, '', 'not-json', 'null', '7', '[]'])('rechaza stored corrupto %s', (details) => {
        expectCreditError(() => parseSupplierCreditNoteStoredResult(details, fixture().expected),
            'SUPPLIER_CREDIT_NOTE_RESULT_INCOMPLETE', 500);
    });

    it('rechaza header, respuesta, línea o aplicación divergentes', () => {
        const { result, expected } = fixture();
        for (const corrupt of [
            { ...result, version: 2 },
            { ...result, commandType: 'OTHER' },
            { ...result, payloadHash: '0'.repeat(64) },
            { ...result, response: { ...result.response, supplierId: 'supplier-2' } },
            { ...result, response: { ...result.response, returnItemIds: ['return-item-x', 'return-item-2'] } },
            { ...result, response: { ...result.response, applications: [{ purchaseId: 'purchase-1', amount: '20.69' }] } },
        ]) {
            expectCreditError(() => parseSupplierCreditNoteStoredResult(JSON.stringify(corrupt), expected),
                'SUPPLIER_CREDIT_NOTE_RESULT_INCOMPLETE', 500);
        }
    });

    it('acepta replay exacto y rechaza versión/hash distintos', () => {
        const { result } = fixture();
        expect(() => assertSupplierCreditNoteReplay({ payloadVersion: 1, payloadHash: result.payloadHash }, result.payloadHash))
            .not.toThrow();
        expectCreditError(() => assertSupplierCreditNoteReplay(
            { payloadVersion: 2, payloadHash: result.payloadHash }, result.payloadHash,
        ), 'SUPPLIER_CREDIT_NOTE_IDEMPOTENCY_CONFLICT', 409);
        expectCreditError(() => assertSupplierCreditNoteReplay(
            { payloadVersion: 1, payloadHash: '0'.repeat(64) }, result.payloadHash,
        ), 'SUPPLIER_CREDIT_NOTE_IDEMPOTENCY_CONFLICT', 409);
    });
});
