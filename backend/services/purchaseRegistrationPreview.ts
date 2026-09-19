import type { PurchaseInput, preparePurchaseContext } from './purchaseRegistrationPreparation';
import { purchasePayloadHash } from './purchaseRegistrationAuthority';

export function buildPurchasePreview(input: PurchaseInput, context: Awaited<ReturnType<typeof preparePurchaseContext>>, shiftId: string | null, shift?: { user?: { name: string }; startTime?: Date } | null) {
    const { supplier, operationWarehouse, linkedPurchaseOrder, linkedProductAvailability,
        fiscalRegimeAtPurchase, preparedItems, productsById, purchaseMoney } = context;
    const lines = preparedItems.map((item, index) => ({
        productId: item.productId, productName: item.productName, quantity: item.quantityExact,
        unit: item.unit, unitCost: item.unitCostExact, subtotal: purchaseMoney.lines[index].lineNet.toFixed(2),
        tax: purchaseMoney.lines[index].lineTax.toFixed(2), total: purchaseMoney.lines[index].lineTotal.toFixed(2),
        batchNumber: item.batchNumber, expiryDate: item.expiryDate?.toISOString().slice(0, 10) ?? null,
    }));
    const effects = {
        input, supplier: { id: supplier.id, name: supplier.name },
        warehouseId: operationWarehouse?.id ?? null,
        warehouseName: operationWarehouse?.name ?? null,
        purchaseOrderId: linkedPurchaseOrder?.id ?? null, shiftId,
        shiftLabel: shiftId ? `${shift?.user?.name ?? 'Caja del negocio'} · ${shift?.startTime ? shift.startTime.toISOString() : shiftId}` : null,
        fiscalRegime: fiscalRegimeAtPurchase, currency: 'NIO' as const,
        subtotal: purchaseMoney.subtotal.toFixed(2), tax: purchaseMoney.tax.toFixed(2),
        creditableTax: purchaseMoney.creditableTax.toFixed(2), total: purchaseMoney.total.toFixed(2),
        cashOutflow: input.paymentMethod === 'CASH' ? purchaseMoney.total.toFixed(2) : '0.00',
        payableIncrease: input.paymentMethod === 'CREDIT' ? purchaseMoney.total.toFixed(2) : '0.00',
        stockChanges: linkedPurchaseOrder ? [] : lines.map(({ productId, productName, quantity, unit, batchNumber, expiryDate }) =>
            ({ productId, productName, quantity, unit, batchNumber, expiryDate })),
        lines,
    };
    const hash = purchasePayloadHash({
        version: 1, effects,
        supplierStatus: supplier.status, supplierDeletedAt: supplier.deletedAt,
        products: [...productsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
        orderStatus: linkedPurchaseOrder?.status ?? null,
        orderItems: linkedPurchaseOrder?.items ?? null,
        available: linkedProductAvailability ? [...linkedProductAvailability.entries()].map(([id, value]) =>
            [id, value.remaining.toString()]).sort(([a], [b]) => a.localeCompare(b)) : null,
    });
    return { ...effects, hash };
}

export type PurchasePreview = ReturnType<typeof buildPurchasePreview>;
