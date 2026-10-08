// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Inventory from '../components/Inventory';
vi.mock('../components/ImageUploader', () => ({ default: () => null }));
const product = { id: 'A', name: 'Producto A', sku: 'SKU-A', stock: 10, minStock: 0, unit: 'unidad', price: 10, cost: 5, saleMode: 'COUNTED', quantityStep: '1' };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const login = (tenantId = 'tenant-a', userId = 'user-a') => {
    localStorage.setItem('nortex_token', `header.${btoa(JSON.stringify({ tenantId, userId, role: 'OWNER' }))}.signature`);
    localStorage.setItem('nortex_user', JSON.stringify({ id: userId, role: 'OWNER', tenant: { id: tenantId } }));
};
type Request = Record<string, any>;
let sent: Request[], stock: number;
let post: (payload: Request) => Promise<any>;
const confirmed = (payload: Request) => ok({ clientEventId: payload.clientEventId, replayed: true, movement: { ...payload, id: 'movement-1', tenantId: 'tenant-a', userId: 'user-a' } });
const rejectionBody = (payload: Request) => ({
    error: 'Stock insuficiente.', code: 'INSUFFICIENT_STOCK', outcome: 'REJECTED', clientEventId: payload.clientEventId,
    rejection: { ...payload, id: 'rejection-1', tenantId: 'tenant-a', userId: 'user-a' },
});
const rejected = (payload: Request) => ({ ok: false, status: 409, json: async () => rejectionBody(payload) });
beforeEach(() => {
    login(); stock = 10; sent = [];
    post = async () => { stock = 2; throw new Error('response lost after commit'); };
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname === '/api/inventory/adjust') { const payload = JSON.parse(init!.body as string); sent.push(payload); return post(payload); }
        if (url.pathname === '/api/products') return ok({ products: [product], total: 1 });
        if (url.pathname === '/api/products/categories' || url.pathname === '/api/suppliers') return ok([]);
        if (url.pathname === '/api/warehouses') return ok({ data: [{ id: 'warehouse-a', name: 'Principal', isActive: true, isDefault: true }] });
        if (url.pathname === '/api/warehouses/product/A/stock') return ok({success:true,data:{productId:'A',totalStock:stock.toFixed(4),unit:'unidad',warehouses:[{id:'warehouse-a',name:'Principal',isActive:true,isDefault:true,stock:stock.toFixed(4),implicit:false}],hasMore:false}});
        if (url.pathname.endsWith('/stock')) return ok({ data: { items: [{ productId: 'A', stock }] } });
        return ok({ totalProducts: 1 });
    }));
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { render(<MemoryRouter initialEntries={['/app/inventory']}><Inventory /></MemoryRouter>); await screen.findAllByText('Producto A'); }
async function open() {
    fireEvent.click(screen.getByRole('button', { name: 'Ver Producto A' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Más acciones de Producto A' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Registrar pérdida o sobrante' }));
    await screen.findByRole('dialog', { name: 'Ajustar existencias' });
}
async function submitFirst() {
    await mount(); await open();
    await waitFor(() => expect(screen.getByLabelText(/Bodega del ajuste/)).toHaveValue('warehouse-a'));
    fireEvent.change(screen.getByLabelText(/^Cantidad/), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/^Justificación/), { target: { value: 'Daño por traslado' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar pérdida' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pérdida' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar ajuste de inventario' })).toBeEnabled());
}
describe('recuperación del ajuste ante respuesta perdida', () => {
    it('cerrar y reabrir conserva UUID y payload aunque el stock ya disminuyó', async () => {
        await submitFirst();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar ajuste de inventario' }));
        await open();
        expect(screen.getByLabelText(/^Cantidad/)).toHaveValue('8');
        post = async payload => confirmed(payload);
        fireEvent.click(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' }));
        await waitFor(() => expect(sent).toHaveLength(2));
        expect(sent[1]).toEqual(sent[0]);
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ajustar existencias' })).not.toBeInTheDocument());
        expect(screen.getByText('Existencia actualizada en Principal.')).toBeInTheDocument();
        await open();
        expect(screen.getByLabelText(/^Cantidad/)).toHaveValue('');
    });
    it('remontar la aplicación recupera el intento y no permite cambiarlo', async () => {
        await submitFirst(); cleanup(); await mount(); await open();
        expect(screen.getByLabelText(/^Cantidad/)).toHaveValue('8');
        expect(screen.getByLabelText(/^Cantidad/)).toBeDisabled();
        expect(screen.getByLabelText(/^Justificación/)).toBeDisabled();
        expect(screen.getByLabelText(/Bodega del ajuste/)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Ganancia / Hallazgo' })).toBeDisabled();
        post = async payload => confirmed(payload);
        fireEvent.click(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' }));
        await waitFor(() => expect(sent).toHaveLength(2));
        expect(sent[1]).toEqual(sent[0]);
    });
    it.each([409, 403, 500, 200])('respuesta %i sin evidencia del resultado mantiene recuperación', async status => {
        post = async () => ({ ok: status === 200, status, json: async () => ({ error: 'No confirmado', code: 'INVENTORY_ADJUSTMENT_IDEMPOTENCY_CONFLICT' }) });
        await submitFirst();
        expect(screen.getByLabelText(/^Cantidad/)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' })).toBeEnabled();
    });
    it('no envía si no puede guardar el identificador antes de la petición', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        await mount(); await open();
        await waitFor(() => expect(screen.getByLabelText(/Bodega del ajuste/)).toHaveValue('warehouse-a'));
        fireEvent.change(screen.getByLabelText(/^Cantidad/), { target: { value: '8' } });
        fireEvent.change(screen.getByLabelText(/^Justificación/), { target: { value: 'Daño por traslado' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar pérdida' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Registrar pérdida' }));
        expect(await screen.findByText(/No se envió el ajuste/)).toBeInTheDocument();
        expect(sent).toHaveLength(0);
    });
    it('el intento de otro usuario no se recupera ni se expone', async () => {
        await submitFirst(); cleanup(); login('tenant-b', 'user-b'); await mount(); await open();
        expect(screen.getByLabelText(/^Cantidad/)).toHaveValue('');
        expect(screen.queryByRole('button', { name: 'Recuperar resultado del ajuste' })).not.toBeInTheDocument();
    });
    it('un doble submit síncrono envía una sola petición', async () => {
        post = () => new Promise(() => {});
        await mount(); await open();
        await waitFor(() => expect(screen.getByLabelText(/Bodega del ajuste/)).toHaveValue('warehouse-a'));
        fireEvent.change(screen.getByLabelText(/^Cantidad/), { target: { value: '8' } });
        fireEvent.change(screen.getByLabelText(/^Justificación/), { target: { value: 'Daño por traslado' } });
        const button = screen.getByRole('button', { name: 'Registrar pérdida' });
        await waitFor(() => expect(button).toBeEnabled());
        const form = button.closest('form')!;
        await act(async () => { fireEvent.submit(form); fireEvent.submit(form); fireEvent.keyDown(window, { key: 'Escape' }); });
        expect(sent).toHaveLength(1);
        expect(screen.getByRole('dialog', { name: 'Ajustar existencias' })).toBeInTheDocument();
    });
    it('la evidencia antigua no expira y la bodega caída no impide recuperar', async () => {
        await submitFirst();
        const key = Object.keys(sessionStorage).find(key => key.startsWith('nortex.inventory-adjustment.v1:'))!;
        const evidence = JSON.parse(sessionStorage.getItem(key)!);
        evidence.createdAt = '2020-01-01T00:00:00.000Z';
        sessionStorage.setItem(key, JSON.stringify(evidence));
        cleanup();
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation((input, init) => String(input).startsWith('/api/warehouses') ? Promise.reject(new Error('offline')) : original(input, init));
        post = async payload => confirmed(payload);
        await mount(); await open();
        fireEvent.click(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' }));
        await waitFor(() => expect(sent).toHaveLength(2));
        expect(sent[1]).toEqual(sent[0]);
    });
    it('la evidencia corrupta bloquea otro ajuste sin sobrescribirla', async () => {
        await submitFirst();
        const key = Object.keys(sessionStorage).find(key => key.startsWith('nortex.inventory-adjustment.v1:'))!;
        sessionStorage.setItem(key, '{broken');
        cleanup(); await mount(); await open();
        expect(await screen.findByText(/No pudimos recuperar la evidencia/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Registrar pérdida' })).toBeDisabled();
        expect(sessionStorage.getItem(key)).toBe('{broken');
        expect(sent).toHaveLength(1);
    });
    it('una respuesta de otra cuenta no elimina la evidencia ni anuncia éxito', async () => {
        let resolve!: (value: any) => void;
        post = () => new Promise(done => { resolve = done; });
        await mount(); await open();
        await waitFor(() => expect(screen.getByLabelText(/Bodega del ajuste/)).toHaveValue('warehouse-a'));
        fireEvent.change(screen.getByLabelText(/^Cantidad/), { target: { value: '8' } });
        fireEvent.change(screen.getByLabelText(/^Justificación/), { target: { value: 'Daño por traslado' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar pérdida' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Registrar pérdida' }));
        const key = Object.keys(sessionStorage).find(key => key.startsWith('nortex.inventory-adjustment.v1:'))!;
        const original = sessionStorage.getItem(key);
        login('tenant-b', 'user-b');
        await act(async () => { resolve(confirmed(sent[0])); });
        expect(sessionStorage.getItem(key)).toBe(original);
        expect(screen.queryByText('Ajuste registrado')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Ajustar existencias' })).not.toBeInTheDocument();
    });
    it('si falla limpiar una confirmación mantiene el mismo intento y explica que sí confirmó', async () => {
        await submitFirst();
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('unavailable'); });
        post = async payload => confirmed(payload);
        fireEvent.click(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' }));
        expect(await screen.findByText(/El ajuste se confirmó, pero/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' })).toBeEnabled();
        expect(sent[1]).toEqual(sent[0]);
    });
    it('no envía un payload sustituido en almacenamiento sin volver a revisarlo', async () => {
        await submitFirst();
        const key = Object.keys(sessionStorage).find(key => key.startsWith('nortex.inventory-adjustment.v1:'))!;
        const replacement = JSON.parse(sessionStorage.getItem(key)!);
        replacement.payload.quantity = -9;
        replacement.payload.clientEventId = 'e72ad228-85c6-4b39-a395-adf50f27b4c9';
        sessionStorage.setItem(key, JSON.stringify(replacement));
        fireEvent.click(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' }));
        expect(await screen.findByText(/La recuperación guardada cambió/)).toBeInTheDocument();
        expect(sent).toHaveLength(1);
        expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(replacement);
    });
    it('la bodega caída no oculta la explicación de evidencia corrupta', async () => {
        await submitFirst();
        const key = Object.keys(sessionStorage).find(key => key.startsWith('nortex.inventory-adjustment.v1:'))!;
        sessionStorage.setItem(key, '{broken'); cleanup();
        const original = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation((input, init) => String(input).startsWith('/api/warehouses') ? Promise.reject(new Error('offline')) : original(input, init));
        await mount(); await open();
        await waitFor(() => expect(screen.queryByText('Cargando bodegas…')).not.toBeInTheDocument());
        expect(screen.getByText(/No pudimos recuperar la evidencia/)).toBeInTheDocument();
    });
    it('un cambio de cuenta cierra también un formulario que todavía no se envió', async () => {
        await mount(); await open();
        await waitFor(() => expect(screen.getByLabelText(/Bodega del ajuste/)).toHaveValue('warehouse-a'));
        login('tenant-b', 'user-b');
        fireEvent.change(screen.getByLabelText(/^Cantidad/), { target: { value: '8' } });
        expect(screen.queryByRole('dialog', { name: 'Ajustar existencias' })).not.toBeInTheDocument();
        expect(sent).toHaveLength(0);
    });
    it('el rechazo durable libera el formulario y la corrección usa otro UUID', async () => {
        post = async payload => { stock = 2; return rejected(payload); };
        await submitFirst();
        expect(await screen.findByText(/No se aplicó el ajuste.*Stock insuficiente/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Cantidad/)).toBeEnabled();
        expect(screen.getByLabelText(/^Cantidad/)).toHaveValue('8');
        expect(screen.getByLabelText(/^Justificación/)).toHaveValue('Daño por traslado');
        expect(Object.keys(sessionStorage).filter(key => key.startsWith('nortex.inventory-adjustment.v1:'))).toHaveLength(0);
        fireEvent.change(screen.getByLabelText(/^Cantidad/), { target: { value: '1' } });
        post = async payload => confirmed(payload);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar pérdida' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Registrar pérdida' }));
        await waitFor(() => expect(sent).toHaveLength(2));
        expect(sent[1].clientEventId).not.toEqual(sent[0].clientEventId);
        expect(sent[1].quantity).toBe(-1);
        expect(sent[1].reason).toBe(sent[0].reason);
    });
    it('un rechazo perdido se recupera con el UUID original antes de liberar los datos', async () => {
        await submitFirst(); cleanup(); await mount(); await open();
        post = async payload => rejected(payload);
        fireEvent.click(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' }));
        expect(await screen.findByText(/No se aplicó el ajuste/)).toBeInTheDocument();
        expect(sent[1]).toEqual(sent[0]);
        expect(screen.getByLabelText(/^Cantidad/)).toBeEnabled();
    });
    it.each(['id', 'tenantId', 'userId', 'productId', 'warehouseId', 'quantity', 'type', 'reason', 'clientEventId'])('recibo REJECTED con %s no coincidente conserva el intento', async field => {
        post = async payload => {
            const body = rejectionBody(payload);
            body.rejection[field] = field === 'id' ? '' : field === 'quantity' ? -7 : 'different';
            return { ok: false, status: 409, json: async () => body };
        };
        await submitFirst();
        expect(screen.getByLabelText(/^Cantidad/)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' })).toBeEnabled();
        expect(screen.queryByText(/No se aplicó el ajuste/)).not.toBeInTheDocument();
    });
    it('fallo al limpiar un rechazo confirmado conserva recuperación y lo distingue de incertidumbre', async () => {
        await submitFirst();
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('unavailable'); });
        post = async payload => rejected(payload);
        fireEvent.click(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' }));
        expect(await screen.findByText(/No se aplicó el ajuste.*no pudimos limpiar/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Cantidad/)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Recuperar resultado del ajuste' })).toBeEnabled();
    });
});
