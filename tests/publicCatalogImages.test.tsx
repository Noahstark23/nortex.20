// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicCatalog, {
    appendUniqueCatalogProducts,
    buildPublicCatalogUrl,
} from '../components/PublicCatalog';
import {
    cloudinaryProductSrcSet,
    normalizeProductImageSource,
    ProductImage,
} from '../components/ui/ProductImage';

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

const product = (id: string, name: string, imageUrl?: string) => ({
    id,
    name,
    imageUrl,
    price: 25,
    category: 'Abarrotes',
    unit: 'unidad',
    saleMode: 'COUNTED' as const,
    quantityStep: 1,
});

const successfulResponse = (body: unknown): Response => ({
    ok: true,
    json: async () => body,
} as Response);

const renderCatalog = () => render(
    <MemoryRouter initialEntries={['/catalog/mi-tienda']}>
        <Routes>
            <Route path="/catalog/:slug" element={<PublicCatalog />} />
        </Routes>
    </MemoryRouter>,
);

describe('ProductImage compartida', () => {
    it('optimiza solo entregas públicas y sin firma de Cloudinary', () => {
        const cloudinaryUrl = 'https://res.cloudinary.com/nortex/image/upload/v123/productos/arroz.jpg';
        const srcSet = cloudinaryProductSrcSet(cloudinaryUrl);

        expect(srcSet).toContain('/image/upload/f_auto,q_auto,c_limit,w_160/');
        expect(srcSet).toContain('800w');
        expect(cloudinaryProductSrcSet('https://fotos.example.com/arroz.jpg')).toBeUndefined();
        expect(cloudinaryProductSrcSet(
            'https://res.cloudinary.com/nortex/image/upload/s--firma--/v1/arroz.jpg',
        )).toBeUndefined();
        expect(cloudinaryProductSrcSet(
            'https://res.cloudinary.com/s--firma--/nortex/image/upload/v1/arroz.jpg',
        )).toBeUndefined();
        expect(normalizeProductImageSource('http://fotos.example.com/arroz.jpg')).toBe('');
        expect(normalizeProductImageSource('/productos/arroz.jpg')).toBe('');
    });

    it('mantiene el marco, cae a fallback y vuelve a intentar cuando cambia la URL', () => {
        const firstUrl = 'https://fotos.example.com/rota.jpg';
        const secondUrl = 'https://fotos.example.com/nueva.jpg';
        const { container, rerender } = render(
            <ProductImage
                src={firstUrl}
                alt="Arroz integral"
                className="aspect-square"
                loading="eager"
                fetchPriority="high"
            />,
        );

        const firstImage = screen.getByAltText('Arroz integral') as HTMLImageElement;
        expect(firstImage.getAttribute('loading')).toBe('eager');
        expect(firstImage.getAttribute('decoding')).toBe('async');
        expect(firstImage.getAttribute('srcset')).toBeNull();
        expect(container.firstElementChild?.className).toContain('aspect-square');

        fireEvent.error(firstImage);
        expect(screen.getByRole('img', { name: 'Sin foto disponible para Arroz integral' })).toBeTruthy();

        rerender(
            <ProductImage
                src={secondUrl}
                alt="Arroz integral"
                className="aspect-square"
            />,
        );
        expect((screen.getByAltText('Arroz integral') as HTMLImageElement).src).toBe(secondUrl);
    });

    it('manda URLs no HTTPS directo al fallback sin crear un request de imagen', () => {
        render(<ProductImage src="http://fotos.example.com/arroz.jpg" alt="Arroz" />);

        expect(screen.queryByAltText('Arroz')).toBeNull();
        expect(screen.getByRole('img', { name: 'Sin foto disponible para Arroz' })).toBeTruthy();
    });
});

describe('paginación del catálogo público', () => {
    it('pide 48 productos, agrega la siguiente página sin duplicar y conserva categorías', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('page=2')) {
                return successfulResponse({
                    business: { name: 'Mi Tienda', slug: 'mi-tienda' },
                    products: [product('2', 'Aceite'), product('3', 'Café')],
                    pagination: { page: 2, pageSize: 48, total: 3, totalPages: 2 },
                    categories: ['Abarrotes', 'Limpieza'],
                });
            }
            return successfulResponse({
                business: { name: 'Mi Tienda', slug: 'mi-tienda' },
                products: [
                    product('1', 'Arroz', 'https://res.cloudinary.com/nortex/image/upload/v1/arroz.jpg'),
                    product('2', 'Aceite'),
                ],
                pagination: { page: 1, pageSize: 48, total: 3, totalPages: 2 },
                categories: ['Abarrotes', 'Limpieza'],
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        renderCatalog();

        await screen.findByText('Arroz');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            '/api/public/catalog/mi-tienda?page=1&pageSize=48',
        );
        const firstPhoto = screen.getByAltText('Arroz');
        expect(firstPhoto.getAttribute('loading')).toBe('eager');
        expect(firstPhoto.getAttribute('srcset')).toContain('w_160');
        expect(screen.getByRole('button', { name: 'Limpieza' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Mostrar más' }));

        await screen.findByText('Café');
        expect(String(fetchMock.mock.calls[1][0])).toContain('page=2&pageSize=48');
        expect(screen.getAllByText('Aceite')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Mostrar más' })).toBeNull();
    });

    it('envía búsqueda y categoría al servidor después del debounce', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL) => successfulResponse({
            business: { name: 'Mi Tienda', slug: 'mi-tienda' },
            products: [product('1', 'Café molido')],
            pagination: { page: 1, pageSize: 48, total: 1, totalPages: 1 },
            categories: ['Abarrotes', 'Bebidas'],
        }));
        vi.stubGlobal('fetch', fetchMock);
        renderCatalog();
        await screen.findByText('Café molido');

        fireEvent.click(screen.getByRole('button', { name: 'Bebidas' }));
        await waitFor(() => expect(fetchMock.mock.calls.some(call => (
            String(call[0]).includes('category=Bebidas')
        ))).toBe(true));

        fireEvent.change(screen.getByPlaceholderText('Buscar productos...'), {
            target: { value: 'café premium' },
        });
        await waitFor(() => expect(fetchMock.mock.calls.some(call => (
            String(call[0]).includes('search=caf%C3%A9+premium')
        ))).toBe(true), { timeout: 1_500 });
    });

    it('aborta Mostrar más y libera su estado si cambia el filtro', async () => {
        let pageTwoSignal: AbortSignal | undefined;
        const fetchMock = vi.fn(async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> => {
            const url = String(input);
            if (url.includes('page=2')) {
                pageTwoSignal = init?.signal as AbortSignal | undefined;
                return new Promise<Response>((_resolve, reject) => {
                    pageTwoSignal?.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    }, { once: true });
                });
            }
            return successfulResponse({
                business: { name: 'Mi Tienda', slug: 'mi-tienda' },
                products: [product('1', 'Arroz')],
                pagination: { page: 1, pageSize: 48, total: 60, totalPages: 2 },
                categories: ['Abarrotes', 'Bebidas'],
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        renderCatalog();
        await screen.findByText('Arroz');

        fireEvent.click(screen.getByRole('button', { name: 'Mostrar más' }));
        await screen.findByRole('button', { name: 'Cargando...' });
        fireEvent.click(screen.getByRole('button', { name: 'Bebidas' }));

        await screen.findByRole('button', { name: 'Mostrar más' });
        expect(pageTwoSignal?.aborted).toBe(true);
    });

    it('tolera la respuesta legacy y limita las imágenes visibles a bloques de 48', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => successfulResponse({
            business: { name: 'Mi Tienda', slug: 'mi-tienda' },
            products: Array.from({ length: 49 }, (_, index) => (
                product(String(index + 1), `Producto ${index + 1}`)
            )),
        })));

        renderCatalog();

        await screen.findByText('Producto 1');
        expect(screen.queryByText('Producto 49')).toBeNull();
        expect(screen.getByRole('button', { name: 'Abarrotes' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar más' }));
        expect(await screen.findByText('Producto 49')).toBeTruthy();
    });
});

describe('helpers del catálogo paginado', () => {
    it('codifica slug y filtros, y no agrega ids repetidos', () => {
        expect(buildPublicCatalogUrl('tienda norte', {
            page: 3,
            search: ' café ',
            category: 'Bebidas frías',
        })).toBe(
            '/api/public/catalog/tienda%20norte?page=3&pageSize=48&search=caf%C3%A9&category=Bebidas+fr%C3%ADas',
        );

        expect(appendUniqueCatalogProducts(
            [product('1', 'Arroz')],
            [
                product('1', 'Arroz duplicado'),
                product('2', 'Aceite'),
                product('2', 'Aceite duplicado'),
            ],
        ).map(item => item.id)).toEqual(['1', '2']);
    });
});
