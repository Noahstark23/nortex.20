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
    documentRef?: DownloadDocument;
    urlApi?: BlobUrlApi;
}

export interface AuthenticatedPreviewOptions extends AuthenticatedRequestOptions {
    windowRef?: Window;
    urlApi?: BlobUrlApi;
    features?: string;
}

const currentToken = (token: string | null | undefined) => {
    if (token !== undefined) return token;
    return typeof localStorage === 'undefined' ? null : localStorage.getItem('nortex_token');
};

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

    const headers = new Headers(options.init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
        const fetchImpl = options.fetchImpl ?? fetch;
        response = await fetchImpl(url, { ...options.init, headers });
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
    filename: string,
    options: Pick<AuthenticatedDownloadOptions, 'documentRef' | 'urlApi'> = {},
) {
    const documentRef: DownloadDocument = options.documentRef ?? document;
    const urlApi: BlobUrlApi = options.urlApi ?? URL;
    const blobUrl = urlApi.createObjectURL(blob);
    const anchor = documentRef.createElement('a') as HTMLAnchorElement;
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    documentRef.body.appendChild(anchor);

    try {
        anchor.click();
    } finally {
        documentRef.body.removeChild(anchor);
        // El navegador ya capturó el destino al ejecutar click(). La revocación
        // en el siguiente task evita cortar descargas en WebViews más lentos.
        setTimeout(() => urlApi.revokeObjectURL(blobUrl), 0);
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
    const preview = windowRef.open(
        '',
        '_blank',
        options.features ?? 'width=900,height=760',
    );

    if (!preview) {
        throw new AuthenticatedRequestError(
            'El navegador bloqueó la vista previa. Permití las ventanas emergentes e intentá de nuevo.',
            'POPUP_BLOCKED',
        );
    }

    // `noopener` como feature hace que varios navegadores devuelvan `null`
    // aunque sí abran la pestaña, impidiendo cargar el Blob. Cortamos el
    // vínculo con la pantalla origen manualmente y conservamos el WindowProxy.
    try { preview.opener = null; } catch { /* WebView restringido */ }

    try {
        preview.document.write(`<!doctype html><html lang="es"><head><title>Generando constancia…</title></head><body style="font-family:system-ui;padding:2rem;color:#334155">Generando constancia fiscal…</body></html>`);
        preview.document.close();
    } catch {
        // Algunos WebViews no permiten escribir en about:blank; la descarga
        // autenticada puede continuar y reemplazar la ubicación igualmente.
    }

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
            setTimeout(() => urlApi.revokeObjectURL(blobUrl), 60_000);
        } catch (error) {
            urlApi.revokeObjectURL(blobUrl);
            throw error;
        }
    } catch (error) {
        preview.close();
        throw error;
    }
}

export const authenticatedRequestErrorMessage = (
    error: unknown,
    fallback = 'No pudimos generar el documento. Intentá de nuevo.',
) => error instanceof Error && error.message ? error.message : fallback;
