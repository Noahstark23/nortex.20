import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import type { AssistantConversationDTO, AssistantMessageDTO, AssistantPrincipal,AssistantProposalDTO,InvoiceDraft } from '../../../shared/assistant.js';
import { assertAssistantAccess, AssistantAccessError,getAssistantCapabilities } from './access.js';
import { normalizeAssistantText, retrieveAssistantHelp } from './knowledge.js';
import { getAssistantOverview, getAssistantPeriod, type AssistantOverviewTopic } from './overview.js';
import { createAssistantLanguage, type AssistantReadPlan } from './language.js';
import { advancePurchaseIntake, applyIntakeDraftCorrection, purchaseIntakePresentation, type PurchaseIntakeTurn } from './purchaseIntake.js';
import { readPurchaseIntake,type PurchaseIntake } from './purchaseIntakeTypes.js';
import { isPurchaseNarration, isCancelIntake,isManualChoice } from './purchaseIntakeParsing.js';
import {readManualPurchaseSource} from './purchaseSource.js';
import {invoiceDraftSchema} from './proposalValidation.js';
import { shouldUseOperationalRun } from './operations/routing.js';
import { createAssistantRunInTransaction,processAssistantRun } from './operations/runService.js';

export const assistantMessageInputSchema = z.object({
    requestId: z.string().uuid(), text: z.string().trim().min(1).max(4000),
}).strict();

const storedContentSchema = z.object({
    text: z.string(),
    citations: z.array(z.object({ id: z.string(), title: z.string(), section: z.string(), version: z.string(), path: z.string() })).optional(),
    actions:z.array(z.object({type:z.enum(['UPLOAD_INVOICE','CONTINUE_PURCHASE','REVIEW_PURCHASE']),label:z.string(),proposalId:z.string().optional()})).optional(),
    proposalId:z.string().optional(),
    operationalRunId:z.string().optional(),
    purchaseIntake:z.object({id:z.string(),summary:z.string(),phase:z.enum(['CHOOSE_INPUT','COLLECTING','REVIEW']),missing:z.array(z.string())}).nullable().optional(),
    overview: z.object({
        checkedAt: z.string(), startDate: z.string(), endDate: z.string(), scope: z.string(),
        metrics: z.array(z.object({
            key: z.string(), label: z.string(), value: z.string().nullable(), unit: z.enum(['money', 'count']),
            status: z.enum(['ok', 'unavailable']), source: z.string(),
        })),
    }).optional(),
});

type StoredMessage = { id: string; role: string; content: unknown; createdAt: Date };

function messageDTO(message: StoredMessage): AssistantMessageDTO {
    if (message.role !== 'user' && message.role !== 'assistant') throw new Error('Invalid stored assistant message role');
    const content = storedContentSchema.parse(message.content);
    return {
        id: message.id, role: message.role, text: content.text, citations: content.citations,
        ...(content.actions?{actions:content.actions}:{}),...(content.proposalId?{proposalId:content.proposalId}:{}),
        ...(content.operationalRunId?{operationalRunId:content.operationalRunId}:{}),
        ...(content.purchaseIntake!==undefined?{purchaseIntake:content.purchaseIntake}:{}),
        ...(content.overview ? { overview: { ...content.overview, metrics: content.overview.metrics.map(metric => ({ ...metric, value: metric.value ?? null })) } } : {}),
        createdAt: message.createdAt.toISOString(),
    };
}

async function requireConversation(principal: AssistantPrincipal, id: string, db: PrismaClient) {
    await assertAssistantAccess(principal, 'help', db);
    const conversation = await db.assistantConversation.findFirst({
        where: { id, tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: principal.role, expiresAt: { gt: new Date() } },
    });
    if (!conversation) throw new AssistantAccessError(404, 'ASSISTANT_CONVERSATION_NOT_FOUND', 'Esta conversación no está disponible. Abrí una nueva.');
    return conversation;
}

export async function createAssistantConversation(principal: AssistantPrincipal, db: PrismaClient = prisma): Promise<AssistantConversationDTO> {
    await assertAssistantAccess(principal, 'help', db);
    const conversation = await db.assistantConversation.create({ data: {
        tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: principal.role,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
    } });
    return { id: conversation.id, messages: [] };
}

/** Sólo hidrata la copia leída para presentar/revisar; no cambia la evidencia ni persiste la captura. */
function hydrateManualIntake(state:PurchaseIntake,draft:InvoiceDraft,version:number) {
    state.facts={...state.facts,supplierId:draft.supplierId,supplierName:draft.supplierName,invoiceNumber:draft.invoiceNumber,date:draft.date,currency:draft.currency,
        documentTotal:draft.documentTotal||undefined,paymentMethod:draft.paymentMethod,dueDate:draft.dueDate,warehouseId:draft.warehouseId,
        receivedConfirmed:draft.receivedConfirmed,paymentConfirmed:draft.paymentConfirmed,
        items:draft.items.map((line,index)=>({...((state.facts.items[index]?.productId===line.productId)?state.facts.items[index]:{}),
            productId:line.productId,description:line.description,quantity:line.quantity||undefined,unitCost:line.unitCost||undefined,purchaseUnit:line.purchaseUnit,batchNumber:line.batchNumber,expiryDate:line.expiryDate}))};
    state.mode='MANUAL';state.proposalVersion=version;
    return {schemaVersion:1,purchaseIntake:state};
}

export async function getAssistantConversation(principal: AssistantPrincipal, id: string, db: PrismaClient = prisma): Promise<AssistantConversationDTO> {
    const conversation=await requireConversation(principal, id, db);
    const messages = await db.assistantMessage.findMany({
        where: { tenantId: principal.tenantId, userId: principal.userId, conversationId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
    });
    await assertAssistantAccess(principal, 'help', db);
    const intake=readPurchaseIntake(conversation.metadata);
    if(intake?.proposalId)await assertAssistantAccess(principal,'invoiceRead',db);
    const proposal=intake?.proposalId?await db.assistantProposal.findFirst({where:{id:intake.proposalId,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role},select:{status:true,expiresAt:true,draft:true,source:true,version:true}}):null;
    const consumed=intake?.proposalId&&(!proposal||!['DRAFT','READY'].includes(proposal.status)||proposal.expiresAt<=new Date());
    const presentationMetadata=!consumed&&intake&&proposal&&readManualPurchaseSource(proposal.source)
        ?hydrateManualIntake(intake,invoiceDraftSchema.parse(proposal.draft),proposal.version):conversation.metadata;
    return { id, messages: messages.reverse().map(messageDTO),...purchaseIntakePresentation(consumed?null:presentationMetadata) };
}

/** Solo intenciones cerradas. El texto nunca decide identidad, SQL ni ejecución. */
export function getAssistantIntent(text: string): 'help' | AssistantOverviewTopic | 'restricted' | 'prepare' | 'purchase_intake' {
    const normalized = normalizeAssistantText(text);
    if (/\b(otro negocio|otro tenant|otras empresas|otro usuario|ignora[r]? .*instrucciones|ignora .*permisos)\b/.test(normalized)) return 'restricted';
    if (/\b(como|ayuda|explica[rm]?e?|pasos|donde)\b/.test(normalized) && !/como (va|vamos|esta)/.test(normalized)) return 'help';
    if(isPurchaseNarration(text))return 'purchase_intake';
    if(isManualChoice(text))return 'prepare';
    if (/\b(registra[r]?|agrega[r]?|ejecuta[r]?|elimina[r]?|borra[r]?|paga[r]?|confirma[r]?)\b/.test(normalized)) return 'prepare';
    if (/\b(ventas|vend[ií]|vendimos|facturamos)\b/.test(normalized)) return 'sales';
    if (/\b(gastos|gastamos|egresos)\b/.test(normalized)) return 'expenses';
    if (/\b(cobrar|pagar|deuda|cuentas pendientes|saldo|saldos)\b/.test(normalized)) return 'balances';
    if (/\b(inventario|existencias|stock|lotes|vencimientos|vencidos|vencer)\b/.test(normalized)) return 'inventory';
    if (/\b(como va|como vamos|como esta|resumen|negocio|ganancia|utilidad|compras)\b/.test(normalized)) return 'all';
    return 'help';
}

export function getAssistantMessagePeriod(text: string, now = new Date()): { startDate?: string; endDate?: string } | null {
    const normalized = normalizeAssistantText(text);
    const dates = normalized.match(/\d{4}-\d{2}-\d{2}/g) || [];
    if (dates.length === 1) return { startDate: dates[0], endDate: dates[0] };
    if (dates.length === 2) return { startDate: dates[0], endDate: dates[1] };
    if (dates.length > 2) return null;
    const today = getAssistantPeriod({}, now).endDate;
    if (/\bayer\b/.test(normalized)) {
        const date = new Date(`${today}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() - 1);
        return { startDate: date.toISOString().slice(0, 10), endDate: date.toISOString().slice(0, 10) };
    }
    if (/\bhoy\b/.test(normalized)) return { startDate: today, endDate: today };
    if (/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|semana|anual|ano|pasado|pasada|dias|ultimo|ultima|ultimos|ultimas)\b/.test(normalized)) return null;
    return {};
}

async function answerMessage(principal: AssistantPrincipal, text: string, db: PrismaClient, plan:AssistantReadPlan|null): Promise<z.infer<typeof storedContentSchema>> {
    const fixedIntent = getAssistantIntent(text);
    // El modelo interpreta lenguaje; los servicios mantienen permisos, datos y efectos.
    const intent = plan?.intent ?? fixedIntent;
    if (intent === 'restricted') return { text: 'Solo puedo consultar información de tu negocio autorizada para tu rol. No puedo cambiar permisos ni acceder a otras personas o negocios.' };
    if (intent === 'prepare'||intent==='purchase_intake') return { text: 'Contame qué compraste para preparar un borrador, o adjuntá la factura. Un mensaje de chat no registra compras ni ejecuta pagos o cambios.' };
    if (intent === 'help') return retrieveAssistantHelp(plan?.query ?? text, principal.role);
    const period = plan?.startDate && plan?.endDate ? {startDate:plan.startDate,endDate:plan.endDate} : getAssistantMessagePeriod(text);
    if (period === null) return { text: 'Indicá el período con fechas AAAA-MM-DD, por ejemplo: ventas desde 2026-09-01 hasta 2026-09-05. También podés consultar hoy, ayer o el mes actual.' };
    const overview = await getAssistantOverview(principal, period, db, intent);
    const available = overview.metrics.some(metric => metric.status === 'ok');
    return {
        text: available
            ? 'Estas son las cifras registradas para el período y alcance indicados. Ventas no significa utilidad. Los saldos y existencias identificados como actuales corresponden al momento de consulta.'
            : 'No pude obtener cifras verificables para esta consulta. Los datos no disponibles no deben interpretarse como cero. Intentá de nuevo.',
        overview,
    };
}

function replayMessage(messages: StoredMessage[], text: string): AssistantMessageDTO | null {
    const user = messages.find(message => message.role === 'user');
    const answer = messages.find(message => message.role === 'assistant');
    if (user && storedContentSchema.parse(user.content).text !== text) {
        throw new AssistantAccessError(409, 'ASSISTANT_REQUEST_CONFLICT', 'Este identificador ya corresponde a otro mensaje.');
    }
    if (answer && !user) throw new Error('Missing paired assistant input');
    return answer ? messageDTO(answer) : null;
}

export async function sendAssistantMessage(
    principal: AssistantPrincipal, conversationId: string, input: unknown, db: PrismaClient = prisma,
    dependencies:{startRun?:(principal:AssistantPrincipal,id:string,db:PrismaClient)=>Promise<unknown>}={},
): Promise<AssistantMessageDTO> {
    const { requestId, text } = assistantMessageInputSchema.parse(input);
    const conversation=await requireConversation(principal, conversationId, db);
    const where = { tenantId: principal.tenantId, userId: principal.userId, conversationId, requestId };
    const existing = await db.assistantMessage.findMany({ where, take: 2 });
    const replay = replayMessage(existing, text);
    if (replay) {
        await assertAssistantAccess(principal, 'help', db);
        return replay;
    }
    const fixedIntent=getAssistantIntent(text);
    const activeIntake=readPurchaseIntake(conversation.metadata);
    const lastExchange=activeIntake&&process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED==='true'
      ?await db.assistantMessage.findMany({where:{tenantId:principal.tenantId,userId:principal.userId,conversationId,role:'assistant'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1}):[];
    const lastExchangeOperational=!!lastExchange[0]&&!!storedContentSchema.parse(lastExchange[0].content).operationalRunId;
    const wantsOperational=fixedIntent!=='restricted'&&shouldUseOperationalRun(text,!!activeIntake,lastExchangeOperational);
    const useOperational=wantsOperational&&process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED==='true'&&Boolean((await getAssistantCapabilities(principal,db)).operations);
    const historyRows = !useOperational&&process.env.NORTEX_ASSISTANT_LANGUAGE_ENABLED === 'true'
      ? await db.assistantMessage.findMany({where:{tenantId:principal.tenantId,userId:principal.userId,conversationId,role:'user'},orderBy:{createdAt:'desc'},take:4}) : [];
    const history = historyRows.reverse().map(row => storedContentSchema.parse(row.content).text);
    const plan=useOperational||fixedIntent==='restricted'?null:await createAssistantLanguage({db})(principal,text,history);
    let snapshotMetadata:unknown=conversation.metadata;
    const existingIntake=readPurchaseIntake(snapshotMetadata);
    let proposalSnapshot:AssistantProposalDTO|undefined;
    let clearSnapshot=false;
    let committedReply:Pick<AssistantMessageDTO,'text'|'actions'|'purchaseIntake'|'proposalId'>|undefined;
    if(existingIntake?.proposalId&&!useOperational) {
        const {getProposal}=await import('./proposals.js');
        try {proposalSnapshot=await getProposal(principal,existingIntake.proposalId,db);}
        catch(error){if(!error||typeof error!=='object'||!('code'in error)||!['PROPOSAL_NOT_FOUND','PROPOSAL_EXPIRED'].includes(String(error.code)))throw error;}
        const proposal=proposalSnapshot;
        if(!proposal||proposal.status==='COMMITTED'||proposal.status==='CANCELLED') {
            snapshotMetadata=null;clearSnapshot=true;
            if(fixedIntent!=='purchase_intake'&&!isCancelIntake(text)&&['help','prepare'].includes(fixedIntent))committedReply={text:proposal?.status==='COMMITTED'?'Esta compra ya está registrada. Su comprobante sigue disponible en Compras.':'Este borrador venció o fue cancelado. Contame una nueva compra para empezar otra captura.',purchaseIntake:null,actions:[]};
        } else if(proposal.source==='MANUAL') {
            snapshotMetadata=hydrateManualIntake(existingIntake,proposal.draft,proposal.version);
        } else {
            existingIntake.mode='ATTACHMENT';existingIntake.proposalVersion=proposal.version;
            snapshotMetadata={schemaVersion:1,purchaseIntake:existingIntake};
        }
    }
    if(existingIntake?.phase==='REVIEW'&&fixedIntent==='purchase_intake')snapshotMetadata=null;
    const intake=readPurchaseIntake(snapshotMetadata);
    const continueIntake=!!intake&&['help','prepare','purchase_intake'].includes(fixedIntent);
    const useIntake=!useOperational&&!committedReply&&fixedIntent!=='restricted'&&(continueIntake||fixedIntent==='purchase_intake'||plan?.intent==='purchase_intake'||isManualChoice(text)||(!!existingIntake&&isCancelIntake(text)));
    let intakeTurn:PurchaseIntakeTurn|undefined=useIntake?await advancePurchaseIntake({principal,text,requestId,metadata:snapshotMetadata,languageFacts:plan?.purchaseFacts},db):undefined;
    if(intakeTurn?.reviseProposalId&&proposalSnapshot?.source==='MANUAL')intakeTurn.draft=applyIntakeDraftCorrection(proposalSnapshot.draft,intakeTurn);
    let content:z.infer<typeof storedContentSchema>=useOperational?{text:'Estoy consultando las fuentes autorizadas de tu negocio. Podés revisar el avance aquí.'}:committedReply??(intakeTurn?intakeTurn.content:await answerMessage(principal,text,db,plan));
    await assertAssistantAccess(principal, 'help', db);
    const result = await db.$transaction(async tx => {
        // Serializa duplicados por conversación. Nunca mantiene una llamada IA dentro de la transacción.
        const lock = await tx.$queryRaw<Array<{ id: string;stateVersion:number }>>(Prisma.sql`
            SELECT id,stateVersion FROM AssistantConversation WHERE id = ${conversationId}
            AND tenantId = ${principal.tenantId} AND userId = ${principal.userId}
            AND roleAtCreation = ${principal.role} AND expiresAt > ${new Date()} FOR UPDATE
        `);
        if (!lock.length) throw new AssistantAccessError(404, 'ASSISTANT_CONVERSATION_NOT_FOUND', 'Esta conversación ya no está disponible.');
        const duplicate = replayMessage(await tx.assistantMessage.findMany({ where, take: 2 }), text);
        if (duplicate) return duplicate;
        if((intakeTurn||clearSnapshot)&&(lock[0].stateVersion??0)!==(conversation.stateVersion??0))throw new AssistantAccessError(409,'INTAKE_CHANGED','Otra respuesta cambió la captura. Actualizá la conversación antes de continuar.');
        const currentUser = await tx.user.findFirst({
            where: { id: principal.userId, tenantId: principal.tenantId, role: principal.role, status: 'ACTIVE' }, select: { id: true },
        });
        if (!currentUser) throw new AssistantAccessError(403, 'SESSION_REVOKED', 'Tu sesión cambió. Volvé a ingresar.');
        if(useOperational) {
            const run=await createAssistantRunInTransaction(principal,conversationId,{requestId,text},tx);
            content={...content,operationalRunId:run.id};
        }
        if(intakeTurn) {
            await assertAssistantAccess(principal,'purchasePrepare',tx as PrismaClient);
            if(isCancelIntake(text)&&proposalSnapshot&&['DRAFT','READY'].includes(proposalSnapshot.status)) {
                const {cancelUncommittedProposal}=await import('./proposals.js');
                await cancelUncommittedProposal(principal,proposalSnapshot.id,proposalSnapshot.version,tx);
            }
            if(intakeTurn.draft&&intakeTurn.state) {
                const state=intakeTurn.state;
                const source={kind:'MANUAL' as const,origin:'NORTEX_CHAT' as const,conversationId,intakeId:state.id,evidence:state.evidence};
                const {createProposalFromManual,updateProposalFromManual}=await import('./proposals.js');
                const proposal=intakeTurn.reviseProposalId
                    ?await updateProposalFromManual(principal,intakeTurn.reviseProposalId,intakeTurn.draft,source,{db:tx,expectedVersion:state.proposalVersion!})
                    :await createProposalFromManual(principal,intakeTurn.draft,source,{db:tx,id:state.id});
                state.proposalId=proposal.id;state.proposalVersion=proposal.version;
                intakeTurn.metadata={schemaVersion:1,purchaseIntake:state};
                content={...content,...purchaseIntakePresentation(intakeTurn.metadata)};
            }
        }
        if(intakeTurn||clearSnapshot) {
            const changed=await tx.assistantConversation.updateMany({where:{id:conversationId,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,stateVersion:conversation.stateVersion??0,expiresAt:{gt:new Date()}},
                data:{stateVersion:{increment:1},metadata:(intakeTurn?.metadata??{schemaVersion:1,purchaseIntake:null}) as Prisma.InputJsonValue}});
            if(changed.count!==1)throw new AssistantAccessError(409,'INTAKE_CHANGED','La captura cambió. Actualizá la conversación.');
        }
        const now = new Date();
        await tx.assistantMessage.create({ data: { ...where, role: 'user', content: { text }, createdAt: now } });
        const answer = await tx.assistantMessage.create({ data: {
            ...where, role: 'assistant', content: JSON.parse(JSON.stringify(content)) as Prisma.InputJsonValue, createdAt: new Date(now.getTime() + 1),
        } });
        return messageDTO(answer);
    });
    await assertAssistantAccess(principal, 'help', db);
    if(result.operationalRunId)void (dependencies.startRun??((actor,id,client)=>processAssistantRun(actor,id,{db:client})))(principal,result.operationalRunId,db).catch(()=>undefined);
    return result;
}
