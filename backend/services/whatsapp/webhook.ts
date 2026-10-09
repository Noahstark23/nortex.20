/**
 * NORTEX — WhatsApp · handlers del webhook (Meta Cloud API).
 *
 * GET  /api/whatsapp/webhook → verificación (hub.challenge) al suscribir.
 * POST /api/whatsapp/webhook → recepción. Verifica la firma HMAC sobre el
 *   cuerpo CRUDO (requiere express.raw), persiste y luego responde 200.
 *
 * Patrón calcado del webhook de Stripe (server.ts): la firma se valida sobre
 * los bytes exactos, por eso el body llega como Buffer.
 */

import { enqueueLegacyMessages } from './legacyWebhook';
import { getWhatsAppConfig } from './config';
import { acceptCommerceWebhook } from './commerce/inbox';
import { CommerceError } from './commerce/types';

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

/** La identidad del canal decide el motor; flags de ejecución nunca cambian su propietario. */
export async function webhookHandler(req: any, res: any): Promise<void> {
    try {
        if (!Buffer.isBuffer(req.body)) { res.status(400).json({error:'Cuerpo inválido.'}); return; }
        const result = await acceptCommerceWebhook(req.body, req.headers['x-hub-signature-256'], {appSecret:getWhatsAppConfig().appSecret});
        enqueueLegacyMessages(result.legacyValues);
        res.sendStatus(200);
    } catch (error) {
        const status = error instanceof CommerceError ? error.statusCode : 503;
        res.status(status).json({error: status < 500 && error instanceof CommerceError ? error.message : 'No se pudo guardar el evento. Reintentá la entrega.'});
    }
}
