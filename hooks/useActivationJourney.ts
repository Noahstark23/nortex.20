import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOnboardingStatus, type OnboardingStatus } from '../utils/onboardingStatus';

export interface ActivationSession {
    token: string | null;
    tenantId: string | null;
    key: string;
}

/** Identidad para descartar respuestas de otra sesión. El backend autoriza con JWT. */
export function readActivationSession(): ActivationSession {
    const token = localStorage.getItem('nortex_token');
    let tenantId: string | null = localStorage.getItem('nortex_tenant_id');
    try {
        const user = JSON.parse(localStorage.getItem('nortex_user') || '{}');
        tenantId = user?.tenant?.id || tenantId;
    } catch { /* La sesión incompleta conserva un identificador estable. */ }
    return { token, tenantId, key: JSON.stringify([token, tenantId]) };
}

export function useActivationSession(): ActivationSession {
    const [session, setSession] = useState(readActivationSession);
    useEffect(() => {
        const syncSession = () => {
            const next = readActivationSession();
            setSession(previous => previous.key === next.key ? previous : next);
        };
        window.addEventListener('storage', syncSession);
        window.addEventListener('nortex:data-changed', syncSession);
        return () => {
            window.removeEventListener('storage', syncSession);
            window.removeEventListener('nortex:data-changed', syncSession);
        };
    }, []);
    return session;
}

export type SalesJourney = 'first' | 'next' | 'continuing' | 'unknown';
interface JourneyState {
    status: 'loading' | 'ready' | 'error';
    journey: SalesJourney;
    hasProduct: boolean;
    /** null = el servidor anterior no aporta evidencia de días distintos. */
    returnedOnAnotherBusinessDate: boolean | null;
}

const initialState: JourneyState = { status: 'loading', journey: 'unknown', hasProduct: false, returnedOnAnotherBusinessDate: null };

function journeyFrom(data: OnboardingStatus): Omit<JourneyState, 'status'> {
    if (!Array.isArray(data.steps)) throw new Error('Respuesta de progreso incompleta');
    const sale = data.steps.find(step => step.key === 'sale');
    const count = data.salesProgress?.confirmedSales;
    const hasCount = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
    return {
        // Un backend anterior solo informa si hubo venta: no significa que hubo UNA.
        journey: hasCount
            ? count === 0 ? 'first' : count === 1 ? 'next' : 'continuing'
            : sale ? sale.done ? 'continuing' : 'first' : 'unknown',
        hasProduct: data.steps.some(step => step.key === 'product' && step.done),
        returnedOnAnotherBusinessDate: typeof data.salesProgress?.returnedOnAnotherBusinessDate === 'boolean'
            ? data.salesProgress.returnedOnAnotherBusinessDate : null,
    };
}

export function useActivationJourney(session: ActivationSession) {
    const [state, setState] = useState<JourneyState>(initialState);
    const refreshRef = useRef<(() => void) | null>(null);
    const retry = useCallback(() => refreshRef.current?.(), []);

    useEffect(() => {
        let mounted = true;
        let generation = 0;
        let pending: Promise<OnboardingStatus> | null = null;
        const isCurrent = (request: number) => mounted
            && request === generation
            && readActivationSession().key === session.key;

        const refresh = async (force = false) => {
            const request = ++generation;
            if (readActivationSession().key !== session.key) return;
            setState(previous => ({ ...previous, status: 'loading' }));
            if (!session.token) {
                if (isCurrent(request)) setState({ ...initialState, status: 'error' });
                return;
            }
            try {
                // Un cambio mientras carga exige una lectura posterior. Reutilizar la
                // promesa vieja mostraría el estado anterior a la venta recién hecha.
                if (force && pending) await pending.catch(() => undefined);
                if (!isCurrent(request)) return;
                const promise = fetchOnboardingStatus(session.token, { force });
                pending = promise;
                const data = await promise;
                if (pending === promise) pending = null;
                if (isCurrent(request)) setState({ ...journeyFrom(data), status: 'ready' });
            } catch {
                if (isCurrent(request)) setState(previous => ({ ...previous, status: 'error' }));
            }
        };

        const onChange = () => { void refresh(true); };
        refreshRef.current = onChange;
        window.addEventListener('nortex:data-changed', onChange);
        void refresh(true);
        return () => {
            mounted = false;
            generation += 1;
            refreshRef.current = null;
            window.removeEventListener('nortex:data-changed', onChange);
        };
    }, [session.key, session.token]);

    return { ...state, retry };
}
