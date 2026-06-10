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
 * dentro del MISMO tenant. Idempotente vía @@unique([tenantId, waId]).
 */
export async function resolveIdentity(
    channel: ResolvedChannel,
    waId: string,
    profileName: string | null
): Promise<ResolvedIdentity> {
    // Lookup de cliente tenant-scoped. El teléfono puede venir con/sin código
    // de país; probamos coincidencia por sufijo conservador (últimos 8 dígitos).
    const localDigits = waId.replace(/\D/g, '').slice(-8);
    const customer = await prisma.customer.findFirst({
        where: { tenantId: channel.tenantId, phone: { contains: localDigits } },
        select: { id: true, name: true },
    });

    const existing = await prisma.whatsAppConversation.findUnique({
        where: { tenantId_waId: { tenantId: channel.tenantId, waId } },
        select: { id: true, status: true, customerId: true },
    });

    if (existing) {
        const conv = await prisma.whatsAppConversation.update({
            where: { id: existing.id },
            data: {
                lastInboundAt: new Date(),
                customerId: existing.customerId ?? customer?.id ?? null,
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
