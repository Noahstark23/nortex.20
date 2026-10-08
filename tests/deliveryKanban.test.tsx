// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import DeliveryKanban from '../components/delivery/DeliveryKanban';
import type {
    DeliveryOrder,
    DeliveryRider,
} from '../components/delivery/DeliveryKanban';

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

    return {
        flush(limit = 1_000) {
            let steps = 0;
            while (frames.size > 0 && steps < limit) {
                time += 1000 / 120;
                const pending = [...frames.values()];
                frames.clear();
                pending.forEach((callback) => callback(time));
                steps += 1;
            }
            if (frames.size > 0) throw new Error('Quedaron cuadros del kanban pendientes');
        },
        pending: () => frames.size,
    };
};

const installMotionPreference = (matches: boolean) => {
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
        matches: media === '(prefers-reduced-motion: reduce)' ? matches : false,
        media,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
    })));
};

const rect = (
    left: number,
    top: number,
    width: number,
    height: number,
): DOMRect => ({
    x: left,
    y: top,
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
} as DOMRect);

const riders: DeliveryRider[] = [
    { id: 'rider-1', nombre: 'Ana López', tipoFlota: 'PROPIA' },
];

const order = (
    id: string,
    estado: string,
    overrides: Partial<DeliveryOrder> = {},
): DeliveryOrder => ({
    id,
    clienteNombre: `Cliente ${id}`,
    clienteTelefono: '8888-0000',
    direccionEntrega: 'Managua',
    estado,
    total: 250,
    ...overrides,
});

const renderKanban = ({
    pedidos = [order('pending-1', 'pendiente')],
    onMove = vi.fn(() => true),
    onAssign = vi.fn(),
}: {
    pedidos?: DeliveryOrder[];
    onMove?: ReturnType<typeof vi.fn>;
    onAssign?: ReturnType<typeof vi.fn>;
} = {}) => {
    const view = render(
        <DeliveryKanban
            pedidos={pedidos}
            activeRiders={riders}
            assigningId={null}
            movingId={null}
            onAssign={onAssign}
            onMove={onMove}
        />,
    );
    return { ...view, onMove, onAssign };
};

const prepareDrag = (
    pedidoId: string,
    sourceRect = rect(0, 0, 160, 180),
    targetRect = rect(200, 0, 200, 500),
) => {
    const handle = document.querySelector<HTMLElement>(
        `[data-delivery-drag-handle="${pedidoId}"]`,
    );
    const card = document.querySelector<HTMLElement>(`[data-delivery-card="${pedidoId}"]`);
    const target = document.querySelector<HTMLElement>('[data-delivery-column="preparando"]');
    if (!handle || !card || !target) throw new Error('No se pudo preparar el drag de prueba');

    const captured = new Set<number>();
    handle.setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
    handle.hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
    handle.releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId));
    card.getBoundingClientRect = vi.fn(() => sourceRect);
    target.getBoundingClientRect = vi.fn(() => targetRect);
    return { handle, card, target };
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

describe('DeliveryKanban', () => {
    it('no muta si el puntero entra al destino sin superar el umbral', () => {
        const clock = installFrameClock();
        const { onMove } = renderKanban();
        const { handle, card } = prepareDrag(
            'pending-1',
            rect(0, 0, 100, 120),
            rect(40, 0, 180, 400),
        );

        fireEvent.pointerDown(handle, {
            pointerId: 4,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 50,
            clientY: 50,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 4,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 54,
            clientY: 50,
        });
        expect(card.style.transform).toBe('translate3d(4px, 0px, 0)');
        fireEvent.pointerUp(handle, {
            pointerId: 4,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 54,
            clientY: 50,
        });

        expect(onMove).not.toHaveBeenCalled();
        act(() => clock.flush());
        expect(card.style.transform).toBe('');
    });

    it('hace un solo commit al soltar en la unica columna valida', async () => {
        const clock = installFrameClock();
        const { onMove } = renderKanban();
        const { handle } = prepareDrag('pending-1');

        fireEvent.pointerDown(handle, {
            pointerId: 8,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 50,
            clientY: 60,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 8,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 80,
        });

        expect(document.querySelector('[data-delivery-column="preparando"]'))
            .toHaveAttribute('data-drop-target', 'active');
        expect(document.querySelector('[data-delivery-column="en_camino"]'))
            .not.toHaveAttribute('data-drop-target');
        expect(onMove).not.toHaveBeenCalled();

        fireEvent.pointerUp(handle, {
            pointerId: 8,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 80,
        });
        fireEvent.pointerUp(handle, {
            pointerId: 8,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 80,
        });
        fireEvent.lostPointerCapture(handle, { pointerId: 8, pointerType: 'mouse' });

        expect(onMove).toHaveBeenCalledOnce();
        expect(onMove).toHaveBeenCalledWith('pending-1', 'preparando');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('movido a Preparando'));
        act(() => clock.flush());
    });

    it('no convierte una proyeccion de momentum en un pointerup valido', () => {
        const clock = installFrameClock();
        const { onMove } = renderKanban();
        const { handle } = prepareDrag('pending-1');

        fireEvent.pointerDown(handle, {
            pointerId: 9,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 50,
            clientY: 60,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 9,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 180,
            clientY: 80,
        });
        fireEvent.pointerUp(handle, {
            pointerId: 9,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 180,
            clientY: 80,
        });

        expect(onMove).not.toHaveBeenCalled();
        act(() => clock.flush());
    });

    it('aborta limpio cuando el navegador no puede capturar el puntero', () => {
        const { onMove } = renderKanban();
        const { handle, card } = prepareDrag('pending-1');
        handle.setPointerCapture = vi.fn(() => {
            throw new Error('capture unavailable');
        });

        fireEvent.pointerDown(handle, {
            pointerId: 10,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 50,
            clientY: 60,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 10,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 80,
        });
        fireEvent.pointerUp(handle, {
            pointerId: 10,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 80,
        });

        expect(onMove).not.toHaveBeenCalled();
        expect(card.style.transform).toBe('');
        expect(card.style.willChange).toBe('');
        expect(screen.getByRole('status')).toHaveTextContent('No se pudo iniciar el movimiento');
    });

    it('pointercancel, lost capture y Escape revierten sin mutacion', () => {
        const clock = installFrameClock();
        const { onMove } = renderKanban();
        let prepared = prepareDrag('pending-1');

        fireEvent.pointerDown(prepared.handle, {
            pointerId: 11,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            clientX: 40,
            clientY: 50,
        });
        fireEvent.pointerMove(prepared.handle, {
            pointerId: 11,
            pointerType: 'touch',
            isPrimary: true,
            clientX: 250,
            clientY: 70,
        });
        fireEvent.pointerCancel(prepared.handle, { pointerId: 11, pointerType: 'touch' });
        act(() => clock.flush());
        const firstCancellation = screen.getByRole('status');

        prepared = prepareDrag('pending-1');
        fireEvent.pointerDown(prepared.handle, {
            pointerId: 12,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 40,
            clientY: 50,
        });
        fireEvent.lostPointerCapture(prepared.handle, { pointerId: 12, pointerType: 'mouse' });
        act(() => clock.flush());
        expect(screen.getByRole('status')).not.toBe(firstCancellation);

        prepared = prepareDrag('pending-1');
        fireEvent.pointerDown(prepared.handle, {
            pointerId: 13,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 40,
            clientY: 50,
        });
        fireEvent.pointerMove(prepared.handle, {
            pointerId: 13,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 70,
        });
        fireEvent.keyDown(document, { key: 'Escape' });
        act(() => clock.flush());

        expect(onMove).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Movimiento cancelado');
    });

    it('mantiene un boton operable por teclado como fallback', async () => {
        const user = userEvent.setup();
        const { onMove } = renderKanban();
        const action = screen.getByRole('button', { name: /Iniciar preparación/i });

        action.focus();
        await user.keyboard('{Enter}');

        expect(onMove).toHaveBeenCalledOnce();
        expect(onMove).toHaveBeenCalledWith('pending-1', 'preparando');
        await waitFor(() => {
            expect(screen.getByRole('radio', { name: /Preparando/i }))
                .toHaveAttribute('aria-checked', 'true');
        });
    });

    it('bloquea el despacho sin motorizado y conserva el selector accesible', async () => {
        const onAssign = vi.fn();
        const onMove = vi.fn(() => true);
        renderKanban({
            pedidos: [order('preparing-1', 'preparando')],
            onAssign,
            onMove,
        });

        const dispatch = screen.getByRole('button', { name: /Despachar/i });
        expect(dispatch).toBeDisabled();
        expect(dispatch).toHaveAccessibleDescription('Asigná un motorizado para despachar');
        expect(screen.getByText('Asigná un motorizado para despachar')).toBeVisible();
        expect(document.querySelector('[data-delivery-drag-handle="preparing-1"]'))
            .toHaveAttribute('data-drag-disabled', 'true');

        await userEvent.selectOptions(screen.getByLabelText('Motorizado'), 'rider-1');
        expect(onAssign).toHaveBeenCalledWith('preparing-1', 'rider-1');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('usa un solo arbol como carrusel movil y sincroniza el selector', () => {
        const pedidos = [
            order('pending-1', 'pendiente'),
            order('preparing-1', 'preparando', { motorizadoId: 'rider-1' }),
            order('route-1', 'en_camino', { motorizadoId: 'rider-1' }),
            order('delivered-1', 'entregado'),
        ];
        renderKanban({ pedidos });

        const preparingColumn = document.querySelector<HTMLElement>(
            '[data-delivery-column="preparando"]',
        )!;
        preparingColumn.scrollIntoView = vi.fn();
        fireEvent.click(screen.getByRole('radio', { name: /Preparando/i }));

        expect(screen.getByRole('radio', { name: /Preparando/i })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: /Preparando/i })).toHaveTextContent('Prep.');
        expect(preparingColumn.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({
            behavior: 'auto',
            inline: 'start',
        }));
        const mobileStrip = screen.getByRole('radiogroup', { name: 'Estado de los pedidos' }).parentElement;
        expect(mobileStrip).toHaveClass('bg-[var(--nx-canvas)]');
        expect(mobileStrip).not.toHaveClass('sticky', 'top-0');
        expect(document.querySelectorAll('[data-delivery-column]')).toHaveLength(4);
        expect(screen.getByRole('region', { name: 'Columnas de pedidos' })).toHaveClass(
            'no-scrollbar',
            'flex',
            'snap-x',
            'lg:grid',
            'lg:grid-cols-4',
        );
        expect(preparingColumn.className).not.toContain('transition-[');
        expect(document.querySelector('[data-delivery-drag-handle="route-1"]')).toBeNull();
        expect(document.querySelector('[data-delivery-drag-handle="delivered-1"]')).toBeNull();
    });

    it('en reduced motion sigue 1:1 pero confirma y vuelve sin momentum ni resorte', () => {
        installMotionPreference(true);
        const clock = installFrameClock();
        const { onMove } = renderKanban();
        const { handle, card } = prepareDrag('pending-1');

        fireEvent.pointerDown(handle, {
            pointerId: 21,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: 50,
            clientY: 60,
        });
        fireEvent.pointerMove(handle, {
            pointerId: 21,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 80,
        });
        expect(card.style.transform).toBe('translate3d(200px, 20px, 0)');
        expect(card.style.boxShadow).toBe('var(--nx-shadow-float)');

        fireEvent.pointerUp(handle, {
            pointerId: 21,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: 250,
            clientY: 80,
        });

        expect(onMove).toHaveBeenCalledOnce();
        expect(card.style.transform).toBe('');
        expect(clock.pending()).toBe(0);
    });
});
