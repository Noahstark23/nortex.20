// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import Inventory from '../components/Inventory';

let productRequests: URL[];
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
    productRequests = [];
    localStorage.clear();
    localStorage.setItem('nortex_user', JSON.stringify({ id: 'stock-reviewer', role: 'OWNER' }));
    localStorage.setItem('nortex_token', 'fixture-token');
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname === '/api/products') {
            productRequests.push(url);
            return ok({ products: [], total: 0 });
        }
        if (url.pathname === '/api/products/categories' || url.pathname === '/api/suppliers') return ok([]);
        return ok({});
    }));
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

function NextNotice() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate('/app/inventory?search=Alcohol%2070%25')}>Abrir otro aviso</button>;
}

describe('destino de un aviso de inventario', () => {
    it('muestra el producto de la URL y lo busca en el catálogo después del debounce', async () => {
        render(<MemoryRouter initialEntries={['/app/inventory?search=Suero%20oral']}><Inventory /></MemoryRouter>);
        expect(screen.getByPlaceholderText('Buscar por nombre, SKU o categoría...')).toHaveValue('Suero oral');
        await waitFor(() => expect(productRequests.some(url => url.searchParams.get('search') === 'Suero oral')).toBe(true));
        const filtered = productRequests.find(url => url.searchParams.get('search') === 'Suero oral')!;
        expect(filtered.searchParams.get('page')).toBe('1');
        expect(screen.getAllByText('Ningún producto coincide con "Suero oral". Probá con otro nombre o SKU.').length).toBeGreaterThan(0);
    });

    it('actualiza el producto al abrir otro aviso sin desmontar inventario y permite seguir buscando', async () => {
        render(<MemoryRouter initialEntries={['/app/inventory?search=Suero%20oral']}><Inventory /><NextNotice /></MemoryRouter>);
        await waitFor(() => expect(productRequests.some(url => url.searchParams.get('search') === 'Suero oral')).toBe(true));
        fireEvent.click(screen.getByRole('button', { name: 'Abrir otro aviso' }));
        const search = screen.getByPlaceholderText('Buscar por nombre, SKU o categoría...');
        expect(search).toHaveValue('Alcohol 70%');
        await waitFor(() => expect(productRequests.some(url => url.searchParams.get('search') === 'Alcohol 70%')).toBe(true));
        fireEvent.change(search, { target: { value: 'Vendas' } });
        await waitFor(() => expect(productRequests.some(url => url.searchParams.get('search') === 'Vendas')).toBe(true));
        expect(search).toHaveValue('Vendas');
    });
});
