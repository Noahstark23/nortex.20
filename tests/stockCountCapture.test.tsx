// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StockCount from '../components/StockCount';
import { MemoryRouter } from 'react-router-dom';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const count = { id: 'count-a', warehouseId: 'warehouse-a', warehouse: { id: 'warehouse-a', name: 'Principal' }, status: 'OPEN', scope: 'ALL', createdAt: '2026-09-12T10:00:00Z', _count: { items: 1 } };
const item = { id: 'item-a', productId: 'product-a', expected: 3, counted: 2, countedAt: null, diff: 0, product: { name: 'Clavo', sku: 'ABC123', unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1' } };
const setup = (onSave: (body: any) => Promise<Response>, countItem = item, failList = false) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/stock-counts') return failList ? response({ error: 'Servicio no disponible' }, 503) : response([count]);
    if (url === '/api/products/categories') return response([]);
    if (url === '/api/warehouses') return response({ data: [{ id: 'warehouse-a', name: 'Principal', isActive: true, isDefault: true }] });
    if (url === '/api/stock-counts/count-a') return response({ count, items: [countItem] });
    if (url.endsWith('/count')) return onSave(JSON.parse(String(init?.body)));
    return response({ error: 'Ruta inesperada' }, 500);
});
const open = async () => {
    render(<MemoryRouter><StockCount /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: /continuar|ver detalle/i }))[0]);
    return (await screen.findAllByLabelText('Conteo físico de Clavo'))[0] as HTMLInputElement;
};
const scan = () => { for (const key of 'ABC123') fireEvent.keyDown(window, { key }); fireEvent.keyDown(window, { key: 'Enter' }); };

describe('captura durable y serial de conteos', () => {
    beforeEach(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' })); });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('retiene la cantidad cuando falla guardar y permite reintentar', async () => {
        const save = vi.fn().mockRejectedValueOnce(new TypeError('sin red')).mockResolvedValue(response({ counted: 5 }));
        setup(save);
        const input = await open();
        fireEvent.change(input, { target: { value: '5' } }); fireEvent.blur(input);
        await screen.findByText('No se guardó el conteo');
        expect(input.value).toBe('5');
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar guardados' }));
        await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Revisar y terminar' }) as HTMLButtonElement).disabled).toBe(false));
    });

    it('no permite cerrar hasta confirmar la última captura y no manda PATCH paralelos', async () => {
        let resolveFirst!: (value: Response) => void;
        const save = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; })).mockResolvedValue(response({ counted: 6 }));
        setup(save);
        const input = await open();
        fireEvent.change(input, { target: { value: '5' } }); fireEvent.blur(input);
        fireEvent.change(input, { target: { value: '6' } }); fireEvent.blur(input);
        expect(save).toHaveBeenCalledTimes(1);
        expect((screen.getByRole('button', { name: 'Revisar y terminar' }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => resolveFirst(response({ counted: 5 })));
        await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
        expect(save.mock.calls[1][0].counted).toBe(6);
        expect(input.value).toBe('6');
    });

    it('suspende el lector mientras se revisa el cierre', async () => {
        const save = vi.fn().mockResolvedValue(response({ counted: 3 })); setup(save);
        await open(); fireEvent.click(screen.getByRole('button', { name: 'Revisar y terminar' }));
        scan(); await act(async () => {});
        expect(save).not.toHaveBeenCalled();
    });

    it('al escanear un medido conserva su fracción y pide capturar cantidad', async () => {
        const save = vi.fn().mockResolvedValue(response({ counted: 3 }));
        setup(save, { ...item, counted: 2.75, product: { ...item.product, unit: 'kg', saleMode: 'MEASURED', quantityStep: '0.01' } });
        const input = await open(); scan(); await act(async () => {});
        expect(input.value).toBe('2.75'); expect(save).not.toHaveBeenCalled();
    });

    it('diferencia fallo del historial de una lista vacía', async () => {
        setup(vi.fn(), item, true); render(<MemoryRouter><StockCount /></MemoryRouter>);
        expect((await screen.findByRole('alert')).textContent).toContain('Servicio no disponible');
        expect(screen.getByRole('button', { name: 'Reintentar carga' })).toBeTruthy();
    });

    it('recupera solo borradores no confirmados después de salir y volver', async () => {
        setup(vi.fn().mockRejectedValue(new TypeError('sin red')));
        const input = await open();
        fireEvent.change(input, { target: { value: '7' } }); fireEvent.blur(input);
        await screen.findByText('No se guardó el conteo');
        cleanup();
        const recovered = await open();
        expect(recovered.value).toBe('7');
        expect((screen.getByRole('button', { name: 'Revisar y terminar' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('guarda un reconteo del mismo valor y actualiza el saldo de comparación', async () => {
        const save = vi.fn().mockResolvedValue(response({ counted: 2, bookStockAtCapture: '1', countedAt: '2026-09-12T11:00:00Z' }));
        setup(save); await open();
        fireEvent.click(screen.getAllByRole('button', { name: 'Guardar reconteo de Clavo' })[0]);
        await waitFor(() => expect(save).toHaveBeenCalledWith({ productId: 'product-a', counted: 2 }));
        await waitFor(() => expect(screen.getAllByText('1 unidad').length).toBeGreaterThan(0));
    });

    it('un código de unidades con paso 6 exige cantidad sin inventar seis unidades físicas', async () => {
        const save = vi.fn(); setup(save, { ...item, product: { ...item.product, quantityStep: '6' } });
        const input = await open(); scan(); await act(async () => {});
        expect(input.value).toBe('2'); expect(save).not.toHaveBeenCalled();
    });
});
