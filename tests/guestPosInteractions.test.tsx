// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuestPOS from '../components/GuestPOS';

const renderDemo = () => render(
    <MemoryRouter initialEntries={['/demo?source=direct']}>
        <GuestPOS />
    </MemoryRouter>,
);

beforeEach(() => {
    localStorage.clear();
});

afterEach(cleanup);

describe('demo POS como flujo ejecutable', () => {
    it('el atajo respeta un único resultado visible y limpia la búsqueda', () => {
        renderDemo();
        const search = screen.getByRole('searchbox', { name: 'Buscar un producto' }) as HTMLInputElement;

        fireEvent.change(search, { target: { value: 'fer-003' } });
        expect(screen.getByText('Codo PVC 1/2"')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar venta de prueba' }));

        expect(search.value).toBe('');
        expect(screen.getByText('C$ 18.00 c/u')).toBeTruthy();
        expect(screen.queryByText('C$ 275.00 c/u')).toBeNull();
    });

    it('mueve el foco al método de pago y confirma efectivo válido con Enter', async () => {
        renderDemo();
        fireEvent.click(screen.getByRole('button', { name: /Agregar Cemento Holcim a la venta/i }));
        expect(screen.getByRole('button', { name: /Ver y cobrar 1 producto/i })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /^Cobrar$/ }));
        const cashMethod = screen.getByRole('button', { name: /^Efectivo$/ });
        await waitFor(() => expect(document.activeElement).toBe(cashMethod));
        expect(screen.queryByRole('button', { name: /Ver y cobrar/i })).toBeNull();

        fireEvent.click(cashMethod);
        const received = screen.getByRole('textbox', { name: /Efectivo recibido en la práctica/i });
        expect(document.activeElement).toBe(received);
        fireEvent.change(received, { target: { value: '300' } });
        fireEvent.keyDown(received, { key: 'Enter' });

        expect(screen.getByText('Cobro completado')).toBeTruthy();
        expect(screen.getByText(/Vuelto C\$ 25\.00/)).toBeTruthy();
        const continueCta = screen.getByRole('link', { name: /Crear mi negocio gratis/i });
        await waitFor(() => expect(document.activeElement).toBe(continueCta));
    });

    it('no anuncia vuelto cero cuando el efectivo es exacto', () => {
        renderDemo();
        fireEvent.click(screen.getByRole('button', { name: /Agregar Codo PVC/i }));
        fireEvent.click(screen.getByRole('button', { name: /^Cobrar$/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Efectivo$/ }));

        const received = screen.getByRole('textbox', { name: /Efectivo recibido en la práctica/i });
        fireEvent.change(received, { target: { value: '18' } });
        fireEvent.keyDown(received, { key: 'Enter' });

        expect(screen.getByText('Cobro completado')).toBeTruthy();
        expect(screen.queryByText(/Vuelto/)).toBeNull();
    });

    it('explica cuánto falta antes de habilitar el cobro', () => {
        renderDemo();
        fireEvent.click(screen.getByRole('button', { name: /Agregar Codo PVC/i }));
        fireEvent.click(screen.getByRole('button', { name: /^Cobrar$/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Efectivo$/ }));

        const received = screen.getByRole('textbox', { name: /Efectivo recibido en la práctica/i });
        fireEvent.change(received, { target: { value: '10' } });

        expect(screen.getByText('Falta C$ 8.00')).toBeTruthy();
        expect((screen.getByRole('button', { name: /Confirmar cobro/i }) as HTMLButtonElement).disabled).toBe(true);
    });
});
