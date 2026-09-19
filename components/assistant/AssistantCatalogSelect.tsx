import { useEffect, useId, useRef, useState } from 'react';
import type { AssistantCatalogItem, AssistantCatalogKind, AssistantRequest } from '../../hooks/useNortexAssistant';
import { useAssistantCatalogSelection, type AssistantCatalogSelectionStatus } from '../../hooks/useAssistantCatalogSelection';
export const assistantInputClass = 'nx-shell-control min-h-tap min-w-0 w-full rounded-control border px-3 py-2 text-sm';
export const assistantButtonClass = 'nx-shell-control nx-fluid-press inline-flex min-h-tap items-center justify-center gap-2 rounded-control border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export function AssistantCatalogSelect({ label, kind, value, selectedLabel, request, disabled, parameters, onChange, onSelectionResolved }: {
    label: string; kind: AssistantCatalogKind; value?: string; selectedLabel?: string; request: AssistantRequest; disabled?: boolean;
    parameters?: Record<string, string | undefined>;
    onChange: (id: string | undefined, item?: AssistantCatalogItem) => void;
    onSelectionResolved?: (item: AssistantCatalogItem | null, status: AssistantCatalogSelectionStatus) => void;
}) {
    const id = useId(); const [query, setQuery] = useState('');
    const catalog = useAssistantCatalogSelection({ request, kind, value, query, disabled, parameters });
    const callback = useRef(onSelectionResolved); callback.current = onSelectionResolved;
    useEffect(() => { callback.current?.(catalog.reportedItem, catalog.selectionStatus); }, [catalog.reportedItem, catalog.selectionStatus, request, kind, value]);
    const selectionOnly = value && catalog.selectedItem && (catalog.exactKind || !catalog.items.some(item => item.id === value)) ? catalog.selectedItem : null;
    const visibleItems = catalog.exactKind && value ? catalog.items.filter(item => item.id !== value) : catalog.items;
    const missingSelection = value && !catalog.selectedItem && (catalog.exactKind || !catalog.items.some(item => item.id === value));
    const choose = (selectedId: string) => {
        if (disabled || catalog.loading) return;
        if (!selectedId) { onChange(undefined); return; }
        if (catalog.exactKind && selectedId === value && catalog.selectionStatus !== 'resolved') return;
        const item = catalog.items.find(candidate => candidate.id === selectedId) ?? (selectionOnly?.id === selectedId ? selectionOnly : undefined);
        if (!item || item.selectionIssue) return;
        onChange(item.id, item);
    };
    return <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="nx-shell-text text-sm font-semibold">{label}</label>
        <input type="search" aria-label={`Buscar ${label.toLowerCase()}`} placeholder="Buscar en el catálogo" value={query} disabled={disabled}
            onChange={event => setQuery(event.target.value)} className={assistantInputClass} />
        <select id={id} value={value ?? ''} disabled={disabled || catalog.loading} className={assistantInputClass}
            onChange={event => choose(event.target.value)}>
            <option value="">{catalog.loading ? 'Consultando…' : 'Seleccioná una opción'}</option>
            {missingSelection && <option value={value} disabled={catalog.exactKind}>{catalog.exactKind ? catalog.selectionStatus === 'loading' ? 'Verificando selección guardada…' : 'Selección guardada sin verificar · revisá la ficha' : `${selectedLabel || 'Selección guardada'} · revisar`}</option>}
            {selectionOnly && <option value={selectionOnly.id} disabled={!!selectionOnly.selectionIssue || (catalog.exactKind && catalog.selectionStatus !== 'resolved')}>{selectionOnly.label}{selectionOnly.detail ? ` · ${selectionOnly.detail}` : ''}{catalog.selectionStatus !== 'resolved' ? ' · revisá fichas' : ''}</option>}
            {visibleItems.map(item => <option key={item.id} value={item.id} disabled={!!item.selectionIssue}>{item.label}{item.detail ? ` · ${item.detail}` : ''}{item.selectionIssue ? ' · revisá fichas' : ''}</option>)}
        </select>
        {value && catalog.exactKind && <p aria-label={`Datos de ${label.toLowerCase()}`} className="nx-shell-text min-w-0 break-words whitespace-normal text-sm">
            {catalog.selectedItem ? <>
                <span className="block font-semibold">{catalog.selectedItem.label}</span>
                {catalog.selectedItem.detail && <span className="block">{catalog.selectedItem.detail}</span>}
            </> : <span>Verificación de la selección guardada pendiente.</span>}
            {catalog.selectionStatus !== 'resolved' && <span className="nx-tone-warning block text-xs">Estos datos todavía no permiten revisar los efectos. Verificá la ficha seleccionada.</span>}
        </p>}
        {catalog.error && <p role="status" className="nx-tone-warning text-xs">No pudimos consultar {label.toLowerCase()}. Reintentá la búsqueda.</p>}
        {value && catalog.exactKind && ['unavailable', 'error'].includes(catalog.selectionStatus) && <><p role="status" className="nx-tone-warning text-xs">No se pudo verificar la selección guardada. {catalog.selectedItem?.selectionIssue || 'Revisá las fichas del catálogo antes de continuar.'}</p><button type="button" className={assistantButtonClass} disabled={disabled} onClick={catalog.retrySelection}>Volver a verificar selección</button></>}
        {catalog.warnings.map((warning, index) => <p key={index} role="status" className="nx-tone-warning text-xs">{warning}</p>)}
    </div>;
}
