import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, requireSuperAdmin, type AuthRequest } from '../middleware/auth.js';
import { decideAssistantBudget, getAssistantBudget, listAssistantBudgetRequests, requestAssistantBudget } from '../services/assistant/budgetRequests.js';
import { setAssistantBudgetOwnership } from '../services/assistant/budgetOwnership.js';

const actor = (req: AuthRequest) => ({ tenantId: req.tenantId ?? '', userId: req.userId ?? '', role: req.role ?? '' });
function errors(error: unknown, res: import('express').Response) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: 'BUDGET_INPUT', error: 'Revisá el monto, la referencia y el motivo de la solicitud.' });
  const entry = error as { statusCode?: number; code?: string; message?: string };
  if (entry.statusCode >= 400 && entry.statusCode < 500) return res.status(entry.statusCode).json({ code: entry.code, error: entry.message });
  return res.status(503).json({ code: 'BUDGET_UNAVAILABLE', error: 'No pudimos comprobar el presupuesto. Conservá la solicitud y volvé a consultar su estado.' });
}

export function createAssistantBudgetRouter(db = prisma) {
  const router = Router();
  router.use(authenticate);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.get('/budget', async (req, res) => {
    try { z.object({}).strict().parse(req.query); res.json(await getAssistantBudget(actor(req as AuthRequest), { db })); }
    catch (error) { errors(error, res); }
  });
  router.post('/budget/requests', async (req, res) => {
    try { res.json(await requestAssistantBudget(actor(req as AuthRequest), req.body, { db })); }
    catch (error) { errors(error, res); }
  });
  return router;
}

export function createAdminAssistantBudgetRouter(db = prisma) {
  const router = Router();
  router.use(authenticate, requireSuperAdmin);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.post('/ownership', async (req, res) => {
    try { res.json(await setAssistantBudgetOwnership(actor(req as AuthRequest), req.body, { db })); }
    catch (error) { errors(error, res); }
  });
  router.get('/requests', async (req, res) => {
    try { res.json(await listAssistantBudgetRequests(actor(req as AuthRequest), req.query, { db })); }
    catch (error) { errors(error, res); }
  });
  router.post('/requests/:id/decision', async (req, res) => {
    try { const id = z.string().min(1).max(191).parse(req.params.id); res.json(await decideAssistantBudget(actor(req as AuthRequest), id, req.body, { db })); }
    catch (error) { errors(error, res); }
  });
  return router;
}
