/**
 * NORTEX — WhatsApp · handlers del webhook (Meta Cloud API).
 *
 * GET  /api/whatsapp/webhook → verificación (hub.challenge) al suscribir.
 * POST /api/whatsapp/webhook → recepción. Verifica la firma HMAC sobre el
 *   cuerpo CRUDO (requiere express.raw), encola y responde 200 de inmediato.
 *
 * Patrón calcado del webhook de Stripe (server.ts): la firma se valida sobre
 * los bytes exactos, por eso el body llega como Buffer.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getWhatsAppConfig } from './config';
import { WaWebhookPayload, InboundJob, extractText } from './types';
import { inboundQueue } from './inbound';
import { prisma } from './db';

// ── GET: verificación del webhook ────────────────────────────────────────────
export function verifyHandler(req: any, res: any): void {
    const { verifyToken } = getWhatsAppConfig();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === verifyToken) {
        res.status(200).send(challenge);
        return;
    }
    res.sendStatus(403);
}

// ── Verificación de firma X-Hub-Signature-256 ───────────────────────────────
function isValidSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
    if (!header || !header.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const given = header.slice('sha256='.length);
    if (given.length !== expected.length) return false;
    try {
        return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

// ── POST: recepción de eventos ──────────────────────────────────────────────
export function webhookHandler(req: any, res: any): void {
    const { appSecret } = getWhatsAppConfig();

    // express.raw deja el Buffer en req.body.
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
    if (!isValidSignature(rawBody, req.headers['x-hub-signature-256'], appSecret)) {
        res.sendStatus(401);
        return;
    }

    let payload: WaWebhookPayload;
    try {
        payload = JSON.parse(rawBody.toString('utf8')) as WaWebhookPayload;
    } catch {
        res.sendStatus(400);
        return;
    }

    // Responder YA: Meta reintenta agresivamente si tardamos.
    res.sendStatus(200);

    // Trabajo fuera del request.
    try {
        for (const entry of payload.entry ?? []) {
            for (const change of entry.changes ?? []) {
                const value = change.value;
                const phoneNumberId = value?.metadata?.phone_number_id;
                if (!phoneNumberId) continue;

                // Mensajes entrantes → cola.
                for (const msg of value.messages ?? []) {
                    const text = extractText(msg);
                    if (!text) continue; // tipos no soportados aún (audio/ubicación)
                    const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
                    const job: InboundJob = {
                        phoneNumberId,
                        waId: msg.from,
                        profileName,
                        waMessageId: msg.id,
                        text,
                        timestamp: msg.timestamp,
                    };
                    inboundQueue.enqueue(job);
                }

                // Estados de salientes (sent/delivered/read/failed) → update ligero.
                for (const status of value.statuses ?? []) {
                    void prisma.whatsAppMessage
                        .updateMany({ where: { waMessageId: status.id }, data: { status: status.status } })
                        .catch(() => undefined);
                }
            }
        }
    } catch (err) {
        console.error('🟥 [wa-webhook] error encolando:', err);
    }
}
