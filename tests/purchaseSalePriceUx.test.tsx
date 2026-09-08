// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Purchases from '../components/Purchases';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const product = {
    id: 'product-meat',
    name: 'Carne de res',
    sku: 'CARNE-1',
    price: '120.00',
    cost: '91.25',
    stock: '20',
    unit: 'lb',
    saleMode: 'MEASURED',
    quantityStep: '0.01',
    packUnit: 'caja',
    packSize: '12',
    ivaExento: false,
    requiresBatchTracking: false,
};

const receivedPurchaseOrder = {
    id: 'po-1',
    supplierId: 'supplier-1',
    orderNumber: 'OC-0001',
    status: 'PARTIALLY_RECEIVED',
    items: [{
        id: 'po-line-1',
        productId: product.id,
        productName: product.name,
        quantityOrdered: '8',
        quantityReceived: '5',
        quantityOrderedExact: '8.0000',
        quantityReceivedExact: '5.0000',
        unitCost: '91.25',
        unitAtOrder: 'lb',
    }],
    receipts: [],
};

const repeatedProductPurchaseOrder = {
    ...receivedPurchaseOrder,
    id: 'po-repeated-product',
    orderNumber: 'OC-0002',
    items: [
        {
            ...receivedPurchaseOrder.items[0],
            id: 'po-line-repeated-a',
            quantityOrdered: '3',
            quantityReceived: '1',
            quantityOrderedExact: '3.0000',
            quantityReceivedExact: '1.0000',
        },
        {
            ...receivedPurchaseOrder.items[0],
            id: 'po-line-repeated-b',
            quantityOrdered: '4',
            quantityReceived: '2',
            quantityOrderedExact: '4.0000',
            quantityReceivedExact: '2.0000',
        },
    ],
};

const mockPurchasesApi = (options?: { purchaseOrders?: unknown[] }) => {
    let postedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === '/api/suppliers') return jsonResponse([{ id: 'supplier-1', name: 'Carnes Molina' }]);
        if (url === '/api/products') return jsonResponse([product]);
        if (url === '/api/purchases' && (!init?.method || init.method === 'GET')) return jsonResponse([]);
        if (url === '/api/purchase-orders') return jsonResponse({ data: options?.purchaseOrders ?? [] });
        if (url === '/api/warehouses') {
            return jsonResponse({ data: [{ id: 'warehouse-1', name: 'Bodega central', isActive: true, isDefault: true }] });
        }
        if (url === '/api/purchases' && init?.method === 'POST') {
            postedBody = JSON.parse(String(init.body));
            return jsonResponse({ message: 'Compra registrada' }, 201);
        }
        throw new Error(`URL no esperada: ${url} ${init?.method || 'GET'}`);
    });
    return () => postedBody;
};

const setRole = (role: string) => {
    // El token ilegible fuerza el fallback controlado a nortex_user.
    localStorage.setItem('nortex_token', 'qa-token');
    localStorage.setItem('nortex_user', JSON.stringify({ role }));
};

const addDirectProduct = async () => {
    fireEvent.change(await screen.findByLabelText('Proveedor *'), { target: { value: 'supplier-1' } });
    fireEvent.change(screen.getByPlaceholderText('Buscar producto por nombre o SKU...'), { target: { value: 'Carne' } });
    fireEvent.click(await screen.findByRole('button', { name: /Carne de res/ }));
};

const submitPurchase = (invoiceNumber: string) => {
    fireEvent.change(screen.getByLabelText('# Factura Proveedor *'), { target: { value: invoiceNumber } });
    fireEvent.click(screen.getByRole('button', { name: /Registrar factura|Procesar ingreso/ }));
};

describe('precio de venta al registrar compras', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('muestra el precio actual y envía un cambio explícito desde una OC vinculada', async () => {
        setRole('OWNER');
        const postedBody = mockPurchasesApi({ purchaseOrders: [receivedPurchaseOrder] });

        render(<Purchases />);
        fireEvent.change(await screen.findByLabelText('Proveedor *'), { target: { value: 'supplier-1' } });
        fireEvent.change(await screen.findByLabelText('Orden de compra (opcional)'), { target: { value: 'po-1' } });

        expect(screen.getByText('C$ 120.00')).toBeTruthy();
        expect(screen.getByText('por lb base')).toBeTruthy();
        const salePriceInput = screen.getByLabelText('Nuevo precio de venta (opcional) de Carne de res · línea po-line-1');
        expect((salePriceInput as HTMLInputElement).value).toBe('');
        fireEvent.change(salePriceInput, { target: { value: '145.50' } });
        submitPurchase('FAC-PRECIO-1');

        await waitFor(() => expect(postedBody()).toBeDefined());
        const body = postedBody() as { items: Array<Record<string, unknown>> };
        expect(body.items[0]).toEqual(expect.objectContaining({
            productId: 'product-meat',
            purchaseOrderItemId: 'po-line-1',
            salePrice: '145.5',
        }));
    });

    it('conserva el precio al dejar el campo vacío, también al comprar por empaque', async () => {
        setRole('ADMIN');
        const postedBody = mockPurchasesApi();

        render(<Purchases />);
        await addDirectProduct();
        fireEvent.change(screen.getByLabelText('Unidad de compra de Carne de res'), { target: { value: 'PACK' } });

        expect(screen.getByText('Siempre por lb base, aunque comprés por empaque.')).toBeTruthy();
        expect((screen.getByLabelText('Nuevo precio de venta (opcional) de Carne de res') as HTMLInputElement).value).toBe('');
        submitPurchase('FAC-PRECIO-2');

        await waitFor(() => expect(postedBody()).toBeDefined());
        const body = postedBody() as { items: Array<Record<string, unknown>> };
        expect(body.items[0]).not.toHaveProperty('salePrice');
        expect(body.items[0]).toEqual(expect.objectContaining({ purchaseUnit: 'PACK' }));
    });

    it('sincroniza un solo precio de catálogo cuando la OC repite el mismo producto', async () => {
        setRole('ADMIN');
        const postedBody = mockPurchasesApi({ purchaseOrders: [repeatedProductPurchaseOrder] });

        render(<Purchases />);
        fireEvent.change(await screen.findByLabelText('Proveedor *'), { target: { value: 'supplier-1' } });
        fireEvent.change(await screen.findByLabelText('Orden de compra (opcional)'), {
            target: { value: repeatedProductPurchaseOrder.id },
        });

        const first = screen.getByLabelText(
            'Nuevo precio de venta (opcional) de Carne de res · línea po-line-repeated-a',
        );
        const second = screen.getByLabelText(
            'Nuevo precio de venta (opcional) de Carne de res · línea po-line-repeated-b',
        );
        expect(screen.getAllByText('Se sincroniza en todas las líneas de este producto.')).toHaveLength(2);

        fireEvent.change(first, { target: { value: '150.25' } });
        expect((first as HTMLInputElement).value).toBe('150.25');
        expect((second as HTMLInputElement).value).toBe('150.25');
        submitPurchase('FAC-PRECIO-REPETIDO');

        await waitFor(() => expect(postedBody()).toBeDefined());
        const body = postedBody() as { items: Array<Record<string, unknown>> };
        expect(body.items).toHaveLength(2);
        expect(body.items.map(item => item.salePrice)).toEqual(['150.25', '150.25']);
    });

    it('rechaza en el formulario un precio que desbordaría el Float persistido', async () => {
        setRole('ADMIN');
        const postedBody = mockPurchasesApi();

        render(<Purchases />);
        await addDirectProduct();
        fireEvent.change(
            screen.getByLabelText('Nuevo precio de venta (opcional) de Carne de res'),
            { target: { value: '9'.repeat(400) } },
        );
        submitPurchase('FAC-PRECIO-OVERFLOW');

        expect((await screen.findAllByText(
            'Carne de res: el nuevo precio de venta debe ser representable y mayor que cero.',
        )).length).toBeGreaterThan(0);
        expect(postedBody()).toBeUndefined();
    });

    it('muestra el precio actual a MANAGER sin permitir ni enviar cambios', async () => {
        setRole('MANAGER');
        const postedBody = mockPurchasesApi();

        render(<Purchases />);
        await addDirectProduct();

        expect(screen.getByText('C$ 120.00')).toBeTruthy();
        expect(screen.getByText('Solo un administrador puede cambiar el precio de venta.')).toBeTruthy();
        expect(screen.queryByLabelText('Nuevo precio de venta (opcional) de Carne de res')).toBeNull();
        submitPurchase('FAC-PRECIO-3');

        await waitFor(() => expect(postedBody()).toBeDefined());
        const body = postedBody() as { items: Array<Record<string, unknown>> };
        expect(body.items[0]).not.toHaveProperty('salePrice');
    });
});
