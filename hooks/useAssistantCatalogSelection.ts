import { useEffect, useRef, useState } from 'react';
import type { AssistantCatalogItem, AssistantCatalogKind, AssistantRequest } from './useNortexAssistant';
import { readAssistantCatalog, type AssistantCatalogRead, type AssistantCatalogResult } from './assistantCatalogRequests';

export type AssistantCatalogSelectionStatus = 'loading' | 'resolved' | 'unavailable' | 'error';
type Context = { request: AssistantRequest; kind: AssistantCatalogKind; filter: string };
type SearchState = Context & AssistantCatalogResult & { query: string; loading: boolean; error: boolean; order: number };
type SelectionState = Context & { id: string; item: AssistantCatalogItem | null; reportedItem?: AssistantCatalogItem | null; status: AssistantCatalogSelectionStatus; warnings: string[]; order: number };
const sameContext = (state: Context | null, request: AssistantRequest, kind: AssistantCatalogKind, filter: string) => state?.request === request && state.kind === kind && state.filter === filter;
const signature = (item: AssistantCatalogItem) => JSON.stringify([item.id, item.label, item.detail, item.sku, item.brand, item.unit, item.packUnit, item.packSize, item.saleMode, item.quantityStep, item.requiresBatchTracking, item.ruc, item.address]);
const changedMessage = 'Los datos de la ficha cambiaron. Verificá de nuevo la selección antes de revisar sus efectos.';
function searchInvalidates(search: SearchState | null, selection: SelectionState | null): string | null {
    if (!selection || !search || !sameContext(search, selection.request, selection.kind, selection.filter) || search.order <= selection.order) return null;
    const listed = search.items.find(item => item.id === selection.id);
    return listed?.selectionIssue || (listed && selection.item && signature(listed) !== signature(selection.item) ? changedMessage : null);
}

/** Identidad elegida y resultados de búsqueda tienen ciclos separados; sólo viven en memoria. */
export function useAssistantCatalogSelection({ request, kind, value, query, disabled, parameters }: {
    request: AssistantRequest; kind: AssistantCatalogKind; value?: string; query: string; disabled?: boolean; parameters?: Record<string, string | undefined>;
}) {
    const [search, setSearch] = useState<SearchState | null>(null);
    const [selection, setSelection] = useState<SelectionState | null>(null);
    const [selectionAttempt, setSelectionAttempt] = useState(0);
    const selectionGeneration = useRef(0);
    const requestOrder = useRef(0);
    const observedSearch = useRef<SearchState | null>(null);
    const selectionRef = useRef(selection); selectionRef.current = selection;
    const filter = new URLSearchParams(Object.entries(parameters ?? {}).filter(([key, entry]) => !!entry && !['kind', 'query', 'selectedId'].includes(key)).sort(([a], [b]) => a.localeCompare(b))).toString();
    const exactKind = kind === 'products' || kind === 'suppliers';
    const basePath = `/catalog?kind=${kind}&query=`;
    useEffect(() => {
        let active = true;
        let read: AssistantCatalogRead | undefined;
        setSearch({ request, kind, filter, query, items: [], warnings: [], loading: !disabled, error: false, order: 0 });
        if (disabled) return () => { active = false; };
        const timer = window.setTimeout(async () => {
            const order = ++requestOrder.current;
            try {
                read = readAssistantCatalog(request, `${basePath}${encodeURIComponent(query)}${filter ? `&${filter}` : ''}`);
                const result = await read.promise;
                if (active) { const next = { request, kind, filter, query, ...result, loading: false, error: false, order }; observedSearch.current = next; setSearch(next); }
            } catch { if (active) setSearch({ request, kind, filter, query, items: [], warnings: [], loading: false, error: true, order }); }
        }, 250);
        return () => { active = false; clearTimeout(timer); read?.release(); };
    }, [disabled, filter, kind, query, request]);
    useEffect(() => {
        let active = true;
        const generation = ++selectionGeneration.current;
        if (!exactKind || !value) { setSelection(null); return () => { active = false; }; }
        const context = { request, kind, filter, id: value, order: ++requestOrder.current };
        setSelection({ ...context, item: null, warnings: [], status: 'loading' });
        // Recuperar un ID guardado no depende de la página de búsqueda ni del texto de factura.
        const read = readAssistantCatalog(request, `${basePath}${filter ? `&${filter}` : ''}&selectedId=${encodeURIComponent(value)}`);
        void read.promise.then(result => {
            if (!active || generation !== selectionGeneration.current) return;
            const item = result.items.find(candidate => candidate.id === value) ?? null;
            const next: SelectionState = { ...context, item, warnings: result.warnings, status: item && !item.selectionIssue ? 'resolved' : 'unavailable' };
            const changed = searchInvalidates(observedSearch.current, next);
            setSelection(changed ? { ...next, reportedItem: observedSearch.current?.items.find(candidate => candidate.id === value), status: 'unavailable', warnings: [...new Set([...next.warnings, changed])] } : next);
        }).catch(() => { if (active && generation === selectionGeneration.current) setSelection({ ...context, item: null, warnings: [], status: 'error' }); });
        return () => { active = false; read.release(); };
    }, [filter, kind, request, value, selectionAttempt]);
    useEffect(() => {
        if (!exactKind || !value || !sameContext(search, request, kind, filter) || search.query !== query || search.loading || search.error) return;
        const previous = selectionRef.current;
        const issue = previous?.id === value ? searchInvalidates(search, previous) : null;
        if (issue && previous) {
            selectionGeneration.current++;
            setSelection({ ...previous, reportedItem: search.items.find(item => item.id === value), status: 'unavailable', warnings: [...new Set([...previous.warnings, ...search.warnings, issue])] });
        }
    }, [search, request, kind, filter, value, query]);
    const visibleSearch = sameContext(search, request, kind, filter) && search.query === query ? search : null;
    const visibleSelection = sameContext(selection, request, kind, filter) && selection.id === value ? selection : null;
    const items = visibleSearch?.items ?? [];
    const selectedItem = exactKind ? visibleSelection?.item ?? null : items.find(item => item.id === value) ?? null;
    const invalidated = exactKind ? searchInvalidates(visibleSearch, visibleSelection) : null;
    const reportedItem = invalidated ? visibleSearch.items.find(item => item.id === value) ?? null : visibleSelection?.reportedItem ?? selectedItem;
    const selectionStatus: AssistantCatalogSelectionStatus = !value ? 'unavailable' : exactKind ? invalidated ? 'unavailable' : visibleSelection?.status ?? 'loading' : selectedItem ? 'resolved' : visibleSearch?.error ? 'error' : visibleSearch?.loading ? 'loading' : 'unavailable';
    const retrySelection = () => { setSelection(null); setSelectionAttempt(previous => previous + 1); };
    return { items, selectedItem, reportedItem, selectionStatus, retrySelection, exactKind,
        loading: visibleSearch?.loading ?? !disabled, error: visibleSearch?.error ?? false,
        warnings: [...new Set([...(visibleSearch?.warnings ?? []), ...(exactKind ? visibleSelection?.warnings ?? [] : []), ...items.map(item => item.selectionIssue).filter(Boolean)])],
    };
}
