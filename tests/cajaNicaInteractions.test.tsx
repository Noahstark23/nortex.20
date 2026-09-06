// @vitest-environment jsdom

import { useState } from 'react';
import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CajaNicaCatalog } from '../components/pos/CajaNicaCatalog';
import { CajaNicaCheckout } from '../components/pos/CajaNicaCheckout';
import type { Product } from '../types';

afterEach(cleanup);

const product = (id: string, name: string, stock = 10, imageUrl?: string): Product => ({
    id,
    name,
    imageUrl,
    stock,
    price: 85,
    costPrice: 50,
    sku: `SKU-${id}`,
    category: 'General',
    unit: 'unidad',
    saleMode: 'COUNTED',
    quantityStep: 1,
});

const CheckoutHarness = ({
    disabled = false,
    onConfirm = vi.fn(),
}: {
    disabled?: boolean;
    onConfirm?: () => void;
}) => {
    const [open, setOpen] = useState(false);
    const [received, setReceived] = useState('');
    return (
        <CajaNicaCheckout
            total={new Decimal('85')}
            cashReceived={received}
            cashOpen={open}
            processing={false}
            disabled={disabled}
            onCashReceivedChange={setReceived}
            onOpenCash={() => setOpen(true)}
            onCancelCash={() => setOpen(false)}
            onConfirmCash={onConfirm}
            onOtherPayment={vi.fn()}
        />
    );
};

describe('CajaNicaCheckout en interacción real', () => {
    it('explica el faltante, habilita monto exacto y confirma con Enter', () => {
        const confirm = vi.fn();
        render(<CheckoutHarness onConfirm={confirm} />);

        fireEvent.click(screen.getByRole('button', { name: /Cobrar C\$ 85\.00 en efectivo/i }));
        const input = screen.getByRole('textbox', { name: /Efectivo recibido en córdobas/i });
        expect(document.activeElement).toBe(input);

        fireEvent.change(input, { target: { value: '50' } });
        expect(screen.getByText('Falta C$ 35.00')).toBeTruthy();
        expect((screen.getByRole('button', { name: /Registrar efectivo/i }) as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Monto exacto' }));
        expect(screen.getByText('C$ 0.00')).toBeTruthy();
        expect((screen.getByRole('button', { name: /Registrar efectivo/i }) as HTMLButtonElement).disabled).toBe(false);

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('no deja operar un cobro expandido si la caja queda bloqueada', () => {
        const confirm = vi.fn();
        const { rerender } = render(
            <CajaNicaCheckout
                total={new Decimal('85')}
                cashReceived="100"
                cashOpen
                processing={false}
                disabled={false}
                onCashReceivedChange={vi.fn()}
                onOpenCash={vi.fn()}
                onCancelCash={vi.fn()}
                onConfirmCash={confirm}
                onOtherPayment={vi.fn()}
            />,
        );

        rerender(
            <CajaNicaCheckout
                total={new Decimal('85')}
                cashReceived="100"
                cashOpen
                processing={false}
                disabled
                onCashReceivedChange={vi.fn()}
                onOpenCash={vi.fn()}
                onCancelCash={vi.fn()}
                onConfirmCash={confirm}
                onOtherPayment={vi.fn()}
            />,
        );

        expect((screen.getByRole('textbox', { name: /Efectivo recibido/i }) as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: /Registrar efectivo/i }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Monto exacto' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Otro pago' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.keyDown(screen.getByRole('textbox', { name: /Efectivo recibido/i }), { key: 'Enter' });
        expect(confirm).not.toHaveBeenCalled();
    });
});

describe('CajaNicaCatalog en interacción real', () => {
    it('declara el recorte, permite pedir más y no vende un agotado', () => {
        const onAdd = vi.fn();
        const onBlocked = vi.fn();
        const onShowMore = vi.fn();
        render(
            <CajaNicaCatalog
                products={[product('1', 'Arroz'), product('2', 'Aceite', 0)]}
                totalProducts={5}
                categories={['Todos', 'General']}
                selectedCategory="Todos"
                searchTerm=""
                blockedProductIds={new Set(['2'])}
                onCategoryChange={vi.fn()}
                onAdd={onAdd}
                onBlocked={onBlocked}
                onShowMore={onShowMore}
            />,
        );

        expect(screen.getByText('2 de 5')).toBeTruthy();
        expect(screen.getByText('Quedan 3 por mostrar')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar más productos' }));
        expect(onShowMore).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: /Agregar Arroz/i }));
        fireEvent.click(screen.getByRole('button', { name: /Aceite, agotado/i }));
        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
        expect(onBlocked).toHaveBeenCalledTimes(1);
        expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
    });

    it('prioriza las primeras fotos y conserva el producto legible si una foto se rompe', () => {
        render(
            <CajaNicaCatalog
                products={[
                    product(
                        '1',
                        'Arroz integral',
                        10,
                        'https://res.cloudinary.com/dex1vy92h/image/upload/v1/arroz.jpg',
                    ),
                ]}
                totalProducts={1}
                categories={['Todos']}
                selectedCategory="Todos"
                searchTerm=""
                blockedProductIds={new Set()}
                onCategoryChange={vi.fn()}
                onAdd={vi.fn()}
                onBlocked={vi.fn()}
                onShowMore={vi.fn()}
            />,
        );

        const card = screen.getByRole('button', { name: /Agregar Arroz integral/ });
        const image = card.querySelector('img')!;
        expect(image).toBeTruthy();
        expect(image.getAttribute('loading')).toBe('eager');
        expect(image.getAttribute('fetchpriority')).toBe('high');
        expect(image.getAttribute('srcset')).toContain('w_160');

        fireEvent.error(image);
        expect(card.querySelector('img')).toBeNull();
        expect(screen.getByText('Arroz integral')).toBeTruthy();
        expect(card.getAttribute('aria-label')).toContain('C$ 85.00');
    });
});
