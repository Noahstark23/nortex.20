// @vitest-environment jsdom
import { useMemo } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePosCatalog } from '../hooks/usePosCatalog';

const product = (id: string, stock = 20) => ({ id, name: `Producto ${id}`, sku: `SKU-${id}`, stock, price: 25, cost: 10, minStock: 1 });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const setSession = (tenant: string) => {
    localStorage.setItem('nortex_token', `token-${tenant}`);
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: tenant }));
    localStorage.setItem('nortex_user', JSON.stringify({ id: `owner-${tenant}` }));
};
const mount = () => renderHook(({ tenant }) => usePosCatalog(useMemo(() => ({ Authorization: `Bearer token-${tenant}` }), [tenant])), { initialProps: { tenant: 'a' } });
beforeEach(() => { localStorage.clear(); setSession('a'); });
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('combina stock autoritativo, elimina solicitados ausentes y conserva el resto del dataset en memoria', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([product('a'), product('b'), product('c')]))
        .mockResolvedValueOnce(response([product('a', 0)])));
    const storageWrite = vi.spyOn(localStorage, 'setItem');
    const { result } = mount();
    await act(async () => { await result.current.fetchProducts(); });
    await act(async () => { await result.current.refreshSoldProducts(['a', 'b']); });
    expect(fetch).toHaveBeenLastCalledWith('/api/products?includeSellableStock=true&ids=a,b', expect.anything());
    expect(JSON.parse(JSON.stringify(result.current.products))).toEqual([
        expect.objectContaining({ id: 'a', stock: 0 }), expect.objectContaining({ id: 'c', stock: 20 }),
    ]);
    expect(storageWrite).not.toHaveBeenCalled();
});

it('divide más de cien ids, deduplica y no confunde un fragmento con todo el catálogo', async () => {
    const products = Array.from({ length: 205 }, (_, i) => product(`p${i}`));
    const fetcher = vi.fn(async (url: string) => {
        const ids = new URL(url, 'http://test').searchParams.get('ids')?.split(',');
        return response(ids ? ids.map(id => product(id, 7)) : products);
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = mount();
    await act(async () => { await result.current.fetchProducts(); });
    await act(async () => { await result.current.refreshSoldProducts([...products.map(p => p.id), 'p0']); });
    const lengths = fetcher.mock.calls.slice(1).map(([url]) => new URL(url, 'http://test').searchParams.get('ids')!.split(',').length);
    expect(lengths).toEqual([100, 100, 5]);
    expect(result.current.products).toHaveLength(205);
    expect(result.current.products.every(p => p.stock === 7)).toBe(true);
});

it.each(['http', 'network', 'malformed', 'incomplete-row', 'ignored-filter'])('recurre al completo ante parcial inválido: %s', async reason => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([product('a'), product('b')]));
    if (reason === 'network') fetcher.mockRejectedValueOnce(new TypeError('offline'));
    else fetcher.mockResolvedValueOnce(response(reason === 'malformed' ? {} : reason === 'incomplete-row' ? [{ id: 'a', name: 'Producto a', sku: 'SKU-a' }]
        : reason === 'ignored-filter' ? [product('a'), product('outside')] : [], reason !== 'http'));
    fetcher.mockResolvedValueOnce(response([product('a', 5), product('b', 9)]));
    vi.stubGlobal('fetch', fetcher);
    const { result } = mount();
    await act(async () => { await result.current.fetchProducts(); });
    await act(async () => { await result.current.refreshSoldProducts(['a']); });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/products?includeSellableStock=true', '/api/products?includeSellableStock=true&ids=a', '/api/products?includeSellableStock=true']);
    expect(result.current.products.map(p => p.stock)).toEqual([5, 9]);
    expect(result.current.productsError).toBe(false);
});

it('si también falla el completo conserva datos y anuncia error, sin fabricar stock', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([product('a')]))
        .mockResolvedValueOnce(response({}, false)).mockRejectedValueOnce(new TypeError('offline')));
    const { result } = mount();
    await act(async () => { await result.current.fetchProducts(); });
    await act(async () => { await result.current.refreshSoldProducts(['a']); });
    expect(result.current.products[0].stock).toBe(20);
    expect(result.current.productsError).toBe(true);
});

it('serializa completo y parcial: la respuesta vieja nunca pisa el stock posterior', async () => {
    let finish!: (value: Response) => void;
    const initial = new Promise<Response>(resolve => { finish = resolve; });
    const fetcher = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(response([product('a', 0)]));
    vi.stubGlobal('fetch', fetcher);
    const { result } = mount();
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = result.current.fetchProducts(); second = result.current.refreshSoldProducts(['a']); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { finish(response([product('a'), product('b')])); await Promise.all([first, second]); });
    expect(result.current.products.map(p => [p.id, p.stock])).toEqual([['a', 0], ['b', 20]]);
});

it('cambiar tenant descarta la respuesta anterior y permite leer el nuevo sin esperarla', async () => {
    let finish!: (value: Response) => void;
    const initial = new Promise<Response>(resolve => { finish = resolve; });
    const fetcher = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(response([product('b')]));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = mount();
    let old!: Promise<void>;
    await act(async () => { old = result.current.fetchProducts(); });
    setSession('b'); rerender({ tenant: 'b' });
    expect(result.current.products).toEqual([]);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { await result.current.fetchProducts(); });
    await act(async () => { finish(response([product('a')])); await old; });
    expect(result.current.products.map(p => p.id)).toEqual(['b']);
});

it('al desmontar cancela la petición y retira el refresco online', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const { result, unmount } = mount();
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.fetchProducts(); });
    unmount();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    window.dispatchEvent(new Event('online'));
    finish(response([product('a')])); await pending;
    expect(fetcher).toHaveBeenCalledTimes(1);
});

it('lee disponibilidad vendible en el catálogo y en el refresco parcial, incluyendo cero', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([{ ...product('a', 40), sellableStock: '3' }, product('b')]))
        .mockResolvedValueOnce(response([{ ...product('a', 40), sellableStock: 0 }]));
    vi.stubGlobal('fetch', fetcher);
    const { result } = mount();
    await act(async () => { await result.current.fetchProducts(); });
    expect(result.current.products.map(p => [p.id, p.stock, p.minStock])).toEqual([['a', 3, 1], ['b', 20, 1]]);
    await act(async () => { await result.current.refreshSoldProducts(['a']); });
    expect(result.current.products.map(p => [p.id, p.stock])).toEqual([['a', 0], ['b', 20]]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        '/api/products?includeSellableStock=true', '/api/products?includeSellableStock=true&ids=a',
    ]);
});

it.each(['desconocido', '1e309'])('una disponibilidad vendible inválida conserva el catálogo y anuncia error: %s', async sellableStock => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([product('a', 4)]))
        .mockResolvedValueOnce(response([{ ...product('a', 40), sellableStock }])));
    const { result } = mount();
    await act(async () => { await result.current.fetchProducts(); });
    await act(async () => { await result.current.fetchProducts(); });
    expect(result.current.products[0].stock).toBe(4);
    expect(result.current.productsError).toBe(true);
});
