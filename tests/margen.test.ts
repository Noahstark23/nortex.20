/**
 * NORTEX — NÚMEROS-ORO de la ganancia del día y del efectivo en gaveta.
 *
 * El día 1 de una cuenta nueva la app mostraba "Ganancia de hoy: C$645" por una
 * venta de C$645 que costó C$520 (+416% sobre la real) y "C$0.00" en la píldora
 * de efectivo del POS con plata en la gaveta. Los dos números son verificables
 * con calculadora por el dueño: si mienten, deja de creerle al sistema.
 *
 * Cada caso fija una ENTRADA conocida → una SALIDA absoluta conocida (nunca
 * `expect(x).toBe(x)`), y varios están cruzados contra el motor fiscal real
 * (`desglosarVentaConExoneracion`) para que el KPI no pueda divergir del asiento
 * contable ni de la declaración de la DGI.
 */
import { describe, it, expect } from 'vitest';
import {
    calcularMargenBruto,
    calcularRetiroSeguro,
    calcularEfectivoTurno,
} from '../utils/margen';
import { desglosarVentaConExoneracion } from '../backend/services/nicaTax';

describe('calcularMargenBruto — ganancia bruta REAL (ingreso neto − costo)', () => {
    it('caso de la auditoría: venta C$645 con costo C$520 → ganancia C$40.87 (NO C$125)', () => {
        const r = calcularMargenBruto([
            {
                total: 645,
                exemptTotal: 0,
                items: [
                    { costAtSale: 450, quantity: 1 },
                    { costAtSale: 70, quantity: 1 },
                ],
            },
        ]);
        // 645 / 1.15 = 560.8696 → 560.87 de ingreso reconocido (sin IVA).
        expect(r.ingresoNeto.toNumber()).toBe(560.87);
        expect(r.costoVendido.toNumber()).toBe(520);
        // 125 sería comparar el precio CON IVA contra el costo SIN IVA.
        expect(r.gananciaBruta.toNumber()).toBe(40.87);
        expect(r.lineasSinCosto).toBe(0);
    });

    it('el KPI CUADRA en pantalla: ganancia === ingreso − costo, ya redondeados', () => {
        const r = calcularMargenBruto([
            { total: 645, exemptTotal: 0, items: [{ costAtSale: 520, quantity: 1 }] },
        ]);
        expect(r.gananciaBruta.toNumber()).toBe(
            r.ingresoNeto.minus(r.costoVendido).toNumber()
        );
    });

    it('venta EXONERADA (canasta básica): total 200 exento 200 → ingreso neto 200 (sin IVA que separar)', () => {
        const r = calcularMargenBruto([
            { total: 200, exemptTotal: 200, items: [{ costAtSale: 150, quantity: 1 }] },
        ]);
        expect(r.ingresoNeto.toNumber()).toBe(200);
        expect(r.costoVendido.toNumber()).toBe(150);
        expect(r.gananciaBruta.toNumber()).toBe(50);
    });

    it('venta MIXTA: total 315 con 200 exonerados → gravado 115 → neto 100 → ingreso 300', () => {
        const r = calcularMargenBruto([
            { total: 315, exemptTotal: 200, items: [{ costAtSale: 180, quantity: 1 }] },
        ]);
        expect(r.ingresoNeto.toNumber()).toBe(300);
        expect(r.gananciaBruta.toNumber()).toBe(120);
    });

    it('exento mayor que el total se acota al total (dato inconsistente no inventa ingreso)', () => {
        const r = calcularMargenBruto([{ total: 100, exemptTotal: 500, items: [] }]);
        expect(r.ingresoNeto.toNumber()).toBe(100);
    });

    it('exento negativo se acota a 0 → la venta entera es gravada', () => {
        const r = calcularMargenBruto([{ total: 115, exemptTotal: -50, items: [] }]);
        expect(r.ingresoNeto.toNumber()).toBe(100);
    });

    it('sin exemptTotal (venta legacy, null/ausente) se trata como 100% GRAVADA', () => {
        const sinCampo = calcularMargenBruto([{ total: 115, items: [] }]);
        const conNull = calcularMargenBruto([{ total: 115, exemptTotal: null, items: [] }]);
        expect(sinCampo.ingresoNeto.toNumber()).toBe(100);
        expect(conNull.ingresoNeto.toNumber()).toBe(100);
    });

    it('línea SIN costo (costAtSale null): no suma COGS y se contabiliza para avisar', () => {
        const r = calcularMargenBruto([
            {
                total: 115,
                exemptTotal: 0,
                items: [
                    { costAtSale: null, quantity: 4 },
                    { costAtSale: 30, quantity: 1 },
                ],
            },
        ]);
        expect(r.costoVendido.toNumber()).toBe(30);
        expect(r.lineasSinCosto).toBe(1);
        expect(r.gananciaBruta.toNumber()).toBe(70); // 100 − 30 (sobreestimada: falta un costo)
    });

    it('línea con costo 0 también cuenta como SIN costo', () => {
        const r = calcularMargenBruto([
            {
                total: 115,
                exemptTotal: 0,
                items: [
                    { costAtSale: 0, quantity: 2 },
                    { costAtSale: 40, quantity: 1 },
                ],
            },
        ]);
        expect(r.costoVendido.toNumber()).toBe(40);
        expect(r.lineasSinCosto).toBe(1);
    });

    it('el costo MULTIPLICA por la cantidad (3 × C$10 = C$30, no C$10)', () => {
        const r = calcularMargenBruto([
            { total: 115, exemptTotal: 0, items: [{ costAtSale: 10, quantity: 3 }] },
        ]);
        expect(r.costoVendido.toNumber()).toBe(30);
        expect(r.gananciaBruta.toNumber()).toBe(70);
    });

    it('agrega VARIAS ventas: 115 (neto 100) + 230 (neto 200) → ingreso 300, costo 160', () => {
        const r = calcularMargenBruto([
            { total: 115, exemptTotal: 0, items: [{ costAtSale: 60, quantity: 1 }] },
            { total: 230, exemptTotal: 0, items: [{ costAtSale: 50, quantity: 2 }] },
        ]);
        expect(r.ingresoNeto.toNumber()).toBe(300);
        expect(r.costoVendido.toNumber()).toBe(160);
        expect(r.gananciaBruta.toNumber()).toBe(140);
        expect(r.lineasSinCosto).toBe(0);
    });

    it('sin ventas: todo en cero (dashboard de cuenta nueva)', () => {
        const r = calcularMargenBruto([]);
        expect(r.ingresoNeto.toNumber()).toBe(0);
        expect(r.costoVendido.toNumber()).toBe(0);
        expect(r.gananciaBruta.toNumber()).toBe(0);
        expect(r.lineasSinCosto).toBe(0);
    });

    it('ganancia NEGATIVA cuando se vendió por debajo del costo (no se recorta a 0)', () => {
        const r = calcularMargenBruto([
            { total: 115, exemptTotal: 0, items: [{ costAtSale: 130, quantity: 1 }] },
        ]);
        expect(r.gananciaBruta.toNumber()).toBe(-30);
    });

    // ── Amarre con el motor fiscal: el KPI no puede divergir del asiento ──────
    it('el ingreso neto es el MISMO que el del motor fiscal (venta gravada)', () => {
        const fiscal = desglosarVentaConExoneracion(645, 0);
        const r = calcularMargenBruto([{ total: 645, exemptTotal: 0, items: [] }]);
        expect(r.ingresoNeto.toNumber()).toBe(fiscal.ingresoNeto.toDecimalPlaces(2).toNumber());
        expect(fiscal.ingresoNeto.toDecimalPlaces(2).toNumber()).toBe(560.87);
    });

    it('el ingreso neto es el MISMO que el del motor fiscal (venta mixta con exonerados)', () => {
        const fiscal = desglosarVentaConExoneracion(315, 200);
        const r = calcularMargenBruto([{ total: 315, exemptTotal: 200, items: [] }]);
        expect(r.ingresoNeto.toNumber()).toBe(fiscal.ingresoNeto.toDecimalPlaces(2).toNumber());
        expect(fiscal.ingresoNeto.toDecimalPlaces(2).toNumber()).toBe(300);
    });
});

describe('calcularRetiroSeguro — cuánto puede sacar el dueño sin descapitalizarse', () => {
    it('descuenta la reposición de lo vendido: 10000 − 2000 − 520 = 7480', () => {
        expect(calcularRetiroSeguro(10000, 2000, 520).toNumber()).toBe(7480);
    });

    it('nunca es negativo: si las deudas se comen el efectivo, el retiro seguro es 0', () => {
        expect(calcularRetiroSeguro(1000, 2000, 520).toNumber()).toBe(0);
    });

    it('sin deudas ni ventas del día es el efectivo completo', () => {
        expect(calcularRetiroSeguro(1500, 0, 0).toNumber()).toBe(1500);
    });

    it('es MENOR que la liquidez libre cuando hubo ventas (ese era el consejo peligroso)', () => {
        const liquidezLibre = 10000 - 2000;
        expect(calcularRetiroSeguro(10000, 2000, 520).toNumber()).toBeLessThan(liquidezLibre);
    });
});

describe('calcularEfectivoTurno — una sola verdad para la gaveta', () => {
    it('fondo + ventas en efectivo + entradas − salidas (manuales Y de agente)', () => {
        const r = calcularEfectivoTurno({
            initialCash: 1000,
            cashSales: 645,
            movimientos: [
                { type: 'IN', amount: 200, currency: 'NIO', category: 'INYECCION_CAPITAL' },
                { type: 'OUT', amount: 50, currency: 'NIO', category: 'GASTO_OPERATIVO' },
                { type: 'IN', amount: 300, currency: 'NIO', category: 'AGENTE_BANCARIO' },
                { type: 'OUT', amount: 120, currency: 'NIO', category: 'AGENTE_BANCARIO' },
            ],
        });
        // 1000 + 645 + 200 + 300 − 50 − 120 = 1975
        expect(r.efectivoNIO.toNumber()).toBe(1975);
        expect(r.desglose.manualINs.toNumber()).toBe(200);
        expect(r.desglose.manualOUTs.toNumber()).toBe(50);
        expect(r.desglose.agentINs.toNumber()).toBe(300);
        expect(r.desglose.agentOUTs.toNumber()).toBe(120);
        expect(r.desglose.initialCash.toNumber()).toBe(1000);
        expect(r.desglose.cashSales.toNumber()).toBe(645);
    });

    it('el agente bancario SÍ entra al total (son billetes en la gaveta), pero desglosado', () => {
        const r = calcularEfectivoTurno({
            initialCash: 0,
            cashSales: 0,
            movimientos: [{ type: 'IN', amount: 500, currency: 'NIO', category: 'AGENTE_BANCARIO' }],
        });
        expect(r.efectivoNIO.toNumber()).toBe(500);
        expect(r.desglose.agentINs.toNumber()).toBe(500);
        expect(r.desglose.manualINs.toNumber()).toBe(0);
    });

    it('córdobas y dólares NO se suman (gavetas separadas)', () => {
        const r = calcularEfectivoTurno({
            initialCash: 1000,
            initialCashUsd: 100,
            cashSales: 0,
            movimientos: [
                { type: 'IN', amount: 40, currency: 'USD', category: 'CAMBIO' },
                { type: 'OUT', amount: 15, currency: 'USD', category: 'CAMBIO' },
                { type: 'IN', amount: 200, currency: 'NIO', category: 'CAMBIO' },
            ],
        });
        expect(r.efectivoNIO.toNumber()).toBe(1200);
        expect(r.efectivoUSD.toNumber()).toBe(125);
        expect(r.desglose.usdINs.toNumber()).toBe(40);
        expect(r.desglose.usdOUTs.toNumber()).toBe(15);
        expect(r.desglose.initialCashUsd.toNumber()).toBe(100);
    });

    it('movimiento sin moneda (fila legacy) cuenta como CÓRDOBAS', () => {
        const r = calcularEfectivoTurno({
            initialCash: 100,
            cashSales: 0,
            movimientos: [{ type: 'IN', amount: 25, category: 'AJUSTE' }],
        });
        expect(r.efectivoNIO.toNumber()).toBe(125);
        expect(r.efectivoUSD.toNumber()).toBe(0);
        expect(r.desglose.manualINs.toNumber()).toBe(25);
    });

    it('sin fondo USD declarado la gaveta de dólares arranca en 0', () => {
        const r = calcularEfectivoTurno({
            initialCash: 500,
            cashSales: 0,
            movimientos: [{ type: 'IN', amount: 20, currency: 'USD', category: 'CAMBIO' }],
        });
        expect(r.efectivoUSD.toNumber()).toBe(20);
        expect(r.desglose.initialCashUsd.toNumber()).toBe(0);
    });

    it('los movimientos ANULADOS no mueven la gaveta; los vigentes sí', () => {
        const r = calcularEfectivoTurno({
            initialCash: 1000,
            cashSales: 0,
            movimientos: [
                { type: 'OUT', amount: 400, currency: 'NIO', category: 'RETIRO_PERSONAL', isVoided: true },
                { type: 'OUT', amount: 100, currency: 'NIO', category: 'RETIRO_PERSONAL', isVoided: false },
            ],
        });
        expect(r.efectivoNIO.toNumber()).toBe(900);
        expect(r.desglose.manualOUTs.toNumber()).toBe(100);
    });

    it('turno recién abierto: la gaveta es el fondo inicial, NUNCA C$0.00', () => {
        const r = calcularEfectivoTurno({ initialCash: 750.5, cashSales: 0, movimientos: [] });
        expect(r.efectivoNIO.toNumber()).toBe(750.5);
    });

    it('aritmética de centavos exacta (decimal.js, no float): 0.1 + 0.2 = 0.30', () => {
        const r = calcularEfectivoTurno({
            initialCash: 0.1,
            cashSales: 0.2,
            movimientos: [],
        });
        expect(r.efectivoNIO.toNumber()).toBe(0.3);
    });
});
