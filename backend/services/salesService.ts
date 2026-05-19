/**
 * NORTEX — Sales Service
 *
 * Encapsula toda la lógica transaccional de una venta:
 * InvoiceSeries → Sale → SaleItems → Kardex → Customer debt → Accounting → AuditLog.
 *
 * Reglas:
 *  - Totales 100% en Decimal.js. El caller NO provee un total: se recalcula aquí.
 *  - Zod valida la entrada antes de tocar la DB.
 *  - Lógica de lotes (ProductBatch) queda fuera de alcance de este módulo.
 *  - Los errores tipados permiten al controller mapear a HTTP status sin inspeccionar mensajes.
 */

import { z } from 'zod';
import Decimal from 'decimal.js';
import { PrismaClient } from '@prisma/client';
import { recordSale } from './accounting.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const prisma = new PrismaClient();

/** Tipo del cliente de transacción de Prisma (inferido del $transaction callback). */
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ── Typed error classes ─────────────────────────────────────────────────────
// El controller usa instanceof para mapear a HTTP status sin inspeccionar mensajes.

export class SaleValidationError extends Error {
    readonly code = 'VALIDATION' as const;
    constructor(message: string) {
        super(message);
        this.name = 'SaleValidationError';
    }
}

export class SaleNotFoundError extends Error {
    readonly code = 'NOT_FOUND' as const;
    constructor(message: string) {
        super(message);
        this.name = 'SaleNotFoundError';
    }
}

export class SaleForbiddenError extends Error {
    readonly code = 'FORBIDDEN' as const;
    constructor(message: string) {
        super(message);
        this.name = 'SaleForbiddenError';
    }
}

export class SaleCreditLimitError extends Error {
    readonly code = 'CREDIT_LIMIT' as const;
    constructor(message: string) {
        super(message);
        this.name = 'SaleCreditLimitError';
    }
}

// ── Public interfaces ───────────────────────────────────────────────────────

export interface SaleInputItem {
    productId: string;
    quantity: number;
    priceAtSale: string;   // Decimal como string para evitar pérdida de precisión
    costAtSale: string;    // Decimal como string
    discount: number;      // Porcentaje de descuento por ítem (0–100)
}

export interface SaleInput {
    items: SaleInputItem[];
    paymentMethod: 'CASH' | 'CARD' | 'QR' | 'CREDIT' | 'TRANSFER';
    customerId: string | null;
    customerName: string;
    employeeId: string | null;
    globalDiscount: number;   // Porcentaje de descuento global (0–100)
    source: 'POS' | 'WHATSAPP' | 'PUBLIC_ORDER';
}

export interface SaleContext {
    tenantId: string;
    userId: string;
    shiftId: string | null;   // Obligatorio cuando source === 'POS'
}

// ── Zod schema interno ──────────────────────────────────────────────────────

const numericString = (fieldName: string) =>
    z
        .string()
        .refine(
            (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
            `${fieldName} debe ser un número >= 0`
        );

const SaleInputItemSchema = z.object({
    productId:   z.string().min(1, 'productId requerido'),
    quantity:    z.number().positive('quantity debe ser > 0'),
    priceAtSale: numericString('priceAtSale').refine((v) => parseFloat(v) > 0, 'priceAtSale debe ser > 0'),
    costAtSale:  numericString('costAtSale'),
    discount:    z.number().min(0).max(100),
});

const SaleInputSchema = z.object({
    items:          z.array(SaleInputItemSchema).min(1, 'Se requiere al menos 1 producto'),
    paymentMethod:  z.enum(['CASH', 'CARD', 'QR', 'CREDIT', 'TRANSFER']),
    customerId:     z.string().nullable(),
    customerName:   z.string().min(1, 'customerName requerido'),
    employeeId:     z.string().nullable(),
    globalDiscount: z.number().min(0).max(100),
    source:         z.enum(['POS', 'WHATSAPP', 'PUBLIC_ORDER']),
});

// ── executeSale ─────────────────────────────────────────────────────────────

export async function executeSale(
    ctx: SaleContext,
    input: SaleInput
): Promise<{ saleId: string; total: string; invoiceNumber: number }> {

    // 1. Validación Zod
    const parsed = SaleInputSchema.safeParse(input);
    if (!parsed.success) {
        const issues = parsed.error.issues ?? (parsed.error as { errors?: typeof parsed.error.issues }).errors ?? [];
        const msg = issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(' | ');
        throw new SaleValidationError(msg || 'Datos de entrada inválidos');
    }
    const { items, paymentMethod, customerId, customerName, employeeId, globalDiscount, source } =
        parsed.data;

    // 2. Validación de turno (solo POS)
    if (source === 'POS') {
        if (!ctx.shiftId) {
            throw new SaleValidationError('shiftId es obligatorio para ventas de POS');
        }
        const shift = await prisma.shift.findFirst({
            where: { id: ctx.shiftId, tenantId: ctx.tenantId, status: 'OPEN' },
        });
        if (!shift) {
            throw new SaleValidationError('🔒 CAJA CERRADA: No hay turno abierto con ese ID');
        }
    }

    // 3. Cálculo autoritativo del total (Decimal.js — el caller no provee un total)
    //    Fórmula: sum(priceAtSale * qty * (1 - itemDiscount%)) * (1 - globalDiscount%)
    const itemsSubtotal = items.reduce((acc, item) => {
        const line = new Decimal(item.priceAtSale).mul(item.quantity);
        const factor = new Decimal(1).minus(new Decimal(item.discount).div(100));
        return acc.plus(line.mul(factor));
    }, new Decimal(0));

    const globalFactor = new Decimal(1).minus(new Decimal(globalDiscount).div(100));
    const finalTotal = itemsSubtotal.mul(globalFactor).toDecimalPlaces(2);

    // 4. Motor de riesgo crediticio
    let finalStatus = 'COMPLETED';
    let creditBalance = new Decimal(0);
    let dueDate: Date | null = null;

    if (paymentMethod === 'CREDIT') {
        if (!customerId) {
            throw new SaleValidationError('⛔ RIESGO: Las ventas a crédito requieren Cliente.');
        }
        const customer = await prisma.customer.findFirst({
            where: { id: customerId, tenantId: ctx.tenantId },
        });
        if (!customer) throw new SaleNotFoundError('Cliente no encontrado');
        if (customer.isBlocked) {
            throw new SaleForbiddenError('⛔ DENEGADO: Cliente bloqueado por morosidad.');
        }

        const currentDebt = new Decimal(customer.currentDebt.toString());
        const limit = new Decimal(customer.creditLimit.toString());

        if (currentDebt.plus(finalTotal).greaterThan(limit)) {
            const available = limit.minus(currentDebt).toDecimalPlaces(2);
            throw new SaleCreditLimitError(
                `⛔ DENEGADO: Excede límite de crédito. Disponible: $${available.toString()}`
            );
        }

        finalStatus = 'CREDIT_PENDING';
        creditBalance = finalTotal;
        dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    // 5. Transacción atómica
    const { saleId, invoiceNumber } = await prisma.$transaction(async (tx: PrismaTx) => {

        // 5a. Consecutivo DGI — upsert atómico dentro de la transacción
        const counter = await tx.invoiceSeries.upsert({
            where:  { tenantId_series: { tenantId: ctx.tenantId, series: 'A' } },
            update: { lastNumber: { increment: 1 } },
            create: { tenantId: ctx.tenantId, series: 'A', lastNumber: 1 },
        });
        if (counter.lastNumber > counter.rangeEnd) {
            throw new Error('Rango de facturación DGI agotado. Solicite nuevo rango.');
        }

        // 5b. Crear venta
        const sale = await tx.sale.create({
            data: {
                tenantId:      ctx.tenantId,
                total:         finalTotal.toNumber(),
                status:        finalStatus,
                paymentMethod,
                customerName,
                customerId:    customerId ?? null,
                employeeId:    employeeId ?? null,
                balance:       creditBalance.toNumber(),
                dueDate,
                shiftId:       ctx.shiftId ?? null,
                globalDiscount,
                invoiceNumber: counter.lastNumber,
                invoiceSeries: 'A',
            },
        });

        // 5c. Items + stock decrement + Kardex
        let costTotal = new Decimal(0);
        for (const item of items) {
            const priceD = new Decimal(item.priceAtSale);
            const costD  = new Decimal(item.costAtSale);

            await tx.saleItem.create({
                data: {
                    saleId:      sale.id,
                    productId:   item.productId,
                    quantity:    item.quantity,
                    priceAtSale: priceD.toNumber(),
                    costAtSale:  costD.toNumber(),
                    discount:    item.discount,
                },
            });

            costTotal = costTotal.plus(costD.mul(item.quantity));

            // Filtro tenantId para aislar al tenant
            const product = await tx.product.findFirst({
                where:  { id: item.productId, tenantId: ctx.tenantId },
                select: { id: true, stock: true },
            });
            if (!product) continue;

            const stockBefore = Number(product.stock);
            const stockAfter  = stockBefore - item.quantity;

            await tx.product.update({
                where: { id: item.productId },
                data:  { stock: stockAfter },
            });

            await tx.kardexMovement.create({
                data: {
                    tenantId:      ctx.tenantId,
                    productId:     item.productId,
                    type:          'OUT_SALE',
                    quantity:      -item.quantity,
                    stockBefore,
                    stockAfter,
                    referenceId:   sale.id,
                    referenceType: 'SALE',
                    reason:        `Venta #${sale.id.slice(0, 8)} (${source})`,
                    userId:        ctx.userId,
                },
            });
        }

        // 5d. Actualizar deuda del cliente si es crédito
        if (paymentMethod === 'CREDIT' && customerId) {
            await tx.customer.update({
                where: { id: customerId },
                data:  { currentDebt: { increment: finalTotal.toNumber() } },
            });
        }

        // 5e. Motor contable — fail-soft: la venta no se revierte por fallo contable
        try {
            await recordSale(
                tx as Parameters<typeof recordSale>[0],
                ctx.tenantId,
                ctx.userId,
                sale.id,
                finalTotal.toNumber(),
                costTotal.toDecimalPlaces(2).toNumber(),
                paymentMethod
            );
        } catch (accErr) {
            console.warn('⚠️ Accounting hook failed (sale continues):', accErr);
        }

        // 5f. AuditLog dentro de la transacción (inmutable, atomicidad garantizada)
        await tx.auditLog.create({
            data: {
                tenantId: ctx.tenantId,
                userId:   ctx.userId,
                action:   'SALE_CREATED',
                details:  JSON.stringify({
                    saleId:        sale.id,
                    total:         finalTotal.toString(),
                    source,
                    itemCount:     items.length,
                    paymentMethod,
                }),
            },
        });

        return { saleId: sale.id, invoiceNumber: counter.lastNumber as number };
    });

    return { saleId, total: finalTotal.toString(), invoiceNumber };
}
