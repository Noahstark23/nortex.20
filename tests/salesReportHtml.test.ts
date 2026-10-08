import { describe, expect, it } from 'vitest';
import {
    renderSalesReportHtml,
    renderShiftCloseReportHtml,
} from '../backend/lib/salesReportHtml';
import {
    foldSalesReportData,
    parseSalesReportRange,
} from '../backend/lib/salesReport';
import {
    buildShiftCloseReport,
    hashShiftCloseReport,
} from '../backend/lib/shiftCloseReport';
import type {
    SalesDocumentData,
    ShiftReportSnapshotView,
} from '../backend/services/salesReportService';

const NONCE = 'nonceSeguro_123456789';
const ATTACK = `</td><script>globalThis.pwned=true</script><img src=x onerror='steal()'>&"`;

const salesDocument = (): SalesDocumentData => {
    const report = foldSalesReportData({
        range: parseSalesReportRange('2026-08-30', '2026-08-30'),
        business: { name: ATTACK, taxId: ATTACK, address: ATTACK, phone: ATTACK },
        sales: {
            grossSales: '115', grossVat: '15', transactionCount: 1,
            productGrossSales: '115', grossCogs: '60', discountTotal: '0',
            itemQuantityGross: '1',
        },
        paymentRows: [{ method: 'CASH', transactionCount: 1, grossSales: '115' }],
        productRows: [{
            productId: 'product-1', productName: ATTACK, saleMode: 'COUNTED',
            presentation: 'BASE', baseUnit: ATTACK, displayUnit: ATTACK,
            quantityGross: '1', baseQuantityGross: '1', grossSales: '115', grossVat: '15', cogs: '60',
        }],
        dailyRows: [{ date: '2026-08-30', grossSales: '115', grossVat: '15', transactionCount: 1 }],
        expenseRows: [],
        returnRecords: [{
            id: 'return-1', saleId: 'sale-1', createdAt: '2026-08-30T18:00:00.000Z',
            total: '1.15', items: [{ productId: 'p', name: ATTACK, quantity: 1, price: '1.15' }],
            paymentMethod: 'CASH', fiscalRegimeAtSale: 'GENERAL', saleTotal: '115',
            saleVatAmountAtSale: '15', reason: ATTACK,
        }],
    });
    return {
        report,
        transactions: [{
            id: 'sale-1', invoice: ATTACK, createdAt: '2026-08-30T18:00:00.000Z',
            businessDate: '2026-08-30',
            customer: { id: 'customer-1', name: ATTACK },
            seller: { id: 'seller-1', name: ATTACK },
            cashier: { id: 'employee-1', name: ATTACK },
            paymentMethod: 'CASH', total: '115.00', vatCollected: '15.00',
            returnedTotal: '1.15', netTotal: '113.85', status: 'COMPLETED',
            items: { lineCount: 1, baseQuantity: '1' },
        }],
    };
};

const shiftSnapshot = (): ShiftReportSnapshotView => {
    const report = buildShiftCloseReport({
        folio: 'Z-20260830-shift-1', businessDate: '2026-08-30',
        generatedAt: new Date('2026-08-31T01:00:00.000Z'),
        business: { name: ATTACK, taxId: ATTACK, address: ATTACK, phone: ATTACK },
        shift: {
            id: 'shift-1', openedAt: new Date('2026-08-30T12:00:00.000Z'),
            closedAt: new Date('2026-08-31T01:00:00.000Z'), openedBy: ATTACK,
            cashierName: ATTACK, closedBy: ATTACK, auditNotes: ATTACK,
        },
        payments: [{ method: 'CASH', transactionCount: 1, grossSales: '115' }],
        soldProducts: [{
            productId: 'p1', productName: ATTACK, unit: ATTACK, saleMode: 'COUNTED',
            presentation: 'BASE', displayUnit: ATTACK, quantity: '1', amount: '115', cogs: '60', vat: '15',
        }],
        returnedProducts: [], returns: { count: 0, total: '0', vat: '0', cogs: '0' },
        fiscal: { vatCollectedBeforeReturns: '15', discountTotal: '0' },
        cash: {
            openingNio: '100', expectedNio: '215', countedNio: '215', differenceNio: '0',
            openingUsd: '20', expectedUsd: '21', countedUsd: '21', differenceUsd: '0', cashRefundsNio: '0',
        },
        movements: [{ type: 'IN', currency: 'USD', category: ATTACK, count: 1, amount: '1' }],
    });
    return {
        id: 'report-1', shiftId: 'shift-1', folio: report.folio,
        businessDate: report.businessDate, version: report.version,
        contentHash: hashShiftCloseReport(report),
        createdAt: '2026-08-31T01:00:00.000Z',
        documentUrl: '/api/reports/shifts/shift-1/document',
        report,
    };
};

const assertSecureDocument = (html: string) => {
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain(`script-src &#039;nonce-${NONCE}&#039;`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
    expect(html).toContain(".addEventListener('click'");
    expect(html).not.toMatch(/\bonclick\s*=/i);
    expect(html.match(/<script\b/g)).toHaveLength(1);

    expect(html).toContain('&lt;script&gt;globalThis.pwned=true&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&#039;steal()&#039;&gt;');
    expect(html).not.toContain('<script>globalThis.pwned=true</script>');
    expect(html).not.toContain('<img src=x');
};

describe('HTML imprimible del reporte integral', () => {
    it('escapa negocio, cliente, personal, producto y motivo con CSP nonce', () => {
        const html = renderSalesReportHtml(salesDocument(), { nonce: NONCE });
        assertSecureDocument(html);
        expect(html).toContain('Reporte integral de ventas');
        expect(html).toContain('Métodos de pago');
        expect(html).toContain('Productos vendidos y devueltos');
        expect(html).toContain('Ventas del período');
        expect(html).toContain('Devoluciones del período');
    });

    it.each([
        '', 'corto', "nonce'inseguro_123456", '<script>nonce</script>', 'a'.repeat(129),
    ])('rechaza nonce inseguro antes de construir documento: %s', (nonce) => {
        expect(() => renderSalesReportHtml(salesDocument(), { nonce })).toThrow('Nonce CSP inválido');
    });
});

describe('HTML inmutable del Reporte Z', () => {
    it('escapa snapshots persistidos y expone hash sin handlers inline', () => {
        const snapshot = shiftSnapshot();
        const html = renderShiftCloseReportHtml(snapshot, { nonce: NONCE });
        assertSecureDocument(html);
        expect(html).toContain('Reporte Z');
        expect(html).toContain('Responsabilidad del turno');
        expect(html).toContain('Arqueo de caja');
        expect(html).toContain('Movimientos de gaveta');
        expect(html).toContain(snapshot.contentHash);
    });

    it('etiqueta USD como dólares y nunca como córdobas', () => {
        const html = renderShiftCloseReportHtml(shiftSnapshot(), { nonce: NONCE });
        const usdRow = html.match(/<tr><td>USD<\/td>[\s\S]*?<\/tr>/)?.[0] ?? '';
        expect(usdRow).toContain('US$ 20.00');
        expect(usdRow).toContain('US$ 21.00');
        expect(usdRow).not.toContain('C$ 20.00');
        expect(usdRow).not.toContain('C$ 21.00');

        const usdMovementRow = html.match(/<tr>\s*<td>USD<\/td><td>IN<\/td>[\s\S]*?<\/tr>/)?.[0] ?? '';
        expect(usdMovementRow).toContain('US$ 1.00');
        expect(usdMovementRow).not.toContain('C$ 1.00');
    });
});
