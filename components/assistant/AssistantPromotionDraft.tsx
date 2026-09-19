import React from 'react';
import type { AssistantJsonObject } from '../../shared/assistantOperations';
import type { AssistantRequest } from '../../hooks/useNortexAssistant';
import { AssistantCatalogSelect, assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';
const asText = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function localTime(value: unknown) { const text = asText(value); if (!text || !/(Z|[+-]\d\d:\d\d)$/.test(text)) return text; const date = new Date(text); if (!Number.isFinite(date.getTime())) return ''; return new Date(date.getTime() - 6 * 3600_000).toISOString().slice(0, 16); }
export function AssistantPromotionDraft({ draft, request, disabled, onChange }: { draft: AssistantJsonObject; request: AssistantRequest; disabled: boolean; onChange: (draft: AssistantJsonObject) => void }) {
    const products = Array.isArray(draft.productIds) ? draft.productIds.filter((id): id is string => typeof id === 'string') : [];
    const edit = (key: string, value: string) => onChange({ ...draft, [key]: value });
    if (draft.operation === 'CANCEL') return <p className="nx-shell-muted text-sm">Esta revisión cancelará la promoción seleccionada. Su identidad y versión se conservan; los precios normales vuelven a aplicarse en ventas nuevas.</p>;
    return <div className="space-y-3"><label className="nx-shell-text block text-sm">Nombre de la promoción<input className={assistantInputClass} value={asText(draft.name)} disabled={disabled} onChange={event => edit('name', event.target.value)} /></label><label className="nx-shell-text block text-sm">Porcentaje de descuento<input inputMode="decimal" className={assistantInputClass} value={asText(draft.percent)} disabled={disabled} onChange={event => edit('percent', event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">{[['startsAt', 'Comienza'], ['endsAt', 'Termina']].map(([key, label]) => <label key={key} className="nx-shell-text min-w-0 text-sm">{label} · Managua<input type="datetime-local" className={assistantInputClass} value={localTime(draft[key])} disabled={disabled} onChange={event => edit(key, event.target.value)} /></label>)}</div>
        <p className="nx-shell-muted text-sm">Aplica a los lotes vendibles de estos productos y sus presentaciones configuradas. Revisá precio normal y promocional antes de activar.</p>
        {products.map((id, index) => <div key={index} className="space-y-2"><AssistantCatalogSelect label={`Producto promocionado ${index + 1}`} kind="products" value={id} request={request} disabled={disabled} onChange={value => onChange({ ...draft, productIds: products.map((product, row) => row === index ? value ?? '' : product) })} /><button type="button" className={assistantButtonClass} disabled={disabled} onClick={() => onChange({ ...draft, productIds: products.filter((_, row) => row !== index) })}>Quitar producto {index + 1}</button></div>)}
        <button type="button" className={assistantButtonClass} disabled={disabled} onClick={() => onChange({ ...draft, productIds: [...products, ''] })}>Agregar producto a la promoción</button>
    </div>;
}
