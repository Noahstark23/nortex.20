import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticatedDownload } from '../utils/authenticatedDownload';

describe('authenticatedDownload', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('descarga el archivo con Bearer y respeta el filename del servidor', async () => {
        vi.useFakeTimers();

        const click = vi.fn();
        const anchor = { click } as unknown as HTMLAnchorElement;
        const appendChild = vi.fn();
        const removeChild = vi.fn();
        const createObjectURL = vi.fn(() => 'blob:nortex-file');
        const revokeObjectURL = vi.fn();
        const fetchMock = vi.fn(async () => new Response('excel', {
            status: 200,
            headers: { 'Content-Disposition': 'attachment; filename="libro-compras.xlsx"' },
        }));

        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('document', {
            body: { appendChild, removeChild },
            createElement: vi.fn(() => anchor),
        });
        vi.stubGlobal('window', {
            open: vi.fn(),
            setTimeout,
        } as unknown as Window);
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

        const result = await authenticatedDownload('/api/fiscal/libro-compras/8/2026', {
            token: 'jwt-demo',
        });

        expect(fetchMock).toHaveBeenCalledWith('/api/fiscal/libro-compras/8/2026', {
            headers: { Authorization: 'Bearer jwt-demo' },
        });
        expect((anchor as any).href).toBe('blob:nortex-file');
        expect((anchor as any).download).toBe('libro-compras.xlsx');
        expect(click).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ filename: 'libro-compras.xlsx' });

        vi.runAllTimers();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:nortex-file');
    });

    it('abre la constancia en una pestaña preabierta y la cierra si el backend responde error', async () => {
        const replace = vi.fn();
        const close = vi.fn();
        const previewWindow = {
            opener: {},
            closed: false,
            close,
            location: { replace },
            document: {
                title: '',
                body: { innerHTML: '' },
            },
        };
        const open = vi.fn(() => previewWindow);
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'No autorizado.' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
        }));

        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('window', {
            open,
            setTimeout,
        } as unknown as Window);
        vi.stubGlobal('document', {
            body: { appendChild: vi.fn(), removeChild: vi.fn() },
            createElement: vi.fn(),
        });
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(),
            revokeObjectURL: vi.fn(),
        });

        await expect(authenticatedDownload('/api/fiscal/constancia-retencion/abc', {
            token: 'jwt-demo',
            openInNewTab: true,
        })).rejects.toThrow('No autorizado.');

        expect(open).toHaveBeenCalledWith('about:blank', '_blank');
        expect(close).toHaveBeenCalledTimes(1);
        expect(replace).not.toHaveBeenCalled();
    });

    it('falla rápido cuando la sesión ya no tiene token', async () => {
        await expect(authenticatedDownload('/api/fiscal/vet-export/8/2026', {
            token: null,
        })).rejects.toThrow('Tu sesión expiró. Iniciá sesión de nuevo.');
    });
});
