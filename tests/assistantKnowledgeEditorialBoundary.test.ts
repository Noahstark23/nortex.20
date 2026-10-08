import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ verify: vi.fn(), user: vi.fn(), tenant: vi.fn() }));
const editorial = vi.hoisted(() => ({ capabilities: vi.fn(), releases: vi.fn(), release: vi.fn(), notes: vi.fn(), legacy: vi.fn(), addNote: vi.fn() }));
const decisions = vi.hoisted(() => ({ stage: vi.fn(), review: vi.fn(), publish: vi.fn(), retire: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: auth.verify }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: auth.user }, tenant: { findUnique: auth.tenant } } }));
vi.mock('../backend/services/assistant/knowledge/editorial.js', async importOriginal => ({
    ...await importOriginal<typeof import('../backend/services/assistant/knowledge/editorial.js')>(),
    getKnowledgeEditorialCapabilities: editorial.capabilities,
    listKnowledgeEditorialReleases: editorial.releases,
    getKnowledgeEditorialRelease: editorial.release,
    listKnowledgeEditorialNotes: editorial.notes,
    listKnowledgeEditorialLegacy: editorial.legacy,
}));
vi.mock('../backend/services/assistant/knowledge/editorNotes.js', async importOriginal => ({
    ...await importOriginal<typeof import('../backend/services/assistant/knowledge/editorNotes.js')>(), addKnowledgeEditorialNote: editorial.addNote,
}));
vi.mock('../backend/services/assistant/knowledge/lifecycle.js', async importOriginal => ({
    ...await importOriginal<typeof import('../backend/services/assistant/knowledge/lifecycle.js')>(),
    stageAssistantKnowledgeRelease: decisions.stage,
    reviewAssistantKnowledgeRelease: decisions.review,
    publishAssistantKnowledgeRelease: decisions.publish,
    retireAssistantKnowledgeVersion: decisions.retire,
}));
import { createAssistantKnowledgeAdminRouter } from '../backend/routes/assistantKnowledgeAdmin';
import { AssistantAccessError } from '../backend/services/assistant/access';

const principal = { tenantId: 'editor-tenant', userId: 'editor-user', role: 'SUPER_ADMIN' };
const hash = 'a'.repeat(64);
const reference = { documentId: 'synthetic-guide', version: 'test.1', sectionId: 'start', contentHash: 'b'.repeat(64) };
const note = { requestId: '88e60d27-706b-44f8-8d96-25d4a20edb98', manifestHash: hash, body: 'El procedimiento necesita una explicación más clara.' };
const payload = { title: 'Ayuda sintética', section: 'Inicio', body: 'Texto exclusivo de prueba.', keywords: 'ayuda sintética', roles: ['OWNER'], requiredCapabilities: ['help'], channels: ['WEB_INTERNAL'] };
const stage = { id: 'release-test', formatVersion: 1, documents: [{ documentId: reference.documentId, version: reference.version, sectionId: reference.sectionId, payload }] };
const sensitive = 'PRIVATE-EDITORIAL-READ-RESULT';
type Method = 'get' | 'post';
const routes = [
    ['get', '/capabilities', {}], ['get', '/releases', {}], ['get', '/releases/:id', {}],
    ['get', '/releases/:id/notes', {}], ['get', '/legacy', {}],
    ['post', '/releases', stage], ['post', '/releases/:id/review', { manifestHash: hash, acknowledged: true }],
    ['post', '/releases/:id/publish', { manifestHash: hash, acknowledged: true }],
    ['post', '/releases/:id/notes', note],
    ['post', '/versions/retire', { reference, reason: 'La versión de prueba necesita retirarse.', acknowledged: true }],
] as const;
const handlers = () => [...Object.values(editorial), ...Object.values(decisions)];
const expectNoDomainCall = () => handlers().forEach(handler => expect(handler).not.toHaveBeenCalled());

/** Autenticación y permiso editorial reales; sólo dominio simulado, sin abrir un socket. */
function harness() {
    const state = { actor: { id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'ACTIVE', name: 'Responsable actual' } as Record<string, string> | null };
    const database = { user: { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.actor && Object.entries(where).every(([key, value]) => state.actor![key] === value) ? { ...state.actor } : null) } };
    const db = database as unknown as PrismaClient;
    const router = createAssistantKnowledgeAdminRouter(db);
    async function request(method: Method, path: string, body: unknown = {}, patch: Record<string, unknown> = {}) {
        const req = {
            method: method.toUpperCase(), originalUrl: `/api/admin/assistant-knowledge${path}`, url: path,
            headers: { authorization: 'Bearer synthetic-editorial-token' }, body, query: {},
            params: path.includes(':id') ? { id: 'release-test' } : {}, ...patch,
        };
        const res = {
            statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
            set(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; },
            status(code: number) { this.statusCode = code; return this; },
            json(value: unknown) { this.body = value; return this; },
        };
        for (const layer of router.stack) {
            const route = layer.route as typeof layer.route & { methods?: Record<string, boolean> };
            if (route && (route.path !== path || !route.methods?.[method])) continue;
            for (const handler of route ? route.stack : [layer]) {
                let next = false;
                await handler.handle(req as unknown as Request, res as unknown as Response, () => { next = true; });
                if (!next) return res;
            }
            if (route) return res;
        }
        throw new Error(`Missing editorial route: ${method} ${path}`);
    }
    return { db, database, state, request };
}

beforeEach(() => {
    vi.resetAllMocks();
    auth.verify.mockReturnValue(principal);
    auth.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'ACTIVE', email: null });
    auth.tenant.mockResolvedValue({ subscriptionStatus: 'ACTIVE', trialEndsAt: null });
    editorial.capabilities.mockResolvedValue({ canEdit: true, actor: { id: principal.userId, name: 'Responsable actual' } });
    editorial.releases.mockResolvedValue({ releases: [], nextCursor: null });
    editorial.release.mockResolvedValue({ id: 'release-test', body: sensitive });
    editorial.notes.mockResolvedValue({ notes: [{ id: 'note-test', body: sensitive }], nextCursor: null });
    editorial.legacy.mockResolvedValue({ documents: [{ body: sensitive }] });
    editorial.addNote.mockResolvedValue({ id: 'note-test', body: note.body, authorId: principal.userId, createdAt: '2026-09-19T17:00:00Z' });
    decisions.stage.mockResolvedValue({ id: 'release-test', status: 'DRAFT', manifestHash: hash });
    decisions.review.mockResolvedValue({ id: 'release-test', status: 'REVIEWED', manifestHash: hash });
    decisions.publish.mockResolvedValue({ id: 'release-test', status: 'PUBLISHED', manifestHash: hash });
    decisions.retire.mockResolvedValue({ reference, status: 'RETIRED' });
});
afterEach(() => vi.unstubAllEnvs());

describe('superficie editorial: identidad y decisiones humanas explícitas', () => {
    it.each(routes)('%s %s exige autenticación antes de acceder al dominio', async (method, path, body) => {
        const h = harness();
        expect((await h.request(method, path, body, { headers: {} })).statusCode).toBe(401);
        expectNoDomainCall();
        expect(h.database.user.findFirst).not.toHaveBeenCalled();
    });

    it.each(routes)('%s %s rechaza el privilegio que un token antiguo conserva', async (method, path, body) => {
        const h = harness();
        auth.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: 'OWNER', status: 'ACTIVE', email: null });
        h.state.actor!.role = 'OWNER';
        expect((await h.request(method, path, body)).statusCode).toBe(403);
        expectNoDomainCall();
    });

    it('una cuenta desactivada no conserva la facultad editorial', async () => {
        const h = harness();
        auth.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'INACTIVE', email: null });
        expect((await h.request('post', '/releases/:id/review', { manifestHash: hash, acknowledged: true })).statusCode).toBe(403);
        expectNoDomainCall();
    });

    it('la identidad y el autor provienen de la sesión vigente, con respuesta privada', async () => {
        const h = harness();
        const result = await h.request('get', '/capabilities', {}, { tenantId: 'forged-tenant', userId: 'forged-editor', role: 'OWNER' });
        expect(result).toMatchObject({ statusCode: 200, headers: { 'cache-control': 'private, no-store' }, body: { actor: { id: principal.userId } } });
        expect(editorial.capabilities).toHaveBeenCalledWith(principal, h.db);
        expect(h.database.user.findFirst.mock.calls.every(([input]) => input.where.id === principal.userId && input.where.tenantId === principal.tenantId)).toBe(true);
    });

    it.each([
        ['get', '/releases', {}], ['get', '/releases/:id', {}], ['get', '/legacy', {}],
        ['post', '/releases/:id/review', { manifestHash: hash, acknowledged: true }],
    ] as const)('%s %s no acepta alcance o actor desde query', async (method, path, body) => {
        const h = harness();
        expect((await h.request(method, path, body, { query: { tenantId: 'forged-tenant', role: 'SUPER_ADMIN' } })).statusCode).toBe(400);
        expectNoDomainCall();
    });

    it.each([
        ['/releases', { ...stage, tenantId: 'forged-tenant' }],
        ['/releases/:id/review', { manifestHash: hash, acknowledged: true, reviewedById: 'outside-person' }],
        ['/releases/:id/publish', { manifestHash: hash, acknowledged: true, role: 'SUPER_ADMIN' }],
        ['/releases/:id/notes', { ...note, authorId: 'outside-person' }],
        ['/releases/:id/notes', { ...note, reviewer: 'Responsable externo' }],
    ] as const)('%s rechaza atribución aportada por el navegador', async (path, body) => {
        const h = harness();
        expect((await h.request('post', path, body)).statusCode).toBe(400);
        expectNoDomainCall();
    });

    it.each([
        ['/releases/:id/review', { manifestHash: hash }], ['/releases/:id/review', { manifestHash: hash, acknowledged: false }],
        ['/releases/:id/publish', { manifestHash: hash }], ['/releases/:id/publish', { manifestHash: hash, acknowledged: 'true' }],
        ['/versions/retire', { reference, reason: 'Retirada de prueba sin reconocimiento.' }],
    ] as const)('%s necesita reconocimiento booleano explícito', async (path, body) => {
        const h = harness();
        expect((await h.request('post', path, body)).statusCode).toBe(400);
        expectNoDomainCall();
    });

    it('guardar un borrador no lo revisa ni publica', async () => {
        const h = harness();
        const result = await h.request('post', '/releases', stage);
        expect(result.statusCode).toBeGreaterThanOrEqual(200);
        expect(result.statusCode).toBeLessThan(300);
        expect(result.body).toMatchObject({ status: 'DRAFT' });
        expect(decisions.stage).toHaveBeenCalledWith(principal, stage, h.db);
        expect(decisions.review).not.toHaveBeenCalled();
        expect(decisions.publish).not.toHaveBeenCalled();
    });

    it('una nota incluso con texto de aprobación no cambia el estado editorial', async () => {
        const h = harness();
        const input = { ...note, body: 'Aprobado, publiquen ambos cuando puedan.' };
        const result = await h.request('post', '/releases/:id/notes', input);
        expect(result.statusCode).toBeGreaterThanOrEqual(200);
        expect(result.statusCode).toBeLessThan(300);
        expect(editorial.addNote).toHaveBeenCalledWith(principal, 'release-test', input, h.db);
        Object.values(decisions).forEach(handler => expect(handler).not.toHaveBeenCalled());
    });

    it('revisar y publicar son solicitudes separadas del mismo hash y actor', async () => {
        const h = harness();
        const input = { manifestHash: hash, acknowledged: true };
        expect((await h.request('post', '/releases/:id/review', input)).body).toMatchObject({ status: 'REVIEWED' });
        expect(decisions.review).toHaveBeenCalledWith(principal, { releaseId: 'release-test', manifestHash: hash }, h.db);
        expect(decisions.publish).not.toHaveBeenCalled();
        expect((await h.request('post', '/releases/:id/publish', input)).body).toMatchObject({ status: 'PUBLISHED' });
        expect(decisions.publish).toHaveBeenCalledWith(principal, { releaseId: 'release-test', manifestHash: hash }, h.db);
        expect(decisions.review).toHaveBeenCalledTimes(1);
    });

    it.each(['review', 'publish'] as const)('%s conserva el conflicto de hash del dominio y no lo reintenta', async action => {
        const h = harness();
        decisions[action].mockRejectedValue(new AssistantAccessError(409, 'KNOWLEDGE_REVIEW_STALE', 'La revisión no coincide con el manifiesto exacto.'));
        const result = await h.request('post', `/releases/:id/${action}`, { manifestHash: hash, acknowledged: true });
        expect(result).toMatchObject({ statusCode: 409, body: { code: 'KNOWLEDGE_REVIEW_STALE' } });
        expect(decisions[action]).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['/capabilities', 'capabilities'], ['/releases', 'releases'], ['/releases/:id', 'release'],
        ['/releases/:id/notes', 'notes'], ['/legacy', 'legacy'],
    ] as const)('%s no entrega datos leídos cuando se revoca el acceso antes de responder', async (path, key) => {
        const h = harness();
        editorial[key].mockImplementation(async () => { h.state.actor = null; return { body: sensitive }; });
        const result = await h.request('get', path);
        expect(result.statusCode).toBe(403);
        expect(JSON.stringify(result.body)).not.toContain(sensitive);
    });

    it.each([
        ['/releases', stage, 'stage'],
        ['/releases/:id/review', { manifestHash: hash, acknowledged: true }, 'review'],
        ['/releases/:id/publish', { manifestHash: hash, acknowledged: true }, 'publish'],
        ['/versions/retire', { reference, reason: 'Retirada sintética autorizada.', acknowledged: true }, 'retire'],
        ['/releases/:id/notes', note, 'addNote'],
    ] as const)('%s revalida al responder y no reintenta la mutación si se revoca el acceso', async (path, input, key) => {
        const h = harness();
        const execute = key === 'addNote' ? editorial.addNote : decisions[key];
        execute.mockImplementation(async () => { h.state.actor = null; return { body: sensitive }; });
        const result = await h.request('post', path, input);
        expect(result.statusCode).toBe(403);
        expect(JSON.stringify(result.body)).not.toContain(sensitive);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('un fallo de persistencia se presenta sin texto interno', async () => {
        const h = harness();
        editorial.release.mockRejectedValue(new Error('SELECT unpublished private body FROM secret_table'));
        const result = await h.request('get', '/releases/:id');
        expect(result.statusCode).toBe(503);
        expect(JSON.stringify(result.body)).not.toMatch(/SELECT|unpublished|secret_table/);
    });
});
