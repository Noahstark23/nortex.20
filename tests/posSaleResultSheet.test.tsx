// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PosSaleResultSheet } from '../components/pos/PosSaleResultSheet';

beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)', media: query,
        onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
    })));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const date = '4/9/2026, 10:45';

describe('resultado de una venta', () => {
    it.each([true, false])('una venta pendiente no se anuncia confirmada (primera=%s)', firstSale => {
        render(<PosSaleResultSheet pending firstSale={firstSale} date={date} onNewSale={vi.fn()}>
            <p>Resumen recibido del POS</p>
        </PosSaleResultSheet>);
        expect(screen.getByRole('dialog', { name: 'Venta guardada para confirmar' })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByText(/guardó en este dispositivo/)).toHaveTextContent('No la registres de nuevo.');
        expect(screen.queryByText(/quedó registrada|Venta lista|quedaron actualizados/)).not.toBeInTheDocument();
        expect(screen.getByText(date)).toBeVisible();
        expect(screen.getByText('Resumen recibido del POS').parentElement).toHaveClass('min-h-0', 'overflow-y-auto');
    });

    it.each([true, false])('una confirmación conserva su título y las acciones recibidas (primera=%s)', firstSale => {
        const print = vi.fn();
        const newSale = vi.fn();
        render(<PosSaleResultSheet pending={false} firstSale={firstSale} date={date} onNewSale={newSale}>
            <button type="button" onClick={print}>Imprimir comprobante</button>
        </PosSaleResultSheet>);
        const heading = screen.getByRole('heading', { name: firstSale ? 'Tu primera venta quedó registrada' : 'Venta lista' });
        expect(heading).toHaveFocus();
        expect(screen.getByRole('dialog')).toHaveClass('nx-ticket-surface', 'nx-dark-context', 'nx-pos-payment-sheet');
        fireEvent.click(screen.getByRole('button', { name: 'Imprimir comprobante' }));
        expect(print).toHaveBeenCalledTimes(1);
        expect(newSale).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Hacer otra venta' }));
        expect(newSale).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/guardada para confirmar/)).not.toBeInTheDocument();
    });

    it.each(['Escape', 'backdrop'])('cerrar mediante %s continúa y restaura el foco sin guardar otra venta', close => {
        const newSale = vi.fn();
        const Harness = () => {
            const [open, setOpen] = useState(false);
            return <>
                <button type="button" onClick={() => setOpen(true)}>Ver resultado</button>
                {open && <PosSaleResultSheet pending={false} firstSale={false} date={date} onNewSale={() => { newSale(); setOpen(false); }}>
                    <p>Resumen</p>
                </PosSaleResultSheet>}
            </>;
        };
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Ver resultado' });
        trigger.focus();
        fireEvent.click(trigger);
        expect(document.body.style.overflow).toBe('hidden');
        if (close === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
        else fireEvent.click(document.querySelector('[data-fluid-sheet-backdrop]')!);
        expect(newSale).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.body.style.overflow).toBe('');
        expect(trigger).toHaveFocus();
    });
});
