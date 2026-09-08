/**
 * Primitivas de movimiento fisico para interfaces Nortex.
 *
 * Mantiene la animacion fuera de React: cada cuadro se aplica por
 * requestAnimationFrame y los consumidores deciden si escriben `transform` u
 * `opacity`. No usa transiciones CSS ni impone comportamiento de negocio.
 */

export interface FluidFrameScheduler {
    request(callback: FrameRequestCallback): unknown;
    cancel(handle: unknown): void;
    now(): number;
}

export interface SpringAnimationOptions {
    from: number;
    to: number;
    /** Velocidad inicial en unidades por segundo. */
    velocity?: number;
    /** 1 = amortiguamiento critico, sin rebote. */
    dampingRatio?: number;
    /** Respuesta perceptual del resorte en segundos; no es una duracion fija. */
    response?: number;
    restDelta?: number;
    restSpeed?: number;
    reducedMotion?: boolean;
    scheduler?: FluidFrameScheduler;
    signal?: AbortSignal;
    onUpdate(value: number, velocity: number): void;
    onComplete?: (value: number) => void;
}

export interface SpringAnimationController {
    cancel(): void;
    /** Cambia el destino sin perder la velocidad actual. */
    retarget(target: number, velocity?: number): void;
    getValue(): number;
    getVelocity(): number;
    getTarget(): number;
    isRunning(): boolean;
}

export interface MotionSample {
    x: number;
    y: number;
    /** Marca monotona en milisegundos. */
    time: number;
}

export interface MotionVelocity {
    x: number;
    y: number;
    speed: number;
}

export const FLUID_MOTION_DEFAULTS = Object.freeze({
    dampingRatio: 1,
    response: 0.36,
    restDelta: 0.001,
    restSpeed: 0.01,
    hysteresis: 10,
    historySize: 6,
    historyWindowMs: 120,
});

const finiteOr = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const defaultScheduler = (): FluidFrameScheduler => ({
    request(callback) {
        if (typeof globalThis.requestAnimationFrame === 'function') {
            return globalThis.requestAnimationFrame(callback);
        }

        return globalThis.setTimeout(() => callback(this.now()), 1000 / 60);
    },
    cancel(handle) {
        if (typeof globalThis.cancelAnimationFrame === 'function' && typeof handle === 'number') {
            globalThis.cancelAnimationFrame(handle);
            return;
        }

        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    now() {
        return typeof globalThis.performance?.now === 'function'
            ? globalThis.performance.now()
            : Date.now();
    },
});

/**
 * Resorte numerico interrumpible. `retarget` conserva velocidad; `cancel` es
 * idempotente. La conversion response/damping sigue el modelo de segundo orden:
 * omega = 2PI / response.
 */
export const animateSpring = (options: SpringAnimationOptions): SpringAnimationController => {
    const scheduler = options.scheduler ?? defaultScheduler();
    const dampingRatio = Math.max(0.01, finiteOr(options.dampingRatio, FLUID_MOTION_DEFAULTS.dampingRatio));
    const response = Math.max(0.1, finiteOr(options.response, FLUID_MOTION_DEFAULTS.response));
    const restDelta = Math.max(0, finiteOr(options.restDelta, FLUID_MOTION_DEFAULTS.restDelta));
    const restSpeed = Math.max(0, finiteOr(options.restSpeed, FLUID_MOTION_DEFAULTS.restSpeed));
    const angularFrequency = (Math.PI * 2) / response;
    const stiffness = angularFrequency * angularFrequency;
    const damping = 2 * dampingRatio * angularFrequency;

    let value = finiteOr(options.from, 0);
    let target = finiteOr(options.to, value);
    let velocity = finiteOr(options.velocity, 0);
    let frameHandle: unknown = null;
    let lastTime = scheduler.now();
    let running = false;
    let cancelled = false;
    let abortListenerAttached = false;

    let controller: SpringAnimationController;

    const detachAbortListener = () => {
        if (!abortListenerAttached) return;
        options.signal?.removeEventListener('abort', controller.cancel);
        abortListenerAttached = false;
    };

    const attachAbortListener = () => {
        if (!options.signal || abortListenerAttached || options.signal.aborted) return;
        options.signal.addEventListener('abort', controller.cancel, { once: true });
        abortListenerAttached = true;
    };

    const isAtRest = (): boolean =>
        Math.abs(target - value) <= restDelta && Math.abs(velocity) <= restSpeed;

    const clearScheduledFrame = () => {
        if (frameHandle !== null) {
            scheduler.cancel(frameHandle);
            frameHandle = null;
        }
    };

    const finish = () => {
        clearScheduledFrame();
        running = false;
        value = target;
        velocity = 0;
        detachAbortListener();
        options.onUpdate(value, velocity);
        options.onComplete?.(value);
    };

    const schedule = () => {
        if (!running || cancelled || frameHandle !== null) return;
        frameHandle = scheduler.request(step);
    };

    function step(timestamp: number) {
        frameHandle = null;
        if (!running || cancelled) return;

        // Un tab suspendido no debe inyectar un salto gigante al volver. Los
        // subpasos de 120 Hz mantienen estable el integrador en pantallas lentas.
        const elapsed = Math.min(Math.max((timestamp - lastTime) / 1000, 0), 0.064);
        lastTime = timestamp;

        if (elapsed > 0) {
            const substeps = Math.max(1, Math.ceil(elapsed / (1 / 120)));
            const delta = elapsed / substeps;

            for (let index = 0; index < substeps; index += 1) {
                const acceleration = -stiffness * (value - target) - damping * velocity;
                velocity += acceleration * delta;
                value += velocity * delta;
            }

            options.onUpdate(value, velocity);
        }

        if (isAtRest()) {
            finish();
            return;
        }

        schedule();
    }

    controller = {
        cancel() {
            if (cancelled) return;
            cancelled = true;
            running = false;
            clearScheduledFrame();
            detachAbortListener();
        },
        retarget(nextTarget, nextVelocity) {
            if (cancelled || options.signal?.aborted) return;
            target = finiteOr(nextTarget, target);
            if (typeof nextVelocity === 'number' && Number.isFinite(nextVelocity)) {
                velocity = nextVelocity;
            }

            if (options.reducedMotion || isAtRest()) {
                finish();
                return;
            }

            if (!running) {
                running = true;
                lastTime = scheduler.now();
            }
            attachAbortListener();
            schedule();
        },
        getValue: () => value,
        getVelocity: () => velocity,
        getTarget: () => target,
        isRunning: () => running && !cancelled,
    };

    options.onUpdate(value, velocity);

    if (options.signal?.aborted) {
        controller.cancel();
        return controller;
    }

    attachAbortListener();

    if (options.reducedMotion || isAtRest()) {
        finish();
        return controller;
    }

    running = true;
    schedule();
    return controller;
};

/** Conserva solo muestras recientes para evitar que una pausa contamine la velocidad. */
export const appendMotionSample = (
    samples: readonly MotionSample[],
    sample: MotionSample,
    maxSamples = FLUID_MOTION_DEFAULTS.historySize,
    maxAgeMs = FLUID_MOTION_DEFAULTS.historyWindowMs,
): MotionSample[] => {
    if (![sample.x, sample.y, sample.time].every(Number.isFinite)) return [...samples];

    const ageFloor = sample.time - Math.max(0, maxAgeMs);
    const recent = samples.filter((item) =>
        [item.x, item.y, item.time].every(Number.isFinite)
        && item.time >= ageFloor
        && item.time <= sample.time,
    );

    recent.push(sample);
    return recent.slice(-Math.max(2, Math.floor(maxSamples)));
};

/** Estima px/s con regresion lineal sobre el historial corto, no solo dos eventos. */
export const estimateMotionVelocity = (samples: readonly MotionSample[]): MotionVelocity => {
    const valid = samples.filter((sample) => [sample.x, sample.y, sample.time].every(Number.isFinite));
    if (valid.length < 2) return { x: 0, y: 0, speed: 0 };

    const origin = valid[0].time;
    const times = valid.map((sample) => sample.time - origin);
    const meanTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    const meanX = valid.reduce((sum, sample) => sum + sample.x, 0) / valid.length;
    const meanY = valid.reduce((sum, sample) => sum + sample.y, 0) / valid.length;

    let variance = 0;
    let covarianceX = 0;
    let covarianceY = 0;
    for (let index = 0; index < valid.length; index += 1) {
        const timeDelta = times[index] - meanTime;
        variance += timeDelta * timeDelta;
        covarianceX += timeDelta * (valid[index].x - meanX);
        covarianceY += timeDelta * (valid[index].y - meanY);
    }

    if (variance <= Number.EPSILON) return { x: 0, y: 0, speed: 0 };

    const x = (covarianceX / variance) * 1000;
    const y = (covarianceY / variance) * 1000;
    return { x, y, speed: Math.hypot(x, y) };
};

/** Proyeccion exponencial usada por Apple para estimar el destino de un flick. */
export const projectMomentum = (velocity: number, decelerationRate = 0.998): number => {
    const safeVelocity = finiteOr(velocity, 0);
    const safeRate = Math.min(0.999_999, Math.max(0.000_001, finiteOr(decelerationRate, 0.998)));
    return (safeVelocity / 1000) * safeRate / (1 - safeRate);
};

/** Resistencia progresiva para limites blandos. */
export const rubberband = (overshoot: number, dimension: number, constant = 0.55): number => {
    const safeOvershoot = finiteOr(overshoot, 0);
    const safeDimension = Math.max(0, finiteOr(dimension, 0));
    const safeConstant = Math.max(0, finiteOr(constant, 0.55));
    if (safeDimension === 0 || safeConstant === 0) return 0;
    return (safeOvershoot * safeDimension * safeConstant)
        / (safeDimension + safeConstant * Math.abs(safeOvershoot));
};

export const isPointInsideExpandedRect = (
    x: number,
    y: number,
    rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
    padding = FLUID_MOTION_DEFAULTS.hysteresis,
): boolean => {
    const safePadding = Math.max(0, finiteOr(padding, FLUID_MOTION_DEFAULTS.hysteresis));
    return x >= rect.left - safePadding
        && x <= rect.right + safePadding
        && y >= rect.top - safePadding
        && y <= rect.bottom + safePadding;
};

const parseUniformScale = (value: string): number | null => {
    if (!value) return null;
    if (value === 'none') return 1;
    const first = Number(value.trim().split(/\s+/)[0]);
    return Number.isFinite(first) && first > 0 ? first : null;
};

/**
 * Lee el `scale` individual presentado. Se mantiene separado de `transform`
 * para poder componer el feedback de press sin duplicar transforms existentes.
 */
export const readPresentationScale = (element: Element, fallback = 1): number => {
    if (typeof globalThis.getComputedStyle !== 'function') return fallback;

    const style = globalThis.getComputedStyle(element);
    const individualScale = parseUniformScale(style.getPropertyValue('scale'));
    if (individualScale !== null) return individualScale;
    return fallback;
};

export const readPresentationOpacity = (element: Element, fallback = 1): number => {
    if (typeof globalThis.getComputedStyle !== 'function') return fallback;
    const presented = globalThis.getComputedStyle(element).opacity.trim();
    if (!presented) return fallback;
    const opacity = Number(presented);
    return Number.isFinite(opacity) ? opacity : fallback;
};

export const prefersReducedMotion = (): boolean =>
    typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
