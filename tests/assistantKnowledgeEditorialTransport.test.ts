import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ verify: vi.fn(), user: vi.fn(), tenant: vi.fn() }));
const stage = vi.hoisted(() => vi.fn());
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: auth.verify }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: auth.user }, tenant: { findUnique: auth.tenant } } }));
vi.mock('../backend/services/assistant/knowledge/lifecycle.js', async importOriginal => ({
    ...await importOriginal<typeof import('../backend/services/assistant/knowledge/lifecycle.js')>(),
    stageAssistantKnowledgeRelease: stage,
}));
import { assistantKnowledgeInputError, createAssistantKnowledgeAdminRouter } from '../backend/routes/assistantKnowledgeAdmin';

const principal = { tenantId: 'transport-tenant', userId: 'transport-editor', role: 'SUPER_ADMIN' };
const marker = 'PRIVATE-EDITORIAL-TRANSPORT-PAYLOAD';

/** Transporte HTTP real, sólo loopback efímero; no DB, proveedor ni servidor del producto. */
async function withEditorialServer(run: (url: string, parsedBytes: ReturnType<typeof vi.fn>) => Promise<void>) {
    const database = { user: { findFirst: vi.fn(async () => ({ id: principal.userId, name: 'Responsable sintético' })) } };
    const parsedBytes = vi.fn();
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use((req, _res, next) => { parsedBytes(Buffer.byteLength(JSON.stringify(req.body ?? null))); next(); });
    app.use('/api/admin/assistant-knowledge', assistantKnowledgeInputError, createAssistantKnowledgeAdminRouter(database as unknown as PrismaClient));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    try {
        await run(`http://127.0.0.1:${address.port}/api/admin/assistant-knowledge/releases`, parsedBytes);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

async function expectPrivateError(response: globalThis.Response, status: number) {
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(text).not.toMatch(/PRIVATE-EDITORIAL-TRANSPORT-PAYLOAD|SyntaxError|PayloadTooLargeError|<!DOCTYPE|node_modules/);
    expect(JSON.parse(text)).toEqual({ error: expect.any(String), code: 'KNOWLEDGE_EDITORIAL_INVALID' });
    expect(stage).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.resetAllMocks();
    auth.verify.mockReturnValue(principal);
    auth.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'ACTIVE', email: null });
    auth.tenant.mockResolvedValue({ subscriptionStatus: 'ACTIVE', trialEndsAt: null });
});

describe('transporte editorial tras el parser global de Express', () => {
    it('JSON malformado recibe 400 privado sin revelar el cuerpo ni ejecutar el adaptador', async () => {
        await withEditorialServer(async (url, parsedBytes) => {
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"body":"${marker}",` });
            await expectPrivateError(response, 400);
            expect(parsedBytes).not.toHaveBeenCalled();
            expect(auth.verify).not.toHaveBeenCalled();
        });
    });

    it('un cuerpo mayor de 2 MiB recibe 413 privado desde el parser global', async () => {
        await withEditorialServer(async (url, parsedBytes) => {
            const body = JSON.stringify({ body: marker + 'x'.repeat(2 * 1024 * 1024) });
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            await expectPrivateError(response, 413);
            expect(parsedBytes).not.toHaveBeenCalled();
            expect(auth.verify).not.toHaveBeenCalled();
        });
    });

    it('el límite de 600 KiB sigue vigente cuando el parser global ya aceptó el JSON', async () => {
        await withEditorialServer(async (url, parsedBytes) => {
            const body = JSON.stringify({ body: marker + 'x'.repeat(700 * 1024) });
            const response = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-editorial-token' }, body,
            });
            await expectPrivateError(response, 413);
            expect(parsedBytes).toHaveBeenCalledWith(Buffer.byteLength(body));
            expect(auth.verify).toHaveBeenCalledOnce();
        });
    });
});
