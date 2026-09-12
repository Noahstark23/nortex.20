// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Warehouses from '../components/Warehouses';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe('consulta de traslados registrados', () => {
    beforeEach(() => { localStorage.setItem('nortex_user', JSON.stringify({ role: 'BODEGUERO' })); });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
    it('muestra comprobante, origen, destino y líneas después de consultar el historial', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
            const url = String(input);
            if (url === '/api/warehouses') return response({ data: [{ id: 'w1', name: 'Principal', isActive: true, isDefault: true }] });
            if (url.endsWith('/stock')) return response({ data: { items: [] } });
            if (url === '/api/stock-transfers') return response({ data: [{ id: 'transfer-123', createdAt: '2026-09-12T10:00:00Z', fromWarehouse: { name: 'Principal' }, toWarehouse: { name: 'Sucursal' }, items: [{ name: 'Clavo', quantity: '12.0000' }] }] });
            return response({ error: 'unexpected' }, 500);
        });
        render(<MemoryRouter><Warehouses /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Ver historial de traslados' }));
        expect(await screen.findByText('Principal → Sucursal')).toBeTruthy();
        expect(screen.getByText(/Comprobante transfer-123/)).toBeTruthy();
        expect(screen.getByText('12.0000 × Clavo')).toBeTruthy();
    });
    it('diferencia una falla HTTP de un historial vacío y permite reconsultar', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input) === '/api/stock-transfers'
            ? response({ error: 'No pudimos verificar los traslados.' }, 503)
            : response({ data: [] }));
        render(<MemoryRouter><Warehouses /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Ver historial de traslados' }));
        expect((await screen.findByRole('alert')).textContent).toContain('No pudimos verificar');
        expect(screen.queryByText('Todavía no hay traslados registrados.')).toBeNull();
        expect(screen.getByRole('button', { name: 'Actualizar historial' })).toBeTruthy();
    });
});
