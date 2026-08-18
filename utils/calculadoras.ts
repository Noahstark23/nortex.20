/**
 * NORTEX — Definición de las calculadoras públicas, SIN React.
 *
 * Por qué existe este archivo aparte del componente: `scripts/prerender.ts` no
 * monta React (arma el HTML con plantilla propia + markdownToHtml), así que la
 * calculadora de `components/Calculator.tsx` NO existía en el HTML estático —
 * solo aparecía tras hidratar. Google la ve recién en el segundo pase de
 * renderizado, que es diferido y best-effort, y los crawlers que alimentan los
 * AI Overviews no ejecutan JS en absoluto: para ellos la guía con calculadora
 * era indistinguible de un artículo de texto más. Encima ninguno de los posts
 * mencionaba la palabra "calculadora" en su cuerpo, así que no quedaba ni una
 * pista en el HTML crawleable.
 *
 * Al vivir acá, la MISMA definición alimenta el componente React (interactivo)
 * y el bloque estático del prerender (crawleable). Una sola fuente: si se agrega
 * un campo, aparece en los dos lados o en ninguno.
 *
 * Las fórmulas NO se duplican: salen de utils/calc-laborales.ts, que está en el
 * scope de mutation testing.
 */
import {
  calcAguinaldo, calcVacaciones, calcHorasExtras, calcINSS, calcLiquidacion, calcIVA,
} from './calc-laborales';

export type CalculatorType =
  | 'aguinaldo' | 'vacaciones' | 'horasExtras' | 'inss' | 'liquidacion' | 'iva';

export interface CalcField {
  key: string;
  label: string;
  suffix?: string;
  step?: string;
}

export interface CalcSelect {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface CalcResultRow {
  label: string;
  value: string;
  strong?: boolean;
}

export interface CalcConfig {
  /** Encabezado de la herramienta (se emite como <h2> en el HTML estático). */
  titulo: string;
  /** Una línea que explica qué resuelve; alimenta el bloque estático y el JSON-LD. */
  descripcion: string;
  fields: CalcField[];
  select?: CalcSelect;
  compute: (v: Record<string, number>, s: Record<string, string>) => CalcResultRow[];
}

/** Formato de córdobas para las filas de resultado. */
export const C$ = (n: number): string =>
  'C$ ' + n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CALCULADORAS: Record<CalculatorType, CalcConfig> = {
  aguinaldo: {
    titulo: 'Calculadora de aguinaldo (13.º mes)',
    descripcion: 'Calculá el aguinaldo proporcional de un trabajador según los meses laborados en el período (Art. 93, Ley 185).',
    fields: [
      { key: 'salarioMensual', label: 'Salario mensual', suffix: 'C$' },
      { key: 'meses', label: 'Meses trabajados en el año', suffix: 'meses', step: '1' },
    ],
    compute: (v) => {
      const r = calcAguinaldo(v.salarioMensual, v.meses);
      return [{ label: 'Aguinaldo a pagar', value: C$(r.aguinaldo), strong: true }];
    },
  },
  vacaciones: {
    titulo: 'Calculadora de vacaciones',
    descripcion: 'Calculá los días de vacaciones acumulados y su monto en córdobas (Art. 76: 2,5 días por mes, tope 30).',
    fields: [
      { key: 'salarioMensual', label: 'Salario mensual', suffix: 'C$' },
      { key: 'meses', label: 'Meses trabajados', suffix: 'meses', step: '1' },
    ],
    compute: (v) => {
      const r = calcVacaciones(v.salarioMensual, v.meses);
      return [
        { label: 'Días de vacaciones acumulados', value: `${r.dias} días` },
        { label: 'Monto a pagar', value: C$(r.monto), strong: true },
      ];
    },
  },
  horasExtras: {
    titulo: 'Calculadora de horas extra',
    descripcion: 'Calculá cuánto se paga por horas extra al doble de la hora ordinaria (Art. 62, Ley 185).',
    fields: [
      { key: 'salarioMensual', label: 'Salario mensual', suffix: 'C$' },
      { key: 'horas', label: 'Cantidad de horas extra', suffix: 'horas', step: '0.5' },
    ],
    compute: (v) => {
      const r = calcHorasExtras(v.salarioMensual, v.horas);
      return [
        { label: 'Valor de la hora ordinaria', value: C$(r.horaOrdinaria) },
        { label: 'A pagar por horas extra (al doble)', value: C$(r.monto), strong: true },
      ];
    },
  },
  inss: {
    titulo: 'Calculadora de INSS (laboral y patronal)',
    descripcion: 'Calculá el INSS laboral (7%), el patronal (21,5% o 22,5%) y el INATEC (2%) sobre un salario bruto.',
    fields: [{ key: 'salarioBruto', label: 'Salario bruto mensual', suffix: 'C$' }],
    select: {
      key: 'tamano', label: 'Tamaño de la empresa',
      options: [
        { value: 'grande', label: '50 empleados o más (patronal 22.5%)' },
        { value: 'pyme', label: 'Menos de 50 empleados (patronal 21.5%)' },
      ],
    },
    compute: (v, s) => {
      const r = calcINSS(v.salarioBruto, { pyme: s.tamano === 'pyme' });
      return [
        { label: 'INSS laboral (7%, lo paga el trabajador)', value: C$(r.inssLaboral) },
        { label: 'INSS patronal (lo paga la empresa)', value: C$(r.inssPatronal) },
        { label: 'INATEC (2%, empresa)', value: C$(r.inatec) },
        { label: 'Salario neto tras INSS laboral', value: C$(r.netoTrasINSS), strong: true },
      ];
    },
  },
  liquidacion: {
    titulo: 'Calculadora de liquidación / finiquito',
    descripcion: 'Calculá la indemnización por antigüedad (Art. 45) más las vacaciones pendientes al terminar un contrato.',
    fields: [
      { key: 'salarioMensual', label: 'Salario mensual', suffix: 'C$' },
      { key: 'anios', label: 'Años de servicio', suffix: 'años', step: '0.1' },
      { key: 'diasVac', label: 'Días de vacaciones pendientes', suffix: 'días', step: '1' },
    ],
    select: {
      key: 'motivo', label: 'Motivo de la terminación',
      options: [
        { value: 'DESPIDO', label: 'Despido (con indemnización, Art. 45)' },
        { value: 'MUTUO', label: 'Mutuo acuerdo (con indemnización)' },
        { value: 'RENUNCIA', label: 'Renuncia (sin indemnización)' },
      ],
    },
    compute: (v, s) => {
      const r = calcLiquidacion({
        salarioMensual: v.salarioMensual, aniosServicio: v.anios,
        diasVacacionesPendientes: v.diasVac,
        motivo: (s.motivo as 'DESPIDO' | 'RENUNCIA' | 'MUTUO') || 'DESPIDO',
      });
      const rows: CalcResultRow[] = [];
      if (r.aplicaIndemnizacion) rows.push({ label: `Indemnización (${r.indemnizacionDias} días)`, value: C$(r.indemnizacion) });
      rows.push({ label: 'Vacaciones pendientes', value: C$(r.vacaciones) });
      rows.push({ label: 'Total de la liquidación', value: C$(r.total), strong: true });
      return rows;
    },
  },
  iva: {
    titulo: 'Calculadora de IVA (15%)',
    descripcion: 'Separá el IVA de un precio que ya lo incluye y obtené el precio neto.',
    fields: [{ key: 'monto', label: 'Monto con IVA incluido', suffix: 'C$' }],
    compute: (v) => {
      const r = calcIVA(v.monto);
      return [
        { label: 'Precio neto (sin IVA)', value: C$(r.neto) },
        { label: 'IVA (15%)', value: C$(r.iva), strong: true },
      ];
    },
  },
};
