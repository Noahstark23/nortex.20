import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { KnowledgeEditorialDecision, KnowledgeEditorialReleaseDetail } from '../../../shared/assistantKnowledgeEditorial';
import { editorialError, KnowledgeEditorialError, uncertainEditorialResult, type KnowledgeEditorialRequest } from '../../../hooks/useKnowledgeEditorial';
import { assistantButtonClass, assistantInputClass } from '../../assistant/AssistantCatalogSelect';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const importSchema = z.object({ id, formatVersion: z.literal(1), documents: z.array(z.object({
    documentId: id, version: id.max(64), sectionId: id.max(64), payload: z.object({
        title: z.string().trim().min(1).max(160), section: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(16000),
        keywords: z.string().trim().min(1).max(2000), roles: z.array(z.string().min(1).max(64)).min(1).max(24),
        requiredCapabilities: z.array(z.string().min(1).max(64)).min(1).max(20), channels: z.array(z.enum(['WEB_INTERNAL', 'WHATSAPP_PRIVATE'])).min(1).max(2),
    }).strict(),
}).strict()).min(1).max(60) }).strict();
type ImportValue = z.infer<typeof importSchema>;
function sameImportedContent(draft: ImportValue, result: KnowledgeEditorialReleaseDetail) {
    const canonical = (documents: ImportValue['documents']) => documents.map(document => ({ ...document, payload: {
        title: document.payload.title.trim(), section: document.payload.section.trim(), body: document.payload.body.trim(), keywords: document.payload.keywords.trim(),
        roles: [...new Set(document.payload.roles)].sort(), requiredCapabilities: [...new Set(document.payload.requiredCapabilities)].sort(), channels: [...new Set(document.payload.channels)].sort(),
    } })).sort((a, b) => `${a.documentId}/${a.sectionId}`.localeCompare(`${b.documentId}/${b.sectionId}`, 'en'));
    const remote = importSchema.safeParse({ id: result.id, formatVersion: result.formatVersion, documents: result.documents.map(document => ({
        documentId: document.reference.documentId, version: document.reference.version, sectionId: document.reference.sectionId, payload: document.payload,
    })) });
    return remote.success && draft.id === result.id && JSON.stringify(canonical(draft.documents)) === JSON.stringify(canonical(remote.data.documents));
}

export function KnowledgeImport({ request, current, onCreated, onWorkingChange }: {
    request: KnowledgeEditorialRequest; current: () => boolean; onCreated: (id: string) => void; onWorkingChange: (working: boolean) => void;
}) {
    const [draft, setDraft] = useState<ImportValue | null>(null); const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [uncertain, setUncertain] = useState(false);
    const alive = useRef(true); const sequence = useRef(0); const lock = useRef(false);
    const active = () => alive.current && current();
    useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
    useEffect(() => { onWorkingChange(!!draft || busy || uncertain); return () => onWorkingChange(false); }, [draft, busy, uncertain, onWorkingChange]);
    const read = async (file?: File) => {
        const seq = ++sequence.current; setDraft(null); setAck(false); setError('');
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.json') || file.size > 512_000) { setError('Elegí un único archivo JSON de hasta 512 KB.'); return; }
        try {
            const parsed = importSchema.safeParse(JSON.parse(await file.text()));
            if (!active() || seq !== sequence.current) return;
            if (!parsed.success) { setError('El archivo no cumple el formato editorial versión 1. Revisá los campos; no se importó nada.'); return; }
            setDraft(parsed.data);
        } catch { if (active() && seq === sequence.current) setError('No se pudo leer el JSON. No se importó nada.'); }
    };
    const prepare = async () => {
        if (lock.current || !draft || !ack || uncertain) return;
        lock.current = true; setBusy(true); setError(''); setAck(false);
        try {
            const result = await request<KnowledgeEditorialDecision>('/releases', { method: 'POST', body: JSON.stringify(draft) });
            if (active()) onCreated(result.id);
        } catch (failure) { if (active()) { setError(editorialError(failure)); setUncertain(uncertainEditorialResult(failure)); } }
        finally { lock.current = false; if (active()) setBusy(false); }
    };
    const recover = async () => {
        if (lock.current || !draft) return;
        lock.current = true; setBusy(true); setError('');
        try {
            const result = await request<KnowledgeEditorialReleaseDetail>(`/releases/${encodeURIComponent(draft.id)}`);
            if (active()) {
                if (sameImportedContent(draft, result)) onCreated(result.id);
                else { setUncertain(false); setError('Esa identidad ya contiene otros pasajes. Conservamos tu archivo: usá una identidad nueva y comprobá sus versiones antes de importarlo.'); }
            }
        } catch (failure) {
            if (active()) {
                if (failure instanceof KnowledgeEditorialError && failure.status === 404) { setUncertain(false); setError('No se encontró ese borrador. Podés confirmar de nuevo el mismo archivo conservado.'); }
                else setError(editorialError(failure));
            }
        } finally { lock.current = false; if (active()) setBusy(false); }
    };
    return <section aria-label="Preparar borrador de ayuda" className="nx-shell-control space-y-3 rounded-card border p-4">
        <h3 className="nx-shell-text font-semibold">Preparar un borrador</h3>
        <p className="nx-shell-muted text-sm">Sólo procedimientos oficiales de Nortex. No subás facturas, conversaciones, datos privados ni instrucciones internas de agentes. Importar no acredita revisión humana y no publica.</p>
        <label className="nx-shell-text block text-sm">Archivo editorial JSON<input type="file" accept=".json,application/json" className={assistantInputClass} disabled={busy || uncertain} onChange={event => void read(event.target.files?.[0])} /></label>
        <details className="nx-shell-muted text-sm"><summary className="min-h-tap cursor-pointer py-2">Formato del archivo</summary>
            <p>Raíz: id, formatVersion: 1, documents (1 a 60 pasajes). Cada pasaje: documentId, version, sectionId y payload con title, section, body, keywords, roles, requiredCapabilities y channels. Una corrección necesita una versión e identidad de publicación nuevas.</p>
        </details>
        {draft && <><p className="nx-shell-text text-sm">Publicación: {draft.id} · {draft.documents.length} pasajes</p>
            <ul className="nx-shell-muted space-y-1 text-sm">{draft.documents.map((doc, i) => <li key={i}>{doc.payload.title} · {doc.payload.section} · {doc.version}</li>)}</ul>
            <label className="nx-shell-text flex gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy || uncertain} onChange={event => setAck(event.target.checked)} />Confirmo preparar este contenido como borrador sin publicarlo.</label>
            {!uncertain && <button type="button" className={assistantButtonClass} disabled={busy || !ack} onClick={() => void prepare()}>Preparar borrador sin publicar</button>}
            {!uncertain && <button type="button" className={assistantButtonClass} disabled={busy} onClick={() => { setDraft(null); setAck(false); }}>Descartar archivo sin importar</button>}
        </>}
        {uncertain && <><p role="status" className="nx-tone-warning text-sm">La respuesta se perdió. Conservamos el archivo y su identidad. Comprobá el borrador antes de volver a enviarlo.</p><button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void recover()}>Comprobar borrador</button></>}
        {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
        {busy && <p role="status" className="nx-shell-muted text-sm">Comprobando borrador…</p>}
    </section>;
}
