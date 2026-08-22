/**
 * Contrato de entrada de POST /api/purchases.
 *
 * Estos payloads representan el formulario y clientes históricos del API. En especial,
 * <input type="date"> envía YYYY-MM-DD (no un timestamp) y el formulario de
 * contado envía null en campos opcionales.
 */
import { describe, expect, it } from 'vitest';
import { CreatePurchaseSchema } from '../backend/validation/schemas';

const basicItem = {
    productId: 'product-salsa-kerns-jumbo',
    quantity: 12,
    unitCost: 13.5,
};

const cashPurchase = {
    supplierId: 'supplier-pollos-molina',
    invoiceNumber: 'FAC-001',
    date: '2026-08-21',
    paymentMethod: 'CASH' as const,
    items: [basicItem],
};

describe('CreatePurchaseSchema — fechas que realmente envían los formularios', () => {
    it('acepta la compra a crédito con lote reportada por el cliente', () => {
        const result = CreatePurchaseSchema.safeParse({
            supplierId: 'supplier-pollos-molina',
            invoiceNumber: 'FAC-088313330182',
            date: '2026-08-21',
            paymentMethod: 'CREDIT',
            dueDate: '2026-08-25',
            notes: 'pedido diario',
            items: [{
                ...basicItem,
                batchNumber: '088313330182',
                expiryDate: '2027-01-09',
            }],
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.date).toBe('2026-08-21T12:00:00.000Z');
        expect(result.data.dueDate).toBe('2026-08-25T12:00:00.000Z');
        expect(result.data.items[0].expiryDate).toBe('2027-01-09T12:00:00.000Z');
        expect(result.data.items[0].unitCost).toBe('13.5');

        const managuaParts = Object.fromEntries(
            new Intl.DateTimeFormat('en', {
                timeZone: 'America/Managua',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
            }).formatToParts(new Date(result.data.dueDate!))
                .filter(part => part.type !== 'literal')
                .map(part => [part.type, Number(part.value)]),
        );
        expect(managuaParts).toMatchObject({ year: 2026, month: 8, day: 25 });
    });

    it('también acepta datetime ISO cuando incluye offset explícito o Z', () => {
        const result = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            paymentMethod: 'CREDIT',
            dueDate: '2026-08-25T07:49:00-06:00',
            items: [{
                ...basicItem,
                expiryDate: '2027-01-09T00:00:00.000Z',
            }],
        });

        expect(result.success).toBe(true);
    });

    it('acepta null históricos únicamente en campos realmente opcionales', () => {
        const result = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            warehouseId: null,
            dueDate: null,
            notes: null,
            purchaseOrderId: null,
            items: [{
                ...basicItem,
                batchNumber: null,
                expiryDate: null,
            }],
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.warehouseId).toBeUndefined();
        expect(result.data.date).toBe('2026-08-21T12:00:00.000Z');
        expect(result.data.dueDate).toBeUndefined();
        expect(result.data.notes).toBeUndefined();
        expect(result.data.purchaseOrderId).toBeUndefined();
        expect(result.data.items[0].batchNumber).toBeUndefined();
        expect(result.data.items[0].expiryDate).toBeUndefined();
    });

    it('mantiene válida una compra CASH sin dueDate', () => {
        expect(CreatePurchaseSchema.safeParse(cashPurchase).success).toBe(true);
    });
});

describe('CreatePurchaseSchema — integraciones programáticas', () => {
    const integrationPayload = {
        supplierId: 'supplier-smart',
        invoiceNumber: 'FAC-INTEGRACION-001',
        date: '2026-08-21',
        notes: 'Compra generada por integración',
        items: [
            { productId: 'product-a', quantity: 8, unitCost: 24.5 },
            { productId: 'product-b', quantity: 3, unitCost: 9 },
        ],
    };

    it('acepta el payload sin campos de lote cuando se genera de contado', () => {
        expect(CreatePurchaseSchema.safeParse({
            ...integrationPayload,
            warehouseId: 'warehouse-principal',
            paymentMethod: 'CASH',
        }).success).toBe(true);
    });

    it('acepta la variante a crédito cuando incluye su vencimiento', () => {
        expect(CreatePurchaseSchema.safeParse({
            ...integrationPayload,
            paymentMethod: 'CREDIT',
            dueDate: '2026-09-21',
        }).success).toBe(true);
    });
});

describe('CreatePurchaseSchema — rechazos que protegen la persistencia', () => {
    it.each([
        ['omitida', undefined],
        ['null', null],
        ['vacía', ''],
    ])('exige la fecha fiscal cuando viene %s', (_label, date) => {
        const payload: Record<string, unknown> = { ...cashPurchase };
        if (date === undefined) delete payload.date;
        else payload.date = date;
        const result = CreatePurchaseSchema.safeParse(payload);

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues.some(issue => issue.path.join('.') === 'date')).toBe(true);
    });

    it.each([
        ['día inexistente', '2026-02-30'],
        ['año no bisiesto', '2025-02-29'],
        ['mes inexistente', '2026-13-01'],
        ['datetime sin offset', '2026-08-21T07:49:00'],
        ['sufijo parcial', '2026-08-21 basura'],
    ])('rechaza %s en date (%s)', (_label, date) => {
        expect(CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            date,
        }).success).toBe(false);
    });

    it.each([
        ['día inexistente', '2026-02-30'],
        ['año no bisiesto', '2025-02-29'],
        ['mes inexistente', '2026-13-01'],
        ['datetime sin offset', '2026-08-25T07:49:00'],
    ])('rechaza %s en dueDate (%s)', (_label, dueDate) => {
        expect(CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            paymentMethod: 'CREDIT',
            dueDate,
        }).success).toBe(false);
    });

    it.each([
        '2027-02-29',
        '2027-04-31',
        '2027-01-09T00:00:00',
    ])('rechaza expiryDate inválida o sin offset: %s', (expiryDate) => {
        expect(CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            items: [{ ...basicItem, expiryDate }],
        }).success).toBe(false);
    });

    it('acepta el 29 de febrero cuando el año sí es bisiesto', () => {
        expect(CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            date: '2028-02-29',
            paymentMethod: 'CREDIT',
            dueDate: '2028-02-29',
            items: [{ ...basicItem, expiryDate: '2028-02-29' }],
        }).success).toBe(true);
    });

    it.each([
        ['omitido', undefined],
        ['null histórico', null],
        ['vacío', ''],
    ])('exige dueDate para CREDIT cuando viene %s', (_label, dueDate) => {
        const result = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            paymentMethod: 'CREDIT',
            ...(dueDate === undefined ? {} : { dueDate }),
        });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues.some(issue => issue.path.join('.') === 'dueDate')).toBe(true);
    });

    it('acepta purchaseOrderId opcional y rechaza uno vacío', () => {
        const linked = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            purchaseOrderId: 'po-approved-123',
        });
        const empty = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            purchaseOrderId: '',
        });

        expect(linked.success).toBe(true);
        if (linked.success) expect(linked.data.purchaseOrderId).toBe('po-approved-123');
        expect(empty.success).toBe(false);
    });

    it('acepta warehouseId opcional y rechaza uno vacío', () => {
        const linked = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            warehouseId: 'warehouse-principal',
        });
        const empty = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            warehouseId: '',
        });

        expect(linked.success).toBe(true);
        if (linked.success) expect(linked.data.warehouseId).toBe('warehouse-principal');
        expect(empty.success).toBe(false);
    });

    it('normaliza espacios en identificadores y número de factura', () => {
        const result = CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            supplierId: '  supplier-1  ',
            invoiceNumber: '  FAC-001  ',
            items: [{ ...basicItem, productId: '  product-1  ' }],
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.supplierId).toBe('supplier-1');
        expect(result.data.invoiceNumber).toBe('FAC-001');
        expect(result.data.items[0].productId).toBe('product-1');
    });

    it('limita el tamaño de una compra para proteger la transacción', () => {
        expect(CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            items: Array.from({ length: 201 }, (_, index) => ({
                ...basicItem,
                productId: `product-${index}`,
            })),
        }).success).toBe(false);
    });

    it.each([
        ['supplierId', { invoiceNumber: 'FAC-001', date: '2026-08-21', paymentMethod: 'CASH', items: [basicItem] }],
        ['invoiceNumber', { supplierId: 'supplier-1', date: '2026-08-21', paymentMethod: 'CASH', items: [basicItem] }],
        ['paymentMethod', { supplierId: 'supplier-1', invoiceNumber: 'FAC-001', date: '2026-08-21', items: [basicItem] }],
        ['items', { supplierId: 'supplier-1', invoiceNumber: 'FAC-001', date: '2026-08-21', paymentMethod: 'CASH' }],
    ])('rechaza la cabecera sin %s', (_field, payload) => {
        expect(CreatePurchaseSchema.safeParse(payload).success).toBe(false);
    });

    it.each([
        ['productId', { quantity: 1, unitCost: 10 }],
        ['quantity', { productId: 'product-1', unitCost: 10 }],
        ['unitCost', { productId: 'product-1', quantity: 1 }],
    ])('rechaza un ítem sin %s', (_field, item) => {
        expect(CreatePurchaseSchema.safeParse({
            ...cashPurchase,
            items: [item],
        }).success).toBe(false);
    });
});
