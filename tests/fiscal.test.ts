/**
 * NORTEX — RED DE SEGURIDAD DE NÚMEROS FISCALES (Fase 1).
 *
 * Cada caso fija un NÚMERO-ORO: una entrada conocida → una salida correcta
 * conocida, sobre las funciones PURAS que alimentan facturas, asientos y la
 * declaración de la DGI. Si un cambio (de un agente o de un humano) altera uno
 * de estos números, el CI se pone ROJO y NO se puede mergear. Es la defensa
 * contra "malos números" que llegan al cliente o al fisco.
 *
 * Los valores esperados fueron verificados contra la aritmética real del código
 * (no inventados). Son aritmética PURA — no dependen de si una tasa legal está
 * vigente; eso lo cubre la Fase 2 con el contador.
 */
import { describe, it, expect } from 'vitest';
import { desglosarIvaIncluido, desglosarVentaConExoneracion, fiscalMonthRange } from '../backend/services/nicaTax';
import { weightedAverageCost } from '../backend/services/stockService';
import { calcularAmortizacion } from '../backend/services/loanMath';
import { buildSaleJournalLines } from '../backend/services/accounting';

// ── IVA incluido (15%) — desglose 2 decimales ────────────────────────────────
describe('IVA incluido — desglosarIvaIncluido', () => {
    it('C$115 → neto 100.00 / IVA 15.00 (exacto)', () => {
        const { neto, iva } = desglosarIvaIncluido(115);
        expect(neto.toNumber()).toBe(100);
        expect(iva.toNumber()).toBe(15);
    });
    it('C$100 → neto 86.96 / IVA 13.04 (2dp) e invariante neto+iva===total', () => {
        const { neto, iva } = desglosarIvaIncluido(100);
        expect(neto.toNumber()).toBe(86.96);
        expect(iva.toNumber()).toBe(13.04);
        expect(neto.plus(iva).toNumber()).toBe(100); // identidad: nunca cobra IVA de más
    });
});

// ── IVA con EXONERACIÓN (canasta básica / medicinas) — 4 decimales ───────────
describe('Exoneración — desglosarVentaConExoneracion', () => {
    it('C$115 con exento C$50 → gravado 65, netoGravado 56.5217, IVA 8.4783, ingresoNeto 106.5217', () => {
        const d = desglosarVentaConExoneracion(115, 50);
        expect(d.exonerado.toNumber()).toBe(50);
        expect(d.gravado.toNumber()).toBe(65);
        expect(d.netoGravado.toNumber()).toBe(56.5217);
        expect(d.iva.toNumber()).toBe(8.4783);
        expect(d.ingresoNeto.toNumber()).toBe(106.5217);
        // Identidad clave: ingresoNeto + iva === total (asiento cuadra siempre).
        expect(d.ingresoNeto.plus(d.iva).toNumber()).toBe(115);
    });
    it('venta 100% exonerada (C$100 exento C$100) → IVA 0, ingresoNeto 100', () => {
        const d = desglosarVentaConExoneracion(100, 100);
        expect(d.gravado.toNumber()).toBe(0);
        expect(d.iva.toNumber()).toBe(0);       // NO se cobra IVA por canasta básica
        expect(d.ingresoNeto.toNumber()).toBe(100);
    });
    it('exento > total (defensa) → exento se acota al total, IVA nunca negativo', () => {
        const d = desglosarVentaConExoneracion(100, 999);
        expect(d.exonerado.toNumber()).toBe(100);
        expect(d.iva.toNumber()).toBe(0);
        expect(d.ingresoNeto.toNumber()).toBe(100);
    });
});

// ── Costo promedio ponderado (COGS → utilidad fiscal) ────────────────────────
describe('Costo promedio ponderado — weightedAverageCost', () => {
    it('10@20 + 10@30 → 25.0000 (promedio normal)', () => {
        expect(weightedAverageCost(10, 20, 10, 30).toNumber()).toBe(25);
    });
    it('stock previo NEGATIVO → cae al costo de compra 30 (guard C1, no pondera deuda irreal)', () => {
        expect(weightedAverageCost(-5, 20, 10, 30).toNumber()).toBe(30);
    });
    it('sin stock previo (0) → costo de compra 30 (sin división por cero)', () => {
        expect(weightedAverageCost(0, 0, 10, 30).toNumber()).toBe(30);
    });
});

// ── Amortización de préstamos (plan de cuotas al cliente) ────────────────────
describe('Amortización — calcularAmortizacion', () => {
    it('FLAT: C$1000 al 10% en 10 cuotas → total 1100, cuota 110 (Σcuotas === total)', () => {
        const { installmentAmount, totalToRepay } = calcularAmortizacion(1000, 10, 10, 'GOTA_A_GOTA');
        expect(totalToRepay.toNumber()).toBe(1100);
        expect(installmentAmount.toNumber()).toBe(110);
        expect(installmentAmount.mul(10).toNumber()).toBe(1100);
    });
    it('FRANCÉS: C$1000 al 5% en 12 cuotas → cuota 112.8254, total 1353.9049', () => {
        const { installmentAmount, totalToRepay } = calcularAmortizacion(1000, 5, 12, 'FORMAL_AMORTIZED');
        expect(installmentAmount.toDecimalPlaces(4).toNumber()).toBe(112.8254);
        expect(totalToRepay.toDecimalPlaces(4).toNumber()).toBe(1353.9049);
    });
    it('FRANCÉS tasa 0% → cuota = capital/n, sin división por cero ni Infinity', () => {
        const { installmentAmount } = calcularAmortizacion(1000, 0, 12, 'FORMAL_AMORTIZED');
        expect(installmentAmount.isFinite()).toBe(true);
        expect(installmentAmount.toDecimalPlaces(4).toNumber()).toBe(83.3333);
    });
});

// ── Partida doble del asiento de venta (Σdebe === Σhaber SIEMPRE) ─────────────
describe('Partida doble — buildSaleJournalLines', () => {
    const balance = (lines: { debit: number; credit: number }[]) => {
        const d = lines.reduce((s, l) => s + l.debit, 0);
        const c = lines.reduce((s, l) => s + l.credit, 0);
        return Math.abs(d - c); // debe ser ~0 (tolerancia del motor: 0.0001)
    };
    it('venta contado C$115, costo 60 → cuadra', () => {
        expect(balance(buildSaleJournalLines(115, 60, 'CASH', 0))).toBeLessThan(0.0001);
    });
    it('venta crédito C$115 con exonerado 50, costo 60 → cuadra', () => {
        expect(balance(buildSaleJournalLines(115, 60, 'CREDIT', 50))).toBeLessThan(0.0001);
    });
    it('venta C$100 sin costo → cuadra', () => {
        expect(balance(buildSaleJournalLines(100, 0, 'CASH', 0))).toBeLessThan(0.0001);
    });
    it('venta grande C$1000 exonerado 300, costo 700 → cuadra', () => {
        expect(balance(buildSaleJournalLines(1000, 700, 'CASH', 300))).toBeLessThan(0.0001);
    });
    it('crédito usa CxC (1.1.3), contado usa Caja (1.1.1)', () => {
        expect(buildSaleJournalLines(115, 60, 'CREDIT', 0)[0].accountCode).toBe('1.1.3');
        expect(buildSaleJournalLines(115, 60, 'CASH', 0)[0].accountCode).toBe('1.1.1');
    });

    // ── Cuentas y montos EXACTOS por línea ───────────────────────────────────
    // Hallazgo de las pruebas de mutación: los casos de arriba solo verificaban
    // que el asiento CUADRE (debe==haber) y la primera cuenta. Se podían vaciar
    // los códigos de Ingresos/IVA/Costo/Inventario y el test seguía en verde —
    // un asiento que cuadra pero registra el IVA en la cuenta equivocada ensucia
    // el mayor y la declaración de la DGI. Acá se fija cada cuenta y su monto.
    it('venta contado C$115 (neto 100 + IVA 15), costo 60 → cuenta y monto por línea', () => {
        const l = buildSaleJournalLines(115, 60, 'CASH', 0);
        expect(l).toHaveLength(5);
        expect(l[0]).toEqual({ accountCode: '1.1.1', debit: 115, credit: 0 });   // Caja
        expect(l[1]).toEqual({ accountCode: '4.1.1', debit: 0, credit: 100 });   // Ingresos por ventas
        expect(l[2]).toEqual({ accountCode: '2.1.2', debit: 0, credit: 15 });    // IVA por pagar
        expect(l[3]).toEqual({ accountCode: '5.1.1', debit: 60, credit: 0 });    // Costo de ventas
        expect(l[4]).toEqual({ accountCode: '1.1.4', debit: 0, credit: 60 });    // Inventario
    });
    it('venta a crédito debita CxC por el total (no Caja)', () => {
        const l = buildSaleJournalLines(115, 60, 'CREDIT', 0);
        expect(l[0]).toEqual({ accountCode: '1.1.3', debit: 115, credit: 0 });
    });
    it('parte exonerada: el IVA solo grava lo NO exento', () => {
        // total 115, exento 15 → gravado 100 → neto 86.9565, IVA 13.0435
        // ingresoNeto = neto gravado + exonerado = 86.9565 + 15 = 101.9565
        const l = buildSaleJournalLines(115, 60, 'CASH', 15);
        expect(l[1].accountCode).toBe('4.1.1');
        expect(l[1].credit).toBeCloseTo(101.9565, 4);
        expect(l[2].accountCode).toBe('2.1.2');
        expect(l[2].credit).toBeCloseTo(13.0435, 4);
    });
    it('sin exonerado (undefined o null) produce el asiento absoluto correcto', () => {
        // Antes este caso comparaba la función contra sí misma con y sin el
        // parámetro; como `desglosarVentaConExoneracion` ya tiene default de
        // parámetro Y un `?? 0` interno, la igualdad se cumplía aunque se quitara
        // el default de accounting.ts (verificado: los tests seguían en verde).
        // Ahora se fijan los 5 renglones absolutos, y se cubre el camino `null`
        // —que es el que reenvía recordSale (`exemptTotal?: number | null`)—.
        const esperado = [
            { accountCode: '1.1.1', debit: 115, credit: 0 },
            { accountCode: '4.1.1', debit: 0, credit: 100 },
            { accountCode: '2.1.2', debit: 0, credit: 15 },
            { accountCode: '5.1.1', debit: 60, credit: 0 },
            { accountCode: '1.1.4', debit: 0, credit: 60 },
        ];
        expect(buildSaleJournalLines(115, 60, 'CASH')).toEqual(esperado);
        expect(buildSaleJournalLines(115, 60, 'CASH', null)).toEqual(esperado);
    });
});

// ── Rango fiscal del mes — el recorte que comparten los tres documentos ──────
// El Libro de Ventas, el resumen VET y la declaración mensual tienen que incluir
// EXACTAMENTE las mismas ventas. Antes los exports usaban un rango anclado a
// Managua y generateMonthlyReport usaba `new Date(year, month-1, 1)` —la zona del
// PROCESO—: con el contenedor en UTC el borde se corría seis horas y una venta de
// la tarde del último día caía en un mes distinto según qué documento se mirara.
describe('Rango fiscal del mes — fiscalMonthRange', () => {
    it('arranca a medianoche de Managua (06:00 UTC del día 1)', () => {
        const { start } = fiscalMonthRange(3, 2026);
        expect(start.toISOString()).toBe('2026-03-01T06:00:00.000Z');
    });

    it('termina en el arranque del mes siguiente, y el fin es EXCLUSIVO', () => {
        const { end } = fiscalMonthRange(3, 2026);
        expect(end.toISOString()).toBe('2026-04-01T06:00:00.000Z');
        // El fin de marzo es idéntico al inicio de abril: por eso hay que
        // consultarlo con `lt` y nunca con `lte`, o el día 1 se cuenta dos veces.
        expect(end.getTime()).toBe(fiscalMonthRange(4, 2026).start.getTime());
    });

    it('cruza el fin de año sin agujeros', () => {
        const dic = fiscalMonthRange(12, 2025);
        const ene = fiscalMonthRange(1, 2026);
        expect(dic.end.getTime()).toBe(ene.start.getTime());
        expect(dic.start.toISOString()).toBe('2025-12-01T06:00:00.000Z');
    });

    it('cubre febrero de un año bisiesto completo', () => {
        const feb = fiscalMonthRange(2, 2024);
        const dias = (feb.end.getTime() - feb.start.getTime()) / 86400000;
        expect(dias).toBe(29);
    });

    it('una venta de las 19:00 de Managua del último día cae en SU mes', () => {
        // 19:00 del 31-mar en Managua = 01:00 UTC del 1-abr. Con un rango en hora
        // local del proceso (UTC) esa venta se iba a abril.
        const venta = new Date('2026-04-01T01:00:00.000Z');
        const marzo = fiscalMonthRange(3, 2026);
        expect(venta >= marzo.start && venta < marzo.end).toBe(true);
        const abril = fiscalMonthRange(4, 2026);
        expect(venta >= abril.start).toBe(false);
    });
});

// ── Reconciliación entre documentos ─────────────────────────────────────────
// El Libro de Ventas y el resumen VET arman sus filas con el mismo desglose que
// la declaración mensual. Antes hacían `total / 1.15` sobre la venta ENTERA,
// ignorando `Sale.exemptTotal`: con productos de canasta básica marcados exentos
// (Inventory.tsx tiene el toggle y salesService ya calcula el campo), los dos
// documentos del mismo mes declaraban IVA distinto.
describe('Reconciliación libro/VET/declaración — desglose por venta', () => {
    it('una venta con parte exonerada no paga IVA por lo exonerado', () => {
        // C$1.000 de los cuales C$400 son canasta básica: el IVA sale solo de 600.
        const d = desglosarVentaConExoneracion(1000, 400);
        expect(d.exonerado.toNumber()).toBe(400);
        expect(d.gravado.toNumber()).toBe(600);
        expect(d.iva.toDecimalPlaces(2).toNumber()).toBe(78.26);   // 600 − 600/1,15
        // Dividir el total entero habría declarado 130,43: 52,17 de más.
        expect(d.iva.toNumber()).toBeLessThan(130);
    });

    it('INVARIANTE de la fila: exento + subtotal + IVA reconstruye el total', () => {
        for (const [total, exento] of [[1000, 400], [115, 0], [999.99, 333.33], [50, 50]]) {
            const d = desglosarVentaConExoneracion(total, exento);
            const fila = d.exonerado.toDecimalPlaces(2)
                .plus(d.netoGravado.toDecimalPlaces(2))
                .plus(d.iva.toDecimalPlaces(2));
            expect(fila.toNumber()).toBeCloseTo(Number(total), 2);
        }
    });

    it('una venta 100% exonerada no genera IVA', () => {
        const d = desglosarVentaConExoneracion(500, 500);
        expect(d.iva.toNumber()).toBe(0);
        expect(d.ingresoNeto.toNumber()).toBe(500);
    });

    it('sin exentos se comporta igual que el desglose simple', () => {
        const d = desglosarVentaConExoneracion(115, 0);
        expect(d.netoGravado.toNumber()).toBe(100);
        expect(d.iva.toNumber()).toBe(15);
    });
});
