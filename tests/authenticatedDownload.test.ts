import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AuthenticatedRequestError,
    downloadAuthenticatedFile,
    fetchAuthenticatedBlob,
    openAuthenticatedPreview,
} from '../utils/authenticatedDownload';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const response = (body: BodyInit, status = 200, contentType = 'text/plain') => new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
});

describe('descargas autenticadas', () => {
    it('adjunta el Bearer, descarga el Blob con el nombre pedido y limpia la URL temporal', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response('LIBRO'));
        const anchor = {
            href: '',
            download: '',
            style: { display: '' },
            click: vi.fn(),
        } as unknown as HTMLAnchorElement;
        const documentRef = {
            createElement: vi.fn(() => anchor),
            body: { appendChild: vi.fn(), removeChild: vi.fn() },
        };
        const urlApi = {
            createObjectURL: vi.fn(() => 'blob:nortex-libro'),
            revokeObjectURL: vi.fn(),
        };

        await downloadAuthenticatedFile('/api/fiscal/libro-compras/8/2026', 'compras.xlsx', {
            token: 'jwt-de-prueba',
            fetchImpl,
            documentRef: documentRef as any,
            urlApi,
        });

        const init = fetchImpl.mock.calls[0][1] as RequestInit;
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-de-prueba');
        expect(anchor.href).toBe('blob:nortex-libro');
        expect(anchor.download).toBe('compras.xlsx');
        expect(anchor.click).toHaveBeenCalledOnce();
        expect(documentRef.body.appendChild).toHaveBeenCalledWith(anchor);
        expect(documentRef.body.removeChild).toHaveBeenCalledWith(anchor);

        await vi.runAllTimersAsync();
        expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:nortex-libro');
    });

    it.each([
        [401, 'Tu sesión venció'],
        [403, 'no tiene permiso'],
        [500, 'Error generando Libro de Compras.'],
    ])('convierte HTTP %s en un error claro para el toast', async (status, message) => {
        const fetchImpl = vi.fn(async () => response(
            JSON.stringify({ error: status === 500 ? 'Error generando Libro de Compras.' : 'detalle interno' }),
            status as number,
            'application/json',
        ));

        const promise = fetchAuthenticatedBlob('/api/fiscal/documento', {
            token: 'jwt-de-prueba',
            fetchImpl,
        });

        await expect(promise).rejects.toMatchObject({
            name: 'AuthenticatedRequestError',
            status,
        });
        await expect(promise).rejects.toThrow(message as string);
    });

    it('distingue sesión ausente y falla antes de hacer una petición sin credenciales', async () => {
        const fetchImpl = vi.fn();
        await expect(fetchAuthenticatedBlob('/api/fiscal/documento', {
            token: null,
            fetchImpl,
        })).rejects.toMatchObject({ code: 'NO_SESSION', status: 401 });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('vista previa autenticada', () => {
    it('abre la ventana sincrónicamente antes de esperar el fetch y luego carga el Blob imprimible', async () => {
        vi.useFakeTimers();
        const order: string[] = [];
        let resolveFetch!: (value: Response) => void;
        const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
            order.push('fetch');
            return new Promise<Response>(resolve => { resolveFetch = resolve; });
        });
        const preview = {
            opener: {} as Window,
            document: { write: vi.fn(), close: vi.fn() },
            location: { replace: vi.fn() },
            addEventListener: vi.fn(),
            close: vi.fn(),
        };
        const windowRef = {
            open: vi.fn(() => {
                order.push('open');
                return preview;
            }),
        };
        const urlApi = {
            createObjectURL: vi.fn(() => 'blob:nortex-constancia'),
            revokeObjectURL: vi.fn(),
        };

        const pending = openAuthenticatedPreview('/api/fiscal/constancia-retencion/compra-1', {
            token: 'jwt-de-prueba',
            fetchImpl,
            windowRef: windowRef as unknown as Window,
            urlApi,
        });

        expect(order).toEqual(['open', 'fetch']);
        expect(windowRef.open).toHaveBeenCalledOnce();
        expect(preview.document.write).toHaveBeenCalledBefore(fetchImpl);

        resolveFetch(response('<html>constancia imprimible</html>', 200, 'text/html'));
        await pending;

        expect(preview.opener).toBeNull();
        expect(preview.location.replace).toHaveBeenCalledWith('blob:nortex-constancia');
        expect(preview.close).not.toHaveBeenCalled();
        await vi.runAllTimersAsync();
        expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:nortex-constancia');
    });

    it('cierra la ventana de espera cuando el servidor rechaza la constancia', async () => {
        const preview = {
            opener: null,
            document: { write: vi.fn(), close: vi.fn() },
            location: { replace: vi.fn() },
            addEventListener: vi.fn(),
            close: vi.fn(),
        };

        await expect(openAuthenticatedPreview('/api/fiscal/constancia-retencion/compra-1', {
            token: 'jwt-de-prueba',
            fetchImpl: async () => response('{}', 403, 'application/json'),
            windowRef: { open: () => preview } as unknown as Window,
        })).rejects.toMatchObject({ status: 403 });
        expect(preview.close).toHaveBeenCalledOnce();
        expect(preview.location.replace).not.toHaveBeenCalled();
    });

    it('reporta el bloqueador de popups sin iniciar una descarga huérfana', async () => {
        const fetchImpl = vi.fn();

        await expect(openAuthenticatedPreview('/api/fiscal/constancia-retencion/compra-1', {
            token: 'jwt-de-prueba',
            fetchImpl,
            windowRef: { open: () => null } as unknown as Window,
        })).rejects.toEqual(expect.objectContaining<Partial<AuthenticatedRequestError>>({
            code: 'POPUP_BLOCKED',
        }));
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
