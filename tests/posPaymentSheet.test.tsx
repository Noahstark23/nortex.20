// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PosPaymentSheet } from '../components/pos/PosPaymentSheet';
import { PosTicketShell } from '../components/pos/PosTicketShell';

const DESKTOP_QUERY = '(min-width: 1024px)';

class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
    }
}

const installReducedMotion = () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
    })));
};

const installResponsiveMedia = (initialDesktop: boolean) => {
    let desktop = initialDesktop;
    const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();

    vi.stubGlobal('matchMedia', vi.fn((query: string) => {
        const queryListeners = listeners.get(query) ?? new Set();
        listeners.set(query, queryListeners);

        return {
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
        } as MediaQueryList;
    }));

    return {
        setDesktop(matches: boolean) {
            desktop = matches;
            const event = { matches, media: DESKTOP_QUERY } as MediaQueryListEvent;
            act(() => listeners.get(DESKTOP_QUERY)?.forEach(listener => listener(event)));
        },
    };
};

const PaymentChildren = () => (
    <>
        <h2 id="payment-sheet-title">Elegí un método de pago</h2>
        <button type="button" data-fluid-sheet-initial-focus>Efectivo</button>
        <div data-testid="payment-children">Opciones de pago</div>
    </>
);

const PaymentHarness = () => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Cobrar</button>
            <PosPaymentSheet
                open={open}
                onClose={() => setOpen(false)}
                labelledBy="payment-sheet-title"
                busy={false}
            >
                <PaymentChildren />
            </PosPaymentSheet>
        </>
    );
};

const ResponsiveCompositionHarness = () => {
    const [showMobileCart, setShowMobileCart] = useState(true);
    const [showPaymentOptions, setShowPaymentOptions] = useState(false);

    return (
        <>
            <PosTicketShell
                open={showMobileCart && !showPaymentOptions}
                onOpen={() => setShowMobileCart(true)}
                onClose={() => setShowMobileCart(false)}
                guidedSimpleMode
                labelledBy="ticket-composition-title"
            >
                <h2 id="ticket-composition-title">Venta actual</h2>
                <button type="button" onClick={() => setShowPaymentOptions(true)}>
                    Elegir otro medio
                </button>
                <div data-testid="ticket-children">Detalle del ticket</div>
            </PosTicketShell>
            <PosPaymentSheet
                open={showPaymentOptions}
                onClose={() => setShowPaymentOptions(false)}
                labelledBy="payment-sheet-title"
                busy={false}
            >
                <PaymentChildren />
            </PosPaymentSheet>
        </>
    );
};

beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    installReducedMotion();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('PosPaymentSheet', () => {
    it('presenta un único árbol accesible con la carcasa visual del POS', () => {
        render(
            <PosPaymentSheet
                open
                onClose={vi.fn()}
                labelledBy="payment-sheet-title"
                busy={false}
            >
                <PaymentChildren />
            </PosPaymentSheet>,
        );

        const dialog = screen.getByRole('dialog', { name: 'Elegí un método de pago' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('nx-pos-payment-sheet');
        expect(dialog.closest('[data-fluid-sheet-root]')).toHaveClass('nx-pos-payment-sheet-root');
        expect(dialog.querySelector('.nx-pos-payment-sheet-content')).not.toHaveAttribute('aria-busy');
        expect(screen.getAllByTestId('payment-children')).toHaveLength(1);
    });

    it('bloquea el fondo, enfoca la acción inicial y Escape cierra restaurando el foco', () => {
        render(<PaymentHarness />);
        const trigger = screen.getByRole('button', { name: 'Cobrar' });
        trigger.focus();
        fireEvent.click(trigger);

        expect(screen.getByRole('dialog', { name: 'Elegí un método de pago' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Efectivo' })).toHaveFocus();
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: 'Elegí un método de pago' })).toBeNull();
        expect(document.body.style.overflow).toBe('');
        expect(trigger).toHaveFocus();
    });

    it('el backdrop cierra cuando el selector está libre', () => {
        render(<PaymentHarness />);
        const trigger = screen.getByRole('button', { name: 'Cobrar' });
        trigger.focus();
        fireEvent.click(trigger);

        fireEvent.click(document.querySelector<HTMLElement>('[data-fluid-sheet-backdrop]')!);

        expect(screen.queryByRole('dialog', { name: 'Elegí un método de pago' })).toBeNull();
        expect(document.body.style.overflow).toBe('');
        expect(trigger).toHaveFocus();
    });

    it('marca el procesamiento y bloquea Escape, backdrop y drag mientras está ocupado', () => {
        const onClose = vi.fn();
        render(
            <PosPaymentSheet
                open
                onClose={onClose}
                labelledBy="payment-sheet-title"
                busy
            >
                <PaymentChildren />
            </PosPaymentSheet>,
        );

        const dialog = screen.getByRole('dialog', { name: 'Elegí un método de pago' });
        const busyRegion = dialog.querySelector<HTMLElement>('.nx-pos-payment-sheet-content')!;
        const backdrop = document.querySelector<HTMLElement>('[data-fluid-sheet-backdrop]')!;
        const handle = dialog.querySelector<HTMLElement>('[data-fluid-sheet-handle]')!;
        const transformBeforeDrag = dialog.style.transform;

        expect(busyRegion).toHaveAttribute('aria-busy', 'true');

        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(backdrop);
        fireEvent.pointerDown(handle, {
            pointerId: 9,
            pointerType: 'touch',
            clientX: 120,
            clientY: 80,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 9,
            pointerType: 'touch',
            clientX: 120,
            clientY: 700,
        });
        fireEvent.pointerUp(handle, {
            pointerId: 9,
            pointerType: 'touch',
            clientX: 120,
            clientY: 700,
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(dialog.style.transform).toBe(transformBeforeDrag);
        expect(screen.getByRole('dialog', { name: 'Elegí un método de pago' })).toBeTruthy();
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('suspende el ticket al cruzar de escritorio a móvil con el selector abierto', () => {
        const media = installResponsiveMedia(true);
        render(<ResponsiveCompositionHarness />);

        expect(screen.getByRole('complementary', { name: 'Venta actual' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Elegir otro medio' }));

        expect(screen.getByRole('dialog', { name: 'Elegí un método de pago' })).toBeTruthy();
        media.setDesktop(false);

        const dialogs = screen.getAllByRole('dialog');
        expect(dialogs).toHaveLength(1);
        expect(dialogs[0]).toHaveAccessibleName('Elegí un método de pago');
        expect(screen.queryByRole('dialog', { name: 'Venta actual' })).toBeNull();
        expect(screen.queryByTestId('ticket-children')).toBeNull();
        expect(screen.getAllByTestId('payment-children')).toHaveLength(1);
    });
});
