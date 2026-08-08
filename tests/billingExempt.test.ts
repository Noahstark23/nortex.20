/**
 * Política "NUNCA bloquear el POS por billing" (P1 retención), fijada en CI.
 * Si un cambio futuro vuelve a poner el POS o la lectura tras el paywall, rojo.
 */
import { describe, it, expect } from 'vitest';
import { isBillingExempt } from '../backend/middleware/billingExempt';

describe('billing — el POS y la lectura NUNCA se bloquean', () => {
    it('vender (POST /api/sales) pasa aunque la suscripción esté vencida', () => {
        expect(isBillingExempt('POST', '/api/sales')).toBe(true);
    });
    it('sync offline de ventas pasa', () => {
        expect(isBillingExempt('POST', '/api/sales/sync')).toBe(true);
    });
    it('abrir caja pasa', () => {
        expect(isBillingExempt('POST', '/api/cash-registers/open')).toBe(true);
    });
    it('abono a crédito pasa', () => {
        expect(isBillingExempt('POST', '/api/payments')).toBe(true);
    });
    it('devolución pasa', () => {
        expect(isBillingExempt('POST', '/api/returns')).toBe(true);
    });
    it('toda LECTURA (GET) pasa — el dueño nunca pierde acceso a sus datos', () => {
        expect(isBillingExempt('GET', '/api/reports/monthly')).toBe(true);
        expect(isBillingExempt('GET', '/api/dashboard/stats')).toBe(true);
        expect(isBillingExempt('GET', '/api/loans')).toBe(true);
    });
    it('billing/auth/admin siempre pasan', () => {
        expect(isBillingExempt('POST', '/api/billing/subscribe')).toBe(true);
        expect(isBillingExempt('POST', '/api/auth/login')).toBe(true);
        expect(isBillingExempt('GET', '/api/admin/metrics')).toBe(true);
    });
});

describe('billing — lo ACCESORIO sí queda tras el paywall (escrituras no operativas)', () => {
    it('solicitar préstamo (POST /api/loans) NO pasa', () => {
        expect(isBillingExempt('POST', '/api/loans')).toBe(false);
    });
    it('generar reporte pesado (POST /api/reports/export) NO pasa', () => {
        expect(isBillingExempt('POST', '/api/reports/export')).toBe(false);
    });
    it('comprar en el mercado B2B (POST /api/marketplace/order) NO pasa', () => {
        expect(isBillingExempt('POST', '/api/marketplace/order')).toBe(false);
    });
    it('asiento contable manual (POST /api/accounting/journal) NO pasa', () => {
        expect(isBillingExempt('POST', '/api/accounting/journal')).toBe(false);
    });
});
