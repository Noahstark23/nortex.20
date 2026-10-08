/** Borradores de esta pestaña: nunca ejecutan operaciones ni almacenan el JWT. */
const PREFIX = 'nortex:bodega-draft:v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

export function bodegaReceivingDraftKey(kind: string): string | null {
    try {
        const encoded = localStorage.getItem('nortex_token')?.split('.')[1];
        if (!encoded) return null;
        const payload = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const user = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
        const tenantId = user.tenantId;
        const userId = user.userId ?? user.id ?? user.sub;
        if (typeof tenantId !== 'string' || !tenantId || typeof userId !== 'string' || !userId || !user.role) return null;
        return `${PREFIX}:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}:${encodeURIComponent(user.role)}:${kind}`;
    } catch { return null; }
}

export function readBodegaReceivingDraft<T>(kind: string): T | null {
    try {
        const key = bodegaReceivingDraftKey(kind);
        if (!key) return null;
        const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        if (!saved || saved.version !== 1 || typeof saved.savedAt !== 'number'
            || Date.now() - saved.savedAt > MAX_AGE || !saved.value || typeof saved.value !== 'object') return null;
        return saved.value as T;
    } catch { return null; }
}

export function writeBodegaReceivingDraft(kind: string, value: unknown): boolean {
    try {
        const key = bodegaReceivingDraftKey(kind);
        if (!key) return false;
        sessionStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), value }));
        return true;
    } catch { return false; }
}

export interface BodegaReceivingAttempt { payload: string; key: string }
/** Un payload idéntico conserva la identidad aun si se perdió la respuesta. */
export function bodegaReceivingAttempt(payload: string, previous?: BodegaReceivingAttempt | null): BodegaReceivingAttempt {
    return previous?.payload === payload && typeof previous.key === 'string' && previous.key
        ? previous
        : { payload, key: crypto.randomUUID() };
}
