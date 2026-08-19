/**
 * NORTEX — CreatePurchaseSchema contra los payloads REALES de sus dos clientes.
 *
 * El bug que esta red congela: el form de Compras manda `dueDate` de un
 * <input type="date"> (YYYY-MM-DD) y `null` en contado / notas vacías, y el
 * schema con `.datetime().optional()` a secas rechazaba TODA compra manual con
 * 400 — el form estuvo muerto en prod sin que nadie lo notara, porque
 * SmartPurchases (notas fijas, sin dueDate) sí pasaba. Estos tests parsean los
 * payloads tal como los arma cada componente: si alguien "endurece" el schema
 * de vuelta, esto se pone rojo antes que el form.
 */
import { describe, it, expect } from 'vitest';
import { CreatePurchaseSchema } from '../backend/validation/schemas';

const itemBase = { productId: 'p1', quantity: 3, unitCost: 25.5 };

describe('CreatePurchaseSchema — payload del form de Compras (Purchases.tsx)', () => {
    it('acepta contado sin dueDate ni notas (claves omitidas, como manda el form)', () => {
        const r = CreatePurchaseSchema.safeParse({
            supplierId: 's1',
            invoiceNumber: 'FAC-001234',
            paymentMethod: 'CASH',
            items: [itemBase],
        });
        expect(r.success).toBe(true);
    });

    it('acepta null explícito en dueDate/notes (payload histórico del form)', () => {
        const r = CreatePurchaseSchema.safeParse({
            supplierId: 's1',
            invoiceNumber: 'FAC-001234',
            paymentMethod: 'CASH',
            dueDate: null,
            notes: null,
            items: [itemBase],
        });
        expect(r.success).toBe(true);
    });

    it('acepta crédito con fecha de <input type="date"> (YYYY-MM-DD, sin hora)', () => {
        const r = CreatePurchaseSchema.safeParse({
            supplierId: 's1',
            invoiceNumber: 'FAC-9',
            paymentMethod: 'CREDIT',
            dueDate: '2026-09-15',
            items: [itemBase],
        });
        expect(r.success).toBe(true);
    });

    it('sigue aceptando ISO completo con offset (clientes de API)', () => {
        const r = CreatePurchaseSchema.safeParse({
            supplierId: 's1',
            invoiceNumber: 'FAC-9',
            paymentMethod: 'CREDIT',
            dueDate: '2026-09-15T00:00:00-06:00',
            items: [itemBase],
        });
        expect(r.success).toBe(true);
    });

    it('rechaza una fecha que no es ni date-only ni ISO', () => {
        const r = CreatePurchaseSchema.safeParse({
            supplierId: 's1',
            invoiceNumber: 'FAC-9',
            paymentMethod: 'CREDIT',
            dueDate: '15/09/2026',
            items: [itemBase],
        });
        expect(r.success).toBe(false);
    });

    it('S45: deja pasar purchaseOrderId (antes el schema lo STRIPEABA en silencio)', () => {
        const r = CreatePurchaseSchema.safeParse({
            supplierId: 's1',
            invoiceNumber: 'FAC-77',
            paymentMethod: 'CASH',
            purchaseOrderId: 'po_123',
            items: [itemBase],
        });
        expect(r.success).toBe(true);
        expect(r.success && r.data.purchaseOrderId).toBe('po_123');
    });

    it('purchaseOrderId vacío se rechaza (el form manda undefined, no "")', () => {
        const r = CreatePurchaseSchema.safeParse({
            supplierId: 's1',
            invoiceNumber: 'FAC-77',
            paymentMethod: 'CASH',
            purchaseOrderId: '',
            items: [itemBase],
        });
        expect(r.success).toBe(false);
    });

    it('sigue exigiendo proveedor, factura e ítems', () => {
        expect(CreatePurchaseSchema.safeParse({
            invoiceNumber: 'F', paymentMethod: 'CASH', items: [itemBase],
        }).success).toBe(false);
        expect(CreatePurchaseSchema.safeParse({
            supplierId: 's1', paymentMethod: 'CASH', items: [itemBase],
        }).success).toBe(false);
        expect(CreatePurchaseSchema.safeParse({
            supplierId: 's1', invoiceNumber: 'F', paymentMethod: 'CASH', items: [],
        }).success).toBe(false);
    });
});
