import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, requireSuperAdmin, type AuthRequest } from '../middleware/auth.js';
import { AssistantAccessError } from '../services/assistant/access.js';
import { authorizeEditor } from '../services/assistant/knowledge/editorAccess.js';
import { editorialListQuery, editorialNotesQuery, getKnowledgeEditorialCapabilities, getKnowledgeEditorialRelease,
  listKnowledgeEditorialLegacy, listKnowledgeEditorialNotes, listKnowledgeEditorialReleases } from '../services/assistant/knowledge/editorial.js';
import { addKnowledgeEditorialNote, editorialNoteInput } from '../services/assistant/knowledge/editorNotes.js';
import { publishAssistantKnowledgeRelease, retireAssistantKnowledgeVersion, reviewAssistantKnowledgeRelease,
  stageAssistantKnowledgeRelease, stageInput } from '../services/assistant/knowledge/lifecycle.js';
import { knowledgeId, referenceSchema } from '../services/assistant/knowledge/model.js';

const empty = z.object({}).strict();
const paramsSchema = z.object({ id: knowledgeId }).strict();
const decisionSchema = z.object({ manifestHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledged: z.literal(true) }).strict();
const retireSchema = z.object({ reference: referenceSchema, reason: z.string().trim().min(10).max(500), acknowledged: z.literal(true) }).strict();
const principalFrom = (req: Request & AuthRequest) => ({ tenantId: req.tenantId || '', userId: req.userId || '', role: req.role || '' });
function respondError(error: unknown, res: Response) {
  if (error instanceof AssistantAccessError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'La solicitud editorial no es válida.', code: 'KNOWLEDGE_EDITORIAL_INVALID' });
  if (typeof error === 'object' && error && 'type' in error && ['entity.too.large', 'entity.parse.failed'].includes(String(error.type)))
    return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'El contenido editorial no es válido o excede el límite.', code: 'KNOWLEDGE_EDITORIAL_INVALID' });
  return res.status(503).json({ error: 'No se pudo completar la operación editorial.', code: 'KNOWLEDGE_EDITORIAL_UNAVAILABLE' });
}

/** Captura errores del parser global antes del router sólo en su namespace de montaje. */
export function assistantKnowledgeInputError(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (typeof error !== 'object' || !error || !('type' in error) || !['entity.too.large', 'entity.parse.failed'].includes(String(error.type))) {
    next(error);
    return;
  }
  res.set('Cache-Control', 'private, no-store');
  return respondError(error, res);
}

/** Administración humana. No se compone en tools de IA ni depende de flags de consumo. */
export function createAssistantKnowledgeAdminRouter(db: PrismaClient = prisma) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(authenticate, requireSuperAdmin);
  router.use(express.json({ limit: '600kb' }));
  const route = (work: (req: Request & AuthRequest, principal: ReturnType<typeof principalFrom>) => Promise<unknown>) =>
    async (req: Request & AuthRequest, res: Response) => {
      try {
        const principal = principalFrom(req);
        await authorizeEditor(principal, db);
        const result = await work(req, principal);
        await authorizeEditor(principal, db);
        res.json(result);
      } catch (error) { respondError(error, res); }
    };
  router.get('/capabilities', route(async (req, principal) => {
    empty.parse(req.query);
    return getKnowledgeEditorialCapabilities(principal, db);
  }));
  router.get('/releases', route(async (req, principal) =>
    listKnowledgeEditorialReleases(principal, editorialListQuery.parse(req.query), db)));
  router.get('/releases/:id', route(async (req, principal) => {
    empty.parse(req.query);
    return getKnowledgeEditorialRelease(principal, paramsSchema.parse(req.params).id, db);
  }));
  router.get('/releases/:id/notes', route(async (req, principal) =>
    listKnowledgeEditorialNotes(principal, paramsSchema.parse(req.params).id, editorialNotesQuery.parse(req.query), db)));
  router.get('/legacy', route(async (req, principal) => {
    empty.parse(req.query);
    return listKnowledgeEditorialLegacy(principal, db);
  }));
  router.post('/releases', route(async (req, principal) => {
    empty.parse(req.query);
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 600 * 1024)
      throw new AssistantAccessError(413, 'KNOWLEDGE_EDITORIAL_INVALID', 'El contenido editorial excede el límite.');
    return stageAssistantKnowledgeRelease(principal, stageInput.parse(req.body), db);
  }));
  for (const [name, execute] of [['review', reviewAssistantKnowledgeRelease], ['publish', publishAssistantKnowledgeRelease]] as const) {
    router.post(`/releases/:id/${name}`, route(async (req, principal) => {
      empty.parse(req.query);
      const { manifestHash } = decisionSchema.parse(req.body);
      return execute(principal, { releaseId: paramsSchema.parse(req.params).id, manifestHash }, db);
    }));
  }
  router.post('/versions/retire', route(async (req, principal) => {
    empty.parse(req.query);
    const { acknowledged: _acknowledged, ...input } = retireSchema.parse(req.body);
    return retireAssistantKnowledgeVersion(principal, input, db);
  }));
  router.post('/releases/:id/notes', route(async (req, principal) => {
    empty.parse(req.query);
    return addKnowledgeEditorialNote(principal, paramsSchema.parse(req.params).id, editorialNoteInput.parse(req.body), db);
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => respondError(error, res));
  return router;
}
