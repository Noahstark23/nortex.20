// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useInventoryBarcode } from '../hooks/useInventoryBarcode';
beforeEach(() => localStorage.setItem('nortex_token', 'qa'));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
it('consulta código exacto con JWT y abre la ficha sin enviar mutaciones', async () => {
    const product = { id: 'p1', name: 'Martillo', sku: 'ABC-1', brand: 'Truper' };
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(product)); const select = vi.fn();
    const { result } = renderHook(() => useInventoryBarcode(select)); await act(() => result.current('ABC-1'));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/products/by-barcode/ABC-1', expect.objectContaining({ headers: { Authorization: 'Bearer qa' } }));
    expect(select).toHaveBeenCalledExactlyOnceWith(product);
});
it.each([401, 403, 500])('no transforma HTTP %s en producto inexistente o creación', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'Error' }, status)); const select = vi.fn();
    const { result } = renderHook(() => useInventoryBarcode(select));
    await expect(result.current('ABC')).rejects.toThrow('No pudimos comprobar'); expect(select).not.toHaveBeenCalled();
});
it('descarta respuesta tardía después de cambiar de sesión', async () => {
    let done!: (response: Response) => void; vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(resolve => { done = resolve; }));
    const select = vi.fn(); const { result } = renderHook(() => useInventoryBarcode(select)); const pending = result.current('ABC');
    localStorage.setItem('nortex_token', 'other'); done(response({ id: 'p', name: 'Ajeno', sku: 'ABC' })); await pending;
    expect(select).not.toHaveBeenCalled();
});
