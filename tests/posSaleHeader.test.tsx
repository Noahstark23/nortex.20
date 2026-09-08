// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { PosSaleHeader } from '../components/pos/PosSaleHeader';

afterEach(cleanup);

describe('cabecera operativa del POS', () => {
    it.each([
        [true, true], [true, false], [false, true], [false, false],
    ])('conserva un único título de tarea (simple=%s, primera=%s)', (simple, firstSale) => {
        render(<PosSaleHeader simple={simple} firstSale={firstSale} businessName="Ferretería Central" cashierName="Ana">
            <button type="button">Avisos</button>
        </PosSaleHeader>);
        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1, name: firstSale ? 'Primera venta' : 'Nueva venta' })).toBeVisible();
        expect(screen.getByText('Ferretería Central')).toHaveAttribute('title', 'Ferretería Central');
        expect(screen.getByText('Caja: Ana')).toHaveAttribute('title', 'Caja: Ana');
    });

    it('acota un nombre largo sin recortarlo del contenido accesible ni expandir la columna', () => {
        const businessName = 'Ferretería y farmacia del barrio con un nombre muy largo '.repeat(5).trim();
        render(<div style={{ width: 320 }}><PosSaleHeader simple firstSale={false} businessName={businessName}>
            <button type="button">Avisos</button><button type="button">Caja</button>
        </PosSaleHeader></div>);
        const name = screen.getByTitle(businessName);
        expect(name.textContent).toBe(businessName);
        expect(name).toHaveClass('min-w-0', 'truncate');
        expect(name.parentElement).toHaveClass('min-w-0', 'overflow-hidden', 'whitespace-nowrap');
        expect(screen.getByRole('group', { name: 'Acciones de venta' })).toHaveClass('min-w-0', 'overflow-x-auto');
        // jsdom no calcula geometría: el ancho efectivo de 320px se revisa en navegador.
    });

    it('conserva orden, foco y callbacks de las acciones que recibe', async () => {
        const notices = vi.fn();
        const cash = vi.fn();
        render(<PosSaleHeader simple firstSale={false} businessName="" >
            <span role="status">Sin internet</span>
            <button type="button" onClick={notices}>Avisos</button>
            <button type="button" onClick={cash}>Abrir caja</button>
        </PosSaleHeader>);
        const actions = screen.getByRole('group', { name: 'Acciones de venta' });
        expect(within(actions).getByRole('status')).toHaveTextContent('Sin internet');
        expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Avisos', 'Abrir caja']);
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Avisos' })).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(notices).toHaveBeenCalledTimes(1);
        expect(cash).not.toHaveBeenCalled();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Abrir caja' })).toHaveFocus();
        await userEvent.keyboard(' ');
        expect(cash).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/Caja:/)).not.toBeInTheDocument();
    });
});
