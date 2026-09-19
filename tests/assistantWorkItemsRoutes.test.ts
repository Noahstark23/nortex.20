import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const auth = vi.hoisted(() => ({ verify: vi.fn(), user: vi.fn(), tenant: vi.fn() }));
const services = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), list: vi.fn(), append: vi.fn() }));
vi.mock('../backend/services/secrets', () => ({ verifyAuthToken: auth.verify }));
vi.mock('../backend/lib/prisma.js', () => ({ default: { user: { findUnique: auth.user }, tenant: { findUnique: auth.tenant } } }));
vi.mock('../backend/services/assistant/workItems/service.js', () => ({
  createAssistantWorkItem: services.create, getAssistantWorkItem: services.get,
  listAssistantWorkItems: services.list, appendAssistantWorkItemEvent: services.append,
}));
import { createAssistantWorkItemsRouter } from '../backend/routes/assistantWorkItems';

const principal = { tenantId: 'tenant-a', userId: 'human-a', role: 'MANAGER' };
const routes = [
  ['post', '/work-items', 'create'], ['get', '/work-items', 'list'],
  ['get', '/work-items/:id', 'get'], ['post', '/work-items/:id/events', 'append'],
] as const;

/** Router/auth reales con identidad sintética y servicios espía; sin socket, DB o proveedor. */
async function request(method: string, path: string, patch: Record<string, unknown> = {}) {
  const router = createAssistantWorkItemsRouter();
  const req = { method: method.toUpperCase(), originalUrl: `/api/assistant${path}`, url: path,
    headers: { authorization: 'Bearer synthetic-work-item-token' }, params: { id: 'work-a' },
    body: { runId: 'run-a' }, query: {}, ...patch };
  const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    set(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; },
    json(value: unknown) { this.body = value; return this; } };
  for (const layer of router.stack) {
    const route = layer.route as typeof layer.route & { methods?: Record<string, boolean> };
    if (route && (route.path !== path || !route.methods?.[method])) continue;
    for (const handler of route ? route.stack : [layer]) {
      let proceed = false;
      await handler.handle(req as unknown as Request, res as unknown as Response, () => { proceed = true; });
      if (!proceed) return res;
    }
    if (route) return res;
  }
  throw new Error('Missing work item route');
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.verify.mockReturnValue(principal);
  auth.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'ACTIVE', email: null });
  auth.tenant.mockResolvedValue({ subscriptionStatus: 'ACTIVE', trialEndsAt: null });
  services.create.mockResolvedValue({ id: 'work-a', status: 'IN_REVIEW' });
  services.get.mockResolvedValue({ id: 'work-a', status: 'WAITING' });
  services.list.mockResolvedValue({ items: [], nextCursor: null });
  services.append.mockResolvedValue({ id: 'work-a', status: 'WAITING', receiptEventId: 'event-a' });
});

describe('transporte de continuidad W01: autenticación y lectura sin ejecución', () => {
  it.each(routes)('%s %s exige sesión antes del servicio', async (method, path) => {
    expect((await request(method, path, { headers: {} })).statusCode).toBe(401);
    for (const service of Object.values(services)) expect(service).not.toHaveBeenCalled();
  });

  it.each(routes)('%s %s deriva autoridad de la sesión persistida y entrega sin caché', async (method, path, service) => {
    const response = await request(method, path, { tenantId: 'forged', userId: 'another', role: 'SUPER_ADMIN' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(services[service].mock.calls[0][0]).toEqual(principal);
  });

  it('otra sesión obtiene su propia identidad y el rol vigente, sin heredar el anterior', async () => {
    auth.verify.mockReturnValue({ tenantId: 'tenant-b', userId: 'human-b', role: 'OWNER' });
    auth.user.mockResolvedValue({ id: 'human-b', tenantId: 'tenant-b', role: 'CASHIER', status: 'ACTIVE', email: null });
    await request('get', '/work-items');
    expect(services.list).toHaveBeenCalledWith({ tenantId: 'tenant-b', userId: 'human-b', role: 'CASHIER' }, {}, {});
  });

  it('cuenta deshabilitada no llega a ningún servicio', async () => {
    auth.user.mockResolvedValue({ id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'DISABLED', email: null });
    expect((await request('get', '/work-items/:id')).statusCode).toBe(403);
    expect(services.get).not.toHaveBeenCalled();
  });

  it('recuperar y listar no invoca creación ni transiciones', async () => {
    await request('get', '/work-items/:id');
    await request('get', '/work-items', { query: { cursor: 'work-previous' } });
    expect(services.create).not.toHaveBeenCalled();
    expect(services.append).not.toHaveBeenCalled();
    expect(services.get).toHaveBeenCalledWith(principal, 'work-a', {});
    expect(services.list).toHaveBeenCalledWith(principal, { cursor: 'work-previous' }, {});
  });

  it('conserva identidad y contenido del evento para recuperación exacta', async () => {
    const event = { eventId: '5e6e99d0-6000-4000-8000-000000000001', type: 'WAIT', version: 3 };
    const response = await request('post', '/work-items/:id/events', { body: event });
    expect(services.append).toHaveBeenCalledWith(principal, 'work-a', event, {});
    expect(response.body).toMatchObject({ receiptEventId: 'event-a' });
  });

  it('expone conflicto de versión sin convertirlo en éxito', async () => {
    services.append.mockRejectedValue({ statusCode: 409, code: 'WORK_ITEM_CHANGED', message: 'Recuperá el encargo.' });
    expect(await request('post', '/work-items/:id/events')).toMatchObject({ statusCode: 409, body: { code: 'WORK_ITEM_CHANGED' } });
  });

  it('datos inválidos devuelven 400 sin detalles privados del parser', async () => {
    services.create.mockRejectedValue(new z.ZodError([{ code: 'custom', path: ['private-note'], message: 'PRIVATE_SENTINEL' }]));
    const response = await request('post', '/work-items');
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: 'WORK_ITEM_INPUT' });
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_SENTINEL|private-note/);
  });

  it('fallo interno conserva incertidumbre sin filtrar SQL, notas ni stack', async () => {
    services.get.mockRejectedValue(new Error('SELECT private_note PRIVATE_SENTINEL'));
    const response = await request('get', '/work-items/:id');
    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({ code: 'WORK_ITEM_UNAVAILABLE' });
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_SENTINEL|SELECT|private_note|stack/);
  });
});
