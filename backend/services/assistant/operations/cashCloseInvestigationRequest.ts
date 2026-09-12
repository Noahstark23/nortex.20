/** Comando exacto del enlace de un cierre; nunca extrae importes o identidad del negocio. */
export function cashCloseInvestigationRequest(text: string): { shiftId: string; reportHash?: string } | null | undefined {
    const plain = text.trim();
    if (!/^(?:investig[áa](?:r)?|explic[áa](?:me)?)\s+el\s+cierre\b/i.test(plain)) return undefined;
    const match = /^(?:investig[áa](?:r)?|explic[áa](?:me)?)\s+el\s+cierre\s+([a-z0-9_-]{1,64})(?:\s+referencia\s+([a-f0-9]{64}))?[.!?]?$/i.exec(plain);
    if (!match || /^(hoy|ayer|semana|caja|de|del|anterior|ultimo|pasado|ese|este)$/i.test(match[1])) return null;
    return { shiftId: match[1], ...(match[2] ? { reportHash: match[2].toLowerCase() } : {}) };
}
