// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { StockProductPane, type StockPaneProduct } from '../components/inventory/StockProductPane';

const purchases = vi.hoisted(() => ({ lastProps: null as any }));
vi.mock('../components/Purchases', () => ({ default: (props: any) => {
    purchases.lastProps = props;
    return <section aria-label="Compras existente"><p>{props.entryContext.product.name}</p><p>Bodega: {props.entryContext.warehouseId}</p>
        <button onClick={() => props.onBusyChange(true)}>Simular envío</button>
        <button onClick={props.onClose}>Volver a la ficha</button>
        <button onClick={props.onCompleted}>Simular comprobante confirmado</button></section>;
} }));

const product: StockPaneProduct = { id: 'cable', name: 'Cable eléctrico blanco', sku: 'CB-125', unit: 'm', stock: 999, price: 25, cost: 15 };
const locations = [
    { id: 'store', name: 'Tienda principal', stock: '2.5000', isDefault: true, isActive: true, implicit: false },
    { id: 'reserve', name: 'Bodega de reserva', stock: '10.0000', isDefault: false, isActive: true, implicit: false },
];
const snapshot = (warehouses = locations, totalStock = '12.5000') => ({ success: true, data: { productId: 'cable', totalStock, unit: 'm', warehouses, hasMore: false } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function mount(overrides: { product?: StockPaneProduct; canReceive?: boolean; canReceiveOrders?: boolean; canViewPrice?: boolean; actions?: ReactNode } = {}) {
    const onClose = vi.fn();
    const onBusyChange = vi.fn();
    const onReceivingChange = vi.fn();
    const onCompleted = vi.fn();
    const onNavigate = vi.fn();
    const props = { product, revision: 0, canReceive: true, canReceiveOrders: false, canTransfer: true, canCount: true, canViewPrice: true, onClose, onReceivingChange, onBusyChange, onCompleted, onNavigate, actions: <button>Editar datos</button>, ...overrides };
    function Host() {
        const [revision, setRevision] = useState(props.revision);
        return <StockProductPane {...props} revision={revision} onCompleted={() => { onCompleted(); setRevision(current => current + 1); }} />;
    }
    return { ...render(<Host />), onClose, onReceivingChange, onBusyChange, onCompleted, onNavigate };
}
beforeEach(() => { localStorage.clear(); localStorage.setItem('nortex_token', 'synthetic-pane-session'); purchases.lastProps = null; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('Ficha del producto con recepción en contexto', () => {
    it('exige elegir destino entre varias bodegas y entrega el producto exacto a Compras', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(snapshot()));
        const { onCompleted, onReceivingChange } = mount();
        const reserve = await screen.findByRole('button', { name: /Bodega de reserva/ });
        expect(screen.getByRole('button', { name: 'Recibir mercadería' })).toBeDisabled();
        expect(screen.getByText('Tocá la bodega donde vas a guardar la mercadería.')).toBeInTheDocument();
        expect(screen.queryByText('999')).not.toBeInTheDocument();
        fireEvent.click(reserve);
        fireEvent.click(screen.getByRole('button', { name: 'Recibir mercadería' }));
        expect(screen.getByRole('region', { name: 'Compras existente' })).toBeInTheDocument();
        expect(purchases.lastProps.embedded).toBe(true);
        expect(purchases.lastProps.entryContext.product).toBe(product);
        expect(purchases.lastProps.entryContext.warehouseId).toBe('reserve');
        expect(onReceivingChange).toHaveBeenLastCalledWith(true);
        expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
        expect(onCompleted).not.toHaveBeenCalled();
    });

    it('elige automáticamente una única bodega y volver conserva el destino sin registrar', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(snapshot([locations[1]], '10.0000')));
        const { onCompleted, onReceivingChange } = mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Recibir mercadería' })).toBeEnabled());
        expect(screen.getByRole('button', { name: /Bodega de reserva/ })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Recibir mercadería' }));
        fireEvent.click(screen.getByRole('button', { name: 'Volver a la ficha' }));
        expect(screen.getByRole('region', { name: `Ficha de ${product.name}` })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Bodega de reserva/ })).toHaveAttribute('aria-pressed', 'true');
        expect(onCompleted).not.toHaveBeenCalled();
        expect(onReceivingChange.mock.calls).toEqual([[true], [false]]);
    });

    it('propaga envío ocupado, bloquea volver y sólo el comprobante confirmado actualiza el saldo', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(snapshot([locations[1]], '10.0000'))).mockImplementation(() => Promise.resolve(response(snapshot([{ ...locations[1], stock: '15.0000' }], '15.0000'))));
        const { onBusyChange, onCompleted, onReceivingChange } = mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Recibir mercadería' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Recibir mercadería' }));
        fireEvent.click(screen.getByRole('button', { name: 'Simular envío' }));
        expect(onBusyChange).toHaveBeenLastCalledWith(true);
        fireEvent.click(screen.getByRole('button', { name: 'Volver a la ficha' }));
        expect(screen.getByRole('region', { name: 'Compras existente' })).toBeInTheDocument();
        expect(onCompleted).not.toHaveBeenCalled();
        expect(onReceivingChange).toHaveBeenLastCalledWith(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Simular comprobante confirmado' }));
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
        expect(onCompleted).toHaveBeenCalledOnce();
        expect(onReceivingChange).toHaveBeenLastCalledWith(false);
        expect(await screen.findByText('Mercadería recibida')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: /Bodega de reserva/ })).toHaveTextContent('15'));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('region', { name: 'Compras existente' })).not.toBeInTheDocument();
    });

    it('un fallo presenta saldo desconocido y reintento; no reutiliza el agregado viejo de catálogo', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ error: 'synthetic unavailable' }, 503)).mockResolvedValueOnce(response(snapshot([locations[0]], '2.5000')));
        mount();
        expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar las existencias por bodega.');
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.queryByText('999')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Recibir mercadería' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar existencias' }));
        expect(await screen.findByRole('button', { name: /Tienda principal/ })).toHaveTextContent('2.5');
    });

    it('el bodeguero consulta saldos físicos sin precio ni compra directa y conserva acceso a órdenes autorizadas', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(snapshot()));
        const { onNavigate } = mount({ product: { ...product, requiresBatchTracking: true }, canReceive: false, canReceiveOrders: true, canViewPrice: false, actions: null });
        await screen.findByRole('button', { name: /Tienda principal/ });
        expect(screen.queryByText(/Precio de venta|C\$/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Recibir mercadería' })).not.toBeInTheDocument();
        expect(screen.queryByText(/No se cargaron los datos de compra/)).not.toBeInTheDocument();
        expect(screen.getByText('Existencias físicas. Revisá los lotes para conocer lo disponible para vender.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Recibir una orden' }));
        expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/app/purchase-orders');
    });

    it('traslado y conteo llevan la bodega elegida y no permiten adivinarla', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(snapshot()));
        const { onNavigate } = mount();
        const reserve = await screen.findByRole('button', { name: /Bodega de reserva/ });
        expect(screen.getByRole('button', { name: 'Mover a otra bodega' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Contar aquí' })).toBeDisabled();
        fireEvent.click(reserve);
        fireEvent.click(screen.getByRole('button', { name: 'Mover a otra bodega' }));
        expect(onNavigate).toHaveBeenLastCalledWith('/app/warehouses', 'reserve');
        fireEvent.click(screen.getByRole('button', { name: 'Contar aquí' }));
        expect(onNavigate).toHaveBeenLastCalledWith('/app/inventory-count', 'reserve');
    });

    it('sin costo cargado abre la captura existente conservando el dato ausente, sin fabricar costo cero', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(snapshot([locations[0]], '2.5000')));
        mount({ product: { ...product, cost: undefined } });
        await screen.findByRole('button', { name: /Tienda principal/ });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Recibir mercadería' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Recibir mercadería' }));
        expect(purchases.lastProps.entryContext.product.cost).toBeUndefined();
        expect(purchases.lastProps.entryContext.warehouseId).toBe('store');
    });

    it('conserva el total del servidor y muestra explícitamente la parte fuera del desglose', async () => {
        const partial = snapshot();
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...partial, data: { ...partial.data, totalStock: '100.0000', hasMore: true, unlistedStock: '87.5000' } }));
        const { onNavigate } = mount();
        await screen.findByRole('button', { name: /Tienda principal/ });
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('Existencias fuera de este desglose: 87.5 m.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Ver todas las bodegas' }));
        expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/app/warehouses');
    });

    it('sin bodegas activas explica el siguiente paso y no permite recibir en un destino supuesto', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(snapshot([], '0.0000')));
        mount();
        expect(await screen.findByText('No hay bodegas activas. Creá una en Bodegas para recibir mercadería.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Recibir mercadería' })).toBeDisabled();
        expect(purchases.lastProps).toBeNull();
    });
});
