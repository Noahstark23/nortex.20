import React, { lazy, Suspense, useId, useState } from 'react';

const KnowledgeEditorialPanel = lazy(() => import('./knowledge/KnowledgeEditorialPanel'));

/** Abrir/cerrar conserva el trabajo editorial en memoria; la pantalla se carga al solicitarla. */
export function AssistantKnowledgeEditorial({ onPendingWorkChange }: { onPendingWorkChange?: (pending: boolean) => void } = {}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const id = useId();
  return <section className="nx-shell-surface my-4 space-y-3 rounded-card border p-4">
    <button type="button" className="nx-shell-control nx-shell-text rounded-control border px-4 py-2 text-sm font-semibold"
      aria-expanded={open} aria-controls={id} onClick={() => { setLoaded(true); setOpen(value => !value); }}>
      {open ? 'Ocultar revisión de ayuda' : 'Revisar ayuda de NortexGPT'}
    </button>
    <div id={id} hidden={!open}>
      {loaded && <Suspense fallback={<p role="status" className="nx-shell-muted text-sm">Cargando revisión de ayuda…</p>}><KnowledgeEditorialPanel onPendingWorkChange={onPendingWorkChange} /></Suspense>}
    </div>
  </section>;
}
