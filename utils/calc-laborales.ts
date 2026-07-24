/**
 * NORTEX — Calculadoras laborales/fiscales PURAS para el blog público.
 *
 * FUENTE DE VERDAD de las fórmulas: backend/services/nicaLabor.ts y nicaTax.ts.
 * Estas funciones son el ESPEJO client-side exacto de ese motor para que la
 * calculadora del blog y el ERP nunca diverjan. Si cambia una fórmula legal,
 * actualizar AMBOS lados. Las TASAS salen de utils/tasas.ts (no se repiten acá).
 *
 * Precisión: decimal.js con ROUND_HALF_UP (norma DGI), igual que el ERP.
 */
import Decimal from 'decimal.js';
import {
  INSS_LABORAL_RATE, INSS_PATRONAL_RATE_DEFAULT, INSS_PATRONAL_RATE_PYME,
  INATEC_RATE, TECHO_INSS_MENSUAL, IVA_RATE,
  VACACIONES_DIAS_POR_MES, VACACIONES_TOPE_DIAS, HORAS_MES_ORDINARIAS,
  HORA_EXTRA_RECARGO, INDEMNIZACION_TOPE_MESES,
} from './tasas';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const money = (d: Decimal) => d.toDecimalPlaces(2).toNumber();

/** Aguinaldo (13º mes) proporcional. ERP: (salario/12) × meses. Art. 93 Ley 185. */
export function calcAguinaldo(salarioMensual: number, mesesTrabajados: number): { aguinaldo: number } {
  const base = new Decimal(salarioMensual || 0);
  const meses = Decimal.min(new Decimal(mesesTrabajados || 0), 12);
  return { aguinaldo: money(base.dividedBy(12).mul(meses)) };
}

/** Vacaciones acumuladas: 2.5 días/mes (tope 30) × salario diario (base/30). Art. 76. */
export function calcVacaciones(salarioMensual: number, mesesTrabajados: number): { dias: number; monto: number } {
  const base = new Decimal(salarioMensual || 0);
  const dias = Decimal.min(new Decimal(mesesTrabajados || 0).mul(VACACIONES_DIAS_POR_MES), VACACIONES_TOPE_DIAS);
  const salarioDiario = base.dividedBy(30);
  return { dias: dias.toDecimalPlaces(1).toNumber(), monto: money(dias.mul(salarioDiario)) };
}

/** Horas extra al doble. ERP: horaOrdinaria = salario/240; pago = horas × horaOrdinaria × 2. Art. 62. */
export function calcHorasExtras(salarioMensual: number, cantidadHoras: number): { horaOrdinaria: number; monto: number } {
  const base = new Decimal(salarioMensual || 0);
  const horaOrdinaria = base.dividedBy(HORAS_MES_ORDINARIAS);
  const monto = new Decimal(cantidadHoras || 0).mul(horaOrdinaria).mul(HORA_EXTRA_RECARGO);
  return { horaOrdinaria: horaOrdinaria.toDecimalPlaces(2).toNumber(), monto: money(monto) };
}

/**
 * INSS laboral (7%, deducción al trabajador, con techo) y patronal (22.5% ≥50 emp
 * · 21.5% <50 emp). ERP: base = min(bruto, techo). Ley 539.
 */
export function calcINSS(
  salarioBruto: number,
  opts: { pyme?: boolean } = {},
): { baseAplicada: number; inssLaboral: number; inssPatronal: number; inatec: number; netoTrasINSS: number } {
  const bruto = new Decimal(salarioBruto || 0);
  const base = Decimal.min(bruto, TECHO_INSS_MENSUAL);
  const patronalRate = opts.pyme ? INSS_PATRONAL_RATE_PYME : INSS_PATRONAL_RATE_DEFAULT;
  const inssLaboral = base.mul(INSS_LABORAL_RATE);
  const inssPatronal = base.mul(patronalRate);
  const inatec = bruto.mul(INATEC_RATE); // INATEC sobre el total, no sobre el techo
  return {
    baseAplicada: money(base),
    inssLaboral: money(inssLaboral),
    inssPatronal: money(inssPatronal),
    inatec: money(inatec),
    netoTrasINSS: money(bruto.minus(inssLaboral)),
  };
}

/**
 * Liquidación / finiquito. Espejo de calculateSettlement del ERP (Art. 42-45, 76, 93):
 * indemnización por antigüedad (30 días/año los primeros 3, 20 días/año desde el 4º;
 * fracciones proporcionales; piso 1 mes, techo 5 meses) + vacaciones pendientes.
 * Aplica indemnización solo en despido o mutuo acuerdo (no en renuncia).
 */
export function calcLiquidacion(params: {
  salarioMensual: number;
  aniosServicio: number;
  diasVacacionesPendientes: number;
  motivo: 'DESPIDO' | 'RENUNCIA' | 'MUTUO';
}): { indemnizacionDias: number; indemnizacion: number; vacaciones: number; total: number; aplicaIndemnizacion: boolean } {
  const salarioMensual = new Decimal(params.salarioMensual || 0);
  const salarioDiario = salarioMensual.dividedBy(30);
  const anios = Math.max(0, params.aniosServicio || 0);
  const aplicaIndemnizacion = params.motivo === 'DESPIDO' || params.motivo === 'MUTUO';

  let indemnizacionDias = 0;
  if (aplicaIndemnizacion && anios > 0) {
    const completos = Math.floor(anios);
    for (let i = 1; i <= completos; i++) indemnizacionDias += i <= 3 ? 30 : 20;
    const fraccion = anios - completos;
    indemnizacionDias += fraccion * ((completos + 1) <= 3 ? 30 : 20);
  }
  let indemnizacion = salarioDiario.mul(indemnizacionDias);
  if (aplicaIndemnizacion && anios > 0) {
    if (indemnizacion.lessThan(salarioMensual)) indemnizacion = salarioMensual;             // piso 1 mes
    const tope = salarioMensual.mul(INDEMNIZACION_TOPE_MESES);
    if (indemnizacion.greaterThan(tope)) indemnizacion = tope;                               // techo 5 meses
  }

  const diasVac = Math.max(0, params.diasVacacionesPendientes || 0);
  const vacaciones = salarioDiario.mul(diasVac);

  return {
    indemnizacionDias: Number(indemnizacionDias.toFixed(1)),
    indemnizacion: money(indemnizacion),
    vacaciones: money(vacaciones),
    total: money(indemnizacion.plus(vacaciones)),
    aplicaIndemnizacion,
  };
}

/** Desglose de IVA de un precio con IVA incluido. ERP: neto = total/1.15; iva = total − neto. */
export function calcIVA(montoConIVA: number): { neto: number; iva: number; total: number } {
  const total = new Decimal(montoConIVA || 0);
  const neto = total.dividedBy(new Decimal(IVA_RATE).plus(1));
  const iva = total.minus(neto);
  return { neto: money(neto), iva: money(iva), total: money(total) };
}
