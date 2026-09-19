// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import FluidSheet from '../components/ui/FluidSheet';

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

interface FrameClock {
    step(milliseconds?: number): void;
    flush(limit?: number): void;
    pending(): number;
}

const installFrameClock = (): FrameClock => {
    let time = 0;
    let nextId = 1;
    const frames = new Map<number, FrameRequestCallback>();

    vi.spyOn(performance, 'now').mockImplementation(() => time);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        const id = nextId;
        nextId += 1;
        frames.set(id, callback);
        return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    const clock: FrameClock = {
        step(milliseconds = 1000 / 120) {
            time += milliseconds;
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((callback) => callback(time));
        },
        flush(limit = 1_000) {
            let steps = 0;
            while (frames.size > 0 && steps < limit) {
                clock.step();
                steps += 1;
            }
            if (frames.size > 0) throw new Error('Quedaron cuadros de FluidSheet pendientes');
        },
        pending: () => frames.size,
    };
    return clock;
};

const installMotionPreference = (matches = false) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
    })));
};

const prepareHandle = (handle: HTMLElement) => {
    const captured = new Set<number>();
    handle.setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
    handle.hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
    handle.releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId));
};

const readOffset = (panel: HTMLElement): number => {
    const match = panel.style.transform.match(/translate3d\(0,\s*(-?[\d.]+)px/);
    if (!match) throw new Error(`Transform inesperado: ${panel.style.transform}`);
    return Number(match[1]);
};

const SheetHarness = ({ reducedMotion = false }: { reducedMotion?: boolean }) => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Abrir menú</button>
            <FluidSheet
                open={open}
                onClose={() => setOpen(false)}
                labelledBy="test-sheet-title"
                size="full"
                reducedMotion={reducedMotion}
            >
                <h2 id="test-sheet-title">Menú</h2>
                <button type="button" data-fluid-sheet-initial-focus>Cerrar</button>
                <a href="#destino">Destino</a>
            </FluidSheet>
        </>
    );
};

beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    installMotionPreference(false);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('FluidSheet', () => {
    it('abre desde abajo, bloquea el scroll y cierra con Escape restaurando el foco', () => {
        const clock = installFrameClock();
        render(<SheetHarness />);
        const trigger = screen.getByRole('button', { name: 'Abrir menú' });
        trigger.focus();
        fireEvent.click(trigger);

        const dialog = screen.getByRole('dialog', { name: 'Menú' });
        const panel = dialog as HTMLDivElement;
        expect(readOffset(panel)).toBe(800);
        expect(document.body.style.overflow).toBe('hidden');

        act(() => clock.flush());
        expect(readOffset(panel)).toBe(0);
        expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(dialog.closest('[data-fluid-sheet-root]')).toHaveAttribute('aria-hidden', 'true');
        act(() => clock.flush());

        expect(screen.queryByRole('dialog', { name: 'Menú' })).toBeNull();
        expect(document.body.style.overflow).toBe('');
        expect(trigger).toHaveFocus();
    });

    it('conserva el foco dentro de la hoja cuando cambia el bloqueo de Escape', () => {
        const clock = installFrameClock();
        const onClose = vi.fn();
        const view = render(
            <FluidSheet open onClose={onClose} ariaLabel="Pago" closeOnEscape>
                <button type="button" data-fluid-sheet-initial-focus>Confirmar</button>
                <button type="button">Procesando</button>
            </FluidSheet>,
        );
        act(() => clock.flush());

        const processingControl = screen.getByRole('button', { name: 'Procesando' });
        processingControl.focus();
        expect(processingControl).toHaveFocus();

        view.rerender(
            <FluidSheet open onClose={onClose} ariaLabel="Pago" closeOnEscape={false}>
                <button type="button" data-fluid-sheet-initial-focus>Confirmar</button>
                <button type="button">Procesando</button>
            </FluidSheet>,
        );

        expect(processingControl).toHaveFocus();
        expect(document.body.style.overflow).toBe('hidden');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('sigue el dedo, usa rubberband arriba y vuelve abierto al soltar', () => {
        const clock = installFrameClock();
        render(<SheetHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
        act(() => clock.flush());

        const panel = screen.getByRole('dialog', { name: 'Menú' }) as HTMLDivElement;
        const handle = panel.querySelector<HTMLElement>('[data-fluid-sheet-handle]')!;
        prepareHandle(handle);

        fireEvent.pointerDown(handle, {
            pointerId: 4,
            pointerType: 'touch',
            clientX: 100,
            clientY: 200,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 4,
            pointerType: 'touch',
            clientX: 100,
            clientY: 130,
        });

        expect(readOffset(panel)).toBeLessThan(0);
        expect(readOffset(panel)).toBeGreaterThan(-70);
        fireEvent.pointerUp(handle, {
            pointerId: 4,
            pointerType: 'touch',
            clientX: 100,
            clientY: 130,
        });
        act(() => clock.flush());

        expect(readOffset(panel)).toBe(0);
        expect(screen.getByRole('dialog', { name: 'Menú' })).toBeTruthy();
    });

    it('descarta la hoja al superar el umbral de arrastre', () => {
        const clock = installFrameClock();
        render(<SheetHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
        act(() => clock.flush());

        const panel = screen.getByRole('dialog', { name: 'Menú' }) as HTMLDivElement;
        const handle = panel.querySelector<HTMLElement>('[data-fluid-sheet-handle]')!;
        prepareHandle(handle);

        fireEvent.pointerDown(handle, {
            pointerId: 7,
            pointerType: 'touch',
            clientX: 120,
            clientY: 80,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 7,
            pointerType: 'touch',
            clientX: 120,
            clientY: 470,
        });
        expect(readOffset(panel)).toBe(380);
        fireEvent.pointerUp(handle, {
            pointerId: 7,
            pointerType: 'touch',
            clientX: 120,
            clientY: 470,
        });
        act(() => clock.flush());

        expect(screen.queryByRole('dialog', { name: 'Menú' })).toBeNull();
    });

    it('el backdrop inicia el cierre sin dejar pasar taps mientras la hoja sigue visible', () => {
        const clock = installFrameClock();
        render(<SheetHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
        act(() => clock.flush());

        const backdrop = document.querySelector<HTMLElement>('[data-fluid-sheet-backdrop]')!;
        fireEvent.click(backdrop);
        const root = document.querySelector<HTMLElement>('[data-fluid-sheet-root]')!;

        expect(root).toHaveAttribute('aria-hidden', 'true');
        expect(root.style.pointerEvents).not.toBe('none');
        expect(screen.queryByRole('dialog', { name: 'Menú' })).toBeNull();
        expect(document.querySelector('[data-fluid-sheet-panel]')).toBeTruthy();

        act(() => clock.flush());
        expect(document.querySelector('[data-fluid-sheet-panel]')).toBeNull();
    });

    it('recalcula el progreso del gesto cuando cambia la altura del viewport', () => {
        const clock = installFrameClock();
        render(<SheetHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
        act(() => clock.flush());

        Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
        fireEvent(window, new Event('resize'));

        const panel = screen.getByRole('dialog', { name: 'Menú' }) as HTMLDivElement;
        const handle = panel.querySelector<HTMLElement>('[data-fluid-sheet-handle]')!;
        const backdrop = document.querySelector<HTMLElement>('[data-fluid-sheet-backdrop]')!;
        prepareHandle(handle);

        fireEvent.pointerDown(handle, {
            pointerId: 31,
            pointerType: 'touch',
            clientX: 100,
            clientY: 100,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 31,
            pointerType: 'touch',
            clientX: 100,
            clientY: 410,
        });

        expect(readOffset(panel)).toBe(300);
        expect(Number(backdrop.style.opacity)).toBeCloseTo(0.5, 4);
        fireEvent.pointerCancel(handle, { pointerId: 31, pointerType: 'touch' });
        act(() => clock.flush());
    });

    it('cambia de destino desde el valor presentado y reduced motion no deja resorte activo', () => {
        const clock = installFrameClock();
        const onClose = vi.fn();
        const view = render(
            <FluidSheet open onClose={onClose} ariaLabel="Interrumpible">
                <button type="button">Acción</button>
            </FluidSheet>,
        );
        const panel = screen.getByRole('dialog', { name: 'Interrumpible' }) as HTMLDivElement;

        act(() => {
            for (let index = 0; index < 8; index += 1) clock.step();
        });
        const presented = readOffset(panel);
        expect(presented).toBeGreaterThan(0);
        expect(presented).toBeLessThan(800);

        view.rerender(
            <FluidSheet open={false} onClose={onClose} ariaLabel="Interrumpible">
                <button type="button">Acción</button>
            </FluidSheet>,
        );
        expect(readOffset(panel)).toBe(presented);
        act(() => clock.flush());
        expect(screen.queryByRole('dialog', { name: 'Interrumpible' })).toBeNull();
        view.unmount();

        const reduced = render(<SheetHarness reducedMotion />);
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
        expect(readOffset(screen.getByRole('dialog', { name: 'Menú' }))).toBe(0);
        act(() => clock.flush());
        expect(readOffset(screen.getByRole('dialog', { name: 'Menú' }))).toBe(0);
        expect(clock.pending()).toBe(0);
        reduced.unmount();
    });
});
