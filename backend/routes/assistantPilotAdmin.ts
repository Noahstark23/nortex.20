import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, requireSuperAdmin, type AuthRequest } from '../middleware/auth.js';
import { AssistantAccessError } from '../services/assistant/access.js';
import { changePilotAccount, inspectPilotAccount } from '../services/assistant/pilotActivation.js';

const principal = (req: AuthRequest) => ({ tenantId: req.tenantId ?? '', userId: req.userId ?? '', role: req.role ?? '' });
const emailQuery = z.object({ email: z.string() }).strict();
const empty = z.object({}).strict();
function respond(error: unknown, res: import('express').Response) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: 'PILOT_INPUT', error: 'Revisá los datos del negocio y la confirmación.' });
  if (error instanceof AssistantAccessError) return res.status(error.statusCode).json({ code: error.code, error: error.message });
  return res.status(503).json({ code: 'PILOT_UNAVAILABLE', error: 'No se pudo confirmar el resultado. Consultá de nuevo antes de repetir.' });
}

/** La sesión actual decide y firma cada cambio; el cliente jamás envía un token de otro usuario. */
export function createAssistantPilotAdminRouter(db = prisma) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(authenticate, requireSuperAdmin);
  router.get('/account', async (req, res) => {
    try { res.json(await inspectPilotAccount(principal(req as AuthRequest), emailQuery.parse(req.query).email, db)); }
    catch (error) { respond(error, res); }
  });
  for (const mode of ['enable', 'disable'] as const) router.post(`/${mode}`, async (req, res) => {
    try {
      empty.parse(req.query);
      res.json(await changePilotAccount(principal(req as AuthRequest), mode, req.body, db));
    } catch (error) { respond(error, res); }
  });
  return router;
}
