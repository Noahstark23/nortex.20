// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PosTicketShell } from '../components/pos/PosTicketShell';

const DESKTOP_QUERY = '(min-width: 1024px)';

interface MediaController {
    setDesktop(matches: boolean): void;
}

const installMedia = (initialDesktop: boolean): MediaController => {
    let desktop = initialDesktop;
    const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();

    vi.stubGlobal('matchMedia', vi.fn((query: string) => {
        const queryListeners = listeners.get(query) ?? new Set();
        listeners.set(query, queryListeners);

        const media = {
            media: query,
            onchange: null,
            get matches() {
                if (query === DESKTOP_QUERY) return desktop;
                return query === '(prefers-reduced-motion: reduce)';
            },
            addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => queryListeners.add(listener),
            removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => queryListeners.delete(listener),
            addListener: (listener: (event: MediaQueryListEvent) => void) => queryListeners.add(listener),
            removeListener: (listener: (event: MediaQueryListEvent) => void) => queryListeners.delete(listener),
            dispatchEvent: () => true,
        };
        return media as unknown as MediaQueryList;
    }));

    return {
        setDesktop(matches) {
            desktop = matches;
            const event = { matches, media: DESKTOP_QUERY } as MediaQueryListEvent;
            act(() => listeners.get(DESKTOP_QUERY)?.forEach(listener => listener(event)));
        },
    };
};

const TicketHarness = ({ initiallyOpen = false }: { initiallyOpen?: boolean }) => {
    const [open, setOpen] = useState(initiallyOpen);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Abrir venta</button>
            <PosTicketShell
                open={open}
                onOpen={() => setOpen(true)}
                onClose={() => setOpen(false)}
                guidedSimpleMode
                labelledBy="ticket-test-title"
            >
                <h2 id="ticket-test-title">Venta actual</h2>
                <button type="button" data-fluid-sheet-initial-focus onClick={() => setOpen(false)}>
                    Cerrar venta
                </button>
                <input aria-label="Nota temporal" defaultValue="conservar" />
                <div data-testid="ticket-content">Contenido unico</div>
            </PosTicketShell>
        </>
    );
};

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('PosTicketShell', () => {
    it('usa FluidSheet en movil, bloquea el fondo y cierra sin ejecutar negocio', () => {
        installMedia(false);
        render(<TicketHarness />);

        const trigger = screen.getByRole('button', { name: 'Abrir venta' });
        trigger.focus();
        fireEvent.click(trigger);

        expect(screen.getByRole('dialog', { name: 'Venta actual' })).toHaveClass('nx-pos-ticket-sheet');
        expect(document.body.style.overflow).toBe('hidden');
        expect(screen.getByRole('button', { name: 'Cerrar venta' })).toHaveFocus();
        expect(screen.getAllByTestId('ticket-content')).toHaveLength(1);

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Venta actual' })).toBeNull();
        expect(document.body.style.overflow).toBe('');
        expect(trigger).toHaveFocus();
    });

    it('mantiene el ticket lateral visible en escritorio sin dialogo ni body lock', () => {
        installMedia(true);
        render(<TicketHarness />);

        const ticket = screen.getByRole('complementary', { name: 'Venta actual' });
        expect(ticket).toHaveAttribute('data-pos-ticket-mode', 'desktop');
        expect(ticket).toHaveClass('nx-ticket-surface');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getAllByTestId('ticket-content')).toHaveLength(1);
        expect(document.body.style.overflow).toBe('');
    });

    it('cambia de hoja a sidebar sin duplicar el contenido ni dejar bloqueado el body', () => {
        const media = installMedia(false);
        render(<TicketHarness initiallyOpen />);

        expect(screen.getByRole('dialog', { name: 'Venta actual' })).toBeTruthy();
        expect(screen.getAllByTestId('ticket-content')).toHaveLength(1);
        expect(document.body.style.overflow).toBe('hidden');

        media.setDesktop(true);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('complementary', { name: 'Venta actual' })).toBeTruthy();
        expect(screen.getAllByTestId('ticket-content')).toHaveLength(1);
        expect(document.body.style.overflow).toBe('');
    });

    it('mantiene visible el ticket y recupera un foco util al pasar de escritorio a movil', () => {
        const media = installMedia(true);
        render(<TicketHarness />);

        const field = screen.getByRole('textbox', { name: 'Nota temporal' });
        field.focus();
        expect(field).toHaveFocus();

        media.setDesktop(false);

        expect(screen.getByRole('dialog', { name: 'Venta actual' })).toBeTruthy();
        expect(screen.getAllByTestId('ticket-content')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Cerrar venta' })).toHaveFocus();
        expect(document.body.style.overflow).toBe('hidden');
    });
});
