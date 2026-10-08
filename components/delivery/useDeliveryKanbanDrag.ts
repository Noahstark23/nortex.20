import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import type {
    MutableRefObject,
    PointerEvent as ReactPointerEvent,
} from 'react';
import {
    animateSpring,
    appendMotionSample,
    estimateMotionVelocity,
    isPointInsideExpandedRect,
    projectMomentum,
} from '../../utils/fluidMotion';
import type {
    MotionSample,
    SpringAnimationController,
} from '../../utils/fluidMotion';
import type {
    DeliveryOrder,
    DeliveryVisibleState,
} from './DeliveryKanban';

const DRAG_START_THRESHOLD = 8;
const INTERACTIVE_SELECTOR = 'a,button,select,input,textarea,[data-no-drag]';

interface Point {
    x: number;
    y: number;
}

interface CardStyleSnapshot {
    transform: string;
    willChange: string;
    position: string;
    zIndex: string;
    boxShadow: string;
}

interface DragSession {
    pedido: DeliveryOrder;
    pointerId: number;
    handle: HTMLElement;
    card: HTMLElement;
    nextState: DeliveryVisibleState;
    origin: Point;
    latest: Point;
    cardRect: DOMRect;
    target: HTMLElement;
    snapshot: CardStyleSnapshot;
    history: MotionSample[];
    activated: boolean;
    committed: boolean;
}

interface CardAnimation {
    token: symbol;
    card: HTMLElement;
    snapshot: CardStyleSnapshot;
    position: Point;
    controller: SpringAnimationController | null;
}

export interface UseDeliveryKanbanDragOptions {
    reducedMotion: boolean;
    movingId: string | null;
    localMovingId: string | null;
    columnRefs: MutableRefObject<Map<DeliveryVisibleState, HTMLElement>>;
    performMove: (pedido: DeliveryOrder, nextState: DeliveryVisibleState) => Promise<boolean>;
    say: (message: string) => void;
    labelForState: (state: DeliveryVisibleState) => string;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));

const eventTime = (event: ReactPointerEvent<HTMLElement>): number =>
    Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();

const snapshotCardStyle = (card: HTMLElement): CardStyleSnapshot => ({
    transform: card.style.transform,
    willChange: card.style.willChange,
    position: card.style.position,
    zIndex: card.style.zIndex,
    boxShadow: card.style.boxShadow,
});

const restoreCardStyle = (card: HTMLElement, snapshot: CardStyleSnapshot) => {
    card.style.transform = snapshot.transform;
    card.style.willChange = snapshot.willChange;
    card.style.position = snapshot.position;
    card.style.zIndex = snapshot.zIndex;
    card.style.boxShadow = snapshot.boxShadow;
};

const applyCardPosition = (card: HTMLElement, point: Point) => {
    card.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
};

const safelyReleasePointer = (element: HTMLElement, pointerId: number) => {
    try {
        if (typeof element.releasePointerCapture === 'function'
            && (typeof element.hasPointerCapture !== 'function'
                || element.hasPointerCapture(pointerId))) {
            element.releasePointerCapture(pointerId);
        }
    } catch {
        // Safari/WebView puede perder el nodo junto con la captura.
    }
};

/**
 * Motor de puntero del kanban. Mantiene el seguimiento y el resorte fuera de
 * React; React solo recibe identidad de drag y columna valida para accesibilidad.
 */
export const useDeliveryKanbanDrag = ({
    reducedMotion,
    movingId,
    localMovingId,
    columnRefs,
    performMove,
    say,
    labelForState,
}: UseDeliveryKanbanDragOptions) => {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DeliveryVisibleState | null>(null);
    const dragRef = useRef<DragSession | null>(null);
    const animationsRef = useRef(new Map<string, CardAnimation>());

    const cancelCardAnimation = useCallback((pedidoId: string, restore = true) => {
        const animation = animationsRef.current.get(pedidoId);
        if (!animation) return;
        animation.controller?.cancel();
        animationsRef.current.delete(pedidoId);
        if (restore) restoreCardStyle(animation.card, animation.snapshot);
    }, []);

    const animateCardTo = useCallback((
        pedidoId: string,
        card: HTMLElement,
        snapshot: CardStyleSnapshot,
        from: Point,
        to: Point,
        velocity: Point,
    ) => {
        const previous = animationsRef.current.get(pedidoId);
        const actualFrom = previous?.position ?? from;
        const originalSnapshot = previous?.snapshot ?? snapshot;
        previous?.controller?.cancel();

        if (!card.isConnected) {
            animationsRef.current.delete(pedidoId);
            return;
        }

        if (reducedMotion || Math.hypot(to.x - actualFrom.x, to.y - actualFrom.y) < 0.5) {
            applyCardPosition(card, to);
            restoreCardStyle(card, originalSnapshot);
            animationsRef.current.delete(pedidoId);
            return;
        }

        const token = Symbol(`delivery-card-${pedidoId}`);
        const motion: CardAnimation = {
            token,
            card,
            snapshot: originalSnapshot,
            position: actualFrom,
            controller: null,
        };
        animationsRef.current.set(pedidoId, motion);

        const delta = { x: to.x - actualFrom.x, y: to.y - actualFrom.y };
        const distanceSquared = delta.x * delta.x + delta.y * delta.y;
        const progressVelocity = distanceSquared > 0
            ? clamp((velocity.x * delta.x + velocity.y * delta.y) / distanceSquared, -8, 8)
            : 0;

        const controller = animateSpring({
            from: 0,
            to: 1,
            velocity: progressVelocity,
            dampingRatio: 1,
            response: 0.34,
            restDelta: 0.001,
            restSpeed: 0.01,
            onUpdate: (progress) => {
                if (animationsRef.current.get(pedidoId)?.token !== token) return;
                motion.position = {
                    x: actualFrom.x + delta.x * progress,
                    y: actualFrom.y + delta.y * progress,
                };
                applyCardPosition(card, motion.position);
            },
            onComplete: () => {
                if (animationsRef.current.get(pedidoId)?.token !== token) return;
                animationsRef.current.delete(pedidoId);
                restoreCardStyle(card, originalSnapshot);
            },
        });
        if (animationsRef.current.get(pedidoId)?.token === token) {
            motion.controller = controller;
        }
    }, [reducedMotion]);

    const snapAnimationBack = useCallback((pedidoId: string, velocity: Point) => {
        const animation = animationsRef.current.get(pedidoId);
        if (!animation) return;
        animateCardTo(
            pedidoId,
            animation.card,
            animation.snapshot,
            animation.position,
            { x: 0, y: 0 },
            velocity,
        );
    }, [animateCardTo]);

    const finishCancelledDrag = useCallback((releasePointer: boolean, message?: string) => {
        const session = dragRef.current;
        if (!session) return;
        dragRef.current = null;
        if (releasePointer) safelyReleasePointer(session.handle, session.pointerId);
        setDraggingId(null);
        setDropTarget(null);

        const velocity = estimateMotionVelocity(session.history);
        animateCardTo(
            session.pedido.id,
            session.card,
            session.snapshot,
            {
                x: session.latest.x - session.origin.x,
                y: session.latest.y - session.origin.y,
            },
            { x: 0, y: 0 },
            { x: velocity.x, y: velocity.y },
        );
        if (message) say(message);
    }, [animateCardTo, say]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !dragRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            finishCancelledDrag(true, 'Movimiento cancelado.');
        };
        document.addEventListener('keydown', handleEscape, true);
        return () => document.removeEventListener('keydown', handleEscape, true);
    }, [finishCancelledDrag]);

    useEffect(() => () => {
        dragRef.current = null;
        animationsRef.current.forEach((animation) => {
            animation.controller?.cancel();
            restoreCardStyle(animation.card, animation.snapshot);
        });
        animationsRef.current.clear();
    }, []);

    const handlePointerDown = useCallback((
        event: ReactPointerEvent<HTMLElement>,
        pedido: DeliveryOrder,
        nextState: DeliveryVisibleState,
    ) => {
        if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
        if ((event.target as Element).closest(INTERACTIVE_SELECTOR)) return;
        if (pedido.estado === 'preparando' && !pedido.motorizadoId) {
            say('Asigná un motorizado para despachar');
            return;
        }
        if (movingId === pedido.id || localMovingId === pedido.id) return;

        const handle = event.currentTarget;
        const card = handle.closest<HTMLElement>('[data-delivery-card]');
        const target = columnRefs.current.get(nextState);
        if (!card || !target) return;

        try {
            if (typeof handle.setPointerCapture !== 'function') throw new Error('Pointer capture no disponible');
            handle.setPointerCapture(event.pointerId);
            if (typeof handle.hasPointerCapture === 'function'
                && !handle.hasPointerCapture(event.pointerId)) {
                throw new Error('Pointer capture no confirmada');
            }
        } catch {
            safelyReleasePointer(handle, event.pointerId);
            say('No se pudo iniciar el movimiento. Intentá de nuevo.');
            return;
        }

        cancelCardAnimation(pedido.id);
        const snapshot = snapshotCardStyle(card);
        const origin = { x: event.clientX, y: event.clientY };
        const initialSample = { ...origin, time: eventTime(event) };
        dragRef.current = {
            pedido,
            pointerId: event.pointerId,
            handle,
            card,
            nextState,
            origin,
            latest: origin,
            cardRect: card.getBoundingClientRect(),
            target,
            snapshot,
            history: [initialSample],
            activated: false,
            committed: false,
        };

        card.style.willChange = 'transform';
        card.style.position = 'relative';
        card.style.zIndex = '30';
        card.style.boxShadow = 'var(--nx-shadow-float)';
        setDraggingId(pedido.id);
        setDropTarget(null);
        say(`Arrastrando pedido de ${pedido.clienteNombre}. Destino permitido: ${labelForState(nextState)}.`);

        event.preventDefault();
    }, [cancelCardAnimation, columnRefs, labelForState, localMovingId, movingId, say]);

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const session = dragRef.current;
        if (!session || event.pointerId !== session.pointerId || session.committed) return;

        session.latest = { x: event.clientX, y: event.clientY };
        session.history = appendMotionSample(session.history, {
            ...session.latest,
            time: eventTime(event),
        });
        const offset = {
            x: session.latest.x - session.origin.x,
            y: session.latest.y - session.origin.y,
        };
        applyCardPosition(session.card, offset);

        if (!session.activated && Math.hypot(offset.x, offset.y) >= DRAG_START_THRESHOLD) {
            session.activated = true;
        }

        const targetRect = session.target.getBoundingClientRect();
        const overValidTarget = session.activated && isPointInsideExpandedRect(
            event.clientX,
            event.clientY,
            targetRect,
        );
        setDropTarget(overValidTarget ? session.nextState : null);
        event.preventDefault();
    }, []);

    const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const session = dragRef.current;
        if (!session || event.pointerId !== session.pointerId || session.committed) return;
        session.committed = true;
        session.latest = { x: event.clientX, y: event.clientY };
        session.history = appendMotionSample(session.history, {
            ...session.latest,
            time: eventTime(event),
        });

        const offset = {
            x: session.latest.x - session.origin.x,
            y: session.latest.y - session.origin.y,
        };
        const velocity = estimateMotionVelocity(session.history);
        const targetRect = session.target.getBoundingClientRect();
        const maxProjectionX = Math.max(
            targetRect.width,
            session.cardRect.width,
            Math.abs((targetRect.left + targetRect.right - session.cardRect.left - session.cardRect.right) / 2),
            1,
        );
        const maxProjectionY = Math.max(targetRect.height, session.cardRect.height, 1);
        const projectedPoint = reducedMotion
            ? session.latest
            : {
                x: session.latest.x + clamp(projectMomentum(velocity.x), -maxProjectionX, maxProjectionX),
                y: session.latest.y + clamp(projectMomentum(velocity.y), -maxProjectionY, maxProjectionY),
            };
        const validDrop = session.activated
            && isPointInsideExpandedRect(session.latest.x, session.latest.y, targetRect);

        dragRef.current = null;
        safelyReleasePointer(session.handle, session.pointerId);
        setDraggingId(null);
        setDropTarget(null);

        if (!validDrop) {
            animateCardTo(
                session.pedido.id,
                session.card,
                session.snapshot,
                offset,
                { x: 0, y: 0 },
                { x: velocity.x, y: velocity.y },
            );
            say('Soltá el pedido en la siguiente columna para moverlo.');
            return;
        }

        const cardCenter = {
            x: (session.cardRect.left + session.cardRect.right) / 2,
            y: (session.cardRect.top + session.cardRect.bottom) / 2,
        };
        const grabOffset = {
            x: session.origin.x - cardCenter.x,
            y: session.origin.y - cardCenter.y,
        };
        const projectedCardCenter = {
            x: projectedPoint.x - grabOffset.x,
            y: projectedPoint.y - grabOffset.y,
        };
        const destinationCenter = {
            x: targetRect.width >= session.cardRect.width
                ? clamp(
                    projectedCardCenter.x,
                    targetRect.left + session.cardRect.width / 2,
                    targetRect.right - session.cardRect.width / 2,
                )
                : (targetRect.left + targetRect.right) / 2,
            y: targetRect.height >= session.cardRect.height
                ? clamp(
                    projectedCardCenter.y,
                    targetRect.top + session.cardRect.height / 2,
                    targetRect.bottom - session.cardRect.height / 2,
                )
                : (targetRect.top + targetRect.bottom) / 2,
        };
        const destination = {
            x: destinationCenter.x - cardCenter.x,
            y: destinationCenter.y - cardCenter.y,
        };
        animateCardTo(
            session.pedido.id,
            session.card,
            session.snapshot,
            offset,
            destination,
            { x: velocity.x, y: velocity.y },
        );

        void performMove(session.pedido, session.nextState).then((moved) => {
            if (!moved) snapAnimationBack(session.pedido.id, { x: -velocity.x, y: -velocity.y });
        });
    }, [animateCardTo, performMove, reducedMotion, say, snapAnimationBack]);

    const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        finishCancelledDrag(true, 'Movimiento cancelado.');
    }, [finishCancelledDrag]);

    const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        finishCancelledDrag(false, 'Movimiento cancelado.');
    }, [finishCancelledDrag]);

    return {
        draggingId,
        dropTarget,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel,
        handleLostPointerCapture,
    };
};
