import { describe, expect, it, vi } from 'vitest';
import {
    animateSpring,
    appendMotionSample,
    estimateMotionVelocity,
    FLUID_MOTION_DEFAULTS,
    isPointInsideExpandedRect,
    projectMomentum,
    rubberband,
} from '../utils/fluidMotion';
import type { FluidFrameScheduler } from '../utils/fluidMotion';

class ManualFrameScheduler implements FluidFrameScheduler {
    private time = 0;
    private nextId = 1;
    private frames = new Map<number, FrameRequestCallback>();

    request(callback: FrameRequestCallback): number {
        const id = this.nextId;
        this.nextId += 1;
        this.frames.set(id, callback);
        return id;
    }

    cancel(handle: unknown): void {
        this.frames.delete(handle as number);
    }

    now(): number {
        return this.time;
    }

    step(milliseconds = 1000 / 120): void {
        this.time += milliseconds;
        const pending = [...this.frames.values()];
        this.frames.clear();
        pending.forEach((callback) => callback(this.time));
    }

    flush(limit = 600): void {
        let steps = 0;
        while (this.frames.size > 0 && steps < limit) {
            this.step();
            steps += 1;
        }
        if (this.frames.size > 0) throw new Error('El resorte no alcanzo reposo');
    }

    pending(): number {
        return this.frames.size;
    }
}

describe('animateSpring', () => {
    it('usa el resorte criticamente amortiguado y llega sin sobrepasar el destino', () => {
        const scheduler = new ManualFrameScheduler();
        const values: number[] = [];
        const complete = vi.fn();

        const animation = animateSpring({
            from: 0.97,
            to: 1,
            scheduler,
            onUpdate: (value) => values.push(value),
            onComplete: complete,
        });

        expect(FLUID_MOTION_DEFAULTS.dampingRatio).toBe(1);
        expect(FLUID_MOTION_DEFAULTS.response).toBeGreaterThanOrEqual(0.3);
        expect(FLUID_MOTION_DEFAULTS.response).toBeLessThanOrEqual(0.4);
        expect(animation.isRunning()).toBe(true);

        scheduler.flush();

        expect(values[0]).toBe(0.97);
        expect(values.every((value) => value <= 1.000_001)).toBe(true);
        expect(values.at(-1)).toBe(1);
        expect(animation.getVelocity()).toBe(0);
        expect(animation.isRunning()).toBe(false);
        expect(complete).toHaveBeenCalledOnce();
    });

    it('se redirige desde el valor presentado conservando la velocidad', () => {
        const scheduler = new ManualFrameScheduler();
        const values: number[] = [];
        const animation = animateSpring({
            from: 0,
            to: 1,
            scheduler,
            onUpdate: (value) => values.push(value),
        });

        for (let index = 0; index < 8; index += 1) scheduler.step();
        const presentationValue = animation.getValue();
        const inheritedVelocity = animation.getVelocity();
        expect(presentationValue).toBeGreaterThan(0);
        expect(inheritedVelocity).toBeGreaterThan(0);

        animation.retarget(-0.5);

        expect(animation.getValue()).toBe(presentationValue);
        expect(animation.getVelocity()).toBe(inheritedVelocity);
        scheduler.flush();
        expect(values.at(-1)).toBe(-0.5);
    });

    it('cancela de forma idempotente y no ejecuta mas cuadros', () => {
        const scheduler = new ManualFrameScheduler();
        const update = vi.fn();
        const complete = vi.fn();
        const animation = animateSpring({
            from: 0,
            to: 1,
            scheduler,
            onUpdate: update,
            onComplete: complete,
        });

        expect(scheduler.pending()).toBe(1);
        animation.cancel();
        animation.cancel();
        scheduler.step();

        expect(update).toHaveBeenCalledOnce();
        expect(complete).not.toHaveBeenCalled();
        expect(animation.isRunning()).toBe(false);
        expect(scheduler.pending()).toBe(0);
    });

    it('reduce movimiento resolviendo el estado sin iniciar un resorte', () => {
        const scheduler = new ManualFrameScheduler();
        const update = vi.fn();
        const complete = vi.fn();

        const animation = animateSpring({
            from: 0.6,
            to: 1,
            reducedMotion: true,
            scheduler,
            onUpdate: update,
            onComplete: complete,
        });

        expect(animation.getValue()).toBe(1);
        expect(animation.isRunning()).toBe(false);
        expect(scheduler.pending()).toBe(0);
        expect(update).toHaveBeenNthCalledWith(1, 0.6, 0);
        expect(update).toHaveBeenLastCalledWith(1, 0);
        expect(complete).toHaveBeenCalledWith(1);
    });

    it('respeta AbortSignal y limpia el cuadro pendiente', () => {
        const scheduler = new ManualFrameScheduler();
        const abort = new AbortController();
        const complete = vi.fn();
        const animation = animateSpring({
            from: 0,
            to: 1,
            scheduler,
            signal: abort.signal,
            onUpdate: vi.fn(),
            onComplete: complete,
        });

        abort.abort();

        expect(animation.isRunning()).toBe(false);
        expect(scheduler.pending()).toBe(0);
        expect(complete).not.toHaveBeenCalled();
    });
});

describe('historial, proyeccion y limites fisicos', () => {
    it('estima velocidad con varias muestras y elimina historia vieja', () => {
        let samples = appendMotionSample([], { x: 0, y: 0, time: 0 });
        samples = appendMotionSample(samples, { x: 10, y: 5, time: 50 });
        samples = appendMotionSample(samples, { x: 20, y: 10, time: 100 });
        samples = appendMotionSample(samples, { x: 40, y: 20, time: 200 });

        expect(samples).toHaveLength(2);
        expect(samples[0].time).toBe(100);
        expect(estimateMotionVelocity(samples)).toEqual({
            x: 200,
            y: 100,
            speed: Math.hypot(200, 100),
        });
    });

    it('proyecta momentum exponencial y aplica resistencia progresiva', () => {
        expect(projectMomentum(1000, 0.998)).toBeCloseTo(499, 6);
        expect(projectMomentum(-1000, 0.998)).toBeCloseTo(-499, 6);

        const small = rubberband(20, 300);
        const large = rubberband(200, 300);
        expect(small).toBeGreaterThan(0);
        expect(large).toBeGreaterThan(small);
        expect(large).toBeLessThan(200);
        expect(rubberband(-200, 300)).toBeCloseTo(-large);
    });

    it('mantiene el gesto dentro de 10px de histeresis', () => {
        const rect = { left: 0, right: 100, top: 0, bottom: 40 };
        expect(isPointInsideExpandedRect(110, 20, rect)).toBe(true);
        expect(isPointInsideExpandedRect(111, 20, rect)).toBe(false);
        expect(isPointInsideExpandedRect(-10, -10, rect)).toBe(true);
    });
});
