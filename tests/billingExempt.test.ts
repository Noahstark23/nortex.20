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
    // ⚠️ Fijar RUTAS REALES del backend. La versión anterior de este test
    // aseveraba '/api/cash-registers/open' — una ruta que no existe en la API —
    // y el CI quedó verde mientras prod bloqueaba abrir caja al vencer el trial.
    it('abrir caja pasa (POST /api/shifts/open — la ruta REAL)', () => {
        expect(isBillingExempt('POST', '/api/shifts/open')).toBe(true);
    });
    it('cerrar y tomar caja pasan', () => {
        expect(isBillingExempt('POST', '/api/shifts/close')).toBe(true);
        expect(isBillingExempt('POST', '/api/shifts/abc123/tomar')).toBe(true);
    });
    it('movimientos de gaveta pasan (POST /api/cash-movements)', () => {
        expect(isBillingExempt('POST', '/api/cash-movements')).toBe(true);
        expect(isBillingExempt('POST', '/api/cash-movements/xyz/void')).toBe(true);
    });
    it('cobrar el fiado pasa (POST /api/credits/payment — la ruta REAL de cobros)', () => {
        expect(isBillingExempt('POST', '/api/credits/payment')).toBe(true);
    });
    it('abono a crédito pasa (ruta legacy /api/payments)', () => {
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
