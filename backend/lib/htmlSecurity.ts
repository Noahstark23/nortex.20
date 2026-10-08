/**
 * Codifica texto no confiable antes de interpolarlo en documentos HTML.
 *
 * React escapa por defecto, pero los documentos fiscales se construyen como
 * strings y luego se abren como `blob:`. En ese contexto cada valor persistido
 * debe tratarse como texto, nunca como markup ejecutable.
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Política para vistas previas HTML autenticadas. Se entrega como header y
 * como `<meta>` porque `response.blob()` conserva el MIME, pero no los headers
 * HTTP al crear el object URL.
 */
export function fiscalPreviewCsp(nonce: string): string {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
        throw new Error('Nonce CSP inválido');
    }
    return [
        "default-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "style-src 'unsafe-inline'",
        `script-src 'nonce-${nonce}'`,
    ].join('; ');
}
