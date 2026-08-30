import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cashMovementJournalLines } from '../backend/services/accounting';
import { CATEGORIA_PAGO_PROVEEDOR } from '../backend/services/supplierPayment';

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

    it('bloquea el atajo manual sin perder el significado contable histórico', () => {
        expect(CATEGORIA_PAGO_PROVEEDOR).toBe('PAGO_PROVEEDOR');
        expect(cashMovementJournalLines('OUT', CATEGORIA_PAGO_PROVEEDOR, 25)).toEqual([
            { accountCode: '2.1.1', debit: 25, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: 25 },
        ]);
    });

    it('siembra el catálogo antes de abrir el pago y traduce errores estables', () => {
        expect(paymentRoute.indexOf('seedChartOfAccounts')).toBeLessThan(
            paymentRoute.indexOf('executeSupplierPaymentTransaction'),
        );
        expect(paymentRoute).toMatch(/error instanceof \w*SupplierPaymentError/u);
        expect(paymentRoute).toContain('res.status(error.httpStatus)');
        expect(paymentRoute).toContain('code: error.code');
        expect(paymentRoute).toContain('error instanceof PeriodLockedError');
        expect(paymentRoute).toContain("code: 'PERIOD_LOCKED'");
    });

    it('materializa saldo y fecha pagada al crear la compra', () => {
        expect(purchaseRoute).toContain('total: totalAmount.toFixed(2)');
        expect(purchaseRoute).toContain("balanceDue: paymentMethod === 'CASH' ? '0.00' : totalAmount.toFixed(2)");
        const settledNow = purchaseRoute.indexOf("const settledNow = paymentMethod === 'CASH' ? new Date() : null");
        const purchaseCreate = purchaseRoute.indexOf('const purchase = await tx.purchase.create', settledNow);
        expect(settledNow).toBeGreaterThan(0);
        expect(purchaseCreate).toBeGreaterThan(settledNow);
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
