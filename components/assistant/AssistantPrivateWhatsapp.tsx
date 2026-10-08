import { useEffect, useRef, useState } from 'react';
import type { AssistantRequest } from '../../hooks/useNortexAssistant';
import { assistantButtonClass } from './AssistantCatalogSelect';
interface Binding { linked: boolean; phoneSuffix?: string; linkedAt?: string }
interface Challenge { phone?: string; code: string; expiresAt: string; instruction: string }
export function AssistantPrivateWhatsapp({ request }: { request: AssistantRequest }) {
    const [binding, setBinding] = useState<Binding | null>(null); const [challenge, setChallenge] = useState<Challenge | null>(null);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const alive = useRef(true); const locked = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => { if (!challenge) return; const timer = window.setTimeout(() => setChallenge(null), Math.max(0, new Date(challenge.expiresAt).getTime() - Date.now())); return () => clearTimeout(timer); }, [challenge]);
    const act = async (kind: 'read' | 'link' | 'unlink') => {
        if (locked.current) return; locked.current = true; setBusy(true); setError('');
        try {
            if (kind === 'link') { const value = await request<Challenge>('/private-whatsapp/challenge', { method: 'POST', body: '{}' }); if (alive.current) setChallenge(value); }
            else if (kind === 'unlink') { await request('/private-whatsapp/binding', { method: 'DELETE', body: '{}' }); if (alive.current) { setBinding({ linked: false }); setChallenge(null); } }
            else { const value = await request<Binding>('/private-whatsapp/binding'); if (alive.current) { setBinding(value); if (value.linked) setChallenge(null); } }
        } catch { if (alive.current) setError('No pudimos comprobar la vinculación. Volvé a consultar antes de intentarlo otra vez.'); }
        finally { locked.current = false; if (alive.current) setBusy(false); }
    };
    return <details className="nx-shell-control space-y-3 rounded-card border p-3"><summary className="nx-shell-text min-h-tap cursor-pointer text-sm font-semibold">Mi WhatsApp privado</summary>
        <p className="nx-shell-muted text-sm">Vinculá tu número personal para continuar consultas de este negocio con tus permisos actuales. Consultá a tu administrador el número privado de Nortex.</p>
        {binding && <p role="status" className="nx-shell-text text-sm">{binding.linked ? `Vinculado al número que termina en ${binding.phoneSuffix ?? '••••'}.` : 'Todavía no hay un número vinculado.'}</p>}
        {challenge && <div className="nx-tone-warning space-y-2 rounded-control border p-3"><p className="break-words text-sm">Desde tu WhatsApp personal, enviá este mensaje {challenge.phone ? `al número ${challenge.phone}` : 'al número privado de Nortex indicado por tu administrador'}:</p><code className="block select-all break-all text-sm">VINCULAR {challenge.code}</code><p className="text-xs">Vence a las {new Date(challenge.expiresAt).toLocaleTimeString('es-NI', { timeZone: 'America/Managua' })}, hora de Managua. Es de un solo uso. Al generar otro código, este queda inválido.</p></div>}
        {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void act('read')}>Comprobar vinculación</button><button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void act('link')}>{challenge ? 'Generar otro código' : 'Vincular mi WhatsApp'}</button>{binding?.linked && <button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void act('unlink')}>Desvincular mi número</button>}</div>
    </details>;
}
