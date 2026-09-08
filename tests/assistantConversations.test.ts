import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createAssistantConversation, getAssistantConversation, sendAssistantMessage,
} from '../backend/services/assistant/conversations';

const principal = { tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER' };
const requestId = '750ad35c-108b-4a01-912f-ec0c336a5463';
function harness() {
    const conversation = { id: 'conversation-a', ...principal, roleAtCreation: 'OWNER', expiresAt: new Date(Date.now() + 86_400_000),metadata:null as unknown,stateVersion:0 };
    const messages: any[] = [];
    const mocks = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' }) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
        assistantProposal:{findFirst:vi.fn().mockResolvedValue(null)},
        assistantConversation: {
            create: vi.fn().mockResolvedValue(conversation),
            findFirst: vi.fn(async ({ where }) => Object.entries(where).every(([key, value]) => key === 'expiresAt'
                ? conversation.expiresAt > (value as { gt: Date }).gt
                : conversation[key as keyof typeof conversation] === value) ? {...conversation} : null),
            updateMany:vi.fn(async({where,data})=>{if(where.stateVersion!==conversation.stateVersion)return{count:0};conversation.metadata=data.metadata;conversation.stateVersion++;return{count:1};}),
        },
        assistantMessage: {
            findMany: vi.fn(async ({ where, orderBy, take }) => {
                const selected = messages.filter(message => Object.entries(where).every(([key, value]) => message[key] === value));
                return (orderBy ? selected.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : selected).slice(0, take);
            }),
            create: vi.fn(async ({ data }) => {
                const message = { id: `message-${messages.length + 1}`, ...data, createdAt: data.createdAt || new Date() };
                messages.push(message);
                return message;
            }),
        },
        $queryRaw: vi.fn(async (_sql:unknown)=>[{ id: 'conversation-a',stateVersion:conversation.stateVersion }]),
        $transaction: vi.fn(),
    };
    mocks.$transaction.mockImplementation(async fn => fn(mocks));
    return { db: mocks as unknown as PrismaClient, mocks, conversation, messages };
}

beforeEach(() => vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('NortexGPT: conversaciones privadas y persistencia idempotente', () => {
    it('crea conversación vinculada a principal y expira a 30 días', async () => {
        const { db, mocks } = harness();
        const before = Date.now();
        expect(await createAssistantConversation(principal, db)).toEqual({ id: 'conversation-a', messages: [] });
        const data = mocks.assistantConversation.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ tenantId: 'tenant-a', userId: 'user-a', roleAtCreation: 'OWNER' });
        expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 86_400_000);
        expect(data.expiresAt.getTime() - before).toBeLessThan(30 * 86_400_000 + 1000);
    });
    it.each([
        { tenantId: 'tenant-b' }, { userId: 'user-b' }, { role: 'CASHIER' },
    ])('otro principal no obtiene el historial %j', async changed => {
        const { db, mocks } = harness();
        const other = { ...principal, ...changed };
        mocks.user.findFirst.mockResolvedValue({ id: other.userId, role: other.role, status: 'ACTIVE' });
        await expect(getAssistantConversation(other, 'conversation-a', db)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.assistantMessage.findMany).not.toHaveBeenCalled();
    });
    it('conversación expirada no devuelve mensajes ni acepta uno nuevo', async () => {
        const { db, conversation, mocks } = harness();
        conversation.expiresAt = new Date(Date.now() - 1000);
        await expect(getAssistantConversation(principal, 'conversation-a', db)).rejects.toMatchObject({ statusCode: 404 });
        await expect(sendAssistantMessage(principal, 'conversation-a', { requestId, text: 'Hola' }, db)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.assistantMessage.create).not.toHaveBeenCalled();
    });
    it('respuesta e input quedan juntos; repetir request devuelve comprobante sin otra escritura', async () => {
        const { db, mocks, messages } = harness();
        const input = { requestId, text: 'Ayuda sobre facturas de compras' };
        const first = await sendAssistantMessage(principal, 'conversation-a', input, db);
        expect(first).toMatchObject({ role: 'assistant', text: expect.stringContaining('proveedor'), citations: expect.arrayContaining([expect.objectContaining({ id: 'compras' })]) });
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({ role: 'user', tenantId: 'tenant-a', userId: 'user-a', conversationId: 'conversation-a', requestId });
        expect(messages[1]).toMatchObject({ role: 'assistant', tenantId: 'tenant-a', userId: 'user-a', conversationId: 'conversation-a', requestId });
        expect(mocks.$transaction).toHaveBeenCalledTimes(1);
        expect(await sendAssistantMessage(principal, 'conversation-a', input, db)).toEqual(first);
        expect(mocks.assistantMessage.create).toHaveBeenCalledTimes(2);
    });
    it('mismo identificador con texto diferente devuelve conflicto sin reescribir el historial', async () => {
        const { db, mocks } = harness();
        await sendAssistantMessage(principal, 'conversation-a', { requestId, text: 'Hola NortexGPT' }, db);
        await expect(sendAssistantMessage(principal, 'conversation-a', { requestId, text: 'Otro texto' }, db)).rejects.toMatchObject({ code: 'ASSISTANT_REQUEST_CONFLICT', statusCode: 409 });
        expect(mocks.assistantMessage.create).toHaveBeenCalledTimes(2);
    });
    it('no acepta historial, tenant ni contenido del asistente del navegador', async () => {
        const { db, mocks } = harness();
        for (const extra of [{ tenantId: 'tenant-b' }, { history: [] }, { role: 'assistant' }]) {
            await expect(sendAssistantMessage(principal, 'conversation-a', { requestId, text: 'Hola', ...extra }, db)).rejects.toThrow();
        }
        expect(mocks.assistantMessage.create).not.toHaveBeenCalled();
    });
    it('lectura limita a 50 y ordena por tiempo, aislando el mensaje ajeno', async () => {
        const { db, messages, mocks } = harness();
        for (let i = 0; i < 60; i++) messages.push({
            id: `m-${i}`, tenantId: 'tenant-a', userId: 'user-a', conversationId: 'conversation-a', requestId: `r-${i}`,
            role: 'user', content: { text: `Texto ${i}` }, createdAt: new Date(2026, 8, 1, 1, i),
        });
        messages.push({ id: 'foreign', tenantId: 'tenant-b', userId: 'user-b', conversationId: 'conversation-a', role: 'assistant', content: { text: 'confidencial' }, createdAt: new Date() });
        const result = await getAssistantConversation(principal, 'conversation-a', db);
        expect(result.messages).toHaveLength(50);
        expect(result.messages[0].text).toBe('Texto 10');
        expect(result.messages[49].text).toBe('Texto 59');
        expect(mocks.assistantMessage.findMany.mock.calls[0][0]).toMatchObject({ take: 50, where: { tenantId: 'tenant-a', userId: 'user-a', conversationId: 'conversation-a' } });
    });
    it('una orden por chat explica confirmación sin ejecutar compras', async () => {
        const { db, mocks } = harness();
        const result = await sendAssistantMessage(principal, 'conversation-a', { requestId, text: 'Registrá esta compra' }, db);
        expect(result.text).toContain('completar los datos por aquí');
        expect(result.purchaseIntake?.phase).toBe('CHOOSE_INPUT');
        expect(mocks.$queryRaw).toHaveBeenCalledTimes(1);
        expect((mocks.$queryRaw.mock.calls[0][0] as {sql:string}).sql).toContain('AssistantConversation');
    });
    it('revocación detectada dentro de la transacción bloquea la persistencia', async () => {
        const { db, mocks } = harness();
        mocks.user.findFirst.mockResolvedValueOnce({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' })
            .mockResolvedValueOnce({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' }).mockResolvedValue(null);
        await expect(sendAssistantMessage(principal, 'conversation-a', { requestId, text: 'Hola' }, db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        expect(mocks.assistantMessage.create).not.toHaveBeenCalled();
    });
    it.each(['COMMITTED','CANCELLED','EXPIRED','MISSING'])('no revive captura con propuesta %s al recuperar conversación',async status=>{
        const h=harness();h.conversation.metadata={purchaseIntake:{id:requestId,phase:'REVIEW',mode:'MANUAL',facts:{items:[{description:'cemento',quantity:'50'}]},proposalId:'proposal-a',proposalVersion:1,evidence:[]}};
        h.mocks.assistantProposal.findFirst.mockResolvedValue(status==='MISSING'?null:{id:'proposal-a',status,expiresAt:new Date(status==='EXPIRED'?Date.now()-1000:Date.now()+86400_000)});
        expect(await getAssistantConversation(principal,'conversation-a',h.db)).toMatchObject({purchaseIntake:null,actions:[]});
    });
    it('recuperar conversación presenta la cantidad revisada sin reescribir historial ni captura',async()=>{
        const h=harness();h.conversation.metadata={purchaseIntake:{id:requestId,phase:'REVIEW',mode:'MANUAL',facts:{items:[{productId:'product-a',description:'cemento',quantity:'50',unitText:'bolsas',baseUnit:'bolsas'}]},proposalId:'proposal-a',proposalVersion:1,evidence:[]}};
        const metadata=structuredClone(h.conversation.metadata);
        h.messages.push({id:'historical',tenantId:principal.tenantId,userId:principal.userId,conversationId:'conversation-a',requestId,role:'user',content:{text:'Compré 50 bolsas de cemento'},createdAt:new Date()});
        h.mocks.assistantProposal.findFirst.mockResolvedValue({id:'proposal-a',status:'DRAFT',version:2,expiresAt:new Date(Date.now()+86400_000),
            source:{kind:'MANUAL',origin:'NORTEX_CHAT',conversationId:'conversation-a',intakeId:requestId,evidence:[{requestId,field:'purchase',suppliedText:'Compré 50 bolsas de cemento'}]},
            draft:{currency:'NIO',invoiceNumber:'F-1',date:'2026-09-05',receivedConfirmed:true,paymentConfirmed:false,documentTotal:'13225',warnings:[],items:[{productId:'product-a',description:'cemento',quantity:'60',unitCost:'230',purchaseUnit:'BASE'}]},attachmentIds:[],issues:[]});
        const result=await getAssistantConversation(principal,'conversation-a',h.db);
        expect(result.purchaseIntake?.summary).toBe('60 bolsas de cemento');expect(result.messages[0].text).toBe('Compré 50 bolsas de cemento');
        expect(h.conversation.metadata).toEqual(metadata);expect(h.mocks.assistantConversation.updateMany).not.toHaveBeenCalled();expect(h.mocks.assistantMessage.create).not.toHaveBeenCalled();
        expect(h.mocks.assistantProposal.findFirst.mock.calls[0][0].where).toMatchObject({id:'proposal-a',tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role});
    });
    it.each(['MISSING','EXPIRED'])('un borrador %s no impide mensajes ni otra captura',async status=>{
        const h=harness();h.conversation.metadata={purchaseIntake:{id:requestId,phase:'REVIEW',mode:'MANUAL',facts:{items:[{description:'cemento',quantity:'50'}]},proposalId:'proposal-a',proposalVersion:1,evidence:[]}};
        h.mocks.assistantProposal.findFirst.mockResolvedValue(status==='MISSING'?null:{id:'proposal-a',status:'DRAFT',expiresAt:new Date(Date.now()-1000)});
        const answer=await sendAssistantMessage(principal,'conversation-a',{requestId,text:'sí'},h.db);
        expect(answer).toMatchObject({text:expect.stringContaining('venció'),purchaseIntake:null,actions:[]});
        expect(h.conversation.metadata).toMatchObject({purchaseIntake:null});
        const next=await sendAssistantMessage(principal,'conversation-a',{requestId:'f56d994e-1777-40d4-b8bb-1e8d0afdc2f9',text:'compré 60 bolsas de cemento'},h.db);
        expect(next.purchaseIntake?.summary).toContain('60 bolsas');
    });
    it('estado distinto al preparado rechaza el turno sin escribir mensajes',async()=>{
        const h=harness();h.mocks.$queryRaw.mockResolvedValue([{id:'conversation-a',stateVersion:1}]);
        await expect(sendAssistantMessage(principal,'conversation-a',{requestId,text:'compré 50 bolsas de cemento'},h.db)).rejects.toMatchObject({code:'INTAKE_CHANGED'});
        expect(h.mocks.assistantMessage.create).not.toHaveBeenCalled();expect(h.mocks.assistantConversation.updateMany).not.toHaveBeenCalled();
    });
});
