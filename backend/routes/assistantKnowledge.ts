import express from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { assertAssistantAccess, AssistantAccessError } from '../services/assistant/access.js';
import { getAssistantKnowledgePassage, getAssistantKnowledgeRevision } from '../services/assistant/knowledge/service.js';

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const passageParams = z.object({
  documentId: identifier,
  version: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  sectionId: identifier.max(64),
}).strict();
const passageQuery = z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const actor = (req: Request & AuthRequest) => ({ tenantId: req.tenantId || '', userId: req.userId || '', role: req.role || '' });

function respondError(error: unknown, res: Response) {
  if (error instanceof AssistantAccessError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'La referencia de ayuda no es válida.', code: 'ASSISTANT_KNOWLEDGE_INVALID' });
  return res.status(503).json({ error: 'No se pudo comprobar la fuente de ayuda.', code: 'ASSISTANT_KNOWLEDGE_UNAVAILABLE' });
}

/** Sólo lectura; la publicación editorial no se expone como herramienta ni endpoint del modelo. */
export function createAssistantKnowledgeRouter(db: PrismaClient = prisma) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.get('/knowledge/revision', authenticate, async (req: Request & AuthRequest, res: Response) => {
    try {
      z.object({}).strict().parse(req.query);
      const principal = actor(req);
      await assertAssistantAccess(principal, 'help', db);
      const result = await getAssistantKnowledgeRevision(db);
      await assertAssistantAccess(principal, 'help', db);
      res.json(result);
    } catch (error) { respondError(error, res); }
  });
  router.get('/knowledge/documents/:documentId/versions/:version/sections/:sectionId', authenticate, async (req: Request & AuthRequest, res: Response) => {
    try {
      const reference = { ...passageParams.parse(req.params), ...passageQuery.parse(req.query) };
      const principal = actor(req);
      await assertAssistantAccess(principal, 'help', db);
      const passage = await getAssistantKnowledgePassage(principal, reference, db, 'WEB_INTERNAL');
      await assertAssistantAccess(principal, 'help', db);
      res.json(passage);
    } catch (error) { respondError(error, res); }
  });
  return router;
}
