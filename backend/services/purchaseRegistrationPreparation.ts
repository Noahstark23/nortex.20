import Decimal from 'decimal.js';
import type { z } from 'zod';
import { CreatePurchaseSchema } from '../validation/schemas';
import { normalizeCalendarDateInput } from '../lib/calendarDate';
import { calculatePurchaseOrderInvoiceAvailability } from '../lib/purchaseOrderAvailability';
import { purchaseOrderRulesForReceipt } from '../../utils/purchaseOrderQuantities';
import { calculatePurchaseMoney } from '../lib/purchaseMoney';
import { resolveOperationalWarehouse } from './stockService';
import { resolvePurchaseLine } from '../../utils/purchasePackaging';
import { QuantityValidationError, type SaleMode } from '../../utils/quantity';
import { FISCAL_REGIME_CUOTA_FIJA, normalizeFiscalRegime } from '../../utils/fiscalRegime';
import {
    purchaseTaxTreatmentIssue,
    purchaseTransfersTax,
    type PurchaseTaxTreatment,
} from '../../utils/purchaseTaxTreatment';
import { PurchaseRegistrationError, type PurchasePrincipal } from './purchaseRegistrationAuthority';

export type PurchaseInput = z.infer<typeof CreatePurchaseSchema>;
const legacyPurchaseQuantity = (quantity: Decimal): number => {
    if (quantity.isInteger() && quantity.lessThanOrEqualTo(2_147_483_647)) return quantity.toNumber();
    return Decimal.min(quantity.ceil(), 2_147_483_647).toNumber();
};

/** Preparación determinista compartida: solamente lecturas, sin semillas ni efectos. */
export async function preparePurchaseContext(tx: any, principal: PurchasePrincipal, input: PurchaseInput) {
    const { supplierId, warehouseId, invoiceNumber, items, purchaseOrderId } = input;
    // La traslación viaja declarada y validada por Zod; se re-verifica acá para
    // que ningún caller interno (asistente incluido) pueda saltarse la regla.
    const taxTreatment: PurchaseTaxTreatment = input.taxTreatment;
    const noTaxReason = input.noTaxReason ?? null;
    const treatmentIssue = purchaseTaxTreatmentIssue(taxTreatment, noTaxReason);
    if (treatmentIssue === 'REASON_REQUIRED') {
        throw new PurchaseRegistrationError(
            'PURCHASE_NO_TAX_REASON_REQUIRED', 400,
            'Indicá por qué la factura no trae IVA',
        );
    }
    if (treatmentIssue === 'REASON_NOT_APPLICABLE') {
        throw new PurchaseRegistrationError(
            'PURCHASE_NO_TAX_REASON_NOT_APPLICABLE', 400,
            'Una factura que traslada IVA no lleva motivo de no traslación',
        );
    }
    // Verificar propiedad del proveedor: nunca confiar en supplierId del body sin
    // scoping por tenant. Sin esto, el include: { supplier: true } filtraría PII
    // del proveedor de otro tenant (fuga cross-tenant).
    const supplier = await tx.supplier.findFirst({
        where: {
            id: supplierId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
        },
    });
    if (!supplier) {
        throw new Error('Proveedor no encontrado o no está activo');
    }
    // Una compra directa siempre tiene ubicación. Clientes anteriores
    // pueden omitirla solo cuando el negocio mantiene una única bodega
    // activa; con multi-bodega la ambigüedad se rechaza.
    const operationWarehouse = purchaseOrderId
        ? null
        : await resolveOperationalWarehouse(tx, principal.tenantId, warehouseId);

    const existingInvoice = await tx.purchase.findFirst({
        where: { tenantId: principal.tenantId, supplierId, invoiceNumber },
        select: { id: true },
    });
    if (existingInvoice) {
        throw new Error('FACTURA_DUPLICADA');
    }

    // Una OC ya mueve (o moverá) las existencias mediante su recepción. La
    // factura vinculada registra únicamente el efecto financiero para evitar
    // duplicar stock, costo promedio, lotes y Kardex.
    let linkedPurchaseOrder: {
        id: string;
        supplierId: string;
        status: string;
        items: {
            id: string;
            productId: string;
            productName: string;
            quantityReceived: number | string;
            quantityReceivedExact: Decimal | null;
            quantityOrdered: number | string;
            quantityOrderedExact: Decimal | null;
            unitAtOrder: string | null;
            saleModeAtOrder: string | null;
            quantityStepAtOrder: Decimal | null;
        }[];
        receipts: {
            items: { productId: string; quantity: number; quantityExact: Decimal | null }[];
        }[];
    } | null = null;
    if (purchaseOrderId) {
        linkedPurchaseOrder = await tx.purchaseOrder.findFirst({
            where: { id: purchaseOrderId, tenantId: principal.tenantId },
            select: {
                id: true,
                supplierId: true,
                status: true,
                items: {
                    select: {
                        id: true,
                        productId: true,
                        productName: true,
                        quantityReceived: true,
                        quantityReceivedExact: true,
                        quantityOrdered: true,
                        quantityOrderedExact: true,
                        unitAtOrder: true,
                        saleModeAtOrder: true,
                        quantityStepAtOrder: true,
                    },
                },
                receipts: {
                    select: {
                        items: {
                            select: { productId: true, quantity: true, quantityExact: true },
                        },
                    },
                },
            },
        });
        if (!linkedPurchaseOrder) {
            throw new Error('OC_NO_ENCONTRADA');
        }
        if (linkedPurchaseOrder.supplierId !== supplierId) {
            throw new Error('OC_DE_OTRO_PROVEEDOR');
        }
        if (!['PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED_SHORT'].includes(linkedPurchaseOrder.status)) {
            throw new Error(`OC_ESTADO:${linkedPurchaseOrder.status}`);
        }
    }
    // Disponibilidad facturable por producto = recibido físicamente menos
    // lo ya incluido en facturas anteriores de la misma OC. Sin este saldo,
    // una segunda factura parcial podía volver a cobrar todas las unidades
    // recibidas desde el inicio.
    const linkedProductAvailability = linkedPurchaseOrder
        ? calculatePurchaseOrderInvoiceAvailability(
            linkedPurchaseOrder.items,
            linkedPurchaseOrder.receipts,
        )
        : null;
    const requestedFromLinkedPO = new Map<string, Decimal>();

    // El régimen sale del tenant autenticado y se congela junto con la
    // compra dentro de esta misma transacción. Nunca se acepta del body.
    const tenantFiscal = await tx.tenant.findUnique({
        where: { id: principal.tenantId },
        select: { fiscalRegime: true },
    });
    if (!tenantFiscal) throw new Error('TENANT_NOT_FOUND');
    const fiscalRegimeAtPurchase = normalizeFiscalRegime(tenantFiscal.fiscalRegime);
    const cuotaFijaPurchase = fiscalRegimeAtPurchase === FISCAL_REGIME_CUOTA_FIJA;

    // 1. Calcular totales. T2 Fase 2 — el crédito fiscal (IVA de compras)
    //    se genera SOLO por los ítems GRAVADOS. Antes se aplicaba 15% a
    //    TODO el subtotal, así que una farmacia que compra medicamentos
    //    exonerados se acreditaba un crédito fiscal INEXISTENTE (menos IVA
    //    a pagar del que corresponde). `product.ivaExento` es autoritativo
    //    (viene de la BD scoped por tenant, nunca del cliente).
    interface PreparedPurchaseItem {
        productId: string;
        productName: string;
        purchaseOrderItemId: string | null;
        quantity: number;
        quantityExact: string;
        baseQuantity: Decimal;
        stockQuantity: number;
        unit: string;
        unitCost: string;
        unitCostExact: string;
        lineNet: Decimal;
        taxable: boolean;
        batchNumber: string | null;
        expiryDate: Date | null;
    }
    const preparedItems: PreparedPurchaseItem[] = [];

    const productIds = [...new Set(items.map((item: any) => String(item.productId)))];
    const ownedProducts: Array<{
        id: string;
        name: string;
        unit: string;
        ivaExento: boolean;
        requiresBatchTracking: boolean;
        saleMode: SaleMode | null;
        quantityStep: any;
        packUnit: string | null;
        packSize: number | null;
    }> = await tx.product.findMany({
        where: { id: { in: productIds }, tenantId: principal.tenantId },
        take: 200,
        select: {
            id: true,
            name: true,
            unit: true,
            ivaExento: true,
            requiresBatchTracking: true,
            saleMode: true,
            quantityStep: true,
            packUnit: true,
            packSize: true,
        },
    });
    const productsById = new Map<string, (typeof ownedProducts)[number]>(
        ownedProducts.map((product) => [product.id, product]),
    );

    for (const item of items) {
        const product = productsById.get(item.productId);

        if (!product) {
            throw new Error(`Producto no encontrado: ${item.productId}`);
        }

        const orderCandidates = linkedPurchaseOrder?.items.filter(orderItem => orderItem.productId === item.productId) ?? [];
        const orderItem = item.purchaseOrderItemId
            ? orderCandidates.find(candidate => candidate.id === item.purchaseOrderItemId)
            : orderCandidates.length === 1 ? orderCandidates[0] : undefined;
        if (linkedPurchaseOrder && !orderItem) throw new Error(`ITEM_OC_INVALIDO|${product.name}`);
        // La factura de una recepción conserva su unidad y regla histórica;
        // inferir el modo nuevo del catálogo puede impedir facturar lo ya recibido.
        const quantityAuthority = orderItem
            ? { ...product, ...purchaseOrderRulesForReceipt(orderItem, product), unit: orderItem.unitAtOrder ?? product.unit }
            : product;
        let resolvedLine: ReturnType<typeof resolvePurchaseLine>;
        try {
            resolvedLine = resolvePurchaseLine({ quantity: item.quantity, unitCost: item.unitCost, purchaseUnit: item.purchaseUnit }, quantityAuthority);
        } catch (error) {
            if (error instanceof QuantityValidationError) {
                throw new QuantityValidationError(error.code, `${product.name}: ${error.message}`);
            }
            throw error;
        }
        const exactQuantity = resolvedLine.baseQuantity;
        // PurchaseItem.unitCost sigue siendo Decimal(10,2) legacy; el
        // snapshot nuevo conserva seis decimales del costo base resuelto.
        const unitCost = resolvedLine.baseUnitCost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const linkedItem = linkedProductAvailability?.get(item.productId);
        if (linkedProductAvailability && !linkedItem) {
            throw new Error(`ITEM_FUERA_DE_OC|${product.name}`);
        }
        if (item.purchaseOrderItemId) {
            const explicitOrderItem = linkedPurchaseOrder?.items.find(
                (orderItem) => orderItem.id === item.purchaseOrderItemId,
            );
            if (!explicitOrderItem || explicitOrderItem.productId !== item.productId) {
                throw new Error(`ITEM_OC_INVALIDO|${product.name}`);
            }
        }
        if (linkedItem) {
            const remainingToInvoice = linkedItem.remaining;
            const requested = (requestedFromLinkedPO.get(item.productId) ?? new Decimal(0))
                .plus(exactQuantity);
            if (remainingToInvoice.lte(0) || requested.greaterThan(remainingToInvoice)) {
                throw new Error(`CANTIDAD_SUPERA_RECEPCION|${linkedItem.productName}|${Decimal.max(0, remainingToInvoice).toString()}`);
            }
            requestedFromLinkedPO.set(item.productId, requested);
        }

        if (!linkedPurchaseOrder && product.requiresBatchTracking && (!item.batchNumber || !item.expiryDate)) {
            throw new Error(`LOTE_REQUERIDO|${product.name}`);
        }

        preparedItems.push({
            productId:   item.productId,
            productName: product.name,
            purchaseOrderItemId: item.purchaseOrderItemId ?? null,
            quantity:    legacyPurchaseQuantity(exactQuantity),
            quantityExact: exactQuantity.toFixed(),
            baseQuantity: exactQuantity,
            stockQuantity: exactQuantity.toNumber(),
            unit: quantityAuthority.unit,
            unitCost:    unitCost.toFixed(2),
            unitCostExact: resolvedLine.baseUnitCost
                .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
                .toFixed(6),
            // Recalcular desde los operandos Decimal preserva el importe
            // previo al redondeo; purchaseMoney aplica HALF_UP explícito.
            lineNet: resolvedLine.visibleQuantity.mul(resolvedLine.visibleUnitCost),
            taxable: !product.ivaExento,
            batchNumber: item.batchNumber || null,
            expiryDate:  item.expiryDate ? normalizeCalendarDateInput(item.expiryDate) : null
        });
    }

    // Igual que la recepción de OC: un número de lote conserva su vencimiento.
    // Dos líneas o dos facturas nunca reinterpretan la misma existencia física.
    const trackedLines = linkedPurchaseOrder ? [] : preparedItems.filter(item =>
        productsById.get(item.productId)?.requiresBatchTracking && item.batchNumber && item.expiryDate);
    if (trackedLines.length) {
        const existingBatches: Array<{ productId: string; batchNumber: string; expiryDate: Date }> = await tx.productBatch.findMany({
            where: { tenantId: principal.tenantId, OR: trackedLines.map(item => ({ productId: item.productId, batchNumber: item.batchNumber })) },
            select: { productId: true, batchNumber: true, expiryDate: true },
            take: 200,
        });
        const dates = new Map(existingBatches.map(batch => [JSON.stringify([batch.productId, batch.batchNumber]), batch.expiryDate.toISOString().slice(0, 10)]));
        for (const item of trackedLines) {
            const key = JSON.stringify([item.productId, item.batchNumber]);
            const expiryDate = item.expiryDate!.toISOString().slice(0, 10);
            if (dates.has(key) && dates.get(key) !== expiryDate) {
                throw new PurchaseRegistrationError('BATCH_EXPIRY_CONFLICT', 409,
                    `El lote ${item.batchNumber} de ${item.productName} ya tiene otro vencimiento.`);
            }
            dates.set(key, expiryDate);
        }
    }

    // La factura, el subledger y el mayor se liquidan por línea a centavos.
    // Sumar IVA sobre la base agregada dejaba casos como C$0.10 + C$0.015
    // persistidos en balanceDue (4dp) aunque Purchase.total y el mayor son 2dp.
    const purchaseMoney = calculatePurchaseMoney(
        preparedItems.map((item) => ({ lineNet: item.lineNet, taxable: item.taxable })),
        !cuotaFijaPurchase,
        taxTreatment,
    );
    const subtotalAmount = purchaseMoney.subtotal;
    const taxAmount = purchaseMoney.tax;
    const totalAmount = purchaseMoney.total;
    const creditableTax = purchaseMoney.creditableTax;
    // Invariante del documento sin traslación: el papel dice `subtotal` y eso es
    // exactamente lo que debe llegar a la CxP, la gaveta y el mayor. Se afirma
    // acá, antes de cualquier efecto, y no se confía solo en el cálculo.
    if (!purchaseTransfersTax(taxTreatment)
        && !(taxAmount.isZero() && creditableTax.isZero() && totalAmount.equals(subtotalAmount))) {
        throw new PurchaseRegistrationError(
            'PURCHASE_NO_TAX_INVARIANT', 500,
            'Una factura sin traslación de IVA no puede registrar impuesto',
        );
    }
    return { supplier, operationWarehouse, linkedPurchaseOrder, linkedProductAvailability,
        fiscalRegimeAtPurchase, cuotaFijaPurchase, taxTreatment, noTaxReason,
        preparedItems, productsById,
        purchaseMoney, subtotalAmount, taxAmount, totalAmount, creditableTax };
}
