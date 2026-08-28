import { describe, expect, it } from 'vitest';
import {
    CreateSupplierCreditNoteSchema,
    CreateSupplierReturnSchema,
    SUPPLIER_RETURN_REASON_CODES,
    SUPPLIER_RETURN_SOURCE_TYPES,
} from '../backend/validation/supplierReturnSchemas';

const eventId = '018f2f89-6f3f-7ca1-8a00-123456789abc';

describe('DTO dedicado de devoluciones a proveedor', () => {
    it('acepta las tres fuentes estrictas y nunca recibe tenant/usuario', () => {
        const parsed = CreateSupplierReturnSchema.parse({
            clientEventId: eventId,
            reasonCode: 'DAMAGE',
            reason: ' Empaque dañado ',
            supplierReference: null,
            lines: [
                { sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: ' p-1 ', quantity: '1' },
                { sourceType: 'GOODS_RECEIPT_UNMATCHED', goodsReceiptItemId: 'g-1', quantity: '0.0001' },
                { sourceType: 'PURCHASE_MATCH_ALLOCATION', purchaseMatchAllocationId: 'm-1', quantity: '99999999999999.9999' },
            ],
        });
        expect(parsed.reason).toBe('Empaque dañado');
        expect(parsed.lines[0]).toMatchObject({ purchaseItemId: 'p-1', quantity: '1' });
        expect(SUPPLIER_RETURN_SOURCE_TYPES).toEqual([
            'DIRECT_PURCHASE_ITEM', 'GOODS_RECEIPT_UNMATCHED', 'PURCHASE_MATCH_ALLOCATION',
        ]);
        expect(SUPPLIER_RETURN_REASON_CODES).toContain('DAMAGE');
    });

    it.each([
        ['tenant forjado', { tenantId: 'tenant-2' }],
        ['actor forjado', { userId: 'user-2' }],
        ['FK mezclada', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', goodsReceiptItemId: 'g', quantity: '1' }] }],
        ['cantidad Number', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: 1 }] }],
        ['cantidad exponente', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '1e2' }] }],
        ['cantidad cero', { lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '0' }] }],
        ['UUID no estricto', { clientEventId: 'event-1' }],
    ])('rechaza %s', (_title, override) => {
        const base = {
            clientEventId: eventId,
            reasonCode: 'QUALITY',
            reason: 'Calidad incorrecta',
            lines: [{ sourceType: 'DIRECT_PURCHASE_ITEM', purchaseItemId: 'p', quantity: '1' }],
        };
        expect(CreateSupplierReturnSchema.safeParse({ ...base, ...override }).success).toBe(false);
    });
});

describe('DTO dedicado de notas de crédito por devolución', () => {
    const note = (override: Record<string, unknown> = {}) => ({
        clientEventId: eventId,
        creditNoteNumber: 'NC-1',
        invoiceDate: '2026-08-01',
        creditNoteDate: '2026-08-27',
        devolutionDate: '2026-08-20',
        postingDate: '2026-08-27',
        reason: 'Mercadería devuelta',
        subtotal: '1.00',
        tax: '0.15',
        creditableTax: '0.15',
        total: '1.15',
        lines: [{
            supplierReturnItemId: 'return-item-1',
            quantity: '0.0001',
            subtotal: '1.00',
            tax: '0.15',
            creditableTax: '0.15',
            total: '1.15',
        }],
        applications: [{ purchaseId: 'purchase-1', amount: '1.15' }],
        ...override,
    });

    it('acepta solo importes/cantidades textuales y deja snapshots al servidor', () => {
        expect(CreateSupplierCreditNoteSchema.parse(note())).toMatchObject({
            total: '1.15',
            lines: [{ supplierReturnItemId: 'return-item-1', quantity: '0.0001' }],
        });
        expect(CreateSupplierCreditNoteSchema.parse(note({
            subtotal: '0.01', tax: '0', creditableTax: '0', total: '0.01',
            lines: [
                { supplierReturnItemId: 'r1', quantity: '1', subtotal: '0', tax: '0', creditableTax: '0', total: '0' },
                { supplierReturnItemId: 'r2', quantity: '1', subtotal: '0.01', tax: '0', creditableTax: '0', total: '0.01' },
            ],
            applications: [{ purchaseId: 'p', amount: '0.01' }],
        })).lines[0].total).toBe('0');
    });

    it.each([
        ['tenant', { tenantId: 'tenant-2' }],
        ['fiscalRegime client-side', { fiscalRegimeAtCredit: 'GENERAL' }],
        ['currency client-side', { currencyAtIssue: 'NIO' }],
        ['snapshot client-side', { lines: [{ supplierReturnItemId: 'r', quantity: '1', subtotal: '1', tax: '0', creditableTax: '0', total: '1', sourceHash: 'a'.repeat(64) }] }],
        ['money Number', { total: 1.15 }],
        ['money 3dp', { total: '1.150' }],
        ['application cero', { applications: [{ purchaseId: 'p', amount: '0' }] }],
        ['fecha timestamp', { postingDate: '2026-08-27T00:00:00Z' }],
    ])('rechaza %s', (_title, override) => {
        expect(CreateSupplierCreditNoteSchema.safeParse(note(override)).success).toBe(false);
    });
});
