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

async function resolvePurchaseShift(db: any, principal: PurchasePrincipal, paymentMethod: string) {
    if (paymentMethod !== 'CASH') return null;
    const shift = await db.shift.findFirst({
        where: { tenantId: principal.tenantId, userId: principal.userId, status: 'OPEN' },
        orderBy: { startTime: 'desc' },
        include: { user: { select: { name: true } } },
    }) ?? await db.shift.findFirst({
        where: { tenantId: principal.tenantId, status: 'OPEN' },
        orderBy: { startTime: 'desc' },
        include: { user: { select: { name: true } } },
    });
    if (!shift) throw new SupplierPaymentError('SIN_CAJA_ABIERTA',
        'No hay caja abierta. Abrí una caja para registrar una compra de contado, o registrala a crédito.');
    return shift;
}

/** Consulta consistente; no crea bodega, cuentas, compra ni reserva idempotente. */
export async function preparePurchasePreview(
    options: Pick<RegisterPurchaseOptions, 'principal' | 'input'>,
    db: PrismaClient = prisma,
) {
    const input = parsePurchaseInput(options.input);
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
            preparedItems, productsById, purchaseMoney, subtotalAmount, taxAmount, totalAmount, creditableTax } = context;
        const turnoDeContado = await resolvePurchaseShift(tx, principal, paymentMethod);
        if (expectedPreviewHash && buildPurchasePreview(input, context, turnoDeContado?.id ?? null, turnoDeContado).hash !== expectedPreviewHash) {
            throw new PurchaseRegistrationError('PURCHASE_PREVIEW_CHANGED', 409, 'La propuesta cambió. Revisá nuevamente sus efectos antes de confirmar.');
        }
        let efectivoAntesCompra: Decimal | null = null;
        let efectivoDespuesCompra: Decimal | null = null;
        // El modo es configuración persistida del tenant, jamás del payload. Se
        // resuelve una sola vez por documento y solo cuando realmente hay una
        // entrada directa con lote; las compras sin lote y las facturas de OC no
        // pagan una lectura ni materializan filas del sidecar.
        const batchWarehouseLedgerMode = !linkedPurchaseOrder && preparedItems.some((item) =>
            productsById.get(item.productId)?.requiresBatchTracking === true)
            ? await resolveBatchWarehouseLedgerMode(tx, principal.tenantId)
            : null;
        const processedItems = preparedItems.map((item, index) => {
            const lineMoney = purchaseMoney.lines[index];
            // `calculatePurchaseMoney` conserva exactamente una salida por
            // entrada; este guard evita persistir una línea sin snapshots si
            // ese contrato cambiara accidentalmente.
            if (!lineMoney) throw new Error('TOTAL_COMPRA_INCONSISTENTE');
            const requiresTrackedBatchIdentity = (
                batchWarehouseLedgerMode === 'SHADOW'
                || batchWarehouseLedgerMode === 'ENFORCED'
            ) && productsById.get(item.productId)?.requiresBatchTracking === true;
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
                ...(!linkedPurchaseOrder || requiresTrackedBatchIdentity ? { id: crypto.randomUUID() } : {}),
                averageUnitCost: inventoryLineCost.div(baseQuantity).toString(),
                totalCost: lineMoney.lineNet.toFixed(2),
                taxAmountExact: lineMoney.lineTax.toFixed(2),
                creditableTaxExact: lineMoney.creditableTax.toFixed(2),
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
            const lockedCostRows: any[] = await tx.$queryRaw`SELECT cost FROM \`Product\` WHERE id = ${item.productId} AND \`tenantId\` = ${principal.tenantId} FOR UPDATE`;
            const oldCost = new Decimal((lockedCostRows[0]?.cost ?? 0).toString());

            // Promedio ponderado móvil (función pura compartida — regla C1 adentro).
            const newAvgCost = weightedAverageCost(
                oldStock,
                oldCost,
                item.quantityExact,
                item.averageUnitCost,
            ).toNumber();

            await tx.product.update({
                where: { id: item.productId },
                data: {
                    cost: newAvgCost  // ya redondeado a 4 d.p. por Decimal
                }
            });

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
                const batch = await tx.productBatch.upsert({
                    where: {
                        productId_batchNumber: { productId: item.productId, batchNumber: item.batchNumber }
                    },
                    update: { stock: { increment: item.stockQuantity } },
                    create: {
                        tenantId: principal.tenantId,
                        productId: item.productId,
                        batchNumber: item.batchNumber,
                        // `processedItems` ya normalizó la fecha calendario a Date.
                        // Volver a pasar el Date por el normalizador de strings
                        // produciría una fecha inválida para compras con lote.
                        expiryDate: item.expiryDate,
                        stock: item.stockQuantity
                    }
                });
                batchId = batch.id;

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
                        batchId: batch.id,
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
                    tax: taxAmount.toString(),
                    creditableTax: creditableTax.toString(),
                    fiscalRegime: fiscalRegimeAtPurchase,
                    total: totalAmount.toString(),
                    matchStatus: procurementMatch.matchStatus,
                    paymentHold: procurementMatch.paymentHold,
                    priceTolerancePct: procurementMatch.priceTolerancePct,
                    shiftId: turnoDeContado?.id ?? null,
                    efectivoAntes: efectivoAntesCompra?.toNumber() ?? null,
                    efectivoDespues: efectivoDespuesCompra?.toNumber() ?? null,
                    productChanges: costChanges,
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
