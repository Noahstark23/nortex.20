import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import type { AssistantPrincipal } from '../../shared/assistant.js';
import { createAssistantWorkItem, getAssistantWorkItem, listAssistantWorkItems, appendAssistantWorkItemEvent,
  type WorkItemDependencies } from '../services/assistant/workItems/service.js';

const actor = (req: Request & AuthRequest): AssistantPrincipal => ({ tenantId: req.tenantId ?? '', userId: req.userId ?? '', role: req.role ?? '' });
function failure(error: unknown, res: Response) {
  if (error instanceof z.ZodError) { res.status(400).json({ code: 'WORK_ITEM_INPUT', error: 'Revisá los datos del encargo.' }); return; }
  const value = error as { statusCode?: number; code?: string; message?: string };
  if (value.statusCode && value.statusCode >= 400 && value.statusCode < 500) {
    res.status(value.statusCode).json({ code: value.code, error: value.message }); return;
  }
  res.status(503).json({ code: 'WORK_ITEM_UNAVAILABLE', error: 'No pudimos comprobar el encargo. Conservá su referencia y el identificador del cambio pendiente.' });
}

export function createAssistantWorkItemsRouter(deps: WorkItemDependencies = {}) {
  const router = Router();
  router.use(authenticate);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.post('/work-items', async (req, res) => {
    try { res.json(await createAssistantWorkItem(actor(req), req.body, deps)); } catch (error) { failure(error, res); }
  });
  router.get('/work-items', async (req, res) => {
    try { res.json(await listAssistantWorkItems(actor(req), req.query, deps)); } catch (error) { failure(error, res); }
  });
  router.get('/work-items/:id', async (req, res) => {
    try { res.json(await getAssistantWorkItem(actor(req), req.params.id, deps)); } catch (error) { failure(error, res); }
  });
  router.post('/work-items/:id/events', async (req, res) => {
    try { res.json(await appendAssistantWorkItemEvent(actor(req), req.params.id, req.body, deps)); } catch (error) { failure(error, res); }
  });
  return router;
}
