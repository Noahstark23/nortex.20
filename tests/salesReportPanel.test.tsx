import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SalesReportPanel, { type SalesReportData } from '../components/reports/SalesReportPanel';

const returnOnlyReport = (): SalesReportData => ({
    totalVentas: 0,
    ventasNetas: -60,
    ivaRecaudado: -9,
    totalCOGS: 0,
    utilidadBruta: -51,
    totalTransacciones: 0,
    chartData: [],
    quantityBreakdown: [],
    summary: {
        grossSales: '0', returnsTotal: '60', netSales: '-60', vatCollected: '-9',
        netRevenue: '-51', cogs: '0', grossProfit: '-51', transactionCount: 0,
        returnCount: 1, averageTicket: '0', discountTotal: '0', itemQuantityGross: '0',
        itemQuantityReturned: '0', itemQuantityNet: '0', roundingAdjustment: '-60',
    },
    paymentMethods: [{
        method: 'CASH', label: 'Efectivo', transactionCount: 0, returnCount: 1,
        grossSales: '0', returnsTotal: '60', netSales: '-60',
    }],
    products: [],
    returns: [{ invalidItemCount: 1, unallocatedTotal: '60' }],
});

const render = (data: SalesReportData) => renderToStaticMarkup(createElement(SalesReportPanel, {
    data,
    startDate: '2026-08-30',
    endDate: '2026-08-30',
    token: 'token-opaco',
    loading: false,
    error: null,
    onRetry: () => undefined,
    showToast: () => undefined,
}));

describe('reporte integral de ventas en UI', () => {
    it('no oculta un período que solo contiene devoluciones', () => {
        const html = render(returnOnlyReport());

        expect(html).not.toContain('No hubo ventas en este período');
        expect(html).toContain('Ventas brutas');
        expect(html).toContain('Devoluciones');
        expect(html).toContain('Hay devoluciones históricas por conciliar');
        expect(html).toContain('no se asignaron a un producto');
        expect(html).toContain('Diferencia por conciliar');
    });

    it('conserva el vacío real cuando no hay ventas ni devoluciones', () => {
        const data = returnOnlyReport();
        data.summary = { ...data.summary!, returnCount: 0, returnsTotal: '0' };
        data.returns = [];

        expect(render(data)).toContain('No hubo ventas en este período');
    });
});
