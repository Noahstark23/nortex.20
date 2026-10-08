import { useCallback, useEffect, useRef, useState } from 'react';
import { readActivationSession, type ActivationSession } from './useActivationJourney';

export class KnowledgeEditorialError extends Error {
    constructor(message: string, readonly status = 0) { super(message); }
}
export type KnowledgeEditorialRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

/** Sólo transporta ayuda oficial. El servidor vuelve a comprobar SUPER_ADMIN. */
export function useKnowledgeEditorial(session: ActivationSession) {
    const alive = useRef(true); const revoked = useRef(false);
    const controllers = useRef(new Set<AbortController>());
    const [denied, setDenied] = useState(false);
    const current = useCallback(() => alive.current && !revoked.current && readActivationSession().key === session.key, [session.key]);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; controllers.current.forEach(controller => controller.abort()); };
    }, []);
    const request = useCallback<KnowledgeEditorialRequest>(async (path: string, options: RequestInit = {}) => {
        if (!current() || !session.token) throw new KnowledgeEditorialError('La sesión cambió. Volvé a iniciar sesión.', 401);
        const controller = new AbortController(); controllers.current.add(controller);
        const timer = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(`/api/admin/assistant-knowledge${path}`, {
                ...options, cache: 'no-store', signal: controller.signal,
                headers: { Authorization: `Bearer ${session.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
            });
            if (!current()) throw new KnowledgeEditorialError('La sesión cambió.', 401);
            if ([401, 403].includes(response.status)) {
                revoked.current = true; setDenied(true);
                controllers.current.forEach(item => item.abort());
                throw new KnowledgeEditorialError('Tu sesión ya no permite editar la ayuda. Volvé a iniciar sesión.', response.status);
            }
            const value = await response.json().catch(() => null);
            if (!current()) throw new KnowledgeEditorialError('La sesión cambió.', 401);
            if (!response.ok) throw new KnowledgeEditorialError(typeof value?.error === 'string' ? value.error : 'No se pudo comprobar la operación editorial.', response.status);
            if (value === null) throw new KnowledgeEditorialError('La respuesta llegó incompleta. Comprobá el estado antes de repetir.');
            return value;
        } catch (failure) {
            if (failure instanceof KnowledgeEditorialError) throw failure;
            throw new KnowledgeEditorialError('La conexión se interrumpió. Comprobá el estado antes de repetir.');
        } finally { clearTimeout(timer); controllers.current.delete(controller); }
    }, [current, session.token]);
    return { request, current, denied };
}

export const editorialError = (failure: unknown) => failure instanceof Error ? failure.message : 'No se pudo comprobar la operación.';
export const uncertainEditorialResult = (failure: unknown) => !(failure instanceof KnowledgeEditorialError) || failure.status === 0 || failure.status >= 500;
