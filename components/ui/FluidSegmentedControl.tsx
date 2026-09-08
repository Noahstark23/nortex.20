import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import type { KeyboardEvent } from 'react';
import {
    animateSpring,
    FLUID_MOTION_DEFAULTS,
    prefersReducedMotion,
} from '../../utils/fluidMotion';
import type { SpringAnimationController } from '../../utils/fluidMotion';

export interface FluidSegmentedControlItem {
    id: string;
    label: string;
    /** Etiqueta visual compacta; el nombre accesible conserva `label`. */
    shortLabel?: string;
    count?: number;
}

export interface FluidSegmentedControlProps {
    items: readonly FluidSegmentedControlItem[];
    activeId: string;
    onChange: (id: string) => void;
    ariaLabel: string;
    className?: string;
}

const indicatorTransform = (position: number): string =>
    `translate3d(${position * 100}%, 0, 0)`;

/**
 * Selector de vistas compacto con semantica de tabs y movimiento interrumpible.
 * El resorte anima indices, no pixeles: cada destino sigue siendo un segmento
 * exacto aunque el contenedor cambie de ancho durante el movimiento.
 */
export const FluidSegmentedControl = ({
    items,
    activeId,
    onChange,
    ariaLabel,
    className = '',
}: FluidSegmentedControlProps) => {
    const activeIndex = items.findIndex((item) => item.id === activeId);
    const [systemReducedMotion, setSystemReducedMotion] = useState(prefersReducedMotion);

    const indicatorRef = useRef<HTMLSpanElement | null>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const animationRef = useRef<SpringAnimationController | null>(null);
    const animationTokenRef = useRef<symbol | null>(null);
    const positionRef = useRef(Math.max(0, activeIndex));
    const targetRef = useRef<number | null>(activeIndex >= 0 ? activeIndex : null);

    const applyPosition = useCallback((position: number) => {
        const safePosition = Number.isFinite(position) ? position : 0;
        positionRef.current = safePosition;
        if (indicatorRef.current) {
            indicatorRef.current.style.transform = indicatorTransform(safePosition);
        }
    }, []);

    const cancelAnimation = useCallback(() => {
        animationTokenRef.current = null;
        animationRef.current?.cancel();
        animationRef.current = null;
    }, []);

    const animateTo = useCallback((target: number) => {
        const runningAnimation = animationRef.current;
        if (runningAnimation?.isRunning()) {
            runningAnimation.retarget(target);
            return;
        }

        const inheritedVelocity = runningAnimation?.getVelocity() ?? 0;
        runningAnimation?.cancel();

        const token = Symbol('fluid-segmented-control');
        animationTokenRef.current = token;
        const animation = animateSpring({
            from: positionRef.current,
            to: target,
            velocity: inheritedVelocity,
            dampingRatio: FLUID_MOTION_DEFAULTS.dampingRatio,
            response: FLUID_MOTION_DEFAULTS.response,
            restDelta: FLUID_MOTION_DEFAULTS.restDelta,
            restSpeed: FLUID_MOTION_DEFAULTS.restSpeed,
            onUpdate: (position) => {
                if (animationTokenRef.current === token) applyPosition(position);
            },
            onComplete: () => {
                if (animationTokenRef.current !== token) return;
                animationTokenRef.current = null;
                animationRef.current = null;
            },
        });

        if (animationTokenRef.current === token && animation.isRunning()) {
            animationRef.current = animation;
        }
    }, [applyPosition]);

    useLayoutEffect(() => {
        if (activeIndex < 0) {
            targetRef.current = null;
            cancelAnimation();
            return;
        }

        if (systemReducedMotion) {
            targetRef.current = activeIndex;
            cancelAnimation();
            applyPosition(activeIndex);
            return;
        }

        if (targetRef.current === null) {
            targetRef.current = activeIndex;
            applyPosition(activeIndex);
            return;
        }

        if (targetRef.current === activeIndex) return;
        targetRef.current = activeIndex;
        animateTo(activeIndex);
    }, [activeIndex, animateTo, applyPosition, cancelAnimation, systemReducedMotion]);

    useEffect(() => {
        if (typeof globalThis.matchMedia !== 'function') return;

        const query = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        const updatePreference = () => setSystemReducedMotion(query.matches);
        updatePreference();
        query.addEventListener?.('change', updatePreference);
        return () => query.removeEventListener?.('change', updatePreference);
    }, []);

    useEffect(() => () => cancelAnimation(), [cancelAnimation]);

    const handleKeyDown = (
        event: KeyboardEvent<HTMLButtonElement>,
        currentIndex: number,
    ) => {
        if (items.length === 0) return;

        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = items.length - 1;
        if (nextIndex === null) return;

        event.preventDefault();
        optionRefs.current[nextIndex]?.focus();
        const nextId = items[nextIndex].id;
        if (nextId !== activeId) onChange(nextId);
    };

    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            aria-orientation="horizontal"
            className={`relative grid min-h-[52px] w-full isolate rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] p-1 shadow-inner ${className}`}
            style={items.length > 0
                ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }
                : undefined}
        >
            {activeIndex >= 0 && items.length > 0 && (
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-1 overflow-hidden rounded-lg"
                >
                    <span
                        ref={indicatorRef}
                        data-fluid-segmented-indicator=""
                        className="block h-full rounded-lg bg-[var(--nx-canvas-raised)] shadow-sm ring-1 ring-[color:var(--nx-canvas-border)] will-change-transform"
                        style={{
                            width: `${100 / items.length}%`,
                            transform: indicatorTransform(positionRef.current),
                        }}
                    />
                </span>
            )}

            {items.map((item, index) => {
                const selected = index === activeIndex;
                return (
                    <button
                        key={item.id}
                        ref={(element) => {
                            optionRefs.current[index] = element;
                        }}
                        type="button"
                        role="radio"
                        aria-label={item.label}
                        aria-checked={selected}
                        tabIndex={selected || (activeIndex < 0 && index === 0) ? 0 : -1}
                        onClick={() => {
                            if (!selected) onChange(item.id);
                        }}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                        className={`nx-fluid-press relative z-10 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--nx-brand-ring)] sm:px-3 ${selected
                            ? 'text-[var(--nx-canvas-text)]'
                            : 'text-[var(--nx-canvas-muted)] hover:text-[var(--nx-canvas-text)]'}`}
                    >
                        <span className="truncate">{item.shortLabel ?? item.label}</span>
                        {item.count !== undefined && (
                            <span
                                aria-hidden="true"
                                className={`min-w-5 shrink-0 rounded-pill px-1.5 text-center text-[11px] font-bold leading-5 tabular-nums ${selected
                                    ? 'bg-[var(--nx-brand-soft)] text-[var(--nx-brand)]'
                                    : 'bg-[var(--nx-canvas-raised)] text-[var(--nx-canvas-muted)] ring-1 ring-inset ring-[color:var(--nx-canvas-border)]'}`}
                            >
                                {item.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default FluidSegmentedControl;
