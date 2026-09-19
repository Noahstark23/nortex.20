// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as queueDb from '../lib/db';
import { syncBodySchema } from '../backend/routes/syncPayload';
import { usePosOfflineQueue, type PosOfflineIdentity } from '../hooks/usePosOfflineQueue';

const a = { tenantId: 'tenant-a', userId: 'cashier-a' };
const b = { tenantId: 'tenant-b', userId: 'cashier-b' };
const sale = (offlineId: string, identity = a, storeCreditAmount = '0.00') => ({
    offlineId, ...identity, shiftId: `shift-${identity.userId}`, employeeId: null,
    customerName: 'Cliente QA', customerId: null, paymentMethod: 'CASH', total: 25,
    globalDiscount: 0, fiscalRegimeVersion: 2, createdAt: '2026-09-04T14:00:00.000Z',
    items: [{ id: 'product-a', name: 'Arroz', quantity: '1', price: 25, costPrice: 10 }],
    storeCreditAmount,
});
const response = (payload: unknown, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
}) as Response;
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};
const setSession = (identity = a, token = `token-${identity.userId}`) => {
    localStorage.setItem('nortex_token', token);
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: identity.tenantId }));
    localStorage.setItem('nortex_user', JSON.stringify({ id: identity.userId, role: 'CASHIER' }));
};
const mount = (identity: PosOfflineIdentity | null = a, onSynced = vi.fn(async () => {})) => ({
    ...renderHook(({ principal }) => usePosOfflineQueue(principal, onSynced), { initialProps: { principal: identity } }),
    onSynced,
});

beforeEach(async () => {
    localStorage.clear();
    setSession();
    await queueDb.db.offline_sales.clear();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => response({ results: [] })));
});
afterEach(async () => {
    cleanup();
    await queueDb.db.offline_sales.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('cola offline del POS, un único motor por montaje', () => {
    it('monta y refresca solo el scope actual; abrirlo o recibir online no envía ventas', async () => {
        await queueDb.saveSaleOffline(sale('mine'));
        await queueDb.saveSaleOffline(sale('other-tenant', b));
        await queueDb.saveSaleOffline(sale('other-user', { ...a, userId: 'other-user' }));
        const { result } = mount();
        expect(result.current.pendingCount).toBeNull();
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            await result.current.refresh();
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(result.current.reconciliationCount).toBe(0);
    });

    it('doble llamada comparte promesa antes de leer/enviar, confirma una vez y notifica solo después', async () => {
        await queueDb.saveSaleOffline(sale('one'));
        const server = deferred<Response>();
        vi.mocked(fetch).mockReturnValue(server.promise);
        const event = vi.fn();
        window.addEventListener('nortex:data-changed', event);
        const { result, onSynced } = mount();
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => { first = result.current.sync(); second = result.current.sync(); });
        expect(first).toBe(second);
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        expect(result.current.syncing).toBe(true);
        expect(onSynced).not.toHaveBeenCalled();
        expect(event).not.toHaveBeenCalled();
        const [, options] = vi.mocked(fetch).mock.calls[0];
        const payload = JSON.parse(String(options?.body));
        expect(syncBodySchema.safeParse(payload).success).toBe(true);
        expect(payload.sales[0]).toMatchObject({ offlineId: 'one', ...a, fiscalRegimeVersion: 2 });
        expect(payload.sales[0]).not.toHaveProperty('syncState');
        expect(options?.headers).toMatchObject({ Authorization: 'Bearer token-cashier-a' });
        await act(async () => { server.resolve(response({ results: [{ offlineId: 'one', status: 'created' }] })); await first; });
        expect(result.current.pendingCount).toBe(0);
        expect(result.current.syncing).toBe(false);
        expect(onSynced).toHaveBeenCalledOnce();
        expect(event).toHaveBeenCalledOnce();
        expect(await queueDb.getPendingSales(a)).toEqual([]);
        window.removeEventListener('nortex:data-changed', event);
    });

    it('borra created/skipped y conserva fallos y revisión; un mapper rechazado no bloquea las ventas válidas', async () => {
        for (const id of ['created', 'skipped', 'failed', 'review', 'previous-review']) await queueDb.saveSaleOffline(sale(id));
        await queueDb.saveSaleOffline(sale('store-credit', a, '5.00'));
        await queueDb.recordOfflineSyncResults([{ offlineId: 'previous-review', status: 'reconciliation_required' }]);
        vi.mocked(fetch).mockResolvedValue(response({ results: [
            { offlineId: 'created', status: 'created' }, { offlineId: 'skipped', status: 'skipped' },
            { offlineId: 'failed', status: 'failed', code: 'SYNC_INTERNAL_ERROR', error: 'Reintentar' },
            { offlineId: 'review', status: 'reconciliation_required', code: 'RECONCILIATION_REQUIRED' },
        ] }));
        const { result, onSynced } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow('siguen guardadas'); });
        const posted = syncBodySchema.parse(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)));
        expect(posted.sales.map(row => row.offlineId).sort()).toEqual(['created', 'failed', 'review', 'skipped']);
        const pending = await queueDb.getPendingSales(a);
        expect(pending.map(row => row.offlineId).sort()).toEqual(['failed', 'previous-review', 'review', 'store-credit']);
        expect(pending.find(row => row.offlineId === 'store-credit')).toMatchObject({
            syncState: 'RECONCILIATION_REQUIRED', syncCode: 'OFFLINE_STORE_CREDIT_REVIEW_REQUIRED', storeCreditAmount: '5.00',
        });
        expect(pending.find(row => row.offlineId === 'failed')?.syncState).toBe('FAILED');
        expect(result.current.pendingCount).toBe(4);
        expect(result.current.reconciliationCount).toBe(3);
        expect(onSynced).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('si todo requiere revisión no hay solicitud ni confirmación de negocio', async () => {
        await queueDb.saveSaleOffline(sale('credit', a, '2.00'));
        const { result, onSynced } = mount();
        await act(async () => { await result.current.sync(); await result.current.sync(); });
        expect(fetch).not.toHaveBeenCalled();
        expect(onSynced).not.toHaveBeenCalled();
        expect(result.current.pendingCount).toBe(1);
        expect(result.current.reconciliationCount).toBe(1);
    });

    it.each([404, 403, 500])('HTTP %s conserva filas y permite un nuevo intento manual', async status => {
        await queueDb.saveSaleOffline(sale('one'));
        vi.mocked(fetch).mockResolvedValue(response({}, status));
        const { result, onSynced } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow(`HTTP ${status}`); });
        expect(result.current.pendingCount).toBe(1);
        expect(result.current.syncing).toBe(false);
        expect(onSynced).not.toHaveBeenCalled();
        expect((await queueDb.getPendingSales(a))[0].offlineId).toBe('one');
    });

    it('sin conexión no hace fetch ni elimina filas', async () => {
        await queueDb.saveSaleOffline(sale('one'));
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const { result } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow('Sin conexión'); });
        expect(fetch).not.toHaveBeenCalled();
        expect(result.current.pendingCount).toBe(1);
        expect(result.current.syncing).toBe(false);
    });

    it('tras respuesta perdida reintenta el mismo DTO/offlineId; skipped confirma sin reconstruir la venta', async () => {
        await queueDb.saveSaleOffline(sale('same-attempt'));
        vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(response({ results: [{ offlineId: 'same-attempt', status: 'skipped' }] }));
        const { result, onSynced } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow(); });
        expect(result.current.pendingCount).toBe(1);
        await act(async () => { await result.current.sync(); });
        expect(vi.mocked(fetch).mock.calls[0][1]?.body).toEqual(vi.mocked(fetch).mock.calls[1][1]?.body);
        expect(onSynced).toHaveBeenCalledOnce();
        expect(result.current.pendingCount).toBe(0);
    });

    it.each([
        { results: [{ offlineId: 'one', status: 'unknown' }] },
        { results: [{ offlineId: 'one' }] },
        { results: [] },
        { results: [{ offlineId: 'one', status: 'created' }, { offlineId: 'one', status: 'failed' }] },
        { results: [{ offlineId: 'one', status: 'created', code: 42 }] },
    ])('resultado desconocido, ausente o ambiguo no borra su evidencia: %j', async payload => {
        await queueDb.saveSaleOffline(sale('one'));
        vi.mocked(fetch).mockResolvedValue(response(payload));
        const { result, onSynced } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow('incompleta'); });
        expect(result.current.pendingCount).toBe(1);
        expect(onSynced).not.toHaveBeenCalled();
        expect((await queueDb.getPendingSales(a))[0].offlineId).toBe('one');
    });

    it('ignora IDs fuera del batch incluso si existen en el mismo IndexedDB de otro tenant', async () => {
        await queueDb.saveSaleOffline(sale('one'));
        await queueDb.saveSaleOffline(sale('foreign', b));
        vi.mocked(fetch).mockResolvedValue(response({ results: [{ offlineId: 'foreign', status: 'created' }] }));
        const { result, onSynced } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow('incompleta'); });
        expect((await queueDb.getPendingSales()).map(row => row.offlineId).sort()).toEqual(['foreign', 'one']);
        expect(onSynced).not.toHaveBeenCalled();
    });

    it.each([null, {}, { results: null }])('rechaza envoltorio malformado %j sin descartar ventas', async payload => {
        await queueDb.saveSaleOffline(sale('one'));
        vi.mocked(fetch).mockResolvedValue(response(payload));
        const { result } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow('no es válida'); });
        expect(result.current.pendingCount).toBe(1);
    });

    it('JSON ilegible conserva la cola y termina syncing', async () => {
        await queueDb.saveSaleOffline(sale('one'));
        vi.mocked(fetch).mockResolvedValue({ ...response({}), json: async () => { throw new SyntaxError('invalid JSON'); } });
        const { result } = mount();
        await act(async () => { await expect(result.current.sync()).rejects.toThrow('no es válida'); });
        expect(result.current.pendingCount).toBe(1);
        expect(result.current.syncing).toBe(false);
    });

    it.each([b, { ...a, userId: 'cashier-new' }])('cambiar tenant o usuario descarta una respuesta tardía: %j', async nextIdentity => {
        await queueDb.saveSaleOffline(sale('old'));
        await queueDb.saveSaleOffline(sale('new', nextIdentity));
        const server = deferred<Response>();
        vi.mocked(fetch).mockReturnValue(server.promise);
        const { result, rerender, onSynced } = mount();
        let pending!: Promise<void>;
        act(() => { pending = result.current.sync(); });
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        act(() => {
            setSession(nextIdentity);
            window.dispatchEvent(new StorageEvent('storage', { key: 'nortex_token' }));
            rerender({ principal: nextIdentity });
        });
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        await act(async () => { server.resolve(response({ results: [{ offlineId: 'old', status: 'created' }] })); await pending; });
        expect(result.current.pendingCount).toBe(1);
        expect(result.current.syncing).toBe(false);
        expect(onSynced).not.toHaveBeenCalled();
        expect((await queueDb.getPendingSales()).map(row => row.offlineId).sort()).toEqual(['new', 'old']);
        expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer token-cashier-a' });
    });

    it('un token cambiado sin evento también impide aplicar la respuesta vieja', async () => {
        await queueDb.saveSaleOffline(sale('old'));
        const server = deferred<Response>();
        vi.mocked(fetch).mockReturnValue(server.promise);
        const { result, onSynced } = mount();
        let pending!: Promise<void>;
        act(() => { pending = result.current.sync(); });
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        localStorage.setItem('nortex_token', 'replacement-token');
        await act(async () => { server.resolve(response({ results: [{ offlineId: 'old', status: 'created' }] })); await pending; });
        expect((await queueDb.getPendingSales(a))[0].offlineId).toBe('old');
        expect(onSynced).not.toHaveBeenCalled();
    });

    it('una lectura local tardía tampoco repinta los contadores de otro tenant', async () => {
        await queueDb.saveSaleOffline(sale('old-1'));
        await queueDb.saveSaleOffline(sale('old-2'));
        await queueDb.saveSaleOffline(sale('new', b));
        await queueDb.recordOfflineSyncResults([{ offlineId: 'old-1', status: 'reconciliation_required' }]);
        const oldRows = await queueDb.getPendingSales(a);
        const oldRead = deferred<queueDb.OfflineSale[]>();
        vi.spyOn(queueDb, 'getPendingSales').mockImplementationOnce(() => oldRead.promise);
        const { result, rerender } = mount();
        expect(result.current.pendingCount).toBeNull();
        act(() => {
            setSession(b);
            window.dispatchEvent(new StorageEvent('storage', { key: 'nortex_token' }));
            rerender({ principal: b });
        });
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        await act(async () => { oldRead.resolve(oldRows); });
        expect(result.current.pendingCount).toBe(1);
        expect(result.current.reconciliationCount).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('desmontar no permite que una respuesta tardía borre ni notifique', async () => {
        await queueDb.saveSaleOffline(sale('old'));
        const server = deferred<Response>();
        vi.mocked(fetch).mockReturnValue(server.promise);
        const { result, unmount, onSynced } = mount();
        let pending!: Promise<void>;
        act(() => { pending = result.current.sync(); });
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        unmount();
        server.resolve(response({ results: [{ offlineId: 'old', status: 'created' }] }));
        await pending;
        expect((await queueDb.getPendingSales(a))[0].offlineId).toBe('old');
        expect(onSynced).not.toHaveBeenCalled();
    });

    it('sin identidad no lee datos de otra sesión ni ofrece sincronización', async () => {
        await queueDb.saveSaleOffline(sale('one'));
        const { result } = mount(null);
        await act(async () => { await result.current.refresh(); await expect(result.current.sync()).rejects.toThrow('Iniciá sesión'); });
        expect(result.current.pendingCount).toBeNull();
        expect(result.current.reconciliationCount).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('procesa más de 200 filas en lotes secuenciales sin repetir IDs', async () => {
        await queueDb.db.offline_sales.bulkPut(Array.from({ length: 201 }, (_, index) => ({
            ...sale(`sale-${String(index).padStart(3, '0')}`), synced: 0 as const, syncState: 'PENDING' as const,
        })));
        vi.mocked(fetch).mockImplementation(async (_url, options) => {
            const batch = syncBodySchema.parse(JSON.parse(String(options?.body)));
            return response({ results: batch.sales.map(row => ({ offlineId: row.offlineId, status: 'created' })) });
        });
        const { result } = mount();
        await act(async () => { await result.current.sync(); });
        const batches = vi.mocked(fetch).mock.calls.map(([, options]) => syncBodySchema.parse(JSON.parse(String(options?.body))).sales);
        expect(batches.map(batch => batch.length)).toEqual([200, 1]);
        expect(new Set(batches.flat().map(row => row.offlineId)).size).toBe(201);
        expect(result.current.pendingCount).toBe(0);
    });
});
