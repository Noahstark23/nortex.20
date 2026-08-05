/**
 * NORTEX — NÚMEROS-ORO DE LAS CALCULADORAS PÚBLICAS (utils/calc-laborales.ts).
 *
 * Estas fórmulas son el ESPEJO client-side de backend/services/nicaLabor.ts y
 * alimentan las calculadoras del blog (aguinaldo, vacaciones, horas extra, INSS,
 * liquidación, IVA) que ve cualquier visitante. Si un cambio altera uno de estos
 * números, el CI se pone ROJO: una cifra mal en una calculadora pública daña la
 * credibilidad del producto y puede hacer que un negocio pague mal a su gente.
 *
 * Los esperados salen de la aritmética real de la Ley 185 / Ley 539 tal como la
 * implementa el ERP — verificados, no inventados. Son aritmética PURA: no
 * dependen de que una tasa legal esté vigente (eso lo cubre la verificación
 * contra INSS/DGI/MITRAB documentada en utils/tasas.ts).
 */
import { describe, it, expect } from 'vitest';
import {
    calcAguinaldo, calcVacaciones, calcHorasExtras,
    calcINSS, calcLiquidacion, calcIVA,
} from '../utils/calc-laborales';

// ── Aguinaldo (13º mes) — (salario/12) × meses, Art. 93 ──────────────────────
describe('Aguinaldo — calcAguinaldo', () => {
    it('año completo (12 meses) = un salario mensual', () => {
        expect(calcAguinaldo(30000, 12).aguinaldo).toBe(30000);
    });
    it('medio año (6 meses) = medio salario', () => {
        expect(calcAguinaldo(30000, 6).aguinaldo).toBe(15000);
    });
    it('capea a 12 meses (no paga de más por antigüedad)', () => {
        expect(calcAguinaldo(30000, 15).aguinaldo).toBe(30000);
    });
    it('sin meses trabajados = 0', () => {
        expect(calcAguinaldo(30000, 0).aguinaldo).toBe(0);
    });
});

// ── Vacaciones — 2.5 días/mes (tope 30) × salario diario, Art. 76 ────────────
describe('Vacaciones — calcVacaciones', () => {
    it('6 meses = 15 días y su monto', () => {
        const r = calcVacaciones(30000, 6);
        expect(r.dias).toBe(15);
        expect(r.monto).toBe(15000);
    });
    it('capea en 30 días aunque pasen 24 meses', () => {
        expect(calcVacaciones(30000, 24).dias).toBe(30);
    });
    it('un mes acumula 2.5 días', () => {
        expect(calcVacaciones(30000, 1).dias).toBe(2.5);
    });
});

// ── Horas extra — al DOBLE de la hora ordinaria (salario/240), Art. 62 ───────
describe('Horas extra — calcHorasExtras', () => {
    it('hora ordinaria = salario / 240', () => {
        expect(calcHorasExtras(30000, 0).horaOrdinaria).toBe(125);
    });
    it('10 horas extra sobre 30000 = 2500 (125 × 2 × 10)', () => {
        expect(calcHorasExtras(30000, 10).monto).toBe(2500);
    });
    it('media hora se paga proporcional', () => {
        expect(calcHorasExtras(30000, 0.5).monto).toBe(125);
    });
});

// ── INSS — laboral 7% con techo · patronal 22.5%/21.5% · INATEC 2% ───────────
describe('INSS — calcINSS', () => {
    it('salario 30000 (empresa grande): laboral 2100, patronal 6750, INATEC 600', () => {
        const r = calcINSS(30000);
        expect(r.inssLaboral).toBe(2100);
        expect(r.inssPatronal).toBe(6750);
        expect(r.inatec).toBe(600);
        expect(r.netoTrasINSS).toBe(27900);
    });
    it('PYME (<50 empleados) aplica patronal 21.5%', () => {
        expect(calcINSS(30000, { pyme: true }).inssPatronal).toBe(6450);
    });
    it('aplica el techo cotizable en salarios altos', () => {
        // Sobre el techo, la base deja de crecer: el INSS laboral se congela.
        const enTecho = calcINSS(132071.43).inssLaboral;
        expect(calcINSS(500000).inssLaboral).toBe(enTecho);
    });
    it('INATEC se calcula sobre el total, no sobre el techo', () => {
        expect(calcINSS(500000).inatec).toBe(10000);
    });
});

// ── Liquidación — Art. 45: 30 días/año (1º-3º), 20 días/año (4º+) ────────────
describe('Liquidación — calcLiquidacion', () => {
    it('despido con 4 años = 110 días de indemnización + vacaciones', () => {
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 4,
            diasVacacionesPendientes: 10, motivo: 'DESPIDO',
        });
        expect(r.indemnizacionDias).toBe(110);   // 30×3 + 20×1
        expect(r.indemnizacion).toBe(110000);
        expect(r.vacaciones).toBe(10000);
        expect(r.total).toBe(120000);
    });
    it('renuncia NO paga indemnización (solo vacaciones)', () => {
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 4,
            diasVacacionesPendientes: 10, motivo: 'RENUNCIA',
        });
        expect(r.aplicaIndemnizacion).toBe(false);
        expect(r.indemnizacion).toBe(0);
        expect(r.total).toBe(10000);
    });
    it('mutuo acuerdo SÍ paga indemnización', () => {
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 4,
            diasVacacionesPendientes: 0, motivo: 'MUTUO',
        });
        expect(r.aplicaIndemnizacion).toBe(true);
    });
    it('respeta el PISO de 1 mes de salario', () => {
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 0.5,
            diasVacacionesPendientes: 0, motivo: 'DESPIDO',
        });
        expect(r.indemnizacion).toBe(30000);
    });
    it('respeta el TECHO de 5 meses de salario', () => {
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 20,
            diasVacacionesPendientes: 0, motivo: 'DESPIDO',
        });
        expect(r.indemnizacion).toBe(150000);
    });

    // ── Años FRACCIONARIOS ───────────────────────────────────────────────────
    // Hallazgo de las pruebas de mutación: solo había casos con años enteros, así
    // que la aritmética de la fracción proporcional podía romperse sin que nadie
    // se enterara. En la vida real casi ninguna liquidación cae en un año exacto.
    it('2.5 años: 30 días por año completo + media proporción del tercero', () => {
        // completos = 2 → 30 + 30 = 60 días; fracción 0.5 del 3er año (≤3 → 30/año)
        // → 60 + 0.5×30 = 75 días
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 2.5,
            diasVacacionesPendientes: 0, motivo: 'DESPIDO',
        });
        expect(r.indemnizacionDias).toBe(75);
        expect(r.indemnizacion).toBe(75000); // 75 × (30000/30)
    });
    it('4.5 años: la fracción del 5º año ya se paga a 20 días (no 30)', () => {
        // completos = 4 → 30×3 + 20 = 110 días; fracción 0.5 del 5º año (>3 → 20/año)
        // → 110 + 0.5×20 = 120 días
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 4.5,
            diasVacacionesPendientes: 0, motivo: 'DESPIDO',
        });
        expect(r.indemnizacionDias).toBe(120);
        expect(r.indemnizacion).toBe(120000);
    });
    it('3.5 años: el cambio de tramo ocurre en el 4º año', () => {
        // completos = 3 → 90 días; fracción 0.5 del 4º año (>3 → 20/año) → 100 días
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 3.5,
            diasVacacionesPendientes: 0, motivo: 'DESPIDO',
        });
        expect(r.indemnizacionDias).toBe(100);
    });
    it('sin antigüedad (0 años) no genera indemnización', () => {
        const r = calcLiquidacion({
            salarioMensual: 30000, aniosServicio: 0,
            diasVacacionesPendientes: 5, motivo: 'DESPIDO',
        });
        expect(r.indemnizacionDias).toBe(0);
        expect(r.indemnizacion).toBe(0);
        expect(r.total).toBe(5000); // solo vacaciones
    });
});

// ── IVA 15% — desglose de un precio con IVA incluido ─────────────────────────
describe('IVA — calcIVA', () => {
    it('115 con IVA = 100 neto + 15 de IVA', () => {
        const r = calcIVA(115);
        expect(r.neto).toBe(100);
        expect(r.iva).toBe(15);
    });
    it('neto + IVA reconstruye el total (sin centavo perdido)', () => {
        const r = calcIVA(1234.56);
        expect(Number((r.neto + r.iva).toFixed(2))).toBe(1234.56);
    });
});
