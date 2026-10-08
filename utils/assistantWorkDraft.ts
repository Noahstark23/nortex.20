import { z } from 'zod';
import type { AssistantWorkAcceptanceInput, AssistantWorkItemEventInput } from '../shared/assistantWorkItems';
import { inventoryAdjustmentScope } from './inventoryAdjustmentAttempt';

const KEY = 'nortex.assistant.work-draft.v1';
const keyFor = (scope: string) => `${KEY}:${encodeURIComponent(scope)}`;
const workId = z.string().min(1).max(191);
const eventId = z.uuid();
const version = z.number().int().nonnegative().max(2_147_483_646);
const pendingEvent = z.object({ id: workId, input: z.discriminatedUnion('type', [
    z.object({ eventId, version, type: z.literal('ADD_NOTE'), note: z.string().min(1).max(2000) }).strict(),
    z.object({ eventId, version, type: z.literal('WAIT') }).strict(),
    z.object({ eventId, version, type: z.literal('RESUME') }).strict(),
    z.object({ eventId, version, type: z.literal('CANCEL') }).strict(),
]) }).strict();
const pendingAcceptance = z.object({ id: workId, input: z.object({ eventId, version,
    reportHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict();
const draftSchema = z.object({ version: z.literal(1), scope: z.string().min(1).max(500), selectedId: workId.nullable(),
    note: z.string().max(2000), pending: pendingEvent.nullable(), pendingAcceptance: pendingAcceptance.nullable() }).strict();

export type AssistantWorkDraft = { version: 1; scope: string; selectedId: string | null; note: string;
    pending: { id: string; input: AssistantWorkItemEventInput } | null;
    pendingAcceptance: { id: string; input: AssistantWorkAcceptanceInput } | null };

const recoveryError = () => new Error('No pudimos recuperar el intento W01 de esta pestaña. Conservá la pestaña y pedí ayuda antes de repetir el envío.');

/** Identidad de almacenamiento, nunca autoridad API ni copia del JWT. */
export function assistantWorkDraftScope(token: string, accessScope: string): string {
    const { tenantId, userId } = inventoryAdjustmentScope(token);
    return JSON.stringify([tenantId, userId, accessScope]);
}

export function readAssistantWorkDraft(scope: string): AssistantWorkDraft | null {
    try {
        const raw = sessionStorage.getItem(keyFor(scope));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.scope !== scope) throw new Error();
        return draftSchema.parse(parsed) as AssistantWorkDraft;
    } catch { throw recoveryError(); }
}

/** Persiste la identidad antes de POST; si falla, el POST debe abortarse. */
export function saveAssistantWorkDraft(draft: AssistantWorkDraft): void {
    try {
        draftSchema.parse(draft);
        readAssistantWorkDraft(draft.scope);
        const serialized = JSON.stringify(draft);
        sessionStorage.setItem(keyFor(draft.scope), serialized);
        if (sessionStorage.getItem(keyFor(draft.scope)) !== serialized) throw new Error();
    } catch { throw recoveryError(); }
}
