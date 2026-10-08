import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AssistantActionProposal } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { assertAssistantAccess,getAssistantCapabilities } from '../access.js';
import { purchasePayloadHash } from '../../purchaseRegistrationAuthority.js';
import type { AssistantActionKind, AssistantActionProposalDTO, AssistantActionResult, AssistantJsonObject } from '../../../../shared/assistantOperations.js';
import { purchaseOrderAdapter, batchWriteoffAdapter, supplierReturnAdapter } from './adapters.js';
import { ACTION_KINDS, AssistantActionError, type AssistantActionAdapter, type ActionPrincipal } from './types.js';
export { AssistantActionError } from './types.js';

type Database = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const scope = (principal: ActionPrincipal) => ({tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: principal.role});
const key = (value: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) throw new AssistantActionError('ACTION_INVALID_KEY', 400, 'El identificador de esta solicitud no es válido.');
  return value;
};
const validVersion = (version: number) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new AssistantActionError('ACTION_INVALID_VERSION', 400, 'La versión de la propuesta no es válida.');
};
const changed = (): never => {throw new AssistantActionError('ACTION_CHANGED', 409, 'La propuesta cambió o dejó de estar disponible. Actualizala antes de continuar.');};
const conflict = (): never => {throw new AssistantActionError('ACTION_IDEMPOTENCY_CONFLICT', 409, 'Este identificador corresponde a otra solicitud. Conservá la referencia original.');};
function receiptResult(receipt: {id: string; kind: string; resultJson: unknown}): AssistantActionResult {
  const stored = receipt.resultJson as Partial<AssistantActionResult> | null;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || stored.id !== receipt.id || stored.kind !== receipt.kind
    || typeof stored.message !== 'string' || !stored.message || stored.message.length > 1000
    || stored.resourceId !== undefined && (typeof stored.resourceId !== 'string' || !stored.resourceId || stored.resourceId.length > 191)) {
    throw new AssistantActionError('ACTION_RESULT_UNAVAILABLE', 409, 'El comprobante necesita revisión. No vuelvas a registrar la operación.');
  }
  return {id: receipt.id, kind: stored.kind, message: stored.message, ...(stored.resourceId ? {resourceId: stored.resourceId} : {}), replayed: true};
}

async function adapterFor(kind: string): Promise<AssistantActionAdapter> {
  if (!ACTION_KINDS.includes(kind as AssistantActionKind)) throw new AssistantActionError('ACTION_KIND_INVALID', 400, 'Esta acción no está disponible.');
  if (kind === 'PURCHASE_ORDER_DRAFT') return purchaseOrderAdapter;
  if (kind === 'BATCH_WRITEOFF') return batchWriteoffAdapter;
  if (kind === 'SUPPLIER_RETURN') return supplierReturnAdapter;
  return (await import('./promotion.js')).promotionActionAdapter;
}

async function authorize(principal: ActionPrincipal, adapter: AssistantActionAdapter, db: Database, confirm = false, lock = false) {
  if (!adapter.roles.includes(principal.role)) throw new AssistantActionError('ACTION_FORBIDDEN', 403, 'Tu rol no tiene permiso para esta acción.');
  if (lock) {
    const users = await db.$queryRaw<Array<{id: string; role: string; status: string}>>`SELECT id, role, status FROM \`User\` WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`;
    if (!users[0] || users[0].role !== principal.role || users[0].status !== 'ACTIVE') throw new AssistantActionError('ACTION_SESSION_REVOKED', 403, 'Tu sesión o permiso cambió. Volvé a ingresar.');
    // Serializa la desactivación del negocio con las mutaciones ya autorizadas.
    await db.$queryRaw`SELECT tenantId FROM \`AssistantTenantConfig\` WHERE tenantId = ${principal.tenantId} FOR UPDATE`;
  }
  await assertAssistantAccess(principal, confirm ? 'actionConfirm' : 'actionPrepare', db as PrismaClient);
}

async function owned(principal: ActionPrincipal, id: string, db: Database) {
  const row = await db.assistantActionProposal.findFirst({where: {id, ...scope(principal)}});
  if (!row) throw new AssistantActionError('ACTION_NOT_FOUND', 404, 'No se encontró esta propuesta en tu sesión.');
  return row;
}

async function dto(row: AssistantActionProposal, db: Database): Promise<AssistantActionProposalDTO> {
  const wrapper = row.previewJson as null | {issues?: string[]; preview?: AssistantActionProposalDTO['preview']};
  let result: AssistantActionResult | undefined;
  if (row.status === 'COMMITTED' && row.operationId) {
    const receipt = await db.assistantActionCommand.findFirst({where: {id: row.operationId, tenantId: row.tenantId, userId: row.userId, proposalId: row.id, proposalVersion: row.version, kind: row.kind}});
    if (!receipt?.resultJson) throw new AssistantActionError('ACTION_RESULT_UNAVAILABLE', 409, 'La operación requiere revisar su comprobante. No la vuelvas a registrar.');
    result = receiptResult(receipt);
  }
  return {id: row.id, kind: row.kind as AssistantActionKind, version: row.version,
    status: !['COMMITTED', 'CANCELLED'].includes(row.status) && row.expiresAt <= new Date() ? 'EXPIRED' : row.status as AssistantActionProposalDTO['status'],
    draft: row.draftJson as AssistantJsonObject, issues: wrapper?.issues ?? ['Revisá los datos y sus efectos antes de confirmar.'], preview: wrapper?.preview ?? null,
    expiresAt: row.expiresAt.toISOString(), ...(result ? {result} : {})};
}

export async function prepareAssistantAction(principal: ActionPrincipal, kind: AssistantActionKind, raw: unknown, requestKey: string, db: PrismaClient = prisma, context:{runId?:string}={}) {
  const adapter = await adapterFor(kind);
  await authorize(principal, adapter, db);
  const draft = adapter.parseDraft(raw);
  // Una herramienta del modelo sólo prepara: no certifica una entrega física.
  if (kind === 'BATCH_WRITEOFF') draft.physicalRemovalConfirmed = false;
  if (kind === 'SUPPLIER_RETURN') draft.physicalShipmentConfirmed = false;
  const canonicalKey = key(requestKey), payloadHash = purchasePayloadHash({kind, draft});
  const replay = async () => {
    const existing = await db.assistantActionProposal.findFirst({where: {tenantId: principal.tenantId, userId: principal.userId, requestKey: canonicalKey}});
    if (!existing) return null;
    if (existing.roleAtCreation !== principal.role || existing.kind !== kind || existing.payloadHash !== payloadHash || (existing.runId??null)!==(context.runId??null)) conflict();
    return dto(existing, db);
  };
  const existing = await replay();
  if (existing) return existing;
  try {
    const row = await db.$transaction(async tx => {
      await authorize(principal, adapter, tx, false, true);
      if(context.runId) {
        // El estado y el vínculo se confirman bajo el mismo lock que una cancelación.
        const runs=await tx.$queryRaw<Array<{id:string;conversationId:string;status:string;leaseToken:string|null;leaseUntil:Date|null;deadlineAt:Date|null;expiresAt:Date}>>(Prisma.sql`SELECT id,conversationId,status,leaseToken,leaseUntil,deadlineAt,expiresAt FROM AssistantRun WHERE id=${context.runId} AND tenantId=${principal.tenantId} AND userId=${principal.userId} AND roleAtCreation=${principal.role} FOR UPDATE`);
        const run=runs[0],now=new Date();
        if(!run||run.status!=='RUNNING'||!run.leaseToken||!run.leaseUntil||run.leaseUntil<=now||!run.deadlineAt||run.deadlineAt<=now||run.expiresAt<=now)throw new AssistantActionError('ACTION_RUN_INACTIVE',409,'La consulta fue cancelada o terminó. No se preparó una nueva acción.');
        await assertAssistantAccess(principal,'operations',tx as PrismaClient);
        const conversation=await tx.assistantConversation.findFirst({where:{id:run.conversationId,...scope(principal),expiresAt:{gt:now}},select:{id:true}});
        if(!conversation)throw new AssistantActionError('ACTION_RUN_INACTIVE',409,'La conversación ya no está disponible.');
      }
      return tx.assistantActionProposal.create({data: {id: randomUUID(), ...scope(principal),...(context.runId?{runId:context.runId}:{}), kind, draftJson: json(draft), requestKey: canonicalKey, payloadHash, expiresAt: new Date(Date.now() + 7 * 86400_000)}});
    }, {isolationLevel: 'ReadCommitted'});
    return dto(row, db);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      await authorize(principal, adapter, db);
      const result = await replay();
      if (result) return result;
    }
    throw error;
  }
}

/** Referencias recuperables incluso cuando el resultado del orquestador no alcanzó a guardarse. */
export async function readAssistantRunActionReferences(principal:ActionPrincipal,runId:string,recordedIds:string[],db:Database) {
  const capabilities=await getAssistantCapabilities(principal,db as PrismaClient);
  if(!capabilities.actionPrepare)return [];
  const allowed:AssistantActionKind[]=[];
  for(const kind of ACTION_KINDS)if((kind!=='PROMOTION'||capabilities.promotionManage)&&(await adapterFor(kind)).roles.includes(principal.role))allowed.push(kind);
  const rows=await db.assistantActionProposal.findMany({where:{...scope(principal),kind:{in:allowed},AND:[{OR:[{runId},{id:{in:recordedIds.slice(0,8)}}]},{OR:[{status:'COMMITTED'},{status:{in:['DRAFT','READY']},expiresAt:{gt:new Date()}}]}]},select:{id:true},orderBy:[{createdAt:'asc'},{id:'asc'}],take:8});
  const current=await getAssistantCapabilities(principal,db as PrismaClient);
  return current.actionPrepare&&current.promotionManage===capabilities.promotionManage?rows.map(row=>row.id):[];
}

export async function getAssistantAction(principal: ActionPrincipal, id: string, db: PrismaClient = prisma) {
  const row = await owned(principal, id, db);
  await authorize(principal, await adapterFor(row.kind), db);
  return dto(row, db);
}

export async function reviseAssistantAction(principal: ActionPrincipal, id: string, version: number, raw: unknown, db: PrismaClient = prisma) {
  validVersion(version);
  const current = await owned(principal, id, db);
  const adapter = await adapterFor(current.kind);
  await authorize(principal, adapter, db);
  const draft = adapter.parseDraft(raw);
  const row = await db.$transaction(async tx => {
    await authorize(principal, adapter, tx, false, true);
    const result = await tx.assistantActionProposal.updateMany({where: {id, ...scope(principal), version, status: {in: ['DRAFT', 'READY']}, expiresAt: {gt: new Date()}}, data: {
      draftJson: json(draft), version: {increment: 1}, status: 'DRAFT', previewHash: null, previewJson: Prisma.DbNull,
    }});
    if (result.count !== 1) changed();
    return owned(principal, id, tx);
  }, {isolationLevel: 'ReadCommitted'});
  return dto(row, db);
}

function issueMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') return 'Completá los campos requeridos con cantidades y fechas válidas.';
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    && ('httpStatus' in error && typeof error.httpStatus === 'number' && error.httpStatus >= 400 && error.httpStatus < 500
      || 'name' in error && ['QuantityValidationError', 'PurchaseOrderQuantityError', 'PeriodLockedError'].includes(String(error.name)))) return error.message;
  return 'No pudimos verificar esta acción con sus documentos, existencias o configuración. Revisala en el módulo correspondiente.';
}

export async function previewAssistantAction(principal: ActionPrincipal, id: string, version: number, db: PrismaClient = prisma) {
  validVersion(version);
  const current = await owned(principal, id, db), adapter = await adapterFor(current.kind);
  await authorize(principal, adapter, db);
  const row = await db.$transaction(async tx => {
    await authorize(principal, adapter, tx, false, true);
    await tx.$queryRaw`SELECT id FROM \`AssistantActionProposal\` WHERE id = ${id} AND tenantId = ${principal.tenantId} AND userId = ${principal.userId} FOR UPDATE`;
    const proposal = await owned(principal, id, tx);
    if (proposal.version !== version || !['DRAFT', 'READY'].includes(proposal.status) || proposal.expiresAt <= new Date()) changed();
    const draft = adapter.parseDraft(proposal.draftJson);
    let preview: AssistantActionProposalDTO['preview'] = null, previewHash: string | null = null;
    let issues: string[];
    try {
      const prepared = await adapter.prepare(principal, draft, tx);
      preview = prepared.preview; issues = prepared.issues;
      previewHash = purchasePayloadHash({kind: proposal.kind, draft, domainHash: prepared.hash});
    } catch (error) {
      if (error && typeof error === 'object' && ('httpStatus' in error && error.httpStatus === 403 || 'statusCode' in error && error.statusCode === 403)) throw error;
      issues = [issueMessage(error)];
    }
    const update = await tx.assistantActionProposal.updateMany({where: {id, ...scope(principal), version, status: {in: ['DRAFT', 'READY']}, expiresAt: {gt: new Date()}}, data: {
      previewJson: json({issues, preview}), previewHash, version: {increment: 1}, status: preview && !issues.length ? 'READY' : 'DRAFT',
    }});
    if (update.count !== 1) changed();
    return owned(principal, id, tx);
  }, {isolationLevel: 'ReadCommitted'});
  return dto(row, db);
}

export async function confirmAssistantAction(principal: ActionPrincipal, id: string, version: number, requestKey: string, db: PrismaClient = prisma): Promise<AssistantActionResult> {
  validVersion(version); key(requestKey);
  const current = await owned(principal, id, db), adapter = await adapterFor(current.kind);
  await authorize(principal, adapter, db, true);
  const run = () => db.$transaction(async tx => {
    await authorize(principal, adapter, tx, true, true);
    await tx.$queryRaw`SELECT id FROM \`AssistantActionProposal\` WHERE id = ${id} AND tenantId = ${principal.tenantId} AND userId = ${principal.userId} FOR UPDATE`;
    const row = await owned(principal, id, tx);
    if (row.version !== version) changed();
    const payloadHash = purchasePayloadHash({userId: principal.userId, proposalId: id, version, kind: row.kind, previewHash: row.previewHash});
    const command = await tx.assistantActionCommand.findFirst({where: {tenantId: principal.tenantId, requestKey}});
    if (command) {
      if (command.userId !== principal.userId || command.proposalId !== id || command.proposalVersion !== version || command.payloadHash !== payloadHash || !command.resultJson) conflict();
      return receiptResult(command);
    }
    if (row.status === 'COMMITTED') {
      const completed = await dto(row, tx);
      if (!completed.result) conflict();
      return {...completed.result, replayed: true};
    }
    if (row.status !== 'READY' || !row.previewHash || row.expiresAt <= new Date()) changed();
    const draft = adapter.parseDraft(row.draftJson);
    const prepared = await adapter.prepare(principal, draft, tx);
    if (prepared.issues.length || purchasePayloadHash({kind: row.kind, draft, domainHash: prepared.hash}) !== row.previewHash) throw new AssistantActionError('ACTION_REVIEW_STALE', 409, 'Los datos o efectos cambiaron. Volvé a revisar la propuesta.');
    const commandId = randomUUID();
    await tx.assistantActionCommand.create({data: {id: commandId, tenantId: principal.tenantId, userId: principal.userId, requestKey, payloadHash, proposalId: id, proposalVersion: version, kind: row.kind}});
    const executed = await adapter.execute(principal, draft, {tx, requestKey, domainHash: prepared.hash, proposalId: id});
    const result: AssistantActionResult = {id: commandId, kind: row.kind as AssistantActionKind, ...executed, replayed: false};
    const updated = await tx.assistantActionProposal.updateMany({where: {id, ...scope(principal), version, status: 'READY', previewHash: row.previewHash, expiresAt: {gt: new Date()}}, data: {status: 'COMMITTED', operationId: commandId}});
    if (updated.count !== 1) changed();
    await tx.assistantActionCommand.updateMany({where: {id: commandId, tenantId: principal.tenantId, userId: principal.userId, proposalId: id}, data: {resultJson: json(result)}});
    await tx.auditLog.create({data: {tenantId: principal.tenantId, userId: principal.userId, action: 'ASSISTANT_ACTION_COMMITTED', details: JSON.stringify({proposalId: id, version, kind: row.kind, previewHash: row.previewHash, before: {status: 'READY'}, after: {status: 'COMMITTED', operationId: commandId, resourceId: result.resourceId ?? null}})}});
    return result;
  }, {isolationLevel: 'ReadCommitted'});
  try {return await run();} catch (error) {
    // Una colisión de clave entre propuestas no autoriza repetir el dominio.
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'P2002' || error.code === 'P2034')) {
      await authorize(principal, adapter, db, true);
      const winningCommand = await db.assistantActionCommand.findFirst({where: {tenantId: principal.tenantId, requestKey}});
      if (winningCommand && (winningCommand.userId !== principal.userId || winningCommand.proposalId !== id || winningCommand.proposalVersion !== version)) conflict();
      const completed = await owned(principal, id, db);
      if (completed.status === 'COMMITTED' && completed.version === version) {
        const command = await db.assistantActionCommand.findFirst({where: {tenantId: principal.tenantId, requestKey}});
        if (command && (command.userId !== principal.userId || command.proposalId !== id || command.proposalVersion !== version)) conflict();
        const result = (await dto(completed, db)).result;
        if (result) return result;
      }
    }
    throw error;
  }
}
