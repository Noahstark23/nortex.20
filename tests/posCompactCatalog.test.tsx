// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CajaNicaCatalog, type CajaNicaCatalogProps } from '../components/pos/CajaNicaCatalog';
import type { Product } from '../types';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const product = (overrides: Partial<Product> & { minStock?: number | null } = {}) => ({
    id: 'p1', name: 'Cable THHN calibre 12 azul', sku: 'ELEC-12-A',
    price: 35, costPrice: 20, stock: 10, category: 'Electricidad', unit: 'metro', ...overrides,
});

const props = (overrides: Partial<CajaNicaCatalogProps> = {}): CajaNicaCatalogProps => ({
    products: [product()], totalProducts: 1, categories: ['Todos', 'Electricidad', 'Herramientas'],
    selectedCategory: 'Todos', searchTerm: '', blockedProductIds: new Set(),
    onCategoryChange: vi.fn(), onAdd: vi.fn(), onBlocked: vi.fn(), onShowMore: vi.fn(), ...overrides,
});

describe('catálogo compacto del mostrador', () => {
    it('permite agregar desde toda la fila sin controles anidados ni marcador de foto ausente', () => {
        const initial = props();
        const { container } = render(<CajaNicaCatalog {...initial} />);
        const row = screen.getByRole('button', { name: /Agregar Cable THHN calibre 12 azul/ });
        expect(within(row).getByText('Cable THHN calibre 12 azul')).toBeVisible();
        expect(within(row).getByText('SKU ELEC-12-A')).toBeVisible();
        expect(within(row).getByText('Por metro')).toBeVisible();
        expect(row.querySelector('button, input, select, a')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(screen.queryByText('CT')).not.toBeInTheDocument();
        fireEvent.click(within(row).getByText('Cable THHN calibre 12 azul'));
        expect(initial.onAdd).toHaveBeenCalledExactlyOnceWith(initial.products[0]);
        expect(row).not.toHaveAttribute('data-selected');
        expect(screen.queryByText(/En la venta:/)).not.toBeInTheDocument();
    });

    it('muestra solo la cantidad real del carrito y conserva cuatro decimales', () => {
        vi.useFakeTimers();
        const initial = props({ quantitiesByProduct: new Map() });
        const { rerender } = render(<CajaNicaCatalog {...initial} />);
        fireEvent.click(screen.getByRole('button', { name: /Agregar Cable/ }));
        expect(screen.queryByText(/En la venta:/)).not.toBeInTheDocument();
        rerender(<CajaNicaCatalog {...initial} quantitiesByProduct={new Map([['p1', 1.0001]])} />);
        expect(screen.getByText('En la venta: 1.0001 metro')).toBeVisible();
        expect(screen.getByRole('button', { name: /Agregar Cable/ })).toHaveAttribute('data-selected', 'true');
        act(() => { vi.advanceTimersByTime(700); });
        expect(screen.getByRole('button', { name: /Agregar Cable/ })).not.toHaveAttribute('data-selected');
        expect(screen.getByRole('button', { name: /Agregar Cable/ })).toHaveAttribute('data-in-cart', 'true');
        rerender(<CajaNicaCatalog {...initial} quantitiesByProduct={new Map([['p1', 0]])} />);
        expect(screen.queryByText(/En la venta:/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Agregar Cable/ })).not.toHaveAttribute('data-in-cart');
    });

    it('no inventa una cantidad para otro producto ni para datos no finitos', () => {
        render(<CajaNicaCatalog {...props({ quantitiesByProduct: new Map([['otro', 2], ['p1', Number.NaN]]) })} />);
        expect(screen.queryByText(/En la venta:/)).not.toBeInTheDocument();
    });

    it('respeta bloqueos sin impedir el aviso y no recalcula la autorización con la existencia', () => {
        const initial = props({ products: [product({ stock: 0 })], blockedProductIds: new Set(['p1']) });
        const { rerender } = render(<CajaNicaCatalog {...initial} />);
        const blocked = screen.getByRole('button', { name: 'Cable THHN calibre 12 azul, agotado' });
        expect(blocked).toHaveAttribute('aria-disabled', 'true');
        expect(blocked).not.toBeDisabled();
        fireEvent.click(blocked);
        expect(initial.onBlocked).toHaveBeenCalledExactlyOnceWith(initial.products[0]);
        expect(initial.onAdd).not.toHaveBeenCalled();
        rerender(<CajaNicaCatalog {...initial} products={[product({ stock: -2 })]} blockedProductIds={new Set()} />);
        expect(screen.getByText('-2 en existencia · metro')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: /Agregar Cable/ }));
        expect(initial.onAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stock: -2 }));
    });

    it.each([
        { minimum: 12, stock: 10, low: true },
        { minimum: 2, stock: 3, low: false },
        { minimum: 0, stock: 3, low: false },
        { minimum: undefined, stock: 3, low: true },
        { minimum: null, stock: 3, low: false },
        { minimum: Number.NaN, stock: 3, low: false },
    ])('usa mínimo $minimum con existencia $stock sin inventar un umbral configurado', ({ minimum, stock, low }) => {
        render(<CajaNicaCatalog {...props({ products: [product({ minStock: minimum, stock })] })} />);
        expect(Boolean(screen.queryByText(`Quedan ${stock} metro`))).toBe(low);
    });

    it('mantiene conteo real y la carga explícita de catálogos grandes', () => {
        const initial = props({ totalProducts: 1003 });
        render(<CajaNicaCatalog {...initial} />);
        expect(screen.getByText('1 de 1003')).toBeVisible();
        expect(screen.getByText('Quedan 1002 por mostrar')).toBeVisible();
        expect(screen.getAllByRole('button', { name: /Agregar Cable/ })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar más productos' }));
        expect(initial.onShowMore).toHaveBeenCalledOnce();
    });

    it('conserva categorías con teclado, selección y panel asociado', () => {
        const initial = props();
        function Harness() {
            const [selectedCategory, setSelectedCategory] = useState('Todos');
            return <CajaNicaCatalog {...initial} selectedCategory={selectedCategory} onCategoryChange={setSelectedCategory} />;
        }
        render(<Harness />);
        const all = screen.getByRole('tab', { name: 'Todos' });
        all.focus();
        fireEvent.keyDown(all, { key: 'ArrowRight' });
        const electrical = screen.getByRole('tab', { name: 'Electricidad' });
        expect(electrical).toHaveFocus();
        expect(electrical).toHaveAttribute('aria-selected', 'true');
        expect(electrical).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', electrical.id);
        fireEvent.keyDown(electrical, { key: 'End' });
        expect(screen.getByRole('tab', { name: 'Herramientas' })).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Herramientas' }), { key: 'Home' });
        expect(all).toHaveFocus();
    });

    it.each(['https://example.com/cable.jpg', 'http://res.cloudinary.com/dex1vy92h/image/upload/v1/cable.jpg'])('no solicita fotos fuera del proveedor autorizado: %s', imageUrl => {
        const { container } = render(<CajaNicaCatalog {...props({ products: [product({ imageUrl })] })} />);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('Cable THHN calibre 12 azul')).toBeVisible();
    });

    it('elimina la miniatura fallida y nunca sustituye una imagen por iniciales', () => {
        const { container, rerender } = render(<CajaNicaCatalog {...props({ products: [product({ imageUrl: 'https://res.cloudinary.com/dex1vy92h/image/upload/v1/cable.jpg' })] })} />);
        const photo = container.querySelector('img');
        expect(photo).toHaveAttribute('src', 'https://res.cloudinary.com/dex1vy92h/image/upload/v1/cable.jpg');
        fireEvent.error(photo!);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.queryByText('CT')).not.toBeInTheDocument();
        rerender(<CajaNicaCatalog {...props({ products: [product({ imageUrl: 'http://res.cloudinary.com/dex1vy92h/image/upload/v1/cable.jpg' })] })} />);
        expect(container.querySelector('img')).toBeNull();
    });
});
