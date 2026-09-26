import { useEffect, useState } from 'react';
import type { AssistantWorkItemsController } from '../../hooks/useAssistantWorkItems';
import { assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';
import { AssistantWeeklyCashReview } from './AssistantWeeklyCashReview';

const statusLabel = { IN_REVIEW: 'En revisión', WAITING: 'En espera', CANCELLED: 'Cancelado', ACCEPTED: 'Aceptado' };
export function AssistantWorkItems({ controller: c }: { controller: AssistantWorkItemsController }) {
    const item = c.selected, locked = c.busy || !!c.pending || !!c.pendingAcceptance || item?.status === 'CANCELLED' || item?.status === 'ACCEPTED';
    const [reviewed, setReviewed] = useState(false);
    useEffect(() => { setReviewed(false); }, [item?.id, item?.report?.reportHash]);
    return <section aria-label="Trabajos guardados" className="min-w-0 space-y-4">
        <h3 className="nx-shell-text font-bold">Revisiones de caja guardadas</h3>
        <p className="nx-shell-muted text-sm">Guardá notas y retomá la revisión cuando tengas la información. Esperar, consultar y aceptar el informe no ejecutan la IA ni cambian caja.</p>
        {c.error && <p role="alert" className="nx-tone-warning text-sm">{c.error}</p>}
        <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.load()}>Actualizar trabajos</button>
        <ul className="space-y-2">{c.items.map(row => <li key={row.id}><button type="button" className={`${assistantButtonClass} w-full justify-start text-left`} disabled={c.busy || ((!!c.note.trim() || !!c.pending || !!c.pendingAcceptance) && row.id !== item?.id)} onClick={() => void c.open(row.id)}>
            {row.source.period.startDate} al {row.source.period.endDate} · {statusLabel[row.status]}
        </button></li>)}</ul>
        {c.nextCursor && <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.load(true)}>Ver más trabajos</button>}
        {item && <section aria-label="Revisión guardada" className="nx-shell-control min-w-0 space-y-3 rounded-card border p-4">
            <h4 className="nx-shell-text font-semibold">{statusLabel[item.status]} · Revisión {item.version}</h4>
            <p className="nx-shell-muted break-all text-xs">Referencia: {item.id}<br />Fuente: {item.source.runId}<br />Se conserva hasta {new Date(item.expiresAt).toLocaleString('es-NI', { timeZone: 'America/Managua' })}</p>
            <AssistantWeeklyCashReview data={item.review} />
            {item.report ? <section aria-label={item.acceptance ? 'Informe aceptado W01' : 'Informe preliminar W01'} className="nx-shell-border space-y-2 rounded-card border p-3 text-sm">
                <h4 className="nx-shell-text font-semibold">{item.acceptance ? 'Informe aceptado' : 'Informe preliminar'} · versión {item.report.workItemVersion}</h4>
                <p className="nx-shell-muted">Derivado de la revisión guardada. {item.acceptance ? 'Aceptado por una persona; no cambió la caja.' : 'Todavía no está aceptado y no cambia la caja.'}</p>
                <p className="nx-shell-muted break-all text-xs">Hash del informe: {item.report.reportHash}</p>
                {item.report.exceptions.length > 0 ? <><h5 className="nx-tone-warning font-semibold">Excepciones pendientes ({item.report.exceptions.length})</h5>
                    <ul className="nx-shell-text list-disc space-y-2 break-words pl-5">{item.report.exceptions.map(exception => <li key={exception.id}>
                        {exception.shiftId ? `Turno ${exception.shiftId}: ` : 'Cobertura de la semana: '}{exception.reason} Responsable: tu cuenta. La causa sigue sin comprobarse.
                    </li>)}</ul></> : <p className="nx-shell-muted">La fuente no presenta excepciones en este corte; aún requiere revisión humana.</p>}
                {item.report.evidence.length > 0 && <><h5 className="nx-shell-text font-semibold">Fuentes declaradas por la revisión</h5>
                    <ul className="nx-shell-muted list-disc space-y-1 break-words pl-5">{item.report.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul></>}
                {item.report.notesTruncated && <p className="nx-tone-warning">El historial visible de notas está truncado; este informe no muestra todos los aportes.</p>}
                {item.acceptance && <p role="status" className="nx-shell-text">{item.acceptance.withExceptions ? 'Aceptado con excepciones pendientes' : 'Aceptado sin excepciones detectadas'} · Comprobante {item.acceptance.eventId} · Hash {item.acceptance.reportHash}</p>}
                {item.status === 'IN_REVIEW' && !item.acceptance && <div className="space-y-2">
                    <label className="nx-shell-text flex items-start gap-2"><input type="checkbox" checked={reviewed} disabled={locked || item.report.notesTruncated} onChange={event => setReviewed(event.target.checked)} />
                        Revisé esta versión, sus fuentes y las excepciones pendientes.</label>
                    <button type="button" className={assistantButtonClass} disabled={locked || !reviewed || !!c.note.trim() || item.report.notesTruncated} onClick={() => void c.acceptReport()}>
                        {item.report.exceptions.length ? 'Aceptar informe con excepciones' : 'Aceptar informe sin excepciones detectadas'}
                    </button>
                </div>}
            </section> : <p role="status" className="nx-tone-warning text-sm">No pudimos mostrar el informe preliminar de esta revisión.</p>}
            <h4 className="nx-shell-text font-semibold">Aportes del responsable</h4>
            <p className="nx-shell-muted text-xs">Las notas no prueban una causa ni cambian los importes de la fuente.</p>
            <ol className="nx-shell-text space-y-2 text-sm">{item.events.map(event => <li key={event.id} className="whitespace-pre-wrap break-words">{event.note ?? (event.type === 'CREATED' ? 'Revisión guardada' : statusLabel[event.status])}</li>)}</ol>
            {item.eventsTruncated && <p className="nx-shell-muted text-xs">Se muestran los últimos 100 eventos.</p>}
            {item.status !== 'CANCELLED' && item.status !== 'ACCEPTED' && <><label className="nx-shell-text block text-sm font-semibold">Nota de la revisión<textarea className={`${assistantInputClass} mt-1`} maxLength={2000} value={c.note} disabled={locked} onChange={event => c.setNote(event.target.value)} /></label>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={assistantButtonClass} disabled={locked || !c.note.trim()} onClick={() => void c.change('ADD_NOTE')}>Guardar nota</button>
                    <button type="button" className={assistantButtonClass} disabled={locked || !!c.note.trim()} onClick={() => void c.change(item.status === 'WAITING' ? 'RESUME' : 'WAIT')}>{item.status === 'WAITING' ? 'Retomar revisión' : 'Dejar en espera'}</button>
                    <button type="button" className={assistantButtonClass} disabled={locked || !!c.note.trim()} onClick={() => void c.change('CANCEL')}>Cancelar este trabajo</button>
                </div></>}
            {c.pending && <div className="nx-tone-warning space-y-2 text-sm"><p>El envío necesita comprobación. Conservamos tu nota y su referencia: <span className="break-all">{c.pending.input.eventId}</span>.</p>
                <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.open(item.id)}>Comprobar estado guardado</button>
                <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.retry()}>Reintentar el mismo envío</button>
            </div>}
            {c.pendingAcceptance && <div className="nx-tone-warning space-y-2 text-sm"><p>La aceptación necesita comprobación. Conservamos el hash y la referencia: <span className="break-all">{c.pendingAcceptance.input.reportHash} · {c.pendingAcceptance.input.eventId}</span>.</p>
                <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.open(item.id)}>Comprobar aceptación guardada</button>
                <button type="button" className={assistantButtonClass} disabled={c.busy} onClick={() => void c.retryAcceptance()}>Reintentar la misma aceptación</button>
            </div>}
        </section>}
    </section>;
}
