import express from 'express';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { recordSale } from '../services/accounting';
import { applyStockDelta, StockError } from '../services/stockService';

const router = express.Router();
const prisma = new PrismaClient();

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ── Validación Zod del payload de sincronización (definida INLINE en este
//    archivo para no colisionar con backend/schemas.ts). Primer firewall antes
//    de tocar la DB: cantidades positivas, precios/descuentos válidos,
//    paymentMethod acotado a un enum y el lote con tope para evitar DoS. ──
const OfflineItemSchema = z.object({
    id: z.string().min(1, 'id de producto requerido'),
    name: z.string().optional(),
    quantity: z.number().positive('quantity debe ser > 0'),
    price: z.number().min(0, 'price debe ser >= 0'),
    costPrice: z.number().optional(), // ignorado: el COGS lo fija el servidor
    discount: z.number().min(0).max(100).optional(),
});

const OfflineSaleSchema = z.object({
    offlineId: z.string().min(1, 'offlineId requerido'),
    tenantId: z.string().min(1),
    // userId del payload se IGNORA — la atribución sale de req.userId (JWT)
    userId: z.string().optional(),
    shiftId: z.string().nullable().optional(),
    employeeId: z.string().nullable().optional(),
    customerName: z.string().optional(),
    customerId: z.string().nullable().optional(),
    paymentMethod: z.enum(['CASH', 'CARD', 'QR', 'CREDIT', 'TRANSFER']),
    // total del payload se IGNORA — se recomputa autoritativamente en el servidor
    total: z.number().optional(),
    globalDiscount: z.number().min(0).max(100).optional().default(0),
    items: z.array(OfflineItemSchema).min(1, 'Se requiere al menos 1 producto'),
    createdAt: z.string().min(1),
});

const SyncBodySchema = z.object({
    // Tope del lote: evita que un request infle N transacciones (DoS)
    sales: z.array(OfflineSaleSchema).min(1, 'sales array requerido').max(200, 'lote demasiado grande'),
});

type OfflineSalePayload = z.infer<typeof OfflineSaleSchema>;

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
    const callerTenantId: string = req.tenantId;
    // Atribución de auditoría: SIEMPRE del JWT, nunca del payload del cliente.
    const callerUserId: string = req.userId;

    // Validación Zod del body — rechazo 400 ante cualquier fallo de parseo,
    // igual que el POS online (CreateSaleSchema).
    const parsed = SyncBodySchema.safeParse(req.body);
    if (!parsed.success) {
        const msg = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(' | ');
        return res.status(400).json({ error: msg || 'Datos de entrada inválidos' });
    }
    const sales: OfflineSalePayload[] = parsed.data.sales;

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
                const now = new Date();

                // 0. FECHA DE LA VENTA — el createdAt del cliente no puede ser
                //    futuro (ni inválido); si lo es, se ancla a la hora del sync
                //    para no romper la cronología correlativa de facturas.
                const rawCreatedAt = new Date(sale.createdAt);
                const saleCreatedAt =
                    isNaN(rawCreatedAt.getTime()) || rawCreatedAt > now ? now : rawCreatedAt;

                // 0b. VALIDAR TURNO (propiedad + estado ABIERTO), como el POS
                //     online (salesService.ts:131-136). Un shiftId ajeno o de un
                //     turno cerrado contamina el arqueo del tenant víctima.
                if (sale.shiftId) {
                    const shift = await tx.shift.findFirst({
                        where: { id: sale.shiftId, tenantId: callerTenantId, status: 'OPEN' },
                        select: { id: true },
                    });
                    if (!shift) {
                        throw new Error('Turno inválido, ajeno o ya cerrado');
                    }
                }
                const validShiftId = sale.shiftId || null;

                // 0c. RESOLVER employeeId contra el tenant — no plantar FK cross-tenant
                let validEmployeeId: string | null = null;
                if (sale.employeeId) {
                    const emp = await tx.employee.findFirst({
                        where: { id: sale.employeeId, tenantId: callerTenantId },
                        select: { id: true },
                    });
                    validEmployeeId = emp ? emp.id : null;
                }

                // 1. TOTAL AUTORITATIVO (Decimal.js — el cliente NUNCA provee el total)
                //    Fórmula igual al online: sum(price * qty * (1 - itemDisc%)) * (1 - globalDisc%)
                const itemsSubtotal = sale.items.reduce((acc: Decimal, item) => {
                    const line = new Decimal(item.price).mul(item.quantity);
                    const discountPct = item.discount ?? 0;
                    const factor = new Decimal(1).minus(new Decimal(discountPct).div(100));
                    return acc.plus(line.mul(factor));
                }, new Decimal(0));
                const globalFactor = new Decimal(1).minus(new Decimal(sale.globalDiscount).div(100));
                const finalTotal = itemsSubtotal.mul(globalFactor).toDecimalPlaces(2);

                // 2. MOTOR DE RIESGO CREDITICIO (para CREDIT), como el POS online.
                //    Sin esto, la CxC queda invisible (balance 0, sin dueDate ni deuda).
                let finalStatus = 'COMPLETED';
                let creditBalance = new Decimal(0);
                let dueDate: Date | null = null;
                let validCustomerId: string | null = null;

                if (sale.paymentMethod === 'CREDIT') {
                    if (!sale.customerId) {
                        throw new Error('Las ventas a crédito requieren cliente');
                    }
                    const customer = await tx.customer.findFirst({
                        where: { id: sale.customerId, tenantId: callerTenantId },
                    });
                    if (!customer) {
                        throw new Error('Cliente no encontrado');
                    }
                    if (customer.isBlocked) {
                        throw new Error('Cliente bloqueado por morosidad');
                    }
                    const currentDebt = new Decimal(customer.currentDebt.toString());
                    const limit = new Decimal(customer.creditLimit.toString());
                    if (currentDebt.plus(finalTotal).greaterThan(limit)) {
                        const available = limit.minus(currentDebt).toDecimalPlaces(2);
                        throw new Error(`Excede límite de crédito. Disponible: C$${available.toString()}`);
                    }

                    finalStatus = 'CREDIT_PENDING';
                    creditBalance = finalTotal;
                    dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                    validCustomerId = customer.id;
                } else if (sale.customerId) {
                    // No-crédito: resolver propiedad para no plantar FK cross-tenant
                    const customer = await tx.customer.findFirst({
                        where: { id: sale.customerId, tenantId: callerTenantId },
                        select: { id: true },
                    });
                    validCustomerId = customer ? customer.id : null;
                }

                // 3. INVOICE NUMBER (increment atómico: el row-lock serializa)
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

                // 4. CREAR VENTA (la restricción @unique de offlineId corta la
                //    carrera si dos syncs del mismo lote llegan a la vez: P2002)
                const newSale = await tx.sale.create({
                    data: {
                        tenantId: callerTenantId,
                        offlineId: sale.offlineId,
                        total: finalTotal.toNumber(),
                        status: finalStatus,
                        paymentMethod: sale.paymentMethod,
                        customerName: sale.customerName ?? '',
                        customerId: validCustomerId,
                        employeeId: validEmployeeId,
                        balance: creditBalance.toNumber(),
                        dueDate,
                        shiftId: validShiftId,
                        globalDiscount: sale.globalDiscount,
                        invoiceNumber,
                        invoiceSeries,
                        createdAt: saleCreatedAt,
                    },
                });

                // 5. SALE ITEMS — el costo de venta sale de Product.cost (servidor),
                //    nunca del payload offline. Mismo invariante que el POS online:
                //    el cliente no dicta el COGS.
                const costRows = await tx.product.findMany({
                    where: { tenantId: callerTenantId, id: { in: sale.items.map((i) => i.id) } },
                    select: { id: true, cost: true },
                });
                const costByProduct = new Map(costRows.map((p) => [p.id, new Decimal(p.cost.toString())]));

                await tx.saleItem.createMany({
                    data: sale.items.map((item) => ({
                        saleId: newSale.id,
                        productId: item.id,
                        quantity: item.quantity,
                        priceAtSale: item.price,
                        costAtSale: (costByProduct.get(item.id) ?? new Decimal(0)).toNumber(),
                        discount: item.discount || 0,
                    })),
                });

                // 6. PAYMENT — SOLO para ventas de contado. En crédito NO se registra
                //    cobro por el total (el dinero aún se debe; la CxC vive en Sale.balance).
                if (sale.paymentMethod !== 'CREDIT') {
                    await tx.payment.create({
                        data: {
                            saleId: newSale.id,
                            amount: finalTotal.toNumber(),
                            method: sale.paymentMethod,
                            collectedBy: callerUserId,
                        },
                    });
                }

                // 6b. DEUDA DEL CLIENTE — incrementar en crédito (increment atómico)
                if (sale.paymentMethod === 'CREDIT' && validCustomerId) {
                    await tx.customer.update({
                        where: { id: validCustomerId },
                        data: { currentDebt: { increment: finalTotal.toNumber() } },
                    });
                }

                // 7. KARDEX + STOCK (atómico, tenant-scoped)
                let costTotal = new Decimal(0);
                for (const item of sale.items) {
                    const effectiveQty = item.quantity;

                    // Lookup tenant-scoped (antes: findUnique sin tenantId → IDOR)
                    const product = await tx.product.findFirst({
                        where: { id: item.id, tenantId: callerTenantId },
                        select: { requiresBatchTracking: true },
                    });
                    if (!product) continue;

                    const costD = costByProduct.get(item.id) ?? new Decimal(0);
                    costTotal = costTotal.plus(costD.mul(effectiveQty));

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
                                    userId: callerUserId,
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
                                    userId: callerUserId,
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
                                userId: callerUserId,
                            },
                        });
                    }
                }

                // 8. ACTUALIZAR CAJA DEL TURNO (tenant-scoped: antes un shiftId
                //    ajeno permitía inflar la caja de otro tenant). Solo contado.
                if (validShiftId && sale.paymentMethod === 'CASH') {
                    await tx.shift.updateMany({
                        where: { id: validShiftId, tenantId: callerTenantId },
                        data: { systemExpectedCash: { increment: finalTotal.toNumber() } },
                    });
                }

                // 9. ASIENTO CONTABLE (COGS redondeado a 2 decimales con Decimal)
                await recordSale(
                    tx as Parameters<typeof recordSale>[0],
                    callerTenantId,
                    callerUserId,
                    newSale.id,
                    finalTotal.toNumber(),
                    costTotal.toDecimalPlaces(2).toNumber(),
                    sale.paymentMethod
                );

                // 10. AUDIT LOG inmutable dentro de la misma transacción (paridad
                //     con el POS online: toda venta deja rastro en AuditLog).
                await tx.auditLog.create({
                    data: {
                        tenantId: callerTenantId,
                        userId: callerUserId,
                        action: 'SALE_CREATED',
                        details: JSON.stringify({
                            saleId: newSale.id,
                            offlineId: sale.offlineId,
                            total: finalTotal.toString(),
                            source: 'OFFLINE_SYNC',
                            itemCount: sale.items.length,
                            paymentMethod: sale.paymentMethod,
                        }),
                    },
                });

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

    const processed = results.filter((r) => r.status === 'created').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    return res.json({ processed, skipped, failed, results });
});

export default router;
