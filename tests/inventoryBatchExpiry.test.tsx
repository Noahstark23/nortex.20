// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Inventory from '../components/Inventory';

const product = { id: 'medicine-a', name: 'Medicamento QA', sku: 'MED-QA', stock: 5, minStock: 0,
    unit: 'unidad', price: 10, cost: 5, category: 'Farmacia', requiresBatchTracking: true };
const batches = [
    { id: 'yesterday', batchNumber: 'AYER', expiryDate: '2026-09-03T00:00:00.000Z', stock: 1 },
    { id: 'today-midnight', batchNumber: 'HOY-MEDIANOCHE', expiryDate: '2026-09-04T00:00:00.000Z', stock: 1 },
    { id: 'today-noon', batchNumber: 'HOY-MEDIODIA', expiryDate: '2026-09-04T12:00:00.000Z', stock: 1 },
    { id: 'tomorrow', batchNumber: 'MANANA', expiryDate: '2026-09-05T00:00:00.000Z', stock: 1 },
    { id: 'invalid', batchNumber: 'SIN-FECHA', expiryDate: 'invalid', stock: 1 },
];
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-04T18:00:00Z'));
    localStorage.clear();
    localStorage.setItem('nortex_user', JSON.stringify({ id: 'reviewer-a', role: 'OWNER' }));
    localStorage.setItem('nortex_token', 'synthetic-fixture');
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
        const { pathname } = new URL(String(input), 'http://localhost');
        if (pathname === '/api/products') return ok({ products: [product], total: 1 });
        if (pathname === '/api/inventory/batches/medicine-a') return ok(batches);
        if (pathname === '/api/warehouses') return ok({ data: [{ id: 'warehouse-a', name: 'Principal', isActive: true, isDefault: true }] });
        if (pathname === '/api/products/categories' || pathname === '/api/suppliers') return ok([]);
        return ok({});
    }));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function openBatches() {
    render(<MemoryRouter initialEntries={['/app/inventory']}><Inventory /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Más acciones de Medicamento QA' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lotes y vencimientos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Lotes de Medicamento QA' });
    await within(dialog).findByText('HOY-MEDIANOCHE');
    return dialog;
}

describe('fechas civiles en el modal real de lotes', () => {
    it('muestra el día escrito y no marca vencidos los lotes de hoy a medianoche o mediodía UTC', async () => {
        const dialog = await openBatches();
        for (const batchNumber of ['HOY-MEDIANOCHE', 'HOY-MEDIODIA']) {
            const row = within(dialog).getByRole('row', { name: new RegExp(batchNumber) });
            const date = within(row).getByText('04/09/2026');
            expect(date).not.toHaveClass('bg-red-900/40');
            expect(row).not.toHaveTextContent('Vencido');
        }
    });

    it('distingue ayer y mañana sin desplazar la fecha por la zona horaria del navegador', async () => {
        const dialog = await openBatches();
        expect(within(dialog).getByRole('row', { name: /AYER/ })).toHaveTextContent('Vencido · 03/09/2026');
        const tomorrow = within(dialog).getByRole('row', { name: /MANANA/ });
        expect(tomorrow).toHaveTextContent('05/09/2026');
        expect(tomorrow).not.toHaveTextContent('Vencido');
    });

    it('al comenzar el siguiente día Managua marca vencido lo de ayer y mantiene lo de hoy', async () => {
        vi.setSystemTime(new Date('2026-09-05T06:00:00.000Z'));
        const dialog = await openBatches();
        expect(within(dialog).getByRole('row', { name: /HOY-MEDIANOCHE/ })).toHaveTextContent('Vencido · 04/09/2026');
        expect(within(dialog).getByRole('row', { name: /HOY-MEDIODIA/ })).toHaveTextContent('Vencido · 04/09/2026');
        expect(within(dialog).getByRole('row', { name: /MANANA/ })).not.toHaveTextContent('Vencido');
    });

    it('una fecha ilegible se muestra sin verificar y nunca en verde', async () => {
        const dialog = await openBatches();
        const row = within(dialog).getByRole('row', { name: /SIN-FECHA/ });
        expect(within(row).getByText('Fecha sin verificar')).not.toHaveClass('bg-emerald-900/40');
    });
});
