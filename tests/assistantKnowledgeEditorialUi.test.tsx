// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import KnowledgeEditorialPanel from '../components/admin/knowledge/KnowledgeEditorialPanel';
import { clearEditorialDraft } from '../components/admin/knowledge/editorialDraftMemory';
import type { KnowledgeEditorialReleaseDetail } from '../shared/assistantKnowledgeEditorial';

const prefix = '/api/admin/assistant-knowledge';
const hash = 'a'.repeat(64);
const base: KnowledgeEditorialReleaseDetail = {
    id: 'prueba-oficial', formatVersion: 1, status: 'DRAFT', manifestHash: hash, createdAt: '2026-09-19T12:00:00Z', createdById: 'editor',
    reviewedById: null, reviewedAt: null, publishedAt: null, retiredAt: null, documentsCount: 1, active: false,
    documents: [{ reference: { documentId: 'ayuda-prueba', version: '1', sectionId: 'main', contentHash: 'b'.repeat(64) }, status: 'DRAFT',
        payload: { title: 'Ayuda de prueba', section: 'Procedimiento', body: 'Texto exacto revisable <b>sin HTML ejecutado</b>.', keywords: 'ayuda', roles: ['OWNER'], requiredCapabilities: ['help'], channels: ['WEB_INTERNAL'] } }],
    notes: [], nextNotesCursor: null,
};
const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
const fail = (status: number) => ({ ok: false, status, json: async () => ({ error: 'No disponible' }) });
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
let detail: KnowledgeEditorialReleaseDetail;
let intercept: (path: string, options: RequestInit) => unknown;
let fetchMock: ReturnType<typeof vi.fn>;
function server(path: string, options: RequestInit = {}) {
    if (path === '/capabilities') return ok({ canEdit: true, actor: { id: 'editor', name: 'Revisor de prueba' } });
    if (path.startsWith('/releases?')) return ok({ releases: [detail], nextCursor: null });
    if (path === `/releases/${detail.id}`) return ok(structuredClone(detail));
    if (path === '/legacy') return ok({ documents: detail.documents.map(document => ({ ...document, status: 'LEGACY' })) });
    if (path.endsWith('/review')) { detail = { ...detail, status: 'REVIEWED', reviewedById: 'editor', reviewedAt: '2026-09-19T12:01:00Z' }; return ok({ id: detail.id, status: detail.status, manifestHash: hash }); }
    if (path.endsWith('/publish')) { detail = { ...detail, status: 'PUBLISHED', active: true }; return ok({ id: detail.id, status: detail.status, manifestHash: hash }); }
    if (path.endsWith('/notes') && options.method === 'POST') { const data = JSON.parse(String(options.body)); detail.notes.push({ id: data.requestId, body: data.body, authorId: 'editor', createdAt: '2026-09-19' }); return ok(detail.notes.at(-1)); }
    if (path === '/versions/retire') { detail.documents[0].status = 'RETIRED'; return ok({ status: 'RETIRED' }); }
    if (path === '/releases' && options.method === 'POST') return ok({ id: detail.id, status: 'DRAFT', manifestHash: hash });
    throw new Error(`Ruta inesperada ${path}`);
}
beforeEach(() => {
    localStorage.setItem('nortex_token', 'synthetic-editorial-session'); localStorage.setItem('nortex_tenant_id', 'qa');
    detail = structuredClone(base); intercept = () => undefined;
    fetchMock = vi.fn(async (url: string, options: RequestInit = {}) => {
        const path = url.slice(prefix.length); const result = intercept(path, options);
        return result === undefined ? server(path, options) : result;
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); clearEditorialDraft(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
async function openRelease() {
    fireEvent.click(await screen.findByRole('button', { name: `Abrir ${base.id}` }));
    await screen.findByText(base.documents[0].payload.body);
}
async function fileReady() {
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar borrador' }));
    const source = { id: base.id, formatVersion: 1, documents: base.documents.map(doc => ({ documentId: doc.reference.documentId, version: doc.reference.version, sectionId: doc.reference.sectionId, payload: doc.payload })) };
    const contents = JSON.stringify(source);
    fireEvent.change(screen.getByLabelText('Archivo editorial JSON'), { target: { files: [{ name: 'ayuda.json', size: contents.length, text: async () => contents }] } });
    await screen.findByText(`Publicación: ${base.id} · 1 pasajes`);
}

describe('editor de ayuda autenticado', () => {
    it('consulta capacidades, usa bearer/no-store y sólo lee; cuerpo HTML queda texto', async () => {
        render(<KnowledgeEditorialPanel />); await openRelease();
        expect(posts()).toHaveLength(0);
        expect(screen.getByText(base.documents[0].payload.body).querySelector('b')).toBeNull();
        expect(screen.getByText('OWNER')).toBeVisible(); expect(screen.getByText('WEB_INTERNAL')).toBeVisible();
        for (const [, options] of fetchMock.mock.calls) { expect(options.cache).toBe('no-store'); expect(options.headers.Authorization).toBe('Bearer synthetic-editorial-session'); }
        expect(fetchMock.mock.calls[0][0]).toBe(`${prefix}/capabilities`);
    });
    it('un usuario rechazado por servidor no ve contenido editorial ni controles de publicación', async () => {
        intercept = path => path === '/capabilities' ? fail(403) : undefined;
        render(<KnowledgeEditorialPanel />);
        expect(await screen.findByRole('alert')).toHaveTextContent('La sesión ya no permite');
        expect(fetchMock).toHaveBeenCalledTimes(1); expect(screen.queryByText(base.documents[0].payload.body)).not.toBeInTheDocument();
    });
    it('revisión y publicación requieren confirmaciones diferentes del mismo hash', async () => {
        render(<KnowledgeEditorialPanel />); await openRelease();
        expect(screen.getByRole('button', { name: 'Registrar revisión humana' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Confirmar publicación de ayuda' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText(/Leí todos los pasajes/));
        fireEvent.click(screen.getByRole('button', { name: 'Registrar revisión humana' }));
        const publish = await screen.findByRole('button', { name: 'Confirmar publicación de ayuda' }); expect(publish).toBeDisabled();
        expect(posts()).toHaveLength(1); expect(JSON.parse(String(posts()[0][1].body))).toEqual({ manifestHash: hash, acknowledged: true });
        fireEvent.click(screen.getByLabelText(/Confirmo publicar este manifiesto/)); fireEvent.click(publish);
        await screen.findByText('Publicación confirmada por el servidor.');
        expect(posts()).toHaveLength(2); expect(JSON.parse(String(posts()[1][1].body))).toEqual({ manifestHash: hash, acknowledged: true });
    });
    it('actualizar exige leer y confirmar otra vez; una observación tampoco aprueba', async () => {
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.click(screen.getByLabelText(/Leí todos los pasajes/));
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar publicación' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar revisión humana' })).toBeDisabled());
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Necesita aclarar la recepción.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar observación sin aprobar' }));
        await screen.findByText('Observación guardada. No aprueba ni publica el contenido.');
        expect(posts()).toHaveLength(1); expect(posts()[0][0]).toContain('/notes'); expect(detail.status).toBe('DRAFT');
    });
    it('conserva texto sin guardar al actualizar y bloquea navegación destructiva hasta descarte', async () => {
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Mi revisión aún no está terminada.' } });
        expect(screen.getByRole('button', { name: 'Preparar borrador' })).toBeDisabled();
        expect(screen.getByLabelText('Estado de publicaciones')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar publicación' }));
        await screen.findByText(base.documents[0].payload.body);
        expect(screen.getByLabelText('Tu observación')).toHaveValue('Mi revisión aún no está terminada.');
        fireEvent.click(screen.getByRole('button', { name: 'Descartar observación sin guardar' }));
        expect(screen.getByLabelText('Estado de publicaciones')).toBeEnabled(); expect(posts()).toHaveLength(0);
    });
    it('avisa a SuperAdmin mientras hay una observación sin enviar y libera la salida al descartarla', async () => {
        const onPendingWorkChange = vi.fn();
        render(<KnowledgeEditorialPanel onPendingWorkChange={onPendingWorkChange} />); await openRelease();
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Necesito revisar esta fuente.' } });
        await waitFor(() => expect(onPendingWorkChange).toHaveBeenLastCalledWith(true));
        fireEvent.click(screen.getByRole('button', { name: 'Descartar observación sin guardar' }));
        await waitFor(() => expect(onPendingWorkChange).toHaveBeenLastCalledWith(false));
        expect(posts()).toHaveLength(0);
    });
    it('recupera una observación al volver a SuperAdmin sin enviarla ni compartirla con otra sesión', async () => {
        const first = render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Revisar evidencia antes de publicar.' } });
        first.unmount();
        render(<KnowledgeEditorialPanel />);
        await screen.findByText(base.documents[0].payload.body);
        expect(screen.getByLabelText('Tu observación')).toHaveValue('Revisar evidencia antes de publicar.');
        expect(posts()).toHaveLength(0);
        cleanup();
        localStorage.setItem('nortex_token', 'another-synthetic-session');
        render(<KnowledgeEditorialPanel />);
        await openRelease();
        expect(screen.getByLabelText('Tu observación')).toHaveValue('');
        expect(posts()).toHaveLength(0);
    });
    it('reintenta observación incierta con el mismo UUID, hash y contenido, sin autosend', async () => {
        let failures = 1;
        intercept = (path, options) => { if (path.endsWith('/notes') && options.method === 'POST' && failures--) return Promise.reject(new Error('Lost')); };
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Esta es mi observación conservada.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar observación sin aprobar' }));
        const retry = await screen.findByRole('button', { name: 'Reintentar la misma observación' });
        expect(posts()).toHaveLength(1); expect(screen.getByLabelText('Tu observación')).toHaveValue('Esta es mi observación conservada.');
        expect(screen.getByLabelText('Tu observación')).toBeDisabled(); expect(screen.getByLabelText('Estado de publicaciones')).toBeDisabled();
        const first = String(posts()[0][1].body); fireEvent.click(retry);
        await screen.findByText('Observación guardada. No aprueba ni publica el contenido.');
        expect(posts()).toHaveLength(2); expect(String(posts()[1][1].body)).toBe(first);
    });
    it('conserva UUID y hash tras salir de la ruta con respuesta incierta', async () => {
        let failures = 1;
        intercept = (path, options) => { if (path.endsWith('/notes') && options.method === 'POST' && failures--) return Promise.reject(new Error('Lost')); };
        const firstView = render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Observación pendiente tras cambiar de ruta.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar observación sin aprobar' }));
        await screen.findByRole('button', { name: 'Reintentar la misma observación' });
        const firstBody = String(posts()[0][1].body);
        firstView.unmount();
        render(<KnowledgeEditorialPanel />);
        await screen.findByText(base.documents[0].payload.body);
        expect(screen.getByLabelText('Tu observación')).toHaveValue('Observación pendiente tras cambiar de ruta.');
        expect(posts()).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar la misma observación' }));
        await screen.findByText('Observación guardada. No aprueba ni publica el contenido.');
        expect(posts()).toHaveLength(2);
        expect(String(posts()[1][1].body)).toBe(firstBody);
    });
    it('POST nota confirmado y refresco fallido no inventa reintento sin identidad', async () => {
        let saved = false;
        intercept = (path, options) => {
            if (path.endsWith('/notes') && options.method === 'POST') { saved = true; return ok({ id: 'saved' }); }
            if (saved && path === `/releases/${base.id}`) return fail(503);
        };
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Observación recibida por servidor.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar observación sin aprobar' }));
        await screen.findByText(/La observación quedó guardada/);
        expect(screen.queryByRole('button', { name: 'Reintentar la misma observación' })).not.toBeInTheDocument(); expect(posts()).toHaveLength(1);
    });
    it('publicación con respuesta perdida sólo se recupera por GET y no vuelve a publicar sola', async () => {
        detail.status = 'REVIEWED'; detail.reviewedById = 'editor'; detail.reviewedAt = '2026-09-19';
        intercept = (path, options) => { if (path.endsWith('/publish') && options.method === 'POST') { detail.status = 'PUBLISHED'; detail.active = true; return Promise.reject(new Error('lost')); } };
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.click(screen.getByLabelText(/Confirmo publicar este manifiesto/)); fireEvent.click(screen.getByRole('button', { name: 'Confirmar publicación de ayuda' }));
        const recover = await screen.findByRole('button', { name: 'Comprobar estado de la publicación' });
        expect(posts()).toHaveLength(1); fireEvent.click(recover);
        await screen.findByText(/Estado: PUBLISHED/); expect(posts()).toHaveLength(1);
    });
    it('revocación oculta cuerpo, notas y borradores, sin recuperación por otra respuesta en vuelo', async () => {
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.change(screen.getByLabelText('Tu observación'), { target: { value: 'Observación privada del editor.' } });
        intercept = path => path === `/releases/${base.id}` ? fail(403) : undefined;
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar publicación' }));
        await screen.findByText('La sesión ya no permite editar la ayuda. Volvé a iniciar sesión.');
        expect(screen.queryByText(base.documents[0].payload.body)).not.toBeInTheDocument(); expect(screen.queryByLabelText('Tu observación')).not.toBeInTheDocument();
    });
    it('cambiar cuenta descarta resultado tardío de la cuenta anterior', async () => {
        let finish!: (value: unknown) => void;
        intercept = path => path === `/releases/${base.id}` ? new Promise(resolve => { finish = resolve; }) : undefined;
        render(<KnowledgeEditorialPanel />);
        fireEvent.click(await screen.findByRole('button', { name: `Abrir ${base.id}` }));
        await waitFor(() => expect(finish).toBeTypeOf('function'));
        intercept = path => path === '/capabilities' ? fail(403) : undefined;
        act(() => { localStorage.setItem('nortex_token', 'another-synthetic-session'); window.dispatchEvent(new Event('storage')); });
        await act(async () => { finish(ok(base)); });
        expect(screen.queryByText(base.documents[0].payload.body)).not.toBeInTheDocument(); expect(screen.queryByText('Sesión editorial: Revisor de prueba')).not.toBeInTheDocument();
    });
    it('importa sólo tras confirmación y funciona dentro de StrictMode, sin revisión automática', async () => {
        render(<StrictMode><KnowledgeEditorialPanel /></StrictMode>); await fileReady();
        expect(posts()).toHaveLength(0); expect(screen.getByRole('button', { name: 'Preparar borrador sin publicar' })).toBeDisabled();
        fireEvent.click(screen.getByLabelText(/Confirmo preparar este contenido/)); fireEvent.click(screen.getByRole('button', { name: 'Preparar borrador sin publicar' }));
        await screen.findByText(base.documents[0].payload.body);
        expect(posts()).toHaveLength(1); expect(posts()[0][0]).toBe(`${prefix}/releases`); expect(detail.reviewedById).toBeNull();
    });
    it('rechaza archivo grande o estructura privada/desconocida sin enviarlo', async () => {
        render(<KnowledgeEditorialPanel />);
        fireEvent.click(await screen.findByRole('button', { name: 'Preparar borrador' }));
        const input = screen.getByLabelText('Archivo editorial JSON');
        fireEvent.change(input, { target: { files: [{ name: 'grande.json', size: 512001, text: async () => '{}' }] } });
        await screen.findByText('Elegí un único archivo JSON de hasta 512 KB.');
        fireEvent.change(input, { target: { files: [{ name: 'factura.json', size: 30, text: async () => '{"supplier":"privado"}' }] } });
        await screen.findByText(/El archivo no cumple el formato editorial/); expect(posts()).toHaveLength(0);
    });
    it('una importación incierta no sustituye el archivo por otra publicación con igual id', async () => {
        intercept = (path, options) => path === '/releases' && options.method === 'POST' ? Promise.reject(new Error('lost')) : undefined;
        render(<KnowledgeEditorialPanel />); await fileReady();
        fireEvent.click(screen.getByLabelText(/Confirmo preparar este contenido/)); fireEvent.click(screen.getByRole('button', { name: 'Preparar borrador sin publicar' }));
        const check = await screen.findByRole('button', { name: 'Comprobar borrador' });
        detail.documents[0].payload.body = 'Otro contenido que creó otro editor.';
        fireEvent.click(check);
        await screen.findByText(/Esa identidad ya contiene otros pasajes/);
        expect(screen.getByText(`Publicación: ${base.id} · 1 pasajes`)).toBeVisible();
        expect(screen.queryByText('Otro contenido que creó otro editor.')).not.toBeInTheDocument(); expect(posts()).toHaveLength(1);
    });
    it('recupera archivo pendiente tras salir de la ruta sin confirmar ni enviar por sí solo', async () => {
        const firstView = render(<KnowledgeEditorialPanel />); await fileReady();
        firstView.unmount();
        render(<KnowledgeEditorialPanel />);
        await screen.findByText(`Publicación: ${base.id} · 1 pasajes`);
        expect(screen.getByRole('button', { name: 'Preparar borrador sin publicar' })).toBeDisabled();
        expect(posts()).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: 'Descartar archivo sin importar' }));
        cleanup();
        render(<KnowledgeEditorialPanel />);
        await screen.findByRole('button', { name: 'Preparar borrador' });
        expect(screen.queryByText(`Publicación: ${base.id} · 1 pasajes`)).not.toBeInTheDocument();
    });
    it('una importación incierta conserva su archivo y exige comprobar por GET al volver', async () => {
        intercept = (path, options) => path === '/releases' && options.method === 'POST' ? Promise.reject(new Error('lost')) : undefined;
        const firstView = render(<KnowledgeEditorialPanel />); await fileReady();
        fireEvent.click(screen.getByLabelText(/Confirmo preparar este contenido/)); fireEvent.click(screen.getByRole('button', { name: 'Preparar borrador sin publicar' }));
        await screen.findByRole('button', { name: 'Comprobar borrador' });
        firstView.unmount();
        render(<KnowledgeEditorialPanel />);
        await screen.findByRole('button', { name: 'Comprobar borrador' });
        expect(screen.getByText(`Publicación: ${base.id} · 1 pasajes`)).toBeVisible();
        expect(posts()).toHaveLength(1);
    });
    it('un fallo temporal de capacidades permite reintentar lectura sin recargar la aplicación', async () => {
        let attempts = 0;
        intercept = path => path === '/capabilities' && attempts++ === 0 ? fail(503) : undefined;
        render(<KnowledgeEditorialPanel />);
        fireEvent.click(await screen.findByRole('button', { name: 'Reintentar acceso editorial' }));
        await screen.findByRole('button', { name: `Abrir ${base.id}` }); expect(posts()).toHaveLength(0);
    });
    it('conserva motivo de retirada de una publicación hasta descarte explícito', async () => {
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.click(screen.getByRole('button', { name: 'Retirar esta versión' }));
        fireEvent.change(screen.getByLabelText('Motivo de retirada'), { target: { value: 'Necesito verificar primero.' } });
        expect(screen.getByLabelText('Estado de publicaciones')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Actualizar publicación' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Retirar esta versión' }));
        expect(screen.queryByLabelText('Motivo de retirada')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Estado de publicaciones')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Retirar esta versión' }));
        expect(screen.getByLabelText('Motivo de retirada')).toHaveValue('Necesito verificar primero.');
        fireEvent.click(screen.getByRole('button', { name: 'Descartar motivo sin retirar' }));
        expect(screen.getByLabelText('Estado de publicaciones')).toBeEnabled(); expect(posts()).toHaveLength(0);
    });
    it('conserva motivo LEGACY y solicita aviso de recarga mientras haya trabajo', async () => {
        render(<KnowledgeEditorialPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Consultar ayuda heredada' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Retirar esta versión' }));
        fireEvent.change(screen.getByLabelText('Motivo de retirada'), { target: { value: 'Pendiente de comparar la versión.' } });
        expect(screen.getByRole('button', { name: 'Preparar borrador' })).toBeDisabled();
        const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Descartar motivo sin retirar' }));
        expect(screen.getByRole('button', { name: 'Preparar borrador' })).toBeEnabled();
    });
    it('recupera motivo de retirada de una publicación al volver sin confirmar la acción', async () => {
        const firstView = render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.click(screen.getByRole('button', { name: 'Retirar esta versión' }));
        fireEvent.change(screen.getByLabelText('Motivo de retirada'), { target: { value: 'Revisar procedencia antes de retirar.' } });
        firstView.unmount();
        render(<KnowledgeEditorialPanel />);
        await screen.findByText(base.documents[0].payload.body);
        expect(screen.getByLabelText('Motivo de retirada')).toHaveValue('Revisar procedencia antes de retirar.');
        expect(screen.getByRole('button', { name: 'Confirmar retirada' })).toBeDisabled();
        expect(posts()).toHaveLength(0);
    });
    it('retira una versión exacta sólo con motivo y confirmación explícitos', async () => {
        render(<KnowledgeEditorialPanel />); await openRelease();
        fireEvent.click(screen.getByRole('button', { name: 'Retirar esta versión' }));
        expect(screen.getByRole('button', { name: 'Confirmar retirada' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Motivo de retirada'), { target: { value: 'Procedimiento reemplazado y desactualizado.' } });
        fireEvent.click(screen.getByLabelText('Confirmo retirar únicamente esta versión y sección.')); fireEvent.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
        await screen.findByText('Versión retirada. No se reactivará mediante un manifiesto anterior.');
        expect(posts()).toHaveLength(1); expect(JSON.parse(String(posts()[0][1].body))).toEqual({ reference: base.documents[0].reference, reason: 'Procedimiento reemplazado y desactualizado.', acknowledged: true });
    });
    it('ayuda LEGACY se identifica como heredada y no concede revisión', async () => {
        render(<KnowledgeEditorialPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Consultar ayuda heredada' }));
        await screen.findByText('Texto heredado: no acredita una revisión humana nueva.');
        expect(screen.queryByRole('button', { name: 'Registrar revisión humana' })).not.toBeInTheDocument(); expect(posts()).toHaveLength(0);
    });
    it('distingue listado vacío de fallo de lectura', async () => {
        intercept = path => path.startsWith('/releases?') ? ok({ releases: [], nextCursor: null }) : undefined;
        render(<KnowledgeEditorialPanel />); await screen.findByText('No hay publicaciones en este estado.');
        intercept = path => path.startsWith('/releases?') ? fail(503) : undefined;
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar listado' }));
        await screen.findByRole('alert'); expect(screen.queryByText('No hay publicaciones en este estado.')).not.toBeInTheDocument();
    });
});
