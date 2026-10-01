// @vitest-environment jsdom
import React from 'react';
import { SWRConfig } from 'swr';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import AdminOverviewPanel, { readAdminOverview } from '../components/admin/AdminOverviewPanel';
import SuperAdmin from '../components/SuperAdmin';
import { clearEditorialDraft, rememberEditorialNote } from '../components/admin/knowledge/editorialDraftMemory';
import { readActivationSession } from '../hooks/useActivationJourney';
import { syntheticAdminOverview } from './fixtures/adminOverview';

// SWR, el launcher/editor editorial y su memoria son reales. Sólo se simulan
// respuestas HTTP sintéticas y las herramientas ajenas a esta regresión.
vi.mock('../components/admin/AssistantBudgetRequests', () => ({ AssistantBudgetRequests: () => null }));
vi.mock('../components/admin/AssistantPilotActivation', () => ({ AssistantPilotActivation: () => null }));
vi.mock('../components/whatsapp/CommerceSupport', () => ({ default: () => null }));
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
const failed = (status: number) => ({ ok: false, status, json: async () => ({ error: 'Sintético' }) });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const detail = { id: 'synthetic-release', formatVersion: 1, status: 'DRAFT', manifestHash: 'a'.repeat(64),
    createdAt: '2026-09-19T12:00:00Z', createdById: 'editor', reviewedById: null, reviewedAt: null, publishedAt: null,
    retiredAt: null, documentsCount: 1, active: false, notes: [], nextNotesCursor: null,
    documents: [{ reference: { documentId: 'synthetic-help', version: '1', sectionId: 'main', contentHash: 'b'.repeat(64) }, status: 'DRAFT',
        payload: { title: 'Ayuda sintética', section: 'Procedimiento', body: 'Contenido sintético revisable.', keywords: 'ayuda', roles: ['OWNER'], requiredCapabilities: ['help'], channels: ['WEB_INTERNAL'] } }] };
let metrics: (url: string) => unknown;
let fetchMock: ReturnType<typeof vi.fn>;
function session(token = 'synthetic-A', role = 'SUPER_ADMIN', id = 'admin-A') {
    localStorage.setItem('nortex_token', token);
    localStorage.setItem('nortex_user', JSON.stringify({ id, role, tenant: { id: 'synthetic-tenant' } }));
    localStorage.setItem('nortex_tenant_id', 'synthetic-tenant');
}
function mount(node: React.ReactNode = <SuperAdmin />) {
    return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>{node}</SWRConfig>);
}
beforeEach(() => {
    session(); metrics = () => ok(syntheticAdminOverview);
    fetchMock = vi.fn(async (url: string) => {
        if (url.startsWith('/api/admin/metrics')) return metrics(url);
        if (url.endsWith('/capabilities')) return ok({ canEdit: true, actor: { id: 'editor', name: 'Editor sintético' } });
        if (url.includes('/releases?')) return ok({ releases: [detail], nextCursor: null });
        if (url.endsWith('/releases/synthetic-release')) return ok(detail);
        throw new Error(`Ruta inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); clearEditorialDraft(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function writeNote() {
    await screen.findByText('Cuentas para revisar');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ayuda de NortexGPT' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir synthetic-release' }));
    const note = await screen.findByLabelText('Tu observación');
    fireEvent.change(note, { target: { value: 'Borrador sintético que no se debe perder.' } });
}
const changeSession = (token: string, role: string, id: string) => act(() => {
    session(token, role, id); window.dispatchEvent(new StorageEvent('storage', { key: 'nortex_token' }));
});
const cleared = () => { expect(localStorage.getItem('nortex_token')).toBeNull(); expect(localStorage.getItem('nortex_user')).toBeNull(); expect(localStorage.getItem('nortex_tenant_id')).toBeNull(); };

describe('regresiones admin con SWR real y cambios sin recargar', () => {
    it('descarta la respuesta global de A si otra pestaña pasa a OWNER B mientras fetch está pendiente', async () => {
        const late = deferred<ReturnType<typeof ok>>(); metrics = () => late.promise;
        mount(); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        changeSession('synthetic-B', 'OWNER', 'owner-B');
        await act(async () => { late.resolve(ok(syntheticAdminOverview)); });
        expect(screen.queryByText('Comercio sintético')).not.toBeInTheDocument();
        expect(screen.getByText('Acceso reservado a administradores de Nortex')).toBeInTheDocument();
    });
    it('retira datos y herramientas ya cacheados al cambiar principal sin recargar', async () => {
        mount(); await screen.findByText('Comercio sintético');
        changeSession('synthetic-B', 'OWNER', 'owner-B');
        expect(screen.queryByText('Comercio sintético')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Revisar ayuda de NortexGPT' })).not.toBeInTheDocument();
    });
    it('también retira cache si cambia el principal/rol con el mismo token', async () => {
        mount(); await screen.findByText('Comercio sintético');
        changeSession('synthetic-A', 'OWNER', 'owner-B');
        expect(screen.queryByText('Comercio sintético')).not.toBeInTheDocument();
    });
    it('dos administradores comparten URL pero no cache; una respuesta atrasada de A no sustituye la de B', async () => {
        const late = deferred<ReturnType<typeof ok>>(); const dataB = structuredClone(syntheticAdminOverview);
        dataB.tenants[0].businessName = 'Corte sintético de B';
        fetchMock.mockImplementation((url: string, options: RequestInit) => {
            expect(url).toContain('/api/admin/metrics');
            return (options.headers as Record<string, string>).Authorization === 'Bearer synthetic-A' ? late.promise : ok(dataB);
        });
        mount(<AdminOverviewPanel />); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        changeSession('synthetic-B', 'SUPER_ADMIN', 'admin-B');
        await screen.findByText('Corte sintético de B');
        await act(async () => { late.resolve(ok(syntheticAdminOverview)); });
        expect(screen.getByText('Corte sintético de B')).toBeInTheDocument();
        expect(screen.queryByText('Comercio sintético')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('no acepta JSON que termina de leerse después de cambiar la sesión', async () => {
        const body = deferred<unknown>(); fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => body.promise });
        const request = readAdminOverview('/api/admin/metrics');
        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        session('synthetic-B', 'OWNER', 'owner-B'); body.resolve(syntheticAdminOverview);
        await expect(request).rejects.toThrow(/sesión cambió/i);
    });
    it('carga inicial503 conserva LOGOUT y permite limpiar la sesión', async () => {
        metrics = () => failed(503); mount(); await screen.findByText(/esto no significa cero/);
        fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' })); cleared();
    });
    it('403 inicial permite reautenticar limpiando el token y usuario rechazados', async () => {
        metrics = () => failed(403); mount(); await screen.findByText('Acceso reservado a administradores de Nortex');
        fireEvent.click(screen.getByRole('button', { name: 'Ir al inicio de sesión' })); cleared();
    });
    it('revocación por403 retira datos y deja una salida accesible', async () => {
        mount(); await screen.findByText('Comercio sintético'); metrics = () => failed(403);
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
        await screen.findByText('Acceso reservado a administradores de Nortex');
        expect(screen.queryByText('Comercio sintético')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' })); cleared();
    });
    it('otra respuesta ya en vuelo no restaura los datos tras revocación', async () => {
        const late = deferred<ReturnType<typeof ok>>();
        const data = structuredClone(syntheticAdminOverview); data.pagination.pages = 2;
        metrics = () => ok(data); mount(); await screen.findByText('Comercio sintético');
        // La recarga tarda; otra clave de filtro responde403.
        metrics = url => url.includes('kind=DEMO') ? failed(403) : late.promise;
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
        fireEvent.change(screen.getByLabelText('Clasificación'), { target: { value: 'DEMO' } });
        await screen.findByText('Acceso reservado a administradores de Nortex');
        await act(async () => { late.resolve(ok(data)); });
        expect(screen.queryByText('Comercio sintético')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Revisar ayuda de NortexGPT' })).not.toBeInTheDocument();
    });
    it('escribir → filtro sin cache mantiene editor y guardia; LOGOUT no descarta el borrador', async () => {
        mount(); await writeNote(); const next = deferred<ReturnType<typeof ok>>(); metrics = () => next.promise;
        fireEvent.click(screen.getByRole('button', { name: /Sin primera venta/ }));
        await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('focus=NO_SALE'))).toBe(true));
        expect(screen.getByLabelText('Tu observación')).toHaveValue('Borrador sintético que no se debe perder.');
        fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' }));
        expect(localStorage.getItem('nortex_token')).toBe('synthetic-A');
        expect(screen.getByText(/Guardá o descartá tu trabajo editorial antes de salir/)).toBeInTheDocument();
        await act(async () => { next.resolve(ok(syntheticAdminOverview)); });
        fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' }));
        expect(localStorage.getItem('nortex_token')).toBe('synthetic-A');
        expect(screen.getByLabelText('Tu observación')).toHaveValue('Borrador sintético que no se debe perder.');
    });
    it('un borrador retenido fuera del editor también bloquea salida hasta descarte explícito', async () => {
        mount(); await screen.findByText('Cuentas para revisar');
        rememberEditorialNote(readActivationSession().key, 'synthetic-release', 'Retenido sintético', null);
        fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' }));
        expect(localStorage.getItem('nortex_token')).toBe('synthetic-A');
        fireEvent.click(screen.getByRole('button', { name: 'Descartar trabajo editorial y cerrar sesión' })); cleared();
    });
    it('escribir → página2 pendiente conserva editor y aviso beforeunload', async () => {
        const data = structuredClone(syntheticAdminOverview); data.pagination.pages = 2;
        metrics = () => ok(data); mount(); await writeNote();
        const next = deferred<ReturnType<typeof ok>>(); metrics = () => next.promise;
        fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
        await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('page=2'))).toBe(true));
        expect(screen.getByLabelText('Tu observación')).toHaveValue('Borrador sintético que no se debe perder.');
        const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
        expect(leaving.defaultPrevented).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' })); expect(localStorage.getItem('nortex_token')).toBe('synthetic-A');
        await act(async () => { next.resolve(ok({ ...data, pagination: { ...data.pagination, page: 2 } })); });
    });
    it('revocación con borrador mantiene la guardia aunque se retire la herramienta privada', async () => {
        mount(); await writeNote(); metrics = () => failed(403);
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
        await screen.findByText('Acceso reservado a administradores de Nortex');
        fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' }));
        expect(localStorage.getItem('nortex_token')).toBe('synthetic-A');
        fireEvent.click(screen.getByRole('button', { name: 'Descartar trabajo editorial y cerrar sesión' })); cleared();
    });
});
