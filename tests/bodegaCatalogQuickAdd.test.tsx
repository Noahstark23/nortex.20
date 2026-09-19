// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import QuickAddProduct from '../components/QuickAddProduct';
vi.mock('../components/ImageUploader', () => ({ default: () => null }));
vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));
beforeEach(() => { localStorage.setItem('nortex_token', 'synthetic'); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
const fill = () => {
    fireEvent.change(screen.getByPlaceholderText('7501234567890'), { target: { value: 'QA-1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del producto *' }), { target: { value: 'Producto QA' } });
    fireEvent.change(screen.getByPlaceholderText('150.00'), { target: { value: '150' } });
};
describe('alta rápida de productos', () => {
    it('conserva lote y empaque de la familia y confirma aunque falle el audio', async () => {
        const onSuccess = vi.fn();
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'qa' }) });
        vi.stubGlobal('fetch', fetcher);
        vi.stubGlobal('AudioContext', class { constructor() { throw new Error('audio unavailable'); } });
        render(<QuickAddProduct onClose={vi.fn()} onSuccess={onSuccess} />);
        fill();
        fireEvent.change(screen.getByRole('textbox', { name: 'Marca (opcional)' }), { target: { value: '  Truper  ' } });
        fireEvent.change(screen.getByLabelText('Plantilla de producto'), { target: { value: 'VETERINARY' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar \(F2/ }));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ requiresBatchTracking: true, unit: 'frasco', brand: 'Truper' });
        expect(screen.queryByText('Error de conexión al servidor')).not.toBeInTheDocument();
    });
    it('F2 repetido y Escape durante envío no duplican ni cierran', async () => {
        const onClose = vi.fn();
        const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
        vi.stubGlobal('fetch', fetcher);
        render(<QuickAddProduct onClose={onClose} onSuccess={vi.fn()} />);
        fill();
        fireEvent.keyDown(window, { key: 'F2' });
        fireEvent.keyDown(window, { key: 'F2' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });
    it('aplica saco de cien y permite costo desconocido', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'qa' }) });
        vi.stubGlobal('fetch', fetcher);
        render(<QuickAddProduct onClose={vi.fn()} onSuccess={vi.fn()} />);
        fill();
        fireEvent.change(screen.getByLabelText('Plantilla de producto'), { target: { value: 'ANIMAL_FEED' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar \(F2/ }));
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ packUnit: 'saco', packSize: '100', cost: '0', saleMode: 'MEASURED' });
    });
    it('el precio con coma y unidad kg conservan fracciones y decimales', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'qa' }) });
        vi.stubGlobal('fetch', fetcher);
        render(<QuickAddProduct onClose={vi.fn()} onSuccess={vi.fn()} />);
        fill();
        fireEvent.change(screen.getByLabelText('Unidad de venta'), { target: { value: 'kg' } });
        fireEvent.change(screen.getByPlaceholderText('150.00'), { target: { value: '125,50' } });
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1,25' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar \(F2/ }));
        await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ price: '125.5', stock: '1.25', unit: 'kg', saleMode: 'MEASURED' });
    });
    it('lote con stock inicial pide registrar la entrada sin mandar una solicitud inválida', () => {
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        render(<QuickAddProduct onClose={vi.fn()} onSuccess={vi.fn()} />);
        fill();
        fireEvent.change(screen.getByLabelText('Plantilla de producto'), { target: { value: 'VETERINARY' } });
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar \(F2/ }));
        expect(fetcher).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('con lote, vencimiento y bodega');
    });
});
