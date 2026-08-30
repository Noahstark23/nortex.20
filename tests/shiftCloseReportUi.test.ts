import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    ShiftCloseReport,
    normalizeShiftCloseReport,
    resolveShiftCloseResult,
} from '../components/pos/ShiftCloseReport';

const completeSnapshot = () => ({
    id: 'report-1',
    shiftId: 'shift-1',
    folio: 'Z-20260830-0001',
    businessDate: '2026-08-30',
    version: 1,
    contentHash: 'a'.repeat(64),
    createdAt: '2026-08-31T01:05:00.000Z',
    documentUrl: '/api/reports/shifts/shift-1/document',
    report: {
        version: 1,
        folio: 'Z-20260830-0001',
        businessDate: '2026-08-30',
        timeZone: 'America/Managua',
        generatedAt: '2026-08-31T01:05:00.000Z',
        summary: {
            grossSales: '345.90', returnsTotal: '28.78', netSales: '317.12',
            transactionCount: 6, returnCount: 1,
            itemQuantityGross: '7', itemQuantityReturned: '0.5', itemQuantityNet: '6.5',
            discountTotal: '1.23', vatCollected: '41.37', cogs: '192.94',
            grossProfit: '82.81', averageTicket: '57.65',
        },
        paymentMethods: [
            { method: 'CASH', label: 'Efectivo', transactionCount: 2, grossSales: '115.10' },
            { method: 'CARD', label: 'Tarjeta', transactionCount: 1, grossSales: '230.20' },
        ],
        products: [{
            productId: 'product-1', productName: 'Arroz', unit: 'lb', saleMode: 'MEASURED',
            presentation: 'BASE', displayUnit: 'lb', quantitySold: '2', quantityReturned: '0.5',
            quantityNet: '1.5', grossSales: '115.10', returnsTotal: '28.78', netSales: '86.32',
            cogs: '52.54', grossProfit: '33.78',
        }],
        cash: {
            openingNio: '100', cashSalesNio: '115.1', cashRefundsNio: '28.78',
            paidInNio: '10.01', paidOutNio: '3.02', expectedNio: '193.31',
            countedNio: '193.30', differenceNio: '-0.01', openingUsd: '20',
            paidInUsd: '1.1', paidOutUsd: '0.1', expectedUsd: '21', countedUsd: '21',
            differenceUsd: '0',
        },
    },
});

describe('normalizacion defensiva del cierre en el POS', () => {
    it('acepta el snapshot anidado y conserva todos los decimales como texto', () => {
        const normalized = normalizeShiftCloseReport(completeSnapshot());

        expect(normalized).toMatchObject({
            id: 'report-1', shiftId: 'shift-1', folio: 'Z-20260830-0001',
            documentUrl: '/api/reports/shifts/shift-1/document',
            report: {
                timeZone: 'America/Managua',
                summary: { netSales: '317.12', transactionCount: 6, itemQuantityReturned: '0.5' },
                cash: { expectedNio: '193.31', countedNio: '193.3', differenceNio: '-0.01' },
            },
        });
        expect(normalized?.report.paymentMethods).toHaveLength(2);
        expect(normalized?.report.products[0]).toMatchObject({
            productName: 'Arroz', presentation: 'BASE', quantityNet: '1.5',
        });
    });

    it('crea una copia defensiva y no queda enlazado al JSON recibido', () => {
        const payload = completeSnapshot();
        const normalized = normalizeShiftCloseReport(payload)!;

        payload.report.summary.netSales = '999999';
        payload.report.cash.expectedNio = '999999';
        payload.report.products[0].productName = 'Producto mutado';

        expect(normalized.report.summary.netSales).toBe('317.12');
        expect(normalized.report.cash.expectedNio).toBe('193.31');
        expect(normalized.report.products[0].productName).toBe('Arroz');
    });

    it.each([
        'https://evil.example/robar-token',
        '//evil.example/robar-token',
        'data:text/html,<script>alert(1)</script>',
        'javascript:alert(1)',
        '/api/customers/export',
    ])('rechaza documentUrl ajena al API autenticado de reportes: %s', (documentUrl) => {
        const payload = { ...completeSnapshot(), documentUrl };
        expect(normalizeShiftCloseReport(payload)?.documentUrl).toBe('');
    });

    it('tolera temporalmente el formato plano sin inventar arrays ni fechas', () => {
        const nested = completeSnapshot();
        const flat = {
            id: 'legacy-report',
            folio: 'Z-LEGACY',
            createdAt: nested.createdAt,
            documentUrl: nested.documentUrl,
            ...nested.report,
        };

        const normalized = normalizeShiftCloseReport(flat);
        expect(normalized).toMatchObject({
            id: 'legacy-report', folio: 'Z-20260830-0001', businessDate: '2026-08-30',
            report: { folio: 'Z-20260830-0001', summary: { netSales: '317.12' } },
        });
    });

    it('rechaza snapshots sin resumen o sin arqueo en vez de renderizar basura', () => {
        expect(normalizeShiftCloseReport(null)).toBeNull();
        expect(normalizeShiftCloseReport({ report: { summary: {} } })).toBeNull();
        expect(normalizeShiftCloseReport({ report: { cash: {} } })).toBeNull();
        expect(normalizeShiftCloseReport({ report: { summary: [], cash: {} } })).toBeNull();
    });

    it('normaliza valores hostiles sin NaN, Infinity ni conteos negativos', () => {
        const payload = completeSnapshot();
        payload.report.summary.grossSales = 'NaN';
        payload.report.summary.netSales = 'Infinity';
        payload.report.summary.transactionCount = -4;
        payload.report.summary.returnCount = 2.9;
        payload.report.paymentMethods.push({
            method: 'QR', label: '', transactionCount: -1, grossSales: 'no-es-numero',
        });

        const normalized = normalizeShiftCloseReport(payload)!;
        expect(normalized.report.summary).toMatchObject({
            grossSales: '0', netSales: '0', transactionCount: 0, returnCount: 2,
        });
        expect(normalized.report.paymentMethods.at(-1)).toEqual({
            method: 'QR', label: 'QR', transactionCount: 0, grossSales: '0',
        });
    });
});

describe('compatibilidad de la respuesta POST /api/shifts/close', () => {
    it('el snapshot nuevo manda sobre campos legacy contradictorios', () => {
        const result = resolveShiftCloseResult({
            systemExpectedCash: '9999',
            difference: '9999',
            closeReport: completeSnapshot(),
        }, '8888');

        expect(result).toMatchObject({ expected: '193.31', declared: '193.3', difference: '-0.01' });
        expect(result.closeReport?.folio).toBe('Z-20260830-0001');
    });

    it('mantiene el fallback legacy y calcula la diferencia con Decimal', () => {
        expect(resolveShiftCloseResult({ systemExpectedCash: '0.2' }, '0.3')).toEqual({
            expected: '0.2', declared: '0.3', difference: '0.1', closeReport: null,
        });
        expect(resolveShiftCloseResult({
            systemExpectedCash: '10', difference: '-0.01',
        }, '9.99')).toEqual({
            expected: '10', declared: '9.99', difference: '-0.01', closeReport: null,
        });
    });
});

describe('semantica visible del resultado de cierre', () => {
    const render = (difference: string) => renderToStaticMarkup(createElement(ShiftCloseReport, {
        result: {
            expected: '10',
            declared: difference === '-0.01' ? '9.99' : '10',
            difference,
            closeReport: null,
        },
        token: 'token-opaco',
        onFinish: () => undefined,
        onPreviewError: () => undefined,
    }));

    it('rotula -0.01 NIO con USD implícitamente cero como faltante', () => {
        const html = render('-0.01');
        expect(html).toContain('Faltante de efectivo');
        expect(html).not.toContain('Sobrante de efectivo');
    });

    it('rotula cero/cero como cuadre exacto', () => {
        const html = render('0');
        expect(html).toContain('Cuadre exacto');
        expect(html).not.toContain('Faltante de efectivo');
    });

    it('el fallback legacy no ofrece preview sin URL autenticada', () => {
        const html = render('-0.01');
        expect(html).not.toContain('Ver / imprimir reporte completo');
        expect(html).toContain('La reimpresión completa estará disponible');
    });
});
