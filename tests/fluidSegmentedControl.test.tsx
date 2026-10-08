// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import FluidSegmentedControl from '../components/ui/FluidSegmentedControl';

const ITEMS = [
    { id: 'todos', label: 'Todos', count: 12 },
    { id: 'pendientes', label: 'Pendientes', shortLabel: 'Pend.', count: 4 },
    { id: 'listos', label: 'Listos', count: 0 },
] as const;

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
            if (frames.size > 0) {
                throw new Error('Quedaron cuadros de FluidSegmentedControl pendientes');
            }
        },
        pending: () => frames.size,
    };
    return clock;
};

const installMotionPreference = (matches: boolean) => {
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

const readPosition = (indicator: HTMLElement): number => {
    const match = indicator.style.transform.match(/translate3d\((-?[\d.]+)%,\s*0,\s*0\)/);
    if (!match) throw new Error(`Transform inesperado: ${indicator.style.transform}`);
    return Number(match[1]) / 100;
};

const Harness = () => {
    const [activeId, setActiveId] = useState('todos');
    return (
        <FluidSegmentedControl
            items={ITEMS}
            activeId={activeId}
            onChange={setActiveId}
            ariaLabel="Estado de entregas"
            className="control-prueba"
        />
    );
};

beforeEach(() => {
    installMotionPreference(false);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('FluidSegmentedControl', () => {
    it('expone radiogroup, seleccion roving y targets tactiles uniformes', () => {
        render(<Harness />);

        const radiogroup = screen.getByRole('radiogroup', { name: 'Estado de entregas' });
        const options = screen.getAllByRole('radio');
        expect(radiogroup).toHaveClass('control-prueba');
        expect(radiogroup).toHaveStyle({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' });
        expect(options).toHaveLength(3);
        expect(options[0]).toHaveAttribute('aria-checked', 'true');
        expect(options[0]).toHaveAttribute('tabindex', '0');
        expect(options[1]).toHaveAttribute('tabindex', '-1');
        options.forEach((option) => {
            expect(option).toHaveClass('nx-fluid-press', 'min-h-11', 'min-w-11');
        });

        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Pendientes' })).toHaveTextContent('Pend.');
        expect(screen.getByText('0')).toBeInTheDocument();
        const indicator = radiogroup.querySelector<HTMLElement>('[data-fluid-segmented-indicator]')!;
        expect(Number.parseFloat(indicator.style.width)).toBeCloseTo(100 / 3, 5);
        expect(readPosition(indicator)).toBe(0);

        const semanticPalette = [
            radiogroup,
            indicator,
            ...options,
            ...radiogroup.querySelectorAll<HTMLElement>('span'),
        ].map((element) => element.className).join(' ');
        [
            '--nx-canvas-subtle',
            '--nx-canvas-raised',
            '--nx-canvas-text',
            '--nx-canvas-muted',
            '--nx-canvas-border',
            '--nx-brand-soft',
            '--nx-brand-ring',
        ].forEach((token) => expect(semanticPalette).toContain(`var(${token})`));
    });

    it('activa con click y con ArrowLeft/ArrowRight/Home/End, incluyendo wrap', () => {
        render(<Harness />);
        const todos = screen.getByRole('radio', { name: 'Todos' });
        const pendientes = screen.getByRole('radio', { name: 'Pendientes' });
        const listos = screen.getByRole('radio', { name: 'Listos' });

        fireEvent.click(pendientes);
        expect(pendientes).toHaveAttribute('aria-checked', 'true');
        expect(pendientes).toHaveAttribute('tabindex', '0');

        pendientes.focus();
        fireEvent.keyDown(pendientes, { key: 'ArrowRight' });
        expect(listos).toHaveFocus();
        expect(listos).toHaveAttribute('aria-checked', 'true');

        fireEvent.keyDown(listos, { key: 'ArrowRight' });
        expect(todos).toHaveFocus();
        expect(todos).toHaveAttribute('aria-checked', 'true');

        fireEvent.keyDown(todos, { key: 'ArrowLeft' });
        expect(listos).toHaveFocus();
        fireEvent.keyDown(listos, { key: 'Home' });
        expect(todos).toHaveFocus();
        fireEvent.keyDown(todos, { key: 'End' });
        expect(listos).toHaveFocus();
        expect(listos).toHaveAttribute('aria-checked', 'true');
    });

    it('retargetea el mismo movimiento desde la posicion presentada', () => {
        const clock = installFrameClock();
        const onChange = vi.fn();
        const view = render(
            <FluidSegmentedControl
                items={ITEMS}
                activeId="todos"
                onChange={onChange}
                ariaLabel="Movimiento"
            />,
        );
        const indicator = document.querySelector<HTMLElement>('[data-fluid-segmented-indicator]')!;

        view.rerender(
            <FluidSegmentedControl
                items={ITEMS}
                activeId="listos"
                onChange={onChange}
                ariaLabel="Movimiento"
            />,
        );
        act(() => {
            for (let index = 0; index < 8; index += 1) clock.step();
        });
        const presented = readPosition(indicator);
        expect(presented).toBeGreaterThan(0);
        expect(presented).toBeLessThan(2);

        view.rerender(
            <FluidSegmentedControl
                items={ITEMS}
                activeId="pendientes"
                onChange={onChange}
                ariaLabel="Movimiento"
            />,
        );
        expect(readPosition(indicator)).toBeCloseTo(presented, 8);

        act(() => clock.flush());
        expect(readPosition(indicator)).toBe(1);
        expect(clock.pending()).toBe(0);
    });

    it('salta al destino sin programar resorte con prefers-reduced-motion', () => {
        installMotionPreference(true);
        const clock = installFrameClock();
        const onChange = vi.fn();
        const view = render(
            <FluidSegmentedControl
                items={ITEMS}
                activeId="todos"
                onChange={onChange}
                ariaLabel="Movimiento reducido"
            />,
        );

        view.rerender(
            <FluidSegmentedControl
                items={ITEMS}
                activeId="listos"
                onChange={onChange}
                ariaLabel="Movimiento reducido"
            />,
        );

        const indicator = document.querySelector<HTMLElement>('[data-fluid-segmented-indicator]')!;
        expect(readPosition(indicator)).toBe(2);
        expect(clock.pending()).toBe(0);
    });
});
