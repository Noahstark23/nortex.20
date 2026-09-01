import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

const pos = readFileSync(resolve(process.cwd(), 'components/POS.tsx'), 'utf8');
const cashLabelsStart = pos.indexOf('const DESCRIPCION_POR_CATEGORIA');
const cashLabelsEnd = pos.indexOf('// ── Validación nativa', cashLabelsStart);
const cashOutCategoriesStart = pos.indexOf('const outCategories = [');
const cashOutCategoriesEnd = pos.indexOf('];', cashOutCategoriesStart);
if (
    cashLabelsStart < 0
    || cashLabelsEnd < 0
    || cashOutCategoriesStart < 0
    || cashOutCategoriesEnd < 0
) {
    throw new Error('No se encontró el contrato de categorías de caja del POS');
}
const historicalCashLabels = pos.slice(cashLabelsStart, cashLabelsEnd);
const cashOutCategories = pos.slice(cashOutCategoriesStart, cashOutCategoriesEnd);

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

    it('retira el pago manual del POS sin ocultar movimientos históricos', () => {
        expect(cashOutCategories).not.toContain('PAGO_PROVEEDOR');
        expect(historicalCashLabels).toContain("PAGO_PROVEEDOR: 'Pago a proveedor'");
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
