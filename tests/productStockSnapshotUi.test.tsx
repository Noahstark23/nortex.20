// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { useProductStock } from '../components/inventory/useProductStock';

const snapshot = (productId: string, stock = '12.5000') => ({ productId, totalStock: stock, unit: 'm', warehouses: [{ id: 'reserve', name: 'Reserva', isDefault: true, isActive: true, stock, implicit: false }], hasMore: false });
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status === 200, data }), { status });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function Surface({ productId, revision = 0 }: { productId: string; revision?: number }) {
    const result = useProductStock(productId, revision);
    return <div><h1>Producto {productId}</h1>
        {result.loading && <p role="status">Cargando</p>}
        {result.error && <p role="alert">{result.error}</p>}
        {result.data && <><p data-testid="current-product">{result.data.productId}</p><p data-testid="current-stock">{result.data.totalStock}</p><ul>{result.data.warehouses.map(row => <li key={row.id}>{row.name}: {row.stock}</li>)}</ul></>}
        <button onClick={result.retry}>Reintentar</button></div>;
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('nortex_token', 'synthetic-session-a'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('Saldos pertenecen al producto y la sesión vigentes', () => {
    it('la respuesta tardía de A nunca rellena la ficha B aunque la red ignore AbortSignal', async () => {
        const a = deferred<Response>();
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(input => String(input).includes('/A/') ? a.promise : Promise.resolve(response(snapshot('B', '7.0000'))));
        const view = render(<Surface productId="A" />);
        view.rerender(<Surface productId="B" />);
        expect(await screen.findByTestId('current-stock')).toHaveTextContent('7.0000');
        await act(async () => { a.resolve(response(snapshot('A', '999.0000'))); await a.promise; });
        expect(screen.getByTestId('current-product')).toHaveTextContent('B');
        expect(screen.getByTestId('current-stock')).toHaveTextContent('7.0000');
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    });

    it('un cambio de sesión quita el saldo anterior y no acepta una respuesta con la autoridad previa', async () => {
        const oldSession = deferred<Response>();
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => (init?.headers as Record<string, string>).Authorization === 'Bearer synthetic-session-a' ? oldSession.promise : Promise.resolve(response(snapshot('A', '3.0000'))));
        const view = render(<Surface productId="A" />);
        localStorage.setItem('nortex_token', 'synthetic-session-b');
        view.rerender(<Surface productId="A" />);
        expect(await screen.findByTestId('current-stock')).toHaveTextContent('3.0000');
        await act(async () => { oldSession.resolve(response(snapshot('A', '800.0000'))); await oldSession.promise; });
        expect(screen.getByTestId('current-stock')).toHaveTextContent('3.0000');
        expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer synthetic-session-b' });
    });

    it('una revisión muestra carga y después la nueva existencia, sin reciclar el saldo previo', async () => {
        const refresh = deferred<Response>();
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(snapshot('A', '4.0000'))).mockImplementationOnce(() => refresh.promise);
        const view = render(<Surface productId="A" />);
        expect(await screen.findByTestId('current-stock')).toHaveTextContent('4.0000');
        view.rerender(<Surface productId="A" revision={1} />);
        expect(screen.getByRole('status')).toHaveTextContent('Cargando');
        expect(screen.queryByTestId('current-stock')).not.toBeInTheDocument();
        await act(async () => { refresh.resolve(response(snapshot('A', '9.0000'))); await refresh.promise; });
        expect(screen.getByTestId('current-stock')).toHaveTextContent('9.0000');
    });

    it('ofrece reintento tras fallo y acepta un saldo cero cuando el servidor lo devuelve explícitamente', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('synthetic network failure')).mockResolvedValueOnce(response(snapshot('A', '0.0000')));
        render(<Surface productId="A" />);
        expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar las existencias por bodega.');
        expect(screen.queryByTestId('current-stock')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByTestId('current-stock')).toHaveTextContent('0.0000');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('un sobre de respuesta sin confirmación de éxito no convierte datos adjuntos en una lectura válida', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ success: false, data: snapshot('A') }), { status: 200 }));
        render(<Surface productId="A" />);
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.queryByTestId('current-stock')).not.toBeInTheDocument();
    });

    it.each([
        ['total nulo', { ...snapshot('A'), totalStock: null }],
        ['total vacío', { ...snapshot('A'), totalStock: '' }],
        ['total booleano', { ...snapshot('A'), totalStock: false }],
        ['saldo de bodega omitido', { ...snapshot('A'), warehouses: [{ id: 'reserve', name: 'Reserva', isDefault: true, isActive: true, implicit: false }] }],
        ['saldo de bodega inválido', { ...snapshot('A'), warehouses: [{ ...snapshot('A').warehouses[0], stock: 'sin saldo' }] }],
        ['producto distinto', snapshot('B')],
    ])('rechaza %s sin presentar una lectura como cero', async (_label, malformed) => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(malformed));
        render(<Surface productId="A" />);
        expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar las existencias por bodega.');
        expect(screen.queryByTestId('current-stock')).not.toBeInTheDocument();
    });
});
