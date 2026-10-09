import React, { useId } from 'react';
import type { InvoiceDraft } from '../../shared/assistant';
import type { AssistantDocumentDecision, AssistantDocumentReview } from '../../shared/assistantDocumentReview';
import { assistantButtonClass, assistantInputClass } from './AssistantCatalogSelect';

type DecisionDraft = { choice?: AssistantDocumentDecision['choice']; reason: string };
export type DocumentDecisionDrafts = Record<string, DecisionDraft>;
const valueText = (value: unknown) => value === undefined || value === null || value === '' ? 'Sin dato' : typeof value === 'boolean' ? value ? 'Sí, declarado en esta fuente' : 'No confirmado en esta fuente' : String(value);
const sourceFields: Array<[keyof InvoiceDraft, string]> = [
    ['supplierName', 'Proveedor'], ['invoiceNumber', 'Factura'], ['currency', 'Moneda'], ['date', 'Fecha'],
    ['postingDate', 'Fecha contable'], ['dueDate', 'Vencimiento del crédito'], ['documentSubtotal', 'Subtotal'],
    ['documentTax', 'IVA'], ['documentTotal', 'Total'], ['discount', 'Descuento'], ['freight', 'Flete'],
    ['otherCharges', 'Otros cargos'], ['paymentMethod', 'Forma de pago declarada'], ['receivedConfirmed', 'Recepción declarada'],
    ['paymentConfirmed', 'Pago declarado'], ['notes', 'Notas'],
];
export function documentDecisionPayload(review: AssistantDocumentReview | undefined, drafts: DocumentDecisionDrafts) {
    const decisions: AssistantDocumentDecision[] = []; let incomplete = false;
    for (const conflict of review?.conflicts ?? []) {
        const draft = drafts[conflict.id];
        if (!draft || conflict.status !== 'PENDING' || conflict.kind !== 'VALUE') continue;
        if (!draft.choice || !draft.reason.trim() || draft.reason.trim().length > 500) { incomplete = true; continue; }
        decisions.push({ conflictId: conflict.id, choice: draft.choice, reason: draft.reason.trim() });
    }
    return { decisions, incomplete };
}

function OriginalSource({ source, title }: { source: InvoiceDraft | null; title: string }) {
    return <details className="nx-shell-control min-w-0 rounded-card border p-3">
        <summary className="nx-shell-text min-h-tap cursor-pointer break-words font-semibold">{title}</summary>
        {!source ? <p className="nx-shell-muted text-sm">No hay una declaración anterior.</p> : <div className="min-w-0 space-y-3 pt-3">
            <dl className="nx-shell-text grid min-w-0 grid-cols-1 gap-2 text-sm sm:grid-cols-2">{sourceFields.map(([key, label]) => <div key={key} className="min-w-0 break-words"><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap">{valueText(source[key])}</dd></div>)}</dl>
            <ol className="nx-shell-text space-y-3 text-sm">{source.items.map((item, index) => <li key={index} className="min-w-0 break-words">
                <p className="font-semibold">Renglón {index + 1}: {valueText(item.description)}</p>
                <p>Cantidad: {valueText(item.quantity)} · Costo: {valueText(item.unitCost)} · Unidad: {item.purchaseUnit === 'PACK' ? 'Empaque' : 'Base'}</p>
                <p>Lote: {valueText(item.batchNumber)} · Vencimiento: {valueText(item.expiryDate)}</p>
            </li>)}</ol>
            {source.warnings.length > 0 && <ul className="nx-tone-warning list-disc break-words pl-5 text-sm">{source.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </div>}
    </details>;
}

export const AssistantDocumentConflicts: React.FC<{
    review: AssistantDocumentReview; drafts: DocumentDecisionDrafts; disabled: boolean;
    onChange: (id: string, draft: DecisionDraft | undefined) => void;
}> = ({ review, drafts, disabled, onChange }) => {
    const id = useId();
    return <section aria-label="Fuentes y diferencias de la factura" className="min-w-0 space-y-3">
        <h4 className="nx-shell-text font-bold">Compará lo declarado con la factura</h4>
        <p className="nx-shell-muted break-words text-sm">Comprado o facturado no equivale a recibido ni pagado. Si recibiste sólo una parte o ya hubo un anticipo, revisá el caso en Compras.</p>
        <p className="nx-shell-muted text-sm">Las fuentes originales se conservan. Elegí qué dato usar y explicá por qué. Guardar decisiones prepara un borrador; después se calculan y revisan los efectos.</p>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><OriginalSource source={review.declared} title="Declaración original · sólo lectura" /><OriginalSource source={review.document} title="Documento extraído · sólo lectura" /></div>
        {review.conflicts.map((conflict, index) => {
            const draft = drafts[conflict.id]; const blocked = conflict.status === 'BLOCKED' || conflict.kind === 'LINE_MATCH';
            const name = `${id}-${index}`;
            return <fieldset key={conflict.id} disabled={disabled} className="nx-shell-control min-w-0 space-y-3 rounded-card border p-3 disabled:opacity-70">
                <legend className="nx-shell-text max-w-full break-words px-1 font-semibold">{conflict.label}</legend>
                <dl className="nx-shell-text grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div className="min-w-0"><dt className="font-semibold">Declarado</dt><dd aria-label="Valor declarado" className="break-words whitespace-pre-wrap">{valueText(conflict.declaredValue)}</dd></div>
                    <div className="min-w-0"><dt className="font-semibold">Facturado</dt><dd aria-label="Valor facturado" className="break-words whitespace-pre-wrap">{valueText(conflict.documentValue)}</dd></div>
                </dl>
                {blocked ? <p role="status" className="nx-tone-warning break-words text-sm">No hay una correspondencia segura entre los renglones. Revisá estos renglones en Compras; no se pueden resolver eligiendo una cantidad aquí.</p> : conflict.status === 'RESOLVED' ? <div className="nx-shell-text break-words text-sm">
                    <p className="font-semibold">{conflict.resolution ? `Decisión guardada: ${conflict.resolution.choice === 'DECLARED' ? 'conservar lo declarado' : 'usar lo facturado'}.` : 'No se pudo acreditar esta decisión. Revisá el caso en Compras.'}</p>
                    <p>{conflict.resolution?.reason}</p>
                    {conflict.resolution && <p className="nx-shell-muted text-xs">Revisión {conflict.resolution.proposalVersion} · {new Date(conflict.resolution.resolvedAt).toLocaleString('es-NI', { timeZone: 'America/Managua' })}</p>}
                </div> : <>
                    <p className="nx-shell-text text-sm font-semibold">¿Qué dato vas a conservar?</p>
                    <div className="space-y-1">{([['DECLARED', 'Conservar lo declarado'], ['DOCUMENT', 'Usar lo facturado']] as const).map(([choice, label]) => <label key={choice} className="nx-shell-text flex min-h-tap items-center gap-3 text-sm"><input type="radio" name={name} checked={draft?.choice === choice} onChange={() => onChange(conflict.id, { choice, reason: draft?.reason ?? '' })} />{label}</label>)}</div>
                    <label className="nx-shell-text block text-sm">Explicá tu elección<textarea className={`${assistantInputClass} mt-1`} maxLength={500} value={draft?.reason ?? ''} onChange={event => onChange(conflict.id, { ...draft, reason: event.target.value })} /></label>
                    {draft && (!draft.choice || !draft.reason.trim()) && <p role="status" className="nx-tone-warning text-sm">Elegí una fuente y escribí una explicación, o dejá esta diferencia pendiente.</p>}
                    {draft && <button type="button" className={assistantButtonClass} onClick={() => onChange(conflict.id, undefined)}>Dejar pendiente</button>}
                </>}
            </fieldset>;
        })}
    </section>;
};
