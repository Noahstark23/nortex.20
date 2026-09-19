// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Purchases from '../components/Purchases';
import PurchaseOrders from '../components/PurchaseOrders';
import SmartPurchases from '../components/SmartPurchases';
import { writeBodegaReceivingDraft } from '../utils/bodegaReceivingDraft';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const supplier = { id: 's', name: 'Proveedor prueba' };
const warehouses = [{ id: 'w1', name: 'Principal', isActive: true }, { id: 'w2', name: 'Sucursal', isActive: true }];
const product = (id: string) => ({ id, name: `Producto ${id}`, sku: id, cost: 2, price: 5, stock: 0, unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' });
const order = (id: string, status = 'APPROVED') => ({ id, orderNumber: `OC-${id}`, supplierId: supplier.id, supplier, status,
    createdAt: '2026-09-12T12:00:00Z', receipts: [], items: [{ id: `line-${id}`, productId: id, productName: `Producto ${id}`,
        quantityOrdered: 10, quantityOrderedExact: '10', quantityReceived: status === 'RECEIVED' ? 10 : 0,
        quantityReceivedExact: status === 'RECEIVED' ? '10' : '0', unitCost: 2, unitCostExact: '2',
        unitAtOrder: 'unidad', saleModeAtOrder: 'COUNTED', quantityStepAtOrder: '1', product: product(id) }] });
const deferred = () => {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; });
    return { promise, resolve };
};
const disabled = (label: string | RegExp) => expect(screen.getByLabelText(label).matches(':disabled')).toBe(true);

beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/app/purchases');
    localStorage.setItem('nortex_token', `x.${btoa(JSON.stringify({ role: 'OWNER', tenantId: 't', userId: 'u' }))}.x`);
    localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER', id: 'u', tenant: { id: 't' } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('recepción: respuestas antiguas y edición durante envío', () => {
    it('una carga vieja de bodegas no cambia el destino elegido en otra recepción', async () => {
        const oldLoad = deferred(); let warehouseLoads = 0; const receipts: any[] = [];
        writeBodegaReceivingDraft('orders', { supplierId: '', rows: [], receipts: { a: { drafts: {}, warehouseId: 'w1', clientEventId: crypto.randomUUID(), supplierDeliveryRef: '' } } });
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith('/receive')) { receipts.push(JSON.parse(String(init?.body))); return json({ receipt: { receiptNumber: 'R' } }); }
            if (url === '/api/warehouses') return ++warehouseLoads === 1 ? oldLoad.promise : json({ data: warehouses });
            return url === '/api/purchase-orders' ? json({ data: [order('a'), order('b')] }) : json([supplier]);
        });
        render(<PurchaseOrders />);
        fireEvent.click((await screen.findAllByRole('button', { name: 'Recibir' }))[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Recibir' })[1]);
        await screen.findByRole('option', { name: 'Sucursal' });
        fireEvent.change(screen.getByLabelText(/Bodega de destino/), { target: { value: 'w2' } });
        await act(async () => { oldLoad.resolve(json({ data: warehouses })); });
        expect((screen.getByLabelText(/Bodega de destino/) as HTMLSelectElement).value).toBe('w2');
        fireEvent.change(screen.getByLabelText('Cantidad recibida de Producto b'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        await waitFor(() => expect(receipts).toHaveLength(1));
        expect(receipts[0].warehouseId).toBe('w2');
    });

    it('bloquea datos y cierre mientras la recepción está enviándose', async () => {
        const sent = deferred();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/receive')) return sent.promise;
            if (url === '/api/warehouses') return json({ data: [warehouses[0]] });
            return url === '/api/purchase-orders' ? json({ data: [order('a')] }) : json([supplier]);
        });
        render(<PurchaseOrders />); fireEvent.click(await screen.findByRole('button', { name: 'Recibir' }));
        await waitFor(() => expect((screen.getByLabelText(/Bodega de destino/) as HTMLSelectElement).value).toBe('w1'));
        fireEvent.change(screen.getByLabelText('Cantidad recibida de Producto a'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        try {
            disabled('Cantidad recibida de Producto a');
            expect(screen.getByLabelText(/Bodega de destino/).matches(':disabled')).toBe(true);
            expect(screen.getByRole('button', { name: 'Cerrar' }).matches(':disabled')).toBe(true);
            expect(screen.getByRole('button', { name: /Nueva OC/ }).matches(':disabled')).toBe(true);
            fireEvent.click(screen.getByRole('dialog').parentElement!);
            expect(screen.getByRole('dialog')).toBeTruthy();
        } finally { await act(async () => { sent.resolve(json({ receipt: { receiptNumber: 'R' } })); }); }
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('bloquea el borrador de OC y su cierre hasta conocer el resultado', async () => {
        const sent = deferred();
        writeBodegaReceivingDraft('orders', { supplierId: 's', rows: [{ ...product('a'), quantity: '2', unitCost: '2' }], receipts: {} });
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => init?.method === 'POST' ? sent.promise
            : String(input) === '/api/purchase-orders' ? json({ data: [] }) : json([supplier]));
        render(<PurchaseOrders />); fireEvent.click(screen.getByRole('button', { name: /Nueva OC/ }));
        await screen.findByRole('option', { name: supplier.name });
        fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
        try {
            disabled('Cantidad de Producto a'); disabled('Costo de Producto a'); disabled('Proveedor *');
            expect(screen.getByRole('button', { name: 'Cerrar' }).matches(':disabled')).toBe(true);
            expect(screen.getByRole('button', { name: /Nueva OC/ }).matches(':disabled')).toBe(true);
            fireEvent.click(screen.getByRole('dialog').parentElement!);
            expect(screen.getByRole('dialog')).toBeTruthy();
        } finally { await act(async () => { sent.resolve(json({ data: { id: 'new-po' } }, 201)); }); }
    });

    it('bloquea la factura y el cambio de pestaña durante su registro', async () => {
        const sent = deferred(); window.history.replaceState({}, '', '/app/purchases?purchaseOrderId=a');
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            if (init?.method === 'POST') return sent.promise;
            const url = String(input);
            if (url === '/api/suppliers') return json([supplier]);
            if (url === '/api/products') return json([product('a')]);
            if (url === '/api/purchase-orders') return json({ data: [order('a', 'RECEIVED')] });
            return url === '/api/warehouses' ? json({ data: warehouses }) : json([]);
        });
        render(<Purchases />); await screen.findByLabelText(/Cantidad a facturar de Producto a/);
        fireEvent.change(screen.getByLabelText('# Factura Proveedor *'), { target: { value: 'F-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar factura' }));
        try {
            disabled('# Factura Proveedor *'); disabled(/Cantidad a facturar de Producto a/); disabled(/Costo de Producto a/);
            expect(screen.getByRole('button', { name: 'Historial' }).matches(':disabled')).toBe(true);
        } finally { await act(async () => { sent.resolve(json({ purchase: { id: 'p' } })); }); }
        expect((screen.getByLabelText('# Factura Proveedor *') as HTMLInputElement).value).toBe('');
    });
});

describe('reposición: nuevos cálculos y ediciones humanas', () => {
    it('mantiene abierta la confirmación mientras se crea la orden y bloquea su edición', async () => {
        const sent = deferred();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => init?.method === 'POST' ? sent.promise
            : String(input).includes('reorder') ? json({ items: [{ ...product('a'), productId: 'a', currentStock: 0, supplierId: 's',
                suggestedQty: '10', reason: 'REORDER_POINT', daysRemaining: null }] }) : json([supplier]));
        render(<SmartPurchases />);
        fireEvent.click(await screen.findByRole('button', { name: 'Generar 1 orden(es)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear 1 orden(es)' }));
        try {
            disabled('Cantidad de Producto a');
            expect(screen.getByRole('button', { name: 'Cancelar' }).matches(':disabled')).toBe(true);
            expect(screen.getByRole('button', { name: 'Cerrar confirmación' }).matches(':disabled')).toBe(true);
            fireEvent.click(screen.getByRole('dialog').parentElement!);
            expect(screen.getByRole('dialog')).toBeTruthy();
        } finally { await act(async () => { sent.resolve(json({ data: { id: 'new-po' } }, 201)); }); }
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('actualiza valores automáticos y conserva solamente los campos corregidos por la persona', async () => {
        let refresh = false;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('reorder')
            ? json({ items: ['a', 'b'].map(id => ({ ...product(id), productId: id, currentStock: 0, supplierId: 's', cost: refresh ? 3 : 2,
                suggestedQty: refresh ? '4' : '10', reason: 'REORDER_POINT', daysRemaining: null })) }) : json([supplier]));
        const view = render(<SmartPurchases />); await screen.findByLabelText('Cantidad de Producto a');
        fireEvent.change(screen.getByLabelText('Cantidad de Producto b'), { target: { value: '7' } });
        refresh = true; fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
        expect((await screen.findByLabelText('Cantidad de Producto a') as HTMLInputElement).value).toBe('4');
        expect((screen.getByLabelText('Cantidad de Producto b') as HTMLInputElement).value).toBe('7');
        expect((screen.getByLabelText('Costo de Producto b') as HTMLInputElement).value).toBe('3');
        view.unmount(); render(<SmartPurchases />);
        expect((await screen.findByLabelText('Cantidad de Producto a') as HTMLInputElement).value).toBe('4');
        expect((screen.getByLabelText('Cantidad de Producto b') as HTMLInputElement).value).toBe('7');
    });

    it('una respuesta incierta conserva cantidad, costo y clave al recalcular la sugerencia', async () => {
        const attempts: { body: string; key: string | null }[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            if (init?.method === 'POST') {
                attempts.push({ body: String(init.body), key: new Headers(init.headers).get('Idempotency-Key') });
                return json({ error: 'No confirmado' }, 503);
            }
            return String(input).includes('reorder') ? json({ items: [{ ...product('a'), productId: 'a', currentStock: 0, supplierId: 's',
                cost: attempts.length ? 3 : 2, suggestedQty: attempts.length ? '4' : '10', reason: 'REORDER_POINT', daysRemaining: null }] }) : json([supplier]);
        });
        render(<SmartPurchases />);
        for (let index = 0; index < 2; index++) {
            fireEvent.click(await screen.findByRole('button', { name: 'Generar 1 orden(es)' }));
            fireEvent.click(screen.getByRole('button', { name: 'Crear 1 orden(es)' }));
            await waitFor(() => expect(attempts).toHaveLength(index + 1));
            await screen.findByLabelText('Cantidad de Producto a');
        }
        expect(attempts[0].key).toBeTruthy(); expect(attempts[1]).toEqual(attempts[0]);
    });
});
