// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Purchases from '../components/Purchases';
import PurchaseOrders from '../components/PurchaseOrders';
import SmartPurchases from '../components/SmartPurchases';
import { writeBodegaReceivingDraft } from '../utils/bodegaReceivingDraft';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const supplier = { id: 's', name: 'Proveedor' };
const product = { id: 'p', name: 'Producto medido', sku: 'P', cost: 2, price: 5, stock: 0, unit: 'kg', saleMode: 'MEASURED', quantityStep: '0.001' };
const order = { id: 'po', orderNumber: 'OC-1', supplierId: 's', supplier, status: 'APPROVED', createdAt: '2026-09-12T12:00:00Z',
    items: [{ id: 'line', productId: 'p', productName: product.name, quantityOrdered: '10', quantityReceived: '0',
        unitCost: '2', unitAtOrder: 'kg', saleModeAtOrder: 'MEASURED', quantityStepAtOrder: '0.001', product }], receipts: [] };
const purchase = { id: 'buy', supplierId: 's', supplier, invoiceNumber: 'F-1', date: '2026-09-12T12:00:00Z', createdAt: '2026-09-12T12:00:00Z',
    subtotal: '1000', tax: '0', total: '1000', balanceDue: '1000', status: 'PENDING_PAYMENT', paymentMethod: 'CREDIT', items: [] };
function install() {
    const bodies: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return json({ error: 'Respuesta de prueba' }, 503); }
        if (url === '/api/suppliers') return json([supplier]);
        if (url === '/api/products') return json([product]);
        if (url === '/api/warehouses') return json({ data: [{ id: 'w', name: 'Principal', isActive: true }] });
        if (url === '/api/purchases') return json([purchase]);
        if (url === '/api/purchase-orders') return json({ data: [order] });
        if (url.includes('/reorder')) return json({ items: [{ ...product, productId: 'p', currentStock: 0, supplierId: 's', suggestedQty: '2', reason: 'REORDER_POINT', daysRemaining: null }] });
        throw new Error(`Unexpected ${url}`);
    });
    return bodies;
}
async function openPurchase() {
    render(<Purchases />);
    await screen.findByRole('option', { name: 'Proveedor' });
    fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: 's' } });
    fireEvent.change(screen.getByLabelText('# Factura Proveedor *'), { target: { value: 'F-2' } });
    fireEvent.change(screen.getByPlaceholderText('Buscar producto por nombre o SKU...'), { target: { value: 'medido' } });
    fireEvent.click(screen.getByRole('button', { name: /^Producto medido/ }));
}
beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/app/purchases');
    localStorage.setItem('nortex_token', `x.${btoa(JSON.stringify({ role: 'OWNER', tenantId: 't', userId: 'u' }))}.x`);
    localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('bodega: coma decimal no multiplica cantidades ni dinero', () => {
    it('compra medida envía 0.125 kg a costo exacto 1.234567 al escribir comas', async () => {
        const bodies = install(); await openPurchase();
        fireEvent.change(screen.getByLabelText(/Cantidad a facturar de Producto medido/), { target: { value: '0,125' } });
        fireEvent.change(screen.getByLabelText(/Costo de Producto medido/), { target: { value: '1,234567' } });
        fireEvent.click(screen.getByRole('button', { name: 'Procesar ingreso' }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0].items[0]).toMatchObject({ quantity: '0.125', unitCost: '1.234567' });
    });

    it('la OC manual conserva cantidad medida y costo de seis decimales', async () => {
        const bodies = install();
        writeBodegaReceivingDraft('orders', { supplierId: 's', rows: [{ ...product, quantity: '1', unitCost: '2' }], receipts: {} });
        render(<PurchaseOrders />); fireEvent.click(screen.getByRole('button', { name: /Nueva OC/ }));
        await screen.findByRole('option', { name: 'Proveedor' });
        fireEvent.change(screen.getByLabelText('Cantidad de Producto medido'), { target: { value: '0,125' } });
        fireEvent.change(screen.getByLabelText('Costo de Producto medido'), { target: { value: '1,234567' } });
        fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0].items[0]).toMatchObject({ quantity: '0.125', unitCost: '1.234567' });
    });

    it('reposición envía cantidad y costo decimales sin eliminar la coma', async () => {
        const bodies = install(); render(<SmartPurchases />);
        await screen.findByLabelText('Cantidad de Producto medido');
        fireEvent.change(screen.getByLabelText('Cantidad de Producto medido'), { target: { value: '0,125' } });
        fireEvent.change(screen.getByLabelText('Costo de Producto medido'), { target: { value: '1,234567' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generar 1 orden(es)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear 1 orden(es)' }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0].items[0]).toMatchObject({ quantity: '0.125', unitCost: '1.234567' });
    });

    it('recepción física envía 0.125 y no 125', async () => {
        const bodies = install(); render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Recibir' }));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Confirmar recepción' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.change(screen.getByLabelText('Cantidad recibida de Producto medido'), { target: { value: '0,125' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0].items[0].quantityReceived).toBe('0.125');
    });

    it('el abono 1,25 envía 1.25 y no 125', async () => {
        const bodies = install(); render(<Purchases />);
        fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Abonar' }));
        fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '1,25' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar abono' }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0].amount).toBe('1.25');
    });

    it('conserva un separador parcial sin romper el formulario y bloquea el envío ambiguo', async () => {
        const bodies = install(); await openPurchase();
        const amount = screen.getByLabelText(/Cantidad a facturar de Producto medido/) as HTMLInputElement;
        for (const [raw, normalized] of [['', ''], [',', '.'], ['0,', '0.']]) {
            fireEvent.change(amount, { target: { value: raw } }); expect(amount.value).toBe(normalized);
        }
        fireEvent.change(amount, { target: { value: '1.234,56' } });
        expect(amount.value).toBe('1.234,56');
        fireEvent.click(screen.getByRole('button', { name: 'Procesar ingreso' }));
        expect(bodies).toHaveLength(0);
        expect(amount.getAttribute('aria-invalid')).toBe('true');
    });

    it.each(['1,234.56', '1,2,3', '1e3', '-1', '1 234', '0x10'])('el costo %s permanece visible e inválido sin interpretar miles ni quitar signos', async (raw) => {
        const bodies = install(); await openPurchase();
        const cost = screen.getByLabelText(/Costo de Producto medido/) as HTMLInputElement;
        fireEvent.change(cost, { target: { value: raw } });
        expect(cost.value).toBe(raw);
        fireEvent.click(screen.getByRole('button', { name: 'Procesar ingreso' }));
        expect(bodies).toHaveLength(0);
        expect(cost.getAttribute('aria-invalid')).toBe('true');
    });

    it('no recorta decimales sobrantes de una cantidad y exige corregirla', async () => {
        const bodies = install(); await openPurchase();
        const amount = screen.getByLabelText(/Cantidad a facturar de Producto medido/) as HTMLInputElement;
        fireEvent.change(amount, { target: { value: '0,12345' } });
        expect(amount.value).toBe('0.12345');
        fireEvent.click(screen.getByRole('button', { name: 'Procesar ingreso' }));
        expect(bodies).toHaveLength(0);
    });

    it('el pago con ambos separadores pide corrección sin enviar un importe distinto', async () => {
        const bodies = install(); render(<Purchases />);
        fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Abonar' }));
        fireEvent.change(screen.getByLabelText('Monto del abono'), { target: { value: '1.234,56' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar abono' }));
        expect(screen.getByText('Ingresá un monto válido.')).toBeTruthy();
        expect(bodies).toHaveLength(0);
    });

    it('vincula los campos de vencimiento y notas a sus etiquetas', async () => {
        install(); await openPurchase();
        expect(screen.getByText('Pago de contado · Se descuenta de tu caja abierta')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Credito' }));
        expect(screen.getByLabelText('Fecha de vencimiento *')).toBeTruthy();
        expect(screen.getByLabelText('Notas (opcional)')).toBeTruthy();
    });
});
