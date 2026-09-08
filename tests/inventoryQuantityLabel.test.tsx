// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Inventory from '../components/Inventory';

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

describe('inventario: etiqueta coherente con la regla efectiva', () => {
    it.each([
        ['caja', null, null, 'Legado · cantidades enteras'],
        ['unidad', null, null, 'Legado · cantidades enteras'],
        ['metro', null, null, 'Legado · fraccionable'],
        ['caja', null, '0.5', 'Legado · fraccionable'],
        ['caja', 'MEASURED', '0.5', 'Medido · paso 0.5'],
        ['caja', 'COUNTED', '1', 'Contado · paso 1'],
    ])('%s / %s / %s muestra %s', async (unit, saleMode, quantityStep, label) => {
        localStorage.setItem('nortex_user', JSON.stringify({ id: 'qa', role: 'OWNER' }));
        localStorage.setItem('nortex_token', 'synthetic-fixture');
        const product = { id: 'qa-label', name: 'Producto QA etiqueta', sku: 'QA-LABEL',
            stock: 4, minStock: 0, price: 10, cost: 5, unit, saleMode, quantityStep };
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            const path = new URL(String(input), 'http://localhost').pathname;
            const body = path === '/api/products' ? { products: [product], total: 1 }
                : path === '/api/warehouses' ? { data: [] } : [];
            return { ok: true, status: 200, json: async () => body };
        }));
        render(<MemoryRouter initialEntries={['/app/inventory']}><Inventory /></MemoryRouter>);
        const row = await screen.findByRole('row', { name: /QA-LABEL/ });
        expect(row).toHaveTextContent(label!);
        expect(within(screen.getByRole('combobox', { name: 'Filtrar por forma de venta' }))
            .getByRole('option', { name: 'Configuración automática (legado)' })).toBeInTheDocument();
    });
});
