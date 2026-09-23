import { useEffect, useRef, useState } from 'react';
import type { KnowledgeEditorialDocument } from '../../../shared/assistantKnowledgeEditorial';
import { assistantButtonClass, assistantInputClass } from '../../assistant/AssistantCatalogSelect';

export function KnowledgeDocument({ document, disabled, onRetire, onEditingChange }: {
    document: KnowledgeEditorialDocument; disabled?: boolean; key?: string;
    onRetire?: (document: KnowledgeEditorialDocument, reason: string) => Promise<void>;
    onEditingChange?: (editing: boolean) => void;
}) {
    const [reason, setReason] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const editingCallback = useRef(onEditingChange); editingCallback.current = onEditingChange;
    const editing = reason.length > 0;
    useEffect(() => { editingCallback.current?.(editing); return () => editingCallback.current?.(false); }, [editing]);
    const { reference, payload, status } = document;
    return <article className="nx-shell-control space-y-3 rounded-card border p-4" aria-label={`${payload.title} · ${reference.version}`}>
        <h4 className="nx-shell-text font-semibold">{payload.title} · {payload.section}</h4>
        <p className="nx-shell-muted break-words text-sm">{reference.documentId} · {reference.version} · {reference.sectionId} · {status}</p>
        {status === 'LEGACY' && <p className="nx-tone-warning text-sm">Texto heredado: no acredita una revisión humana nueva.</p>}
        <p className="nx-shell-text whitespace-pre-wrap break-words text-sm">{payload.body}</p>
        <dl className="nx-shell-muted space-y-1 break-words text-sm">
            <div><dt className="inline font-semibold">Roles: </dt><dd className="inline">{payload.roles.join(', ')}</dd></div>
            <div><dt className="inline font-semibold">Capacidades: </dt><dd className="inline">{payload.requiredCapabilities.join(', ') || 'Ninguna adicional'}</dd></div>
            <div><dt className="inline font-semibold">Canales: </dt><dd className="inline">{payload.channels.join(', ')}</dd></div>
        </dl>
        <details className="nx-shell-muted text-xs"><summary className="min-h-tap cursor-pointer py-2">Identidad y palabras clave</summary>
            <p className="break-all">SHA-256: {reference.contentHash}</p><p className="break-words">{payload.keywords}</p>
        </details>
        {onRetire && status !== 'RETIRED' && <>
            <button type="button" className={assistantButtonClass} disabled={disabled} onClick={() => { setExpanded(!expanded); setAcknowledged(false); }}>Retirar esta versión</button>
            {expanded && <div className="space-y-3">
                <p className="nx-tone-warning text-sm">Retirar {reference.documentId} / {reference.version} / {reference.sectionId} impide volver a usar este pasaje y sus respuestas derivadas. No se puede deshacer publicando un manifiesto anterior.</p>
                <label className="nx-shell-text block text-sm">Motivo de retirada<textarea className={assistantInputClass} value={reason} maxLength={500} disabled={disabled} onChange={event => { setReason(event.target.value); setAcknowledged(false); }} /></label>
                <label className="nx-shell-text flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={event => setAcknowledged(event.target.checked)} />Confirmo retirar únicamente esta versión y sección.</label>
                <button type="button" className={assistantButtonClass} disabled={disabled || !acknowledged || reason.trim().length < 10} onClick={() => { setAcknowledged(false); void onRetire(document, reason.trim()); }}>Confirmar retirada</button>
                <button type="button" className={assistantButtonClass} disabled={disabled} onClick={() => { setReason(''); setAcknowledged(false); setExpanded(false); }}>Descartar motivo sin retirar</button>
            </div>}
        </>}
    </article>;
}
