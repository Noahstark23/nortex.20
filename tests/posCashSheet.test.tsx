// @vitest-environment jsdom

import { useState } from 'react';
import Decimal from 'decimal.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PosCashSheet } from '../components/pos/PosCashSheet';
import { validateCashReceived } from '../utils/posCash';

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

const domRect = (top: number, bottom: number): DOMRect => ({
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 320,
    width: 320,
    height: bottom - top,
    toJSON: () => ({}),
});

interface CashSheetHarnessProps {
    processing?: boolean;
    initiallyOpen?: boolean;
    amountDue?: string;
    onClose?: () => void;
    onConfirm?: () => void;
}

const CashSheetHarness = ({
    processing = false,
    initiallyOpen = false,
    amountDue = '85',
    onClose = vi.fn(),
    onConfirm = vi.fn(),
}: CashSheetHarnessProps) => {
    const [open, setOpen] = useState(initiallyOpen);
    const [payingInUSD, setPayingInUSD] = useState(false);
    const [usdAmount, setUsdAmount] = useState('');
    const [cashReceived, setCashReceived] = useState('');
    const exchangeRate = new Decimal('36.56');
    const amountDueDecimal = new Decimal(amountDue);
    const validation = amountDueDecimal.isZero()
        ? {
            ok: true as const,
            received: new Decimal(0),
            total: new Decimal(0),
            change: new Decimal(0),
        }
        : validateCashReceived(cashReceived, amountDueDecimal);

    const close = () => {
        onClose();
        setOpen(false);
    };

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Abrir efectivo</button>
            <PosCashSheet
                open={open}
                processing={processing}
                amountDue={amountDueDecimal}
                storeCreditApplied={new Decimal('0')}
                exchangeRate={exchangeRate}
                payingInUSD={payingInUSD}
                usdAmount={usdAmount}
                cashReceived={cashReceived}
                validation={validation}
                onClose={close}
                onTogglePayingInUSD={() => {
                    setPayingInUSD(current => !current);
                    setUsdAmount('');
                    setCashReceived('');
                }}
                onUsdAmountChange={(value) => {
                    setUsdAmount(value);
                    if (value.trim() === '' || value === '.') {
                        setCashReceived('');
                        return;
                    }
                    try {
                        setCashReceived(new Decimal(value).mul(exchangeRate).toFixed(2));
                    } catch {
                        setCashReceived('');
                    }
                }}
                onCashReceivedChange={setCashReceived}
                onConfirm={onConfirm}
            />
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

describe('PosCashSheet', () => {
    it('abre un diálogo accesible, bloquea el scroll y enfoca primero el monto NIO', () => {
        render(<CashSheetHarness />);

        const trigger = screen.getByRole('button', { name: 'Abrir efectivo' });
        trigger.focus();
        fireEvent.click(trigger);

        const dialog = screen.getByRole('dialog', { name: 'Efectivo' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog.closest('[data-fluid-sheet-root]')).toHaveClass('nx-pos-payment-sheet-root');
        expect(dialog.querySelector('.nx-pos-payment-sheet-content')).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Efectivo recibido en córdobas' })).toHaveFocus();
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: 'Efectivo' })).toBeNull();
        expect(document.body.style.overflow).toBe('');
        expect(trigger).toHaveFocus();
    });

    it('tolera los estados parciales "." y "123." en USD y muestra la conversión Decimal', () => {
        render(<CashSheetHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir efectivo' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar en dólares' }));

        const usdInput = screen.getByRole('textbox', { name: 'Monto recibido en dólares' });
        expect(usdInput).toHaveFocus();

        expect(() => fireEvent.change(usdInput, { target: { value: '.' } })).not.toThrow();
        expect(usdInput).toHaveValue('.');
        expect(screen.queryByText('Equivalente NIO:')).toBeNull();

        expect(() => fireEvent.change(usdInput, { target: { value: '123.' } })).not.toThrow();
        expect(usdInput).toHaveValue('123.');
        expect(screen.getByText('Equivalente NIO:')).toBeTruthy();
        expect(screen.getByText('C$ 4,496.88')).toBeTruthy();
        expect(screen.getByText('C$ 4,411.88')).toBeTruthy();
    });

    it('combina monto exacto, sugerencias y keypad con anuncios accesibles de faltante y vuelto', () => {
        render(<CashSheetHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir efectivo' }));

        const input = screen.getByRole('textbox', { name: 'Efectivo recibido en córdobas' });
        const exact = screen.getByRole('button', { name: 'Monto exacto' });
        fireEvent.click(exact);

        expect(input).toHaveValue('85.00');
        expect(exact).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('status')).toHaveTextContent(/Vuelto\s*C\$ 0\.00/);
        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');

        fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
        fireEvent.click(screen.getByRole('button', { name: '8' }));
        fireEvent.click(screen.getByRole('button', { name: '0' }));

        expect(input).toHaveValue('80');
        expect(screen.getByRole('status')).toHaveTextContent(/Falta\s*C\$ 5\.00/);

        const suggested = screen.getByRole('button', { name: /^C\$ 100$/ });
        fireEvent.click(suggested);

        expect(input).toHaveValue('100.00');
        expect(suggested).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('status')).toHaveTextContent(/Vuelto\s*C\$ 15\.00/);
    });

    it('desplaza faltante y vuelto dentro del sheet sin mover la ventana', () => {
        const windowScrollBefore = window.scrollY;
        const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        render(<CashSheetHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir efectivo' }));

        const dialog = screen.getByRole('dialog', { name: 'Efectivo' });
        const scroller = dialog.querySelector<HTMLElement>('.nx-pos-cash-sheet-scroll')!;
        const feedback = screen.getByRole('status');
        Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true, configurable: true });
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(domRect(80, 400));
        vi.spyOn(feedback, 'getBoundingClientRect').mockReturnValue(domRect(430, 520));

        fireEvent.click(screen.getByRole('button', { name: '8' }));

        expect(feedback).toHaveTextContent(/Falta\s*C\$ 77\.00/);
        expect(scroller.scrollTop).toBeGreaterThan(0);
        const scrollAfterShortfall = scroller.scrollTop;

        fireEvent.click(screen.getByRole('button', { name: '5' }));

        expect(feedback).toHaveTextContent(/Vuelto\s*C\$ 0\.00/);
        expect(scroller.scrollTop).toBeGreaterThan(scrollAfterShortfall);
        expect(window.scrollY).toBe(windowScrollBefore);
        expect(windowScrollTo).not.toHaveBeenCalled();
    });

    it('durante processing deshabilita todos los controles mutables y bloquea Escape y backdrop', () => {
        const onClose = vi.fn();
        render(<CashSheetHarness initiallyOpen processing onClose={onClose} />);

        const dialog = screen.getByRole('dialog', { name: 'Efectivo' });
        expect(dialog.querySelector('.nx-pos-payment-sheet-content')).toHaveAttribute('aria-busy', 'true');

        const mutableControls = Array.from(
            dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input, select, textarea'),
        );
        expect(mutableControls.length).toBeGreaterThan(15);
        for (const control of mutableControls) {
            expect(control, `Control mutable sin bloquear: ${control.outerHTML}`).toBeDisabled();
        }

        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(document.querySelector<HTMLElement>('[data-fluid-sheet-backdrop]')!);

        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Efectivo' })).toBeTruthy();
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('cerrar o cancelar nunca confirma y una confirmación válida llama una sola vez', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn();
        render(<CashSheetHarness onClose={onClose} onConfirm={onConfirm} />);

        const trigger = screen.getByRole('button', { name: 'Abrir efectivo' });
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(onClose).toHaveBeenCalledTimes(2);
        expect(onConfirm).not.toHaveBeenCalled();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Monto exacto' }));
        const confirm = screen.getByRole('button', { name: 'Cobrar C$ 85.00' });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
