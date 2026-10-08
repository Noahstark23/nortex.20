// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Purchases from '../components/Purchases';
import SmartPurchases from '../components/SmartPurchases';
import PurchaseOrders from '../components/PurchaseOrders';
import { readBodegaReceivingDraft, writeBodegaReceivingDraft } from '../utils/bodegaReceivingDraft';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const supplier = { id: 'supplier-1', name: 'Proveedor prueba' };
const product = (id: string, cost = 0.1) => ({ id, name: `Producto ${id}`, sku: id, cost, price: 1, stock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', ivaExento: false });
const order = (status = 'RECEIVED') => ({ id: 'po-1', orderNumber: 'OC-001', supplierId: supplier.id, status, items: [{ id: 'line-1', productId: 'a', productName: 'Producto a', quantityOrdered: '10', quantityReceived: '6', quantityOrderedExact: '10', quantityReceivedExact: '6', unitCost: '1.23', unitCostExact: '1.234567', unitAtOrder: 'unidad', saleModeAtOrder: 'COUNTED', quantityStepAtOrder: '1' }], receipts: [] });
function install(orders: unknown[] = []) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === '/api/suppliers') return json([supplier]);
        if (url === '/api/products') return json([product('a'), product('b')]);
        if (url === '/api/purchases') return json([]);
        if (url === '/api/purchase-orders') return json({ data: orders });
        if (url === '/api/warehouses') return json({ data: [{ id: 'w', name: 'Principal', isActive: true }] });
        throw new Error(`Unexpected ${url} ${init?.method}`);
    });
}
beforeEach(() => {
    localStorage.clear(); sessionStorage.clear();
    window.history.replaceState({}, '', '/app/purchases');
    localStorage.setItem('nortex_token', `x.${btoa(JSON.stringify({ role: 'OWNER', tenantId: 'tenant-1', userId: 'user-1' }))}.x`);
    localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER', id: 'user-1', tenant: { id: 'tenant-1' } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('bodega: factura de mercadería recibida', () => {
    it('abre la factura desde la OC con proveedor, recibido y costo exacto ya cargados', async () => {
        window.history.replaceState({}, '', '/app/purchases?purchaseOrderId=po-1');
        install([order('CLOSED_SHORT')]); render(<Purchases />);
        const quantity = await screen.findByLabelText(/Cantidad a facturar de Producto a/);
        expect((quantity as HTMLInputElement).value).toBe('6');
        expect((screen.getByLabelText('Proveedor *') as HTMLSelectElement).value).toBe(supplier.id);
        expect((screen.getByLabelText(/Costo de Producto a/) as HTMLInputElement).value).toBe('1.234567');
    });
    it('permite facturar una orden cerrada con faltante conservando las seis recibidas', async () => {
        install([order('CLOSED_SHORT')]); render(<Purchases />);
        await screen.findByRole('option', { name: supplier.name });
        fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: supplier.id } });
        const select = screen.getByLabelText('Orden de compra (opcional)');
        fireEvent.change(select, { target: { value: 'po-1' } });
        expect((screen.getByLabelText(/Cantidad a facturar de Producto a/) as HTMLInputElement).value).toBe('6');
    });
    it('carga el costo exacto guardado al enlazar una OC', async () => {
        install([order()]); render(<Purchases />);
        await screen.findByRole('option', { name: supplier.name });
        fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: supplier.id } });
        fireEvent.change(screen.getByLabelText('Orden de compra (opcional)'), { target: { value: 'po-1' } });
        expect((screen.getByLabelText(/Costo de Producto a/) as HTMLInputElement).value).toBe('1.234567');
    });
    it('muestra C$0.24 por dos líneas gravadas de C$0.10 como el servidor', async () => {
        install(); render(<Purchases />);
        await screen.findByRole('option', { name: supplier.name });
        const search = screen.getByPlaceholderText('Buscar producto por nombre o SKU...');
        for (const id of ['a', 'b']) {
            fireEvent.change(search, { target: { value: `Producto ${id}` } });
            fireEvent.click(screen.getByRole('button', { name: new RegExp(`Producto ${id}`) }));
        }
        expect(screen.getByText(/C\$\s*0\.24/)).toBeTruthy();
    });
    it('restaura un formulario al volver al módulo sin registrarlo automáticamente', async () => {
        const fetch = install(); const view = render(<Purchases />);
        await screen.findByRole('option', { name: supplier.name });
        fireEvent.change(screen.getByLabelText('# Factura Proveedor *'), { target: { value: 'FAC-borrador' } });
        view.unmount(); render(<Purchases />);
        expect((screen.getByLabelText('# Factura Proveedor *') as HTMLInputElement).value).toBe('FAC-borrador');
        expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    });
    it('separa dos lotes del mismo producto en la misma factura', async () => {
        const fetch = install();
        fetch.mockImplementation(async input => {
            const url = String(input);
            if (url === '/api/products') return json([{ ...product('a'), requiresBatchTracking: true }]);
            if (url === '/api/suppliers') return json([supplier]);
            if (url === '/api/warehouses') return json({ data: [{ id: 'w', name: 'Principal', isActive: true }] });
            return json(url === '/api/purchase-orders' ? { data: [] } : []);
        });
        render(<Purchases />); await screen.findByRole('option', { name: supplier.name });
        for (let i = 0; i < 2; i++) {
            fireEvent.change(screen.getByPlaceholderText('Buscar producto por nombre o SKU...'), { target: { value: 'Producto a' } });
            fireEvent.click(screen.getByRole('button', { name: /^Producto a/ }));
        }
        expect(screen.getAllByPlaceholderText('Nº Lote')).toHaveLength(2);
        fireEvent.change(screen.getAllByPlaceholderText('Nº Lote')[0], { target: { value: 'L-A' } });
        fireEvent.change(screen.getAllByPlaceholderText('Nº Lote')[1], { target: { value: 'L-B' } });
        expect((screen.getAllByPlaceholderText('Nº Lote')[0] as HTMLInputElement).value).toBe('L-A');
        expect((screen.getAllByPlaceholderText('Nº Lote')[1] as HTMLInputElement).value).toBe('L-B');
    });
});

describe('bodega: reposición', () => {
    it('pagina la reposición y conserva la edición al volver a una página', async () => {
        const requests: string[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
            const url = String(input); requests.push(url);
            if (!url.includes('reorder')) return json([supplier]);
            const page = new URL(url, 'http://localhost').searchParams.get('page');
            return json({ total: 101, page: Number(page), pageSize: 100, hasMore: page === '1', items: [{ ...product(page!), productId: page, currentStock: 1, incomingQuantity: '2', supplierId: supplier.id, suggestedQty: '4', reason: 'REORDER_POINT', daysRemaining: null }] });
        });
        render(<SmartPurchases />);
        await screen.findByLabelText('Cantidad de Producto 1');
        fireEvent.change(screen.getByLabelText('Cantidad de Producto 1'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
        await screen.findByLabelText('Cantidad de Producto 2');
        expect(screen.getByText(/1 de 101 productos por reponer · Página 2/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
        expect((await screen.findByLabelText('Cantidad de Producto 1') as HTMLInputElement).value).toBe('7');
        expect(requests).toContain('/api/inventory/reorder?page=2&pageSize=100');
        expect(screen.getByText(/En camino: 2/)).toBeTruthy();
    });
    it('permite ordenar un costo de cuatro decimales válido sin bloquear silenciosamente', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('reorder')
            ? json({ items: [{ ...product('a', 1.2345), productId: 'a', currentStock: 0, supplierId: supplier.id, suggestedQty: '2', reason: 'REORDER_POINT', daysRemaining: null }] })
            : json([supplier]));
        render(<SmartPurchases />);
        const button = await screen.findByRole('button', { name: 'Generar 1 orden(es)' });
        expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    it('no presenta Todo en orden si la consulta falló', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('reorder') ? json({ error: 'Falló' }, 503) : json([supplier]));
        render(<SmartPurchases />);
        await waitFor(() => expect(screen.queryByText('Analizando inventario...')).toBeNull());
        expect(screen.queryByText('Todo en orden')).toBeNull();
    });
    it('actualizar conserva cantidad editada y reintenta solo el proveedor fallido con la misma clave', async () => {
        const attempts: { supplierId: string; key: string; quantity: string }[] = [];
        const suppliers = [supplier, { id: 'supplier-2', name: 'Segundo proveedor' }];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            if (init?.method === 'POST') {
                const body = JSON.parse(String(init.body));
                attempts.push({ supplierId: body.supplierId, key: new Headers(init.headers).get('Idempotency-Key')!, quantity: body.items[0].quantity });
                return body.supplierId === 'supplier-2' && attempts.length === 2 ? json({ error: 'Respuesta perdida' }, 503) : json({ data: { id: 'confirmed' } }, 201);
            }
            return String(input).includes('reorder') ? json({ items: suppliers.map((s, index) => ({ ...product(String(index), 1.2345), productId: String(index), currentStock: 0, supplierId: s.id, suggestedQty: '2', reason: 'REORDER_POINT', daysRemaining: null })) }) : json(suppliers);
        });
        render(<SmartPurchases />);
        await screen.findByRole('button', { name: 'Generar 2 orden(es)' });
        fireEvent.change(screen.getByLabelText('Cantidad de Producto 1'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
        await screen.findByRole('button', { name: 'Generar 2 orden(es)' });
        expect((screen.getByLabelText('Cantidad de Producto 1') as HTMLInputElement).value).toBe('3');
        fireEvent.click(screen.getByRole('button', { name: 'Generar 2 orden(es)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear 2 orden(es)' }));
        const retry = await screen.findByRole('button', { name: 'Generar 1 orden(es)' });
        fireEvent.click(retry); fireEvent.click(screen.getByRole('button', { name: 'Crear 1 orden(es)' }));
        await waitFor(() => expect(attempts).toHaveLength(3));
        expect(attempts.map(attempt => attempt.supplierId)).toEqual(['supplier-1', 'supplier-2', 'supplier-2']);
        expect(attempts[1].key).toBeTruthy(); expect(attempts[2]).toEqual(attempts[1]);
    });
});

describe('bodega: conservar recepción e identidad', () => {
    it('crear OC después de perder respuesta reutiliza la clave incluso al volver al módulo', async () => {
        const attempts: { key: string | null; body: string }[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (init?.method === 'POST') { attempts.push({ key: new Headers(init.headers).get('Idempotency-Key'), body: String(init.body) }); return json({ error: 'No confirmado' }, 503); }
            if (url.startsWith('/api/products?')) return json({ products: [product('a')] });
            if (url === '/api/purchase-orders') return json({ data: [] });
            return json([supplier]);
        });
        const view = render(<PurchaseOrders />);
        fireEvent.click(screen.getByRole('button', { name: /Nueva OC/ }));
        await screen.findByRole('option', { name: supplier.name });
        fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: supplier.id } });
        fireEvent.change(screen.getByPlaceholderText('Buscar producto para agregar…'), { target: { value: 'Producto' } });
        fireEvent.click(await screen.findByRole('button', { name: /^Producto a/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
        await screen.findByText('No confirmado');
        view.unmount(); render(<PurchaseOrders />);
        fireEvent.click(screen.getByRole('button', { name: /Nueva OC/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
        await waitFor(() => expect(attempts).toHaveLength(2));
        expect(attempts[0].key).toBeTruthy(); expect(attempts[1]).toEqual(attempts[0]);
    });
    it('cerrar y volver a abrir tras perder respuesta conserva cantidad y UUID', async () => {
        const bodies: any[] = [];
        const po = { ...order('APPROVED'), supplier, createdAt: '2026-09-12T12:00:00Z', items: [{ ...order().items[0], quantityReceived: 0, quantityReceivedExact: '0', product: { requiresBatchTracking: false, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' } }] };
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith('/receive')) { bodies.push(JSON.parse(String(init?.body))); return json({ error: 'Resultado no confirmado' }, 503); }
            if (url === '/api/purchase-orders') return json({ data: [po] });
            if (url === '/api/warehouses') return json({ data: [{ id: 'w', name: 'Principal', isActive: true }] });
            return json([supplier]);
        });
        const view = render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Recibir' }));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Confirmar recepción' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.change(screen.getByLabelText('Cantidad recibida de Producto a'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        await screen.findAllByText('Resultado no confirmado');
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        view.unmount(); render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Recibir' }));
        expect((screen.getByLabelText('Cantidad recibida de Producto a') as HTMLInputElement).value).toBe('2');
        await waitFor(() => expect((screen.getByRole('button', { name: 'Confirmar recepción' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[1]).toEqual(bodies[0]); expect(bodies[0].clientEventId).toBeTruthy();
    });
    it('un borrador no cruza usuario, tenant ni rol y no almacena el token', () => {
        expect(writeBodegaReceivingDraft('scope-test', { invoiceNumber: 'test' })).toBe(true);
        expect(readBodegaReceivingDraft('scope-test')).toEqual({ invoiceNumber: 'test' });
        const original = localStorage.getItem('nortex_token');
        for (const change of [{ tenantId: 'other' }, { userId: 'other' }, { role: 'BODEGUERO' }]) {
            localStorage.setItem('nortex_token', `x.${btoa(JSON.stringify({ role: 'OWNER', tenantId: 'tenant-1', userId: 'user-1', ...change }))}.x`);
            expect(readBodegaReceivingDraft('scope-test')).toBeNull();
        }
        expect(Object.values(sessionStorage).join('')).not.toContain(original);
    });
});
