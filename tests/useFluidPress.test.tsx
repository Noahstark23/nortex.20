// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFluidPress } from '../hooks/useFluidPress';
import type { FluidPressDetail } from '../hooks/useFluidPress';

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
        flush(limit = 800) {
            let steps = 0;
            while (frames.size > 0 && steps < limit) {
                clock.step();
                steps += 1;
            }
            if (frames.size > 0) throw new Error('Quedaron cuadros de animacion pendientes');
        },
        pending: () => frames.size,
    };
    return clock;
};

const installMotionPreference = (matches = false) => {
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
        dispatchEvent: () => true,
    })));
};

const prepareButton = (button: HTMLButtonElement) => {
    const captured = new Set<number>();
    button.setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
    button.hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
    button.releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId));
    button.getBoundingClientRect = vi.fn(() => ({
        x: 0,
        y: 0,
        left: 0,
        right: 100,
        top: 0,
        bottom: 40,
        width: 100,
        height: 40,
        toJSON: () => ({}),
    }));
};

const FluidButton = ({
    onClick = vi.fn(),
    onPressChange = vi.fn(),
    onRelease = vi.fn(),
    reducedMotion,
}: {
    onClick?: () => void;
    onPressChange?: (pressed: boolean, detail: FluidPressDetail) => void;
    onRelease?: (detail: FluidPressDetail) => void;
    reducedMotion?: boolean;
}) => {
    const { bind } = useFluidPress<HTMLButtonElement>({
        onPressChange,
        onRelease,
        reducedMotion,
    });
    const [clicks, setClicks] = useState(0);

    return (
        <button
            type="button"
            {...bind}
            onClick={() => {
                setClicks((value) => value + 1);
                onClick();
            }}
        >
            Guardar {clicks}
        </button>
    );
};

beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    installMotionPreference(false);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useFluidPress', () => {
    it('responde en pointerdown, captura el puntero y conserva el click nativo', () => {
        const clock = installFrameClock();
        const onClick = vi.fn();
        const onPressChange = vi.fn();
        const onRelease = vi.fn();
        render(
            <FluidButton
                onClick={onClick}
                onPressChange={onPressChange}
                onRelease={onRelease}
            />,
        );

        const button = screen.getByRole('button', { name: 'Guardar 0' }) as HTMLButtonElement;
        prepareButton(button);

        const wasNotCancelled = fireEvent.pointerDown(button, {
            pointerId: 7,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 50,
            clientY: 20,
        });

        expect(wasNotCancelled).toBe(true);
        expect(button.setPointerCapture).toHaveBeenCalledWith(7);
        expect(Number(button.style.opacity)).toBeLessThan(1);
        expect(Number(button.style.opacity)).toBeGreaterThan(0.94);
        expect(button.style.willChange).toContain('transform');
        expect(onPressChange).toHaveBeenCalledWith(true, expect.objectContaining({ inside: true }));

        act(() => clock.step());
        expect(Number(button.style.scale)).toBeLessThan(1);

        fireEvent.pointerUp(button, {
            pointerId: 7,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 50,
            clientY: 20,
        });
        fireEvent.click(button);

        expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({
            pointerId: 7,
            cancelled: false,
            inside: true,
        }));
        expect(onClick).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Guardar 1' })).toBeTruthy();

        act(() => clock.flush());
        expect(button.style.getPropertyValue('scale')).toBe('');
        expect(button.style.opacity).toBe('');
        expect(button.style.willChange).toBe('');
    });

    it('usa 10px de histeresis y permite salir y volver durante la captura', () => {
        const clock = installFrameClock();
        const onPressChange = vi.fn();
        const onRelease = vi.fn();
        render(<FluidButton onPressChange={onPressChange} onRelease={onRelease} />);
        const button = screen.getByRole('button') as HTMLButtonElement;
        prepareButton(button);

        fireEvent.pointerDown(button, {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 50,
            clientY: 20,
        });
        fireEvent.pointerMove(button, {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 111,
            clientY: 20,
        });
        expect(onPressChange).toHaveBeenLastCalledWith(false, expect.objectContaining({
            inside: false,
            moved: true,
        }));

        fireEvent.pointerMove(button, {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 109,
            clientY: 20,
        });
        expect(onPressChange).toHaveBeenLastCalledWith(true, expect.objectContaining({
            inside: true,
            moved: true,
        }));

        fireEvent.pointerUp(button, {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 109,
            clientY: 20,
        });
        expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ moved: true, inside: true }));
        act(() => clock.flush());
    });

    it('en reduced motion conserva feedback por opacidad sin mover el elemento', () => {
        const clock = installFrameClock();
        render(<FluidButton reducedMotion />);
        const button = screen.getByRole('button') as HTMLButtonElement;
        prepareButton(button);

        fireEvent.pointerDown(button, {
            pointerId: 4,
            pointerType: 'touch',
            clientX: 20,
            clientY: 20,
        });

        expect(Number(button.style.opacity)).toBeLessThan(1);
        expect(Number(button.style.opacity)).toBeGreaterThan(0.94);
        expect(button.style.getPropertyValue('scale')).toBe('');

        fireEvent.pointerUp(button, {
            pointerId: 4,
            pointerType: 'touch',
            clientX: 20,
            clientY: 20,
        });
        expect(button.style.getPropertyValue('scale')).toBe('');
        act(() => clock.flush());
        expect(button.style.opacity).toBe('');
    });

    it('interrumpe el regreso desde la presentacion actual sin salto de scale', () => {
        const clock = installFrameClock();
        render(<FluidButton />);
        const button = screen.getByRole('button') as HTMLButtonElement;
        prepareButton(button);

        fireEvent.pointerDown(button, {
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 50,
            clientY: 20,
        });
        act(() => {
            for (let index = 0; index < 8; index += 1) clock.step();
        });
        fireEvent.pointerUp(button, {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 50,
            clientY: 20,
        });
        act(() => {
            for (let index = 0; index < 3; index += 1) clock.step();
        });
        const presentationScale = button.style.scale;
        const presentationOpacity = button.style.opacity;

        fireEvent.pointerDown(button, {
            pointerId: 8,
            pointerType: 'mouse',
            button: 0,
            clientX: 50,
            clientY: 20,
        });

        expect(button.style.scale).toBe(presentationScale);
        expect(button.style.opacity).toBe(presentationOpacity);
        act(() => clock.step());
        // La velocidad positiva del settle anterior continua un cuadro antes
        // de que el nuevo destino de press la redirija.
        expect(Number(button.style.opacity)).toBeGreaterThan(Number(presentationOpacity));
        fireEvent.pointerCancel(button, { pointerId: 8, pointerType: 'mouse' });
        act(() => clock.flush());
    });

    it('suprime solo el click de puntero que sigue a un release fuera', () => {
        const clock = installFrameClock();
        const onClick = vi.fn();
        render(<FluidButton onClick={onClick} />);
        const button = screen.getByRole('button') as HTMLButtonElement;
        prepareButton(button);

        fireEvent.pointerDown(button, {
            pointerId: 21,
            pointerType: 'mouse',
            button: 0,
            clientX: 50,
            clientY: 20,
        });
        fireEvent.pointerMove(button, {
            pointerId: 21,
            pointerType: 'mouse',
            clientX: 111,
            clientY: 20,
        });
        fireEvent.pointerUp(button, {
            pointerId: 21,
            pointerType: 'mouse',
            clientX: 111,
            clientY: 20,
        });

        // Una activacion de teclado intercalada conserva su semantica.
        expect(fireEvent.click(button, { detail: 0 })).toBe(true);
        expect(onClick).toHaveBeenCalledOnce();

        // Este es el click sintetizado por el release exterior: se consume una vez.
        expect(fireEvent.click(button, { detail: 1, clientX: 111, clientY: 20 })).toBe(false);
        expect(onClick).toHaveBeenCalledOnce();

        // La siguiente secuencia valida de puntero no hereda la supresion.
        fireEvent.pointerDown(button, {
            pointerId: 22,
            pointerType: 'mouse',
            button: 0,
            clientX: 50,
            clientY: 20,
        });
        fireEvent.pointerUp(button, {
            pointerId: 22,
            pointerType: 'mouse',
            clientX: 50,
            clientY: 20,
        });
        expect(fireEvent.click(button, { detail: 1, clientX: 50, clientY: 20 })).toBe(true);
        expect(onClick).toHaveBeenCalledTimes(2);
        act(() => clock.flush());
    });

    it('ignora botones secundarios y cancela cuadros al desmontar', () => {
        const clock = installFrameClock();
        const onPressChange = vi.fn();
        const view = render(<FluidButton onPressChange={onPressChange} />);
        const button = screen.getByRole('button') as HTMLButtonElement;
        prepareButton(button);

        fireEvent.pointerDown(button, {
            pointerId: 5,
            pointerType: 'mouse',
            button: 2,
            clientX: 50,
            clientY: 20,
        });
        expect(onPressChange).not.toHaveBeenCalled();
        expect(clock.pending()).toBe(0);

        fireEvent.pointerDown(button, {
            pointerId: 6,
            pointerType: 'mouse',
            button: 0,
            clientX: 50,
            clientY: 20,
        });
        expect(clock.pending()).toBeGreaterThan(0);
        view.unmount();
        expect(clock.pending()).toBe(0);
        expect(button.style.scale).toBe('');
        expect(button.style.opacity).toBe('');
    });

    it('trata lostpointercapture como cancelacion segura', () => {
        const clock = installFrameClock();
        const onRelease = vi.fn();
        render(<FluidButton onRelease={onRelease} />);
        const button = screen.getByRole('button') as HTMLButtonElement;
        prepareButton(button);

        fireEvent.pointerDown(button, {
            pointerId: 11,
            pointerType: 'touch',
            clientX: 50,
            clientY: 20,
        });
        fireEvent.lostPointerCapture(button, {
            pointerId: 11,
            pointerType: 'touch',
        });

        expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
        act(() => clock.flush());
        expect(button.style.scale).toBe('');
        expect(button.style.opacity).toBe('');
    });

    it('compone y restaura estilos inline que ya pertenecian al consumidor', () => {
        const clock = installFrameClock();
        render(<FluidButton />);
        const button = screen.getByRole('button') as HTMLButtonElement;
        button.style.setProperty('scale', '1.1');
        button.style.setProperty('opacity', '0.8');
        button.style.setProperty('will-change', 'filter');
        button.style.transform = 'translateX(5px) rotate(2deg)';
        prepareButton(button);

        fireEvent.pointerDown(button, {
            pointerId: 12,
            pointerType: 'mouse',
            button: 0,
            clientX: 50,
            clientY: 20,
        });

        expect(Number(button.style.opacity)).toBeLessThan(0.8);
        expect(Number(button.style.opacity)).toBeGreaterThan(0.8 * 0.94);
        expect(button.style.willChange).toContain('filter');
        act(() => clock.step());
        expect(Number(button.style.scale)).toBeLessThan(1.1);

        fireEvent.pointerUp(button, {
            pointerId: 12,
            pointerType: 'mouse',
            clientX: 50,
            clientY: 20,
        });
        act(() => clock.flush());

        expect(button.style.scale).toBe('1.1');
        expect(button.style.opacity).toBe('0.8');
        expect(button.style.willChange).toBe('filter');
        expect(button.style.transform).toBe('translateX(5px) rotate(2deg)');
    });
});
