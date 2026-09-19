import React, { useEffect, useRef, useState } from 'react';
import type { AssistantAttachmentDTO } from '../../shared/assistant';
import { readActivationSession } from '../../hooks/useActivationJourney';
import { assistantButtonClass } from './AssistantCatalogSelect';

/** El original permanece privado: el enlace de descarga sólo usa bytes autorizados de esta sesión. */
export const AssistantAttachmentPreview: React.FC<{ attachment: AssistantAttachmentDTO; sessionKey: string }> = ({ attachment, sessionKey }) => {
    const [url, setUrl] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
    const objectUrl = useRef(''); const controller = useRef<AbortController | null>(null);
    useEffect(() => () => { controller.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, [sessionKey]);
    const load = async () => {
        setLoading(true); setError(''); controller.current?.abort(); controller.current = new AbortController();
        const requestController = controller.current;
        const timeout = window.setTimeout(() => requestController.abort(), 30_000);
        try {
            const session = readActivationSession();
            if (!session.token || session.key !== sessionKey) throw new Error('Sesión cambiada');
            const response = await fetch(`/api/assistant/attachments/${encodeURIComponent(attachment.id)}/download`, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: requestController.signal });
            if (!response.ok) throw new Error('No autorizado');
            const blob = await response.blob();
            if (readActivationSession().key !== sessionKey || requestController.signal.aborted) return;
            if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
            objectUrl.current = URL.createObjectURL(blob); setUrl(objectUrl.current);
        } catch { if (readActivationSession().key === sessionKey && controller.current === requestController) setError('No pudimos abrir el original. Comprobá tu conexión y permisos.'); }
        finally { clearTimeout(timeout); if (readActivationSession().key === sessionKey && controller.current === requestController) setLoading(false); }
    };
    return <div className="nx-shell-control min-w-0 space-y-2 rounded-card border p-3">
        <p className="nx-shell-text break-words text-sm font-semibold">{attachment.name}</p>
        <p className="nx-shell-muted text-xs">{attachment.pages > 0 ? `${attachment.pages} página(s)` : 'Páginas por comprobar'} · {(attachment.bytes / 1024).toFixed(0)} KB</p>
        {!url && <button type="button" className={assistantButtonClass} disabled={loading} onClick={() => void load()}>{loading ? 'Abriendo…' : 'Ver documento original'}</button>}
        {url && attachment.mediaType.startsWith('image/') && <img src={url} alt={`Original de ${attachment.name}`} className="max-h-96 w-full rounded-control object-contain" />}
        {url && <a className={assistantButtonClass} href={url} download={attachment.name}>Descargar original</a>}
        {error && <p role="alert" className="nx-tone-warning text-sm">{error}</p>}
    </div>;
}
