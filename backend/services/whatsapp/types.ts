/**
 * NORTEX — WhatsApp · tipos del Cloud API (subset usado por la infraestructura).
 * Modela solo lo que consumimos del webhook entrante de Meta.
 */

export interface WaTextMessage {
    from: string; // wa_id del remitente (E.164 sin +)
    id: string; // id único de Meta — clave de idempotencia
    timestamp: string;
    type: string; // text | image | interactive | button | …
    text?: { body: string };
    interactive?: {
        type: string;
        button_reply?: { id: string; title: string };
        list_reply?: { id: string; title: string };
    };
}

export interface WaStatusUpdate {
    id: string; // id del mensaje saliente
    status: string; // sent | delivered | read | failed
    recipient_id: string;
}

export interface WaChangeValue {
    messaging_product: 'whatsapp';
    metadata: { display_phone_number: string; phone_number_id: string };
    contacts?: { profile: { name: string }; wa_id: string }[];
    messages?: WaTextMessage[];
    statuses?: WaStatusUpdate[];
}

export interface WaWebhookPayload {
    object: string;
    entry: { id: string; changes: { value: WaChangeValue; field: string }[] }[];
}

/**
 * Unidad de trabajo encolada: un mensaje entrante ya enrutado a su número.
 * El procesamiento (identidad, agente, respuesta) ocurre fuera del request.
 */
export interface InboundJob {
    phoneNumberId: string;
    waId: string;
    profileName: string | null;
    waMessageId: string;
    text: string;
    timestamp: string;
}

/** Texto normalizado extraído de un mensaje (lo que el agente entiende hoy). */
export function extractText(msg: WaTextMessage): string | null {
    if (msg.type === 'text' && msg.text?.body) return msg.text.body;
    if (msg.type === 'interactive') {
        const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
        if (r) return r.title;
    }
    return null;
}
