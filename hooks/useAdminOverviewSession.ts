import { useMemo, useSyncExternalStore } from 'react';
import { readActivationSession } from './useActivationJourney';

export interface AdminOverviewSession {
    token: string | null;
    tenantId: string | null;
    userId: string | null;
    role: string | null;
    key: string;
}

/** La identidad local sólo separa vistas/cache; el backend sigue autorizando. */
export function readAdminOverviewSession(): AdminOverviewSession {
    const { token, tenantId } = readActivationSession();
    let userId: string | null = null, role: string | null = null;
    try {
        const user = JSON.parse(localStorage.getItem('nortex_user') || '{}');
        userId = typeof user.id === 'string' ? user.id : null;
        role = typeof user.role === 'string' ? user.role : null;
    } catch { /* Una identidad ilegible no habilita herramientas privadas. */ }
    return { token, tenantId, userId, role, key: JSON.stringify([token, tenantId, userId, role]) };
}

function subscribe(listener: () => void) {
    const events = ['storage', 'nortex:data-changed', 'focus', 'pageshow'];
    events.forEach(name => window.addEventListener(name, listener));
    document.addEventListener('visibilitychange', listener);
    return () => {
        events.forEach(name => window.removeEventListener(name, listener));
        document.removeEventListener('visibilitychange', listener);
    };
}

export function useAdminOverviewSession(): AdminOverviewSession {
    const key = useSyncExternalStore(subscribe, () => readAdminOverviewSession().key, () => '[null,null,null,null]');
    return useMemo(() => {
        const [token, tenantId, userId, role] = JSON.parse(key);
        return { key, token, tenantId, userId, role };
    }, [key]);
}
