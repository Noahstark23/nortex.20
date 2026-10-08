import { useCallback, useEffect, useRef, useState } from 'react';
import { readActivationSession, useActivationSession } from './useActivationJourney';
import type { OperationalAlertsResponse } from '../utils/operationalAlerts';

const ids = new Set(['out_of_stock', 'low_stock', 'expired_batches', 'expiring_batches', 'pending_orders']);

function parseResponse(value: unknown): OperationalAlertsResponse {
    const data = value as OperationalAlertsResponse;
    if (!data || typeof data.checkedAt !== 'string' || !Number.isFinite(Date.parse(data.checkedAt))
        || !Array.isArray(data.sections) || new Set(data.sections.map(s => s.id)).size !== data.sections.length
        || data.sections.some(s => !ids.has(s.id) || !['ok', 'error'].includes(s.status)
            || (s.status === 'ok' ? !Number.isSafeInteger(s.count) || (s.count ?? -1) < 0
                || (s.samples !== undefined && (!Array.isArray(s.samples) || s.samples.length > 3
                    || s.samples.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string'
                        || (item.detail !== undefined && typeof item.detail !== 'string')))) : s.count !== null))) {
        throw new Error('Resumen de avisos incompleto');
    }
    return data;
}

/** Una lectura por sesión; las respuestas anteriores nunca sobreviven a un cambio de identidad. */
export function useOperationalAlerts(open: boolean) {
    const session = useActivationSession();
    const [state, setState] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; data: OperationalAlertsResponse | null }>({
        key: session.key, status: 'loading', data: null,
    });
    const refreshRef = useRef<(() => void) | null>(null);
    const refresh = useCallback(() => refreshRef.current?.(), []);
    useEffect(() => {
        let disposed = false;
        let generation = 0;
        let controller: AbortController | null = null;
        const current = (request: number) => !disposed && request === generation && readActivationSession().key === session.key;
        const load = async () => {
            const request = ++generation;
            controller?.abort();
            controller = new AbortController();
            setState({ key: session.key, status: 'loading', data: null });
            try {
                if (!session.token || !navigator.onLine) throw new Error('Sin conexión');
                const response = await fetch('/api/operational-alerts', {
                    headers: { Authorization: `Bearer ${session.token}` },
                    signal: controller.signal, cache: 'no-store',
                });
                if (!response.ok) throw new Error('No se pudieron consultar los avisos');
                const data = parseResponse(await response.json());
                if (current(request)) setState({ key: session.key, status: 'ready', data });
            } catch {
                if (current(request)) setState({ key: session.key, status: 'error', data: null });
            }
        };
        const onChange = () => { void load(); };
        const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
        refreshRef.current = onChange;
        onChange();
        window.addEventListener('nortex:data-changed', onChange);
        window.addEventListener('online', onChange);
        window.addEventListener('offline', onChange);
        document.addEventListener('visibilitychange', onVisible);
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') onChange(); }, 60_000);
        return () => {
            disposed = true; controller?.abort(); refreshRef.current = null;
            clearInterval(timer);
            window.removeEventListener('nortex:data-changed', onChange);
            window.removeEventListener('online', onChange);
            window.removeEventListener('offline', onChange);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [session.key, session.token]);
    useEffect(() => { if (open) refresh(); }, [open, refresh]);
    return { ...(state.key === session.key && readActivationSession().key === session.key ? state : { status: 'loading' as const, data: null }), refresh, sessionKey: session.key };
}
