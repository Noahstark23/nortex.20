// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getPendingSales, saveSaleOffline, recordOfflineSyncResults, type OfflineSale } from '../lib/db';
import { usePosOfflineQueue } from '../hooks/usePosOfflineQueue';

const a = { tenantId: 'recovery-a', userId: 'cashier-a' };
const b = { tenantId: 'recovery-b', userId: 'cashier-b' };
const captured = '2026-09-01T23:45:00.000Z';
const fixture = (offlineId: string, identity = a): Omit<OfflineSale, 'synced'> => ({
    offlineId, ...identity, shiftId: 'shift-a', employeeId: null, customerName: 'Nombre privado',
    customerId: 'private-customer', paymentMethod: 'CASH', total: 12.50, globalDiscount: 0,
    fiscalRegimeVersion: 1, createdAt: captured,
    items: [{ id: 'product-a', name: 'Nombre producto privado', quantity: '1.25', price: 10, costPrice: 4 }],
});
const setSession = (identity = a) => {
    localStorage.setItem('nortex_token', `token-${identity.userId}`);
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: identity.tenantId }));
    localStorage.setItem('nortex_user', JSON.stringify({ id: identity.userId, role: 'CASHIER' }));
};
const response = (payload: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;
beforeEach(async () => {
    await db.offline_sales.clear(); localStorage.clear(); setSession();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => response({ results: [] })));
});
afterEach(async () => { cleanup(); await db.offline_sales.clear(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('recuperación operativa de ventas offline', () => {
    it('expone cada venta propia con referencia, fecha original, importe y motivo sin reenviar', async () => {
        await saveSaleOffline(fixture('pending-a'));
        await saveSaleOffline(fixture('review-a'));
        await saveSaleOffline(fixture('other-tenant', b));
        await saveSaleOffline(fixture('other-user', { ...a, userId: 'other-user' }));
        await recordOfflineSyncResults([{ offlineId: 'review-a', status: 'reconciliation_required', code: 'OFFLINE_PAYLOAD_MISMATCH', error: 'La referencia tiene otro contenido' }]);
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(2));
        const recovery = result.current.recovery;
        expect(recovery?.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ offlineId: 'pending-a', createdAt: captured, total: '12.50', canRetry: true }),
            expect.objectContaining({ offlineId: 'review-a', status: 'review', code: 'OFFLINE_PAYLOAD_MISMATCH', canRetry: false }),
        ]));
        expect(recovery.rows).toHaveLength(2);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('respuesta perdida → consulta → reintento conserva payload e ID y reconoce una sola venta', async () => {
        await saveSaleOffline(fixture('lost-response'));
        const remote = new Map<string, string>();
        let creates = 0; const sent: string[] = [];
        vi.mocked(fetch).mockImplementation(async (url, options) => {
            if (String(url).includes('/offline-evidence/')) return response({ offlineId: 'lost-response', checkedAt: '2026-09-04T17:00:00Z', status: 'recorded', record: {
                saleId: 'server-sale-1', createdAt: captured, total: '12.50', paymentMethod: 'CASH', status: 'COMPLETED', invoiceNumber: 1, invoiceSeries: 'A', hasReplayFingerprint: true,
            } });
            const payload = JSON.parse(String(options?.body)); const row = payload.sales[0];
            sent.push(JSON.stringify(row));
            if (!remote.has(row.offlineId)) {
                remote.set(row.offlineId, JSON.stringify(row)); creates += 1;
                return response({ interrupted: true });
            }
            expect(remote.get(row.offlineId)).toBe(JSON.stringify(row));
            return response({ results: [{ offlineId: row.offlineId, status: 'skipped', saleId: 'server-sale-1' }] });
        });
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        await act(async () => { await expect(result.current.recovery.retry('lost-response')).rejects.toThrow(); });
        expect(result.current.recovery.rows?.[0]).toMatchObject({ status: 'failed', code: 'SYNC_CONFIRMATION_UNKNOWN', createdAt: captured });
        const beforeLookup = await getPendingSales(a);
        await act(async () => { expect(await result.current.recovery.inspect('lost-response')).toMatchObject({ status: 'recorded', record: { saleId: 'server-sale-1' } }); });
        expect(await getPendingSales(a)).toEqual(beforeLookup);
        await act(async () => { await result.current.recovery.retry('lost-response'); });
        expect(sent).toHaveLength(2); expect(sent[0]).toBe(sent[1]); expect(creates).toBe(1);
        expect(JSON.parse(sent[0]).createdAt).toBe(captured);
        expect(await getPendingSales(a)).toEqual([]);
        expect(result.current.pendingCount).toBe(0);
    });

    it('el reintento selectivo usa el único motor y deja intactas las otras referencias', async () => {
        await saveSaleOffline(fixture('one')); await saveSaleOffline(fixture('two'));
        vi.mocked(fetch).mockResolvedValue(response({ results: [{ offlineId: 'two', status: 'created' }] }));
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(2));
        let first!: Promise<void>; let second!: Promise<void>;
        act(() => { first = result.current.recovery.retry('two'); second = result.current.sync(); });
        expect(first).toBe(second);
        await act(async () => { await first; });
        expect(fetch).toHaveBeenCalledOnce();
        expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).sales.map((row: any) => row.offlineId)).toEqual(['two']);
        expect((await getPendingSales(a)).map(row => row.offlineId)).toEqual(['one']);
    });

    it('no reintenta un conflicto aunque la consulta encuentre el ID y permite exportar evidencia mínima offline', async () => {
        const original = { ...fixture('conflict'), items: [{ ...fixture('conflict').items[0], measurement: { source: 'SCALE_LABEL' as const,
            clientEventId: 'event-a', capturedAt: captured, rawCode: 'private-raw-code', profileVersionId: 'profile-a' } }] };
        await saveSaleOffline(original);
        await recordOfflineSyncResults([{ offlineId: 'conflict', status: 'reconciliation_required', code: 'OFFLINE_PAYLOAD_MISMATCH', error: 'Distinto contenido' }]);
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        await expect(result.current.recovery.retry('conflict')).rejects.toThrow('no admite reintento');
        expect(fetch).not.toHaveBeenCalled();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        await expect(result.current.recovery.inspect('conflict')).rejects.toThrow('conexión');
        const file = await result.current.recovery.exportEvidence('conflict'); const evidence = JSON.parse(file.content);
        expect(evidence).toMatchObject({ actor: { ...a, shiftId: 'shift-a' }, sale: { offlineId: 'conflict', createdAt: captured, status: 'review' }, lines: [{ productId: 'product-a', quantity: '1.25', unitPrice: 10, measurementCapturedAt: captured }] });
        for (const privateValue of ['Nombre privado', 'private-customer', 'Nombre producto privado', 'private-raw-code', 'token-cashier-a', 'costPrice']) expect(file.content).not.toContain(privateValue);
        expect(file.filename).toBe('nortex-venta-conflict.json');
        expect((await getPendingSales(a))[0]).toMatchObject(original);
    });

    it.each([{ createdAt: '' }, { shiftId: null }, { fiscalRegimeVersion: undefined }, { items: null }])('datos incompletos permanecen en revisión: %j', async broken => {
        await db.offline_sales.put({ ...fixture('incomplete'), ...broken, synced: 0 } as any);
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        expect(result.current.recovery.rows?.[0]).toMatchObject({ status: 'review', canRetry: false, code: 'OFFLINE_SNAPSHOT_INCOMPLETE' });
        await act(async () => { await result.current.sync(); });
        expect(fetch).not.toHaveBeenCalled();
        expect((await getPendingSales(a))[0]).toMatchObject({ ...broken, syncState: 'RECONCILIATION_REQUIRED' });
    });

    it('el motor general tampoco reenvía una fila con estado local desconocido', async () => {
        await db.offline_sales.put({ ...fixture('unknown-state'), synced: 0, syncState: 'UNRECOGNIZED' } as any);
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        expect(result.current.recovery.rows?.[0]).toMatchObject({ status: 'review', canRetry: false });
        await act(async () => { await result.current.sync(); });
        expect(fetch).not.toHaveBeenCalled();
        expect((await getPendingSales(a))[0]).toMatchObject({ syncState: 'RECONCILIATION_REQUIRED', syncCode: 'OFFLINE_STATE_UNKNOWN' });
    });

    it('no permite consultar, exportar ni reenviar el ID de otra identidad', async () => {
        await saveSaleOffline(fixture('other', b));
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(0));
        await expect(result.current.recovery.inspect('other')).rejects.toThrow('no pertenece');
        await expect(result.current.recovery.exportEvidence('other')).rejects.toThrow('no pertenece');
        await act(async () => { await expect(result.current.recovery.retry('other')).rejects.toThrow('no admite'); });
        expect(fetch).not.toHaveBeenCalled();
        expect((await getPendingSales(b))).toHaveLength(1);
    });

    it('una consulta tardía de otra sesión no filtra evidencia ni permite exportarla', async () => {
        await saveSaleOffline(fixture('old-a')); await saveSaleOffline(fixture('new-b', b));
        let finish!: (value: Response) => void;
        vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const { result, rerender } = renderHook(({ identity }) => usePosOfflineQueue(identity, async () => {}), { initialProps: { identity: a } });
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        const oldKey = result.current.recovery.sessionKey;
        const inspected = result.current.recovery.inspect('old-a').catch(error => error);
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        act(() => { setSession(b); window.dispatchEvent(new Event('storage')); rerender({ identity: b }); });
        await waitFor(() => expect(result.current.recovery.rows?.[0].offlineId).toBe('new-b'));
        expect(result.current.recovery.sessionKey).not.toBe(oldKey);
        finish(response({ offlineId: 'old-a', checkedAt: '2026-09-04T17:00:00Z', status: 'not_found' }));
        expect(await inspected).toBeInstanceOf(Error);
        await expect(result.current.recovery.exportEvidence('old-a')).rejects.toThrow('no pertenece');
        expect(await getPendingSales(a)).toHaveLength(1);
        expect(await getPendingSales(b)).toHaveLength(1);
    });

    it.each([
        { offlineId: 'wrong', checkedAt: '2026-09-04T17:00:00Z', status: 'not_found' },
        { offlineId: 'one', checkedAt: 'invalid', status: 'not_found' },
        { offlineId: 'one', checkedAt: '2026-09-04T17:00:00Z', status: 'recorded', record: {} },
        { offlineId: 'one', checkedAt: '2026-09-04T17:00:00Z', status: 'unknown' },
    ])('una consulta inválida no confirma ni elimina: %j', async payload => {
        await saveSaleOffline(fixture('one')); vi.mocked(fetch).mockResolvedValue(response(payload));
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        const before = await getPendingSales(a);
        await expect(result.current.recovery.inspect('one')).rejects.toThrow();
        expect(await getPendingSales(a)).toEqual(before);
    });

    it('la exportación elimina campos extra de la respuesta remota y conserva una consulta no concluyente', async () => {
        await saveSaleOffline(fixture('one'));
        vi.mocked(fetch).mockResolvedValue(response({ offlineId: 'one', checkedAt: '2026-09-04T17:00:00Z', status: 'not_found', token: 'remote-secret' }));
        const { result } = renderHook(() => usePosOfflineQueue(a, async () => {}));
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        await result.current.recovery.inspect('one');
        const file = await result.current.recovery.exportEvidence('one');
        expect(file.content).not.toContain('remote-secret');
        expect(JSON.parse(file.content).serverObservation).toEqual({ offlineId: 'one', checkedAt: '2026-09-04T17:00:00Z', status: 'not_found' });
        expect(await getPendingSales(a)).toHaveLength(1);
    });
});
