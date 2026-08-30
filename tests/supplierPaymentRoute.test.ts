// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import POS from '../components/POS';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

const paymentStart = server.indexOf("// POST /api/purchases/:id/pay");
const paymentEnd = server.indexOf('// GET /api/purchases/pending', paymentStart);
if (paymentStart < 0 || paymentEnd < 0) throw new Error('No se encontró la ruta de pago a proveedor');
const paymentRoute = server.slice(paymentStart, paymentEnd);

const purchaseStart = server.indexOf("app.post('/api/purchases'");
const purchaseEnd = server.indexOf("// POST /api/purchases/:id/pay", purchaseStart);
if (purchaseStart < 0 || purchaseEnd < 0) throw new Error('No se encontró la ruta de compras');
const purchaseRoute = server.slice(purchaseStart, purchaseEnd);

const cashMovementStart = server.indexOf("app.post('/api/cash-movements'");
const cashMovementEnd = server.indexOf("app.get('/api/cash-movements'", cashMovementStart);
if (cashMovementStart < 0 || cashMovementEnd < 0) {
    throw new Error('No se encontró la ruta de movimientos de caja');
}
const cashMovementRoute = server.slice(cashMovementStart, cashMovementEnd);

const respuestaOk = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
});

const montarPosConPagoHistorico = () => {
    localStorage.setItem('nortex_token', 'token-prueba');
    localStorage.setItem('nortex_ui_mode', 'full');
    localStorage.setItem('nortex_user', JSON.stringify({ id: 'user-1', role: 'OWNER' }));
    localStorage.setItem('nortex_tenant_data', JSON.stringify({
        id: 'tenant-1',
        type: 'RETAIL',
        businessName: 'Pulpería QA',
    }));

    const responses: Record<string, unknown> = {
        '/api/products': [],
        '/api/customers': [],
        '/api/shifts/current': {
            id: 'shift-1',
            status: 'OPEN',
            initialCash: '500.00',
            userId: 'user-1',
            startTime: '2026-08-30T12:00:00.000Z',
            esTurnoPropio: true,
            turnoDe: null,
        },
        '/api/cash-movements': [{
            id: 'movement-legacy-1',
            category: 'PAGO_PROVEEDOR',
            amount: '115.00',
            type: 'OUT',
            createdAt: '2026-08-30T12:05:00.000Z',
        }],
        '/api/cash-movements/balance': { balance: '500.00', hasOpenShift: true },
        '/api/pos/pulso': {},
        '/api/tenant/fiscal-settings': {},
        '/api/tenant/cashier-settings': {},
        '/api/tenant/inventory-settings': {},
        '/api/accounting/exchange-rate/latest': {},
        '/api/agent-banking/agreements': [],
        '/api/scale-labels/active-context': {},
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input).split('?')[0];
        return respuestaOk(path in responses ? responses[path] : {});
    }));

    return render(React.createElement(
        MemoryRouter,
        null,
        React.createElement(POS),
    ));
};

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('integración estructural del subledger de CxP', () => {
    it('la ruta usa validación, política y servicio transaccional únicos', () => {
        expect(paymentRoute).toContain('checkRole(PURCHASE_PAYMENT_ROLES)');
        expect(paymentRoute).toContain('validate(SupplierPaymentRequestSchema)');
        expect(paymentRoute).toContain('executeSupplierPaymentTransaction({');
        expect(paymentRoute).toContain('db: prisma');
        expect(paymentRoute).toContain('tenantId: authReq.tenantId!');
        expect(paymentRoute).toContain('userId: authReq.userId!');
        expect(paymentRoute).toContain('purchaseId: req.params.id');
    });

    it('ya no registra el pago como gasto ni muta dinero desde el handler', () => {
        expect(paymentRoute).not.toContain('expense.create');
        expect(paymentRoute).not.toContain('walletBalance: { decrement:');
        expect(paymentRoute).not.toContain("action: 'PURCHASE_PAID'");
        expect(paymentRoute).not.toContain("category: 'PAGO_PROVEEDOR'");
    });

    it('cierra el atajo heredado de caja antes de cualquier lectura o transacción', () => {
        expect(cashMovementRoute).toContain("category.trim().toUpperCase() === 'PAGO_PROVEEDOR'");
        expect(cashMovementRoute).toContain("code: 'SUPPLIER_PAYMENT_REQUIRES_PURCHASE'");
        expect(cashMovementRoute.indexOf("category.trim().toUpperCase() === 'PAGO_PROVEEDOR'"))
            .toBeLessThan(cashMovementRoute.indexOf('resolverTurnoAbierto'));
        expect(cashMovementRoute.indexOf("category.trim().toUpperCase() === 'PAGO_PROVEEDOR'"))
            .toBeLessThan(cashMovementRoute.indexOf('prisma.$transaction'));
        expect(cashMovementRoute).not.toContain("['GASTO_OPERATIVO', 'PAGO_PROVEEDOR']");
        expect(cashMovementRoute).not.toContain("category: category === 'PAGO_PROVEEDOR'");
    });

    it('retira el pago manual del POS sin ocultar movimientos históricos', async () => {
        montarPosConPagoHistorico();

        const balance = await screen.findByTitle('Efectivo en caja');
        fireEvent.click(balance);
        expect(await screen.findByText('Pago a proveedor')).toBeTruthy();

        fireEvent.keyDown(window, { key: 'F7' });
        expect(await screen.findByRole('heading', { name: 'Salida de Efectivo' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Gasto Operativo' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Retiro Personal' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Pago a proveedor' })).toBeNull();
    });

    it('siembra el catálogo antes de abrir el pago y traduce errores estables', () => {
        expect(paymentRoute.indexOf('seedChartOfAccounts')).toBeLessThan(
            paymentRoute.indexOf('executeSupplierPaymentTransaction'),
        );
        expect(paymentRoute).toContain('error instanceof SupplierPaymentError');
        expect(paymentRoute).toContain('error instanceof PeriodLockedError');
        expect(paymentRoute).toContain("code: 'PERIOD_LOCKED'");
    });

    it('materializa saldo y fecha pagada al crear la compra', () => {
        expect(purchaseRoute).toContain('total: totalAmount.toFixed(2)');
        expect(purchaseRoute).toContain("balanceDue: paymentMethod === 'CASH' ? '0.00' : totalAmount.toFixed(2)");
        expect(purchaseRoute).toContain("const settledNow = paymentMethod === 'CASH' ? new Date() : null");
        expect(purchaseRoute).toContain('paidAt: settledNow');
        expect(purchaseRoute).toContain('settledAt: settledNow');
        expect(purchaseRoute).toContain("status: paymentMethod === 'CASH' ? 'COMPLETED' : 'PENDING_PAYMENT'");
    });

    it('postea el documento, conserva snapshots por línea y usa la fecha contable', () => {
        expect(purchaseRoute).toContain("documentStatus: 'POSTED'");
        expect(purchaseRoute).toContain("matchStatus: 'NOT_REQUIRED'");
        expect(purchaseRoute).toContain('paymentHold: false');
        expect(purchaseRoute).toContain('unitCostExact:');
        expect(purchaseRoute).toContain('taxAmountExact:');
        expect(purchaseRoute).toContain('creditableTaxExact:');
        expect(purchaseRoute).toContain('explicitOrderItem.productId !== item.productId');
        expect(purchaseRoute).toContain("code: 'PURCHASE_ORDER_ITEM_INVALID'");
        expect(purchaseRoute).toContain('postingDate: normalizeCalendarDateInput(postingDate ?? date)');
        expect(purchaseRoute).toContain('normalizeCalendarDateInput(postingDate ?? date),');
    });
});
