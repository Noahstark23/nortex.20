/**
 * Secuencia de emails del trial (retención R1) — la DECISIÓN es pura y acá se
 * fija en CI: prioridades, idempotencia (alreadySent), exclusión del giro
 * LENDER y el corte duro post-vencimiento (nunca empujones a trial vencido).
 */
import { describe, it, expect } from 'vitest';
import { decideLifecycleEmail, daysUntil, type LifecycleTenantSnapshot } from '../backend/services/lifecycleEmails';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-15T12:00:00Z');

function snap(overrides: Partial<LifecycleTenantSnapshot> = {}): LifecycleTenantSnapshot {
    return {
        type: 'PULPERIA',
        createdAt: new Date(NOW.getTime() - 5 * DAY),
        trialEndsAt: new Date(NOW.getTime() + 25 * DAY),
        subscriptionStatus: 'TRIAL',
        productCount: 0,
        saleCount: 0,
        alreadySent: new Set(),
        ...overrides,
    };
}

describe('decideLifecycleEmail — empujones de activación', () => {
    it('recién registrado (<1 día): ningún email todavía', () => {
        expect(decideLifecycleEmail(snap({ createdAt: new Date(NOW.getTime() - 6 * 60 * 60 * 1000) }), NOW)).toBeNull();
    });
    it('día 1+ sin productos → NOPRODUCT', () => {
        expect(decideLifecycleEmail(snap({ createdAt: new Date(NOW.getTime() - 1.5 * DAY) }), NOW)).toBe('EMAIL_TRIAL_NOPRODUCT');
    });
    it('día 3+ con productos pero sin ventas → NOSALE', () => {
        expect(decideLifecycleEmail(snap({ productCount: 12 }), NOW)).toBe('EMAIL_TRIAL_NOSALE');
    });
    it('día 3+ sin productos → NOPRODUCT (la causa raíz manda, no NOSALE)', () => {
        expect(decideLifecycleEmail(snap(), NOW)).toBe('EMAIL_TRIAL_NOPRODUCT');
    });
    it('ya vendió → nada que empujar', () => {
        expect(decideLifecycleEmail(snap({ productCount: 12, saleCount: 3 }), NOW)).toBeNull();
    });
    it('idempotencia: NOSALE ya enviado no se repite (y no degrada a NOPRODUCT si hay productos)', () => {
        expect(decideLifecycleEmail(snap({ productCount: 12, alreadySent: new Set(['EMAIL_TRIAL_NOSALE']) }), NOW)).toBeNull();
    });
});

describe('decideLifecycleEmail — vencimiento (prioridad máxima)', () => {
    it('vence en ≤3 días → ENDING, aunque no haya vendido', () => {
        expect(decideLifecycleEmail(snap({ trialEndsAt: new Date(NOW.getTime() + 2 * DAY) }), NOW)).toBe('EMAIL_TRIAL_ENDING');
    });
    it('vencido en TRIAL (cron aún no lo marcó) → EXPIRED', () => {
        expect(decideLifecycleEmail(snap({ trialEndsAt: new Date(NOW.getTime() - 1 * DAY) }), NOW)).toBe('EMAIL_TRIAL_EXPIRED');
    });
    it('vencido y ya marcado PAST_DUE → EXPIRED', () => {
        expect(decideLifecycleEmail(snap({ subscriptionStatus: 'PAST_DUE', trialEndsAt: new Date(NOW.getTime() - 1 * DAY) }), NOW)).toBe('EMAIL_TRIAL_EXPIRED');
    });
    it('vencido + EXPIRED ya enviado → silencio total (jamás empujones post-vencimiento)', () => {
        expect(decideLifecycleEmail(snap({ trialEndsAt: new Date(NOW.getTime() - 1 * DAY), alreadySent: new Set(['EMAIL_TRIAL_EXPIRED']) }), NOW)).toBeNull();
    });
});

describe('decideLifecycleEmail — exclusiones', () => {
    it('ACTIVE (pagando) → jamás', () => {
        expect(decideLifecycleEmail(snap({ subscriptionStatus: 'ACTIVE' }), NOW)).toBeNull();
    });
    it('CANCELLED → jamás', () => {
        expect(decideLifecycleEmail(snap({ subscriptionStatus: 'CANCELLED' }), NOW)).toBeNull();
    });
    it('LENDER no recibe empujones de producto/venta (no vende productos)', () => {
        expect(decideLifecycleEmail(snap({ type: 'LENDER' }), NOW)).toBeNull();
    });
    it('LENDER sí recibe los de vencimiento', () => {
        expect(decideLifecycleEmail(snap({ type: 'LENDER', trialEndsAt: new Date(NOW.getTime() + 1 * DAY) }), NOW)).toBe('EMAIL_TRIAL_ENDING');
    });
});

describe('daysUntil', () => {
    it('redondea hacia arriba (2.2 días → 3) y nunca es negativo', () => {
        expect(daysUntil(new Date(NOW.getTime() + 2.2 * DAY), NOW)).toBe(3);
        expect(daysUntil(new Date(NOW.getTime() + 1 * DAY), NOW)).toBe(1);
        expect(daysUntil(new Date(NOW.getTime() - 5 * DAY), NOW)).toBe(0);
    });
});
