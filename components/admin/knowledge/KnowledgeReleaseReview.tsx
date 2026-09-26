import { useEffect, useRef, useState } from 'react';
import type { KnowledgeEditorialDocument, KnowledgeEditorialNote, KnowledgeEditorialReleaseDetail } from '../../../shared/assistantKnowledgeEditorial';
import { editorialError, uncertainEditorialResult, type KnowledgeEditorialRequest } from '../../../hooks/useKnowledgeEditorial';
import { assistantButtonClass, assistantInputClass } from '../../assistant/AssistantCatalogSelect';
import { KnowledgeDocument } from './KnowledgeDocument';
import { readEditorialDraft, rememberEditorialNote, type PendingEditorialNote } from './editorialDraftMemory';

export function KnowledgeReleaseReview({ sessionKey, releaseId, actorName, request, current, onChanged, onWorkingChange }: {
    sessionKey: string; releaseId: string; actorName: string; request: KnowledgeEditorialRequest; current: () => boolean; onChanged: () => void; onWorkingChange: (working: boolean) => void; key?: string;
}) {
    const saved = readEditorialDraft(sessionKey);
    const retained = saved?.releaseId === releaseId ? saved : null;
    const [detail, setDetail] = useState<KnowledgeEditorialReleaseDetail | null>(null);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [reviewAck, setReviewAck] = useState(false); const [publishAck, setPublishAck] = useState(false);
    const [note, setNote] = useState(retained?.note ?? ''); const [uncertain, setUncertain] = useState(false); const [noteUncertain, setNoteUncertain] = useState(Boolean(retained?.pendingNote));
    const [retirementDrafts, setRetirementDrafts] = useState<string[]>([]);
    const pendingNote = useRef<PendingEditorialNote | null>(retained?.pendingNote ?? null);
    const alive = useRef(true); const lock = useRef(false); const path = `/releases/${encodeURIComponent(releaseId)}`;
    const active = () => alive.current && current();
    useEffect(() => { onWorkingChange(busy || uncertain || noteUncertain || note.length > 0 || retirementDrafts.length > 0); return () => onWorkingChange(false); }, [busy, uncertain, noteUncertain, note, retirementDrafts.length, onWorkingChange]);
    const resetConsent = () => { setReviewAck(false); setPublishAck(false); };
    const readDetail = async () => {
        resetConsent();
        const value = await request<KnowledgeEditorialReleaseDetail>(path);
        if (active()) setDetail(value);
        return value;
    };
    const refresh = async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError(''); setNotice(''); resetConsent(); setDetail(null);
        try { await readDetail(); if (active()) setUncertain(false); }
        catch (failure) { if (active()) setError(editorialError(failure)); }
        finally { lock.current = false; if (active()) setBusy(false); }
    };
    useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [releaseId, request]);
    const mutate = async (suffix: string, body: unknown, success: string) => {
        if (lock.current || uncertain || noteUncertain || !detail) return;
        lock.current = true; setBusy(true); setError(''); setNotice(''); resetConsent();
        try {
            await request(suffix, { method: 'POST', body: JSON.stringify(body) });
            if (!active()) return;
            await readDetail();
            if (active()) { setNotice(success); onChanged(); }
        } catch (failure) {
            if (active()) { setUncertain(uncertainEditorialResult(failure)); setError(editorialError(failure)); }
        } finally { lock.current = false; if (active()) setBusy(false); }
    };
    const decide = (kind: 'review' | 'publish') => {
        if (!detail || (kind === 'review' ? !reviewAck : !publishAck)) return;
        void mutate(`${path}/${kind}`, { manifestHash: detail.manifestHash, acknowledged: true }, kind === 'review' ? 'Revisión registrada. La ayuda todavía no está publicada.' : 'Publicación confirmada por el servidor.');
    };
    const retire = async (document: KnowledgeEditorialDocument, reason: string) => {
        await mutate('/versions/retire', { reference: document.reference, reason, acknowledged: true }, 'Versión retirada. No se reactivará mediante un manifiesto anterior.');
    };
    const saveNote = async () => {
        if (lock.current || uncertain) return;
        if (!pendingNote.current) {
            if (!detail || note.trim().length < 10 || note.trim().length > 2000) return;
            pendingNote.current = { requestId: crypto.randomUUID(), manifestHash: detail.manifestHash, body: note.trim() };
        }
        rememberEditorialNote(sessionKey, releaseId, note, pendingNote.current);
        lock.current = true; setBusy(true); setError(''); setNotice(''); resetConsent();
        try {
            await request(`${path}/notes`, { method: 'POST', body: JSON.stringify(pendingNote.current) });
            if (!active()) return;
            pendingNote.current = null; rememberEditorialNote(sessionKey, releaseId, '', null); setNoteUncertain(false); setNote('');
            setNotice('Observación guardada. No aprueba ni publica el contenido.');
            try { await readDetail(); }
            catch (failure) { if (active()) { setDetail(null); setError(`La observación quedó guardada. ${editorialError(failure)}`); } }
        } catch (failure) {
            if (active()) {
                const lost = uncertainEditorialResult(failure); setNoteUncertain(lost);
                if (!lost) { pendingNote.current = null; rememberEditorialNote(sessionKey, releaseId, note, null); }
                setError(editorialError(failure));
            }
        } finally { lock.current = false; if (active()) setBusy(false); }
    };
    const moreNotes = async () => {
        if (lock.current || !detail?.nextNotesCursor) return;
        lock.current = true; setBusy(true); setError(''); resetConsent();
        try {
            const page = await request<{ notes: KnowledgeEditorialNote[]; nextCursor: string | null }>(`${path}/notes?cursor=${encodeURIComponent(detail.nextNotesCursor)}`);
            if (active()) setDetail(previous => previous ? { ...previous, notes: [...previous.notes, ...page.notes.filter(n => !previous.notes.some(old => old.id === n.id))], nextNotesCursor: page.nextCursor } : null);
        } catch (failure) { if (active()) setError(editorialError(failure)); }
        finally { lock.current = false; if (active()) setBusy(false); }
    };
    const disabled = busy || uncertain || noteUncertain;
    const decisionDisabled = disabled || note.length > 0;
    const publicationDisabled = decisionDisabled || retirementDrafts.length > 0;
    return <section aria-label={`Revisar publicación ${releaseId}`} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3"><h3 className="nx-shell-text break-words text-lg font-semibold">Publicación {releaseId}</h3>
            <button type="button" className={assistantButtonClass} disabled={busy || (!uncertain && retirementDrafts.length > 0)} onClick={() => void refresh()}>{uncertain ? 'Comprobar estado de la publicación' : 'Actualizar publicación'}</button></div>
        {busy && <p role="status" className="nx-shell-muted text-sm">Consultando estado editorial…</p>}
        {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
        {notice && <p role="status" className="nx-shell-text text-sm">{notice}</p>}
        {uncertain && <p role="status" className="nx-tone-warning text-sm">El resultado es incierto. No se repetirá la acción automáticamente. Consultá la misma publicación antes de volver a decidir.</p>}
        {detail && <>
            <p className="nx-shell-text text-sm">Estado: {detail.status} · {detail.active ? 'Ayuda activa' : 'No es la publicación activa'} · {detail.documentsCount} pasajes</p>
            <p className="nx-shell-muted text-sm">Revisor: {detail.reviewedById || 'Pendiente'}{detail.reviewedAt ? ` · ${detail.reviewedAt}` : ''}</p>
            <details className="nx-shell-muted text-xs"><summary className="min-h-tap cursor-pointer py-2">Manifiesto exacto</summary><p className="break-all">{detail.manifestHash}</p></details>
            <p className="nx-shell-muted text-sm">El contenido es inmutable. Para corregirlo, prepará otra publicación con una versión nueva del pasaje.</p>
            {detail.documents.map(doc => {
                const key = `${doc.reference.documentId}/${doc.reference.version}/${doc.reference.sectionId}`;
                return <KnowledgeDocument key={`${key}/${doc.status}`} sessionKey={sessionKey} document={doc} disabled={decisionDisabled} onRetire={retire} onEditingChange={editing => setRetirementDrafts(previous => editing ? previous.includes(key) ? previous : [...previous, key] : previous.filter(value => value !== key))} />;
            })}
            {detail.status === 'DRAFT' && <div className="nx-shell-control space-y-3 rounded-card border p-4">
                <label className="nx-shell-text flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewAck} disabled={publicationDisabled} onChange={event => setReviewAck(event.target.checked)} />Leí todos los pasajes, roles y canales de este manifiesto y confirmo mi revisión como {actorName}.</label>
                <button type="button" className={assistantButtonClass} disabled={publicationDisabled || !reviewAck} onClick={() => decide('review')}>Registrar revisión humana</button>
            </div>}
            {detail.status === 'REVIEWED' && <div className="nx-shell-control space-y-3 rounded-card border p-4">
                <p className="nx-tone-warning text-sm">Esta publicación reemplaza el conjunto activo de ayuda. Sólo sus pasajes estarán disponibles para nuevas respuestas, según roles y canales.</p>
                <label className="nx-shell-text flex items-start gap-2 text-sm"><input type="checkbox" checked={publishAck} disabled={publicationDisabled} onChange={event => setPublishAck(event.target.checked)} />Confirmo publicar este manifiesto revisado para los usuarios autorizados.</label>
                <button type="button" className={assistantButtonClass} disabled={publicationDisabled || !publishAck} onClick={() => decide('publish')}>Confirmar publicación de ayuda</button>
            </div>}
            <section aria-label="Observaciones guardadas" className="space-y-2"><h4 className="nx-shell-text font-semibold">Observaciones humanas</h4>
                {detail.notes.length === 0 && <p className="nx-shell-muted text-sm">Todavía no hay observaciones guardadas.</p>}
                <ul className="space-y-2">{detail.notes.map(value => <li key={value.id} className="nx-shell-control rounded-control border p-3"><p className="nx-shell-text whitespace-pre-wrap break-words text-sm">{value.body}</p><p className="nx-shell-muted text-xs">{value.authorId} · {value.createdAt}</p></li>)}</ul>
                {detail.nextNotesCursor && <button type="button" disabled={disabled} className={assistantButtonClass} onClick={() => void moreNotes()}>Cargar más observaciones</button>}
            </section>
        </>}
        <label className="nx-shell-text block text-sm">Tu observación<textarea className={assistantInputClass} value={note} maxLength={2000} disabled={busy || noteUncertain} onChange={event => { rememberEditorialNote(sessionKey, releaseId, event.target.value, null); setNote(event.target.value); resetConsent(); }} /></label>
        {note.length > 0 && !noteUncertain && <><p className="nx-shell-muted text-sm">Guardá o descartá la observación antes de cambiar de publicación o tomar una decisión.</p><button type="button" className={assistantButtonClass} disabled={busy} onClick={() => { rememberEditorialNote(sessionKey, releaseId, '', null); setNote(''); resetConsent(); }}>Descartar observación sin guardar</button></>}
        {noteUncertain ? <><p role="status" className="nx-tone-warning text-sm">La respuesta de la observación se perdió. El texto y su identificador están conservados.</p><button type="button" className={assistantButtonClass} disabled={busy} onClick={() => void saveNote()}>Reintentar la misma observación</button></>
            : <button type="button" className={assistantButtonClass} disabled={disabled || !detail || note.trim().length < 10} onClick={() => void saveNote()}>Guardar observación sin aprobar</button>}
    </section>;
}
