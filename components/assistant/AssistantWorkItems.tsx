import type { AssistantWorkItemsController } from '../../hooks/useAssistantWorkItems';
import { assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';
import { AssistantWeeklyCashReview } from './AssistantWeeklyCashReview';

const statusLabel = { IN_REVIEW: 'En revisión', WAITING: 'En espera', CANCELLED: 'Cancelado' };
export function AssistantWorkItems({ controller: c }: { controller: AssistantWorkItemsController }) {
    const item = c.selected, locked = c.busy || !!c.pending || item?.status === 'CANCELLED';
    return <section aria-label="Trabajos guardados" className="min-w-0 space-y-4">
        <h3 className="nx-shell-text font-bold">Revisiones de caja guardadas</h3>
        <p className="nx-shell-muted text-sm">Guardá notas y retomá la revisión cuando tengas la información. Esperar y consultar no ejecutan la IA ni cambian caja. La aceptación final del informe todavía no está disponible.</p>
        {c.error && <p role="alert" className="nx-tone-warning text-sm">{c.error}</p>}
        <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.load()}>Actualizar trabajos</button>
        <ul className="space-y-2">{c.items.map(row => <li key={row.id}><button type="button" className={`${assistantButtonClass} w-full justify-start text-left`} disabled={c.busy || ((!!c.note.trim() || !!c.pending) && row.id !== item?.id)} onClick={() => void c.open(row.id)}>
            {row.source.period.startDate} al {row.source.period.endDate} · {statusLabel[row.status]}
        </button></li>)}</ul>
        {c.nextCursor && <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.load(true)}>Ver más trabajos</button>}
        {item && <section aria-label="Revisión guardada" className="nx-shell-control min-w-0 space-y-3 rounded-card border p-4">
            <h4 className="nx-shell-text font-semibold">{statusLabel[item.status]} · Revisión {item.version}</h4>
            <p className="nx-shell-muted break-all text-xs">Referencia: {item.id}<br />Fuente: {item.source.runId}<br />Se conserva hasta {new Date(item.expiresAt).toLocaleString('es-NI', { timeZone: 'America/Managua' })}</p>
            <AssistantWeeklyCashReview data={item.review} />
            <h4 className="nx-shell-text font-semibold">Aportes del responsable</h4>
            <p className="nx-shell-muted text-xs">Las notas no prueban una causa ni cambian los importes de la fuente.</p>
            <ol className="nx-shell-text space-y-2 text-sm">{item.events.map(event => <li key={event.id} className="whitespace-pre-wrap break-words">{event.note ?? (event.type === 'CREATED' ? 'Revisión guardada' : statusLabel[event.status])}</li>)}</ol>
            {item.eventsTruncated && <p className="nx-shell-muted text-xs">Se muestran los últimos 100 eventos.</p>}
            {item.status !== 'CANCELLED' && <><label className="nx-shell-text block text-sm font-semibold">Nota de la revisión<textarea className={`${assistantInputClass} mt-1`} maxLength={2000} value={c.note} disabled={locked} onChange={event => c.setNote(event.target.value)} /></label>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={assistantButtonClass} disabled={locked || !c.note.trim()} onClick={() => void c.change('ADD_NOTE')}>Guardar nota</button>
                    <button type="button" className={assistantButtonClass} disabled={locked || !!c.note.trim()} onClick={() => void c.change(item.status === 'WAITING' ? 'RESUME' : 'WAIT')}>{item.status === 'WAITING' ? 'Retomar revisión' : 'Dejar en espera'}</button>
                    <button type="button" className={assistantButtonClass} disabled={locked || !!c.note.trim()} onClick={() => void c.change('CANCEL')}>Cancelar este trabajo</button>
                </div></>}
            {c.pending && <div className="nx-tone-warning space-y-2 text-sm"><p>El envío necesita comprobación. Conservamos tu nota y su referencia: <span className="break-all">{c.pending.input.eventId}</span>.</p>
                <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.open(item.id)}>Comprobar estado guardado</button>
                <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.retry()}>Reintentar el mismo envío</button>
            </div>}
        </section>}
    </section>;
}
