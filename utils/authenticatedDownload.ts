const DEFAULT_DOWNLOAD_ERROR = 'No se pudo generar la descarga.';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AuthenticatedRequestErrorCode =
    | 'NO_SESSION'
    | 'HTTP_ERROR'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'POPUP_BLOCKED';

export class AuthenticatedRequestError extends Error {
    readonly code: AuthenticatedRequestErrorCode;
    readonly status?: number;

    constructor(message: string, code: AuthenticatedRequestErrorCode, status?: number) {
        super(message);
        this.name = 'AuthenticatedRequestError';
        this.code = code;
        this.status = status;
    }
}

interface AuthenticatedRequestOptions {
    token?: string | null;
    init?: RequestInit;
    fetchImpl?: FetchLike;
}

interface BlobUrlApi {
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
}

interface DownloadDocument {
    createElement(tagName: 'a'): HTMLAnchorElement;
    body: Pick<HTMLElement, 'appendChild' | 'removeChild'>;
}

export interface AuthenticatedDownloadOptions extends AuthenticatedRequestOptions {
    filename?: string;
    openInNewTab?: boolean;
    documentRef?: DownloadDocument;
    urlApi?: BlobUrlApi;
    windowRef?: Window;
    features?: string;
}

export interface AuthenticatedPreviewOptions extends AuthenticatedRequestOptions {
    windowRef?: Window;
    urlApi?: BlobUrlApi;
    features?: string;
}

export interface AuthenticatedDownloadResult {
    filename: string | null;
}

const currentToken = (token: string | null | undefined) => {
    if (token !== undefined) return token;
    return typeof localStorage === 'undefined' ? null : localStorage.getItem('nortex_token');
};

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

const messageForStatus = (status: number, serverMessage?: string) => {
    if (status === 401) return 'Tu sesión venció o no es válida. Iniciá sesión nuevamente.';
    if (status === 403) return 'Tu usuario no tiene permiso para generar este documento fiscal.';
    if (status === 404) return serverMessage || 'No encontramos la información necesaria para generar el documento.';
    return serverMessage || `El servidor no pudo generar el documento (error ${status}).`;
};

const readServerError = async (response: Response): Promise<string | undefined> => {
    try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const body = await response.json();
            return typeof body?.error === 'string'
                ? body.error
                : typeof body?.message === 'string'
                    ? body.message
                    : undefined;
        }

        const text = await response.text();
        return text.trim() || undefined;
    } catch {
        return undefined;
    }
};

async function extractDownloadError(response: Response): Promise<string> {
    const serverMessage = await readServerError(response);
    if (serverMessage) return serverMessage.slice(0, 180);
    return response.status
        ? `${DEFAULT_DOWNLOAD_ERROR} El servidor respondió ${response.status}.`
        : DEFAULT_DOWNLOAD_ERROR;
}

function buildAuthorizedInit(
    token: string,
    init?: RequestInit,
): RequestInit {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return { ...init, headers };
}

function openPreviewWindow(windowRef: Window, features?: string) {
    const preview = windowRef.open('about:blank', '_blank', features);
    if (!preview) {
        throw new AuthenticatedRequestError(
            'El navegador bloqueó la vista previa. Permití las ventanas emergentes e intentá de nuevo.',
            'POPUP_BLOCKED',
        );
    }
    return preview;
}

function renderPreviewPlaceholder(preview: Window) {
    try {
        preview.opener = null;
    } catch {
        // Algunos WebViews restringen cambiar opener.
    }

    try {
        preview.document.write(
            '<!doctype html><html lang="es"><head><title>Generando documento...</title></head>'
            + '<body style="font-family: Arial, sans-serif; padding: 24px;">Generando documento...</body></html>',
        );
        preview.document.close();
        return;
    } catch {
        // Safari/WebViews viejos pueden rechazar document.write sobre about:blank.
    }

    try {
        preview.document.title = 'Generando documento...';
        if (preview.document.body) {
            preview.document.body.innerHTML = '<p style="font-family: Arial, sans-serif; padding: 24px;">Generando documento...</p>';
        }
    } catch {
        // Si tampoco se puede renderizar el placeholder, seguimos con el fetch.
    }
}

function scheduleBlobRevoke(urlApi: BlobUrlApi, blobUrl: string, delayMs: number) {
    setTimeout(() => urlApi.revokeObjectURL(blobUrl), delayMs);
}

/**
 * Ejecuta un request protegido sin poner el JWT en la URL. No redirige en
 * errores 401/403: la pantalla llamante puede explicarlos con un toast sin
 * perder el contexto del usuario.
 */
export async function fetchAuthenticatedResponse(
    url: string,
    options: AuthenticatedRequestOptions = {},
): Promise<Response> {
    const token = currentToken(options.token);
    if (!token) {
        throw new AuthenticatedRequestError(
            'No hay una sesión activa. Iniciá sesión para generar el documento.',
            'NO_SESSION',
            401,
        );
    }

    let response: Response;
    try {
        const fetchImpl = options.fetchImpl ?? fetch;
        response = await fetchImpl(url, buildAuthorizedInit(token, options.init));
    } catch {
        throw new AuthenticatedRequestError(
            'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.',
            'NETWORK_ERROR',
        );
    }

    if (!response.ok) {
        const serverMessage = await readServerError(response);
        throw new AuthenticatedRequestError(
            messageForStatus(response.status, serverMessage),
            'HTTP_ERROR',
            response.status,
        );
    }

    return response;
}

export async function fetchAuthenticatedJson<T>(
    url: string,
    options: AuthenticatedRequestOptions = {},
): Promise<T> {
    const response = await fetchAuthenticatedResponse(url, options);
    try {
        return await response.json() as T;
    } catch {
        throw new AuthenticatedRequestError(
            'El servidor devolvió una respuesta incompleta. Intentá generar el documento nuevamente.',
            'INVALID_RESPONSE',
            response.status,
        );
    }
}

export async function fetchAuthenticatedBlob(
    url: string,
    options: AuthenticatedRequestOptions = {},
): Promise<Blob> {
    const response = await fetchAuthenticatedResponse(url, options);
    try {
        return await response.blob();
    } catch {
        throw new AuthenticatedRequestError(
            'El servidor devolvió un documento inválido. Intentá generarlo nuevamente.',
            'INVALID_RESPONSE',
            response.status,
        );
    }
}

/** Descarga un Blob ya generado usando una URL efímera, nunca una URL con JWT. */
export function downloadBlob(
    blob: Blob,
    filename: string | null,
    options: Pick<AuthenticatedDownloadOptions, 'documentRef' | 'urlApi'> = {},
) {
    const documentRef: DownloadDocument = options.documentRef ?? document;
    const urlApi: BlobUrlApi = options.urlApi ?? URL;
    const blobUrl = urlApi.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = blobUrl;
    if (filename) anchor.download = filename;
    anchor.style.display = 'none';
    documentRef.body.appendChild(anchor);

    try {
        anchor.click();
    } finally {
        documentRef.body.removeChild(anchor);
        // El navegador ya capturó el destino al ejecutar click(). La revocación
        // en el siguiente task evita cortar descargas en WebViews más lentos.
        scheduleBlobRevoke(urlApi, blobUrl, 0);
    }
}

export async function downloadAuthenticatedFile(
    url: string,
    filename: string,
    options: AuthenticatedDownloadOptions = {},
) {
    const blob = await fetchAuthenticatedBlob(url, options);
    downloadBlob(blob, filename, options);
}

/**
 * Abre la ventana ANTES del primer await, dentro del gesto del click. Luego
 * obtiene el HTML con Bearer y navega la ventana a un Blob imprimible. Así no
 * se expone el JWT ni interviene el bloqueador de popups.
 */
export async function openAuthenticatedPreview(
    url: string,
    options: AuthenticatedPreviewOptions = {},
) {
    const windowRef = options.windowRef ?? window;
    const preview = openPreviewWindow(windowRef, options.features);
    renderPreviewPlaceholder(preview);

    try {
        const blob = await fetchAuthenticatedBlob(url, options);
        const urlApi = options.urlApi ?? URL;
        const blobUrl = urlApi.createObjectURL(blob);
        try {
            preview.location.replace(blobUrl);
            // La página ya queda cargada en la ventana independiente; mantener la
            // URL durante un minuto cubre WebViews lentos sin dejarla viva toda la
            // sesión. No usamos el evento load porque el about:blank inicial puede
            // dispararlo y revocar la URL antes de que navegue al documento.
            scheduleBlobRevoke(urlApi, blobUrl, 60_000);
        } catch (error) {
            urlApi.revokeObjectURL(blobUrl);
            throw error;
        }
    } catch (error) {
        preview.close();
        throw error;
    }
}

/**
 * Wrapper legado: conserva la firma usada por varias pantallas antiguas y
 * agrega la misma base segura de requests autenticados y URLs efímeras.
 */
export async function authenticatedDownload(
    url: string,
    options: AuthenticatedDownloadOptions,
): Promise<AuthenticatedDownloadResult> {
    const token = currentToken(options.token);
    if (!token) {
        throw new AuthenticatedRequestError(
            'Tu sesión expiró. Iniciá sesión de nuevo.',
            'NO_SESSION',
            401,
        );
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const urlApi = options.urlApi ?? URL;
    const preview = options.openInNewTab
        ? openPreviewWindow(options.windowRef ?? window, options.features)
        : null;

    if (preview) renderPreviewPlaceholder(preview);

    try {
        let response: Response;
        try {
            response = await fetchImpl(url, buildAuthorizedInit(token, options.init));
        } catch {
            throw new AuthenticatedRequestError(
                'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.',
                'NETWORK_ERROR',
            );
        }

        if (!response.ok) {
            throw new AuthenticatedRequestError(
                await extractDownloadError(response),
                'HTTP_ERROR',
                response.status,
            );
        }

        let blob: Blob;
        try {
            blob = await response.blob();
        } catch {
            throw new AuthenticatedRequestError(
                'El servidor devolvió un documento inválido. Intentá generarlo nuevamente.',
                'INVALID_RESPONSE',
                response.status,
            );
        }

        const resolvedFilename = options.filename
            || parseContentDispositionFilename(response.headers.get('content-disposition'));

        if (preview) {
            const blobUrl = urlApi.createObjectURL(blob);
            try {
                preview.location.replace(blobUrl);
                scheduleBlobRevoke(urlApi, blobUrl, 60_000);
            } catch (error) {
                urlApi.revokeObjectURL(blobUrl);
                throw error;
            }
            return { filename: resolvedFilename || null };
        }

        downloadBlob(blob, resolvedFilename || null, options);
        return { filename: resolvedFilename || null };
    } catch (error) {
        if (preview && !preview.closed) preview.close();
        throw error;
    }
}

export const authenticatedRequestErrorMessage = (
    error: unknown,
    fallback = 'No pudimos generar el documento. Intentá de nuevo.',
) => error instanceof Error && error.message ? error.message : fallback;
