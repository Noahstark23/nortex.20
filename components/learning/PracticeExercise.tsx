import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { formatMoney } from '../../utils/money';
import { trackEvent } from '../../utils/analytics';

export type PracticeKind = 'inv' | 'compras' | 'fiado';
const exercises = {
  inv: {
    title: 'Creá una ficha de producto',
    task: 'Tenés una bolsa de arroz de 1 kg, marca Del Campo, que vendés a 35 córdobas. Completá su ficha de ejemplo.',
    fields: [['name', 'Nombre', 'Arroz 1 kg'], ['brand', 'Marca', 'Del Campo'], ['price', 'Precio de venta', '35']],
    action: 'Guardar ficha de práctica',
    result: 'Ficha de ejemplo guardada. Todavía tiene 0 unidades: crear un producto no significa recibir mercadería.',
    lesson: 'Nombre y marca van por separado. La presentación distingue la bolsa de 1 kg de otras. El precio de venta es lo que cobrás, no tu costo.',
  },
  compras: {
    title: 'Recibí una compra de ejemplo',
    task: 'Llegaron 6 bolsas de arroz. La factura indica 25 córdobas por bolsa. La ficha ya existe y la bodega de ejemplo tiene 0 unidades.',
    fields: [['quantity', 'Cantidad recibida (unidades)', '6'], ['cost', 'Costo por unidad', '25']],
    action: 'Revisar recepción de práctica',
    result: 'Recepción de ejemplo confirmada: 6 unidades disponibles. El precio de venta no reemplaza el costo de la factura.',
    lesson: 'Primero revisás cantidad, costo y bodega. Después confirmás. Si una orden ya fue recibida, facturarla no debe volver a sumar existencias.',
  },
  fiado: {
    title: 'Registrá un abono de ejemplo',
    task: 'Cliente de ejemplo debe 200 córdobas y hoy te entrega 50 en efectivo. Registrá únicamente lo recibido.',
    fields: [['payment', 'Efectivo recibido', '50']],
    action: 'Revisar abono de práctica',
    result: 'Abono de ejemplo confirmado. Recibiste 50 córdobas y quedan 150 pendientes.',
    lesson: 'Un abono reduce la deuda; no es otra venta. Revisá el cliente, el medio de pago, el recibo y el saldo restante.',
  },
} as const;

/** Ejercicios con fixtures fijos: no hay cliente HTTP, catálogo real ni motor financiero paralelo. */
const PracticeExercise: React.FC<{ kind: PracticeKind; onClose: () => void; onReal: () => void }> = ({ kind, onClose, onReal }) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.scrollIntoView?.({ block: 'start' }); heading.current?.focus(); trackEvent('tutorial_exercise_opened', { tutorial: kind }); }, [kind]);
  const exercise = exercises[kind];
  const [values, setValues] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'entry' | 'review' | 'done'>('entry');
  const [error, setError] = useState('');
  const validate = (event: React.FormEvent) => {
    event.preventDefault();
    const incorrect = exercise.fields.find(([key, , expected]) => {
      const value = (values[key] || '').trim().toLocaleLowerCase('es');
      return ['price', 'quantity', 'cost', 'payment'].includes(key)
        ? !/^\d+(?:[.,]\d{1,2})?$/.test(value) || Number(value.replace(',', '.')) !== Number(expected)
        : value.replace(/\s+/g, ' ') !== expected.toLocaleLowerCase('es');
    });
    if (incorrect) { setError(`Revisá ${incorrect[1].toLocaleLowerCase('es')}: en este ejemplo corresponde ${incorrect[2]}. Podés corregirlo sin perder lo escrito.`); return; }
    setError(''); setPhase(kind === 'inv' ? 'done' : 'review');
    if (kind === 'inv') trackEvent('tutorial_practice_completed', { tutorial: kind });
  };
  const confirm = () => { setPhase('done'); trackEvent('tutorial_practice_completed', { tutorial: kind }); };
  return <section aria-labelledby="practice-exercise-title" className="nx-canvas-card p-5 sm:p-7 mb-6">
    <div className="flex justify-between items-center gap-3 mb-4">
      <span className="nx-tone-positive text-sm font-bold">Práctica · datos de ejemplo</span>
      <button type="button" onClick={onClose} className="nx-fluid-press nx-canvas-muted min-h-tap px-3 text-sm font-semibold">Volver a tutoriales</button>
    </div>
    <h2 ref={heading} tabIndex={-1} id="practice-exercise-title" className="nx-canvas-text text-2xl font-bold">{exercise.title}</h2>
    <p className="nx-canvas-muted mt-2">{exercise.task}</p>
    <p className="nx-canvas-muted text-sm mt-2">Nada de esta práctica modifica tu caja, tus clientes ni tu inventario.</p>
    {phase === 'entry' && <form onSubmit={validate} className="mt-5 max-w-xl space-y-4">
      {exercise.fields.map(([key, label, example]) => <div key={key}>
        <label htmlFor={`practice-${key}`} className="nx-canvas-text block text-sm font-semibold mb-1">{label}</label>
        <input id={`practice-${key}`} value={values[key] || ''} onChange={event => setValues({ ...values, [key]: event.target.value })} autoComplete="off" inputMode={['name', 'brand'].includes(key) ? 'text' : 'decimal'} placeholder={`Ej.: ${example}`} className="nx-input w-full min-h-tap rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-bg)] px-3 py-2 text-[var(--nx-canvas-text)]" aria-describedby={error ? 'practice-error' : undefined} />
      </div>)}
      {error && <p id="practice-error" role="alert" className="nx-tone-warning text-sm">{error}</p>}
      <button type="submit" className="nx-fluid-press min-h-tap rounded-control bg-brand px-5 py-3 font-bold text-brand-on">{exercise.action}</button>
    </form>}
    {phase === 'review' && <div className="mt-5 max-w-xl">
      <h3 className="nx-canvas-text text-lg font-bold">Revisá antes de confirmar</h3>
      <p className="nx-canvas-muted mt-2">{kind === 'compras' ? `Bodega de ejemplo · 6 bolsas × ${formatMoney(25)}. Total sin impuestos: ${formatMoney(150)}. Existencia después: 6 unidades.` : `Cliente de ejemplo · deuda ${formatMoney(200)}. Abono en efectivo: ${formatMoney(50)}. Saldo restante: ${formatMoney(150)}.`}</p>
      <div className="flex flex-wrap gap-3 mt-4">
        <button type="button" onClick={() => setPhase('entry')} className="nx-fluid-press nx-canvas-text min-h-tap rounded-control px-4 border border-[var(--nx-canvas-border)]">Corregir datos</button>
        <button type="button" onClick={confirm} className="nx-fluid-press min-h-tap rounded-control bg-brand px-5 text-brand-on font-bold">Confirmar solo el ejemplo</button>
      </div>
    </div>}
    {phase === 'done' && <div className="mt-5">
      <p role="status" className="nx-tone-positive font-bold flex items-start gap-2"><CheckCircle2 size={22} className="shrink-0" aria-hidden="true" />{exercise.result}</p>
      <p className="nx-canvas-muted mt-3 max-w-2xl">{exercise.lesson}</p>
      <div className="flex flex-wrap gap-3 mt-5">
        <button type="button" onClick={onReal} className="nx-fluid-press min-h-tap rounded-control bg-brand px-5 py-3 font-bold text-brand-on">Abrir guía en mi negocio</button>
        <button type="button" onClick={() => { setValues({}); setPhase('entry'); }} className="nx-fluid-press nx-canvas-text min-h-tap rounded-control px-4 border border-[var(--nx-canvas-border)]">Repetir práctica</button>
      </div>
    </div>}
  </section>;
}

export default PracticeExercise;
