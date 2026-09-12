import crypto from 'node:crypto';
import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma';
import { normalizeCalendarDateInput } from '../lib/calendarDate';
import { ProcurementMatchError } from '../lib/procurementMatch';
import { recordPurchase, assertPeriodOpen } from './accounting';
import { applyStockDelta, asegurarBodegaPorDefecto, weightedAverageCost } from './stockService';
import { registrarSalidaDeCajaPorCompra, SupplierPaymentError } from './supplierPayment';
import { executeProcurementMatch } from './procurementMatchService';
import { applyBatchWarehouseDelta, resolveBatchWarehouseLedgerMode } from './productBatchWarehouseLedgerService';
import { assertProductBatchExpiryIdentity } from '../lib/productBatchIdentity';
import { canSetPurchaseSalePrice, hasPurchaseSalePriceIntent, resolvePurchaseSalePriceIntents, buildPurchaseSalePriceChange, applyLinkedPurchaseSalePriceIntents, createPurchaseSalePriceAudits, PurchaseSalePriceError, type PurchaseSalePriceChange } from './purchaseSalePriceService';
import { preparePurchaseContext } from './purchaseRegistrationPreparation';
import { buildPurchasePreview } from './purchaseRegistrationPreview';
import { assertPurchasePrincipal, parsePurchaseIdempotencyKey, parsePurchaseInput, purchasePayloadHash,
    PurchaseRegistrationError, type PurchasePrincipal } from './purchaseRegistrationAuthority';
export { PurchaseRegistrationError, type PurchasePrincipal } from './purchaseRegistrationAuthority';
export type { PurchaseInput } from './purchaseRegistrationPreparation';
export type { PurchasePreview } from './purchaseRegistrationPreview';

export interface PurchaseReceipt { id: string; purchaseOrderId?: string | null; [key: string]: any }
export interface PurchaseRegistrationResult { purchase: PurchaseReceipt; result: PurchaseReceipt; replayed: boolean }
export interface RegisterPurchaseOptions {
    principal: PurchasePrincipal;
    input: unknown;
    idempotencyKey?: string;
    expectedPreviewHash?: string;
    /** Sólo integradores confiables; nunca se acepta del modelo ni del navegador. */
    beforeCommit?: (tx: Prisma.TransactionClient, purchase: PurchaseReceipt) => Promise<void>;
}

async function resolvePurchaseShift(db: any, principal: PurchasePrincipal, paymentMethod: string, required = true) {
    if (paymentMethod !== 'CASH') return null;
    // Igual que una venta: la responsabilidad de la gaveta debe pertenecer al
    // usuario actual. El lock impide un traspaso/cierre entre elegir y debitar.
    // El preview también usa esta autoridad, sin reservar ni mover dinero.
    const [owned] = await db.$queryRaw`
        SELECT id FROM \`Shift\`
        WHERE tenantId = ${principal.tenantId} AND userId = ${principal.userId} AND status = 'OPEN'
        ORDER BY startTime DESC, id DESC LIMIT 1 FOR UPDATE`;
    const shift = owned ? await db.shift.findFirst({
        where: { id: owned.id, tenantId: principal.tenantId, userId: principal.userId, status: 'OPEN' },
        include: { user: { select: { name: true } } },
    }) : null;
    if (!shift && required) throw new SupplierPaymentError('SIN_CAJA_ABIERTA',
        'No hay caja abierta a tu nombre. Abrí una caja o tomá el turno a tu nombre antes de pagar de contado; también podés registrar la compra a crédito.');
    return shift;
}

/** Consulta consistente; no crea bodega, cuentas, compra ni reserva idempotente. */
export async function preparePurchasePreview(
    options: Pick<RegisterPurchaseOptions, 'principal' | 'input'>,
    db: PrismaClient = prisma,
) {
    const input = parsePurchaseInput(options.input);
    if (hasPurchaseSalePriceIntent(input.items) && !canSetPurchaseSalePrice(options.principal.role)) {
        throw new PurchaseRegistrationError('PURCHASE_SALE_PRICE_FORBIDDEN', 403, 'No tenés permiso para modificar precios de venta desde una compra');
    }
    await assertPurchasePrincipal(db, options.principal);
    return db.$transaction(async tx => {
        await assertPurchasePrincipal(tx, options.principal);
        const context = await preparePurchaseContext(tx, options.principal, input);
        const shift = await resolvePurchaseShift(tx, options.principal, input.paymentMethod);
        await assertPeriodOpen(tx, options.principal.tenantId, normalizeCalendarDateInput(input.postingDate));
        return buildPurchasePreview(input, context, shift?.id ?? null, shift);
    });
}

/** Única autoridad de registro para formulario y propuestas de NortexGPT. */
export async function registerPurchase(options: RegisterPurchaseOptions, db: PrismaClient = prisma): Promise<PurchaseRegistrationResult> {
    const { principal, expectedPreviewHash, beforeCommit } = options;
    if (expectedPreviewHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedPreviewHash)) {
        throw new PurchaseRegistrationError('PURCHASE_INVALID_PREVIEW', 400, 'La revisión de la compra no es válida.');
    }
    const input = parsePurchaseInput(options.input);
    if (hasPurchaseSalePriceIntent(input.items) && !canSetPurchaseSalePrice(options.principal.role)) {
        throw new PurchaseRegistrationError('PURCHASE_SALE_PRICE_FORBIDDEN', 403, 'No tenés permiso para modificar precios de venta desde una compra');
    }
    const requestKey = parsePurchaseIdempotencyKey(options.idempotencyKey);
    const payloadHash = purchasePayloadHash(input);
    await assertPurchasePrincipal(db, principal);
    return db.$transaction(async (tx: any) => {
        // Reserva persistente con unique tenant+requestKey. INSERT IGNORE espera al
        // ganador concurrente; la lectura locking ve su comprobante ya confirmado.
        if (requestKey) {
            await tx.purchaseCommand.createMany({ data: [{ tenantId: principal.tenantId,
                userId: principal.userId, requestKey, payloadHash }], skipDuplicates: true });
            const [command] = await tx.$queryRaw`SELECT id, userId, payloadHash, purchaseId, result FROM \`PurchaseCommand\` WHERE \`tenantId\` = ${principal.tenantId} AND \`requestKey\` = ${requestKey} FOR UPDATE`;
            if (!command) throw new PurchaseRegistrationError('PURCHASE_COMMAND_UNAVAILABLE', 409, 'No pudimos reservar la operación. Volvé a intentar.');
            await assertPurchasePrincipal(tx, principal, true);
            if (command.userId !== principal.userId || command.payloadHash !== payloadHash) {
                throw new PurchaseRegistrationError('PURCHASE_IDEMPOTENCY_CONFLICT', 409, 'Ese identificador ya corresponde a otra compra.');
            }
            if (command.purchaseId && command.result) {
                const purchase = (typeof command.result === 'string' ? JSON.parse(command.result) : command.result) as PurchaseReceipt;
                if (purchase.id !== command.purchaseId) throw new PurchaseRegistrationError('PURCHASE_RECEIPT_INVALID', 409, 'El comprobante requiere revisión.');
                return { purchase, result: purchase, replayed: true };
            }
        } else {
            await assertPurchasePrincipal(tx, principal, true);
        }
        const { supplierId, warehouseId, invoiceNumber, date, postingDate, dueDate, paymentMethod, notes, items, purchaseOrderId } = input;
        const salePriceIntents = resolvePurchaseSalePriceIntents(items);
        const salePriceIntentByProduct = new Map(salePriceIntents.map(intent => [intent.productId, intent]));
        const priceChanges: PurchaseSalePriceChange[] = [];
        const directSalePriceProductsProcessed = new Set<string>();
        // Orden existente preservado: Supplier → Product → Shift. El servicio
        // contable resuelve/siembra cada cuenta usando esta misma transacción.
        await tx.$queryRaw`SELECT id FROM \`Supplier\` WHERE id = ${supplierId} AND \`tenantId\` = ${principal.tenantId} FOR UPDATE`;
        if (expectedPreviewHash) {
            // Una confirmación no puede usar IVA/empaques modificados mientras
            // espera stock. Bloqueos sólo de autoridad; no se escribe en el preview.
            await tx.$queryRaw`SELECT id FROM \`Tenant\` WHERE id = ${principal.tenantId} FOR SHARE`;
            if (warehouseId) await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${warehouseId} AND \`tenantId\` = ${principal.tenantId} FOR SHARE`;
            if (purchaseOrderId) await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${purchaseOrderId} AND \`tenantId\` = ${principal.tenantId} FOR UPDATE`;
        }
        const productIds = [...new Set(items.map(item => item.productId))].sort();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM \`Product\` WHERE \`tenantId\` = ${principal.tenantId} AND id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`);
        if (!purchaseOrderId) await asegurarBodegaPorDefecto(tx, principal.tenantId);
        const context = await preparePurchaseContext(tx, principal, input);
        const { operationWarehouse, linkedPurchaseOrder, fiscalRegimeAtPurchase, cuotaFijaPurchase,
            taxTreatment, noTaxReason,
            preparedItems, productsById, purchaseMoney, subtotalAmount, taxAmount, totalAmount, creditableTax } = context;
        // La factura OC valida primero la trazabilidad de recepción/conciliación.
        // Capturar null no autoriza pago; la falta de caja se rechaza tras el match.
        const turnoDeContado = await resolvePurchaseShift(tx, principal, paymentMethod, !linkedPurchaseOrder);
        if (expectedPreviewHash && buildPurchasePreview(input, context, turnoDeContado?.id ?? null, turnoDeContado).hash !== expectedPreviewHash) {
            throw new PurchaseRegistrationError('PURCHASE_PREVIEW_CHANGED', 409, 'La propuesta cambió. Revisá nuevamente sus efectos antes de confirmar.');
        }
        let efectivoAntesCompra: Decimal | null = null;
        let efectivoDespuesCompra: Decimal | null = null;
        // El modo es configuración persistida del tenant, jamás del payload. Se
        // resuelve una sola vez por documento y solo cuando realmente hay una
        // entrada directa con lote; las compras sin lote y las facturas de OC no
        // pagan una lectura ni materializan filas del sidecar.
        const isDirectPurchase = !linkedPurchaseOrder;
        const hasTrackedDirectPurchaseItem = isDirectPurchase && preparedItems.some((item) =>
            productsById.get(item.productId)?.requiresBatchTracking === true);
        const batchWarehouseLedgerMode = hasTrackedDirectPurchaseItem
            ? await resolveBatchWarehouseLedgerMode(tx, principal.tenantId)
            : null;
        const processedItems = preparedItems.map((item, index) => {
            const lineMoney = purchaseMoney.lines[index];
            // `calculatePurchaseMoney` conserva exactamente una salida por
            // entrada; este guard evita persistir una línea sin snapshots si
            // ese contrato cambiara accidentalmente.
            if (!lineMoney) throw new Error('TOTAL_COMPRA_INCONSISTENTE');
            const {
                baseQuantity,
                lineNet: _lineNet,
                taxable,
                ...persisted
            } = item;
            const inventoryLineCost = cuotaFijaPurchase && taxable
                ? lineMoney.lineTotal
                : lineMoney.lineNet;
            return {
                ...persisted,
                // Identidad interna de la línea: el sidecar lote+bodega usa este
                // mismo id persistido y nunca depende del orden de retorno de MySQL.
                // Va después del snapshot para que ninguna ampliación futura del
                // payload preparado pueda reemplazar la autoridad del servidor.
                // Toda línea directa recibe identidad server-side antes de los
                // efectos físicos. Así incluso SKUs duplicados conservan una
                // evidencia de bodega/lote/costo inequívoca para devoluciones.
                ...(isDirectPurchase ? { id: crypto.randomUUID() } : {}),
                averageUnitCost: inventoryLineCost.div(baseQuantity).toString(),
                totalCost: lineMoney.lineNet.toFixed(2),
                taxAmountExact: lineMoney.lineTax.toFixed(2),
                creditableTaxExact: lineMoney.creditableTax.toFixed(2),
                // Con IVA cero por falta de traslación, este booleano es la única
                // forma de saber después si la línea era gravada o exenta.
                taxableAtPurchase: lineMoney.taxable,
            };
        });

        // CASH nace pagada y liquidada en el mismo instante autoritativo.
        const settledNow = paymentMethod === 'CASH' ? new Date() : null;

        // 2. Crear cabecera de compra
        const purchase = await tx.purchase.create({
            data: {
                tenantId: principal.tenantId,
                supplierId,
                invoiceNumber,
                purchaseOrderId: linkedPurchaseOrder?.id ?? null,
                // `date` es obligatorio: inferirlo desde createdAt clasifica
                // mal las facturas retroactivas en constancias/libros/DGI.
                date: normalizeCalendarDateInput(date),
                postingDate: normalizeCalendarDateInput(postingDate ?? date),
                dueDate: dueDate ? normalizeCalendarDateInput(dueDate) : null,
                subtotal: subtotalAmount.toFixed(2),
                tax: taxAmount.toFixed(2),
                fiscalRegimeAtPurchase,
                // Foto de la traslación: se congela con la compra y no se
                // re-deriva del proveedor, que puede cambiar de régimen después.
                taxTreatment,
                noTaxReason,
                taxableSubtotal: purchaseMoney.taxableSubtotal.toFixed(4),
                exemptSubtotal: purchaseMoney.exemptSubtotal.toFixed(4),
                creditableTax: creditableTax.toFixed(2),
                total: totalAmount.toFixed(2),
                documentStatus: 'POSTED',
                matchStatus: 'NOT_REQUIRED',
                paymentHold: false,
                status: paymentMethod === 'CASH' ? 'COMPLETED' : 'PENDING_PAYMENT',
                paymentMethod,
                // El saldo de CxP nace junto con la compra. Los NULL quedan
                // reservados exclusivamente para filas históricas previas al
                // subledger; así un abono parcial nunca depende de inferencias.
                balanceDue: paymentMethod === 'CASH' ? '0.00' : totalAmount.toFixed(2),
                paidAt: settledNow,
                settledAt: settledNow,
                notes: notes || null,
                createdBy: principal.userId,
                items: {
                    create: processedItems.map(({
                        stockQuantity: _stockQuantity,
                        unit: _unit,
                        averageUnitCost: _averageUnitCost,
                        ...persisted
                    }) => persisted),
                }
            },
            include: { items: true, supplier: true }
        });

        // La conciliación toma la línea de OC como identidad y reserva las
        // recepciones antes de cualquier efecto financiero. Una compra CASH
        // fuera de tolerancia falla aquí y revierte la factura completa.
        const procurementMatch = await executeProcurementMatch({
            tx,
            tenantId: principal.tenantId,
            userId: principal.userId,
            purchaseId: purchase.id,
        });
        if (paymentMethod === 'CASH' && !turnoDeContado) {
            throw new SupplierPaymentError('SIN_CAJA_ABIERTA',
                'No hay caja abierta. Abrí una caja para registrar una compra de contado, o registrala a crédito.');
        }
        // executeProcurementMatch materializa identidad OC y snapshots exactos
        // mediante UPDATE SQL. El objeto devuelto por purchase.create conserva
        // los items previos; refrescarlos evita responder costos/variancias stale.
        const matchedPurchaseItems = await tx.purchaseItem.findMany({
            where: {
                purchaseId: purchase.id,
                purchase: { tenantId: principal.tenantId },
            },
            orderBy: { id: 'asc' },
        });
        if (matchedPurchaseItems.length !== purchase.items.length) {
            throw new ProcurementMatchError(
                'PURCHASE_ITEM_REFRESH_FAILED',
                409,
                'No se pudieron confirmar todas las líneas conciliadas de la factura',
            );
        }

        // 3. Actualizar inventario + Kardex + Costo promedio ponderado. Si hay OC,
        // la recepción es la única responsable de estos movimientos.
        const costChanges: any[] = []; // before/after de stock y costo valorizado por producto
        // Dos compras directas de proveedores distintos no comparten el lock
        // inicial del Supplier. Ejecutar [P1,P2] y [P2,P1] en paralelo podía
        // ciclar los locks Product/ProductStock. La copia ordenada afecta solo
        // efectos físicos; no cambia el orden ni la identidad de PurchaseItem.
        const inventoryMutationItems = linkedPurchaseOrder
            ? []
            : [...processedItems].sort((left, right) =>
                left.productId.localeCompare(right.productId)
                || (left.batchNumber ?? '').localeCompare(right.batchNumber ?? '')
                || (left.id ?? '').localeCompare(right.id ?? ''));
        for (const item of inventoryMutationItems) {
            const product = productsById.get(item.productId);
            if (!product) continue;

            // Stock por applyStockDelta: incremento ATÓMICO (sin lost-update del
            // patrón leer→escribir absoluto) + doble escritura del desglose por
            // bodega (invariante multi-bodega: Σ bodegas == agregado).
            const { stockBefore, stockAfter, warehouseId: purchaseWarehouseId } = await applyStockDelta(tx, {
                tenantId: principal.tenantId,
                productId: item.productId,
                delta: item.stockQuantity,
                enforceSufficient: false,
                warehouseId: operationWarehouse?.id,
            });
            const oldStock = stockBefore;
            const newStock = stockAfter;

            // C2 — costo viejo re-leído con la fila YA BLOQUEADA por applyStockDelta
            // (FOR UPDATE). El `product.cost` de arriba viene de un findUnique
            // NO-bloqueante ANTES del lock: bajo REPEATABLE READ es el snapshot de la
            // tx y puede estar STALE si una compra concurrente del MISMO producto ya
            // movió el costo → el promedio mezclaría stock nuevo con costo viejo
            // (ej. graba 6.3333 donde lo correcto era 7.00). La lectura locking
            // devuelve el costo comprometido más reciente.
            const lockedProductRows: any[] = await tx.$queryRaw`SELECT cost, price FROM \`Product\` WHERE id = ${item.productId} AND \`tenantId\` = ${principal.tenantId} FOR UPDATE`;
            const lockedProduct = lockedProductRows[0];
            if (!lockedProduct) throw new PurchaseSalePriceError('PURCHASE_PRODUCT_NOT_FOUND', 404, `Producto no encontrado: ${item.productId}`);
            const oldCost = new Decimal(lockedProduct.cost.toString());
            const priceChange = buildPurchaseSalePriceChange(item.productId, lockedProduct.price,
                directSalePriceProductsProcessed.has(item.productId) ? undefined : salePriceIntentByProduct.get(item.productId));

            // Promedio ponderado móvil (función pura compartida — regla C1 adentro).
            const newAvgCost = weightedAverageCost(
                oldStock,
                oldCost,
                item.quantityExact,
                item.averageUnitCost,
            ).toNumber();

            await tx.product.update({
                where: { id: item.productId, tenantId: principal.tenantId },
                data: {
                    ...(priceChange ? { price: new Decimal(priceChange.priceAfter).toNumber(), promotionPriceVersion: { increment: 1 } } : {}),
                    cost: newAvgCost  // ya redondeado a 4 d.p. por Decimal
                }
            });

            directSalePriceProductsProcessed.add(item.productId);
            if (priceChange) priceChanges.push(priceChange);
            costChanges.push({
                productId: item.productId,
                stockBefore: oldStock,
                stockAfter: newStock,
                costBefore: oldCost.toNumber(),
                costAfter: newAvgCost,
                quantityExact: item.quantityExact,
                unit: item.unit,
            });

            // Control de Lotes
            let batchId = null;
            if (product.requiresBatchTracking && item.batchNumber && item.expiryDate) {
                const existingBatches: Array<{ id: string; expiryDate: Date }> = await tx.$queryRaw`
                    SELECT id, expiryDate
                    FROM \`ProductBatch\`
                    WHERE tenantId = ${principal.tenantId}
                      AND productId = ${item.productId}
                      AND batchNumber = ${item.batchNumber}
                    FOR UPDATE`;
                const existingBatch = existingBatches[0] ?? null;
                if (existingBatch) {
                    assertProductBatchExpiryIdentity({
                        productId: item.productId,
                        productName: product.name,
                        batchNumber: item.batchNumber,
                        existingExpiryDate: existingBatch.expiryDate,
                        incomingExpiryDate: item.expiryDate,
                    });
                }
                if (existingBatch) {
                    const updatedBatch = await tx.productBatch.updateMany({
                        where: {
                            id: existingBatch.id,
                            tenantId: principal.tenantId,
                            productId: item.productId,
                        },
                        data: { stock: { increment: item.stockQuantity } },
                    });
                    if (updatedBatch.count !== 1) {
                        throw new Error('PURCHASE_BATCH_CONCURRENT_WRITE');
                    }
                    batchId = existingBatch.id;
                } else {
                    const createdBatch = await tx.productBatch.create({
                        data: {
                            tenantId: principal.tenantId,
                            productId: item.productId,
                            batchNumber: item.batchNumber,
                            // `processedItems` ya normalizó la fecha calendario a Date.
                            expiryDate: item.expiryDate,
                            stock: item.stockQuantity,
                        },
                        select: { id: true },
                    });
                    batchId = createdBatch.id;
                }

                // Sidecar exacto lote+bodega. Product/ProductStock, ProductBatch
                // y Kardex siguen siendo los agregados legacy; cualquier fallo
                // acá aborta la misma tx antes del Kardex y la auditoría final.
                if (batchWarehouseLedgerMode === 'SHADOW' || batchWarehouseLedgerMode === 'ENFORCED') {
                    if (!item.id) throw new Error('PURCHASE_ITEM_ID_REQUIRED');
                    await applyBatchWarehouseDelta({
                        tx,
                        mode: batchWarehouseLedgerMode,
                        tenantId: principal.tenantId,
                        productId: item.productId,
                        batchId: batchId!,
                        warehouseId: purchaseWarehouseId,
                        delta: item.quantityExact,
                        movementType: 'DIRECT_PURCHASE',
                        referenceId: purchase.id,
                        referenceType: 'PURCHASE',
                        userId: principal.userId,
                        reason: `Compra Factura #${invoiceNumber}`,
                        sourceKey: `direct-purchase:${purchase.id}:item:${item.id}`,
                        allowNegative: false,
                    });
                }
            }

            // Evidencia física de la entrada directa. Se escribe únicamente
            // después de confirmar stock y lote; count!=1 aborta toda la tx.
            if (!item.id) throw new Error('PURCHASE_ITEM_ID_REQUIRED');
            const evidenceWrite = await tx.purchaseItem.updateMany({
                where: { id: item.id, purchaseId: purchase.id },
                data: {
                    inventoryWarehouseId: purchaseWarehouseId,
                    inventoryBatchId: batchId,
                    inventoryUnitCostExact: new Decimal(item.averageUnitCost)
                        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
                        .toFixed(6),
                },
            });
            if (evidenceWrite.count !== 1) {
                throw new Error('PURCHASE_ITEM_INVENTORY_EVIDENCE_WRITE_FAILED');
            }

            // Kardex: Registro de entrada por compra
            await tx.kardexMovement.create({
                data: {
                    tenantId: principal.tenantId,
                    productId: item.productId,
                    type: 'IN_PURCHASE',
                    quantity: item.stockQuantity,
                    stockBefore: oldStock,
                    stockAfter: newStock,
                    referenceId: purchase.id,
                    referenceType: 'PURCHASE',
                    reason: `Compra Factura #${invoiceNumber}`,
                    userId: principal.userId,
                    batchId: batchId,
                    // Bodega real del movimiento (la default hoy): sin esto la
                    // reconstrucción del stock por bodega desde Kardex queda coja.
                    warehouseId: purchaseWarehouseId
                }
            });
        }

        // 4. Registro financiero — LA PLATA SALE DE LA GAVETA, no de la
        //    billetera fintech (`Tenant.walletBalance`, que se fondea con
        //    /api/loans/request y solo se gasta en el marketplace B2B).
        //    Antes se debitaba esa billetera y, como ninguna PyME la tiene
        //    fondeada, TODA compra de contado moría con "SALDO_INSUFICIENTE …
        //    recarga tu billetera" aunque hubiera efectivo real en la caja.
        //    El asiento de `recordPurchase` ya acreditaba Caja (1.1.1): la
        //    billetera nunca fue la contrapartida correcta.
        if (linkedPurchaseOrder && salePriceIntents.length > 0) {
            priceChanges.push(...await applyLinkedPurchaseSalePriceIntents({ tx, tenantId: principal.tenantId, intents: salePriceIntents }));
        }

        if (paymentMethod === 'CASH') {
            // El turno se resolvió en esta transacción; el helper lo valida bajo lock.
            const salida = await registrarSalidaDeCajaPorCompra(tx, {
                tenantId: principal.tenantId,
                userId: principal.userId,
                shiftId: turnoDeContado!.id,
                invoiceNumber,
                supplierName: purchase.supplier.name,
                total: totalAmount,
            });
            efectivoAntesCompra = salida.efectivoAntes;
            efectivoDespuesCompra = salida.efectivoDespues;
        }
        // Si es CREDIT, no se descuenta dinero - queda como cuenta por pagar

        // A1: ASIENTO CONTABLE de la compra. Antes NO se posteaba ninguno
        // (`recordPurchase` estaba importada pero nunca se llamaba), así que
        // Inventario (1.1.4) solo DECRECÍA por el COGS de las ventas y llegaba a
        // saldo negativo con stock físico real; IVA Crédito (1.1.5) y CxP (2.1.1)
        // quedaban permanentemente en cero y la utilidad salía inflada.
        // Va DENTRO de la tx y sin try/catch: si el asiento no se puede registrar
        // (p. ej. período cerrado), la compra entera se revierte — el dinero y el
        // inventario NO se mueven sin su contrapartida contable.
        await recordPurchase(
            tx as Parameters<typeof recordPurchase>[0],
            principal.tenantId,
            principal.userId,
            purchase.id,
            totalAmount.toFixed(2),
            taxAmount.toFixed(2),
            paymentMethod,
            creditableTax.toFixed(2),
            normalizeCalendarDateInput(postingDate ?? date),
            linkedPurchaseOrder ? procurementMatch.plan.expectedAmount : undefined,
        );

        await createPurchaseSalePriceAudits({ tx, tenantId: principal.tenantId, userId: principal.userId,
            purchaseId: purchase.id, purchaseOrderId: linkedPurchaseOrder?.id ?? null, invoiceNumber, changes: priceChanges });

        // Asiento inmutable de auditoría (Capa 3): toda compra mueve su efecto
        // financiero; solo una compra directa mueve además inventario valorizado.
        // Registrar el before/after de la GAVETA (null si fue a crédito: ahí no
        // sale efectivo) y los cambios de stock/costo aplicados.
        await tx.auditLog.create({
            data: {
                tenantId: principal.tenantId,
                userId: principal.userId,
                action: 'PURCHASE_CREATED',
                details: JSON.stringify({
                    purchaseId: purchase.id,
                    supplierId,
                    invoiceNumber,
                    purchaseOrderId: linkedPurchaseOrder?.id ?? null,
                    warehouseId: operationWarehouse?.id ?? null,
                    paymentMethod,
                    subtotal: subtotalAmount.toString(),
                    taxableSubtotal: purchaseMoney.taxableSubtotal.toString(),
                    exemptSubtotal: purchaseMoney.exemptSubtotal.toString(),
                    tax: taxAmount.toString(),
                    creditableTax: creditableTax.toString(),
                    fiscalRegime: fiscalRegimeAtPurchase,
                    // La auditoría explica POR QUÉ el IVA fue cero: sin esto un
                    // revisor no puede distinguir una factura sin traslación de
                    // una compra íntegramente exenta.
                    taxTreatment,
                    noTaxReason,
                    total: totalAmount.toString(),
                    matchStatus: procurementMatch.matchStatus,
                    paymentHold: procurementMatch.paymentHold,
                    priceTolerancePct: procurementMatch.priceTolerancePct,
                    shiftId: turnoDeContado?.id ?? null,
                    efectivoAntes: efectivoAntesCompra?.toNumber() ?? null,
                    efectivoDespues: efectivoDespuesCompra?.toNumber() ?? null,
                    productChanges: costChanges,
                    priceChanges,
                    timestamp: new Date().toISOString()
                })
            }
        });

        const completedPurchase = {
            ...purchase,
            items: matchedPurchaseItems,
            matchStatus: procurementMatch.matchStatus,
            paymentHold: procurementMatch.paymentHold,
        };
        // La propuesta se finaliza junto con compra, Kardex, caja, asiento y auditoría.
        if (beforeCommit) await beforeCommit(tx, completedPurchase);
        const receipt: PurchaseReceipt = JSON.parse(JSON.stringify(completedPurchase));
        if (requestKey) {
            const saved = await tx.purchaseCommand.updateMany({
                where: { tenantId: principal.tenantId, userId: principal.userId, requestKey, payloadHash, purchaseId: null },
                data: { purchaseId: purchase.id, result: receipt },
            });
            if (saved.count !== 1) throw new PurchaseRegistrationError('PURCHASE_RECEIPT_CONFLICT', 409, 'No pudimos confirmar el comprobante de la operación.');
        }
        return { purchase: receipt, result: receipt, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
