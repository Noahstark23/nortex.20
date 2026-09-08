// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicCatalog, { parseConfirmedPublicOrder } from '../components/PublicCatalog';

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const successfulResponse = (body: unknown): Response => ({
    ok: true,
    json: async () => body,
} as Response);

const catalogResponse = {
    business: { name: 'Mi Tienda', slug: 'mi-tienda', phone: '50588880000' },
    products: [{
        id: 'visible-product',
        name: 'Arroz',
        price: 25,
        category: 'Abarrotes',
        unit: 'unidad',
        saleMode: 'COUNTED',
        quantityStep: 1,
    }],
    pagination: { page: 1, pageSize: 48, total: 2, totalPages: 2 },
    categories: ['Abarrotes'],
};

const staleCartItem = {
    id: 'cached-product',
    name: 'Café viejo',
    price: 10,
    category: 'Abarrotes',
    unit: 'paquete',
    saleMode: 'COUNTED',
    quantityStep: 1,
    presentation: 'BASE',
    quantity: '2',
};

const stalePackCartItem = {
    ...staleCartItem,
    id: 'cached-pack-product',
    name: 'Café en fardo viejo',
    price: 8,
    unit: 'unidad',
    packUnit: 'fardo viejo',
    packSize: 12,
    packPrice: 100,
    presentation: 'PACK',
};

const confirmedItems = [{
    productId: 'cached-product',
    name: 'Café premium vigente',
    quantity: '2',
    presentation: 'BASE',
    unit: 'bolsa',
    subtotal: '90.00',
}];

const confirmedPackItems = [{
    productId: 'cached-pack-product',
    name: 'Café en caja vigente',
    quantity: '2',
    presentation: 'PACK',
    unit: 'caja',
    subtotal: '240.00',
}];

const renderCatalog = () => render(
    <MemoryRouter initialEntries={['/catalog/mi-tienda']}>
        <Routes>
            <Route path="/catalog/:slug" element={<PublicCatalog />} />
        </Routes>
    </MemoryRouter>,
);

const openCheckoutWithCachedItem = async (cartItem = staleCartItem) => {
    localStorage.setItem('nortex_public_cart_mi-tienda', JSON.stringify([cartItem]));
    renderCatalog();
    await screen.findByText('Arroz');
    fireEvent.click(screen.getByRole('button', { name: /1 item/ }));
    expect(screen.getByText(cartItem.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar Pedido' }));
    fireEvent.change(screen.getByPlaceholderText('Nombre completo'), {
        target: { value: 'Ana Pérez' },
    });
    fireEvent.change(screen.getByPlaceholderText('8888-0000'), {
        target: { value: '8888-0000' },
    });
};

const whatsappMessage = (openSpy: ReturnType<typeof vi.spyOn>): string => {
    const href = String(openSpy.mock.calls[0]?.[0] ?? '');
    return new URL(href).searchParams.get('text') ?? '';
};

describe('confirmación autoritativa del catálogo público', () => {
    it('acepta un resumen canónico de delivery y rechaza formas ambiguas o inconsistentes', () => {
        expect(parseConfirmedPublicOrder({
            items: confirmedItems,
            total: 95,
        })).toEqual({ items: confirmedItems, total: '95.00' });

        expect(parseConfirmedPublicOrder({ items: confirmedItems, total: '89.99' })).toBeNull();
        expect(parseConfirmedPublicOrder({
            items: [{ ...confirmedItems[0], presentation: 'PACK', quantity: '1.5' }],
            total: '90.00',
        })).toBeNull();
        expect(parseConfirmedPublicOrder({
            items: [confirmedItems[0], confirmedItems[0]],
            total: '180.00',
        })).toBeNull();
        expect(parseConfirmedPublicOrder({ items: confirmedItems })).toBeNull();
    });

    it('confirma la cotización y arma WhatsApp solo con nombres y dinero devueltos por el servidor', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input) === '/api/public/orders' && init?.method === 'POST') {
                return successfulResponse({
                    orderId: 'public-order-12345678',
                    total: 90,
                    items: confirmedItems,
                });
            }
            return successfulResponse(catalogResponse);
        });
        vi.stubGlobal('fetch', fetchMock);
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        await openCheckoutWithCachedItem();
        fireEvent.click(screen.getByRole('button', { name: 'Cotización Mayorista' }));
        fireEvent.click(screen.getByRole('button', { name: 'Solicitar Cotización' }));

        await screen.findByText('¡Pedido Enviado!');
        expect(screen.getByText(/2 bolsa · Café premium vigente/)).toBeTruthy();
        expect(screen.getAllByText('C$ 90.00').length).toBeGreaterThanOrEqual(2);
        expect(screen.queryByText('Café viejo')).toBeNull();

        await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
        const message = whatsappMessage(openSpy);
        expect(message).toContain('total de C$ 90.00');
        expect(message).toContain('2 bolsa de Café premium vigente (C$ 90.00)');
        expect(message).not.toContain('Café viejo');
        expect(message).not.toContain('C$ 20.00');

        const postCall = fetchMock.mock.calls.find(call => String(call[0]) === '/api/public/orders');
        const requestBody = JSON.parse(String(postCall?.[1]?.body));
        expect(requestBody.items).toEqual([{
            productId: 'cached-product',
            quantity: '2',
            presentation: 'BASE',
        }]);
        expect(JSON.stringify(requestBody)).not.toContain('Café viejo');
        expect(JSON.stringify(requestBody)).not.toContain('"price"');
    });

    it('usa el resumen y total canónicos de delivery aunque incluyan flete', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input) === '/api/v1/pedidos' && init?.method === 'POST') {
                return successfulResponse({
                    pedidoId: 'pedido-abcdefgh',
                    total: 95,
                    costoEntrega: 5,
                    items: confirmedItems,
                    trackingPath: '/track/pedido-abcdefgh#token=capacidad',
                });
            }
            return successfulResponse(catalogResponse);
        });
        vi.stubGlobal('fetch', fetchMock);
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        await openCheckoutWithCachedItem();
        fireEvent.change(screen.getByPlaceholderText('Ej: Del parque central 2 cuadras al sur...'), {
            target: { value: 'Del parque central dos cuadras al sur' },
        });
        const deliveryButtons = screen.getAllByRole('button', { name: 'Pedir a Domicilio' });
        fireEvent.click(deliveryButtons[deliveryButtons.length - 1]);

        await screen.findByText('¡Pedido Enviado!');
        expect(screen.getByText(/2 bolsa · Café premium vigente/)).toBeTruthy();
        expect(screen.getByText('C$ 95.00')).toBeTruthy();

        await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
        const message = whatsappMessage(openSpy);
        expect(message).toContain('total de C$ 95.00');
        expect(message).toContain('2 bolsa de Café premium vigente (C$ 90.00)');
        expect(message).toContain('/track/pedido-abcdefgh#token=capacidad');
        expect(message).not.toContain('Café viejo');
    });

    it('conserva PACK como presentación y usa packUnit/cantidad confirmados en resumen y WhatsApp', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input) === '/api/public/orders' && init?.method === 'POST') {
                return successfulResponse({
                    orderId: 'public-pack-12345678',
                    total: 240,
                    items: confirmedPackItems,
                });
            }
            return successfulResponse(catalogResponse);
        });
        vi.stubGlobal('fetch', fetchMock);
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        await openCheckoutWithCachedItem(stalePackCartItem);
        fireEvent.click(screen.getByRole('button', { name: 'Cotización Mayorista' }));
        fireEvent.click(screen.getByRole('button', { name: 'Solicitar Cotización' }));

        await screen.findByText('¡Pedido Enviado!');
        expect(screen.getByText(/2 caja · Café en caja vigente/)).toBeTruthy();
        expect(screen.getAllByText('C$ 240.00').length).toBeGreaterThanOrEqual(2);
        expect(screen.queryByText(/fardo viejo/)).toBeNull();
        expect(screen.queryByText(/24 unidad/)).toBeNull();

        await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
        const message = whatsappMessage(openSpy);
        expect(message).toContain('2 caja de Café en caja vigente (C$ 240.00)');
        expect(message).not.toContain('fardo viejo');
        expect(message).not.toContain('24 unidad');

        const postCall = fetchMock.mock.calls.find(call => String(call[0]) === '/api/public/orders');
        const requestBody = JSON.parse(String(postCall?.[1]?.body));
        expect(requestBody.items).toEqual([{
            productId: 'cached-pack-product',
            quantity: '2',
            presentation: 'PACK',
        }]);
    });

    it('no genera WhatsApp ni muestra dinero cacheado si la respuesta no trae resumen canónico', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (
            String(input) === '/api/public/orders' && init?.method === 'POST'
                ? successfulResponse({ orderId: 'public-order-12345678', total: 90 })
                : successfulResponse(catalogResponse)
        )));
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        await openCheckoutWithCachedItem();
        fireEvent.click(screen.getByRole('button', { name: 'Cotización Mayorista' }));
        fireEvent.click(screen.getByRole('button', { name: 'Solicitar Cotización' }));

        await screen.findByText('¡Pedido Enviado!');
        expect(openSpy).not.toHaveBeenCalled();
        expect(screen.queryByText('Café viejo')).toBeNull();
        expect(screen.queryByText('C$ 20.00')).toBeNull();
        expect(screen.queryByText('Resumen confirmado')).toBeNull();
    });
});
