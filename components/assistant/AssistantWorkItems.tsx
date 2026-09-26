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
            {item.report ? <section aria-label="Informe preliminar W01" className="nx-shell-border space-y-2 rounded-card border p-3 text-sm">
                <h4 className="nx-shell-text font-semibold">Informe preliminar · versión {item.report.workItemVersion}</h4>
                <p className="nx-shell-muted">Derivado de la revisión guardada. Todavía no está aceptado y no cambia la caja.</p>
                <p className="nx-shell-muted break-all text-xs">Hash del informe: {item.report.reportHash}</p>
                {item.report.exceptions.length > 0 ? <><h5 className="nx-tone-warning font-semibold">Excepciones pendientes ({item.report.exceptions.length})</h5>
                    <ul className="nx-shell-text list-disc space-y-2 break-words pl-5">{item.report.exceptions.map(exception => <li key={exception.id}>
                        {exception.shiftId ? `Turno ${exception.shiftId}: ` : 'Cobertura de la semana: '}{exception.reason} Responsable: tu cuenta. La causa sigue sin comprobarse.
                    </li>)}</ul></> : <p className="nx-shell-muted">La fuente no presenta excepciones en este corte; aún requiere revisión humana.</p>}
                {item.report.evidence.length > 0 && <><h5 className="nx-shell-text font-semibold">Fuentes declaradas por la revisión</h5>
                    <ul className="nx-shell-muted list-disc space-y-1 break-words pl-5">{item.report.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul></>}
                {item.report.notesTruncated && <p className="nx-tone-warning">El historial visible de notas está truncado; este informe no muestra todos los aportes.</p>}
            </section> : <p role="status" className="nx-tone-warning text-sm">No pudimos mostrar el informe preliminar de esta revisión.</p>}
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
