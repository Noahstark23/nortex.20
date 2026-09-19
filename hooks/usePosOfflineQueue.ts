import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPendingSales, getPendingSale, markSalesSynced, recordOfflineSyncResults, type OfflineSyncResult } from '../lib/db';
import { resolverIdentidadPersistencia } from '../utils/cartPersistence';
import { OfflineSyncTransportError, toOfflineSyncTransport, type OfflineSyncTransportSale } from '../utils/offlineSyncTransport';
import { buildOfflineEvidence, describeOfflineSale, parseOfflineServerEvidence,
    type OfflineRecoveryController, type OfflineRecoveryRow, type OfflineServerEvidence } from '../components/notifications/offlineRecovery';

export interface PosOfflineIdentity { tenantId: string; userId: string }
interface QueueSession extends PosOfflineIdentity { token: string; stamp: string; key: string }
interface Counts { key: string; pending: number | null; reconciliation: number; rows: OfflineRecoveryRow[] | null }

function readSessionStamp(): string {
    const identity = resolverIdentidadPersistencia(
        localStorage.getItem('nortex_tenant_data'), localStorage.getItem('nortex_user'),
    );
    return JSON.stringify([localStorage.getItem('nortex_token'), identity?.tenantId, identity?.userId]);
}

function subscribeSession(onChange: () => void) {
    window.addEventListener('storage', onChange);
    window.addEventListener('nortex:data-changed', onChange);
    return () => {
        window.removeEventListener('storage', onChange);
        window.removeEventListener('nortex:data-changed', onChange);
    };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const KNOWN_STATUSES = new Set(['created', 'skipped', 'failed', 'reconciliation_required']);

function readBatchResults(payload: unknown, batch: readonly OfflineSyncTransportSale[]) {
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
        throw new Error('La respuesta de sincronización no es válida. Las ventas siguen pendientes.');
    }
    const batchIds = new Set(batch.map(sale => sale.offlineId));
    const seen = new Set<string>();
    const ambiguous = new Set<string>();
    const results: OfflineSyncResult[] = [];
    let incomplete = false;
    for (const candidate of payload.results) {
        if (!isRecord(candidate) || typeof candidate.offlineId !== 'string' || !batchIds.has(candidate.offlineId)) {
            incomplete = true;
            continue;
        }
        const offlineId = candidate.offlineId;
        if (seen.has(offlineId)) { ambiguous.add(offlineId); incomplete = true; continue; }
        seen.add(offlineId);
        if (typeof candidate.status !== 'string' || !KNOWN_STATUSES.has(candidate.status)
            || (candidate.code !== undefined && typeof candidate.code !== 'string')
            || (candidate.error !== undefined && typeof candidate.error !== 'string')) {
            incomplete = true;
            continue;
        }
        results.push({ offlineId, status: candidate.status as OfflineSyncResult['status'],
            ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
            ...(typeof candidate.error === 'string' ? { error: candidate.error } : {}),
        });
    }
    const accepted = results.filter(result => !ambiguous.has(result.offlineId));
    return { results: accepted, incomplete: incomplete || accepted.length !== batchIds.size };
}

/** Un solo motor por POS: montar/refrescar solo lee; online y el botón llaman sync. */
export function usePosOfflineQueue(identity: PosOfflineIdentity | null, onSynced: () => Promise<void>) {
    const stamp = useSyncExternalStore(subscribeSession, readSessionStamp, () => '[]');
    const [token, tenantId, userId] = JSON.parse(stamp) as [string | null, string | null, string | null];
    const session: QueueSession | null = token && identity?.tenantId === tenantId && identity?.userId === userId
        ? { ...identity, token, stamp, key: JSON.stringify([identity.tenantId, identity.userId, token]) }
        : null;
    const sessionRef = useRef(session);
    sessionRef.current = session;
    const callbackRef = useRef(onSynced);
    callbackRef.current = onSynced;
    const mounted = useRef(false);
    const readGeneration = useRef(0);
    const flight = useRef<{ key: string; promise: Promise<void> } | null>(null);
    const [counts, setCounts] = useState<Counts>({ key: '', pending: null, reconciliation: 0, rows: null });
    const [syncingKey, setSyncingKey] = useState<string | null>(null);
    const evidenceRef = useRef<{ key: string; observations: Map<string, OfflineServerEvidence> }>({ key: '', observations: new Map() });
    const publicSession = useRef({ key: '', sequence: 0 });
    if (publicSession.current.key !== (session?.key ?? '')) {
        publicSession.current = { key: session?.key ?? '', sequence: publicSession.current.sequence + 1 };
        evidenceRef.current = { key: session?.key ?? '', observations: new Map() };
    }

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; readGeneration.current += 1; };
    }, []);

    const isCurrent = useCallback((captured: QueueSession) => mounted.current
        && sessionRef.current?.key === captured.key && readSessionStamp() === captured.stamp, []);

    const refreshSession = useCallback(async (captured: QueueSession) => {
        const generation = ++readGeneration.current;
        try {
            const rows = await getPendingSales(captured);
            if (isCurrent(captured) && generation === readGeneration.current) {
                const descriptions = rows.map(describeOfflineSale).sort((a, b) =>
                    (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.offlineId.localeCompare(b.offlineId));
                setCounts({ key: captured.key, pending: rows.length,
                    rows: descriptions, reconciliation: descriptions.filter(sale => sale.status === 'review').length });
            }
        } catch {
            if (isCurrent(captured) && generation === readGeneration.current) {
                setCounts({ key: captured.key, pending: null, reconciliation: 0, rows: null });
            }
            throw new Error('No se pudo leer la cola de este dispositivo. No se enviaron ventas desde esta lectura.');
        }
    }, [isCurrent]);

    const refresh = useCallback(async () => {
        const captured = sessionRef.current;
        if (captured) await refreshSession(captured);
    }, [refreshSession]);

    useEffect(() => { void refresh().catch(() => undefined); }, [session?.key, refresh]);

    const sync = useCallback((onlyOfflineId?: string): Promise<void> => {
        const captured = sessionRef.current;
        if (!captured || !isCurrent(captured)) return Promise.reject(new Error('Iniciá sesión con quien registró estas ventas para sincronizarlas.'));
        if (flight.current?.key === captured.key) return flight.current.promise;
        // La promesa se registra antes del primer await/lectura de IndexedDB.
        const promise = Promise.resolve().then(async () => {
            let unknownIds: string[] = [];
            try {
                if (!navigator.onLine) throw new Error('Sin conexión. Las ventas permanecen guardadas en este dispositivo.');
                if (!isCurrent(captured)) return;
                const allPending = await getPendingSales(captured);
                if (!isCurrent(captured)) return;
                const pending = onlyOfflineId === undefined ? allPending : allPending.filter(row => row.offlineId === onlyOfflineId);
                if (onlyOfflineId !== undefined && (!pending.length || !describeOfflineSale(pending[0]).canRetry)) {
                    throw new Error('Esta referencia no admite reintento automático. Revisá su evidencia sin volver a registrarla.');
                }
                const transport: OfflineSyncTransportSale[] = [];
                const review: OfflineSyncResult[] = [];
                for (const sale of pending) {
                    if (sale.syncState === 'RECONCILIATION_REQUIRED') continue;
                    if (sale.syncState !== undefined && !['PENDING', 'FAILED'].includes(sale.syncState)) {
                        review.push({ offlineId: sale.offlineId, status: 'reconciliation_required', code: 'OFFLINE_STATE_UNKNOWN',
                            error: 'El estado local no es reconocible; conservá la evidencia para revisión.' });
                        continue;
                    }
                    try { transport.push(toOfflineSyncTransport(sale)); } catch (error) {
                        if (!(error instanceof OfflineSyncTransportError)) throw error;
                        review.push({ offlineId: sale.offlineId, status: 'reconciliation_required', code: error.code, error: error.message });
                    }
                }
                if (review.length) {
                    await recordOfflineSyncResults(review, captured);
                    if (!isCurrent(captured)) return;
                }
                // El contrato HTTP admite hasta 200 ventas; cada fila entra una vez.
                for (let offset = 0; offset < transport.length; offset += 200) {
                    if (!isCurrent(captured)) return;
                    const batch = transport.slice(offset, offset + 200);
                    unknownIds = batch.map(row => row.offlineId);
                    const response = await fetch('/api/sales/sync', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${captured.token}` },
                        body: JSON.stringify({ sales: batch }),
                    });
                    if (!isCurrent(captured)) return;
                    if (!response.ok) throw new Error(`No se pudo sincronizar (HTTP ${response.status}). Las ventas pendientes siguen guardadas.`);
                    let payload: unknown;
                    try { payload = await response.json(); } catch {
                        throw new Error('La respuesta de sincronización no es válida. Las ventas siguen pendientes.');
                    }
                    if (!isCurrent(captured)) return;
                    const { results, incomplete } = readBatchResults(payload, batch);
                    unknownIds = unknownIds.filter(id => !results.some(result => result.offlineId === id));
                    await recordOfflineSyncResults(results, captured);
                    if (!isCurrent(captured)) return;
                    const confirmedIds = results.filter(result => result.status === 'created' || result.status === 'skipped')
                        .map(result => result.offlineId);
                    if (confirmedIds.length) {
                        await markSalesSynced(confirmedIds, captured);
                        if (!isCurrent(captured)) return;
                        window.dispatchEvent(new CustomEvent('nortex:data-changed'));
                        if (!isCurrent(captured)) return;
                        await callbackRef.current();
                        if (!isCurrent(captured)) return;
                    }
                    if (incomplete) throw new Error('La respuesta de sincronización está incompleta. Las ventas sin confirmación siguen pendientes.');
                    if (results.some(result => result.status === 'failed')) throw new Error('Algunas ventas no pudieron confirmarse y siguen guardadas.');
                }
            } catch (error) {
                if (isCurrent(captured)) {
                    if (unknownIds.length) await recordOfflineSyncResults(unknownIds.map(offlineId => ({
                        offlineId, status: 'failed', code: 'SYNC_CONFIRMATION_UNKNOWN',
                        error: 'No recibimos una confirmación verificable. Consultá la referencia o reintentá el mismo registro; no lo ingresés de nuevo.',
                    })), captured);
                    throw error instanceof Error ? error : new Error('No se pudo sincronizar. Las ventas siguen guardadas.');
                }
            } finally {
                if (isCurrent(captured)) await refreshSession(captured).catch(() => undefined);
                if (flight.current?.promise === promise) {
                    flight.current = null;
                    if (mounted.current) setSyncingKey(null);
                }
            }
        });
        flight.current = { key: captured.key, promise };
        setSyncingKey(captured.key);
        return promise;
    }, [isCurrent, refreshSession]);

    const readForAction = useCallback(async (offlineId: string) => {
        const captured = sessionRef.current;
        if (!captured || !isCurrent(captured)) throw new Error('Iniciá sesión con quien guardó la venta para revisar su evidencia.');
        const sale = await getPendingSale(offlineId, captured);
        if (!isCurrent(captured)) throw new Error('La sesión cambió; volvé a abrir los avisos.');
        if (!sale) throw new Error('La referencia ya no está pendiente o no pertenece a esta sesión. Actualizá los avisos.');
        return { captured, sale };
    }, [isCurrent]);

    const inspect = useCallback(async (offlineId: string) => {
        const { captured } = await readForAction(offlineId);
        if (!navigator.onLine) throw new Error('Necesitás conexión para consultar el servidor. La copia local se conserva.');
        const response = await fetch(`/api/sales/offline-evidence/${encodeURIComponent(offlineId)}`, {
            headers: { Authorization: `Bearer ${captured.token}` }, cache: 'no-store',
        });
        if (!isCurrent(captured)) throw new Error('La sesión cambió; no se mostrará la respuesta anterior.');
        if (!response.ok) throw new Error('No se pudo consultar esta referencia. Eso no significa que la venta no exista.');
        const evidence = parseOfflineServerEvidence(await response.json(), offlineId);
        if (!isCurrent(captured)) throw new Error('La sesión cambió; no se mostrará la respuesta anterior.');
        evidenceRef.current.observations.set(offlineId, evidence);
        return evidence;
    }, [isCurrent, readForAction]);

    const exportEvidence = useCallback(async (offlineId: string) => {
        const { captured, sale } = await readForAction(offlineId);
        const observation = evidenceRef.current.key === captured.key ? evidenceRef.current.observations.get(offlineId) ?? null : null;
        return { filename: `nortex-venta-${offlineId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}.json`,
            content: JSON.stringify(buildOfflineEvidence(sale, observation), null, 2) };
    }, [readForAction]);

    const currentCounts = counts.key === session?.key ? counts : null;
    const recovery: OfflineRecoveryController = {
        sessionKey: `offline-session-${publicSession.current.sequence}`,
        status: session && currentCounts?.rows ? 'ready' : 'unavailable', rows: currentCounts?.rows ?? null,
        retry: sync, inspect, exportEvidence,
    };
    return { pendingCount: currentCounts?.pending ?? null, reconciliationCount: currentCounts?.reconciliation ?? 0,
        syncing: session !== null && syncingKey === session.key, sync, refresh, recovery };
}
