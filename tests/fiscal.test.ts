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
import { desglosarIvaIncluido, desglosarVentaConExoneracion } from '../backend/services/nicaTax';
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
    it('sin exonerado explícito (undefined) se trata como 0', () => {
        // Fija el default de `exemptTotal ?? 0`: llamar sin el parámetro debe dar
        // exactamente lo mismo que pasar 0 (si no, una venta normal cambiaría de
        // números según cómo se invoque la función).
        expect(buildSaleJournalLines(115, 60, 'CASH')).toEqual(
            buildSaleJournalLines(115, 60, 'CASH', 0),
        );
    });
});
