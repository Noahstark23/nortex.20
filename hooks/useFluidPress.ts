import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    MouseEvent as ReactMouseEvent,
    MouseEventHandler,
    PointerEvent as ReactPointerEvent,
    PointerEventHandler,
    RefCallback,
} from 'react';
import {
    animateSpring,
    appendMotionSample,
    estimateMotionVelocity,
    FLUID_MOTION_DEFAULTS,
    isPointInsideExpandedRect,
    prefersReducedMotion,
    readPresentationOpacity,
    readPresentationScale,
} from '../utils/fluidMotion';
import type {
    MotionSample,
    MotionVelocity,
    SpringAnimationController,
} from '../utils/fluidMotion';

export interface FluidPressDetail {
    pointerId: number;
    pointerType: string;
    point: { x: number; y: number };
    velocity: MotionVelocity;
    moved: boolean;
    inside: boolean;
    cancelled: boolean;
}

export interface UseFluidPressOptions {
    disabled?: boolean;
    pressedScale?: number;
    pressedOpacity?: number;
    hysteresis?: number;
    dampingRatio?: number;
    response?: number;
    /** Fuerza el modo; si se omite, sigue prefers-reduced-motion en vivo. */
    reducedMotion?: boolean;
    onPressChange?: (pressed: boolean, detail: FluidPressDetail) => void;
    /** Entrega velocidad del puntero para un drag/flick que quiera heredarla. */
    onRelease?: (detail: FluidPressDetail) => void;
}

export interface FluidPressBinding<T extends HTMLElement> {
    ref: RefCallback<T>;
    onPointerDown: PointerEventHandler<T>;
    onPointerMove: PointerEventHandler<T>;
    onPointerUp: PointerEventHandler<T>;
    onPointerCancel: PointerEventHandler<T>;
    onLostPointerCapture: PointerEventHandler<T>;
    onClickCapture: MouseEventHandler<T>;
}

export interface FluidPressResult<T extends HTMLElement> {
    /** Uso: `<button {...bind} onClick={accion}>` */
    bind: FluidPressBinding<T>;
    cancel: () => void;
    isPressed: () => boolean;
}

interface StyleSnapshot {
    inlineScale: string;
    inlineOpacity: string;
    inlineWillChange: string;
    baseScale: number;
    baseOpacity: number;
}

interface GestureSession {
    pointerId: number;
    pointerType: string;
    originX: number;
    originY: number;
    x: number;
    y: number;
    inside: boolean;
    moved: boolean;
    history: MotionSample[];
}

interface PendingClickSuppression {
    pointerId: number;
    expiresAt: number;
}

const PRESS_SCALE = 0.97;
const PRESS_OPACITY = 0.94;

const eventTime = (event: ReactPointerEvent<HTMLElement>): number =>
    Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();

const assignStyleProperty = (element: HTMLElement, property: string, value: string) => {
    if (value) element.style.setProperty(property, value);
    else element.style.removeProperty(property);
};

const safelyReleasePointer = (element: HTMLElement, pointerId: number) => {
    try {
        if (typeof element.releasePointerCapture === 'function'
            && (typeof element.hasPointerCapture !== 'function' || element.hasPointerCapture(pointerId))) {
            element.releasePointerCapture(pointerId);
        }
    } catch {
        // El nodo puede haber salido del documento entre pointerup y cleanup.
    }
};

const detailFromSession = (session: GestureSession, cancelled: boolean): FluidPressDetail => ({
    pointerId: session.pointerId,
    pointerType: session.pointerType,
    point: { x: session.x, y: session.y },
    velocity: estimateMotionVelocity(session.history),
    moved: session.moved,
    inside: session.inside,
    cancelled,
});

export const useFluidPress = <T extends HTMLElement = HTMLElement>(
    options: UseFluidPressOptions = {},
): FluidPressResult<T> => {
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const [systemReducedMotion, setSystemReducedMotion] = useState(prefersReducedMotion);
    const reducedMotion = options.reducedMotion ?? systemReducedMotion;
    const reducedMotionRef = useRef(reducedMotion);
    reducedMotionRef.current = reducedMotion;

    const elementRef = useRef<T | null>(null);
    const sessionRef = useRef<GestureSession | null>(null);
    const snapshotRef = useRef<StyleSnapshot | null>(null);
    const scaleAnimationRef = useRef<SpringAnimationController | null>(null);
    const opacityAnimationRef = useRef<SpringAnimationController | null>(null);
    const scaleTokenRef = useRef<symbol | null>(null);
    const opacityTokenRef = useRef<symbol | null>(null);
    const settlingRef = useRef(false);
    const pendingClickSuppressionRef = useRef<PendingClickSuppression | null>(null);

    const restoreSnapshot = useCallback(() => {
        const element = elementRef.current;
        const snapshot = snapshotRef.current;
        if (!element || !snapshot) return;

        assignStyleProperty(element, 'scale', snapshot.inlineScale);
        assignStyleProperty(element, 'opacity', snapshot.inlineOpacity);
        assignStyleProperty(element, 'will-change', snapshot.inlineWillChange);
        snapshotRef.current = null;
    }, []);

    const restoreIfIdle = useCallback(() => {
        if (settlingRef.current || sessionRef.current
            || scaleAnimationRef.current || opacityAnimationRef.current) return;
        restoreSnapshot();
    }, [restoreSnapshot]);

    const cancelScaleAnimation = useCallback(() => {
        scaleTokenRef.current = null;
        scaleAnimationRef.current?.cancel();
        scaleAnimationRef.current = null;
    }, []);

    const cancelOpacityAnimation = useCallback(() => {
        opacityTokenRef.current = null;
        opacityAnimationRef.current?.cancel();
        opacityAnimationRef.current = null;
    }, []);

    const ensureSnapshot = useCallback((element: T): StyleSnapshot => {
        if (snapshotRef.current) return snapshotRef.current;

        const snapshot: StyleSnapshot = {
            inlineScale: element.style.getPropertyValue('scale'),
            inlineOpacity: element.style.getPropertyValue('opacity'),
            inlineWillChange: element.style.getPropertyValue('will-change'),
            baseScale: readPresentationScale(element, 1),
            baseOpacity: readPresentationOpacity(element, 1),
        };
        snapshotRef.current = snapshot;
        return snapshot;
    }, []);

    const animateScaleTo = useCallback((target: number) => {
        const element = elementRef.current;
        const snapshot = snapshotRef.current;
        if (!element || !snapshot) return;

        const current = readPresentationScale(element, snapshot.baseScale);
        const inheritedVelocity = scaleAnimationRef.current?.getVelocity() ?? 0;
        cancelScaleAnimation();

        if (reducedMotionRef.current) {
            assignStyleProperty(element, 'scale', snapshot.inlineScale);
            restoreIfIdle();
            return;
        }

        if (Math.abs(current - target) <= FLUID_MOTION_DEFAULTS.restDelta) {
            element.style.setProperty('scale', String(target));
            restoreIfIdle();
            return;
        }

        const token = Symbol('fluid-scale');
        scaleTokenRef.current = token;
        let completedSynchronously = false;
        const animation = animateSpring({
            from: current,
            to: target,
            velocity: inheritedVelocity,
            dampingRatio: optionsRef.current.dampingRatio ?? FLUID_MOTION_DEFAULTS.dampingRatio,
            response: optionsRef.current.response ?? FLUID_MOTION_DEFAULTS.response,
            onUpdate: (value) => {
                if (scaleTokenRef.current === token && elementRef.current === element) {
                    element.style.setProperty('scale', String(value));
                }
            },
            onComplete: () => {
                completedSynchronously = true;
                if (scaleTokenRef.current !== token) return;
                scaleTokenRef.current = null;
                scaleAnimationRef.current = null;
                restoreIfIdle();
            },
        });

        scaleAnimationRef.current = completedSynchronously ? null : animation;
    }, [cancelScaleAnimation, restoreIfIdle]);

    const animateOpacityTo = useCallback((target: number, immediateFeedback = false) => {
        const element = elementRef.current;
        const snapshot = snapshotRef.current;
        if (!element || !snapshot) return;

        let current = readPresentationOpacity(element, snapshot.baseOpacity);
        let inheritedVelocity = opacityAnimationRef.current?.getVelocity() ?? 0;
        const wasAnimating = opacityAnimationRef.current !== null;
        cancelOpacityAnimation();

        // El primer press debe verse en el mismo evento. Aplicamos solo un
        // pequeno primer paso desde la presentacion; el resto permanece en rAF.
        // En una re-interrupcion no hay nudge: conserva valor y velocidad exactos.
        if (immediateFeedback && !wasAnimating
            && Math.abs(current - target) > FLUID_MOTION_DEFAULTS.restDelta) {
            const previous = current;
            current += (target - current) * 0.18;
            inheritedVelocity = (current - previous) * 60;
            element.style.setProperty('opacity', String(current));
        }

        if (Math.abs(current - target) <= FLUID_MOTION_DEFAULTS.restDelta) {
            element.style.setProperty('opacity', String(target));
            restoreIfIdle();
            return;
        }

        const token = Symbol('fluid-opacity');
        opacityTokenRef.current = token;
        let completedSynchronously = false;
        const animation = animateSpring({
            from: current,
            to: target,
            velocity: inheritedVelocity,
            dampingRatio: FLUID_MOTION_DEFAULTS.dampingRatio,
            response: reducedMotionRef.current ? 0.2 : optionsRef.current.response ?? FLUID_MOTION_DEFAULTS.response,
            onUpdate: (value) => {
                if (opacityTokenRef.current === token && elementRef.current === element) {
                    element.style.setProperty('opacity', String(value));
                }
            },
            onComplete: () => {
                completedSynchronously = true;
                if (opacityTokenRef.current !== token) return;
                opacityTokenRef.current = null;
                opacityAnimationRef.current = null;
                restoreIfIdle();
            },
        });

        opacityAnimationRef.current = completedSynchronously ? null : animation;
    }, [cancelOpacityAnimation, restoreIfIdle]);

    const applyPressedState = useCallback((pressed: boolean) => {
        const element = elementRef.current;
        const snapshot = snapshotRef.current;
        if (!element || !snapshot) return;

        // La opacidad da feedback en el mismo pointerdown y despues continua
        // desde la presentacion. El scale tambien parte del valor presentado.
        const pressedOpacity = optionsRef.current.pressedOpacity ?? PRESS_OPACITY;
        animateOpacityTo(
            pressed ? snapshot.baseOpacity * pressedOpacity : snapshot.baseOpacity,
            pressed,
        );

        const pressedScale = optionsRef.current.pressedScale ?? PRESS_SCALE;
        animateScaleTo(pressed ? snapshot.baseScale * pressedScale : snapshot.baseScale);
    }, [animateOpacityTo, animateScaleTo]);

    const settle = useCallback(() => {
        const snapshot = snapshotRef.current;
        if (!snapshot) return;

        settlingRef.current = true;
        animateScaleTo(snapshot.baseScale);
        animateOpacityTo(snapshot.baseOpacity);
        settlingRef.current = false;
        restoreIfIdle();
    }, [animateOpacityTo, animateScaleTo, restoreIfIdle]);

    const endSession = useCallback((cancelled: boolean, notify = true) => {
        const session = sessionRef.current;
        const element = elementRef.current;
        if (!session) return;

        sessionRef.current = null;
        if (element) safelyReleasePointer(element, session.pointerId);

        const detail = detailFromSession(session, cancelled);
        if (notify) {
            if (session.inside) optionsRef.current.onPressChange?.(false, detail);
            optionsRef.current.onRelease?.(detail);
        }
        settle();
    }, [settle]);

    const cancel = useCallback(() => {
        pendingClickSuppressionRef.current = null;
        endSession(true);
        cancelScaleAnimation();
        cancelOpacityAnimation();
        restoreSnapshot();
    }, [cancelOpacityAnimation, cancelScaleAnimation, endSession, restoreSnapshot]);

    const ref = useCallback<RefCallback<T>>((element) => {
        if (elementRef.current && elementRef.current !== element) {
            cancelScaleAnimation();
            cancelOpacityAnimation();
            restoreSnapshot();
        }
        elementRef.current = element;
    }, [cancelOpacityAnimation, cancelScaleAnimation, restoreSnapshot]);

    const onPointerDown = useCallback<PointerEventHandler<T>>((event) => {
        const currentOptions = optionsRef.current;
        // Una nueva secuencia de puntero nunca puede heredar la cancelacion de
        // click de la secuencia anterior.
        pendingClickSuppressionRef.current = null;
        if (currentOptions.disabled || event.isPrimary === false
            || (event.pointerType === 'mouse' && event.button !== 0)
            || sessionRef.current) return;

        const element = event.currentTarget;
        elementRef.current = element;
        ensureSnapshot(element);

        // Leer antes de cancelar preserva el valor de presentacion de una
        // animacion interrumpida; animateScaleTo heredara tambien su velocidad.
        readPresentationScale(element, snapshotRef.current?.baseScale ?? 1);

        try {
            element.setPointerCapture?.(event.pointerId);
        } catch {
            // Algunos WebViews rechazan capture si el puntero ya termino.
        }

        const sample = { x: event.clientX, y: event.clientY, time: eventTime(event) };
        sessionRef.current = {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            originX: event.clientX,
            originY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            inside: true,
            moved: false,
            history: [sample],
        };

        const previousWillChange = snapshotRef.current?.inlineWillChange.trim();
        element.style.setProperty(
            'will-change',
            [previousWillChange, 'transform', 'opacity'].filter(Boolean).join(', '),
        );
        applyPressedState(true);
        currentOptions.onPressChange?.(true, detailFromSession(sessionRef.current, false));
    }, [applyPressedState, ensureSnapshot]);

    const onPointerMove = useCallback<PointerEventHandler<T>>((event) => {
        const session = sessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;

        session.x = event.clientX;
        session.y = event.clientY;
        session.history = appendMotionSample(session.history, {
            x: event.clientX,
            y: event.clientY,
            time: eventTime(event),
        });

        const threshold = optionsRef.current.hysteresis ?? FLUID_MOTION_DEFAULTS.hysteresis;
        if (!session.moved && Math.hypot(event.clientX - session.originX, event.clientY - session.originY) >= threshold) {
            session.moved = true;
        }

        const inside = isPointInsideExpandedRect(
            event.clientX,
            event.clientY,
            event.currentTarget.getBoundingClientRect(),
            threshold,
        );
        if (inside === session.inside) return;

        session.inside = inside;
        applyPressedState(inside);
        optionsRef.current.onPressChange?.(inside, detailFromSession(session, false));
    }, [applyPressedState]);

    const onPointerUp = useCallback<PointerEventHandler<T>>((event) => {
        const session = sessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;
        session.x = event.clientX;
        session.y = event.clientY;
        session.history = appendMotionSample(session.history, {
            x: event.clientX,
            y: event.clientY,
            time: eventTime(event),
        });
        pendingClickSuppressionRef.current = session.inside
            ? null
            : { pointerId: session.pointerId, expiresAt: eventTime(event) + 750 };
        endSession(false);
    }, [endSession]);

    const onPointerCancel = useCallback<PointerEventHandler<T>>((event) => {
        if (sessionRef.current?.pointerId === event.pointerId) {
            pendingClickSuppressionRef.current = null;
            endSession(true);
        }
    }, [endSession]);

    const onLostPointerCapture = useCallback<PointerEventHandler<T>>((event) => {
        if (sessionRef.current?.pointerId === event.pointerId) {
            pendingClickSuppressionRef.current = null;
            endSession(true);
        }
    }, [endSession]);

    const onClickCapture = useCallback<MouseEventHandler<T>>((event: ReactMouseEvent<T>) => {
        const pending = pendingClickSuppressionRef.current;
        if (!pending) return;

        if (event.timeStamp > pending.expiresAt) {
            pendingClickSuppressionRef.current = null;
            return;
        }

        // detail=0 identifica activacion por teclado o element.click(): nunca se
        // consume. La marca queda disponible para el click de puntero resultante.
        if (event.detail === 0) return;

        const nativePointerId = (event.nativeEvent as MouseEvent & Partial<PointerEvent>).pointerId;
        if (typeof nativePointerId === 'number' && nativePointerId > 0
            && nativePointerId !== pending.pointerId) return;

        pendingClickSuppressionRef.current = null;
        event.preventDefault();
        event.stopPropagation();
    }, []);

    useEffect(() => {
        if (options.reducedMotion !== undefined || typeof globalThis.matchMedia !== 'function') return;

        const query = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setSystemReducedMotion(query.matches);
        update();
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
    }, [options.reducedMotion]);

    useEffect(() => {
        const element = elementRef.current;
        const snapshot = snapshotRef.current;
        if (reducedMotion) {
            cancelScaleAnimation();
            if (element && snapshot) assignStyleProperty(element, 'scale', snapshot.inlineScale);
        } else if (snapshot && sessionRef.current) {
            const pressedScale = optionsRef.current.pressedScale ?? PRESS_SCALE;
            animateScaleTo(sessionRef.current.inside ? snapshot.baseScale * pressedScale : snapshot.baseScale);
        }
        restoreIfIdle();
    }, [animateScaleTo, cancelScaleAnimation, reducedMotion, restoreIfIdle]);

    useEffect(() => {
        if (options.disabled && sessionRef.current) endSession(true);
    }, [endSession, options.disabled]);

    useEffect(() => () => {
        const session = sessionRef.current;
        if (session && elementRef.current) safelyReleasePointer(elementRef.current, session.pointerId);
        sessionRef.current = null;
        pendingClickSuppressionRef.current = null;
        cancelScaleAnimation();
        cancelOpacityAnimation();
        restoreSnapshot();
        elementRef.current = null;
    }, [cancelOpacityAnimation, cancelScaleAnimation, restoreSnapshot]);

    const bind = useMemo<FluidPressBinding<T>>(() => ({
        ref,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onLostPointerCapture,
        onClickCapture,
    }), [onClickCapture, onLostPointerCapture, onPointerCancel, onPointerDown, onPointerMove, onPointerUp, ref]);

    return {
        bind,
        cancel,
        isPressed: () => sessionRef.current?.inside === true,
    };
};

export default useFluidPress;
