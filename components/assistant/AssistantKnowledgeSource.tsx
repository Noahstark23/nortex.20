import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { AssistantCitation } from '../../shared/assistant';
import type { AssistantKnowledgePassage } from '../../shared/assistantKnowledge';
import type { AssistantRequest } from '../../hooks/useNortexAssistant';
import { assistantButtonClass } from './AssistantCatalogSelect';

interface KnowledgeSourceContext { request: AssistantRequest; scope: string; revision: string; available: boolean; epoch: number; invalidate: () => void }
export const AssistantKnowledgeContext = createContext<KnowledgeSourceContext | null>(null);

/** La ruta se construye con identidad documental, nunca con el path persistido de una cita. */
export function assistantKnowledgePath(citation: AssistantCitation) {
    const base = `/knowledge/documents/${encodeURIComponent(citation.id)}/versions/${encodeURIComponent(citation.version)}/sections/${encodeURIComponent(citation.sectionId ?? 'main')}`;
    return citation.contentHash ? `${base}?contentHash=${encodeURIComponent(citation.contentHash)}` : base;
}
export function AssistantKnowledgeSource({ citation }: { citation: AssistantCitation }) {
    const context = useContext(AssistantKnowledgeContext); const id = useId();
    const [opened, setOpened] = useState(false); const [state, setState] = useState<{ key: string; passage?: AssistantKnowledgePassage; error?: boolean }>({ key: '' });
    const key = JSON.stringify([context?.scope, context?.revision, context?.epoch, context?.available, citation.id, citation.version, citation.sectionId, citation.contentHash]);
    const current = useRef(key); current.current = key;
    useEffect(() => {
        if (!opened || !context?.available) return;
        let cancelled = false; setState({ key });
        void context.request<AssistantKnowledgePassage>(assistantKnowledgePath(citation)).then(passage => {
            if (cancelled || current.current !== key) return;
            if (!passage || passage.reference.documentId !== citation.id || passage.reference.version !== citation.version || passage.reference.sectionId !== (citation.sectionId ?? 'main') || (citation.contentHash && passage.reference.contentHash !== citation.contentHash) || passage.revision !== context.revision || typeof passage.body !== 'string' || !passage.body.trim()) throw new Error('Fuente no disponible');
            setState({ key, passage });
        }).catch(() => { if (!cancelled && current.current === key) { setState({ key, error: true }); context.invalidate(); } });
        return () => { cancelled = true; };
    }, [opened, key, context?.request]);
    const passage = context?.available && state.key === key ? state.passage : undefined;
    return <div className="space-y-2">
        <p>{context && !context.available ? 'Fuente de ayuda no disponible' : `${citation.title} · ${citation.section} · Versión ${citation.version}`}</p>
        <button type="button" className={assistantButtonClass} aria-expanded={opened} aria-controls={id} disabled={!context?.available} onClick={() => { setState({ key }); setOpened(value => !value); }}>{opened ? 'Cerrar fuente' : 'Ver fuente'}</button>
        {opened && <section id={id} aria-label="Pasaje de ayuda" className="nx-shell-control space-y-2 rounded-card border p-3">
            {passage ? <><h4 className="nx-shell-text font-semibold">{passage.title} · {passage.section}</h4><p className="nx-shell-muted text-xs">Versión {passage.reference.version} · {passage.publication === 'LEGACY' ? 'Ayuda heredada' : 'Ayuda publicada'}{passage.historical ? ' · Versión histórica' : ''}</p><p className="nx-shell-text whitespace-pre-wrap break-words text-sm">{passage.body}</p><p className="nx-shell-muted break-all text-xs">Documento: {passage.reference.documentId} · Sección: {passage.reference.sectionId}</p></> : <p role="status" className="nx-shell-muted text-sm">{!context?.available || state.error ? 'Esta fuente no está disponible. No se conserva una copia anterior.' : 'Comprobando la fuente…'}</p>}
        </section>}
    </div>;
}
export function AssistantKnowledgeCitations({ citations }: { citations: AssistantCitation[] }) {
    if (!citations.length) return null;
    return <ul aria-label="Fuentes de ayuda" className="nx-shell-muted space-y-2 break-words text-xs">{citations.map((citation, index) => <li key={`${citation.id}:${citation.version}:${citation.sectionId ?? 'main'}:${index}`}><AssistantKnowledgeSource citation={citation} /></li>)}</ul>;
}
