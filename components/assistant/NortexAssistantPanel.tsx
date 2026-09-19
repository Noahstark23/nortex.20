import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, MessageSquare, Paperclip, Send, X } from 'lucide-react';
import FluidSheet from '../ui/FluidSheet';
import { useVentaEnCurso } from '../VentaEnCursoContext';
import type { NortexAssistantController } from '../../hooks/useNortexAssistant';
import type { AssistantAction } from '../../shared/assistant';
import { formatMoney } from '../../utils/money';
import { AssistantInvoiceReview, useAssistantInvoiceReviewState } from './AssistantInvoiceReview';
import { assistantJobMessage } from './assistantJobMessage';
import { AssistantAttachmentPreview } from './AssistantAttachmentPreview';
import { AssistantPrivateWhatsapp } from './AssistantPrivateWhatsapp';
import { AssistantRunView } from './AssistantRunView';
import { AssistantActionReview } from './AssistantActionReview';
import { AssistantDailyBrief } from './AssistantDailyBrief';
import { AssistantPurchaseIntake } from './AssistantPurchaseIntake';
import { assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';

export default function NortexAssistantPanel({ controller, open, onClose }: { controller: NortexAssistantController; open: boolean; onClose: () => void }) {
    const location = useLocation(); const sharedParameters = new URLSearchParams(location.search); const sharedConversation = sharedParameters.get('assistantConversation'); const sharedExtraction = sharedParameters.get('assistantExtraction');
    const titleId = useId(); const [text, setText] = useState(''); const [conversationReference, setConversationReference] = useState(''); const [saleWarning, setSaleWarning] = useState(false);
    const [reference, setReference] = useState(''); const [referenceKind, setReferenceKind] = useState<'proposals' | 'extractions' | 'operations'>('proposals');
    const [tab, setTab] = useState<'chat' | 'invoice' | 'action'>('chat'); const sale = useVentaEnCurso(); const navigate = useNavigate();
    const warningRef = useRef<HTMLHeadingElement>(null); const lastMessage = useRef<HTMLDivElement>(null); const composer = useRef<HTMLTextAreaElement>(null);
    const { capabilities, messages, proposal, attachments, job, busy, error, purchaseIntake, pendingMessage } = controller;
    const invoiceEditor = useAssistantInvoiceReviewState(proposal);
    const operational = controller.operations;
    const actionProtected = !!operational && (operational.dirty || operational.uncertain);
    const protectedReview = actionProtected || invoiceEditor.dirty || (invoiceEditor.confirmStarted && !controller.operation);
    const reading = !!job && ['PENDING', 'PROCESSING'].includes(job.status);
    const conversationBlocked = busy || operational?.busy || protectedReview || !!pendingMessage || reading;
    useLayoutEffect(() => {
        if (!open) return;
        const background = document.getElementById('root');
        if (!background) return;
        const wasInert = background.hasAttribute('inert');
        background.setAttribute('inert', '');
        return () => { if (!wasInert) background.removeAttribute('inert'); };
    }, [open]);
    useEffect(() => { if (saleWarning) warningRef.current?.focus(); }, [saleWarning]);
    useEffect(() => { if (open) lastMessage.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages.length, open]);
    useEffect(() => {
        if (!open || !job || !['PENDING', 'PROCESSING'].includes(job.status)) return;
        const timer = window.setTimeout(() => { if (!busy) void controller.refreshJob(); }, 3_000);
        return () => clearTimeout(timer);
    }, [open, job, busy, controller.refreshJob]);
    useEffect(() => { if (open && capabilities?.dailyBrief) void operational?.loadBrief(); }, [open, capabilities?.dailyBrief, operational?.loadBrief]);
    const reviewAction = (id: string) => { if (invoiceEditor.dirty || (invoiceEditor.confirmStarted && !controller.operation)) return; void operational?.openProposal(id); setTab('action'); };
    useEffect(() => { if (sharedExtraction && !protectedReview && (job || proposal)) setTab('invoice'); }, [sharedExtraction, job?.id, proposal?.id]);
    const recoverShared = async () => { if (conversationBlocked) return; if (sharedConversation) await controller.recoverConversation(sharedConversation); if (sharedExtraction) { await controller.recover('extractions', sharedExtraction); setTab('invoice'); } };
    const openPurchases = () => { if (sale.hayVenta) { setSaleWarning(true); return; } onClose(); navigate('/app/purchases'); };
    const submit = () => { if (!text.trim() || conversationBlocked) return; const message = text; setText(''); void controller.send(message); };
    const actionDisabled = (action: AssistantAction) => {
        if (busy || pendingMessage || reading || !capabilities?.invoiceRead) return true;
        if (action.type === 'REVIEW_PURCHASE') return !action.proposalId || (protectedReview && proposal?.id !== action.proposalId);
        if (protectedReview) return true;
        if (action.type === 'CONTINUE_PURCHASE') return !capabilities.purchasePrepare;
        return !capabilities.invoicePrepare || !capabilities.extractionEnabled || (!!proposal && !controller.operation && !['EXPIRED', 'CANCELLED'].includes(proposal.status));
    };
    const actOnPurchase = async (action: AssistantAction) => {
        if (actionDisabled(action)) return;
        if (action.type === 'CONTINUE_PURCHASE') { await controller.send('Completar por aquí'); composer.current?.focus(); }
        else if (action.type === 'UPLOAD_INVOICE') { if (proposal) controller.newInvoice(true); setTab('invoice'); }
        else if (action.type === 'REVIEW_PURCHASE' && action.proposalId) {
            if (protectedReview && proposal?.id === action.proposalId) setTab('invoice');
            else if (await controller.openProposal(action.proposalId)) setTab('invoice');
        }
    };
    return createPortal(<FluidSheet open={open} onClose={onClose} ariaLabel="NortexGPT" labelledBy={titleId} className="nx-app-shell" panelClassName="max-w-3xl" size="full" dragToDismiss={false}>
        {/* Este marcador es el contrato operativo que consulta el lector y los atajos del POS. */}
        <div data-operational-alerts="" data-nortex-assistant="" className="nx-shell-border flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
            <div><h2 id={titleId} className="nx-shell-text text-lg font-bold">NortexGPT</h2><p className="nx-shell-muted text-sm">Consultá tu negocio. Revisá antes de actuar.</p></div>
            <button type="button" aria-label="Cerrar NortexGPT" data-fluid-sheet-initial-focus className={assistantButtonClass} onClick={onClose}><X size={20} /></button>
        </div>
        {!capabilities?.enabled ? <div className="space-y-3 overflow-y-auto p-5"><p role="status" className="nx-shell-muted text-sm">{controller.capabilitiesFailed ? 'No pudimos comprobar tu acceso. Los datos anteriores se ocultaron.' : 'NortexGPT está desactivado para esta sesión.'}</p><button className={assistantButtonClass} type="button" onClick={() => void controller.refreshCapabilities()}>Comprobar acceso</button></div> : <>
            <div role="tablist" aria-label="Uso de NortexGPT" className="nx-shell-border grid shrink-0 grid-cols-2 gap-2 border-b p-3">
                <button type="button" role="tab" aria-selected={tab === 'chat'} className={`${assistantButtonClass} ${tab === 'chat' ? 'nx-tone-positive' : ''}`} onClick={() => setTab('chat')}><MessageSquare size={17} /> Consultar</button>
                <button type="button" role="tab" aria-selected={tab === 'invoice'} className={`${assistantButtonClass} ${tab === 'invoice' ? 'nx-tone-positive' : ''}`} onClick={() => setTab('invoice')}><Paperclip size={17} /> Factura</button>
                {operational?.proposal && <button type="button" role="tab" aria-selected={tab === 'action'} className={assistantButtonClass} onClick={() => setTab('action')}>Revisar acción</button>}
            </div>
            <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5" role="tabpanel" aria-label={tab === 'chat' ? 'Consultar' : tab === 'invoice' ? 'Factura' : 'Revisar acción'}>
                {(sharedConversation || sharedExtraction) && <details className="nx-shell-control rounded-card border p-3"><summary className="nx-shell-text min-h-tap cursor-pointer text-sm">Referencia recibida por WhatsApp</summary><p className="nx-shell-muted text-sm">Se comprobará tu acceso antes de recuperar el documento. Guardá cualquier revisión actual para conservar sus cambios.</p><button type="button" disabled={conversationBlocked} className={assistantButtonClass} onClick={() => void recoverShared()}>Retomar referencia compartida</button></details>}
                {saleWarning && <section className="nx-shell-control space-y-2 rounded-card border p-4"><h3 tabIndex={-1} ref={warningRef} className="nx-shell-text font-bold">Tenés una venta abierta</h3><p className="nx-shell-muted text-sm">Terminá o aparcá la venta antes de abrir Compras. Podés seguir revisando la factura aquí.</p><button type="button" className={assistantButtonClass} onClick={() => { setSaleWarning(false); onClose(); }}>Seguir vendiendo</button></section>}
                {error && <p role="alert" className="nx-tone-warning rounded-control border p-3 text-sm">{error}</p>}
                {operational?.error && <p role="alert" className="nx-tone-warning rounded-control border p-3 text-sm">{operational.error}</p>}
                {tab === 'action' && operational ? <AssistantActionReview controller={operational} capabilities={capabilities} request={controller.request} /> : tab === 'chat' ? <>
                    {operational?.brief && <AssistantDailyBrief brief={operational.brief} busy={conversationBlocked} onDismiss={itemId => void operational.dismiss(itemId)} onAsk={message => void controller.send(message)} />}
                    {messages.length === 0 && <div className="space-y-3"><p className="nx-shell-text text-sm">Te ayudo con los datos y funciones disponibles para tu rol. Las consultas no cambian tu negocio.</p><div className="flex flex-wrap gap-2">
                        {capabilities.overview && <button type="button" className={assistantButtonClass} disabled={conversationBlocked} onClick={() => void controller.send('¿Cómo va mi negocio hoy?')}>¿Cómo va mi negocio hoy?</button>}
                        {capabilities.inventory && <button type="button" className={assistantButtonClass} disabled={conversationBlocked} onClick={() => void controller.send('¿Qué existencias y vencimientos requieren atención?')}>Existencias y vencimientos</button>}
                        {capabilities.help && <button type="button" className={assistantButtonClass} disabled={conversationBlocked} onClick={() => void controller.send('¿Cómo registro una compra?')}><BookOpen size={16} /> Cómo registrar una compra</button>}
                    </div></div>}
                    <div role="log" aria-label="Conversación privada" aria-live="polite" className="space-y-4">{messages.map(message => <article key={message.id} className={`nx-shell-control space-y-3 rounded-card border p-4 ${message.role === 'user' ? 'sm:ml-10' : 'sm:mr-10'}`}>
                        <h3 className="nx-shell-muted text-xs font-bold">{message.role === 'user' ? 'Vos' : 'NortexGPT'}</h3><p className="nx-shell-text whitespace-pre-wrap break-words text-sm">{message.text}</p>
                        {message.overview && <section aria-label="Datos del negocio" className="space-y-3"><p className="nx-shell-muted text-xs">Período: {message.overview.startDate} al {message.overview.endDate} · Managua<br />{message.overview.scope}<br />Consultado: {new Date(message.overview.checkedAt).toLocaleString('es-NI', { timeZone: 'America/Managua' })}</p>
                            <dl className="space-y-3">{message.overview.metrics.map(metric => <div key={metric.key} className="nx-shell-border border-t pt-2"><dt className="nx-shell-text text-sm font-semibold">{metric.label}</dt><dd className={metric.status === 'unavailable' || metric.value === null ? 'nx-tone-warning' : 'nx-shell-text'}>{metric.status === 'unavailable' || metric.value === null ? 'No disponible' : metric.unit === 'money' ? formatMoney(metric.value) : metric.value}</dd><dd className="nx-shell-muted break-words text-xs">Fuente: {metric.source}</dd></div>)}</dl>
                        </section>}
                        {message.operationalRunId && operational && (operational.runs[message.operationalRunId] ? <AssistantRunView run={operational.runs[message.operationalRunId]} busy={operational.busy} onCancel={() => void operational.changeRun(message.operationalRunId!, 'cancel')} onRecover={() => void operational.changeRun(message.operationalRunId!, 'recover')} onReview={reviewAction} /> : <div className="space-y-2"><p role="status" className="nx-shell-muted text-sm">Comprobando el avance de esta consulta…</p><button type="button" className={assistantButtonClass} onClick={() => void operational.refreshRun(message.operationalRunId!)}>Comprobar consulta</button></div>)}
                        {!!message.citations?.length && <ul aria-label="Fuentes de ayuda" className="nx-shell-muted space-y-2 text-xs">{message.citations.map(citation => <li key={citation.id}>{citation.title} · {citation.section} · Versión {citation.version}</li>)}</ul>}
                    </article>)}</div>
                    {purchaseIntake && capabilities.invoiceRead && <AssistantPurchaseIntake intake={purchaseIntake} actions={controller.actions} disabled={actionDisabled} onAction={action => void actOnPurchase(action)} />}
                    {protectedReview && <section className="nx-tone-warning space-y-2 rounded-control border p-3 text-sm"><p>{actionProtected ? 'Tenés una acción en revisión. Guardá sus cambios o comprobá la confirmación antes de continuar.' : invoiceEditor.dirty ? 'Tenés cambios sin guardar en la revisión. Guardalos antes de continuar la conversación.' : 'La confirmación sigue pendiente. Comprobá su resultado con la misma referencia antes de continuar.'}</p><button type="button" className={assistantButtonClass} onClick={() => setTab(actionProtected ? 'action' : 'invoice')}>Retomar revisión actual</button></section>}
                    {reading && <div className="space-y-2"><p className="nx-shell-muted text-sm">La factura se está leyendo. Conservamos la captura mientras termina.</p><button type="button" className={assistantButtonClass} onClick={() => setTab('invoice')}>Ver lectura de factura</button></div>}
                    {pendingMessage && !busy && <div className="space-y-2"><p className="nx-tone-warning text-sm">El mensaje quedó pendiente. Retomalo con la misma referencia para conservar la captura.</p><button type="button" className={assistantButtonClass} disabled={protectedReview || reading} onClick={() => void controller.send(pendingMessage.text)}>Reintentar mensaje pendiente</button></div>}
                    {busy && <p role="status" className="nx-shell-muted text-sm">Consultando…</p>}<div ref={lastMessage} />
                    {controller.conversationId && <p className="nx-shell-muted break-all text-xs">Referencia de conversación: {controller.conversationId}</p>}
                    {capabilities.privateWhatsapp && <AssistantPrivateWhatsapp request={controller.request} />}
                    <details className="nx-shell-control rounded-card border p-3"><summary className="nx-shell-text min-h-tap cursor-pointer text-sm font-semibold">Retomar una conversación</summary><label className="nx-shell-text block text-sm">Referencia de conversación<input className={assistantInputClass} value={conversationReference} onChange={event => setConversationReference(event.target.value)} /></label><button type="button" className={`${assistantButtonClass} mt-2`} disabled={busy || !!pendingMessage || protectedReview || reading || !conversationReference.trim()} onClick={() => void controller.recoverConversation(conversationReference)}>Consultar conversación</button></details>
                </> : !capabilities.invoiceRead ? <p className="nx-shell-muted text-sm">Tu rol no tiene acceso a facturas y costos. Podés consultar la ayuda de tus módulos.</p> : <>
                    {!capabilities.extractionEnabled && !proposal && <p role="status" className="nx-tone-warning text-sm">La lectura de documentos está desactivada. {capabilities.purchasePrepare ? 'Podés completar la compra por conversación o desde Compras.' : 'Podés registrar la factura desde Compras.'}</p>}
                    {!proposal && purchaseIntake && <section className="nx-shell-control space-y-2 rounded-card border p-3"><p className="nx-shell-text break-words text-sm">{purchaseIntake.summary}</p><p className="nx-shell-muted text-xs">La factura se vinculará con esta captura. Podés volver a la conversación sin perder los datos.</p><button type="button" className={assistantButtonClass} onClick={() => setTab('chat')}>Volver a la conversación</button></section>}
                    {!proposal && <div className="space-y-3"><p className="nx-shell-text text-sm">Adjuntá una factura: un PDF o hasta 10 fotos, 10 MB en total. Se leerá en segundo plano; todavía no se registrará ninguna compra.</p>
                        <label className="nx-shell-text flex min-w-0 flex-col gap-2 text-sm font-semibold"><Paperclip size={17} />Elegir foto o PDF<input aria-label="Adjuntar factura" type="file" accept="image/jpeg,image/png,application/pdf" multiple disabled={busy || !!pendingMessage || !capabilities.invoicePrepare || !capabilities.extractionEnabled || reading} className="min-w-0 max-w-full text-xs" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void controller.upload(files); }} /></label>
                    </div>}
                    {attachments.map(attachment => <AssistantAttachmentPreview key={attachment.id} attachment={attachment} sessionKey={controller.sessionKey} />)}
                    {job && <section aria-label="Lectura de factura" className="nx-shell-control space-y-2 rounded-card border p-3"><p role="status" className="nx-shell-text text-sm">{job.status === 'PENDING' ? 'Factura en espera para lectura.' : job.status === 'PROCESSING' ? 'Leyendo la factura. Podés cerrar el panel y seguir trabajando.' : job.status === 'FAILED' ? 'No se pudo leer la factura.' : 'Lectura terminada. Revisá los datos antes de registrar.'}</p><p className="nx-shell-muted break-all text-xs">Referencia de lectura: {job.id}</p>{job.error && <p role="alert" className="nx-tone-warning text-sm">{assistantJobMessage(job.error)}</p>}{(['PENDING', 'PROCESSING'].includes(job.status) || (job.status === 'SUCCEEDED' && !proposal)) && <button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void controller.refreshJob()}>Comprobar lectura</button>}</section>}
                    {(controller.operation || (proposal && ['EXPIRED', 'CANCELLED'].includes(proposal.status))) && <button type="button" className={assistantButtonClass} onClick={() => controller.newInvoice()}>Leer otra factura</button>}
                    {proposal && <AssistantInvoiceReview key={proposal.id} proposal={proposal} confirmationRejected={controller.confirmationRejected} editor={invoiceEditor} capabilities={capabilities} request={controller.request} busy={busy} operation={controller.operation} onSave={controller.save} onConfirm={controller.confirm} onOpenPurchases={openPurchases} />}
                    {!proposal && <button type="button" className={assistantButtonClass} onClick={openPurchases}>Abrir Compras</button>}
                    <details className="nx-shell-control rounded-card border p-3"><summary className="nx-shell-text min-h-tap cursor-pointer text-sm font-semibold">Retomar una lectura o comprobar una compra</summary><p className="nx-shell-muted mb-3 text-xs">Usá la referencia que guardaste. Consultar no registra una compra. Guardá los cambios de la revisión actual antes de abrir otra; una confirmación pendiente conserva su propia referencia.</p><label className="nx-shell-text block text-sm">Tipo de referencia<select className={assistantInputClass} value={referenceKind} onChange={event => setReferenceKind(event.target.value as typeof referenceKind)}><option value="proposals">Propuesta</option><option value="extractions">Lectura de documento</option><option value="operations">Operación de compra</option></select></label><label className="nx-shell-text block text-sm">Referencia<input value={reference} onChange={event => setReference(event.target.value)} className={assistantInputClass} /></label><button type="button" className={`${assistantButtonClass} mt-3`} disabled={busy || !reference.trim() || invoiceEditor.dirty || (invoiceEditor.confirmStarted && !controller.operation && (referenceKind !== 'operations' || reference !== invoiceEditor.confirmation.current.key))} onClick={() => void controller.recover(referenceKind, reference)}>Consultar referencia</button></details>
                </>}
            </div>
            {tab === 'chat' && <form className="nx-shell-border mt-auto shrink-0 space-y-2 border-t p-3" onSubmit={event => { event.preventDefault(); submit(); }}>
                <label className="sr-only" htmlFor={`${titleId}-message`}>Tu consulta</label><div className="flex items-end gap-2"><textarea ref={composer} id={`${titleId}-message`} value={text} rows={2} maxLength={4000} className={assistantInputClass} placeholder={purchaseIntake ? 'Completá los datos que faltan…' : 'Preguntale a NortexGPT…'} disabled={conversationBlocked} onChange={event => setText(event.target.value)} /><button type="submit" className={assistantButtonClass} disabled={conversationBlocked || !text.trim()} aria-label="Enviar consulta"><Send size={18} /></button></div><p className="nx-shell-muted text-xs">Conversación privada de tu usuario. Se conserva durante 30 días.</p>
            </form>}
        </>}
    </FluidSheet>, document.body);
}
