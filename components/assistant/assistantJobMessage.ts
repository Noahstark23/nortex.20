/** Códigos del trabajo no son mensajes para el negocio; los desconocidos nunca se muestran en crudo. */
export function assistantJobMessage(code: string): string {
    if (code === 'DOCUMENT_CONTEXT_CHANGED') return 'La compra que declaraste cambió o se canceló. Retomá la conversación y volvé a leer la factura con los datos actuales.';
    if (code === 'DOCUMENT_CONTEXT_INVALID') return 'No pudimos verificar la captura de esta compra. Retomá la conversación antes de volver a leer la factura.';
    if (code === 'DOCUMENT_CONTEXT_LIMIT') return 'Hay demasiadas diferencias entre la factura y lo declarado. Revisá la compra desde Compras.';
    if (code === 'INTAKE_CHANGED') return 'La compra cambió en otra revisión. Retomá la conversación para comprobar la propuesta actual.';
    if (['BUDGET_EXHAUSTED', 'BUDGET_LIMIT'].includes(code)) return 'La lectura alcanzó el presupuesto disponible de IA. Podés registrar la factura desde Compras.';
    if (['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'ATTEMPTS_EXHAUSTED'].includes(code)) return 'El servicio de lectura no está disponible ahora. Conservá la referencia y seguí desde Compras si necesitás registrar la factura.';
    if (['DOCUMENT_LIMIT', 'PAGE_LIMIT', 'FILE_SIZE', 'DOCUMENT_IDS'].includes(code)) return 'La factura debe ocupar hasta 10 MB y tener como máximo 10 páginas o imágenes.';
    if (['MULTIPLE_INVOICES', 'DUPLICATE_PAGE'].includes(code)) return 'Adjuntá una sola factura completa y quitá las páginas duplicadas.';
    if (code === 'ENCRYPTED_PDF') return 'El PDF tiene contraseña. Adjuntá una copia sin contraseña.';
    if (['FILE_FORMAT', 'INVALID_PDF', 'INCOMPLETE_PDF', 'INVALID_IMAGE', 'INCOMPLETE_INVOICE', 'EXTRACTION_INVALID'].includes(code)) return 'No pudimos leer una factura completa. Adjuntá una copia legible en JPG, PNG o PDF, o revisala desde Compras.';
    if (['ASSISTANT_FORBIDDEN', 'ASSISTANT_DISABLED', 'SESSION_REVOKED'].includes(code)) return 'Tu acceso a esta lectura cambió. Comprobá tu sesión y permisos antes de continuar.';
    if (['ATTACHMENT_NOT_FOUND', 'FILE_INTEGRITY', 'STORAGE_UNAVAILABLE'].includes(code)) return 'No pudimos comprobar el documento original. Conservá la referencia y pedí ayuda al responsable del negocio.';
    return 'No pudimos completar la lectura. Conservá la referencia para revisarla; podés continuar desde Compras.';
}
