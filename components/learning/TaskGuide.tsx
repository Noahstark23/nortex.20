import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { learningGuides, guideAt } from '../../utils/learningGuides';
import { currentOnboardingStorageKeys } from '../../utils/onboardingStorage';
import { trackEvent } from '../../utils/analytics';

function readPosition(key: string | null, length: number): number {
  try {
    const value = Number(key && localStorage.getItem(key));
    return Number.isInteger(value) && value >= 0 && value < length ? value : 0;
  } catch { return 0; }
}

const Guide: React.FC<{ id: string }> = ({ id }) => {
  const guide = learningGuides[id];
  const scope = currentOnboardingStorageKeys()?.welcome;
  const key = scope ? `${scope}:guide-v2:${id}` : null;
  const [index, setIndex] = useState(() => readPosition(key, guide.steps.length));
  const [expanded, setExpanded] = useState(true);
  const [notice, setNotice] = useState('');
  const step = guide.steps[index];
  useEffect(() => { trackEvent('tutorial_guide_opened', { tutorial: id }); }, [id]);
  const change = (next: number) => {
    setIndex(next); setNotice('');
    try { if (key) localStorage.setItem(key, String(next)); } catch { /* Indicaciones disponibles sin almacenamiento. */ }
    trackEvent('tutorial_instruction_viewed', { tutorial: id, step: next + 1 });
  };
  const locate = () => {
    // Solo enfoca un control visible: nunca pulsa ni envía un formulario.
    const target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (!target || target.getClientRects().length === 0 || document.querySelector('[aria-modal="true"], [data-camera-scanner]')) {
      setNotice('Ese control aún no está disponible. Terminá o cerrá el panel abierto; también puede requerir permisos o datos previos.');
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'auto' }); target.focus(); setNotice('');
  };
  return <section aria-label={`Guía: ${guide.title}`} className="nx-workspace nx-canvas-card shrink-0 rounded-none border-x-0 border-t-0 px-4 py-3 sm:px-6 max-h-[35vh] overflow-y-auto">
    <div className="flex items-center justify-between gap-3">
      <p className="nx-canvas-text text-sm font-bold flex items-center gap-2"><BookOpen size={17} aria-hidden="true" />{guide.title} <span className="nx-canvas-muted font-normal">· {index + 1}/{guide.steps.length}</span></p>
      <button type="button" className="nx-fluid-press nx-canvas-muted min-h-tap px-2 text-sm font-semibold" aria-expanded={expanded} aria-controls="task-guide-content" onClick={() => { setExpanded(!expanded); trackEvent(expanded ? 'tutorial_paused' : 'tutorial_resumed', { tutorial: id }); }}>
        {expanded ? 'Pausar guía' : 'Retomar guía'}{expanded ? <ChevronUp className="inline ml-1" size={16} /> : <ChevronDown className="inline ml-1" size={16} />}
      </button>
    </div>
    {expanded && <div id="task-guide-content">
      <h2 className="nx-canvas-text font-bold">{step.title}</h2>
      <p className="nx-canvas-muted text-sm mt-1 max-w-4xl">{step.instruction}</p>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {step.target && <button type="button" onClick={locate} className="nx-fluid-press min-h-tap rounded-control bg-brand px-4 text-brand-on text-sm font-bold">Mostrar dónde</button>}
        <button type="button" disabled={index === 0} onClick={() => change(index - 1)} className="nx-fluid-press nx-canvas-muted min-h-tap px-3 text-sm disabled:opacity-40">Anterior</button>
        {index < guide.steps.length - 1
          ? <button type="button" onClick={() => change(index + 1)} className="nx-fluid-press nx-canvas-text min-h-tap px-3 text-sm font-bold">Siguiente indicación</button>
          : <button type="button" onClick={() => setExpanded(false)} className="nx-fluid-press nx-canvas-text min-h-tap px-3 text-sm font-bold">Ocultar guía</button>}
        <span className="nx-canvas-muted text-xs">Estás en tu negocio real. La guía no guarda operaciones.</span>
      </div>
      {notice && <p role="status" className="nx-tone-warning text-sm mt-2">{notice}</p>}
    </div>}
  </section>;
}

/** No overlay: los controles y el carrito permanecen disponibles. Cambiar de módulo la oculta. */
export default function TaskGuide() {
  const location = useLocation();
  const [requested, setRequested] = useState<{ id: string; path: string } | null>(null);
  useEffect(() => {
    const start = (event: Event) => {
      const id = guideAt((event as CustomEvent).detail, window.location.pathname);
      if (id) setRequested({ id, path: window.location.pathname });
    };
    window.addEventListener('nortex:learning-guide', start);
    return () => window.removeEventListener('nortex:learning-guide', start);
  }, []);
  const fromUrl = guideAt(new URLSearchParams(location.search).get('tour'), location.pathname);
  const id = fromUrl || (requested?.path === location.pathname ? requested.id : null);
  const scope = currentOnboardingStorageKeys()?.welcome || 'anonymous';
  return id ? <Guide key={`${scope}:${id}`} id={id} /> : null;
}
