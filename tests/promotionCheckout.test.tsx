// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import POS from '../components/POS';
import { db } from '../lib/db';
import { usePromotionCheckout } from '../hooks/usePromotionCheckout';
import { promotionReceiptCart } from '../components/pos/PromotionTotals';
import { promotionRecoveredSale } from '../components/pos/PromotionRecoveredSale';
import type { CartItem } from '../types';
import type { PromotionCheckoutQuote } from '../shared/promotions';
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const product = { id: 'p1', name: 'Cemento QA', sku: '7501055363018', price: 100, cost: 50, stock: 10, minStock: 1, unit: 'unidad', category: 'Materiales', ivaExento: false, isPublished: true };
const quote = (offlineId: string): PromotionCheckoutQuote => ({ id: 'q1', version: 1, offlineId, expiresAt: '2099-01-01T00:00:00Z', total: '80.00', vatAmount: '10.43', exemptTotal: '0', fiscalRegime: 'GENERAL', fiscalRegimeVersion: 1, hasPromotions: true, lines: [{ productId: 'p1', name: 'Cemento QA', quantity: '1', presentation: 'BASE', presentationQuantity: '1', unit: 'unidad', unitPrice: '80.00', lineTotal: '80.00', promotion: { id: 'promo1', version: 1, name: 'Oferta QA', percent: '20', configHash: 'h1', normalUnitPrice: '100', unitPrice: '80', startsAt: '2026-09-01', endsAt: '2099-01-01' } }] });
const sale = { id: 'sale1', total: '80', paymentMethod: 'CASH', invoiceNumber: 1, invoiceSeries: 'A', createdAt: '2026-09-05T12:00:00Z', vatAmountAtSale: '10.43', fiscalRegimeAtSale: 'GENERAL', fiscalRegimeVersionAtSale: 1, items: [{ productId: 'p1', quantity: 1, productNameAtSale: 'Cemento QA', priceAtSale: '80', unitPriceExactAtSale: '80', discount: 0, ivaExento: false, unitAtSale: 'unidad', presentationAtSale: 'BASE', presentationQuantityAtSale: '1', promotionSnapshot: quote('id').lines[0].promotion }] };
beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.offline_sales.clear(); localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: 't1', businessName: 'QA' })); localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', name: 'Caja QA', role: 'CASHIER' })); localStorage.setItem('nortex_token', 'synthetic'); localStorage.setItem('token', 'synthetic'); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: media === '(min-width: 1024px)', media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });
function install(lost: boolean) {
    const calls: Array<{ url: string; body: any }> = []; let found = !lost;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input).split('?')[0]; const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        if (init?.method === 'POST') calls.push({ url, body });
        if (url === '/api/promotions/checkout/quote') return ok({ enabled: true, quote: quote(body.sale.offlineId) });
        if (url.startsWith('/api/promotions/checkout/operations/')) return found ? ok({ status: 'COMMITTED', sale }) : { ...ok({ status: 'NOT_FOUND' }), ok: false, status: 404 };
        if (url === '/api/sales') { if (lost) throw new TypeError('Response lost'); return ok(sale); }
        const responses: Record<string, unknown> = { '/api/products': [product], '/api/categories': [], '/api/customers': [], '/api/employees': [], '/api/shifts/current': { id: 'shift1', status: 'OPEN', userId: 'u1', startTime: '2026-09-05T10:00:00Z', employeeId: 'u1', employee: { id: 'u1', name: 'Caja QA' }, esTurnoPropio: true, initialCash: 500 }, '/api/cash-movements': [], '/api/cash-movements/balance': { efectivo: 500 }, '/api/tenant/fiscal-settings': { fiscalRegime: 'GENERAL', fiscalRegimeVersion: 1 } };
        return ok(url in responses ? responses[url] : {});
    })); return { calls, found: () => { found = true; } };
}
async function checkout() {
    const user = userEvent.setup(); await user.type(await screen.findByPlaceholderText(/Escaneá o buscá un producto|Buscar o escanear/i), `${product.sku}{Enter}`);
    await user.click(await screen.findByRole('button', { name: /Cobrar C\$ 100\.00 en efectivo/ })); fireEvent.change(await screen.findByLabelText(/Efectivo recibido en córdobas/), { target: { value: '100' } }); fireEvent.click(await screen.findByRole('button', { name: /Registrar efectivo y seguir/ }));
    return screen.findByRole('dialog', { name: 'Revisar precio antes de cobrar' });
}
describe('cobro con promoción y evidencia de venta', () => {
    it('el comprobante conserva descuentos ajenos a la promoción y no hereda una presentación distinta del carrito actual', () => {
        const cart = [{ ...product, costPrice: 50, quantity: 1, discount: 5, presentation: { quantity: '1', unit: 'caja' } }] as Array<CartItem & { discount: number }>;
        const unpromoted = { ...quote('same'), lines: [{ ...quote('same').lines[0], promotion: null }] };
        expect((promotionReceiptCart(cart, unpromoted)[0] as CartItem & { discount: number }).discount).toBe(5);
        expect(promotionRecoveredSale(cart, sale).items[0].presentation).toEqual({ quantity: '1', unit: 'unidad' });
    });
    it('requiere aceptar el precio autoritativo y registra la misma foto idempotente', async () => {
        const server = install(false); render(<MemoryRouter><POS /></MemoryRouter>); const dialog = await checkout();
        expect(within(dialog).getByText('C$ 80.00')).toBeVisible(); expect(server.calls.filter(call => call.url === '/api/sales')).toHaveLength(0);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Aceptar total y continuar al cobro' }));
        await waitFor(() => expect(server.calls.filter(call => call.url === '/api/sales')).toHaveLength(1));
        const quoted = server.calls.find(call => call.url.endsWith('/quote'))!.body.sale; const submitted = server.calls.find(call => call.url === '/api/sales')!.body;
        expect(submitted).toEqual({ ...quoted, promotionQuote: { id: 'q1', version: 1 } }); expect((await screen.findByText('Total Cobrado')).parentElement).toHaveTextContent('C$ 80.00'); expect(screen.getByText('Vuelto para el cliente').parentElement).toHaveTextContent('C$ 20.00'); expect(sessionStorage.getItem('nortex_promotion_pending_v1:t1:u1')).toBeNull();
    });
    it('pérdida de respuesta y recarga conservan referencia y carrito, nunca encolan ni vuelven a cobrar', async () => {
        const server = install(true); const view = render(<MemoryRouter><POS /></MemoryRouter>); fireEvent.click(within(await checkout()).getByRole('button', { name: 'Aceptar total y continuar al cobro' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Comprobar venta registrada' })); await screen.findByText(/No pudimos recuperar un comprobante completo/);
        expect(await db.offline_sales.count()).toBe(0); const id = server.calls.find(call => call.url === '/api/sales')!.body.offlineId; expect(sessionStorage.getItem('nortex_promotion_pending_v1:t1:u1')).toBe(id);
        view.unmount(); render(<MemoryRouter><POS /></MemoryRouter>); expect(await screen.findByRole('button', { name: 'Comprobar venta registrada' })).toBeVisible();
        await waitFor(() => expect(screen.getByLabelText('Cantidad de Cemento QA en unidad')).toHaveValue('1')); server.found(); fireEvent.click(screen.getByRole('button', { name: 'Comprobar venta registrada' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Ver comprobante de la venta' })); expect(await screen.findByText('Total Cobrado')).toBeVisible();
        expect(server.calls.filter(call => call.url === '/api/sales')).toHaveLength(1); expect(await db.offline_sales.count()).toBe(0); expect(sessionStorage.getItem('nortex_promotion_pending_v1:t1:u1')).toBeNull();
    });
    it('invalida la revisión al editar el carrito y descarta respuestas de otra sesión', async () => {
        let resolve!: (value: unknown) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done; })));
        const { result, rerender } = renderHook(({ token, reset }) => usePromotionCheckout(token, reset, 't1:u1'), { initialProps: { token: 'a', reset: 'cart1' } });
        let pending: Promise<unknown>; act(() => { pending = result.current.prepare('s1', { offlineId: 'sale1', paymentMethod: 'CASH' }, 'shift1'); });
        rerender({ token: 'b', reset: 'cart1' }); await act(async () => { resolve(ok({ enabled: true, quote: quote('sale1') })); await pending; }); expect(result.current.attempt).toBeNull(); expect(result.current.open).toBe(false);
        vi.stubGlobal('fetch', vi.fn(async () => ok({ enabled: true, quote: quote('sale1') }))); await act(() => result.current.prepare('s1', { offlineId: 'sale1', paymentMethod: 'CASH' }, 'shift1')); act(() => result.current.accept());
        rerender({ token: 'b', reset: 'cart2' }); expect(result.current.quoted).toBeNull();
    });
    it('sólo libera un intento incierto con cancelación durable; ausencia, error y comprobante incompleto lo conservan', async () => {
        sessionStorage.setItem('nortex_promotion_pending_v1:t1:u1', 'same-sale'); const cancelled = vi.fn();
        const fetcher = vi.fn().mockResolvedValueOnce(ok({ status: 'NOT_FOUND' })).mockRejectedValueOnce(new TypeError('Response lost')).mockResolvedValueOnce(ok({ status: 'COMMITTED', sale: { id: 'sale1' } })).mockResolvedValueOnce(ok({ status: 'CANCELLED' })); vi.stubGlobal('fetch', fetcher);
        const { result } = renderHook(() => usePromotionCheckout('synthetic', 'cart', 't1:u1', cancelled));
        for (let index = 0; index < 3; index += 1) { await act(() => result.current.cancelAttempt()); expect(result.current.blocksOffline).toBe(true); expect(result.current.attempt?.payload.offlineId).toBe('same-sale'); expect(result.current.attempt?.recovered).toBeUndefined(); expect(cancelled).not.toHaveBeenCalled(); expect(sessionStorage.getItem('nortex_promotion_pending_v1:t1:u1')).toBe('same-sale'); }
        await act(() => result.current.cancelAttempt()); expect(result.current.attempt).toBeNull(); expect(result.current.blocksOffline).toBe(false); expect(cancelled).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem('nortex_promotion_pending_v1:t1:u1')).toBeNull();
        for (const [url, options] of fetcher.mock.calls) { expect(url).toBe('/api/promotions/checkout/operations/same-sale/cancel'); expect(options).toMatchObject({ method: 'POST', body: '{}' }); }
    });
    it('cancelar un intento ya cobrado recupera el comprobante sin liberar ni repetir la venta', async () => {
        sessionStorage.setItem('nortex_promotion_pending_v1:t1:u1', 'same-sale'); const cancelled = vi.fn(); const fetcher = vi.fn(async () => ok({ status: 'COMMITTED', sale })); vi.stubGlobal('fetch', fetcher);
        const { result } = renderHook(() => usePromotionCheckout('synthetic', 'cart', 't1:u1', cancelled)); await act(() => result.current.cancelAttempt());
        expect(result.current.attempt?.recovered).toEqual(sale); expect(result.current.attempt?.uncertain).toBe(false); expect(result.current.blocksOffline).toBe(true); expect(cancelled).not.toHaveBeenCalled(); expect(sessionStorage.getItem('nortex_promotion_pending_v1:t1:u1')).toBe('same-sale'); expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
