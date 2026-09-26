import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AssistantWorkItem, type AssistantWorkEvent } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantWorkItemDTO, AssistantWorkItemSummaryDTO, AssistantWorkItemStatus, AssistantWorkItemEventDTO, AssistantWorkItemListDTO } from '../../../../shared/assistantWorkItems.js';
import { assertAssistantAccess } from '../access.js';
import { readWorkItemSource } from './source.js';
import { buildW01Report } from './report.js';
import { AssistantWorkItemError, createWorkItemSchema, listWorkItemsSchema, workItemEventSchema, workItemIdSchema,
  WORK_ITEM_TTL_MS, WORK_ITEM_PAGE_SIZE, WORK_ITEM_EVENT_LIMIT, type WorkItemDatabase, type WorkItemDependencies } from './contracts.js';
export { cleanupAssistantWorkItems } from './cleanup.js';
export { AssistantWorkItemError } from './contracts.js';
export type { WorkItemDependencies } from './contracts.js';

const owner = (p: AssistantPrincipal) => ({ tenantId: p.tenantId, userId: p.userId, roleAtCreation: p.role });
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clock = (deps: WorkItemDependencies) => deps.now ?? (() => new Date());
const notFound = () => new AssistantWorkItemError(404, 'WORK_ITEM_NOT_FOUND', 'No encontramos ese encargo para tu sesión.');

async function authorize(principal: AssistantPrincipal, db: WorkItemDatabase) {
  await assertAssistantAccess(principal, 'operations', db as PrismaClient);
  await assertAssistantAccess(principal, 'cashReview', db as PrismaClient);
}

async function lockAuthority(principal: AssistantPrincipal, tx: Prisma.TransactionClient) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM User WHERE id=${principal.userId} AND tenantId=${principal.tenantId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT tenantId FROM AssistantTenantConfig WHERE tenantId=${principal.tenantId} FOR UPDATE`);
  await authorize(principal, tx);
}

async function findItem(principal: AssistantPrincipal, id: string, db: WorkItemDatabase, now: Date) {
  const row = await db.assistantWorkItem.findFirst({ where: { id, ...owner(principal), expiresAt: { gt: now } } });
  if (!row) throw notFound();
  if (row.kind !== 'W01_CASH_REVIEW' || !['IN_REVIEW', 'WAITING', 'CANCELLED'].includes(row.status)) {
    throw new AssistantWorkItemError(409, 'WORK_ITEM_INVALID', 'El encargo requiere una revisión de su estado guardado.');
  }
  return row;
}

async function presentSummary(principal: AssistantPrincipal, row: AssistantWorkItem, db: WorkItemDatabase, now: Date) {
  const source = await readWorkItemSource(principal, row.runId, db, now, row);
  if (row.expiresAt > source.expiresAt) throw new AssistantWorkItemError(409, 'WORK_ITEM_INVALID', 'La caducidad del encargo no corresponde a su fuente.');
  const dto: AssistantWorkItemSummaryDTO = { id: row.id, kind: 'W01_CASH_REVIEW', status: row.status as AssistantWorkItemStatus,
    version: row.version, conversationId: row.conversationId, source: source.summary,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
  return { dto, review: source.review };
}

function eventDTO(row: AssistantWorkEvent): AssistantWorkItemEventDTO {
  if (!['CREATED', 'ADD_NOTE', 'WAIT', 'RESUME', 'CANCEL'].includes(row.type)
    || !['IN_REVIEW', 'WAITING', 'CANCELLED'].includes(row.status)
    || (row.fromStatus !== null && !['IN_REVIEW', 'WAITING', 'CANCELLED'].includes(row.fromStatus))) {
    throw new AssistantWorkItemError(409, 'WORK_ITEM_INVALID', 'El historial del encargo requiere revisión.');
  }
  return { id: row.eventId, type: row.type as AssistantWorkItemEventDTO['type'], note: row.note,
    fromStatus: row.fromStatus as AssistantWorkItemStatus | null, status: row.status as AssistantWorkItemStatus,
    version: row.version, createdAt: row.createdAt.toISOString() };
}

/** GET sólo recupera referencias vigentes y notas; nunca reanuda runs ni llama herramientas. */
export async function getAssistantWorkItem(principal: AssistantPrincipal, rawId: string, deps: WorkItemDependencies = {}): Promise<AssistantWorkItemDTO> {
  const db = deps.db ?? prisma, now = clock(deps), id = workItemIdSchema.parse(rawId);
  await authorize(principal, db);
  const row = await findItem(principal, id, db, now());
  const { dto, review } = await presentSummary(principal, row, db, now());
  const events = await db.assistantWorkEvent.findMany({ where: { workItemId: id, ...owner(principal), version: { lte: row.version } },
    orderBy: [{ version: 'desc' }, { id: 'desc' }], take: WORK_ITEM_EVENT_LIMIT });
  await authorize(principal, db);
  // Revalidar caducidad también después de leer el historial.
  if (row.expiresAt <= now()) throw notFound();
  const visibleEvents = events.reverse().map(eventDTO), eventsTruncated = row.eventCount > WORK_ITEM_EVENT_LIMIT;
  const report = buildW01Report({ id: row.id, version: row.version, assignedUserId: row.userId,
    source: dto.source, review, events: visibleEvents, eventsTruncated });
  return { ...dto, review, report, events: visibleEvents, eventsTruncated };
}

export async function listAssistantWorkItems(principal: AssistantPrincipal, input: unknown = {}, deps: WorkItemDependencies = {}): Promise<AssistantWorkItemListDTO> {
  const { cursor } = listWorkItemsSchema.parse(input), db = deps.db ?? prisma, now = clock(deps);
  await authorize(principal, db);
  const position = cursor ? await findItem(principal, cursor, db, now()) : null;
  const rows = await db.assistantWorkItem.findMany({ where: { ...owner(principal), expiresAt: { gt: now() },
    ...(position ? { OR: [{ createdAt: { lt: position.createdAt } }, { createdAt: position.createdAt, id: { lt: position.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: WORK_ITEM_PAGE_SIZE });
  const items: AssistantWorkItemSummaryDTO[] = [];
  // Acotado a 20: no abrir una transacción ni ejecutar consultas de caja al recuperar.
  for (const row of rows) items.push((await presentSummary(principal, row, db, now())).dto);
  await authorize(principal, db);
  if (rows.some(row => row.expiresAt <= now())) throw notFound();
  return { items, nextCursor: rows.length === WORK_ITEM_PAGE_SIZE ? rows[rows.length - 1].id : null };
}

export async function createAssistantWorkItem(principal: AssistantPrincipal, input: unknown, deps: WorkItemDependencies = {}): Promise<AssistantWorkItemDTO> {
  const { runId } = createWorkItemSchema.parse(input), db = deps.db ?? prisma, now = clock(deps);
  await authorize(principal, db);
  // Validar antes de tomar locks; la transacción vuelve a comprobar fuente y autoridad.
  await readWorkItemSource(principal, runId, db, now());
  const id = await db.$transaction(async tx => {
    await lockAuthority(principal, tx);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM AssistantRun WHERE id=${runId} AND tenantId=${principal.tenantId}
      AND userId=${principal.userId} AND roleAtCreation=${principal.role} AND expiresAt>${now()} FOR UPDATE`);
    const source = await readWorkItemSource(principal, runId, tx, now());
    const previous = await tx.assistantWorkItem.findFirst({ where: { runId, ...owner(principal) } });
    if (previous) { await authorize(principal, tx); return previous.id; }
    const createdAt = now(), expiresAt = new Date(Math.min(createdAt.getTime() + WORK_ITEM_TTL_MS, source.expiresAt.getTime()));
    const row = await tx.assistantWorkItem.create({ data: { ...owner(principal), runId, conversationId: source.conversationId,
      evidenceId: source.summary.evidenceId, sourceHash: source.summary.contentHash, sourceSummary: json(source.summary),
      kind: 'W01_CASH_REVIEW', status: 'IN_REVIEW', version: 0, eventCount: 1, createdAt, expiresAt } });
    const eventId = randomUUID();
    await tx.assistantWorkEvent.create({ data: { ...owner(principal), workItemId: row.id, eventId,
      payloadHash: hash({ type: 'CREATED', runId }), type: 'CREATED', note: null, fromStatus: null,
      status: 'IN_REVIEW', version: 0, createdAt } });
    await authorize(principal, tx);
    if (expiresAt <= now()) throw notFound();
    return row.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return getAssistantWorkItem(principal, id, deps);
}

function nextStatus(status: AssistantWorkItemStatus, type: 'ADD_NOTE' | 'WAIT' | 'RESUME' | 'CANCEL'): AssistantWorkItemStatus {
  if (status === 'CANCELLED') throw new AssistantWorkItemError(409, 'WORK_ITEM_CANCELLED', 'Un encargo cancelado conserva su historial y no admite cambios.');
  if (type === 'ADD_NOTE') return status;
  if (type === 'CANCEL') return 'CANCELLED';
  if (type === 'WAIT' && status === 'IN_REVIEW') return 'WAITING';
  if (type === 'RESUME' && status === 'WAITING') return 'IN_REVIEW';
  throw new AssistantWorkItemError(409, 'WORK_ITEM_TRANSITION', 'Recuperá el estado actual antes de cambiar el encargo.');
}

export async function appendAssistantWorkItemEvent(principal: AssistantPrincipal, rawId: string, input: unknown, deps: WorkItemDependencies = {}): Promise<AssistantWorkItemDTO> {
  const id = workItemIdSchema.parse(rawId), event = workItemEventSchema.parse(input), db = deps.db ?? prisma, now = clock(deps);
  const note = event.type === 'ADD_NOTE' ? event.note : null;
  const payloadHash = hash({ version: event.version, type: event.type, note });
  await authorize(principal, db);
  await db.$transaction(async tx => {
    await lockAuthority(principal, tx);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM AssistantWorkItem WHERE id=${id} AND tenantId=${principal.tenantId}
      AND userId=${principal.userId} AND roleAtCreation=${principal.role} AND expiresAt>${now()} FOR UPDATE`);
    const row = await findItem(principal, id, tx, now());
    await readWorkItemSource(principal, row.runId, tx, now(), row);
    const replay = await tx.assistantWorkEvent.findFirst({ where: { workItemId: id, eventId: event.eventId, ...owner(principal) } });
    if (replay) {
      if (replay.payloadHash !== payloadHash) throw new AssistantWorkItemError(409, 'WORK_ITEM_EVENT_CONFLICT', 'Ese identificador ya corresponde a otro cambio del encargo.');
      await authorize(principal, tx); return;
    }
    if (row.version !== event.version) throw new AssistantWorkItemError(409, 'WORK_ITEM_CHANGED', 'El encargo cambió. Recuperalo antes de guardar otra modificación.');
    const status = nextStatus(row.status as AssistantWorkItemStatus, event.type);
    const updated = await tx.assistantWorkItem.updateMany({ where: { id, ...owner(principal), version: event.version, status: row.status, expiresAt: { gt: now() } },
      data: { status, version: { increment: 1 }, eventCount: { increment: 1 } } });
    if (updated.count !== 1) throw new AssistantWorkItemError(409, 'WORK_ITEM_CHANGED', 'Otro intento modificó el encargo. Recuperá su estado.');
    await tx.assistantWorkEvent.create({ data: { ...owner(principal), workItemId: id, eventId: event.eventId, payloadHash,
      type: event.type, note, fromStatus: row.status, status, version: row.version + 1, createdAt: now() } });
    await authorize(principal, tx);
    if (row.expiresAt <= now()) throw notFound();
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  const result = await getAssistantWorkItem(principal, id, deps);
  return { ...result, receiptEventId: event.eventId };
}
