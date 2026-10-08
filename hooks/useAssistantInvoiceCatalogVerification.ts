import { useCallback, useEffect, useState } from 'react';
import type { AssistantCatalogItem, AssistantRequest } from './useNortexAssistant';
import type { InvoiceDraft } from '../shared/assistant';

type Status = 'loading' | 'resolved' | 'unavailable' | 'error';
type Verification = { item: AssistantCatalogItem | null; status: Status };
type Kind = 'products' | 'suppliers';
const signature = (item: AssistantCatalogItem) => JSON.stringify([item.id, item.label, item.detail,
    item.sku, item.brand, item.unit, item.packUnit, item.packSize, item.saleMode,
    item.quantityStep, item.requiresBatchTracking, item.ruc, item.address]);

/** Sólo verifica identidad visible. No modifica la factura ni confirma efectos. */
export function useAssistantInvoiceCatalogVerification(
    request: AssistantRequest, proposalId: string, version: number, draft: InvoiceDraft,
) {
    // Una revisión nueva recupera las identidades actuales, sin reutilizar otra sesión/versión.
    const scopedRequest = useCallback<AssistantRequest>((path, options) => options === undefined ? request(path) : request(path, options), [request, proposalId, version]);
    const [state, setState] = useState<{ request: AssistantRequest; entries: Record<string, Verification>; accepted: Record<string, string>; changed: boolean }>(() => ({ request: scopedRequest, entries: {}, accepted: {}, changed: false }));
    useEffect(() => { setState(current => current.request === scopedRequest ? current : { request: scopedRequest, entries: {}, accepted: {}, changed: false }); }, [scopedRequest]);
    const report = useCallback((kind: Kind, id: string | undefined, item: AssistantCatalogItem | null, status: Status) => {
        if (!id) return;
        const key = `${kind}:${id}`;
        setState(current => {
            const entries = current.request === scopedRequest ? current.entries : {};
            const accepted = current.request === scopedRequest ? current.accepted : {};
            const previous = entries[key];
            if (previous?.status === status && previous.item === item) return current;
            const currentSignature = item?.id === id ? signature(item) : undefined;
            const changed = (current.request === scopedRequest && current.changed)
                || !!(accepted[key] && currentSignature && accepted[key] !== currentSignature);
            return { request: scopedRequest, entries: { ...entries, [key]: { item, status } }, changed,
                accepted: status === 'resolved' && currentSignature && !accepted[key]
                    ? { ...accepted, [key]: currentSignature } : accepted };
        });
    }, [scopedRequest]);
    const entries = state.request === scopedRequest ? state.entries : {};
    const identities = [
        { kind: 'suppliers', id: draft.supplierId },
        ...draft.items.map(item => ({ kind: 'products', id: item.productId })),
    ];
    const verified = draft.items.length > 0 && identities.every(({ kind, id }) => {
        const identity = id ? entries[`${kind}:${id}`] : undefined;
        return identity?.status === 'resolved' && identity.item?.id === id && !identity.item.selectionIssue;
    });
    const failed = identities.some(({ kind, id }) => id && ['error', 'unavailable'].includes(entries[`${kind}:${id}`]?.status));
    const missing = identities.some(item => !item.id);
    const message = verified ? '' : failed
        ? 'No pudimos verificar una selección del catálogo. Revisá sus datos o reintentá antes de calcular los efectos.'
        : missing ? 'Elegí el proveedor y cada producto del catálogo para revisar esta compra.'
            : 'Verificando el proveedor y los productos seleccionados…';
    return { request: scopedRequest, report, verified, message, changed: state.request === scopedRequest && state.changed };
}
