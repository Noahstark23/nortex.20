/**
 * NORTEX — WhatsApp · cliente del Cloud API (envío saliente).
 *
 * Adaptador concreto para Meta WhatsApp Cloud API. La interfaz WhatsAppSender
 * permite enchufar Twilio/Evolution sin tocar al agente (decisión de producto
 * aún abierta; este es el default oficial del plan).
 *
 * Node 22 trae `fetch` global — sin dependencias nuevas.
 */

export interface WhatsAppSender {
    sendText(to: string, body: string): Promise<string | null>;
    markRead(messageId: string): Promise<void>;
}

interface CloudApiCredentials {
    phoneNumberId: string;
    accessToken: string; // YA descifrado por el caller (crypto.decryptField)
    apiVersion: string;
}

export class CloudApiSender implements WhatsAppSender {
    constructor(private readonly creds: CloudApiCredentials) {}

    private get baseUrl(): string {
        return `https://graph.facebook.com/${this.creds.apiVersion}/${this.creds.phoneNumberId}`;
    }

    /** Devuelve el wamid del mensaje creado, o null si Meta no lo retornó. */
    async sendText(to: string, body: string): Promise<string | null> {
        const res = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.creds.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'text',
                text: { preview_url: false, body: body.slice(0, 4096) },
            }),
        });

        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`WA sendText ${res.status}: ${detail.slice(0, 300)}`);
        }
        const data = (await res.json()) as { messages?: { id: string }[] };
        return data.messages?.[0]?.id ?? null;
    }

    async markRead(messageId: string): Promise<void> {
        await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.creds.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
        }).catch(() => undefined); // best-effort: no bloquea el flujo si falla
    }
}
