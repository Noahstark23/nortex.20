/**
 * NORTEX — WhatsApp · configuración global (un Meta App de plataforma).
 *
 * Lo PER-TENANT (número, access token, scope) vive en WhatsAppChannel (DB).
 * Lo global vive en env:
 *   WHATSAPP_ENABLED      = "true"     → activa el montaje del webhook
 *   WHATSAPP_APP_SECRET   = <secret>   → verificación de firma X-Hub-Signature-256
 *   WHATSAPP_VERIFY_TOKEN = <token>    → challenge del GET /webhook (Meta)
 *   WHATSAPP_API_VERSION  = "v21.0"    → versión del Graph API (opcional)
 *
 * Todo el subsistema queda INERTE si WHATSAPP_ENABLED !== "true".
 */

export interface WhatsAppGlobalConfig {
    appSecret: string;
    verifyToken: string;
    apiVersion: string;
}

export function isWhatsAppEnabled(): boolean {
    return process.env.WHATSAPP_ENABLED === 'true';
}

/**
 * Devuelve la config global o lanza si está incompleta. Solo debe invocarse
 * cuando isWhatsAppEnabled() es true (el montaje del webhook lo garantiza).
 */
export function getWhatsAppConfig(): WhatsAppGlobalConfig {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!appSecret || !verifyToken) {
        throw new Error(
            '🚨 WHATSAPP_ENABLED=true pero falta WHATSAPP_APP_SECRET y/o WHATSAPP_VERIFY_TOKEN.'
        );
    }
    return {
        appSecret,
        verifyToken,
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    };
}
