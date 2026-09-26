/** Sólo memoria de esta pestaña: conserva trabajo editorial al desmontar la ruta, nunca en storage. */
export type PendingEditorialNote = { requestId: string; manifestHash: string; body: string };
type EditorialDraft = { sessionKey: string; releaseId: string | null; note: string; pendingNote: PendingEditorialNote | null };
type ImportDraft = { payload: unknown; uncertain: boolean };

let activeSessionKey: string | null = null;
let draft: EditorialDraft | null = null;
let importDraft: ImportDraft | null = null;
let retirementReasons = new Map<string, string>();

function ensureSession(sessionKey: string) {
    if (activeSessionKey === sessionKey) return;
    activeSessionKey = sessionKey;
    draft = null;
    importDraft = null;
    retirementReasons = new Map();
}

export function readEditorialDraft(sessionKey: string): EditorialDraft | null {
    ensureSession(sessionKey);
    return draft;
}

export function rememberEditorialSelection(sessionKey: string, releaseId: string | null) {
    const previous = readEditorialDraft(sessionKey);
    draft = previous?.releaseId === releaseId ? previous : { sessionKey, releaseId, note: '', pendingNote: null };
}

export function rememberEditorialNote(sessionKey: string, releaseId: string, note: string, pendingNote: PendingEditorialNote | null) {
    readEditorialDraft(sessionKey);
    draft = { sessionKey, releaseId, note, pendingNote };
}

export function readEditorialImport(sessionKey: string): ImportDraft | null { ensureSession(sessionKey); return importDraft; }
export function rememberEditorialImport(sessionKey: string, payload: unknown, uncertain: boolean) {
    ensureSession(sessionKey);
    importDraft = { payload, uncertain };
}
export function clearEditorialImport(sessionKey: string) { ensureSession(sessionKey); importDraft = null; }

export function readEditorialRetirement(sessionKey: string, referenceKey: string): string {
    ensureSession(sessionKey);
    return retirementReasons.get(referenceKey) ?? '';
}
export function rememberEditorialRetirement(sessionKey: string, referenceKey: string, reason: string) {
    ensureSession(sessionKey);
    if (reason) retirementReasons.set(referenceKey, reason);
    else retirementReasons.delete(referenceKey);
}

export function clearEditorialDraft() { activeSessionKey = null; draft = null; importDraft = null; retirementReasons.clear(); }
