import type { AssistantCatalogItem, AssistantRequest } from './useNortexAssistant';

export type AssistantCatalogResult = { items: AssistantCatalogItem[]; warnings: string[] };
export type AssistantCatalogRead = { promise: Promise<AssistantCatalogResult>; release: () => void };
type Entry = {
    path: string; consumers: number; state: 'queued' | 'active' | 'settled';
    promise: Promise<AssistantCatalogResult>;
    resolve: (result: AssistantCatalogResult) => void; reject: (error: unknown) => void;
};
type Queue = { active: number; queued: Entry[]; pending: Map<string, Entry> };
const MAX_ACTIVE_READS = 4;
// Sólo solicitudes pendientes: ni resultados terminados ni datos entre sesiones.
const pendingCatalog = new WeakMap<AssistantRequest, Queue>();

function parseResult(value: { items: AssistantCatalogItem[]; warnings?: string[] }): AssistantCatalogResult {
    if (!Array.isArray(value?.items) || value.items.some(item => !item || typeof item.id !== 'string' || typeof item.label !== 'string')) {
        throw new Error('CATALOG_RESPONSE_INVALID');
    }
    return { items: value.items, warnings: Array.isArray(value.warnings) ? value.warnings.filter(warning => typeof warning === 'string') : [] };
}

function drain(request: AssistantRequest, queue: Queue) {
    while (queue.active < MAX_ACTIVE_READS && queue.queued.length) {
        const entry = queue.queued.shift()!;
        entry.state = 'active'; queue.active++;
        const finish = (settle: () => void) => {
            entry.state = 'settled'; queue.active--; queue.pending.delete(entry.path);
            settle(); drain(request, queue);
        };
        // La microtarea también convierte una excepción síncrona en un fallo recuperable.
        void Promise.resolve().then(() => request<{ items: AssistantCatalogItem[]; warnings?: string[] }>(entry.path))
            .then(parseResult).then(
                result => finish(() => entry.resolve(result)),
                error => finish(() => entry.reject(error)),
            );
    }
}

/** Lectura GET compartida por función autenticada y ruta; cada observador libera su lease. */
export function readAssistantCatalog(request: AssistantRequest, path: string): AssistantCatalogRead {
    let queue = pendingCatalog.get(request);
    if (!queue) { queue = { active: 0, queued: [], pending: new Map() }; pendingCatalog.set(request, queue); }
    let entry = queue.pending.get(path);
    if (!entry) {
        let resolve!: Entry['resolve']; let reject!: Entry['reject'];
        const promise = new Promise<AssistantCatalogResult>((yes, no) => { resolve = yes; reject = no; });
        entry = { path, consumers: 0, state: 'queued', promise, resolve, reject };
        queue.pending.set(path, entry); queue.queued.push(entry);
    }
    const current = entry; const ownedQueue = queue;
    current.consumers++; drain(request, ownedQueue);
    let released = false;
    return { promise: current.promise, release: () => {
        if (released) return;
        released = true; current.consumers--;
        if (current.state !== 'queued' || current.consumers !== 0) return;
        ownedQueue.queued.splice(ownedQueue.queued.indexOf(current), 1);
        ownedQueue.pending.delete(current.path); current.state = 'settled';
        current.reject(new Error('CATALOG_READ_CANCELLED'));
    } };
}
