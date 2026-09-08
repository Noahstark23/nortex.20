import { useEffect, useId, useState } from 'react';
import type { AssistantCatalogItem, AssistantCatalogKind, AssistantRequest } from '../../hooks/useNortexAssistant';
const pendingCatalog = new WeakMap<AssistantRequest, Map<string, Promise<{ items: AssistantCatalogItem[] }>>>();
function readCatalog(request: AssistantRequest, path: string) {
    let pending = pendingCatalog.get(request);
    if (!pending) { pending = new Map(); pendingCatalog.set(request, pending); }
    let result = pending.get(path);
    if (!result) {
        result = request<{ items: AssistantCatalogItem[] }>(path).finally(() => pending!.delete(path));
        pending.set(path, result);
    }
    return result;
}
export const assistantInputClass = 'nx-shell-control min-h-tap min-w-0 w-full rounded-control border px-3 py-2 text-sm';
export const assistantButtonClass = 'nx-shell-control nx-fluid-press inline-flex min-h-tap items-center justify-center gap-2 rounded-control border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export function AssistantCatalogSelect({ label, kind, value, selectedLabel, request, disabled, parameters, onChange }: {
    label: string; kind: AssistantCatalogKind; value?: string; selectedLabel?: string; request: AssistantRequest; disabled?: boolean;
    parameters?: Record<string, string | undefined>;
    onChange: (id: string | undefined, item?: AssistantCatalogItem) => void;
}) {
    const id = useId(); const [query, setQuery] = useState(''); const [items, setItems] = useState<AssistantCatalogItem[]>([]);
    const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
    const filter = new URLSearchParams(Object.entries(parameters ?? {}).filter((entry): entry is [string, string] => !!entry[1])).toString();
    useEffect(() => {
        if (disabled) return;
        let active = true;
        const timer = window.setTimeout(async () => {
            setLoading(true); setError('');
            try {
                const result = await readCatalog(request, `/catalog?kind=${kind}&query=${encodeURIComponent(query)}${filter ? `&${filter}` : ''}`);
                if (active) setItems(result.items);
            } catch { if (active) { setItems([]); setError(`No pudimos consultar ${label.toLowerCase()}. Reintentá la búsqueda.`); } }
            finally { if (active) setLoading(false); }
        }, 250);
        return () => { active = false; clearTimeout(timer); };
    }, [disabled, filter, kind, label, query, request]);
    return <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="nx-shell-text text-sm font-semibold">{label}</label>
        <input type="search" aria-label={`Buscar ${label.toLowerCase()}`} placeholder="Buscar en el catálogo" value={query} disabled={disabled}
            onChange={event => setQuery(event.target.value)} className={assistantInputClass} />
        <select id={id} value={value ?? ''} disabled={disabled || loading} className={assistantInputClass}
            onChange={event => onChange(event.target.value || undefined, items.find(item => item.id === event.target.value))}>
            <option value="">{loading ? 'Consultando…' : 'Seleccioná una opción'}</option>
            {value && !items.some(item => item.id === value) && <option value={value}>{selectedLabel || 'Selección guardada'} · revisar</option>}
            {items.map(item => <option key={item.id} value={item.id}>{item.label}{item.detail ? ` · ${item.detail}` : ''}</option>)}
        </select>
        {error && <p role="status" className="nx-tone-warning text-xs">{error}</p>}
    </div>;
}
