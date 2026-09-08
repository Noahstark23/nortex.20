import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Decimal from 'decimal.js';
import { vatCollectedFromSale } from '../utils/fiscalRegime';
import { calculateReportTotals } from '../backend/lib/reportMoney';

/**
 * El reporte de ventas dejaba de suponer que TODO córdoba trae IVA adentro.
 *
 * El bug medido en la app real (un negocio en CUOTA_FIJA, tres ventas del día):
 * /api/reports/sales devolvía `ivaRecaudado: 215.22` cuando las ventas mismas
 * guardaban 71.74. Inventaba C$ 143.48 de IVA —el de la venta de cuota fija más
 * el de una venta exonerada— y le restaba esa misma plata a la utilidad bruta.
 * Y no era un número escondido: la pantalla de Reportes lo rotula
 * "IVA RECAUDADO (15%) · Para declarar a la DGI".
 *
 * La regla ahora sale de la venta, no de una suposición sobre el período.
 */

const raiz = join(__dirname, '..');
const leer = (ruta: string) => readFileSync(join(raiz, ruta), 'utf-8');

const iva = (sale: Parameters<typeof vatCollectedFromSale>[0]) =>
    vatCollectedFromSale(sale).toFixed(4);

describe('IVA realmente trasladado por una venta', () => {
    it('cuota fija no traslada IVA', () => {
        expect(iva({ total: 550, fiscalRegimeAtSale: 'CUOTA_FIJA', vatAmountAtSale: 0 })).toBe('0.0000');
    });

    it('cuota fija ignora un IVA guardado corrupto', () => {
        // Espejo de la defensa que ya tiene generateMonthlyReport: aunque una
        // fila traiga IVA, cuota fija no alimenta ningún impuesto del general.
        expect(iva({ total: 550, fiscalRegimeAtSale: 'CUOTA_FIJA', vatAmountAtSale: 71.74 })).toBe('0.0000');
    });

    it('con snapshot manda el snapshot, no el 15% de hoy', () => {
        // Cambiar de régimen NO reescribe la historia: lo que se imprimió y se
        // asentó el día de la venta es lo que vale.
        expect(iva({ total: 550, fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: 71.7391 })).toBe('71.7391');
        expect(iva({ total: 550, fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: 0 })).toBe('0.0000');
    });

    it('sin snapshot (venta legacy) recalcula el comportamiento histórico', () => {
        expect(iva({ total: 550, fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: null })).toBe('71.7391');
        expect(iva({ total: 115, fiscalRegimeAtSale: 'GENERAL' })).toBe('15.0000');
    });

    it('sin snapshot, lo exonerado no paga IVA', () => {
        // Canasta básica y medicinas: la mitad exonerada no genera IVA.
        expect(iva({ total: 200, exemptTotal: 100, vatAmountAtSale: null })).toBe('13.0435');
        expect(iva({ total: 200, exemptTotal: 200, vatAmountAtSale: null })).toBe('0.0000');
    });

    it('con snapshot, valida el IVA contra la porción realmente gravada', () => {
        // Con C$ 60 exonerados solo quedan C$ 40 contra los que se puede
        // validar el snapshot. Sin exoneración, el mismo snapshot sí cabe.
        expect(() => vatCollectedFromSale({
            total: 100,
            exemptTotal: 60,
            vatAmountAtSale: 41,
        })).toThrowError('El IVA guardado debe estar entre cero y el total gravado de la venta');
        expect(iva({ total: 100, exemptTotal: null, vatAmountAtSale: 41 })).toBe('41.0000');
    });

    it.each([
        ['NaN', Number.NaN, null],
        ['Infinity', Number.POSITIVE_INFINITY, undefined],
        ['NaN con snapshot', Number.NaN, 0],
        ['Infinity con snapshot', Number.POSITIVE_INFINITY, 0],
    ])('rechaza un total exonerado no finito: %s', (_caso, exemptTotal, vatAmountAtSale) => {
        expect(() => vatCollectedFromSale({
            total: 100,
            exemptTotal,
            vatAmountAtSale,
        })).toThrowError('El total exonerado debe ser finito');
    });

    it('un exento inconsistente se acota en vez de tirar', () => {
        // Exento mayor que el total daría un gravado negativo.
        expect(iva({ total: 100, exemptTotal: 500, vatAmountAtSale: null })).toBe('0.0000');
        expect(iva({ total: 100, exemptTotal: -50, vatAmountAtSale: null })).toBe('13.0435');
    });

    it('un régimen desconocido se trata como GENERAL, no como cuota fija', () => {
        // Nunca dejar de cobrar IVA por un dato que no entendemos.
        expect(iva({ total: 115, fiscalRegimeAtSale: 'CUALQUIER_COSA', vatAmountAtSale: null })).toBe('15.0000');
        expect(iva({ total: 115, fiscalRegimeAtSale: null, vatAmountAtSale: null })).toBe('15.0000');
    });

    it('rechaza totales y snapshots imposibles', () => {
        expect(() => vatCollectedFromSale({ total: -1 })).toThrowError(
            /finito y no negativo/,
        );
        expect(() => vatCollectedFromSale({ total: Number.NaN })).toThrow();
        // Un IVA mayor que el total es dato corrupto, no un caso a redondear.
        expect(() => vatCollectedFromSale({ total: 100, vatAmountAtSale: 101 })).toThrowError(
            /entre cero y el total/,
        );
        expect(() => vatCollectedFromSale({ total: 100, vatAmountAtSale: -1 })).toThrow();
    });

    it('reproduce el caso medido en la app: 3 ventas, C$ 143.48 inventados', () => {
        const ventasDelDia = [
            { total: 550, exemptTotal: 0, fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: null },
            { total: 550, exemptTotal: 550, fiscalRegimeAtSale: 'GENERAL', vatAmountAtSale: null },
            { total: 550, exemptTotal: 0, fiscalRegimeAtSale: 'CUOTA_FIJA', vatAmountAtSale: 0 },
        ];
        const bruto = new Decimal(1650);
        const real = ventasDelDia.reduce(
            (acc, v) => acc.plus(vatCollectedFromSale(v)),
            new Decimal(0),
        ).toDecimalPlaces(4);
        const suponiendoIvaEnTodo = bruto.minus(bruto.dividedBy('1.15')).toDecimalPlaces(4);

        expect(real.toFixed(2)).toBe('71.74');
        expect(suponiendoIvaEnTodo.toFixed(2)).toBe('215.22');
        expect(suponiendoIvaEnTodo.minus(real).toFixed(2)).toBe('143.48');
        // Y la utilidad bruta se corre por la misma plata.
        expect(bruto.minus(real).toFixed(2)).toBe('1578.26');
    });
});

describe('el reporte de ventas ya no supone el 15% sobre el período', () => {
    it('agrega el snapshot por venta y solo después resta el IVA devuelto', () => {
        const service = leer('backend/services/salesReportService.ts');

        // La consulta suma la regla por cada fila: CUOTA_FIJA=0, snapshot si
        // existe y fórmula legacy únicamente como fallback.
        expect(service).toContain("s.\\\`fiscalRegimeAtSale\\\` = 'CUOTA_FIJA'");
        expect(service).toContain('s.\\\`vatAmountAtSale\\\` IS NOT NULL');
        expect(service).toContain('COALESCE(SUM(${saleVatSql}), 0) AS grossVat');
        // Las devoluciones revierten el impuesto del período sin recalcular el
        // bruto completo al 15 %. Este assert es conductual para sobrevivir a
        // extracciones/refactors del motor Decimal.
        const totals = calculateReportTotals({
            grossSales: '1650',
            returnsTotal: '115',
            grossVat: '71.7391',
            returnedVat: '15',
            grossCogs: '900',
            returnedCogs: '60',
            transactionCount: 3,
            quantityGross: '30',
            quantityReturned: '2',
            productGrossSales: '1650',
            allocatedReturnTotal: '115',
        });
        expect(totals.netSales.toFixed(2)).toBe('1535.00');
        expect(totals.vatCollected.toFixed(4)).toBe('56.7391');
        expect(totals.netRevenue.toFixed(4)).toBe('1478.2609');
        expect(totals.grossProfit.toFixed(4)).toBe('638.2609');
    });

    it('no queda ninguna división a ciegas entre 1.15 en el reporte', () => {
        // La regresión concreta: `totalVentas.dividedBy('1.15')`.
        expect(leer('backend/lib/salesReport.ts')).not.toMatch(/totalVentas\.dividedBy\('1\.15'\)/);
        expect(leer('backend/services/salesReportService.ts'))
            .not.toMatch(/totalVentas\.dividedBy\('1\.15'\)/);
    });
});

describe('el régimen se puede cambiar desde la pantalla', () => {
    it('los radios guardan solos, sin depender del submit del formulario', () => {
        // BUG MEDIDO EN LA PANTALLA REAL: con DIRECCIÓN FÍSICA vacía —el caso
        // del negocio chico que nunca cargó sus datos DGI, que es justamente el
        // de cuota fija— elegir el régimen y apretar "GUARDAR DATOS" no hacía
        // nada: el navegador bloqueaba el submit con "Please fill out this
        // field." sobre un campo que no tiene que ver con el régimen, y el
        // modal se quedaba abierto con la BD sin cambiar.
        const dash = leer('components/Dashboard.tsx');
        expect(dash).toMatch(/onChange=\{\(\) => elegirRegimenFiscal\('GENERAL'\)\}/);
        expect(dash).toMatch(/onChange=\{\(\) => elegirRegimenFiscal\('CUOTA_FIJA'\)\}/);
        expect(dash).not.toMatch(/onChange=\{\(\) => setFiscalData\(\{ \.\.\.fiscalData, fiscalRegime/);
    });

    it('si el guardado falla, el radio vuelve atrás', () => {
        // Mostrar "cuota fija" marcado mientras el servidor sigue cobrando IVA
        // es peor que no ofrecer el cambio.
        expect(leer('components/Dashboard.tsx'))
            .toMatch(/setFiscalData\(prev => \(\{ \.\.\.prev, fiscalRegime: previo \}\)\)/);
    });
});
