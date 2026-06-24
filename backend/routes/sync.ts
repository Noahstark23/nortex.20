import express from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { recordSale } from '../services/accounting';
import { applyStockDelta, StockError } from '../services/stockService';

const router = express.Router();
const prisma = new PrismaClient();

interface OfflineItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    costPrice: number;
    discount?: number;
}

interface OfflineSalePayload {
    offlineId: string;
    tenantId: string;
    userId: string;
    shiftId: string | null;
    employeeId: string | null;
    customerName: string;
    customerId: string | null;
    paymentMethod: string;
    total: number;
    globalDiscount: number;
    items: OfflineItem[];
    createdAt: string;
}

/**
 * POST /api/sales/sync
 * Recibe un array de ventas guardadas offline.
 * Idempotente: ignora ventas cuyo offlineId ya existe en BD (scoped al tenant).
 *
 * Política de stock OFFLINE: la venta física YA ocurrió en el mostrador —
 * no se rechaza por stock insuficiente. El decremento es atómico
 * (applyStockDelta) y puede dejar stock negativo, visible en Kardex para
 * auditoría. Misma atomicidad que el POS online (salesService.ts).
 */
router.post('/', authenticate, async (req: any, res: any) => {
    const { sales } = req.body as { sales: OfflineSalePayload[] };
    const callerTenantId: string = req.tenantId;

    if (!Array.isArray(sales) || sales.length === 0) {
        return res.status(400).json({ error: 'sales array requerido' });
    }

    const results: { offlineId: string; saleId?: string; status: 'created' | 'skipped' | 'failed'; error?: string }[] = [];

    for (const sale of sales) {
        // Seguridad: solo procesar ventas del tenant del token
        if (sale.tenantId !== callerTenantId) {
            results.push({ offlineId: sale.offlineId, status: 'failed', error: 'tenant mismatch' });
            continue;
        }

        // IDEMPOTENCIA: ¿ya existe este offlineId PARA ESTE TENANT?
        // (scoped: un offlineId ajeno no debe filtrar el saleId de otro tenant)
        const existing = await prisma.sale.findFirst({
            where: { offlineId: sale.offlineId, tenantId: callerTenantId },
            select: { id: true },
        });
        if (existing) {
            results.push({ offlineId: sale.offlineId, saleId: existing.id, status: 'skipped' });
            continue;
        }

        try {
            const createdSale = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                // 1. INVOICE NUMBER (increment atómico: el row-lock serializa)
                const series = await tx.invoiceSeries.findFirst({
                    where: { tenantId: callerTenantId, isActive: true },
                });
                let invoiceNumber: number | null = null;
                let invoiceSeries: string | null = null;
                if (series) {
                    const updated = await tx.invoiceSeries.update({
                        where: { id: series.id },
                        data: { lastNumber: { increment: 1 } },
                    });
                    invoiceNumber = updated.lastNumber;
                    invoiceSeries = updated.series;
                }

                // 2. CREAR VENTA (la restricción @unique de offlineId corta la
                //    carrera si dos syncs del mismo lote llegan a la vez: P2002)
                const newSale = await tx.sale.create({
                    data: {
                        tenantId: callerTenantId,
                        offlineId: sale.offlineId,
                        total: sale.total,
                        status: sale.paymentMethod === 'CREDIT' ? 'CREDIT_PENDING' : 'COMPLETED',
                        paymentMethod: sale.paymentMethod,
                        customerName: sale.customerName,
                        customerId: sale.customerId || null,
                        employeeId: sale.employeeId || null,
                        shiftId: sale.shiftId || null,
                        globalDiscount: sale.globalDiscount,
                        invoiceNumber,
                        invoiceSeries,
                        createdAt: new Date(sale.createdAt),
                    },
                });

                // 3. SALE ITEMS — el costo de venta sale de Product.cost (servidor),
                //    nunca del payload offline. Mismo invariante que el POS online:
                //    el cliente no dicta el COGS.
                const costRows = await tx.product.findMany({
                    where: { tenantId: callerTenantId, id: { in: sale.items.map(i => i.id) } },
                    select: { id: true, cost: true },
                });
                const costByProduct = new Map(costRows.map(p => [p.id, Number(p.cost)]));

                await tx.saleItem.createMany({
                    data: sale.items.map(item => ({
                        saleId: newSale.id,
                        productId: item.id,
                        quantity: item.quantity,
                        priceAtSale: item.price,
                        costAtSale: costByProduct.get(item.id) ?? 0,
                        discount: item.discount || 0,
                    })),
                });

                // 4. PAYMENT
                await tx.payment.create({
                    data: {
                        saleId: newSale.id,
                        amount: sale.total,
                        method: sale.paymentMethod,
                        collectedBy: sale.userId,
                    },
                });

                // 5. KARDEX + STOCK (atómico, tenant-scoped)
                let costTotal = 0;
                for (const item of sale.items) {
                    const effectiveQty = item.quantity;

                    // Lookup tenant-scoped (antes: findUnique sin tenantId → IDOR)
                    const product = await tx.product.findFirst({
                        where: { id: item.id, tenantId: callerTenantId },
                        select: { requiresBatchTracking: true },
                    });
                    if (!product) continue;

                    costTotal += (costByProduct.get(item.id) ?? 0) * effectiveQty;

                    let stockBefore: number;
                    let stockAfter: number;
                    try {
                        const result = await applyStockDelta(tx, {
                            tenantId: callerTenantId,
                            productId: item.id,
                            delta: -effectiveQty,
                            enforceSufficient: false, // venta offline ya ocurrida
                        });
                        stockBefore = result.stockBefore;
                        stockAfter = result.stockAfter;
                    } catch (err) {
                        if (err instanceof StockError && err.code === 'PRODUCT_NOT_FOUND') continue;
                        throw err;
                    }

                    if (product.requiresBatchTracking) {
                        // FEFO best-effort: cada decremento de lote es CONDICIONAL
                        // (stock >= deduct) — nunca sobre-descuenta un lote bajo
                        // concurrencia; el remanente cae al siguiente lote o al
                        // asiento "sin lote asignado".
                        // B3: los lotes VENCIDOS se excluyen del consumo automático —
                        // no se venden por FEFO; quedan para darse de baja (merma).
                        let remainingQty = effectiveQty;
                        let kardexCursor = stockBefore;
                        const activeBatches = await tx.productBatch.findMany({
                            where: {
                                productId: item.id,
                                tenantId: callerTenantId,
                                stock: { gt: 0 },
                                expiryDate: { gte: new Date() },
                            },
                            orderBy: { expiryDate: 'asc' },
                        });

                        for (const batch of activeBatches) {
                            if (remainingQty <= 0) break;
                            const deductQty = Math.min(Number(batch.stock), remainingQty);

                            const deducted = await tx.productBatch.updateMany({
                                where: { id: batch.id, tenantId: callerTenantId, stock: { gte: deductQty } },
                                data: { stock: { decrement: deductQty } },
                            });
                            if (deducted.count === 0) continue; // otro proceso drenó el lote

                            remainingQty -= deductQty;

                            await tx.kardexMovement.create({
                                data: {
                                    tenantId: callerTenantId,
                                    productId: item.id,
                                    type: 'SALE',
                                    quantity: -deductQty,
                                    stockBefore: kardexCursor,
                                    stockAfter: kardexCursor - deductQty,
                                    referenceId: newSale.id,
                                    referenceType: 'SALE',
                                    reason: `Venta offline sync #${sale.offlineId.slice(0, 8)} (Lote ${batch.batchNumber})`,
                                    userId: sale.userId,
                                    batchId: batch.id,
                                },
                            });
                            kardexCursor -= deductQty;
                        }

                        if (remainingQty > 0) {
                            await tx.kardexMovement.create({
                                data: {
                                    tenantId: callerTenantId,
                                    productId: item.id,
                                    type: 'SALE',
                                    quantity: -remainingQty,
                                    stockBefore: kardexCursor,
                                    stockAfter,
                                    referenceId: newSale.id,
                                    referenceType: 'SALE',
                                    reason: `Venta offline sync #${sale.offlineId.slice(0, 8)} (Sin lote asignado)`,
                                    userId: sale.userId,
                                },
                            });
                        }
                    } else {
                        await tx.kardexMovement.create({
                            data: {
                                tenantId: callerTenantId,
                                productId: item.id,
                                type: 'SALE',
                                quantity: -effectiveQty,
                                stockBefore,
                                stockAfter,
                                referenceId: newSale.id,
                                referenceType: 'SALE',
                                reason: `Venta offline sync #${sale.offlineId.slice(0, 8)}`,
                                userId: sale.userId,
                            },
                        });
                    }
                }

                // 6. ACTUALIZAR CAJA DEL TURNO (tenant-scoped: antes un shiftId
                //    ajeno permitía inflar la caja de otro tenant)
                if (sale.shiftId && sale.paymentMethod === 'CASH') {
                    await tx.shift.updateMany({
                        where: { id: sale.shiftId, tenantId: callerTenantId },
                        data: { systemExpectedCash: { increment: sale.total } },
                    });
                }

                // 7. ASIENTO CONTABLE
                await recordSale(
                    tx as Parameters<typeof recordSale>[0],
                    callerTenantId,
                    sale.userId,
                    newSale.id,
                    sale.total,
                    costTotal,
                    sale.paymentMethod
                );

                return newSale;
            });

            results.push({ offlineId: sale.offlineId, saleId: createdSale.id, status: 'created' });
        } catch (err: unknown) {
            // Carrera del mismo offlineId (dos requests simultáneos): P2002 →
            // tratar como skipped idempotente, no como fallo.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                const winner = await prisma.sale.findFirst({
                    where: { offlineId: sale.offlineId, tenantId: callerTenantId },
                    select: { id: true },
                });
                results.push({ offlineId: sale.offlineId, saleId: winner?.id, status: 'skipped' });
                continue;
            }
            const message = err instanceof Error ? err.message : 'unknown error';
            results.push({ offlineId: sale.offlineId, status: 'failed', error: message });
        }
    }

    const processed = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return res.json({ processed, skipped, failed, results });
});

export default router;
