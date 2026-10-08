// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import InventoryCatalog, { type InventoryCatalogFilters, type InventoryCatalogProps } from '../components/inventory/InventoryCatalog';

const initialFilters: InventoryCatalogFilters = { search: '', category: '', family: '', mode: '', status: '', sortField: 'name', sortDir: 'asc' };
const products = [
    { id: 'cable', name: 'Cable eléctrico blanco', sku: 'CB-125', stock: 12.5, minStock: 15, unit: 'm', price: 25 },
    { id: 'brocha', name: 'Brocha de 2 pulgadas', sku: 'BR-2', stock: 0, minStock: 3, unit: 'unidad', price: 75 },
];

function setup(overrides: Partial<InventoryCatalogProps> = {}) {
    const changed = vi.fn();
    const selected = vi.fn();
    const props: InventoryCatalogProps = {
        title: 'Productos', products, total: 2, loading: false, filters: initialFilters,
        onFiltersChange: changed, categories: ['Electricidad', 'Pintura'],
        selectedProductId: null, onSelectProduct: selected, canViewPrice: true, actions: {},
        emptyState: <p>No encontramos productos. Probá otra búsqueda.</p>, pagination: <button>Siguiente página</button>,
        ...overrides,
    };
    function ControlledCatalog() {
        const [filters, setFilters] = useState(props.filters);
        const [selectedId, setSelectedId] = useState(props.selectedProductId);
        return <InventoryCatalog {...props} filters={filters} selectedProductId={selectedId}
            onFiltersChange={patch => { changed(patch); setFilters(current => ({ ...current, ...patch })); }}
            onSelectProduct={product => { selected(product); setSelectedId(product.id); }} />;
    }
    const result = render(<ControlledCatalog />);
    return { ...result, changed, selected };
}

afterEach(cleanup);

describe('Catálogo que conserva el contexto del producto', () => {
    it('prioriza encontrar y abrir un producto; filtros avanzados no ocupan el recorrido inicial', () => {
        const create = vi.fn();
        const { selected, changed } = setup({ actions: { create } });
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar productos' }), { target: { value: 'cable' } });
        fireEvent.click(screen.getByRole('button', { name: 'Ver Cable eléctrico blanco' }));
        expect(selected).toHaveBeenCalledExactlyOnceWith(products[0]);
        expect(screen.getByRole('button', { name: 'Ver Cable eléctrico blanco' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('searchbox')).toHaveValue('cable');
        expect(screen.getByText('12.5 m · Bajo mínimo')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Editar|Kardex/i })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
        expect(create).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Borrar texto de búsqueda' }));
        expect(changed).toHaveBeenLastCalledWith({ search: '' });
        expect(screen.getByRole('searchbox')).toHaveFocus();
    });

    it('los accesos de existencias conservan la búsqueda y el filtro avanzado usa el contrato existente', () => {
        const { changed } = setup({ filters: { ...initialFilters, search: 'cable' } });
        fireEvent.click(screen.getByRole('button', { name: 'Por reponer' }));
        expect(changed).toHaveBeenLastCalledWith({ status: 'reorder' });
        expect(screen.getByRole('searchbox')).toHaveValue('cable');
        fireEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por categoría' }), { target: { value: 'Electricidad' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por familia operativa' }), { target: { value: 'AGRO_INPUT' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por forma de venta' }), { target: { value: 'MEASURED' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Ordenar productos' }), { target: { value: 'stock:asc' } });
        expect(changed).toHaveBeenLastCalledWith({ sortField: 'stock', sortDir: 'asc' });
        fireEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
        expect(screen.getByRole('combobox', { name: 'Filtrar por categoría' })).toHaveValue('Electricidad');
        fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
        expect(changed).toHaveBeenLastCalledWith({ category: '', family: '', mode: '', status: '', sortField: 'name', sortDir: 'asc' });
        expect(screen.getByRole('searchbox')).toHaveValue('cable');
    });

    it('sólo presenta herramientas autorizadas y devuelve el foco al cerrar con Escape', () => {
        const receiving = vi.fn();
        setup({ canViewPrice: false, actions: { receiving } });
        const more = screen.getByRole('button', { name: 'Más herramientas de productos' });
        fireEvent.click(more);
        const menu = screen.getByRole('menu', { name: 'Herramientas de productos' });
        expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
        expect(screen.getByRole('menuitem', { name: 'Recibir mercadería' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(more).toHaveFocus();
        fireEvent.click(more);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Recibir mercadería' }));
        expect(receiving).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.queryByText(/C\$/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
        expect(screen.queryByRole('option', { name: /precio|Publicados|Ocultos|Costo/i })).not.toBeInTheDocument();
    });

    it('mantiene Excel y selección masiva bajo Más, sin repetir herramientas en las tarjetas', () => {
        const importing = vi.fn();
        const bulk = vi.fn();
        setup({ actions: { import: importing, bulk } });
        expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Más herramientas de productos' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Importar desde Excel' }));
        expect(importing).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Más herramientas de productos' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Seleccionar varios productos' }));
        expect(bulk).toHaveBeenCalledOnce();
        expect(within(screen.getByRole('list', { name: 'Catálogo de productos' })).getAllByRole('button')).toHaveLength(2);
    });

    it('permite recorrer herramientas con teclado y cierra al seguir trabajando en el catálogo', () => {
        setup({ actions: { import: vi.fn(), warehouses: vi.fn() } });
        fireEvent.keyDown(screen.getByRole('button', { name: 'Más herramientas de productos' }), { key: 'ArrowDown' });
        expect(screen.getByRole('menuitem', { name: 'Importar desde Excel' })).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
        expect(screen.getByRole('menuitem', { name: 'Ver bodegas' })).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
        expect(screen.getByRole('menuitem', { name: 'Importar desde Excel' })).toHaveFocus();
        fireEvent.pointerDown(screen.getByRole('searchbox'));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('seleccionar para edición masiva no abre la ficha y no confunde identificadores de otra página', () => {
        const onToggle = vi.fn();
        const onToggleAll = vi.fn();
        const { selected } = setup({ selection: { enabled: true, ids: ['cable', 'otra-pagina'], onToggle, onToggleAll } });
        expect(screen.getByRole('checkbox', { name: 'Seleccionar todos los productos de esta página' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Seleccionar Cable eléctrico blanco' })).toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Brocha de 2 pulgadas' }));
        expect(onToggle).toHaveBeenCalledExactlyOnceWith('brocha');
        expect(selected).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los productos de esta página' }));
        expect(onToggleAll).toHaveBeenCalledOnce();
    });

    it('distingue carga de catálogo vacío y no informa cero mientras carga', () => {
        setup({ products: [], total: 0, loading: true });
        expect(screen.getByRole('status')).toHaveTextContent('Actualizando productos…');
        expect(screen.queryByText(/No encontramos|0 productos/)).not.toBeInTheDocument();
    });

    it('presenta el vacío y la paginación del controlador sin inventar resultados', () => {
        setup({ products: [], total: 0 });
        expect(screen.getByText('No encontramos productos. Probá otra búsqueda.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Siguiente página' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Más herramientas de productos' })).not.toBeInTheDocument();
    });

    it('conserva el signo del saldo negativo y el precio permitido; exportar no puede repetirse mientras procesa', () => {
        const exporting = vi.fn();
        setup({ products: [{ ...products[0], stock: -2 }], total: 1, actions: { export: exporting }, exporting: true });
        expect(screen.getByText('-2 m · Revisar existencia')).toBeInTheDocument();
        expect(screen.getByText(/C\$\s25\.00/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Más herramientas de productos' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Exportando…' }));
        expect(exporting).not.toHaveBeenCalled();
    });

    it('no inventa un precio cero cuando el catálogo no incluye el dato', () => {
        setup({ products: [{ ...products[0], price: undefined }] });
        expect(screen.getByText('Precio no disponible')).toBeInTheDocument();
        expect(screen.queryByText(/C\$/)).not.toBeInTheDocument();
    });
});
