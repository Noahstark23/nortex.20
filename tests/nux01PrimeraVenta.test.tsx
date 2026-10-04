// @vitest-environment jsdom
// N-UX-01 — Activación: primera venta en 5 minutos.
// Cubre los fixes del ticket que viven en el frontend:
//  1. "¿Cuántas unidades tenés?" visible en el alta rápida sin abrir "Más opciones",
//     y el stock viaja en el payload.
//  2. La ficha de existencias distingue "no hay bodegas" de "bodegas desactivadas".
//  4. "Administrar bodegas" explica qué es una bodega en lenguaje simple.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import QuickAddProduct from '../components/QuickAddProduct';
import { StockProductPane } from '../components/inventory/StockProductPane';
import { WarehouseWorkspaceManagement } from '../components/inventory/WarehouseWorkspaceHeader';
import Warehouses from '../components/Warehouses';

vi.mock('../components/ImageUploader', () => ({ default: () => null }));
vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));

const okJson = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('nortex_token', 'synthetic');
    localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const fillQuickAdd = (stock?: string) => {
    fireEvent.change(screen.getByPlaceholderText('7501234567890'), { target: { value: 'NUX-1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del producto *' }), { target: { value: 'Producto NUX' } });
    fireEvent.change(screen.getByPlaceholderText('150.00'), { target: { value: '150' } });
    if (stock !== undefined) fireEvent.change(screen.getByLabelText('¿Cuántas unidades tenés?'), { target: { value: stock } });
};

describe('N-UX-01 · alta rápida con existencias visibles', () => {
    it('muestra "¿Cuántas unidades tenés?" sin abrir "Más opciones"', () => {
        render(<QuickAddProduct onClose={vi.fn()} onSuccess={vi.fn()} />);
        const field = screen.getByLabelText('¿Cuántas unidades tenés?');
        expect(field).toBeVisible();
        // Sigue siendo opcional: el diálogo se puede guardar sin tocarlo.
        expect(field).not.toBeRequired();
    });

    it('manda el stock inicial en el payload para que nazca vendible', async () => {
        const onSuccess = vi.fn();
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'p-nux' }) });
        vi.stubGlobal('fetch', fetcher);
        render(<QuickAddProduct onClose={vi.fn()} onSuccess={onSuccess} />);
        fillQuickAdd('12');
        fireEvent.click(screen.getByRole('button', { name: /Guardar \(F2/ }));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ sku: 'NUX-1', stock: '12' });
    });
});

const paneProps = {
    product: { id: 'p1', name: 'Cable', sku: 'CABLE-1', stock: 0, unit: 'unidad' },
    revision: 1, canReceive: true, canReceiveOrders: false, canTransfer: false,
    canCount: false, canViewPrice: true, onClose: () => {}, onReceivingChange: () => {},
    onBusyChange: () => {}, onCompleted: () => {}, onNavigate: vi.fn(), actions: null,
};
const mockStockSnapshot = (data: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).includes('/api/warehouses/product/p1/stock')) return okJson({ success: true, data });
        return okJson({ success: true, data: [] });
    });
const snapshotBase = { productId: 'p1', totalStock: '0.0000', unit: 'unidad', hasMore: false };

describe('N-UX-01 · mensaje de bodegas según la realidad', () => {
    it('con bodegas desactivadas manda a reactivar, no a crear', async () => {
        mockStockSnapshot({ ...snapshotBase, warehouses: [], inactiveCount: 2 });
        render(<StockProductPane {...paneProps} />);
        expect(await screen.findByText(/Tus bodegas están desactivadas/)).toBeTruthy();
        expect(screen.queryByText(/No hay bodegas activas\. Creá una en Bodegas/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reactivá una en Bodegas' }));
        expect(paneProps.onNavigate).toHaveBeenCalledWith('/app/warehouses');
    });

    it('sin ninguna bodega mantiene el mensaje de crear', async () => {
        mockStockSnapshot({ ...snapshotBase, warehouses: [], inactiveCount: 0 });
        render(<StockProductPane {...paneProps} />);
        expect(await screen.findByText(/No hay bodegas activas\. Creá una en Bodegas para recibir mercadería\./)).toBeTruthy();
        expect(screen.queryByText(/Tus bodegas están desactivadas/)).toBeNull();
    });
});

describe('N-UX-01 · ayuda en administrar bodegas', () => {
    it('explica qué es una bodega en lenguaje simple', async () => {
        render(<WarehouseWorkspaceManagement open={true} busy={false} onClose={vi.fn()}><div /></WarehouseWorkspaceManagement>);
        expect(await screen.findByText(/Una bodega es un lugar donde guardás tu mercadería/)).toBeTruthy();
    });

    it('explica qué es la carga del vendedor junto a la asignación', async () => {
        const locations = [{ id: 'w1', name: 'Tienda', isActive: true, isDefault: true }, { id: 'w2', name: 'Reserva', isActive: true, isDefault: false }];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/warehouses') return okJson({ data: locations });
            if (url === '/api/team') return okJson([{ id: 'u1', name: 'Juan' }]);
            return okJson({ data: [] });
        });
        render(<MemoryRouter initialEntries={['/app/warehouses']}><Warehouses /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Administrar bodegas' }));
        expect(await screen.findByText(/La carga es la mercadería que el vendedor lleva en su ruta/)).toBeTruthy();
    });
});
