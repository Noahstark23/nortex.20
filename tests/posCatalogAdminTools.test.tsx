// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import POSCatalogAdminTools from '../components/pos/POSCatalogAdminTools';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const makeProps = (overrides: Partial<React.ComponentProps<typeof POSCatalogAdminTools>> = {}) => ({
    guidedSimpleMode: false,
    headers: { Authorization: 'Bearer qa' },
    showAddModal: false,
    showImportModal: false,
    onOpenAddModal: vi.fn(),
    onCloseAddModal: vi.fn(),
    onOpenImportModal: vi.fn(),
    onCloseImportModal: vi.fn(),
    onProductCreated: vi.fn(),
    onProductsReload: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
});

describe('POSCatalogAdminTools', () => {
    it('crea el producto completo y devuelve el snapshot normalizado al POS', async () => {
        const onProductCreated = vi.fn();
        const onCloseAddModal = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                id: 'prod-1',
                name: 'Taladro Percutor 500W',
                sku: 'SKU-001',
                category: 'Herramientas',
                price: 199.5,
                cost: 120,
                stock: 8,
                imageUrl: ' https://cdn.example.com/products/taladro.webp ',
                unit: 'unidad',
                saleMode: 'COUNTED',
                quantityStep: 1,
            }),
        })));

        render(
            <POSCatalogAdminTools
                {...makeProps({
                    showAddModal: true,
                    onProductCreated,
                    onCloseAddModal,
                })}
            />,
        );

        const moneyInputs = screen.getAllByPlaceholderText('0.00');
        fireEvent.change(screen.getByPlaceholderText('Ej. Taladro Percutor 500W'), { target: { value: 'Taladro Percutor 500W' } });
        fireEvent.change(screen.getByPlaceholderText('Escaneá o escribí'), { target: { value: 'sku-001' } });
        fireEvent.change(moneyInputs[0], { target: { value: '199.50' } });
        fireEvent.change(moneyInputs[1], { target: { value: '120.00' } });
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '8' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar en Inventario/i }));

        await waitFor(() => expect(onProductCreated).toHaveBeenCalledTimes(1));
        expect(onProductCreated).toHaveBeenCalledWith(expect.objectContaining({
            id: 'prod-1',
            name: 'Taladro Percutor 500W',
            sku: 'SKU-001',
            category: 'Herramientas',
            price: 199.5,
            costPrice: 120,
            stock: 8,
            imageUrl: 'https://cdn.example.com/products/taladro.webp',
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: 1,
        }));
        expect(onCloseAddModal).toHaveBeenCalledTimes(1);
    });

    it('muestra toast de error si el backend rechaza el producto y conserva el modal abierto', async () => {
        const onProductCreated = vi.fn();
        const onCloseAddModal = vi.fn();
        const showToast = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'SKU duplicado' }),
        })));

        render(
            <POSCatalogAdminTools
                {...makeProps({
                    showAddModal: true,
                    onProductCreated,
                    onCloseAddModal,
                    showToast,
                })}
            />,
        );

        const moneyInputs = screen.getAllByPlaceholderText('0.00');
        fireEvent.change(screen.getByPlaceholderText('Ej. Taladro Percutor 500W'), { target: { value: 'Taladro Percutor 500W' } });
        fireEvent.change(moneyInputs[0], { target: { value: '199.50' } });
        fireEvent.change(moneyInputs[1], { target: { value: '120.00' } });
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '8' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar en Inventario/i }));

        await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
            tone: 'error',
            title: 'No se pudo guardar el producto',
            message: 'Error: SKU duplicado',
        }));
        expect(onProductCreated).not.toHaveBeenCalled();
        expect(onCloseAddModal).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Guardar en Inventario/i })).toBeTruthy();
    });
});
