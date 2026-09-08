import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator as CalcIcon, ArrowRight } from 'lucide-react';
import { trackEvent } from '../utils/analytics';
import { TASAS_ANIO, tasasVerificadas } from '../utils/tasas';
import { CALCULADORAS, type CalculatorType, type CalcResultRow } from '../utils/calculadoras';

/**
 * Calculadora pública reutilizable para las guías del blog (SEO + captación).
 * Cálculo client-side en tiempo real. Las definiciones (campos, selects y las
 * fórmulas que llaman a utils/calc-laborales) viven en utils/calculadoras.ts —
 * NO acá — porque scripts/prerender.ts también las necesita para emitir la
 * herramienta en el HTML estático: sin eso el crawler no veía que existiera.
 * Al calcular dispara el evento GA4 `calculadora_usada`; el CTA lleva a
 * /register (evento `cta_click`).
 */

export type { CalculatorType };

const Calculator: React.FC<{ type: CalculatorType }> = ({ type }) => {
  const config = CALCULADORAS[type];
  const [values, setValues] = useState<Record<string, string>>({});
  const [selects, setSelects] = useState<Record<string, string>>(
    config.select ? { [config.select.key]: config.select.options[0].value } : {},
  );
  const [results, setResults] = useState<CalcResultRow[] | null>(null);

  const onCalcular = () => {
    const nums: Record<string, number> = {};
    for (const f of config.fields) nums[f.key] = parseFloat(values[f.key] || '') || 0;
    setResults(config.compute(nums, selects));
    // Evento de conversión: se dispara al CALCULAR (no en cada tecla).
    trackEvent('calculadora_usada', { calculadora: type, anio: TASAS_ANIO });
  };

  return (
    <section className="nx-public-calculator my-8 rounded-3xl border p-5 sm:p-6 not-prose" aria-labelledby={`calculator-${type}-title`}>
      <div className="mb-5 flex items-center gap-3">
        <div className="nx-public-calculator-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
          <CalcIcon size={19} />
        </div>
        <h3 id={`calculator-${type}-title`} className="m-0 text-lg font-semibold tracking-[-0.015em]">{config.titulo}</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {config.fields.map((f) => (
          <label key={f.key} className="text-sm">
            <span className="nx-public-muted mb-1.5 block font-medium">{f.label}</span>
            <div className="nx-public-field flex min-h-[44px] items-center overflow-hidden rounded-xl border">
              <input
                type="number" inputMode="decimal" min="0" step={f.step ?? '0.01'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                className="min-h-[44px] w-full bg-transparent px-3 py-2 outline-none"
                placeholder="0"
              />
              {f.suffix && <span className="nx-public-subtle whitespace-nowrap px-3 text-[13px] font-medium">{f.suffix}</span>}
            </div>
          </label>
        ))}
        {config.select && (
          <label className="text-sm sm:col-span-2">
            <span className="nx-public-muted mb-1.5 block font-medium">{config.select.label}</span>
            <select
              value={selects[config.select.key]}
              onChange={(e) => setSelects((p) => ({ ...p, [config.select!.key]: e.target.value }))}
              className="nx-public-field min-h-[44px] w-full rounded-xl border px-3 py-2 outline-none"
            >
              {config.select.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={onCalcular}
        className="nx-public-primary mt-5 w-full px-6 sm:w-auto"
      >
        Calcular
      </button>

      {results && (
        <div className="nx-public-calculator-results mt-5 overflow-hidden rounded-2xl border" aria-live="polite">
          {results.map((r, i) => (
            <div key={i} className={`nx-public-calculator-result flex items-center justify-between gap-4 px-4 py-3 ${r.strong ? 'nx-public-calculator-result-strong' : ''}`}>
              <span className={`text-sm ${r.strong ? 'font-semibold' : 'nx-public-muted'}`}>{r.label}</span>
              <span className={`font-mono text-right ${r.strong ? 'text-lg font-bold' : 'nx-public-muted'}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      <p className="nx-public-subtle mt-4 text-[13px] leading-relaxed">
        Cálculo referencial según la legislación nicaragüense (Ley 185 / Ley 539 / DGI).
        {!tasasVerificadas() && ' Verificá las tasas vigentes con INSS/DGI/MITRAB antes de usarlo para un pago real.'}
        {' '}Para nómina, aguinaldo e impuestos automáticos y siempre al día, usá Nortex.
      </p>

      {results && (
        <Link
          to="/register"
          onClick={() => trackEvent('cta_click', { location: `calc_${type}` })}
          className="nx-public-link mt-3 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold"
        >
          Automatizá esto con Nortex — probá gratis <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </section>
  );
};

export default Calculator;
