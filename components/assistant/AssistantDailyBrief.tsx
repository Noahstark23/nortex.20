import React from 'react';
import type { AssistantDailyBriefDTO } from '../../shared/assistantOperations';
import { assistantButtonClass } from './AssistantCatalogSelect';
export function AssistantDailyBrief({ brief, busy, onDismiss, onAsk }: { brief: AssistantDailyBriefDTO; busy: boolean; onDismiss: (id: string) => void; onAsk: (text: string) => void }) {
    const items = brief.items.slice(0, 3).filter(item => !brief.dismissedIds.includes(item.id));
    if (!items.length) return null;
    return <section aria-label="Resumen del día" className="nx-shell-control space-y-3 rounded-card border p-4"><h3 className="nx-shell-text font-bold">Para revisar hoy</h3><p className="nx-shell-muted text-xs">{brief.localDay} · Managua · Datos según tu acceso</p>{items.map(item => <article key={item.id} className="nx-shell-border space-y-2 border-t pt-3"><h4 className="nx-shell-text text-sm font-semibold">{item.title}</h4><p className="nx-shell-muted text-sm">{item.text}</p><div className="flex flex-wrap gap-2"><button type="button" className={assistantButtonClass} disabled={busy} onClick={() => onAsk(`Explicá este punto de mi resumen de hoy: ${item.title}`)}>Explicar</button><button type="button" className={assistantButtonClass} disabled={busy} onClick={() => onAsk(`Ayudame a preparar una propuesta para este punto de mi resumen de hoy: ${item.title}. Primero verificá los datos y pedime lo que falte.`)}>Preparar</button><button type="button" className={assistantButtonClass} disabled={busy} onClick={() => onDismiss(item.id)}>Descartar por hoy</button></div></article>)}</section>;
}
