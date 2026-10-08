import { useEffect, useState } from 'react';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { readActivationSession, useActivationSession } from '../../hooks/useActivationJourney';
import type { AssistantCapabilities } from '../../shared/assistant';

/** Novedad informativa: fuera del conteo de incidencias y solo con acceso comprobado. */
export function NortexAssistantNotice({ active, onOpen }: { active: boolean; onOpen: () => void }) {
    const session = useActivationSession();
    const [access, setAccess] = useState<{ key: string; caps: AssistantCapabilities } | null>(null);
    useEffect(() => {
        setAccess(null);
        if (!active || !session.token || !navigator.onLine) return;
        let current = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10_000);
        void (async () => {
            try {
                const response = await fetch('/api/assistant/capabilities', { cache: 'no-store', signal: controller.signal,
                    headers: { Authorization: `Bearer ${session.token}` } });
                if (!response.ok) return;
                const caps = await response.json() as AssistantCapabilities;
                if (current && readActivationSession().key === session.key && caps.enabled === true && caps.help === true) setAccess({ key: session.key, caps });
            } catch { /* No anunciar disponibilidad cuando no se pudo comprobar. */ }
            finally { clearTimeout(timeout); }
        })();
        return () => { current = false; clearTimeout(timeout); controller.abort(); };
    }, [active, session.key, session.token]);
    if (!active || !access || access.key !== session.key) return null;
    const caps = access.caps;
    return <section aria-label="Conocé NortexGPT" className="nx-shell-control rounded-card border p-4">
        <h3 className="nx-shell-text flex items-center gap-2 font-semibold"><MessageSquare size={18} aria-hidden="true" /> Conocé NortexGPT</h3>
        <p className="nx-shell-muted mt-2 text-sm">Tu asistente dentro de Nortex. Preguntá cómo usar el sistema y consultá la información disponible para tu rol.</p>
        {caps.inventory === true && <p className="nx-shell-muted mt-2 text-sm">Revisá existencias y vencimientos con datos de tu negocio.</p>}
        {caps.purchasePrepare === true && <p className="nx-shell-muted mt-2 text-sm">Escribí «compré 50 bolsas de cemento» y completá los datos para preparar una compra.</p>}
        <p className="nx-shell-muted mt-2 text-sm">Preparar no registra cambios. Las operaciones disponibles requieren revisión y confirmación antes de afectar dinero o inventario.</p>
        <button type="button" onClick={onOpen} className="nx-shell-control nx-fluid-press mt-3 flex min-h-tap w-full items-center justify-between gap-2 rounded-control border px-3 text-sm font-semibold">Conocer NortexGPT<ArrowRight size={17} aria-hidden="true" /></button>
    </section>;
}
