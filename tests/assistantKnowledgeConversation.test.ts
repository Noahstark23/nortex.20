import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantCitation, AssistantMessageDTO } from '../shared/assistant';

const help = vi.hoisted(() => ({ retrieve: vi.fn(), validate: vi.fn(), references: vi.fn() }));
vi.mock('../backend/lib/prisma.js', () => ({ default: {} }));
vi.mock('../backend/services/assistant/knowledge/service.js', () => ({
    retrievePublishedAssistantHelp: help.retrieve,
    validateAssistantKnowledgeReferences: help.validate,
    referencesFromCitations: help.references,
    KNOWLEDGE_UNAVAILABLE_TEXT: 'La ayuda citada ya no está disponible. Consultá la versión vigente.',
}));
import { getAssistantConversation, sendAssistantMessage } from '../backend/services/assistant/conversations';

const principal = { tenantId: 'tenant-a', userId: 'reader-a', role: 'OWNER' };
const requestId = '3b69d59c-08a7-4b17-a2d8-2bf2c37fd140';
const query = 'Ayuda para usar el lector';
const sourceText = 'Texto exclusivo de la fuente que luego se retira.';
const reference = { documentId: 'lector', version: '2026-09-19.1', sectionId: 'inicio', contentHash: 'b'.repeat(64) };
const citation: AssistantCitation = { id: reference.documentId, title: 'Ayuda aprobada', section: 'Lector', version: reference.version, sectionId: reference.sectionId, contentHash: reference.contentHash, path: 'nortex-help:lector' };
type StoredMessage = { id: string; tenantId: string; userId: string; conversationId: string; requestId: string; role: string; content: Record<string, unknown>; createdAt: Date };

function harness() {
    const messages: StoredMessage[] = [];
    const conversation = { id: 'conversation-help', tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: principal.role, expiresAt: new Date(Date.now() + 86_400_000), metadata: null, stateVersion: 0 };
    const controls: { afterAnswer: () => void } = { afterAnswer: () => undefined };
    const database = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: principal.userId, role: principal.role, status: 'ACTIVE' }) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
        assistantConversation: {
            findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => Object.entries(where).every(([key, value]) => key === 'expiresAt' ? conversation.expiresAt > (value as { gt: Date }).gt : conversation[key as keyof typeof conversation] === value) ? { ...conversation } : null),
            updateMany: vi.fn(),
        },
        assistantProposal: { findFirst: vi.fn().mockResolvedValue(null) },
        assistantMessage: {
            findMany: vi.fn(async ({ where, orderBy, take }: { where: Record<string, unknown>; orderBy?: unknown; take: number }) => {
                const rows = messages.filter(row => Object.entries(where).every(([key, value]) => row[key as keyof StoredMessage] === value));
                return (orderBy ? [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : rows).slice(0, take);
            }),
            create: vi.fn(async ({ data }: { data: Omit<StoredMessage, 'id'> }) => {
                const row = { id: `message-${messages.length + 1}`, ...data };
                messages.push(row);
                if (row.role === 'assistant') controls.afterAnswer();
                return row;
            }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: conversation.id, stateVersion: 0 }]),
        $transaction: vi.fn(),
    };
    database.$transaction.mockImplementation(async work => work(database));
    function seed(extra: Partial<AssistantMessageDTO> = {}) {
        const base = { tenantId: principal.tenantId, userId: principal.userId, conversationId: conversation.id, requestId };
        messages.push({ id: 'stored-user', ...base, role: 'user', content: { text: query }, createdAt: new Date('2026-09-19T12:00:00Z') });
        messages.push({ id: 'stored-answer', ...base, role: 'assistant', content: { text: sourceText, citations: [citation], knowledgeReferences: [reference], ...extra }, createdAt: new Date('2026-09-19T12:00:01Z') });
    }
    return { db: database as unknown as PrismaClient, database, messages, conversation, controls, seed };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
    vi.stubEnv('NORTEX_ASSISTANT_LANGUAGE_ENABLED', 'false');
    vi.stubEnv('NORTEX_ASSISTANT_OPERATIONS_ENABLED', 'false');
    help.retrieve.mockResolvedValue({ text: sourceText, citations: [citation], knowledgeReferences: [reference] });
    help.references.mockImplementation((citations: AssistantCitation[]) => citations.length ? [reference] : []);
    help.validate.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

function expectWithdrawn(message: AssistantMessageDTO) {
    expect(message.text).not.toContain(sourceText);
    expect(message.text).toContain('ya no está disponible');
    expect(message.knowledgeUnavailable).toBe(true);
    expect(message.citations ?? []).toEqual([]);
}

describe('ayuda publicada: conversación y replay con fixtures en memoria', () => {
    it('obtiene ayuda con el principal y conserva la identidad de sus fuentes', async () => {
        const h = harness();
        const result = await sendAssistantMessage(principal, h.conversation.id, { requestId, text: query }, h.db);
        expect(result).toMatchObject({ text: sourceText, citations: [citation], knowledgeReferences: [reference] });
        expect(help.retrieve).toHaveBeenCalledWith(principal, query, h.db, 'WEB_INTERNAL');
        expect(h.messages).toHaveLength(2);
        expect(h.database.assistantConversation.updateMany).not.toHaveBeenCalled();
    });

    it('retirada en historial oculta la ayuda sin reescribir los mensajes originales', async () => {
        const h = harness(); h.seed();
        const snapshot = structuredClone(h.messages);
        help.validate.mockResolvedValue(false);
        const result = await getAssistantConversation(principal, h.conversation.id, h.db);
        expect(result.messages.map(message => message.id)).toEqual(['stored-user', 'stored-answer']);
        expect(result.messages[0].text).toBe(query);
        expectWithdrawn(result.messages[1]);
        expect(h.messages).toEqual(snapshot);
        expect(h.database.assistantMessage.create).not.toHaveBeenCalled();
    });

    it('retirada en replay conserva request e ID y no genera otra respuesta', async () => {
        const h = harness(); h.seed();
        help.validate.mockResolvedValue(false);
        const result = await sendAssistantMessage(principal, h.conversation.id, { requestId, text: query }, h.db);
        expect(result.id).toBe('stored-answer');
        expectWithdrawn(result);
        expect(help.retrieve).not.toHaveBeenCalled();
        expect(h.database.assistantMessage.create).not.toHaveBeenCalled();
        expect(h.messages).toHaveLength(2);
    });

    it('retirar después de guardar impide entregar el texto recién derivado', async () => {
        const h = harness();
        h.controls.afterAnswer = () => { help.validate.mockResolvedValue(false); };
        const result = await sendAssistantMessage(principal, h.conversation.id, { requestId, text: query }, h.db);
        expect(result.id).toBe(h.messages[1].id);
        expectWithdrawn(result);
        expect(h.database.assistantMessage.create).toHaveBeenCalledTimes(2);
    });

    it('la retirada conserva acciones, datos operativos e identidad de la captura', async () => {
        const h = harness();
        const retained = {
            actions: [{ type: 'CONTINUE_PURCHASE' as const, label: 'Continuar captura' }],
            purchaseIntake: { id: 'intake-retained', summary: 'Descripción humana pendiente', phase: 'COLLECTING' as const, missing: ['producto'] },
            operationalRunId: 'run-retained',
            overview: { checkedAt: '2026-09-19T12:00:00Z', startDate: '2026-09-19', endDate: '2026-09-19', scope: 'Datos independientes', metrics: [{ key: 'count', label: 'Registros', value: '1', unit: 'count' as const, status: 'ok' as const, source: 'Consulta independiente' }] },
        };
        h.seed(retained); help.validate.mockResolvedValue(false);
        const result = await sendAssistantMessage(principal, h.conversation.id, { requestId, text: query }, h.db);
        expectWithdrawn(result);
        expect(result).toMatchObject(retained);
        expect(h.database.assistantConversation.updateMany).not.toHaveBeenCalled();
        expect(h.database.assistantProposal.findFirst).not.toHaveBeenCalled();
    });

    it('citas heredadas sin referencia verificable no reviven contenido retirado', async () => {
        const h = harness(); h.seed();
        delete h.messages[1].content.knowledgeReferences;
        h.messages[1].content.citations = [{ id: 'lector', title: 'Ayuda antigua', section: 'Lector', version: 'old', path: 'nortex-help:lector' }];
        help.references.mockReturnValue(null);
        const result = await getAssistantConversation(principal, h.conversation.id, h.db);
        expectWithdrawn(result.messages[1]);
    });

    it('la retirada no borra mensajes sin dependencia de ayuda', async () => {
        const h = harness(); h.seed();
        h.messages[1].content = { text: 'Conservá tu referencia pendiente.' };
        help.validate.mockResolvedValue(false);
        const result = await getAssistantConversation(principal, h.conversation.id, h.db);
        expect(result.messages[1]).toMatchObject({ id: 'stored-answer', text: 'Conservá tu referencia pendiente.' });
        expect(result.messages[1].knowledgeUnavailable).not.toBe(true);
    });

    it('conserva el conflicto idempotente aunque la fuente esté retirada', async () => {
        const h = harness(); h.seed(); help.validate.mockResolvedValue(false);
        await expect(sendAssistantMessage(principal, h.conversation.id, { requestId, text: 'Otro pedido' }, h.db)).rejects.toMatchObject({ code: 'ASSISTANT_REQUEST_CONFLICT', statusCode: 409 });
        expect(h.database.assistantMessage.create).not.toHaveBeenCalled();
    });

    it('no valida ni entrega fuentes de una conversación de otro principal', async () => {
        const h = harness(); h.seed();
        await expect(getAssistantConversation({ ...principal, tenantId: 'tenant-b' }, h.conversation.id, h.db)).rejects.toMatchObject({ statusCode: 404 });
        expect(help.validate).not.toHaveBeenCalled();
        expect(h.database.assistantMessage.findMany).not.toHaveBeenCalled();
    });

    it('el replay privado revalida las fuentes para su canal antes de renderizar', async () => {
        const h = harness(); h.seed(); help.validate.mockResolvedValue(false);
        const result = await sendAssistantMessage(principal, h.conversation.id, { requestId, text: query }, h.db, { channel: 'WHATSAPP_PRIVATE' });
        expectWithdrawn(result);
        expect(help.validate).toHaveBeenCalledWith(principal, [reference], h.db, 'WHATSAPP_PRIVATE');
        expect(h.database.assistantMessage.create).not.toHaveBeenCalled();
    });
});
