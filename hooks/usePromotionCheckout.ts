import { useCallback, useEffect, useRef, useState } from 'react';
import { promotionRecoveryStorage } from '../components/pos/PromotionRecoveryReference';
import type { PromotionCheckoutQuote } from '../shared/promotions';
type Payload = Record<string, unknown> & { offlineId: string; paymentMethod: string };
interface Attempt { signature: string; payload: Payload; quote: PromotionCheckoutQuote | null; accepted: boolean; uncertain: boolean; sent: boolean; recovered?: Record<string, any> }
const empty = { attempt: null as Attempt | null, open: false, busy: false, error: '' };
export class PromotionCheckoutPending extends Error { constructor(message: string) { super(message); } }
/** Una venta con cotización online conserva su foto y su clave hasta obtener evidencia durable. */
export function usePromotionCheckout(token: string | null, resetKey: string, scope = '', onCancelled?: () => void) {
    const [state, setState] = useState(empty); const stateRef = useRef(state); const identity = useRef(token); identity.current = token;
    const mounted = useRef(true);
    const update = useCallback((patch: Partial<typeof empty>) => { if (!mounted.current || identity.current !== token) return; stateRef.current = { ...stateRef.current, ...patch }; setState(stateRef.current); }, [token]);
    const previousKey = useRef(resetKey); const lock = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { const offlineId = promotionRecoveryStorage(scope).read(); update({ ...empty, ...(offlineId ? { attempt: { signature: '', payload: { offlineId, paymentMethod: '' }, quote: null, accepted: false, uncertain: true, sent: true }, open: true } : {}) }); lock.current = false; previousKey.current = resetKey; }, [scope, token, update]);
    useEffect(() => { if (previousKey.current !== resetKey) { previousKey.current = resetKey; if (!stateRef.current.attempt?.sent) update({ ...empty }); } }, [resetKey, update]);
    const request = useCallback(async (path: string, options: RequestInit = {}) => {
        if (!navigator.onLine) throw new PromotionCheckoutPending('Conectate para comprobar esta venta. La promoción necesita validación online.');
        const response = await fetch(`/api/promotions/checkout${path}`, { ...options, cache: 'no-store', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
        if (!mounted.current || identity.current !== token) throw new PromotionCheckoutPending('La sesión cambió. Comprobá la venta desde su referencia.');
        const body = await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error('No pudimos validar el precio o comprobar la venta. Conservamos el carrito.'), { status: response.status }); return body;
    }, [token]);
    const prepare = useCallback(async (signature: string, payload: Payload, shiftId: string): Promise<Payload | null> => {
        const current = stateRef.current.attempt;
        if (current?.sent) {
            if (current.recovered && current.signature === signature) return { ...current.payload, promotionQuote: current.quote ? { id: current.quote.id, version: current.quote.version } : undefined };
            update({ open: true }); throw new PromotionCheckoutPending('Esta venta sigue pendiente de comprobación. Conservamos la misma referencia.');
        }
        if (!navigator.onLine) { if (current?.quote) { update({ open: true }); throw new PromotionCheckoutPending('Conectate para cobrar con el precio revisado.'); } return payload; }
        if (current?.signature === signature && current.quote && new Date(current.quote.expiresAt).getTime() > Date.now()) {
            if (!current.accepted) { update({ open: true }); return null; }
            return { ...current.payload, promotionQuote: { id: current.quote.id, version: current.quote.version } };
        }
        update({ busy: true, error: '' });
        try {
            const result = await request('/quote', { method: 'POST', body: JSON.stringify({ shiftId, sale: payload }) });
            if (result.enabled === false && result.quote === null) { update({ attempt: null, open: false }); return payload; }
            const quote: PromotionCheckoutQuote = result.quote;
            if (result.enabled !== true || !quote || quote.offlineId !== payload.offlineId || !quote.id || !Array.isArray(quote.lines) || !/^\d+(\.\d+)?$/.test(quote.total)) throw new Error('No hay un precio verificado.');
            update({ attempt: { signature, payload, quote, accepted: false, uncertain: false, sent: false }, open: true }); return null;
        } catch { update({ open: true, error: 'No pudimos verificar las promociones y el precio actual. Reintentá con conexión; todavía no enviamos esta venta.' }); return null; }
        finally { update({ busy: false }); }
    }, [request, update]);
    const accept = useCallback(() => { const attempt = stateRef.current.attempt; if (attempt && !attempt.sent) update({ attempt: { ...attempt, accepted: true }, open: false }); }, [update]);
    const submit = useCallback(async (send: () => Promise<Response>) => {
        const attempt = stateRef.current.attempt;
        if (attempt?.recovered) return { ok: true, status: 200, json: async () => attempt.recovered } as Response;
        if (attempt?.quote) { promotionRecoveryStorage(scope).write(attempt.payload.offlineId); update({ attempt: { ...attempt, sent: true, uncertain: true } }); }
        try {
            const response = await send();
            if (attempt?.quote && !response.ok && [400, 409, 410, 422, 423].includes(response.status)) { promotionRecoveryStorage(scope).clear(); update({ attempt: null, open: true, error: 'La venta fue rechazada. Volvé a comprobar sus condiciones antes de cobrar.' }); }
            return response;
        } catch (error) { if (attempt?.quote) { update({ open: true, error: 'La respuesta se perdió. Comprobá esta misma venta antes de cobrar otra vez.' }); throw new PromotionCheckoutPending('Estamos comprobando la venta. No se agregó a la cola sin conexión.'); } throw error; }
    }, [scope, update]);
    const recover = useCallback(async () => {
        const attempt = stateRef.current.attempt; if (!attempt?.sent || lock.current) return false;
        lock.current = true; update({ busy: true, error: '' });
        try {
            const result = await request(`/operations/${encodeURIComponent(attempt.payload.offlineId)}`);
            if (result.status !== 'COMMITTED' || !result.sale?.id || !Array.isArray(result.sale.items) || result.sale.vatAmountAtSale == null || !result.sale.fiscalRegimeAtSale || !Number.isInteger(result.sale.fiscalRegimeVersionAtSale)) throw new Error('Sin comprobante completo');
            update({ attempt: { ...attempt, recovered: result.sale, uncertain: false }, open: true }); return true;
        } catch { update({ error: 'No pudimos recuperar un comprobante completo. Conservamos la referencia y el carrito; no volvás a cobrar.' }); return false; }
        finally { lock.current = false; update({ busy: false }); }
    }, [request, update]);
    const cancelAttempt = useCallback(async () => {
        const attempt = stateRef.current.attempt; if (!attempt?.sent || lock.current) return;
        lock.current = true; update({ busy: true, error: '' });
        try {
            const result = await request(`/operations/${encodeURIComponent(attempt.payload.offlineId)}/cancel`, { method: 'POST', body: '{}' });
            if (result.status === 'COMMITTED' && result.sale?.id && Array.isArray(result.sale.items) && result.sale.vatAmountAtSale != null && result.sale.fiscalRegimeAtSale && Number.isInteger(result.sale.fiscalRegimeVersionAtSale)) update({ attempt: { ...attempt, recovered: result.sale, uncertain: false }, open: true });
            else if (result.status === 'CANCELLED') { promotionRecoveryStorage(scope).clear(); onCancelled?.(); update({ ...empty }); }
            else throw new Error('Resultado no comprobado');
        } catch { update({ error: 'No se pudo comprobar la cancelación. El intento sigue protegido; comprobá la misma referencia.' }); }
        finally { lock.current = false; update({ busy: false }); }
    }, [onCancelled, request, scope, update]);
    const onFailure = useCallback(() => { if (stateRef.current.attempt?.sent) update({ open: true, error: 'El resultado todavía no está comprobado. Conservamos la referencia y el carrito.' }); }, [update]);
    const complete = useCallback(() => { promotionRecoveryStorage(scope).clear(); update({ ...empty }); }, [scope, update]);
    const close = useCallback(() => { if (!stateRef.current.attempt?.sent) update({ open: false }); }, [update]);
    return { ...state, prepare, accept, submit, recover, cancelAttempt, complete, close, onFailure, quoted: state.attempt?.accepted ? state.attempt.quote : null, blocksOffline: !!state.attempt?.quote || !!state.attempt?.sent };
}
export type PromotionCheckoutController = ReturnType<typeof usePromotionCheckout>;
