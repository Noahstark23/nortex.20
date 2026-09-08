// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import HelpCenter from '../components/HelpCenter';

const LocationProbe = () => {
    const location = useLocation();
    return <output aria-label="ruta actual">{location.pathname}{location.search}</output>;
};

const renderHelpCenter = () => render(
    <MemoryRouter initialEntries={['/app/ayuda']}>
        <HelpCenter />
        <LocationProbe />
    </MemoryRouter>,
);

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Centro de Ayuda', () => {
    it('mantiene jerarquía, objetivos táctiles y semántica de botones', () => {
        renderHelpCenter();

        expect(screen.getByRole('heading', { level: 1, name: 'Ayuda y Tutoriales' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Tutoriales interactivos' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Guías rápidas' })).toBeInTheDocument();
        expect(screen.getAllByRole('article')).toHaveLength(7);

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(5);
        for (const button of buttons) {
            expect(button).toHaveAttribute('type', 'button');
            expect(button).toHaveClass('nx-fluid-press');
            expect(button).toHaveClass('min-h-tap');
        }
    });

    it('abre cada tutorial en el destino local exacto', () => {
        renderHelpCenter();

        const tutorials = [
            ['Cómo hacer una venta', '/app/pos?tour=pos'],
            ['Cómo cargar inventario', '/app/inventory?tour=inv'],
            ['Cómo cobrar el fiado', '/app/receivables?tour=fiado'],
            ['Cómo registrar compras', '/app/purchases?tour=compras'],
        ] as const;

        for (const [name, destination] of tutorials) {
            fireEvent.click(screen.getByRole('button', { name: new RegExp(name, 'i') }));
            expect(screen.getByLabelText('ruta actual')).toHaveTextContent(destination);
        }
    });
});
