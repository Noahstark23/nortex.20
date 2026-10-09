import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantKnowledgePassage } from '../shared/assistantKnowledge';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), user: vi.fn(), tenant: vi.fn(), passage: vi.fn(), revision: vi.fn() }));
const runs = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), create: vi.fn(), process: vi.fn(), cancel: vi.fn(), recover: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: mocks.verify }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: mocks.user }, tenant: { findUnique: mocks.tenant } } }));
vi.mock('../backend/services/assistant/knowledge/service.js', () => ({
    getAssistantKnowledgePassage: mocks.passage,
    getAssistantKnowledgeRevision: mocks.revision,
}));
vi.mock('../backend/services/assistant/operations/runService.js', () => ({
    getAssistantRun: runs.get, listAssistantRuns: runs.list, createAssistantRun: runs.create,
    processAssistantRun: runs.process, cancelAssistantRun: runs.cancel, recoverAssistantRun: runs.recover,
}));
vi.mock('../backend/services/assistant/operations/briefing.js', () => ({ getDailyBrief: vi.fn(), dismissDailyBriefItem: vi.fn() }));
import { createAssistantKnowledgeRouter } from '../backend/routes/assistantKnowledge';
import { createAssistantOperationsRouter } from '../backend/routes/assistantOperations';
import { AssistantAccessError } from '../backend/services/assistant/access';

const principal = { tenantId: 'tenant-a', userId: 'reader-a', role: 'OWNER' };
const passagePath = '/knowledge/documents/:documentId/versions/:version/sections/:sectionId';
const reference = { documentId: 'ventas', version: '2026-09-19.1', sectionId: 'cobrar', contentHash: 'a'.repeat(64) };
const passage: AssistantKnowledgePassage = { reference, title: 'Ayuda aprobada', section: 'Vender', body: 'Pasaje exacto autorizado.', publication: 'PUBLISHED', historical: false, revision: 'revision-1' };

/** Ejecuta los handlers reales del router, sin socket ni servidor de producto. */
function harness(createRouter: (db: PrismaClient) => ReturnType<typeof createAssistantKnowledgeRouter> = createAssistantKnowledgeRouter) {
    const database = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: principal.userId, role: principal.role, status: 'ACTIVE' }) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
    };
    const db = database as unknown as PrismaClient;
    const router = createRouter(db);
    async function get(path: string, patch: Record<string, unknown> = {}) {
        const req = {
            method: 'GET', originalUrl: `/api/assistant${path}`, url: path,
            headers: { authorization: 'Bearer synthetic-token' }, body: {}, query: path === passagePath ? { contentHash: reference.contentHash } : {},
            params: { documentId: reference.documentId, version: reference.version, sectionId: reference.sectionId, ...(path.includes('/runs') ? { id: 'run-or-conversation' } : {}) }, ...patch,
        };
        const res = {
            statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
            set(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; },
            status(code: number) { this.statusCode = code; return this; },
            json(body: unknown) { this.body = body; return this; },
        };
        let found = false;
        for (const layer of router.stack) {
            const route = layer.route as typeof layer.route & { methods?: Record<string, boolean> };
            if (route && (route.path !== path || !route.methods?.get)) continue;
            const handlers = layer.route ? layer.route.stack : [layer];
            if (layer.route) found = true;
            for (const handler of handlers) {
                let next = false;
                await handler.handle(req as unknown as Request, res as unknown as Response, () => { next = true; });
                if (!next) return res;
            }
            if (found) return res;
        }
        throw new Error(`Missing knowledge route: ${path}`);
    }
    return { get, database, db };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
    mocks.verify.mockReturnValue(principal);
    mocks.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'ACTIVE', email: null });
    mocks.tenant.mockResolvedValue({ subscriptionStatus: 'ACTIVE', trialEndsAt: null });
    mocks.passage.mockResolvedValue(passage);
    mocks.revision.mockResolvedValue({ revision: 'revision-1', available: true });
    runs.get.mockResolvedValue({ id: 'run-help', status: 'SUCCEEDED' });
    runs.list.mockResolvedValue([{ id: 'run-help', status: 'SUCCEEDED' }]);
});
afterEach(() => vi.unstubAllEnvs());

describe('ayuda publicada: rutas autenticadas sin red ni base real', () => {
    it.each(['/knowledge/revision', passagePath])('%s exige sesión antes de leer ayuda', async path => {
        const h = harness();
        expect((await h.get(path, { headers: {} })).statusCode).toBe(401);
        expect(h.database.user.findFirst).not.toHaveBeenCalled();
        expect(mocks.passage).not.toHaveBeenCalled();
        expect(mocks.revision).not.toHaveBeenCalled();
    });

    it('devuelve el pasaje exacto con identidad vigente y sin caché', async () => {
        const h = harness();
        const result = await h.get(passagePath, { tenantId: 'forged-tenant', userId: 'forged-user', role: 'SUPER_ADMIN' });
        expect(result).toMatchObject({ statusCode: 200, body: passage, headers: { 'cache-control': 'private, no-store' } });
        expect(mocks.passage).toHaveBeenCalledWith(principal, reference, h.db, 'WEB_INTERNAL');
        expect(h.database.user.findFirst.mock.calls.every(([input]) => input.where.tenantId === principal.tenantId)).toBe(true);
    });

    it('usa el rol persistido aunque el token conserve un rol anterior', async () => {
        const h = harness();
        mocks.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: 'CASHIER', status: 'ACTIVE', email: null });
        h.database.user.findFirst.mockResolvedValue({ id: principal.userId, role: 'CASHIER', status: 'ACTIVE' });
        expect((await h.get(passagePath)).statusCode).toBe(200);
        expect(mocks.passage).toHaveBeenCalledWith({ ...principal, role: 'CASHIER' }, reference, h.db, 'WEB_INTERNAL');
    });

    it.each([{ tenantId: 'tenant-b' }, { role: 'OWNER' }, { channel: 'WHATSAPP_PRIVATE' }])('rechaza contexto enviado por query %j', async injected => {
        const h = harness();
        expect((await h.get(passagePath, { query: { contentHash: reference.contentHash, ...injected } })).statusCode).toBe(400);
        expect(mocks.passage).not.toHaveBeenCalled();
    });

    it.each([
        { params: { documentId: '../private', version: reference.version, sectionId: reference.sectionId } },
        { params: { documentId: reference.documentId, version: 'v/../old', sectionId: reference.sectionId } },
        { params: { documentId: reference.documentId, version: reference.version, sectionId: '<script>' } },
        { query: { contentHash: 'a'.repeat(63) } }, { query: { contentHash: 'g'.repeat(64) } },
    ])('rechaza una referencia incompleta o malformada %j', async patch => {
        const h = harness();
        expect((await h.get(passagePath, patch)).statusCode).toBe(400);
        expect(mocks.passage).not.toHaveBeenCalled();
    });

    it('sin hash explícito resuelve la misma versión y sección desde el servidor', async () => {
        const h = harness();
        expect(await h.get(passagePath, { query: {} })).toMatchObject({ statusCode: 200, body: passage });
        expect(mocks.passage).toHaveBeenCalledWith(principal, { documentId: reference.documentId, version: reference.version, sectionId: reference.sectionId }, h.db, 'WEB_INTERNAL');
    });

    it('revalida acceso después de leer el pasaje', async () => {
        const h = harness();
        mocks.passage.mockImplementation(async () => {
            h.database.user.findFirst.mockResolvedValue(null);
            return passage;
        });
        const result = await h.get(passagePath);
        expect(result.statusCode).toBe(403);
        expect(JSON.stringify(result.body)).not.toContain(passage.body);
    });

    it('no devuelve texto del servicio cuando el pasaje fue retirado', async () => {
        const h = harness();
        mocks.passage.mockRejectedValue(new AssistantAccessError(404, 'KNOWLEDGE_NOT_AVAILABLE', 'La fuente ya no está disponible.'));
        const result = await h.get(passagePath);
        expect(result.statusCode).toBe(404);
        expect(JSON.stringify(result.body)).not.toContain(passage.body);
    });

    it('la revisión exige ayuda habilitada y devuelve disponibilidad explícita', async () => {
        const h = harness();
        mocks.revision.mockResolvedValue({ revision: 'unavailable', available: false });
        expect(await h.get('/knowledge/revision')).toMatchObject({ statusCode: 200, body: { revision: 'unavailable', available: false }, headers: { 'cache-control': 'private, no-store' } });
        expect(mocks.revision).toHaveBeenCalledWith(h.db);
        h.database.assistantTenantConfig.findUnique.mockResolvedValue({ enabled: false });
        mocks.revision.mockClear();
        expect((await h.get('/knowledge/revision')).statusCode).toBe(403);
        expect(mocks.revision).not.toHaveBeenCalled();
    });

    it('un fallo interno no revela contenido ni detalles de persistencia', async () => {
        const h = harness();
        mocks.passage.mockRejectedValue(new Error('private-document SELECT unpublished_body'));
        const result = await h.get(passagePath);
        expect(result.statusCode).toBe(503);
        expect(JSON.stringify(result.body)).not.toMatch(/private-document|SELECT|unpublished_body/);
    });

    it.each([
        ['/runs/:id', 'get'], ['/conversations/:id/runs', 'list'],
    ] as const)('la entrega web %s no hereda el canal privado del origen del run', async (path, operation) => {
        const h = harness(db => createAssistantOperationsRouter({ db, channel: 'WHATSAPP_PRIVATE' }));
        const result = await h.get(path, { query: { channel: 'WHATSAPP_PRIVATE' } });
        expect(result.statusCode).toBe(200);
        expect(runs[operation]).toHaveBeenCalledWith(principal, 'run-or-conversation', expect.objectContaining({ db: h.db, channel: 'WEB_INTERNAL' }));
        expect(runs.create).not.toHaveBeenCalled();
        expect(runs.process).not.toHaveBeenCalled();
        expect(runs.cancel).not.toHaveBeenCalled();
    });
});
