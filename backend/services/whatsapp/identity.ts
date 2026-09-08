/**
 * NORTEX — WhatsApp · resolución de identidad y contexto de tenant.
 *
 * SEGURIDAD (principio inviolable): el tenantId se deriva del CANAL
 * (phone_number_id → WhatsAppChannel), NUNCA de nada que diga el usuario o el
 * LLM. El customerId se resuelve del waId contra Customer del MISMO tenant.
 * Así, aunque el modelo sea manipulado por prompt injection, jamás puede
 * actuar sobre otro tenant ni sobre otro cliente.
 */

import { prisma } from './db';
import { Prisma } from '@prisma/client';
import { decryptField } from '../crypto';
import { CloudApiSender, WhatsAppSender } from './client';

export interface ResolvedChannel {
    channelId: string;
    tenantId: string;
    botScope: string; // B2C | B2B | BOTH
    defaultMode: string; // BOT | HUMAN
    sender: WhatsAppSender;
}

export interface ResolvedIdentity {
    conversationId: string;
    tenantId: string;
    waId: string;
    customerId: string | null;
    customerName: string | null;
    botScope: string;
    status: string; // BOT | HUMAN | CLOSED
}

/**
 * phone_number_id → canal activo + sender listo (token descifrado).
 * Devuelve null si el número no está registrado o está inactivo: el webhook
 * descarta el evento silenciosamente (no es un error).
 */
export async function resolveChannel(phoneNumberId: string, apiVersion: string): Promise<ResolvedChannel | null> {
    const channel = await prisma.whatsAppChannel.findUnique({ where: { phoneNumberId } });
    if (!channel || !channel.active) return null;

    const accessToken = decryptField(channel.accessTokenEnc);
    const sender = new CloudApiSender({ phoneNumberId, accessToken, apiVersion });

    return {
        channelId: channel.id,
        tenantId: channel.tenantId,
        botScope: channel.botScope,
        defaultMode: channel.defaultMode,
        sender,
    };
}

/**
 * Asegura la conversación (tenant, waId) y resuelve el Customer por teléfono
 * dentro del MISMO tenant. Solo vincula una coincidencia exacta y única; se
 * revalida en cada mensaje incluso si la conversación ya tenía customerId.
 */
export async function resolveIdentity(
    channel: ResolvedChannel,
    waId: string,
    profileName: string | null
): Promise<ResolvedIdentity> {
    // Meta entrega E.164 sin '+'. Un valor vacío/malformado nunca se convierte
    // en una búsqueda amplia. El formato local de 8 dígitos solo es NIC (505).
    if (!/^[1-9]\d{7,14}$/.test(waId)) throw new Error('WA_ID_INVALID');
    const phoneVariants = [waId, `00${waId}`];
    if (/^505\d{8}$/.test(waId)) phoneVariants.push(waId.slice(3));

    // Customer.phone es texto legacy (espacios, '+', guiones, paréntesis).
    // Normalizamos en MySQL 8, con parámetros y LIMIT 2 DESPUÉS de igualar:
    // limitar candidatos por sufijo antes de normalizar ocultaría ambigüedad.
    const matches = await prisma.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
        SELECT id, name FROM \`Customer\`
        WHERE tenantId = ${channel.tenantId}
          AND phone NOT REGEXP '[^+0-9() .-]'
          AND REGEXP_REPLACE(phone, '[^0-9]', '') IN (${Prisma.join(phoneVariants)})
        LIMIT 2
    `);
    const customer = matches.length === 1 ? matches[0] : null;

    const existing = await prisma.whatsAppConversation.findUnique({
        where: { tenantId_waId: { tenantId: channel.tenantId, waId } },
        select: { id: true, status: true, customerId: true },
    });

    if (existing) {
        const conv = await prisma.whatsAppConversation.update({
            where: { id: existing.id, tenantId: channel.tenantId },
            data: {
                lastInboundAt: new Date(),
                customerId: customer?.id ?? null,
            },
            select: { id: true, status: true, customerId: true },
        });
        return {
            conversationId: conv.id,
            tenantId: channel.tenantId,
            waId,
            customerId: conv.customerId,
            customerName: customer?.name ?? null,
            botScope: channel.botScope,
            status: conv.status,
        };
    }

    const created = await prisma.whatsAppConversation.create({
        data: {
            tenantId: channel.tenantId,
            waId,
            customerId: customer?.id ?? null,
            status: channel.defaultMode === 'HUMAN' ? 'HUMAN' : 'BOT',
            lastInboundAt: new Date(),
        },
        select: { id: true, status: true, customerId: true },
    });

    return {
        conversationId: created.id,
        tenantId: channel.tenantId,
        waId,
        customerId: created.customerId,
        customerName: customer?.name ?? profileName,
        botScope: channel.botScope,
        status: created.status,
    };
}
