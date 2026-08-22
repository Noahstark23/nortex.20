const HTML_ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/** Escapa texto no confiable antes de interpolarlo en un documento HTML. */
export function escapeHtml(value: string | number): string {
    return String(value).replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}

/**
 * Política que también se incrusta como meta tag. Esto importa cuando el
 * frontend muestra la constancia desde un blob URL, donde los headers HTTP de
 * la respuesta original ya no existen.
 */
export function constanciaContentSecurityPolicy(nonce: string): string {
    return [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        'img-src data:',
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; ');
}
