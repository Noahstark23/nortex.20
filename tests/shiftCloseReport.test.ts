import { describe, expect, it } from 'vitest';
import {
    buildShiftCloseReport,
    canonicalShiftCloseReportJson,
    hashShiftCloseReport,
    salesPaymentMethodLabel,
    type BuildShiftCloseReportInput,
} from '../backend/lib/shiftCloseReport';

const makeInput = (): BuildShiftCloseReportInput => ({
    folio: 'Z-20260830-0001',
    businessDate: '2026-08-30',
    generatedAt: new Date('2026-08-31T01:05:00.000Z'),
    business: {
        name: 'Pulperia La Esquina',
        taxId: 'J0310000000012',
        address: 'Managua',
        phone: '2222-2222',
    },
    shift: {
        id: 'shift-1',
        openedAt: new Date('2026-08-30T12:00:00.000Z'),
        closedAt: new Date('2026-08-31T01:00:00.000Z'),
        openedBy: 'Duena',
        cashierName: 'Maria Caja',
        closedBy: 'Duena',
        auditNotes: '  Todo conciliado  ',
    },
    payments: [
        { method: 'CASH', transactionCount: 2, grossSales: '115.10' },
        { method: 'CARD', transactionCount: 1, grossSales: '230.20' },
        { method: 'QR', transactionCount: 1, grossSales: '0.10' },
        { method: 'CREDIT', transactionCount: 1, grossSales: '0.20' },
        { method: 'TRANSFER', transactionCount: 1, grossSales: '0.30' },
    ],
    soldProducts: [
        {
            productId: 'base-1', productName: 'Arroz', unit: 'lb', saleMode: 'MEASURED',
            presentation: 'BASE', quantity: '2', amount: '115.10', cogs: '70.05',
        },
        {
            productId: 'pack-1', productName: 'Gaseosa', unit: 'unidad', saleMode: 'COUNTED',
            presentation: 'PACK', displayUnit: 'caja', quantity: '2', amount: '230.20', cogs: '140.10',
        },
        {
            productId: 'qr-1', productName: 'Bolsa', unit: 'unidad', saleMode: 'COUNTED',
            presentation: 'BASE', quantity: '1', amount: '0.10', cogs: '0.05',
        },
        {
            productId: 'credit-1', productName: 'Liga', unit: 'unidad', saleMode: 'COUNTED',
            presentation: 'BASE', quantity: '1', amount: '0.20', cogs: '0.10',
        },
        {
            productId: 'transfer-1', productName: 'Clavo', unit: 'unidad', saleMode: 'COUNTED',
            presentation: 'BASE', quantity: '1', amount: '0.30', cogs: '0.15',
        },
    ],
    returnedProducts: [
        {
            productId: 'base-1', productName: 'Arroz', unit: 'lb', saleMode: 'MEASURED',
            presentation: 'BASE', quantity: '0.5', amount: '28.78', cogs: '17.51',
        },
        {
            productId: 'pack-1', productName: 'Gaseosa', unit: 'unidad', saleMode: 'COUNTED',
            presentation: 'PACK', displayUnit: 'caja', quantity: '1', amount: '115.10', cogs: '70.05',
        },
    ],
    returns: { count: 2, total: '143.88', vat: '18.77', cogs: '87.56' },
    fiscal: { vatCollectedBeforeReturns: '45.12', discountTotal: '1.23' },
    cash: {
        openingNio: '100', expectedNio: '193.31', countedNio: '193.30', differenceNio: '-0.01',
        openingUsd: '20', expectedUsd: '21', countedUsd: '21', differenceUsd: '0',
        cashRefundsNio: '28.78',
    },
    movements: [
        { type: 'IN', currency: 'NIO', category: 'CAMBIO', count: 1, amount: '10.01' },
        { type: 'OUT', currency: 'NIO', category: 'GASTO', count: 1, amount: '3.02' },
        { type: 'OUT', currency: 'NIO', category: 'DEVOLUCION', count: 1, amount: '28.78' },
        { type: 'IN', currency: 'USD', category: 'CAMBIO', count: 1, amount: '1.10' },
        { type: 'OUT', currency: 'USD', category: 'GASTO', count: 1, amount: '0.10' },
    ],
});

const rotate = <T>(values: readonly T[], places: number): T[] => {
    const offset = values.length === 0 ? 0 : places % values.length;
    return [...values.slice(offset), ...values.slice(0, offset)];
};

describe('snapshot puro del Reporte Z', () => {
    it('cuadra ventas, devoluciones parciales, IVA, costo y utilidad con Decimal', () => {
        const report = buildShiftCloseReport(makeInput());

        expect(report.summary).toEqual({
            grossSales: '345.90',
            returnsTotal: '143.88',
            netSales: '202.02',
            vatCollected: '26.35',
            netRevenue: '175.67',
            cogs: '122.89',
            grossProfit: '52.78',
            transactionCount: 6,
            returnCount: 2,
            averageTicket: '57.65',
            discountTotal: '1.23',
            itemQuantityGross: '7',
            itemQuantityReturned: '1.5',
            itemQuantityNet: '5.5',
            roundingAdjustment: '0.00',
        });
        expect(report.shift.auditNotes).toBe('Todo conciliado');
    });

    it('conserva BASE y PACK separados y resta la devolucion en su presentacion', () => {
        const report = buildShiftCloseReport(makeInput());
        const base = report.products.find((product) => product.productId === 'base-1');
        const pack = report.products.find((product) => product.productId === 'pack-1');

        expect(base).toMatchObject({
            presentation: 'BASE', displayUnit: 'lb',
            quantitySold: '2', quantityReturned: '0.5', quantityNet: '1.5',
            grossSales: '115.10', returnsTotal: '28.78', netSales: '86.32',
        });
        expect(pack).toMatchObject({
            presentation: 'PACK', displayUnit: 'caja',
            quantitySold: '2', quantityReturned: '1', quantityNet: '1',
            grossSales: '230.20', returnsTotal: '115.10', netSales: '115.10',
        });
    });

    it('no mezcla los cinco metodos de pago ni redondea con float nativo', () => {
        const report = buildShiftCloseReport(makeInput());

        expect(report.paymentMethods.map((payment) => payment.method)).toEqual([
            'CARD', 'CASH', 'CREDIT', 'QR', 'TRANSFER',
        ]);
        expect(Object.fromEntries(report.paymentMethods.map((payment) => [payment.method, payment.grossSales])))
            .toEqual({ CARD: '230.20', CASH: '115.10', CREDIT: '0.20', QR: '0.10', TRANSFER: '0.30' });
        expect(report.cash).toMatchObject({
            openingNio: '100.00', cashSalesNio: '115.10', cashRefundsNio: '28.78',
            paidInNio: '10.01', paidOutNio: '3.02', expectedNio: '193.31',
            countedNio: '193.30', differenceNio: '-0.01',
            paidInUsd: '1.10', paidOutUsd: '0.10', expectedUsd: '21.00',
        });
    });

    it('genera el mismo documento durante 10 rondas aunque cambie el orden de entrada', () => {
        const expected = canonicalShiftCloseReportJson(buildShiftCloseReport(makeInput()));

        for (let round = 0; round < 10; round += 1) {
            const input = makeInput();
            input.payments = rotate(input.payments, round);
            input.soldProducts = rotate(input.soldProducts, round * 2);
            input.returnedProducts = rotate(input.returnedProducts, round);
            input.movements = rotate(input.movements, round * 3);

            expect(canonicalShiftCloseReportJson(buildShiftCloseReport(input))).toBe(expected);
        }
    });

    it('toma copia defensiva: cambios posteriores al input no reescriben el cierre', () => {
        const input = makeInput();
        const report = buildShiftCloseReport(input);

        input.business.name = 'Nombre cambiado despues del cierre';
        (input.soldProducts[0] as { productName: string }).productName = 'Producto cambiado';

        expect(report.business.name).toBe('Pulperia La Esquina');
        expect(report.products.some((product) => product.productName === 'Arroz')).toBe(true);
        expect(report.products.some((product) => product.productName === 'Producto cambiado')).toBe(false);
    });

    it('el hash es canonico pero cambia ante cualquier cambio economico', () => {
        const report = buildShiftCloseReport(makeInput());
        const reordered = {
            summary: report.summary,
            version: report.version,
            business: report.business,
        };
        const sameReordered = {
            business: report.business,
            version: report.version,
            summary: report.summary,
        };
        const changed = {
            ...sameReordered,
            summary: { ...report.summary, netSales: '202.03' },
        };

        expect(hashShiftCloseReport(reordered)).toBe(hashShiftCloseReport(sameReordered));
        expect(hashShiftCloseReport(changed)).not.toBe(hashShiftCloseReport(sameReordered));
        expect(hashShiftCloseReport(report)).toMatch(/^[a-f0-9]{64}$/);
    });

    it('etiqueta los metodos conocidos y deja auditable uno futuro', () => {
        expect(salesPaymentMethodLabel('CASH')).toBe('Efectivo');
        expect(salesPaymentMethodLabel('CARD')).toBe('Tarjeta');
        expect(salesPaymentMethodLabel('QR')).toBe('Código QR');
        expect(salesPaymentMethodLabel('CREDIT')).toBe('Crédito');
        expect(salesPaymentMethodLabel('TRANSFER')).toBe('Transferencia');
        expect(salesPaymentMethodLabel('WALLET_FUTURA')).toBe('WALLET_FUTURA');
    });
});
