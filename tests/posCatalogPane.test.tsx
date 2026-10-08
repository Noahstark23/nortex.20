// @vitest-environment jsdom
import React, { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PosCatalogPane, type PosCatalogPaneProps } from '../components/pos/PosCatalogPane';
import { buscarProductos, indexarProductos } from '../utils/posSearch';
import type { Product } from '../types';

afterEach(cleanup);

const product = (id: number, category = 'General', stock = 12): Product => ({
    id: String(id), name: `Producto ${id}`, sku: `SKU-${id}`, price: 25,
    costPrice: 10, stock, category, unit: 'unidad', saleMode: 'COUNTED', quantityStep: 1,
});

function props(products: Product[] = []): PosCatalogPaneProps {
    const indiceProductos = indexarProductos(products);
    return {
        products, indiceProductos, resultadoBusqueda: buscarProductos(indiceProductos, '', 24),
        productsError: false, guidedSimpleMode: true, firstSaleMode: false, firstSaleStage: 1,
        quickProductsLabel: 'Tus productos', pageSize: 24, permiteStockNegativo: false,
        searchTerm: '', searchRef: createRef<HTMLInputElement>(), setSearchTerm: vi.fn(),
        handleSearchKeyDown: vi.fn(), agregarDesdeGrilla: vi.fn(), avisarProductoAgotado: vi.fn(),
        fetchProducts: vi.fn(), openQuickCreate: vi.fn(), onPractice: vi.fn(),
    };
}

function SearchHarness({ initial }: { initial: PosCatalogPaneProps }) {
    const [searchTerm, setSearchTerm] = useState(initial.searchTerm);
    return <PosCatalogPane {...initial} searchTerm={searchTerm} setSearchTerm={setSearchTerm}
        resultadoBusqueda={buscarProductos(initial.indiceProductos, searchTerm, searchTerm ? 60 : 24)} />;
}

describe('panel de catálogo del POS', () => {
    it('separa el texto del canvas de la tinta del buscador y las tarjetas blancas', () => {
        render(<PosCatalogPane {...props([product(1)])} firstSaleMode />);
        expect(screen.getByText('Primera venta real')).toHaveClass('nx-canvas-text');
        expect(screen.getByRole('heading', { name: 'Productos' })).toHaveClass('nx-compact-catalog-title');
        expect(screen.getByText('Al terminar se actualizan caja e inventario.')).toHaveClass('nx-canvas-muted');
        expect(screen.getByPlaceholderText('Escaneá o buscá un producto')).toHaveClass('bg-white', 'text-slate-950');
        expect(screen.getByText('Producto 1')).toHaveClass('nx-compact-catalog-name');
        expect(screen.getByText('SKU SKU-1')).toHaveClass('nx-compact-catalog-descriptor');
        expect(screen.getByText('12 en existencia · unidad')).toHaveClass('nx-compact-catalog-stock');
        expect(screen.getByRole('tab', { name: 'General' })).toHaveClass('nx-compact-catalog-tab');
        expect(screen.getByText('1 producto')).toHaveClass('nx-compact-catalog-count');
    });

    it('declara el recorte, muestra más y reinicia el límite al cambiar de categoría o buscar', () => {
        const initial = props(Array.from({ length: 30 }, (_, i) => product(i + 1, i < 25 ? 'General' : 'Bebidas')));
        render(<SearchHarness initial={initial} />);
        expect(screen.getByText('24 de 30')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar más productos' }));
        expect(screen.getByText('30 productos')).toBeVisible();
        fireEvent.click(screen.getByRole('tab', { name: 'General' }));
        expect(screen.getByText('24 de 25')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar más productos' }));
        expect(screen.getByText('25 productos')).toBeVisible();

        fireEvent.change(screen.getByPlaceholderText('Escaneá o buscá un producto'), { target: { value: 'Producto' } });
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(screen.getByText('24 de 30')).toBeVisible();
        fireEvent.change(screen.getByPlaceholderText('Escaneá o buscá un producto'), { target: { value: '' } });
        expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('24 de 25')).toBeVisible();
    });

    it('mantiene todas las categorías y vuelve a Todos si desaparece la seleccionada', () => {
        const initial = props(Array.from({ length: 7 }, (_, i) => product(i, `Categoría ${i}`)));
        const { rerender } = render(<PosCatalogPane {...initial} />);
        expect(screen.getAllByRole('tab')).toHaveLength(8);
        fireEvent.click(screen.getByRole('tab', { name: 'Categoría 6' }));
        expect(screen.getByRole('button', { name: /Agregar Producto 6/ })).toBeVisible();
        const changed = props(initial.products.slice(0, 6));
        rerender(<PosCatalogPane {...changed} />);
        expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('6 productos')).toBeVisible();
    });

    it('distingue catálogo vacío, error y sin resultados conservando una salida útil', () => {
        const initial = props();
        const { rerender } = render(<PosCatalogPane {...initial} />);
        fireEvent.click(screen.getByRole('button', { name: 'Agregar producto' }));
        expect(initial.openQuickCreate).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Prefiero practicar sin guardar datos' }));
        expect(initial.onPractice).toHaveBeenCalledWith('empty_catalog');
        expect(screen.getByText(/nombre, precio y existencia real/i)).toBeVisible();

        rerender(<PosCatalogPane {...initial} productsError />);
        expect(screen.getByText('No pudimos cargar tus productos')).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Agregar producto' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(initial.fetchProducts).toHaveBeenCalledOnce();

        rerender(<PosCatalogPane {...initial} searchTerm="inexistente" />);
        expect(screen.getByText('No encontramos ese producto')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
        expect(initial.setSearchTerm).toHaveBeenCalledWith('');
    });

    it('conserva foco, cambios de texto y Enter en los callbacks del POS', () => {
        const initial = props([product(1)]);
        render(<PosCatalogPane {...initial} />);
        const input = screen.getByPlaceholderText('Escaneá o buscá un producto');
        expect(initial.searchRef && 'current' in initial.searchRef && initial.searchRef.current).toBe(input);
        expect(input).toHaveFocus();
        fireEvent.change(input, { target: { value: 'SKU-1' } });
        expect(initial.setSearchTerm).toHaveBeenCalledWith('SKU-1');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(initial.handleSearchKeyDown).toHaveBeenCalledOnce();
    });

    it.each([1, 2, 3] as const)('presenta el paso %s de primera venta y ofrece práctica', (firstSaleStage) => {
        const initial = props([product(1)]);
        render(<PosCatalogPane {...initial} firstSaleMode firstSaleStage={firstSaleStage} />);
        const progress = screen.getByRole('list', { name: 'Progreso de tu primera venta' });
        const steps = within(progress).getAllByRole('listitem');
        expect(steps.map(step => step.textContent?.replace(/^\d/, ''))).toEqual(['Producto', 'Cobro', 'Venta lista']);
        expect(steps[firstSaleStage - 1]).toHaveAttribute('aria-current', 'step');
        fireEvent.click(screen.getByRole('button', { name: 'Practicar' }));
        expect(initial.onPractice).toHaveBeenCalledWith('first_sale');
    });

    it('avisa un agotado sin enviarlo a agregar y respeta la política explícita de negativos', () => {
        const initial = props([product(1, 'General', 0)]);
        const { rerender } = render(<PosCatalogPane {...initial} />);
        const blocked = screen.getByRole('button', { name: /Producto 1, agotado/ });
        expect(blocked).not.toBeDisabled();
        fireEvent.click(blocked);
        expect(initial.avisarProductoAgotado).toHaveBeenCalledWith(initial.products[0]);
        expect(initial.agregarDesdeGrilla).not.toHaveBeenCalled();

        rerender(<PosCatalogPane {...initial} permiteStockNegativo />);
        fireEvent.click(screen.getByRole('button', { name: /Agregar Producto 1/ }));
        expect(initial.agregarDesdeGrilla).toHaveBeenCalledWith(initial.products[0]);
    });

    it('preserva los accesos de producto y la salida del agotado en modo completo', () => {
        const initial = props([product(1, 'General', 0)]);
        const onFullCreate = vi.fn();
        const onImport = vi.fn();
        render(<PosCatalogPane {...initial} guidedSimpleMode={false} searchTerm="SKU-1"
            adminTools={<><button onClick={onFullCreate}>Nuevo</button><button onClick={onImport}>Excel</button></>} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rápido' }));
        fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }));
        fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
        expect(initial.openQuickCreate).toHaveBeenCalledOnce();
        expect(onFullCreate).toHaveBeenCalledOnce();
        expect(onImport).toHaveBeenCalledOnce();
        const blocked = screen.getByRole('button', { name: /Producto 1.*AGOTADO/ });
        expect(blocked).toHaveAttribute('aria-disabled', 'true');
        expect(blocked).not.toBeDisabled();
        fireEvent.click(blocked);
        expect(initial.agregarDesdeGrilla).toHaveBeenCalledWith(initial.products[0]);
    });
});
