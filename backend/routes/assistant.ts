import express from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import type { AssistantPrincipal } from '../../shared/assistant.js';
import { AssistantAccessError, getAssistantCapabilities } from '../services/assistant/access.js';
import { createAssistantConversation, getAssistantConversation, sendAssistantMessage } from '../services/assistant/conversations.js';
import { getAssistantOverview } from '../services/assistant/overview.js';
import { AssistantDocumentError } from '../services/assistant/attachments.js';

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const emptyBody = z.object({}).strict();

function principal(req: Request & AuthRequest): AssistantPrincipal {
    return { tenantId: req.tenantId || '', userId: req.userId || '', role: req.role || '' };
}

function errorResponse(error: unknown, res: Response) {
    if (error instanceof AssistantAccessError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
    } else if (error instanceof AssistantDocumentError && error.code === 'BUDGET_EXHAUSTED') {
        res.status(429).json({ error: 'Se alcanzó el presupuesto mensual de IA. Podés continuar usando las funciones habituales de Nortex.', code: error.code });
    } else if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Revisá los datos de la consulta.', code: 'ASSISTANT_INVALID_INPUT' });
    } else {
        // No imprimir mensajes, facturas, consultas SQL ni cuerpos en logs.
        res.status(503).json({ error: 'NortexGPT no está disponible en este momento. Intentá de nuevo.', code: 'ASSISTANT_UNAVAILABLE' });
    }
}

export function createAssistantRouter(db: PrismaClient = prisma) {
    const router = express.Router();
    // También se aplica a adjuntos y propuestas montados después de este router.
    // El navegador no debe conservar respuestas privadas al cambiar de sesión.
    router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
    router.get('/capabilities', authenticate, async (req: Request & AuthRequest, res: Response) => {
        try { res.json(await getAssistantCapabilities(principal(req), db)); } catch (error) { errorResponse(error, res); }
    });
    router.post('/conversations', authenticate, async (req: Request & AuthRequest, res: Response) => {
        try {
            emptyBody.parse(req.body || {});
            res.status(201).json(await createAssistantConversation(principal(req), db));
        } catch (error) { errorResponse(error, res); }
    });
    router.get('/conversations/:id', authenticate, async (req: Request & AuthRequest, res: Response) => {
        try { res.json(await getAssistantConversation(principal(req), identifier.parse(req.params.id), db)); }
        catch (error) { errorResponse(error, res); }
    });
    router.post('/conversations/:id/messages', authenticate, async (req: Request & AuthRequest, res: Response) => {
        try { res.json(await sendAssistantMessage(principal(req), identifier.parse(req.params.id), req.body, db)); }
        catch (error) { errorResponse(error, res); }
    });
    router.get('/overview', authenticate, async (req: Request & AuthRequest, res: Response) => {
        try { res.json(await getAssistantOverview(principal(req), req.query, db)); }
        catch (error) { errorResponse(error, res); }
    });
    return router;
}

export default createAssistantRouter();
