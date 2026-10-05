import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { CommerceError, type CommercePrincipal } from './types.js';

const identifier = z.string().trim().min(1).max(191);
const status = z.enum(['REQUESTED', 'IN_PROGRESS', 'WAITING_OWNER', 'PREPARED', 'CANCELLED']);
const selection = { id: true, tenantId: true, phone: true, status: true, version: true, assignedTo: true, createdAt: true, updatedAt: true } as const;
const pending = ['REQUESTED', 'IN_PROGRESS', 'WAITING_OWNER'];
const allowed: Record<string, string[]> = { REQUESTED: ['IN_PROGRESS'], IN_PROGRESS: ['WAITING_OWNER', 'PREPARED', 'CANCELLED'], WAITING_OWNER: ['IN_PROGRESS', 'CANCELLED'] };

/** Privilegio de plataforma explícito y vigente; nunca se obtiene del email o del tenant objetivo. */
async function requireSupport(principal: CommercePrincipal, db: PrismaClient | Prisma.TransactionClient) {
  if (principal.role !== 'SUPER_ADMIN') throw new CommerceError('COMMERCE_SUPPORT_FORBIDDEN', 'Solo soporte autorizado puede tramitar conexiones.', 403);
  const actor = await db.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE', role: 'SUPER_ADMIN' }, select: { id: true } });
  if (!actor) throw new CommerceError('COMMERCE_SUPPORT_FORBIDDEN', 'Tu acceso de soporte no está vigente.', 403);
  return actor;
}

export async function listSupportActivationRequests(principal: CommercePrincipal, input: { cursor?: string; status?: string } = {}, db: PrismaClient = prisma) {
  await requireSupport(principal, db);
  const query = z.object({ cursor: identifier.optional(), status: z.union([status, z.literal('ALL')]).optional() }).strict().parse(input);
  const anchor = query.cursor ? await db.waCommerceActivationRequest.findUnique({ where: { id: query.cursor }, select: { id: true, createdAt: true } }) : null;
  if (query.cursor && !anchor) throw new CommerceError('COMMERCE_SUPPORT_CURSOR', 'La página cambió. Volvé al inicio.', 409);
  const rows = await db.waCommerceActivationRequest.findMany({
    where: { ...(query.status === 'ALL' ? {} : { status: query.status ?? { in: pending } }), ...(anchor ? { OR: [{ createdAt: { gt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { gt: anchor.id } }] } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50, select: selection,
  });
  const items = rows;
  return { items, nextCursor: rows.length === 50 ? items.at(-1)!.id : null };
}

export async function getSupportActivationRequest(principal: CommercePrincipal, requestId: string, db: PrismaClient = prisma) {
  await requireSupport(principal, db);
  const request = await db.waCommerceActivationRequest.findUnique({ where: { id: identifier.parse(requestId) }, select: selection });
  if (!request) throw new CommerceError('COMMERCE_SUPPORT_NOT_FOUND', 'Solicitud no encontrada.', 404);
  return request;
}

/** Tramitar es una propuesta operativa: PREPARED nunca crea canal ni activa flags. */
export async function transitionSupportActivationRequest(principal: CommercePrincipal, requestId: string, input: { version: number; status: string }, db: PrismaClient = prisma) {
  const id = identifier.parse(requestId);
  const change = z.object({ version: z.number().int().positive(), status }).strict().parse(input);
  return db.$transaction(async tx => {
    const actor = await requireSupport(principal, tx);
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM WaCommerceActivationRequest WHERE id=${id} FOR UPDATE`);
    if (!locked.length) throw new CommerceError('COMMERCE_SUPPORT_NOT_FOUND', 'Solicitud no encontrada.', 404);
    const previous = await tx.waCommerceActivationRequest.findUniqueOrThrow({ where: { id }, select: selection });
    if (previous.version !== change.version) throw new CommerceError('COMMERCE_SUPPORT_VERSION', 'La solicitud cambió. Consultá su estado antes de actuar.', 409);
    if (!allowed[previous.status]?.includes(change.status)) throw new CommerceError('COMMERCE_SUPPORT_TRANSITION', 'Esa transición no corresponde al estado actual.', 409);
    if (previous.status === 'REQUESTED' ? previous.assignedTo !== null : previous.assignedTo !== actor.id) throw new CommerceError('COMMERCE_SUPPORT_ASSIGNMENT', 'Esta solicitud está a cargo de otra persona.', 409);
    const assignedTo = previous.status === 'REQUESTED' ? actor.id : previous.assignedTo;
    const changed = await tx.waCommerceActivationRequest.updateMany({ where: { id, tenantId: previous.tenantId, version: change.version, status: previous.status, assignedTo: previous.assignedTo }, data: { status: change.status, assignedTo, version: { increment: 1 } } });
    if (changed.count !== 1) throw new CommerceError('COMMERCE_SUPPORT_VERSION', 'La solicitud cambió. Consultá su estado antes de actuar.', 409);
    await tx.auditLog.create({ data: { tenantId: previous.tenantId, userId: actor.id, action: 'WHATSAPP_COMMERCE_ACTIVATION_SUPPORT', details: JSON.stringify({ requestId: id, before: { status: previous.status, version: previous.version, assignedTo: previous.assignedTo }, after: { status: change.status, version: previous.version + 1, assignedTo } }) } });
    return tx.waCommerceActivationRequest.findFirstOrThrow({ where: { id, tenantId: previous.tenantId }, select: selection });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
