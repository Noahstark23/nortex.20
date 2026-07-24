import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator as CalcIcon, ArrowRight } from 'lucide-react';
import { trackEvent } from '../utils/analytics';
import { TASAS_ANIO, tasasVerificadas } from '../utils/tasas';
import {
  calcAguinaldo, calcVacaciones, calcHorasExtras, calcINSS, calcLiquidacion, calcIVA,
} from '../utils/calc-laborales';

/**
 * Calculadora pública reutilizable para las guías del blog (SEO + captación).
 * Cálculo client-side en tiempo real (reusa utils/calc-laborales, mismas fórmulas
 * que el ERP). Al calcular dispara el evento GA4 `calculadora_usada`; el CTA lleva
 * a /register (evento `cta_click`). Las tasas salen de utils/tasas.ts — hasta que
 * estén verificadas contra fuente oficial se muestra un aviso.
 */

export type CalculatorType = 'aguinaldo' | 'vacaciones' | 'horasExtras' | 'inss' | 'liquidacion' | 'iva';

const C$ = (n: number) =>
  'C$ ' + n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Field { key: string; label: string; suffix?: string; step?: string; }
interface ResultRow { label: string; value: string; strong?: boolean; }

interface CalcConfig {
  titulo: string;
  fields: Field[];
  select?: { key: string; label: string; options: { value: string; label: string }[] };
  compute: (v: Record<string, number>, s: Record<string, string>) => ResultRow[];
}

const CONFIGS: Record<CalculatorType, CalcConfig> = {
  aguinaldo: {
    titulo: 'Calculadora de aguinaldo (13º mes)',
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
    titulo: 'Calculadora de INSS',
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
      const rows: ResultRow[] = [];
      if (r.aplicaIndemnizacion) rows.push({ label: `Indemnización (${r.indemnizacionDias} días)`, value: C$(r.indemnizacion) });
      rows.push({ label: 'Vacaciones pendientes', value: C$(r.vacaciones) });
      rows.push({ label: 'Total de la liquidación', value: C$(r.total), strong: true });
      return rows;
    },
  },
  iva: {
    titulo: 'Calculadora de IVA (15%)',
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

const Calculator: React.FC<{ type: CalculatorType }> = ({ type }) => {
  const config = CONFIGS[type];
  const [values, setValues] = useState<Record<string, string>>({});
  const [selects, setSelects] = useState<Record<string, string>>(
    config.select ? { [config.select.key]: config.select.options[0].value } : {},
  );
  const [results, setResults] = useState<ResultRow[] | null>(null);

  const onCalcular = () => {
    const nums: Record<string, number> = {};
    for (const f of config.fields) nums[f.key] = parseFloat(values[f.key] || '') || 0;
    setResults(config.compute(nums, selects));
    // Evento de conversión: se dispara al CALCULAR (no en cada tecla).
    trackEvent('calculadora_usada', { calculadora: type, anio: TASAS_ANIO });
  };

  return (
    <div className="my-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6 not-prose">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-slate-900 text-white rounded-lg"><CalcIcon size={18} /></div>
        <h3 className="text-lg font-bold text-slate-900 m-0">{config.titulo}</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {config.fields.map((f) => (
          <label key={f.key} className="text-sm">
            <span className="block font-medium text-slate-600 mb-1">{f.label}</span>
            <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:border-slate-900">
              <input
                type="number" inputMode="decimal" min="0" step={f.step ?? '0.01'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-3 py-2 outline-none text-slate-900"
                placeholder="0"
              />
              {f.suffix && <span className="px-3 text-xs text-slate-400 whitespace-nowrap">{f.suffix}</span>}
            </div>
          </label>
        ))}
        {config.select && (
          <label className="text-sm sm:col-span-2">
            <span className="block font-medium text-slate-600 mb-1">{config.select.label}</span>
            <select
              value={selects[config.select.key]}
              onChange={(e) => setSelects((p) => ({ ...p, [config.select!.key]: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 outline-none focus:border-slate-900"
            >
              {config.select.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
      </div>

      <button
        onClick={onCalcular}
        className="mt-4 w-full sm:w-auto px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg transition-colors"
      >
        Calcular
      </button>

      {results && (
        <div className="mt-5 rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
          {results.map((r, i) => (
            <div key={i} className={`flex justify-between items-center px-4 py-3 ${r.strong ? 'bg-slate-50' : ''}`}>
              <span className={`text-sm ${r.strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{r.label}</span>
              <span className={`font-mono ${r.strong ? 'text-lg font-bold text-slate-900' : 'text-slate-700'}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Cálculo referencial según la legislación nicaragüense (Ley 185 / Ley 539 / DGI).
        {!tasasVerificadas() && ' Verificá las tasas vigentes con INSS/DGI/MITRAB antes de usarlo para un pago real.'}
        {' '}Para nómina, aguinaldo e impuestos automáticos y siempre al día, usá Nortex.
      </p>

      {results && (
        <Link
          to="/register"
          onClick={() => trackEvent('cta_click', { location: `calc_${type}` })}
          className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-slate-900 hover:gap-3 transition-all"
        >
          Automatizá esto con Nortex — probá gratis <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
};

export default Calculator;
