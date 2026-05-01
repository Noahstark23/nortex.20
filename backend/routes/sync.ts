import express from 'express';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { recordSale } from '../services/accounting';

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
 * Idempotente: ignora ventas cuyo offlineId ya existe en BD.
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

        // IDEMPOTENCIA: ya existe este offlineId?
        const existing = await (prisma.sale as any).findUnique({ where: { offlineId: sale.offlineId } });
        if (existing) {
            results.push({ offlineId: sale.offlineId, saleId: existing.id, status: 'skipped' });
            continue;
        }

        try {
            const createdSale = await prisma.$transaction(async (tx: any) => {
                // 1. INVOICE NUMBER
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

                // 2. CREAR VENTA
                const newSale = await (tx.sale as any).create({
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

                // 3. SALE ITEMS
                await tx.saleItem.createMany({
                    data: sale.items.map(item => ({
                        saleId: newSale.id,
                        productId: item.id,
                        quantity: item.quantity,
                        priceAtSale: item.price,
                        costAtSale: item.costPrice,
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

                // 5. KARDEX + STOCK
                let costTotal = 0;
                for (const item of sale.items) {
                    const product = await tx.product.findUnique({ where: { id: item.id } });
                    if (!product) continue;

                    const effectiveQty = item.quantity;
                    const stockBefore = product.stock;
                    const stockAfter = stockBefore - effectiveQty;
                    costTotal += item.costPrice * effectiveQty;

                    await tx.product.update({
                        where: { id: item.id },
                        data: { stock: { decrement: effectiveQty } },
                    });

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

                // 6. ACTUALIZAR CAJA DEL TURNO
                if (sale.shiftId && sale.paymentMethod === 'CASH') {
                    await tx.shift.update({
                        where: { id: sale.shiftId },
                        data: { systemExpectedCash: { increment: sale.total } },
                    });
                }

                // 7. ASIENTO CONTABLE
                await recordSale(tx, callerTenantId, sale.userId, newSale.id, sale.total, costTotal, sale.paymentMethod);

                return newSale;
            });

            results.push({ offlineId: sale.offlineId, saleId: createdSale.id, status: 'created' });
        } catch (err: any) {
            results.push({ offlineId: sale.offlineId, status: 'failed', error: err.message });
        }
    }

    const processed = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return res.json({ processed, skipped, failed, results });
});

export default router;
