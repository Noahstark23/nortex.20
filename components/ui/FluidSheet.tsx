import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import type { PointerEventHandler, ReactNode } from 'react';
import {
    animateSpring,
    appendMotionSample,
    estimateMotionVelocity,
    FLUID_MOTION_DEFAULTS,
    prefersReducedMotion,
    projectMomentum,
    rubberband,
} from '../../utils/fluidMotion';
import type {
    MotionSample,
    SpringAnimationController,
} from '../../utils/fluidMotion';

export interface FluidSheetProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    labelledBy?: string;
    ariaLabel?: string;
    className?: string;
    panelClassName?: string;
    size?: 'content' | 'full';
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    dragToDismiss?: boolean;
    /** Fuerza el modo para pruebas o superficies con una política propia. */
    reducedMotion?: boolean;
    dismissThreshold?: number;
}

interface DragSession {
    pointerId: number;
    originX: number;
    originY: number;
    startOffset: number;
    committed: boolean;
    rejected: boolean;
    history: MotionSample[];
}

const FOCUSABLE_SELECTOR = [
    '[data-fluid-sheet-initial-focus]',
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

let bodyLockDepth = 0;
let bodyOverflowBeforeLock = '';

const lockBodyScroll = (): (() => void) => {
    if (typeof document === 'undefined') return () => undefined;

    if (bodyLockDepth === 0) {
        bodyOverflowBeforeLock = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    bodyLockDepth += 1;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        bodyLockDepth = Math.max(0, bodyLockDepth - 1);
        if (bodyLockDepth === 0) {
            document.body.style.overflow = bodyOverflowBeforeLock;
        }
    };
};

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));

const eventTime = (event: React.PointerEvent<HTMLElement>): number =>
    Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();

const requestFrame = (callback: FrameRequestCallback): number => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        return globalThis.requestAnimationFrame(callback);
    }
    return globalThis.setTimeout(() => callback(performance.now()), 1000 / 60) as unknown as number;
};

const cancelFrame = (handle: number | null) => {
    if (handle === null) return;
    if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(handle);
        return;
    }
    globalThis.clearTimeout(handle);
};

const safelyReleasePointer = (element: HTMLElement, pointerId: number) => {
    try {
        if (typeof element.releasePointerCapture === 'function'
            && (typeof element.hasPointerCapture !== 'function' || element.hasPointerCapture(pointerId))) {
            element.releasePointerCapture(pointerId);
        }
    } catch {
        // El WebView puede perder el nodo o la captura al mismo tiempo que cierra.
    }
};

/**
 * Hoja visual sin conocimiento de rutas, caja, dinero ni inventario.
 *
 * El valor presentado vive fuera de React para que un drag o un cambio de
 * destino pueda interrumpir el resorte sin saltos. Los consumidores conservan
 * todo el estado de negocio y solo controlan `open`/`onClose`.
 */
export const FluidSheet: React.FC<FluidSheetProps> = ({
    open,
    onClose,
    children,
    labelledBy,
    ariaLabel,
    className = '',
    panelClassName = '',
    size = 'content',
    closeOnBackdrop = true,
    closeOnEscape = true,
    dragToDismiss = true,
    reducedMotion,
    dismissThreshold = 0.42,
}) => {
    const [present, setPresent] = useState(open);
    const [systemReducedMotion, setSystemReducedMotion] = useState(prefersReducedMotion);
    const motionReduced = reducedMotion ?? systemReducedMotion;

    const rootRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const animationRef = useRef<SpringAnimationController | null>(null);
    const animationTokenRef = useRef<symbol | null>(null);
    const entranceFrameRef = useRef<number | null>(null);
    const focusFrameRef = useRef<number | null>(null);
    const offsetRef = useRef(0);
    const extentRef = useRef(1);
    const targetRef = useRef(0);
    const dragRef = useRef<DragSession | null>(null);
    const hasPresentedRef = useRef(false);
    const openRef = useRef(open);
    const onCloseRef = useRef(onClose);
    const closeOnEscapeRef = useRef(closeOnEscape);
    const reducedMotionRef = useRef(motionReduced);

    openRef.current = open;
    onCloseRef.current = onClose;
    closeOnEscapeRef.current = closeOnEscape;
    reducedMotionRef.current = motionReduced;

    const measureExtent = useCallback((): number => {
        const panel = panelRef.current;
        const measured = panel?.getBoundingClientRect().height
            || panel?.offsetHeight
            || (typeof window !== 'undefined' ? window.innerHeight : 0)
            || 1;
        extentRef.current = Math.max(1, measured);
        return extentRef.current;
    }, []);

    const applyOffset = useCallback((nextOffset: number) => {
        const safeOffset = Number.isFinite(nextOffset) ? nextOffset : 0;
        offsetRef.current = safeOffset;

        if (panelRef.current) {
            panelRef.current.style.transform = `translate3d(0, ${safeOffset}px, 0)`;
        }
        if (backdropRef.current) {
            const progress = clamp(1 - Math.max(0, safeOffset) / extentRef.current, 0, 1);
            backdropRef.current.style.opacity = String(progress);
        }
    }, []);

    const cancelEntranceFrame = useCallback(() => {
        cancelFrame(entranceFrameRef.current);
        entranceFrameRef.current = null;
    }, []);

    const cancelAnimation = useCallback(() => {
        animationTokenRef.current = null;
        animationRef.current?.cancel();
        animationRef.current = null;
    }, []);

    const settleTo = useCallback((target: 'open' | 'closed', velocity?: number) => {
        const panel = panelRef.current;
        if (!panel) return;

        const extent = measureExtent();
        const targetOffset = target === 'closed' ? extent : 0;
        const runningAnimation = animationRef.current;

        if (runningAnimation?.isRunning()
            && targetRef.current === targetOffset
            && !reducedMotionRef.current) {
            if (typeof velocity === 'number' && Number.isFinite(velocity)) {
                runningAnimation.retarget(targetOffset, velocity);
            }
            return;
        }

        const currentOffset = runningAnimation?.getValue() ?? offsetRef.current;
        const inheritedVelocity = typeof velocity === 'number' && Number.isFinite(velocity)
            ? velocity
            : runningAnimation?.getVelocity() ?? 0;
        cancelAnimation();

        targetRef.current = targetOffset;
        const token = Symbol('fluid-sheet');
        animationTokenRef.current = token;
        let completedSynchronously = false;
        const animation = animateSpring({
            from: currentOffset,
            to: targetOffset,
            velocity: inheritedVelocity,
            dampingRatio: FLUID_MOTION_DEFAULTS.dampingRatio,
            response: 0.34,
            restDelta: 0.75,
            restSpeed: 12,
            reducedMotion: reducedMotionRef.current,
            onUpdate: (value) => {
                if (animationTokenRef.current === token) applyOffset(value);
            },
            onComplete: () => {
                completedSynchronously = true;
                if (animationTokenRef.current !== token) return;
                animationTokenRef.current = null;
                animationRef.current = null;
                if (target === 'closed' && !openRef.current) {
                    hasPresentedRef.current = false;
                    setPresent(false);
                }
            },
        });

        animationRef.current = completedSynchronously ? null : animation;
    }, [applyOffset, cancelAnimation, measureExtent]);

    useEffect(() => {
        if (open) setPresent(true);
    }, [open]);

    useLayoutEffect(() => {
        if (!present) return;

        if (!hasPresentedRef.current) {
            hasPresentedRef.current = true;
            const extent = measureExtent();
            if (open && reducedMotionRef.current) {
                targetRef.current = 0;
                applyOffset(0);
                return;
            }
            applyOffset(extent);
            if (open) {
                cancelEntranceFrame();
                entranceFrameRef.current = requestFrame(() => {
                    entranceFrameRef.current = null;
                    if (openRef.current) settleTo('open');
                });
            }
            return;
        }

        cancelEntranceFrame();
        settleTo(open ? 'open' : 'closed');
    }, [applyOffset, cancelEntranceFrame, measureExtent, motionReduced, open, present, settleTo]);

    useEffect(() => {
        if (!present || typeof window === 'undefined') return;

        const updateExtent = () => {
            const previousExtent = extentRef.current;
            const nextExtent = measureExtent();
            if (Math.abs(previousExtent - nextExtent) < 0.5) return;

            const animation = animationRef.current;
            if (animation?.isRunning() && targetRef.current > 0) {
                targetRef.current = nextExtent;
                animation.retarget(nextExtent);
            }
            // Recalcula el progreso del backdrop incluso si la hoja está abierta
            // o bajo el dedo cuando cambia orientación/viewport dinámico.
            applyOffset(offsetRef.current);
        };

        window.addEventListener('resize', updateExtent);
        const resizeObserver = typeof ResizeObserver === 'function' && panelRef.current
            ? new ResizeObserver(updateExtent)
            : null;
        if (resizeObserver && panelRef.current) resizeObserver.observe(panelRef.current);

        return () => {
            window.removeEventListener('resize', updateExtent);
            resizeObserver?.disconnect();
        };
    }, [applyOffset, measureExtent, present]);

    useEffect(() => {
        if (reducedMotion !== undefined || typeof globalThis.matchMedia !== 'function') return;

        const query = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setSystemReducedMotion(query.matches);
        update();
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
    }, [reducedMotion]);

    useEffect(() => {
        if (!present || !open || typeof document === 'undefined') return;

        const releaseBodyLock = lockBodyScroll();
        if (!previousFocusRef.current && document.activeElement instanceof HTMLElement) {
            previousFocusRef.current = document.activeElement;
        }

        focusFrameRef.current = requestFrame(() => {
            focusFrameRef.current = null;
            const preferred = panelRef.current?.querySelector<HTMLElement>('[data-fluid-sheet-initial-focus]');
            const first = preferred ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
            (first ?? panelRef.current)?.focus({ preventScroll: true });
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && closeOnEscapeRef.current) {
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !panelRef.current) return;

            const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
                .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
            if (focusable.length === 0) {
                event.preventDefault();
                panelRef.current.focus({ preventScroll: true });
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            cancelFrame(focusFrameRef.current);
            focusFrameRef.current = null;
            releaseBodyLock();
            const previousFocus = previousFocusRef.current;
            previousFocusRef.current = null;
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
    }, [open, present]);

    const finishDrag = useCallback((element: HTMLElement, cancelled: boolean) => {
        const session = dragRef.current;
        if (!session) return;
        dragRef.current = null;
        safelyReleasePointer(element, session.pointerId);

        if (cancelled || session.rejected || !session.committed) {
            settleTo('open');
            return;
        }

        const velocity = estimateMotionVelocity(session.history).y;
        const projectedOffset = offsetRef.current + projectMomentum(velocity);
        const threshold = extentRef.current * clamp(dismissThreshold, 0.2, 0.8);
        const shouldClose = velocity > 650 || projectedOffset > threshold;

        if (shouldClose) {
            settleTo('closed', velocity);
            onCloseRef.current();
        } else {
            settleTo('open', velocity);
        }
    }, [dismissThreshold, settleTo]);

    const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
        if (!dragToDismiss || !openRef.current || event.isPrimary === false
            || (event.pointerType === 'mouse' && event.button !== 0)
            || dragRef.current) return;

        cancelEntranceFrame();
        const currentOffset = animationRef.current?.getValue() ?? offsetRef.current;
        cancelAnimation();

        try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
            // Algunos WebViews terminan la secuencia antes de conceder captura.
        }

        dragRef.current = {
            pointerId: event.pointerId,
            originX: event.clientX,
            originY: event.clientY,
            startOffset: currentOffset,
            committed: false,
            rejected: false,
            history: [{ x: event.clientX, y: event.clientY, time: eventTime(event) }],
        };
    }, [cancelAnimation, cancelEntranceFrame, dragToDismiss]);

    const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
        const session = dragRef.current;
        if (!session || session.pointerId !== event.pointerId) return;

        session.history = appendMotionSample(session.history, {
            x: event.clientX,
            y: event.clientY,
            time: eventTime(event),
        });
        const deltaX = event.clientX - session.originX;
        const deltaY = event.clientY - session.originY;
        const hysteresis = FLUID_MOTION_DEFAULTS.hysteresis;

        if (!session.committed && !session.rejected) {
            if (Math.hypot(deltaX, deltaY) < hysteresis) return;
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                session.rejected = true;
                return;
            }
            session.committed = true;
        }
        if (!session.committed) return;

        event.preventDefault();
        const committedDelta = deltaY - Math.sign(deltaY || 1) * hysteresis;
        const rawOffset = session.startOffset + committedDelta;
        const extent = extentRef.current;
        const presentedOffset = rawOffset < 0
            ? rubberband(rawOffset, extent)
            : rawOffset > extent
                ? extent + rubberband(rawOffset - extent, extent)
                : rawOffset;
        applyOffset(presentedOffset);
    }, [applyOffset]);

    const onPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
        const session = dragRef.current;
        if (!session || session.pointerId !== event.pointerId) return;
        session.history = appendMotionSample(session.history, {
            x: event.clientX,
            y: event.clientY,
            time: eventTime(event),
        });
        finishDrag(event.currentTarget, false);
    }, [finishDrag]);

    const onPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
            finishDrag(event.currentTarget, true);
        }
    }, [finishDrag]);

    const onLostPointerCapture = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
            finishDrag(event.currentTarget, true);
        }
    }, [finishDrag]);

    useEffect(() => () => {
        cancelEntranceFrame();
        cancelFrame(focusFrameRef.current);
        focusFrameRef.current = null;
        cancelAnimation();
        dragRef.current = null;
    }, [cancelAnimation, cancelEntranceFrame]);

    if (!present) return null;

    return (
        <div
            ref={rootRef}
            className={`nx-fluid-sheet-root ${className}`}
            data-fluid-sheet-root=""
            aria-hidden={!open}
            onClickCapture={!open ? (event) => {
                // Mientras el resorte termina de salir, la capa sigue visible y
                // debe absorber el tap; ningún control del fondo puede activarse.
                event.preventDefault();
                event.stopPropagation();
            } : undefined}
        >
            <div
                ref={backdropRef}
                className="nx-fluid-sheet-backdrop"
                data-fluid-sheet-backdrop=""
                aria-hidden="true"
                onClick={closeOnBackdrop && open ? () => onCloseRef.current() : undefined}
            />
            <div
                ref={panelRef}
                className={`nx-fluid-sheet-panel ${panelClassName}`}
                data-fluid-sheet-panel=""
                data-size={size}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-label={labelledBy ? undefined : ariaLabel ?? 'Panel'}
                tabIndex={-1}
            >
                <div
                    className="nx-fluid-sheet-handle"
                    data-fluid-sheet-handle=""
                    data-drag-disabled={dragToDismiss ? undefined : ''}
                    aria-hidden="true"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    onLostPointerCapture={onLostPointerCapture}
                >
                    <span aria-hidden="true" />
                </div>
                {children}
            </div>
        </div>
    );
};

export default FluidSheet;
