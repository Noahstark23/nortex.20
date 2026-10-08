import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { CommerceError, type CommercePrincipal } from './types.js';
import { requireCommercePrincipal } from './policy.js';

const NOTICE_VERSION = 'connection-assistance-v1';
const inputSchema = z.object({ phone: z.string().min(1).max(32) }).strict();
const publicSelect = { id: true, phone: true, status: true, createdAt: true } as const;

function normalizeNicaraguaPhone(input: string): string {
  const value = input.trim();
  // Separadores habituales entre grupos de dígitos; nada de texto, extensiones ni signos internos.
  if (!/^\+?\d+(?:[ -]\d+)*$/.test(value)) {
    throw new CommerceError('COMMERCE_ACTIVATION_PHONE', 'Escribí un número válido de Nicaragua.', 400);
  }
  const compact = value.replace(/[ -]/g, '');
  const local = compact.startsWith('+505') ? compact.slice(4)
    : compact.length === 11 && compact.startsWith('505') ? compact.slice(3) : compact;
  if (!/^[2578]\d{7}$/.test(local)) {
    throw new CommerceError('COMMERCE_ACTIVATION_PHONE', 'Escribí un número válido de Nicaragua.', 400);
  }
  return `+505${local}`;
}

async function requireActivationAdmin(principal: CommercePrincipal, db: PrismaClient | Prisma.TransactionClient) {
  const user = await requireCommercePrincipal(principal, db);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    throw new CommerceError('COMMERCE_ACTIVATION_FORBIDDEN', 'Solo administración puede solicitar ayuda para conectar WhatsApp.', 403);
  }
}

async function requireFerreteria(tenantId: string, db: PrismaClient | Prisma.TransactionClient) {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { type: true } });
  if (tenant?.type !== 'FERRETERIA') {
    throw new CommerceError('COMMERCE_ACTIVATION_VERTICAL', 'La conexión asistida de WhatsApp está disponible en este piloto para ferreterías.', 403);
  }
}

/** La lectura no siembra ni conecta un canal; siempre usa el tenant del principal autenticado. */
export async function getCommerceActivationRequest(principal: CommercePrincipal, db: PrismaClient = prisma) {
  await requireActivationAdmin(principal, db);
  await requireFerreteria(principal.tenantId, db);
  return db.waCommerceActivationRequest.findFirst({ where: { tenantId: principal.tenantId }, select: publicSelect });
}

/** Una única solicitud durable por negocio; el lock serializa incluso el primer alta. */
export async function requestCommerceActivation(
  principal: CommercePrincipal,
  input: { phone: string },
  db: PrismaClient = prisma,
  now: Date = new Date(),
) {
  const { phone } = inputSchema.parse(input);
  const normalizedPhone = normalizeNicaraguaPhone(phone);
  return db.$transaction(async tx => {
    await requireActivationAdmin(principal, tx);
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM Tenant WHERE id=${principal.tenantId} FOR UPDATE`);
    if (!locked.length) throw new CommerceError('COMMERCE_ACTIVATION_TENANT', 'Negocio no encontrado.', 404);
    await requireFerreteria(principal.tenantId, tx);
    const existing = await tx.waCommerceActivationRequest.findFirst({ where: { tenantId: principal.tenantId }, select: publicSelect });
    if (existing) {
      if (existing.phone !== normalizedPhone) {
        throw new CommerceError('COMMERCE_ACTIVATION_CONFLICT', 'Ya existe una solicitud con otro número. Pedí ayuda para resolverla antes de cambiarlo.', 409);
      }
      return { request: existing, replayed: true };
    }
    const created = await tx.waCommerceActivationRequest.create({
      data: { tenantId: principal.tenantId, phone: normalizedPhone, requestedBy: principal.userId, status: 'REQUESTED', noticeVersion: NOTICE_VERSION, createdAt: now },
      select: publicSelect,
    });
    await tx.auditLog.create({
      data: { tenantId: principal.tenantId, userId: principal.userId, action: 'WHATSAPP_COMMERCE_ACTIVATION_REQUESTED', details: JSON.stringify({ requestId: created.id, status: 'REQUESTED', noticeVersion: NOTICE_VERSION }) },
    });
    return { request: created, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
