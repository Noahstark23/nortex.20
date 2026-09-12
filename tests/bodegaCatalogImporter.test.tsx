// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import * as XLSX from 'xlsx';
import ProductImporter from '../components/ProductImporter';
import { parseWorkbookRows } from '../utils/importProducts';
vi.mock('xlsx', async importOriginal => ({ ...await importOriginal<typeof import('xlsx')>(), writeFile: vi.fn() }));
beforeEach(() => { localStorage.setItem('nortex_token', 'synthetic'); vi.clearAllMocks(); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
async function upload(rows: Record<string, unknown>[]) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Productos');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File([bytes], 'productos.xlsx')] } });
    return screen.findByRole('button', { name: /Importar \d+/ });
}
describe('importador real: plantilla, transporte y resultado', () => {
    it('su plantilla descargada se vuelve a leer sin perder lotes ni empaques', async () => {
        render(<ProductImporter onClose={vi.fn()} onSuccess={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Descargar Plantilla Excel' }));
        await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
        const book = vi.mocked(XLSX.writeFile).mock.calls[0][0];
        const parsed = parseWorkbookRows(XLSX.utils.sheet_to_json(book.Sheets.Productos, { defval: '' }));
        expect(parsed.rows).toHaveLength(5);
        expect(parsed.rows.every(row => row.valid)).toBe(true);
        expect(parsed.rows.find(row => row.data.sku === 'RESKG')?.data).toMatchObject({ modoVenta: 'MEASURED', requiereLote: true });
        expect(parsed.rows.find(row => row.data.sku === 'COCA600')?.data).toMatchObject({ unidadEmpaque: 'caja', tamanoEmpaque: 24 });
    });
    it('envía cambios presentes y descarga rechazados con sus celdas corregibles', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ created: 1, updated: 0, errors: [] }) });
        vi.stubGlobal('fetch', fetcher);
        const onSuccess = vi.fn();
        render(<ProductImporter onClose={vi.fn()} onSuccess={onSuccess} />);
        const button = await upload([{ SKU: 'A', Producto: 'A', Precio: 10, Stock: 20 }, { SKU: 'B', Producto: 'B', Precio: 'corregir', Stock: 30 }]);
        fireEvent.click(button);
        await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
        expect(fetcher).toHaveBeenCalledOnce();
        expect(fetcher.mock.calls[0][0]).toBe('/api/products/bulk');
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ products: [{ sku: 'A', name: 'A', price: '10', excelRow: 2 }] });
        fireEvent.click(screen.getByRole('button', { name: 'Descargar los 1 que fallaron' }));
        await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
        const book = vi.mocked(XLSX.writeFile).mock.calls[0][0];
        expect(XLSX.utils.sheet_to_json(book.Sheets.Rechazados)[0]).toMatchObject({ SKU: 'B', Producto: 'B', Precio: 'corregir', Stock: 30, fila_excel: 3 });
    });
    it('elige Reserva para stock inicial y bloquea selección y cierre durante envío', async () => {
        const fetcher = vi.fn((url: string) => url === '/api/warehouses'
            ? Promise.resolve({ ok: true, json: async () => ({ data: [
                { id: 'main', name: 'Principal', isActive: true, isDefault: true },
                { id: 'reserve', name: 'Reserva', isActive: true, isDefault: false },
                { id: 'old', name: 'Cerrada', isActive: false, isDefault: false },
            ] }) }) : new Promise(() => {}));
        vi.stubGlobal('fetch', fetcher);
        const onClose = vi.fn();
        render(<ProductImporter onClose={onClose} onSuccess={vi.fn()} />);
        const button = await upload([{ SKU: 'A', Producto: 'A', Precio: 10, Stock: 20 }]);
        fireEvent.change(screen.getByLabelText('Qué querés importar'), { target: { value: 'initial' } });
        expect(button).toBeDisabled();
        await screen.findByRole('option', { name: 'Reserva' });
        const warehouse = screen.getByLabelText('Bodega de las existencias iniciales');
        expect(warehouse).toHaveValue('');
        expect(screen.queryByRole('option', { name: 'Cerrada' })).not.toBeInTheDocument();
        fireEvent.change(warehouse, { target: { value: 'reserve' } });
        fireEvent.click(button);
        const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/products/bulk')![1];
        expect(JSON.parse(request!.body as string)).toMatchObject({ warehouseId: 'reserve', products: [{ sku: 'A', stock: '20' }] });
        expect(warehouse).toBeDisabled();
        expect(screen.getByLabelText('Qué querés importar')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cargar otro archivo' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar importador' }));
        expect(onClose).not.toHaveBeenCalled();
    });
    it('una respuesta perdida queda sin confirmar y se puede descargar para verificar', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Conexión interrumpida')));
        render(<ProductImporter onClose={vi.fn()} onSuccess={vi.fn()} />);
        fireEvent.click(await upload([{ SKU: 'A', Producto: 'A', Precio: 10 }]));
        const download = await screen.findByRole('button', { name: 'Descargar filas sin confirmar' });
        expect(screen.getByText('1 filas sin confirmar')).toBeInTheDocument();
        expect(screen.queryByText('rechazados')).not.toBeInTheDocument();
        fireEvent.click(download);
        await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
        const book = vi.mocked(XLSX.writeFile).mock.calls[0][0];
        expect(XLSX.utils.sheet_to_json(book.Sheets['Por verificar'])[0]).toMatchObject({ SKU: 'A', estado: 'SIN CONFIRMAR: verificar en catálogo antes de reenviar' });
    });
    it('un stock que se conserva no bloquea actualizar catálogo pero sí una carga inicial', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
        render(<ProductImporter onClose={vi.fn()} onSuccess={vi.fn()} />);
        const button = await upload([{ SKU: 'A', Producto: 'A', Precio: 10, Stock: 'desconocido' }]);
        expect(button).toBeEnabled();
        fireEvent.change(screen.getByLabelText('Qué querés importar'), { target: { value: 'initial' } });
        expect(screen.getByRole('button', { name: 'Importar 0' })).toBeDisabled();
        expect(screen.getAllByText(/Existencia ilegible/).length).toBeGreaterThan(0);
    });
    it('fallo de carga impide POST, permite reintentar y conserva archivo y resumen', async () => {
        let loads = 0;
        const fetcher = vi.fn(async (url: string) => {
            if (url === '/api/warehouses') {
                if (++loads === 1) return { ok: false, json: async () => ({ error: 'No se pudieron consultar las bodegas.' }) };
                return { ok: true, json: async () => ({ data: [{ id: 'reserve', name: 'Reserva', isActive: true }] }) };
            }
            return { ok: true, json: async () => ({ created: 1, updated: 0, errors: [] }) };
        });
        vi.stubGlobal('fetch', fetcher);
        const onSuccess = vi.fn();
        render(<ProductImporter onClose={vi.fn()} onSuccess={onSuccess} />);
        const button = await upload([{ SKU: 'A', Producto: 'A', Precio: 10, Stock: 20 }, { SKU: 'B', Producto: 'B', Precio: 'corregir', Stock: 30 }]);
        fireEvent.change(screen.getByLabelText('Qué querés importar'), { target: { value: 'initial' } });
        expect(await screen.findByText('No se pudieron consultar las bodegas.')).toBeInTheDocument();
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(fetcher.mock.calls.every(([url]) => url === '/api/warehouses')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar carga de bodegas' }));
        await waitFor(() => expect(screen.getByLabelText('Bodega de las existencias iniciales')).toHaveValue('reserve'));
        fireEvent.click(button);
        await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
        expect(screen.getByRole('button', { name: 'Descargar los 1 que fallaron' })).toBeInTheDocument();
        expect(loads).toBe(2);
        expect(JSON.parse(vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/products/bulk')![1]!.body as string).warehouseId).toBe('reserve');
    });
    it('sin bodegas activas impide existencias iniciales pero deja actualizar el catálogo', async () => {
        const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/warehouses' ? { data: [] } : { created: 1, updated: 0, errors: [] } }));
        vi.stubGlobal('fetch', fetcher);
        const onSuccess = vi.fn();
        render(<ProductImporter onClose={vi.fn()} onSuccess={onSuccess} />);
        const button = await upload([{ SKU: 'A', Producto: 'A', Precio: 10, Stock: 20 }]);
        fireEvent.change(screen.getByLabelText('Qué querés importar'), { target: { value: 'initial' } });
        expect(await screen.findByText(/No hay bodegas activas/)).toBeInTheDocument();
        expect(button).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Qué querés importar'), { target: { value: 'catalog' } });
        expect(screen.queryByLabelText('Bodega de las existencias iniciales')).not.toBeInTheDocument();
        fireEvent.click(button);
        await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
        expect(JSON.parse(vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/products/bulk')![1]!.body as string)).toEqual({ products: [{ sku: 'A', name: 'A', price: '10', excelRow: 2 }] });
    });
});
