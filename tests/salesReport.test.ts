import { describe, expect, it } from 'vitest';
import {
    SalesReportError,
    defaultSalesReportRange,
    foldSalesReportData,
    parseReturnedItems,
    parseSalesReportRange,
    parseShiftCloseReportPayload,
    resolveSalesReportScope,
    saleVatFromSnapshot,
    type FoldSalesReportInput,
    type ReturnRecordInput,
    type ReturnedItemAuthority,
} from '../backend/lib/salesReport';
import {
    buildShiftCloseReport,
    canonicalShiftCloseReportJson,
} from '../backend/lib/shiftCloseReport';

const errorFrom = (run: () => unknown): SalesReportError => {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(SalesReportError);
        return error as SalesReportError;
    }
    throw new Error('Se esperaba SalesReportError');
};

const authorities = () => new Map<string, ReturnedItemAuthority>([
    ['line-base', {
        saleItemId: 'line-base', productId: 'base-1', productName: 'Arroz', unit: 'lb',
        saleMode: 'MEASURED', presentation: 'BASE', presentationQuantityAtSale: null,
        soldQuantityAtSale: '5', costAtSale: '30', ivaExento: false,
    }],
    ['line-pack', {
        saleItemId: 'line-pack', productId: 'pack-1', productName: 'Gaseosa', unit: 'unidad',
        saleMode: 'COUNTED', presentation: 'PACK', presentationQuantityAtSale: '2',
        soldQuantityAtSale: '24', costAtSale: '3', ivaExento: false,
    }],
]);

const returnRecords = (): ReturnRecordInput[] => [
    {
        id: 'return-base', saleId: 'sale-base', createdAt: '2026-08-30T23:00:00.000Z',
        total: '28.75', paymentMethod: 'CASH', fiscalRegimeAtSale: 'GENERAL',
        saleTotal: '115', saleExemptTotal: '0', saleVatAmountAtSale: '15',
        reason: 'Parcial',
        items: [{ saleItemId: 'line-base', quantity: '0.5', lineTotal: '28.75', ivaExento: false }],
    },
    {
        id: 'return-legacy', saleId: 'sale-legacy', createdAt: '2026-08-31T05:59:59.999Z',
        total: '6.50', paymentMethod: 'CARD', fiscalRegimeAtSale: 'CUOTA_FIJA',
        saleTotal: '65', saleExemptTotal: '0', saleVatAmountAtSale: null,
        reason: 'Documento legado',
        items: JSON.stringify([{
            productId: 'legacy', name: 'Jabon', unit: 'unidad', saleModeAtSale: 'COUNTED',
            presentation: 'BASE', quantity: '2', price: '3.25',
        }]),
    },
    {
        id: 'return-pack', saleId: 'sale-pack', createdAt: '2026-08-31T06:00:00.000Z',
        total: '115', paymentMethod: 'TRANSFER', fiscalRegimeAtSale: 'GENERAL',
        saleTotal: '230', saleExemptTotal: '0', saleVatAmountAtSale: '30',
        reason: 'Caja parcial',
        items: [{ saleItemId: 'line-pack', quantity: '12', lineTotal: '115', ivaExento: false }],
    },
];

const makeFoldInput = (): FoldSalesReportInput => ({
    range: parseSalesReportRange('2026-08-30', '2026-08-31'),
    sales: {
        grossSales: '460.60', grossVat: '60.10', transactionCount: 7,
        productGrossSales: '460.60', grossCogs: '220', discountTotal: '4.40',
        itemQuantityGross: '30',
    },
    paymentRows: [
        { method: 'CASH', transactionCount: 1, grossSales: '115' },
        { method: 'CARD', transactionCount: 2, grossSales: '230' },
        { method: 'QR', transactionCount: 1, grossSales: '0.1' },
        { method: 'CREDIT', transactionCount: 1, grossSales: '0.2' },
        { method: 'TRANSFER', transactionCount: 2, grossSales: '115.3' },
    ],
    productRows: [
        {
            productId: 'base-1', productName: 'Arroz', saleMode: 'MEASURED', presentation: 'BASE',
            baseUnit: 'lb', displayUnit: 'lb', quantityGross: '5', baseQuantityGross: '5',
            grossSales: '115', cogs: '50',
        },
        {
            productId: 'pack-1', productName: 'Gaseosa', saleMode: 'COUNTED', presentation: 'PACK',
            baseUnit: 'unidad', displayUnit: 'empaque(s) · base unidad', quantityGross: '2',
            baseQuantityGross: '24', grossSales: '230', cogs: '120',
        },
        {
            productId: 'legacy', productName: 'Jabon', saleMode: 'COUNTED', presentation: 'BASE',
            baseUnit: 'unidad', displayUnit: 'unidad', quantityGross: '2', baseQuantityGross: '2',
            grossSales: '6.5', cogs: '3',
        },
        {
            productId: 'qr-1', productName: 'Bolsa', saleMode: 'COUNTED', presentation: 'BASE',
            baseUnit: 'unidad', displayUnit: 'unidad', quantityGross: '1', baseQuantityGross: '1',
            grossSales: '0.1', cogs: '0.05',
        },
        {
            productId: 'credit-1', productName: 'Liga', saleMode: 'COUNTED', presentation: 'BASE',
            baseUnit: 'unidad', displayUnit: 'unidad', quantityGross: '1', baseQuantityGross: '1',
            grossSales: '0.2', cogs: '0.1',
        },
        {
            productId: 'transfer-1', productName: 'Clavo', saleMode: 'COUNTED', presentation: 'BASE',
            baseUnit: 'unidad', displayUnit: 'unidad', quantityGross: '1', baseQuantityGross: '1',
            grossSales: '108.8', cogs: '46.85',
        },
    ],
    dailyRows: [
        { date: '2026-08-30', grossSales: '345.20', grossVat: '45.10', transactionCount: 5 },
        { date: '2026-08-31', grossSales: '115.40', grossVat: '15', transactionCount: 2 },
    ],
    expenseRows: [
        { date: '2026-08-30', expenses: '10' },
        { date: '2026-08-31', expenses: '2' },
    ],
    returnRecords: returnRecords(),
    returnedItemAuthorities: authorities(),
});

const rotate = <T>(values: readonly T[], places: number): T[] => {
    const offset = values.length === 0 ? 0 : places % values.length;
    return [...values.slice(offset), ...values.slice(0, offset)];
};

describe('rango civil del reporte en America/Managua', () => {
    it('usa 06:00Z como inicio y un final exclusivo', () => {
        const range = parseSalesReportRange('2026-08-30', '2026-08-31');
        expect(range).toMatchObject({ startDate: '2026-08-30', endDate: '2026-08-31', days: 2 });
        expect(range.start.toISOString()).toBe('2026-08-30T06:00:00.000Z');
        expect(range.endExclusive.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    });

    it('acepta exactamente 366 dias, incluido el 29 de febrero', () => {
        const range = parseSalesReportRange('2024-01-01', '2024-12-31');
        expect(range.days).toBe(366);
        expect(range.endExclusive.toISOString()).toBe('2025-01-01T06:00:00.000Z');
    });

    it('rechaza 367 dias y respeta limites mas estrictos por documento', () => {
        expect(errorFrom(() => parseSalesReportRange('2024-01-01', '2025-01-01')).code)
            .toBe('REPORT_RANGE_TOO_LARGE');
        const documentError = errorFrom(() => parseSalesReportRange(
            '2026-07-01', '2026-08-01', { maxDays: 31 },
        ));
        expect(documentError).toMatchObject({ code: 'REPORT_RANGE_TOO_LARGE', httpStatus: 422 });
    });

    it('acepta exactamente 31 dias de documento y rechaza el dia 32', () => {
        expect(parseSalesReportRange('2026-08-01', '2026-08-31', { maxDays: 31 }).days).toBe(31);
        expect(errorFrom(() => parseSalesReportRange(
            '2026-08-01', '2026-09-01', { maxDays: 31 },
        ))).toMatchObject({ code: 'REPORT_RANGE_TOO_LARGE', httpStatus: 422 });
    });

    it('acepta un único día cuando maxDays es exactamente 1', () => {
        expect(parseSalesReportRange(
            '2026-08-30',
            '2026-08-30',
            { maxDays: 1 },
        )).toMatchObject({ days: 1, startDate: '2026-08-30', endDate: '2026-08-30' });
    });

    it.each([
        [undefined, '2026-08-30', 'REPORT_DATE_REQUIRED'],
        ['2026-08-30', null, 'REPORT_DATE_REQUIRED'],
        ['30/08/2026', '2026-08-31', 'REPORT_DATE_INVALID'],
        ['2026-02-30', '2026-03-01', 'REPORT_DATE_INVALID'],
        ['0000-01-01', '2026-03-01', 'REPORT_DATE_INVALID'],
        ['2026-00-01', '2026-03-01', 'REPORT_DATE_INVALID'],
        ['2026-13-01', '2027-01-01', 'REPORT_DATE_INVALID'],
        ['2026-01-00', '2026-03-01', 'REPORT_DATE_INVALID'],
        ['2026-01-32', '2026-03-01', 'REPORT_DATE_INVALID'],
        ['2026-01-01', '2026-02-30', 'REPORT_DATE_INVALID'],
        ['2026-08-31', '2026-08-30', 'REPORT_DATE_ORDER_INVALID'],
    ])('rechaza rango ambiguo %s - %s', (start, end, code) => {
        expect(errorFrom(() => parseSalesReportRange(start, end)).code).toBe(code);
    });

    it.each([0, -1, 1.5, Number.NaN])('rechaza maxDays inválido: %s', (maxDays) => {
        expect(errorFrom(() => parseSalesReportRange(
            '2026-08-30',
            '2026-08-30',
            { maxDays },
        ))).toMatchObject({
            code: 'REPORT_RANGE_TOO_LARGE',
            httpStatus: 422,
            message: `El rango máximo permitido es de ${maxDays} días. Reducí el período.`,
        });
    });

    it('conserva mensajes operables para cada rechazo de rango', () => {
        expect(errorFrom(() => parseSalesReportRange(null, '2026-08-30')).message)
            .toBe('Indicá startDate y endDate en formato YYYY-MM-DD.');
        expect(errorFrom(() => parseSalesReportRange('2026-02-30', '2026-08-30')).message)
            .toBe('Las fechas deben existir y usar el formato YYYY-MM-DD.');
        expect(errorFrom(() => parseSalesReportRange('2026-08-31', '2026-08-30')).message)
            .toBe('endDate no puede ser anterior a startDate.');
        expect(errorFrom(() => parseSalesReportRange(
            '2026-08-01',
            '2026-09-01',
            { maxDays: 31 },
        )).message).toBe('El rango máximo permitido es de 31 días. Reducí el período.');
    });

    it('el rango predeterminado no salta al dia UTC siguiente antes de medianoche local', () => {
        const range = defaultSalesReportRange(new Date('2026-08-31T05:59:59.999Z'), 1);
        expect(range.startDate).toBe('2026-08-30');
        expect(range.endDate).toBe('2026-08-30');
    });
});

describe('alcance de lectura por rol', () => {
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER']) (
        '%s ve el tenant autenticado completo',
        (role) => expect(resolveSalesReportScope(role, 'user-auth')).toEqual({ kind: 'tenant' }),
    );

    it('VENDEDOR solo obtiene sus ventas', () => {
        expect(resolveSalesReportScope('VENDEDOR', 'seller-auth')).toEqual({
            kind: 'seller', userId: 'seller-auth',
        });
    });

    it.each(['CASHIER', 'EMPLOYEE'])('%s solo obtiene sus turnos', (role) => {
        expect(resolveSalesReportScope(role, 'cashier-auth')).toEqual({
            kind: 'shift-owner', userId: 'cashier-auth',
        });
    });

    it.each(['BODEGUERO', 'ROL_FUTURO', '', undefined])('falla cerrado para %s', (role) => {
        expect(errorFrom(() => resolveSalesReportScope(role, 'user-auth'))).toMatchObject({
            code: 'REPORT_ROLE_FORBIDDEN', httpStatus: 403,
        });
    });

    it.each([null, undefined, '', '   '])('no acepta identidad vacia: %s', (userId) => {
        expect(errorFrom(() => resolveSalesReportScope('OWNER', userId))).toMatchObject({
            code: 'REPORT_PRINCIPAL_INVALID', httpStatus: 401,
        });
    });
});

describe('lectura de devoluciones modernas, legacy y PACK', () => {
    it('usa snapshots autoritativos y prorratea una devolucion parcial de empaque', () => {
        const parsed = parseReturnedItems([
            { saleItemId: 'line-base', productId: 'forjado', quantity: '0.5', lineTotal: '28.75' },
            { saleItemId: 'line-pack', quantity: '12', lineTotal: '115' },
            {
                productId: 'legacy', name: 'Jabon', unit: 'unidad', saleModeAtSale: 'COUNTED',
                quantity: '2', price: '3.25', presentation: 'BASE',
            },
        ], authorities());

        expect(parsed.invalidItemCount).toBe(0);
        expect(parsed.items).toEqual([
            expect.objectContaining({
                saleItemId: 'line-base', productId: 'base-1', productName: 'Arroz',
                presentation: 'BASE', baseQuantity: '0.5', displayQuantity: '0.5', lineTotal: '28.75',
            }),
            expect.objectContaining({
                saleItemId: 'line-pack', productId: 'pack-1', presentation: 'PACK',
                baseQuantity: '12', displayQuantity: '1', lineTotal: '115',
            }),
            expect.objectContaining({
                saleItemId: null, productId: 'legacy', productName: 'Jabon', saleMode: 'COUNTED',
                baseQuantity: '2', displayQuantity: '2', lineTotal: '6.5',
            }),
        ]);
    });

    it('acepta JSON histórico y cuenta cada linea corrupta sin perder el total del documento', () => {
        const parsed = parseReturnedItems(JSON.stringify([
            { productId: 'legacy', name: 'Jabon', quantity: '2', price: '3.25' },
            null,
            { productId: 'zero', quantity: 0, price: 10 },
            { productId: 'sin-precio', quantity: 1 },
        ]));

        expect(parsed.items).toHaveLength(1);
        expect(parsed.items[0].lineTotal).toBe('6.5');
        expect(parsed.invalidItemCount).toBe(3);
        expect(parseReturnedItems('{mal json')).toEqual({ items: [], invalidItemCount: 1 });
    });
});

describe('fold Decimal del reporte completo', () => {
    it('cuadra ventas, devoluciones, IVA, costo, utilidad y ticket', () => {
        const report = foldSalesReportData(makeFoldInput());

        expect(report.summary).toEqual({
            grossSales: '460.60', returnsTotal: '150.25', netSales: '310.35',
            vatCollected: '41.35', netRevenue: '269.00', cogs: '169.00', grossProfit: '100.00',
            transactionCount: 7, returnCount: 3, averageTicket: '65.80', discountTotal: '4.40',
            itemQuantityGross: '30', itemQuantityReturned: '14.5', itemQuantityNet: '15.5',
            roundingAdjustment: '0.00',
        });
        expect(report.period).toEqual({
            startDate: '2026-08-30', endDate: '2026-08-31',
            start: '2026-08-30T06:00:00.000Z', endExclusive: '2026-09-01T06:00:00.000Z',
            timeZone: 'America/Managua', days: 2,
        });
        expect(report.totalVentas).toBe(460.6);
        expect(report.ivaRecaudado).toBe(41.35);
        expect(report.utilidadBruta).toBe(100);
    });

    it('conserva auditable el valor de una línea corrupta sin cargarlo a otro producto', () => {
        const input = makeFoldInput();
        input.returnRecords = [{
            id: 'return-partial-corrupt',
            saleId: 'sale-base',
            createdAt: '2026-08-30T23:00:00.000Z',
            total: '100',
            paymentMethod: 'CASH',
            fiscalRegimeAtSale: 'GENERAL',
            saleTotal: '200',
            saleExemptTotal: '0',
            saleVatAmountAtSale: '30',
            items: [
                { saleItemId: 'line-base', quantity: '1', lineTotal: '40', ivaExento: false },
                { saleItemId: 'line-pack', quantity: 'invalid', lineTotal: '60', ivaExento: false },
            ],
        }];

        const report = foldSalesReportData(input);
        expect(report.returns[0]).toMatchObject({
            total: '100.00',
            invalidItemCount: 1,
            unallocatedTotal: '60.00',
        });
        expect(report.products.find((row) => row.productId === 'base-1')?.returnsTotal).toBe('40.00');
        expect(report.summary.returnsTotal).toBe('100.00');
        expect(report.summary.roundingAdjustment).toBe('-60.00');
    });

    it('mantiene separados los cinco metodos y les descuenta sus devoluciones', () => {
        const methods = foldSalesReportData(makeFoldInput()).paymentMethods;
        expect(methods.map((row) => row.method)).toEqual(['CARD', 'CASH', 'CREDIT', 'QR', 'TRANSFER']);
        expect(Object.fromEntries(methods.map((row) => [row.method, row]))).toMatchObject({
            CASH: { grossSales: '115.00', returnsTotal: '28.75', netSales: '86.25', returnCount: 1 },
            CARD: { grossSales: '230.00', returnsTotal: '6.50', netSales: '223.50', returnCount: 1 },
            CREDIT: { grossSales: '0.20', returnsTotal: '0.00', netSales: '0.20' },
            QR: { grossSales: '0.10', returnsTotal: '0.00', netSales: '0.10' },
            TRANSFER: { grossSales: '115.30', returnsTotal: '115.00', netSales: '0.30', returnCount: 1 },
        });
    });

    it('resta BASE, legacy y PACK en la unidad visible correcta', () => {
        const products = foldSalesReportData(makeFoldInput()).products;
        const base = products.find((row) => row.productId === 'base-1');
        const pack = products.find((row) => row.productId === 'pack-1');
        const legacy = products.find((row) => row.productId === 'legacy');

        expect(base).toMatchObject({
            presentation: 'BASE', quantitySold: '5', quantityReturned: '0.5', quantityNet: '4.5',
            grossSales: '115.00', returnsTotal: '28.75', netSales: '86.25', cogs: '35.00',
        });
        expect(pack).toMatchObject({
            presentation: 'PACK', quantitySold: '2', quantityReturned: '1', quantityNet: '1',
            grossSales: '230.00', returnsTotal: '115.00', netSales: '115.00', cogs: '84.00',
        });
        expect(legacy).toMatchObject({
            presentation: 'BASE', quantitySold: '2', quantityReturned: '2', quantityNet: '0',
            grossSales: '6.50', returnsTotal: '6.50', netSales: '0.00', cogs: '3.00',
        });
    });

    it('reconcilia una devolución con la misma fila cuando la unidad histórica usa fallback', () => {
        const fallbackAuthorities = new Map<string, ReturnedItemAuthority>([[
            'line-fallback',
            {
                saleItemId: 'line-fallback', productId: 'fallback-1', productName: 'Producto sin unidad',
                unit: 'unidad', usedFallbackUnit: true, saleMode: 'COUNTED', presentation: 'BASE',
                presentationQuantityAtSale: null, soldQuantityAtSale: '1', costAtSale: '60',
                ivaExento: false,
            },
        ]]);
        const report = foldSalesReportData({
            range: parseSalesReportRange('2026-08-30', '2026-08-30'),
            sales: {
                grossSales: '115', grossVat: '15', transactionCount: 1,
                productGrossSales: '115', grossCogs: '60', discountTotal: '0',
                itemQuantityGross: '1',
            },
            paymentRows: [{ method: 'CASH', transactionCount: 1, grossSales: '115' }],
            productRows: [{
                productId: 'fallback-1', productName: 'Producto sin unidad', saleMode: 'COUNTED',
                presentation: 'BASE', baseUnit: 'unidad', displayUnit: 'unidad (fallback)',
                usedFallbackUnit: true, quantityGross: '1', baseQuantityGross: '1',
                grossSales: '115', grossVat: '15', cogs: '60',
            }],
            dailyRows: [{ date: '2026-08-30', grossSales: '115', grossVat: '15', transactionCount: 1 }],
            expenseRows: [],
            returnRecords: [{
                id: 'return-fallback', saleId: 'sale-fallback', createdAt: '2026-08-30T18:00:00.000Z',
                total: '57.5', paymentMethod: 'CASH', fiscalRegimeAtSale: 'GENERAL',
                saleTotal: '115', saleExemptTotal: '0', saleVatAmountAtSale: '15',
                items: [{ saleItemId: 'line-fallback', quantity: '0.5', lineTotal: '57.5' }],
            }],
            returnedItemAuthorities: fallbackAuthorities,
        });

        expect(report.products).toHaveLength(1);
        expect(report.products[0]).toMatchObject({
            productId: 'fallback-1', displayUnit: 'unidad (fallback)', usedFallbackUnit: true,
            quantitySold: '1', quantityReturned: '0.5', quantityNet: '0.5',
            grossSales: '115.00', returnsTotal: '57.50', netSales: '57.50', cogs: '30.00',
        });
    });

    it('asigna cada instantanea al dia Managua y consolida el mes', () => {
        const report = foldSalesReportData(makeFoldInput());
        expect(report.daily).toEqual([
            {
                date: '2026-08-30', grossSales: '345.20', returnsTotal: '35.25', netSales: '309.95',
                vatCollected: '41.35', transactionCount: 5, returnCount: 2, expenses: '10.00',
            },
            {
                date: '2026-08-31', grossSales: '115.40', returnsTotal: '115.00', netSales: '0.40',
                vatCollected: '0.00', transactionCount: 2, returnCount: 1, expenses: '2.00',
            },
        ]);
        expect(report.monthly).toEqual([{
            month: '2026-08', grossSales: '460.60', returnsTotal: '150.25', netSales: '310.35',
            vatCollected: '41.35', transactionCount: 7, returnCount: 3, expenses: '12.00',
        }]);
    });

    it('es determinista durante 10 rondas aunque las agregaciones lleguen reordenadas', () => {
        const expected = JSON.stringify(foldSalesReportData(makeFoldInput()));
        for (let round = 0; round < 10; round += 1) {
            const input = makeFoldInput();
            input.paymentRows = rotate(input.paymentRows, round);
            input.productRows = rotate(input.productRows, round * 2);
            input.dailyRows = rotate(input.dailyRows, round);
            input.expenseRows = rotate(input.expenseRows, round);
            input.returnRecords = rotate(input.returnRecords, round * 2);
            expect(JSON.stringify(foldSalesReportData(input))).toBe(expected);
        }
    });
});

describe('regresion del IVA fiscal del reporte', () => {
    it('CUOTA_FIJA no inventa IVA aunque la fila corrupta traiga snapshot', () => {
        expect(saleVatFromSnapshot({
            total: '550', fiscalRegimeAtSale: 'CUOTA_FIJA', vatAmountAtSale: '71.74',
        }).toFixed(4)).toBe('0.0000');
    });

    it('GENERAL respeta snapshot y el fallback legacy solo grava lo no exento', () => {
        expect(saleVatFromSnapshot({
            total: '550', fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: '71.7391',
        }).toFixed(4)).toBe('71.7391');
        expect(saleVatFromSnapshot({
            total: '200', exemptTotal: '100', fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: null,
        }).toFixed(4)).toBe('13.0435');
    });
});

describe('parser defensivo del snapshot de cierre', () => {
    const validPayload = () => buildShiftCloseReport({
        folio: 'Z-20260830-1', businessDate: '2026-08-30',
        generatedAt: new Date('2026-08-31T01:00:00.000Z'),
        business: { name: 'Negocio', taxId: 'J031', address: null, phone: null },
        shift: {
            id: 'shift-1', openedAt: new Date('2026-08-30T12:00:00.000Z'),
            closedAt: new Date('2026-08-31T01:00:00.000Z'), openedBy: 'Duena',
            cashierName: 'Caja', closedBy: 'Duena', auditNotes: null,
        },
        payments: [{ method: 'CASH', transactionCount: 1, grossSales: '115' }],
        soldProducts: [{
            productId: 'p1', productName: 'Arroz', unit: 'lb', saleMode: 'MEASURED',
            presentation: 'BASE', quantity: '1', amount: '115', cogs: '60',
        }],
        returnedProducts: [], returns: { count: 0, total: '0', vat: '0', cogs: '0' },
        fiscal: { vatCollectedBeforeReturns: '15', discountTotal: '0' },
        cash: {
            openingNio: '100', expectedNio: '215', countedNio: '215', differenceNio: '0',
            openingUsd: '0', expectedUsd: '0', countedUsd: '0', differenceUsd: '0', cashRefundsNio: '0',
        },
        movements: [],
    });

    it('acepta el contrato completo sin transformarlo', () => {
        const payload = validPayload();
        const parsed = parseShiftCloseReportPayload(payload);
        expect(parsed).not.toBeNull();
        expect(canonicalShiftCloseReportJson(parsed)).toBe(canonicalShiftCloseReportJson(payload));
    });

    it('rechaza fechas civiles imposibles y timestamps rotos', () => {
        const invalidDay = { ...validPayload(), businessDate: '2026-02-31' };
        expect(parseShiftCloseReportPayload(invalidDay)).toBeNull();

        const invalidOpenedAt = validPayload();
        invalidOpenedAt.shift.openedAt = 'no-es-fecha';
        expect(parseShiftCloseReportPayload(invalidOpenedAt)).toBeNull();

        const invalidGeneratedAt = { ...validPayload(), generatedAt: 'ayer' };
        expect(parseShiftCloseReportPayload(invalidGeneratedAt)).toBeNull();
    });

    it('rechaza montos no finitos y arrays fuera de limite', () => {
        const invalidMoney = validPayload();
        invalidMoney.summary.grossSales = 'Infinity';
        expect(parseShiftCloseReportPayload(invalidMoney)).toBeNull();

        const tooManyProducts = validPayload();
        tooManyProducts.products = Array.from({ length: 10_001 }, () => tooManyProducts.products[0]);
        expect(parseShiftCloseReportPayload(tooManyProducts)).toBeNull();
    });
});
