// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicCatalog from '../components/PublicCatalog';

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

const showProduct = async (config: { unit: string; saleMode?: 'COUNTED' | 'MEASURED' | null; quantityStep?: string | null }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        business: { name: 'Tienda sintética', slug: 'prueba' },
        products: [{ id: 'p1', name: 'Producto sintético', price: 12, ...config }],
        categories: [],
    }))));
    render(<MemoryRouter initialEntries={['/catalog/prueba']}><Routes>
        <Route path="/catalog/:slug" element={<PublicCatalog />} />
    </Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: `Agregar Producto sintético por ${config.unit}` }));
    return await screen.findByLabelText(`Cantidad en ${config.unit} de Producto sintético`) as HTMLInputElement;
};

describe('cantidades de catálogo público con el mismo contrato del servidor', () => {
    it.each(['unidad', 'caja', 'cajas'])('el control + agrega enteros para %s heredado', async (unit) => {
        const input = await showProduct({ unit, saleMode: null, quantityStep: null });
        expect(input.value).toBe('1');
        fireEvent.click(within(input.parentElement!).getAllByRole('button')[1]);
        expect(input.value).toBe('2');
        expect(input.step).toBe('1');
        fireEvent.click(within(input.parentElement!).getAllByRole('button')[0]);
        expect(input.value).toBe('1');
    });

    it.each([
        { unit: 'kg', saleMode: 'MEASURED' as const, quantityStep: '0.25' },
        { unit: 'caja', saleMode: 'MEASURED' as const, quantityStep: '0.25' },
        { unit: 'cajas', saleMode: null, quantityStep: '0.25' },
    ])('el control + conserva un paso medido explícito: %o', async (config) => {
        const input = await showProduct(config);
        fireEvent.click(within(input.parentElement!).getAllByRole('button')[1]);
        expect(input.value).toBe('1.25');
        expect(input.step).toBe('0.25');
    });
});
