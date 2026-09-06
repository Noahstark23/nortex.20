// @vitest-environment jsdom

import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CajaNicaCatalog } from '../components/pos/CajaNicaCatalog';
import { CajaNicaCheckout } from '../components/pos/CajaNicaCheckout';
import type { Product } from '../types';

afterEach(cleanup);

const martillo: Product = {
    id: 'martillo-1',
    name: 'Martillo de uña',
    price: 275,
    costPrice: 180,
    stock: 48,
    sku: 'HER-001',
    category: 'Herramientas',
    unit: 'unidad',
    saleMode: 'COUNTED',
    quantityStep: 1,
};

describe('Spatial Counter en componentes de Caja Nica', () => {
    it('muestra precio y existencia, y confirma solo una cantidad aceptada por el POS', () => {
        const onAdd = vi.fn();
        const props = { products: [martillo], totalProducts: 1, categories: ['Todos', 'Herramientas'],
            selectedCategory: 'Todos', searchTerm: '', blockedProductIds: new Set<string>(),
            onCategoryChange: vi.fn(), onAdd, onBlocked: vi.fn(), onShowMore: vi.fn() };
        const { container, rerender } = render(<CajaNicaCatalog {...props} />);
        expect(screen.getByText('Martillo de uña')).toBeTruthy();
        expect(screen.getByText('C$ 275.00')).toBeTruthy();
        expect(screen.getByText('48 en existencia · unidad')).toBeTruthy();
        expect(container.querySelector('img')).toBeNull();
        const card = screen.getByRole('button', { name: /Agregar Martillo de uña/i });
        fireEvent.click(card);
        expect(onAdd).toHaveBeenCalledOnce();
        expect(card.getAttribute('data-selected')).toBeNull();
        rerender(<CajaNicaCatalog {...props} quantitiesByProduct={new Map([['martillo-1', 1]])} />);
        expect(card.getAttribute('data-selected')).toBe('true');
        expect(card.getAttribute('data-in-cart')).toBe('true');
        expect(screen.getByText('En la venta: 1 unidad')).toBeTruthy();
        expect(card.className).toContain('nx-fluid-press');
    });

    it('mantiene el cobro en un dock oscuro con acción primaria táctil', () => {
        const onOpenCash = vi.fn();
        const { container } = render(
            <CajaNicaCheckout
                total={new Decimal('275')}
                cashReceived=""
                cashOpen={false}
                processing={false}
                onCashReceivedChange={vi.fn()}
                onOpenCash={onOpenCash}
                onCancelCash={vi.fn()}
                onConfirmCash={vi.fn()}
                onOtherPayment={vi.fn()}
            />,
        );

        expect(container.querySelector('.nx-ticket-dock')).toBeTruthy();
        const primary = screen.getByRole('button', { name: /Cobrar C\$ 275\.00 en efectivo/i });
        expect(primary.className).toContain('nx-ticket-primary');
        expect(primary.className).toContain('nx-fluid-press');

        fireEvent.click(primary);
        expect(onOpenCash).toHaveBeenCalledOnce();
    });
});
