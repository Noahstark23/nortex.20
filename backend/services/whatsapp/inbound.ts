/**
 * NORTEX — WhatsApp · procesamiento de mensajes entrantes (fuera del request).
 *
 * Pipeline: canal → identidad/tenant → persistir (dedupe por waMessageId) →
 * (si BOT) agente → enviar respuesta → persistir saliente.
 *
 * Idempotencia: la creación del mensaje entrante usa waMessageId @unique; un
 * reintento de Meta colisiona con P2002 y se descarta sin re-ejecutar el agente
 * (no se cobra dos veces ni se responde dos veces).
 */

import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { InboundJob } from './types';
import { resolveChannel, resolveIdentity } from './identity';
import { createBrain, AgentBrain } from './agent';
import { InMemoryQueue } from './queue';
import { getWhatsAppConfig } from './config';

let brainPromise: Promise<AgentBrain> | null = null;
function getBrain(): Promise<AgentBrain> {
    return (brainPromise ??= createBrain());
}

export async function processInboundJob(job: InboundJob): Promise<void> {
    const { apiVersion } = getWhatsAppConfig();

    const channel = await resolveChannel(job.phoneNumberId, apiVersion);
    if (!channel) return; // número no registrado / inactivo → descartar

    const identity = await resolveIdentity(channel, job.waId, job.profileName);

    // Dedupe + persistencia del entrante en una sola operación atómica.
    let inboundId: string;
    try {
        const inbound = await prisma.whatsAppMessage.create({
            data: {
                conversationId: identity.conversationId,
                tenantId: identity.tenantId,
                direction: 'IN',
                waMessageId: job.waMessageId,
                type: 'text',
                body: job.text,
            },
        });
        inboundId = inbound.id;
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return; // ya procesado (reintento de Meta)
        }
        throw err;
    }

    // Conversación en manos de un humano (handoff) o cerrada → el bot no responde.
    if (identity.status !== 'BOT') return;

    await channel.sender.markRead(job.waMessageId);

    const tenant = await prisma.tenant.findUnique({
        where: { id: identity.tenantId },
        select: { businessName: true },
    });

    // Memoria conversacional: últimos turnos (excluye el mensaje actual). Tenant-
    // scoped vía conversationId (que ya es del tenant). El MenuBot lo ignora.
    const prior = await prisma.whatsAppMessage.findMany({
        where: { conversationId: identity.conversationId, type: 'text', id: { not: inboundId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { direction: true, body: true },
    });
    const history = prior
        .reverse()
        .map((m) => ({ role: m.direction === 'IN' ? ('user' as const) : ('assistant' as const), text: m.body }));

    const brain = await getBrain();
    const reply = await brain.reply({
        text: job.text,
        ctx: { tenantId: identity.tenantId, customerId: identity.customerId, botScope: identity.botScope },
        customerName: identity.customerName,
        businessName: tenant?.businessName ?? 'la tienda',
        history,
    });

    if (reply.handoff) {
        await prisma.whatsAppConversation.update({
            where: { id: identity.conversationId },
            data: { status: 'HUMAN' },
        });
    }

    const wamid = await channel.sender.sendText(job.waId, reply.text);

    await prisma.$transaction([
        prisma.whatsAppMessage.create({
            data: {
                conversationId: identity.conversationId,
                tenantId: identity.tenantId,
                direction: 'OUT',
                waMessageId: wamid,
                type: 'text',
                body: reply.text,
                status: 'sent',
            },
        }),
        prisma.whatsAppConversation.update({
            where: { id: identity.conversationId },
            data: { lastOutboundAt: new Date() },
        }),
    ]);
}

/** Cola singleton: el webhook encola aquí y responde 200 de inmediato. */
export const inboundQueue = new InMemoryQueue<InboundJob>(processInboundJob, {
    concurrency: 2,
    maxRetries: 2,
    label: 'wa-inbound',
});
