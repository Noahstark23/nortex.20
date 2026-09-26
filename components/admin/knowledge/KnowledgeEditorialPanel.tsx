import { useEffect, useRef, useState } from 'react';
import { readActivationSession, useActivationSession, type ActivationSession } from '../../../hooks/useActivationJourney';
import { editorialError, uncertainEditorialResult, useKnowledgeEditorial } from '../../../hooks/useKnowledgeEditorial';
import type { KnowledgeEditorialCapabilities, KnowledgeEditorialDocument, KnowledgeEditorialList, KnowledgeReleaseStatus } from '../../../shared/assistantKnowledgeEditorial';
import { assistantButtonClass, assistantInputClass } from '../../assistant/AssistantCatalogSelect';
import { KnowledgeReleaseReview } from './KnowledgeReleaseReview';
import { KnowledgeImport } from './KnowledgeImport';
import { KnowledgeDocument } from './KnowledgeDocument';
import { clearEditorialDraft, clearEditorialImport, readEditorialDraft, readEditorialImport, rememberEditorialSelection } from './editorialDraftMemory';

export default function KnowledgeEditorialPanel({ onPendingWorkChange }: { onPendingWorkChange?: (pending: boolean) => void }) {
    const session = useActivationSession();
    return <EditorialContent key={session.key} session={session} onPendingWorkChange={onPendingWorkChange} />;
}

function EditorialContent({ session, onPendingWorkChange }: { session: ActivationSession; onPendingWorkChange?: (pending: boolean) => void; key?: string }) {
    const { request, current, denied } = useKnowledgeEditorial(session);
    const [capabilities, setCapabilities] = useState<KnowledgeEditorialCapabilities | null>(null);
    const [error, setError] = useState(''); const [initializing, setInitializing] = useState(true);
    const [status, setStatus] = useState<KnowledgeReleaseStatus>('DRAFT'); const [page, setPage] = useState<KnowledgeEditorialList | null>(null);
    const [selection, setSelection] = useState<string | null>(() => readEditorialDraft(session.key)?.releaseId ?? null);
    const [importing, setImporting] = useState(() => Boolean(readEditorialImport(session.key)));
    const [legacy, setLegacy] = useState<KnowledgeEditorialDocument[] | null>(null); const [busy, setBusy] = useState(false);
    const [legacyUncertain, setLegacyUncertain] = useState(false);
    const [working, setWorking] = useState(false);
    const [legacyDrafts, setLegacyDrafts] = useState<string[]>([]);
    const [accessAttempt, setAccessAttempt] = useState(0);
    const hasWork = working || legacyDrafts.length > 0;
    useEffect(() => { if (denied) clearEditorialDraft(); }, [denied]);
    const selectRelease = (releaseId: string | null) => { rememberEditorialSelection(session.key, releaseId); setSelection(releaseId); };
    useEffect(() => {
        onPendingWorkChange?.(!denied && hasWork);
        return () => onPendingWorkChange?.(false);
    }, [denied, hasWork, onPendingWorkChange]);
    const sequence = useRef(0); const lock = useRef(false);
    const load = async (cursor?: string) => {
        if (lock.current) return;
        lock.current = true; const generation = ++sequence.current; setBusy(true); setError('');
        if (!cursor) setPage(null);
        try {
            const value = await request<KnowledgeEditorialList>(`/releases?status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
            if (current() && generation === sequence.current) setPage(previous => cursor && previous ? { ...value, releases: [...previous.releases, ...value.releases.filter(row => !previous.releases.some(old => old.id === row.id))] } : value);
        } catch (failure) { if (current() && generation === sequence.current) setError(editorialError(failure)); }
        finally { lock.current = false; if (current() && generation === sequence.current) setBusy(false); }
    };
    useEffect(() => {
        let active = true;
        setInitializing(true); setError('');
        void request<KnowledgeEditorialCapabilities>('/capabilities').then(value => {
            if (active && current()) {
                if (value.canEdit !== true || !value.actor?.id || !value.actor.name) throw new Error('No se pudo comprobar tu identidad editorial.');
                setCapabilities(value);
            }
        }).catch(failure => { if (active && current()) setError(editorialError(failure)); }).finally(() => { if (active && current()) setInitializing(false); });
        return () => { active = false; sequence.current++; };
    }, [request, current, accessAttempt]);
    useEffect(() => {
        if (!hasWork) return;
        const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [hasWork]);
    useEffect(() => { if (capabilities) void load(); }, [capabilities, status]);
    const loadLegacy = async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError(''); setLegacy(null); selectRelease(null); setImporting(false);
        try { const value = await request<{ documents: KnowledgeEditorialDocument[] }>('/legacy'); if (current()) { setLegacy(value.documents); setLegacyUncertain(false); } }
        catch (failure) { if (current()) setError(editorialError(failure)); }
        finally { lock.current = false; if (current()) setBusy(false); }
    };
    const retireLegacy = async (document: KnowledgeEditorialDocument, reason: string) => {
        if (lock.current || legacyUncertain) return;
        lock.current = true; setBusy(true); setError('');
        try {
            await request('/versions/retire', { method: 'POST', body: JSON.stringify({ reference: document.reference, reason, acknowledged: true }) });
            const value = await request<{ documents: KnowledgeEditorialDocument[] }>('/legacy');
            if (current()) setLegacy(value.documents);
        } catch (failure) { if (current()) { setLegacyUncertain(uncertainEditorialResult(failure)); setLegacy(null); setError(editorialError(failure)); } }
        finally { lock.current = false; if (current()) setBusy(false); }
    };
    if (denied || readActivationSession().key !== session.key) return <p role="alert" className="nx-tone-warning p-4">La sesión ya no permite editar la ayuda. Volvé a iniciar sesión.</p>;
    return <section aria-label="Biblioteca editorial NortexGPT" data-operational-alerts="true" className="nx-shell-control space-y-5 rounded-card border p-4">
        <h2 className="nx-shell-text text-xl font-semibold">Ayuda de NortexGPT</h2>
        <p className="nx-shell-muted text-sm">Revisá procedimientos, registrá observaciones y publicá sólo contenido comprobado. Estas acciones no llaman a IA.</p>
        {initializing && <p role="status" className="nx-shell-muted text-sm">Comprobando acceso editorial…</p>}
        {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
        {!initializing && !capabilities && <button type="button" className={assistantButtonClass} onClick={() => setAccessAttempt(value => value + 1)}>Reintentar acceso editorial</button>}
        {capabilities && <>
            <p className="nx-shell-text text-sm">Sesión editorial: {capabilities.actor.name}</p>
            <p className="nx-shell-muted text-sm">Guardá tu trabajo antes de salir. Si navegás a otra sección y volvés en esta pestaña, los borradores editoriales siguen en memoria para esta sesión; cerrar la pestaña los descarta después del aviso del navegador.</p>
            <div className="flex flex-wrap items-end gap-3">
                <label className="nx-shell-text text-sm">Estado de publicaciones<select className={assistantInputClass} value={status} disabled={busy || hasWork} onChange={event => { setPage(null); selectRelease(null); setLegacy(null); setImporting(false); setStatus(event.target.value as KnowledgeReleaseStatus); }}>
                    <option value="DRAFT">Borradores</option><option value="REVIEWED">Revisadas</option><option value="PUBLISHED">Publicadas</option><option value="RETIRED">Retiradas</option>
                </select></label>
                <button type="button" className={assistantButtonClass} disabled={busy} onClick={() => void load()}>Actualizar listado</button>
                <button type="button" className={assistantButtonClass} disabled={busy || hasWork} onClick={() => { selectRelease(null); setLegacy(null); setImporting(true); }}>Preparar borrador</button>
                <button type="button" className={assistantButtonClass} disabled={busy || hasWork} onClick={() => void loadLegacy()}>Consultar ayuda heredada</button>
            </div>
            {busy && <p role="status" className="nx-shell-muted text-sm">Consultando biblioteca…</p>}
            {page && page.releases.length === 0 && <p role="status" className="nx-shell-muted text-sm">No hay publicaciones en este estado.</p>}
            {page && <ul className="space-y-2" aria-label="Publicaciones">{page.releases.map(row => <li key={row.id} className="nx-shell-border flex flex-wrap items-center gap-3 border-t py-2">
                <p className="nx-shell-text min-w-0 break-words text-sm">{row.id} · {row.status} · {row.documentsCount} pasajes{row.active ? ' · Activa' : ''}</p>
                <button type="button" className={assistantButtonClass} disabled={busy || hasWork} onClick={() => { setImporting(false); setLegacy(null); selectRelease(row.id); }}>Abrir {row.id}</button>
            </li>)}</ul>}
            {page?.nextCursor && <button type="button" className={assistantButtonClass} disabled={busy} onClick={() => void load(page.nextCursor!)}>Cargar más publicaciones</button>}
            {importing && <KnowledgeImport sessionKey={session.key} request={request} current={current} onWorkingChange={setWorking} onCreated={id => { clearEditorialImport(session.key); setImporting(false); selectRelease(id); void load(); }} />}
            {selection && <KnowledgeReleaseReview key={selection} sessionKey={session.key} releaseId={selection} actorName={capabilities.actor.name} request={request} current={current} onWorkingChange={setWorking} onChanged={() => { void load(); }} />}
            {legacyUncertain && <div className="space-y-2"><p role="status" className="nx-tone-warning text-sm">La retirada tuvo un resultado incierto. Consultá otra vez la ayuda heredada antes de repetir.</p><button type="button" disabled={busy} className={assistantButtonClass} onClick={() => void loadLegacy()}>Comprobar ayuda heredada</button></div>}
            {legacy && <section aria-label="Ayuda heredada" className="space-y-3"><h3 className="nx-shell-text font-semibold">Pasajes heredados</h3>
                <p className="nx-shell-muted text-sm">Conservan su procedencia LEGACY. Consultarlos no los declara revisados.</p>
                {legacy.map(document => {
                    const key = `${document.reference.documentId}/${document.reference.version}/${document.reference.sectionId}`;
                    return <KnowledgeDocument key={`${key}/${document.status}`} sessionKey={session.key} document={document} disabled={busy || legacyUncertain} onRetire={retireLegacy} onEditingChange={editing => setLegacyDrafts(previous => editing ? previous.includes(key) ? previous : [...previous, key] : previous.filter(value => value !== key))} />;
                })}
            </section>}
        </>}
    </section>;
}
