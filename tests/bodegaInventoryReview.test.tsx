// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Inventory from '../components/Inventory';
vi.mock('../components/ImageUploader', () => ({ default: () => null }));
const product = { id: 'A', name: 'Producto A', sku: 'SKU-A', stock: 10, minStock: 0.5,
    unit: 'kg', price: 10, cost: 5, saleMode: 'MEASURED', quantityStep: '0.001' };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
type FetchRequest = (input: unknown, init?: RequestInit) => Promise<any>;
let fetcher: ReturnType<typeof vi.fn<FetchRequest>>;
beforeEach(() => {
    localStorage.setItem('nortex_user', JSON.stringify({ id: 'qa', role: 'OWNER' }));
    localStorage.setItem('nortex_token', 'synthetic');
    fetcher = vi.fn<FetchRequest>(async (input: unknown) => {
        const url = new URL(String(input), 'http://localhost');
        if (/^\/api\/warehouses\/product\/[^/]+\/stock$/.test(url.pathname)) return ok({ success:true, data:{ productId:url.pathname.split('/')[4],totalStock:'10.0000',unit:'kg',warehouses:[{id:'w1',name:'Principal',isActive:true,isDefault:true,stock:'10.0000',implicit:false}],hasMore:false } });
        if (url.pathname === '/api/products') return ok({ products: [product], total: 1 });
        if (url.pathname === '/api/products/categories' || url.pathname === '/api/suppliers') return ok([]);
        return ok({ totalProducts: 1 });
    });
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('AudioContext', class {
        currentTime = 0; destination = {};
        createOscillator() { return { connect() {}, frequency: { value: 0 }, start() {}, stop() {} }; }
        createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
async function mount() {
    render(<MemoryRouter initialEntries={['/app/inventory']}><Inventory /></MemoryRouter>);
    await screen.findAllByText('Producto A');
}
async function edit() {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Ver Producto A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Editar Producto A' }));
}
describe('revisión independiente de catálogo integrado', () => {
    it('la edición conserva 0,125 kg como 0.125 kg', async () => {
        await edit();
        fireEvent.change(screen.getByRole('textbox', { name: 'Avisarme cuando queden' }), { target: { value: '0,125' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));
        await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url === '/api/products/A' && init?.method === 'PUT')).toBe(true));
        const request = fetcher.mock.calls.find(([url, init]) => url === '/api/products/A' && init?.method === 'PUT')![1];
        expect(Number(JSON.parse(request!.body as string).minStock)).toBe(0.125);
    });
    it('no cierra la ficha durante guardado pendiente', async () => {
        const original = fetcher.getMockImplementation()! as FetchRequest;
        fetcher.mockImplementation((input, init) => init?.method === 'PUT' ? new Promise(() => {}) : original(input, init));
        await edit();
        fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar edición de producto' }));
        expect(screen.getByRole('heading', { name: 'Editar Producto' })).toBeInTheDocument();
    });
    it('un fallo de red del escáner informa que no pudo comprobar el código', async () => {
        const original = fetcher.getMockImplementation()! as FetchRequest;
        fetcher.mockImplementation((input, init) => String(input).includes('?search=') ? Promise.reject(new Error('red')) : original(input, init));
        await mount();
        for (const key of ['A', 'B', 'C', 'Enter']) fireEvent.keyDown(document.body, { key });
        expect(await screen.findByText('No pudimos buscar el código')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Nuevo producto' })).not.toBeInTheDocument();
    });
    it('una respuesta vieja de búsqueda no reemplaza la búsqueda actual', async () => {
        let resolveOld!: (value: unknown) => void;
        const original = fetcher.getMockImplementation()! as FetchRequest;
        fetcher.mockImplementation((input, init) => {
            const url = new URL(String(input), 'http://localhost');
            if (url.searchParams.get('search') === 'viejo') return new Promise(resolve => { resolveOld = resolve; });
            if (url.searchParams.get('search') === 'nuevo') return Promise.resolve(ok({ products: [{ ...product, id: 'N', name: 'Producto Nuevo' }], total: 1 }));
            return original(input, init);
        });
        await mount();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar productos' }), { target: { value: 'viejo' } });
        await waitFor(() => expect(resolveOld).toBeDefined());
        fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar productos' }), { target: { value: 'nuevo' } });
        await screen.findAllByText('Producto Nuevo');
        await act(async () => { resolveOld(ok({ products: [product], total: 1 })); });
        expect(screen.queryAllByText('Producto A')).toHaveLength(0);
    });
    it('un resumen viejo no reemplaza el resumen obtenido después de guardar', async () => {
        let resolveOld!: (value: unknown) => void;
        let count = 0;
        const original = fetcher.getMockImplementation()! as FetchRequest;
        fetcher.mockImplementation((input, init) => {
            if (String(input) === '/api/reports/inventory') {
                if (++count === 1) return new Promise(resolve => { resolveOld = resolve; });
                return Promise.resolve(ok({ totalProducts: 9 }));
            }
            return original(input, init);
        });
        await edit();
        fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Editar Producto' })).not.toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Más herramientas de productos' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Ver resumen del inventario' }));
        const card = screen.getByRole('button', { name: 'Ver todo el catálogo, sin filtros' });
        await within(card).findByText('9');
        await act(async () => { resolveOld(ok({ totalProducts: 42 })); });
        expect(within(card).getByText('9')).toBeInTheDocument();
    });
});
