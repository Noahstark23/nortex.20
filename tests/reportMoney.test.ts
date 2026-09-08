import { describe, expect, it } from 'vitest';
import {
    allocateReturnMoney,
    calculateHistoricalReportVat,
    calculateProductReportTotals,
    calculateReportProfit,
    calculateReportTotals,
    divideReportValues,
    formatReportMoney,
    formatReportQuantity,
    multiplyReportValues,
    netReportValue,
    sumReportValues,
} from '../backend/lib/reportMoney';

const text = (value: { toString(): string }): string => value.toString();

describe('primitivas Decimal del reporte', () => {
    it('redondea dinero y cantidades con HALF_UP sin pasar por Number', () => {
        expect(formatReportMoney('1.005')).toBe('1.01');
        expect(formatReportMoney('-1.005')).toBe('-1.01');
        expect(formatReportMoney('0')).toBe('0.00');
        expect(formatReportQuantity('1.23456')).toBe('1.2346');
        expect(formatReportQuantity('-1.23455')).toBe('-1.2346');
        expect(formatReportQuantity('1.0000')).toBe('1');
    });

    it('suma, resta, multiplica y divide decimales exactos', () => {
        expect(text(sumReportValues([]))).toBe('0');
        expect(text(sumReportValues(['0.1', '0.2', { toString: () => '0.0001' }]))).toBe('0.3001');
        expect(text(netReportValue('100.10', '0.2'))).toBe('99.9');
        expect(text(multiplyReportValues('0.1', '0.2'))).toBe('0.02');
        expect(text(divideReportValues('1', '8'))).toBe('0.125');
        expect(text(calculateReportProfit('100', '13.04', '40.01'))).toBe('46.95');
    });
});

describe('IVA histórico del reporte', () => {
    it('CUOTA_FIJA siempre reporta cero, incluso con snapshot corrupto', () => {
        expect(text(calculateHistoricalReportVat({
            total: '115',
            exemptTotal: '0',
            fiscalRegimeAtSale: 'CUOTA_FIJA',
            vatAmountAtSale: '99',
        }))).toBe('0');
    });

    it('acepta snapshots dentro del gravado, incluidos cero y el borde superior', () => {
        expect(text(calculateHistoricalReportVat({
            total: '115', exemptTotal: '15', vatAmountAtSale: '0',
        }))).toBe('0');
        expect(text(calculateHistoricalReportVat({
            total: '115', exemptTotal: '15', vatAmountAtSale: '100',
        }))).toBe('100');
        expect(text(calculateHistoricalReportVat({
            total: '115', exemptTotal: '0', vatAmountAtSale: '15.12345',
        }))).toBe('15.1235');
    });

    it.each([
        [null, '15'],
        ['-0.01', '15'],
        ['115.01', '15'],
        ['NaN', '15'],
        [Number.POSITIVE_INFINITY, '15'],
    ])('usa fórmula legacy ante snapshot inválido %s', (vatAmountAtSale, expected) => {
        expect(text(calculateHistoricalReportVat({
            total: '115',
            exemptTotal: '0',
            vatAmountAtSale,
        }))).toBe(expected);
    });

    it('acota total y exento sin producir IVA negativo', () => {
        expect(text(calculateHistoricalReportVat({ total: '-1', exemptTotal: '0' }))).toBe('0');
        expect(text(calculateHistoricalReportVat({ total: '115', exemptTotal: '-50' }))).toBe('15');
        expect(text(calculateHistoricalReportVat({ total: '115', exemptTotal: '999' }))).toBe('0');
        expect(text(calculateHistoricalReportVat({ total: '115' }))).toBe('15');
        expect(text(calculateHistoricalReportVat({ total: '115', exemptTotal: null }))).toBe('15');
    });
});

describe('totales monetarios del reporte', () => {
    it('calcula neto, IVA, costo, utilidad, cantidades, ticket y redondeo', () => {
        const totals = calculateReportTotals({
            grossSales: '460.60',
            returnsTotal: '35.25',
            grossVat: '60.10',
            returnedVat: '4.25',
            grossCogs: '220',
            returnedCogs: '12.50',
            transactionCount: 7,
            quantityGross: '30',
            quantityReturned: '2.5',
            productGrossSales: '460.50',
            allocatedReturnTotal: '30.25',
        });

        expect(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, text(value)])))
            .toEqual({
                grossSales: '460.6',
                returnsTotal: '35.25',
                netSales: '425.35',
                vatCollected: '55.85',
                netRevenue: '369.5',
                cogs: '207.5',
                grossProfit: '162',
                averageTicket: '65.8',
                quantityNet: '27.5',
                roundingAdjustment: '-4.9',
            });
    });

    it.each([0, -1])('el ticket promedio es cero con %s transacciones', (transactionCount) => {
        const totals = calculateReportTotals({
            grossSales: '100', returnsTotal: '0', grossVat: '0', returnedVat: '0',
            grossCogs: '0', returnedCogs: '0', transactionCount,
            quantityGross: '0', quantityReturned: '0', productGrossSales: '100',
            allocatedReturnTotal: '0',
        });
        expect(text(totals.averageTicket)).toBe('0');
    });

    it('mantiene todos los campos del desglose por producto', () => {
        const totals = calculateProductReportTotals({
            quantityGross: '12', quantityReturned: '2', grossSales: '230',
            returnsTotal: '38.33', grossVat: '30', returnedVat: '5',
            grossCogs: '120', returnedCogs: '20',
        });
        expect(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, text(value)])))
            .toEqual({
                quantityNet: '10',
                netSales: '191.67',
                netVat: '25',
                netCogs: '100',
                grossProfit: '66.67',
            });
    });
});

describe('prorrateo monetario de devoluciones', () => {
    it('prorratea y entrega el residuo exacto a la última línea', () => {
        const result = allocateReturnMoney({
            total: '100',
            saleTotal: '300',
            saleVat: '39.1304',
            fiscalRegimeAtSale: 'GENERAL',
            lines: [
                { lineTotal: '1', baseQuantity: '2', costAtSale: '3', ivaExento: false },
                { lineTotal: '2', baseQuantity: '4', costAtSale: null, ivaExento: true },
            ],
        });

        expect(text(result.total)).toBe('100');
        expect(text(result.lines[0].allocatedTotal)).toBe('33.3333');
        expect(text(result.lines[1].allocatedTotal)).toBe('66.6667');
        expect(text(sumReportValues(result.lines.map((line) => line.allocatedTotal)))).toBe('100');
        expect(text(result.lines[0].returnedVat)).toBe('4.3478');
        expect(text(result.lines[1].returnedVat)).toBe('0');
        expect(text(result.lines[0].returnedCogs)).toBe('6');
        expect(text(result.lines[1].returnedCogs)).toBe('0');
        expect(text(result.unallocatedTotal)).toBe('0');
        expect(text(result.unallocatedVat)).toBe('0');
    });

    it('con tres líneas iguales reserva el centésimo residual para la última', () => {
        const result = allocateReturnMoney({
            total: '100',
            saleTotal: '100',
            saleVat: '0',
            fiscalRegimeAtSale: 'CUOTA_FIJA',
            lines: [
                { lineTotal: '1', baseQuantity: '1', costAtSale: null, ivaExento: true },
                { lineTotal: '1', baseQuantity: '1', costAtSale: null, ivaExento: true },
                { lineTotal: '1', baseQuantity: '1', costAtSale: null, ivaExento: true },
            ],
        });

        expect(result.lines.map((line) => text(line.allocatedTotal)))
            .toEqual(['33.3333', '33.3333', '33.3334']);
        expect(text(sumReportValues(result.lines.map((line) => line.allocatedTotal)))).toBe('100');
        expect(text(result.unallocatedTotal)).toBe('0');
    });

    it('CUOTA_FIJA no devuelve IVA aunque la línea sea gravada', () => {
        const result = allocateReturnMoney({
            total: '115', saleTotal: '115', saleVat: '15', fiscalRegimeAtSale: 'CUOTA_FIJA',
            lines: [{ lineTotal: '115', baseQuantity: '1', costAtSale: '50', ivaExento: false }],
        });
        expect(text(result.lines[0].returnedVat)).toBe('0');
        expect(text(result.lines[0].returnedCogs)).toBe('50');
    });

    it('usa el ratio histórico cuando la exención de la línea es desconocida', () => {
        const result = allocateReturnMoney({
            total: '50', saleTotal: '200', saleVat: '20', fiscalRegimeAtSale: 'GENERAL',
            lines: [{ lineTotal: '50', baseQuantity: '1', costAtSale: null, ivaExento: null }],
        });
        expect(text(result.lines[0].returnedVat)).toBe('5');
    });

    it('mantiene como remanente un documento legacy sin líneas asignables', () => {
        const result = allocateReturnMoney({
            total: '50.00006', saleTotal: '100', saleVat: '15', fiscalRegimeAtSale: 'GENERAL',
            lines: [],
        });
        expect(text(result.total)).toBe('50.0001');
        expect(result.lines).toEqual([]);
        expect(text(result.unallocatedTotal)).toBe('50.0001');
        expect(text(result.unallocatedVat)).toBe('7.500015');
    });

    it('no atribuye a una línea sana el monto de otra línea ilegible', () => {
        const result = allocateReturnMoney({
            total: '100', saleTotal: '200', saleVat: '30', fiscalRegimeAtSale: 'GENERAL',
            fullyAllocateTotal: false,
            lines: [{ lineTotal: '40', baseQuantity: '1', costAtSale: '10', ivaExento: false }],
        });

        expect(text(result.lines[0].allocatedTotal)).toBe('40');
        expect(text(result.unallocatedTotal)).toBe('60');
        expect(text(result.unallocatedVat)).toBe('9');
    });

    it('una venta histórica inválida no produce ratio ni remanente negativo', () => {
        const result = allocateReturnMoney({
            total: '-10', saleTotal: '-100', saleVat: '15', fiscalRegimeAtSale: 'GENERAL',
            lines: [{ lineTotal: '0', baseQuantity: '1', costAtSale: null, ivaExento: null }],
        });
        expect(text(result.total)).toBe('0');
        expect(text(result.lines[0].allocatedTotal)).toBe('0');
        expect(text(result.lines[0].returnedVat)).toBe('0');
        expect(text(result.unallocatedTotal)).toBe('0');
        expect(text(result.unallocatedVat)).toBe('0');
    });
});
