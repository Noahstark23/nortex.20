const DEFAULT_DOWNLOAD_ERROR = 'No se pudo generar la descarga.';

function parseContentDispositionFilename(header: string | null): string | null {
    if (!header) return null;

    const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        try {
            return decodeURIComponent(utf8Match[1]).replace(/^["']|["']$/g, '');
        } catch {
            return utf8Match[1].replace(/^["']|["']$/g, '');
        }
    }

    const basicMatch = header.match(/filename="?([^";]+)"?/i);
    return basicMatch?.[1]?.trim() || null;
}

async function extractDownloadError(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const data = await response.json().catch(() => null);
        if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
    }

    const text = await response.text().catch(() => '');
    if (text.trim()) return text.trim().slice(0, 180);
    return response.status ? `${DEFAULT_DOWNLOAD_ERROR} El servidor respondió ${response.status}.` : DEFAULT_DOWNLOAD_ERROR;
}

function clickAnchor(anchor: HTMLAnchorElement) {
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
}

export interface AuthenticatedDownloadOptions {
    token: string | null;
    filename?: string;
    openInNewTab?: boolean;
}

export interface AuthenticatedDownloadResult {
    filename: string | null;
}

/**
 * Descarga o abre documentos protegidos por JWT sin depender de <a href>,
 * porque la navegación nativa del anchor no adjunta Authorization.
 */
export async function authenticatedDownload(
    url: string,
    options: AuthenticatedDownloadOptions,
): Promise<AuthenticatedDownloadResult> {
    const { token, filename, openInNewTab = false } = options;
    if (!token) {
        throw new Error('Tu sesión expiró. Iniciá sesión de nuevo.');
    }

    const previewWindow = openInNewTab ? window.open('about:blank', '_blank') : null;
    if (previewWindow) {
        previewWindow.opener = null;
        previewWindow.document.title = 'Generando documento...';
        previewWindow.document.body.innerHTML = '<p style="font-family: Arial, sans-serif; padding: 24px;">Generando documento...</p>';
    }

    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
            throw new Error(await extractDownloadError(response));
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const resolvedFilename = filename || parseContentDispositionFilename(response.headers.get('content-disposition'));

        if (openInNewTab) {
            if (previewWindow && !previewWindow.closed) {
                previewWindow.location.replace(blobUrl);
            } else {
                const anchor = document.createElement('a');
                anchor.href = blobUrl;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                clickAnchor(anchor);
            }
        } else {
            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            if (resolvedFilename) anchor.download = resolvedFilename;
            clickAnchor(anchor);
        }

        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        return { filename: resolvedFilename || null };
    } catch (error) {
        if (previewWindow && !previewWindow.closed) previewWindow.close();
        throw error;
    }
}
