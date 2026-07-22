/**
 * NORTEX — Sales Service
 *
 * Motor de ventas reutilizable llamado desde múltiples canales:
 *  - POST /api/sales   (source='POS',       shiftId requerido)
 *  - Agente WhatsApp   (source='WHATSAPP',  shiftId=null)   — PR3
 *  - Portal público    (source='PUBLIC_ORDER', shiftId=null) — futuro
 *
 * La firma acepta rawInput: unknown y valida con Zod internamente,
 * así cada caller puede pasar el body sin pre-procesar.
 *
 * Reglas:
 *  - Totales 100% en Decimal.js. El caller NO provee un total.
 *  - Todo query filtrado por tenantId (aislamiento multi-tenant).
 *  - Errores tipados: SaleError(code, httpStatus, message).
 */

import { z } from 'zod';
import Decimal from 'decimal.js';
import { PrismaClient, Sale, Prisma } from '@prisma/client';
import { recordSale } from './accounting.js';
import { applyStockDelta, StockError } from './stockService.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const prisma = new PrismaClient();

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ── Error class ──────────────────────────────────────────────────────────────
// httpStatus viaja con el error; el controller no inspecciona mensajes.

export class SaleError extends Error {
    constructor(
        public readonly code:
            | 'INVALID_INPUT'
            | 'NO_SHIFT'
            | 'CUSTOMER_REQUIRED'
            | 'CUSTOMER_NOT_FOUND'
            | 'EMPLOYEE_NOT_FOUND'
            | 'CUSTOMER_BLOCKED'
            | 'CREDIT_LIMIT_EXCEEDED'
            | 'INVOICE_RANGE_EXHAUSTED'
            | 'PRODUCT_NOT_FOUND'
            | 'INSUFFICIENT_STOCK',
        public readonly httpStatus: number,
        message: string
    ) {
        super(message);
        this.name = 'SaleError';
    }
}

// ── Zod schema (exportado — sirve como contrato de API del canal) ────────────

const moneyString = z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, 'Debe ser un número >= 0');

const moneyStringPositive = moneyString.refine(
    (v) => parseFloat(v) > 0,
    'Debe ser un número > 0'
);

export const CreateSaleSchema = z.object({
    items: z
        .array(
            z.object({
                id:        z.string().min(1, 'id requerido'),  // frontend sends product id as 'id'
                quantity:  z.number().positive('quantity debe ser > 0'),
                price:     moneyStringPositive,
                // costPrice: el cliente ya NO dicta el costo. Se ignora si llega
                // (Zod descarta llaves desconocidas). El costo de venta lo fija
                // el servidor desde Product.cost — ver paso 5c.
                discount:  moneyString.optional(),
            })
        )
        .min(1, 'Se requiere al menos 1 producto'),
    paymentMethod:  z.enum(['CASH', 'CARD', 'QR', 'CREDIT', 'TRANSFER']),
    customerId:     z.string().optional(),
    customerName:   z.string().optional(),
    employeeId:     z.string().optional(),
    globalDiscount: z.number().min(0).max(100).optional().default(0),
    source:         z.enum(['POS', 'WHATSAPP', 'PUBLIC_ORDER']).default('POS'),
    offlineId:      z.string().min(1).optional(),  // clave de idempotencia (UUID del cliente)
});

type CreateSaleInput = z.output<typeof CreateSaleSchema>;

// ── executeSale ──────────────────────────────────────────────────────────────

export async function executeSale(
    tenantId: string,
    userId: string,
    shiftId: string | null,
    rawInput: unknown
): Promise<Sale> {

    // 1. Validación Zod — primer firewall antes de tocar la DB
    const parsed = CreateSaleSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issues = parsed.error.issues ?? [];
        const msg = issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(' | ');
        throw new SaleError('INVALID_INPUT', 400, msg || 'Datos de entrada inválidos');
    }
    const {
        items,
        paymentMethod,
        customerId,
        customerName,
        employeeId,
        globalDiscount,
        source,
        offlineId,
    } = parsed.data as CreateSaleInput;

    // 1b. Idempotencia: si este offlineId ya fue procesado para el tenant,
    //     devolvemos la venta existente en lugar de volver a cobrar.
    if (offlineId) {
        const existing = await prisma.sale.findFirst({ where: { offlineId, tenantId } });
        if (existing) {
            return existing;
        }
    }

    // 2. Validación de turno (solo POS)
    if (source === 'POS') {
        if (!shiftId) {
            throw new SaleError('NO_SHIFT', 400, '🔒 CAJA CERRADA: No hay turno abierto');
        }
        const shift = await prisma.shift.findFirst({
            where: { id: shiftId, tenantId, status: 'OPEN' },
        });
        if (!shift) {
            throw new SaleError('NO_SHIFT', 400, '🔒 CAJA CERRADA: No hay turno abierto con ese ID');
        }
    }

    // 3. Cálculo autoritativo del total (Decimal.js — el caller nunca provee el total)
    //    Fórmula: sum(price * qty * (1 - itemDiscount%)) * (1 - globalDiscount%)
    const itemsSubtotal = items.reduce((acc, item) => {
        const line       = new Decimal(item.price).mul(item.quantity);
        const discountPct = item.discount ? parseFloat(item.discount) : 0;
        const factor     = new Decimal(1).minus(new Decimal(discountPct).div(100));
        return acc.plus(line.mul(factor));
    }, new Decimal(0));

    const globalFactor = new Decimal(1).minus(new Decimal(globalDiscount).div(100));
    const finalTotal   = itemsSubtotal.mul(globalFactor).toDecimalPlaces(2);

    // 3b. Validación de pertenencia al tenant de customerId/employeeId — para TODO
    //     método de pago, no solo CREDIT. Sin esto, una venta CASH/CARD/QR/TRANSFER
    //     podría persistir un customerId/employeeId de otro tenant (el body no es
    //     confiable), y /api/sales/search lo expondría vía include sin filtro de tenant
    //     (fuga de PII cross-tenant + venta que referencia registros ajenos).
    let customer: Awaited<ReturnType<typeof prisma.customer.findFirst>> = null;
    if (customerId) {
        customer = await prisma.customer.findFirst({
            where: { id: customerId, tenantId },
        });
        if (!customer) {
            throw new SaleError('CUSTOMER_NOT_FOUND', 404, 'Cliente no encontrado');
        }
    }
    if (employeeId) {
        const employee = await prisma.employee.findFirst({
            where: { id: employeeId, tenantId },
            select: { id: true },
        });
        if (!employee) {
            throw new SaleError('EMPLOYEE_NOT_FOUND', 404, 'Empleado no encontrado');
        }
    }

    // 4. Motor de riesgo crediticio
    let finalStatus  = 'COMPLETED';
    let creditBalance = new Decimal(0);
    let dueDate: Date | null = null;

    if (paymentMethod === 'CREDIT') {
        if (!customerId || !customer) {
            throw new SaleError('CUSTOMER_REQUIRED', 400, '⛔ RIESGO: Las ventas a crédito requieren Cliente.');
        }
        if (customer.isBlocked) {
            throw new SaleError('CUSTOMER_BLOCKED', 403, '⛔ DENEGADO: Cliente bloqueado por morosidad.');
        }

        const currentDebt = new Decimal(customer.currentDebt.toString());
        const limit       = new Decimal(customer.creditLimit.toString());

        if (currentDebt.plus(finalTotal).greaterThan(limit)) {
            const available = limit.minus(currentDebt).toDecimalPlaces(2);
            throw new SaleError(
                'CREDIT_LIMIT_EXCEEDED',
                402,
                `⛔ DENEGADO: Excede límite de crédito. Disponible: $${available.toString()}`
            );
        }

        finalStatus   = 'CREDIT_PENDING';
        creditBalance = finalTotal;
        dueDate       = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    // 5. Transacción atómica (idempotente ante carrera vía offlineId @unique)
    let sale: Sale;
    try {
        sale = await prisma.$transaction(async (tx: PrismaTx) => {

        // 5a. Consecutivo DGI — upsert atómico dentro de la transacción
        const counter = await tx.invoiceSeries.upsert({
            where:  { tenantId_series: { tenantId, series: 'A' } },
            update: { lastNumber: { increment: 1 } },
            create: { tenantId, series: 'A', lastNumber: 1 },
        });
        if (counter.lastNumber > counter.rangeEnd) {
            throw new SaleError('INVOICE_RANGE_EXHAUSTED', 422, 'Rango de facturación DGI agotado. Solicite nuevo rango.');
        }

        // 5b. Crear venta
        const created = await tx.sale.create({
            data: {
                tenantId,
                total:         finalTotal.toNumber(),
                status:        finalStatus,
                paymentMethod,
                customerName:  customerName ?? '',
                customerId:    customerId ?? null,
                employeeId:    employeeId ?? null,
                balance:       creditBalance.toNumber(),
                dueDate,
                shiftId:       shiftId ?? null,
                globalDiscount,
                invoiceNumber: counter.lastNumber,
                invoiceSeries: 'A',
                offlineId:     offlineId ?? null,
            },
        });

        // 5c. Costos autoritativos del servidor — el costo de venta sale de
        //     Product.cost (promedio ponderado que mantiene el flujo de compras),
        //     NUNCA del cliente. Evita que un POS manipulado falsee el COGS (y
        //     con él la utilidad y el IR).
        const productIds = [...new Set(items.map((i) => i.id))];
        const costRows = await tx.product.findMany({
            where: { tenantId, id: { in: productIds } },
            select: { id: true, cost: true },
        });
        const costByProduct = new Map(costRows.map((p) => [p.id, new Decimal(p.cost)]));

        // 0a · Política de stock negativo del tenant. Si está activa, la venta NO se
        // bloquea por stock insuficiente (la salida puede dejar el stock en negativo y
        // el Kardex refleja la realidad). Por defecto se sigue exigiendo suficiencia.
        const tenantCfg = await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { allowNegativeStock: true },
        });
        const enforceStock = !(tenantCfg?.allowNegativeStock ?? false);

        // 5d. Items + stock decrement + Kardex
        let costTotal = new Decimal(0);
        for (const item of items) {
            const priceD = new Decimal(item.price);
            const costD  = costByProduct.get(item.id) ?? new Decimal(0);

            await tx.saleItem.create({
                data: {
                    saleId:      created.id,
                    productId:   item.id,
                    quantity:    item.quantity,
                    priceAtSale: priceD.toNumber(),
                    costAtSale:  costD.toNumber(),
                    discount:    item.discount ? parseFloat(item.discount) : 0,
                },
            });

            costTotal = costTotal.plus(costD.mul(item.quantity));

            // Decremento ATÓMICO: validación de suficiencia y escritura en el
            // mismo UPDATE (WHERE stock >= qty) — inmune a dirty reads bajo
            // concurrencia. Ver stockService.ts.
            let stockBefore: number;
            let stockAfter: number;
            try {
                const result = await applyStockDelta(tx, {
                    tenantId,
                    productId: item.id,
                    delta: -item.quantity,
                    enforceSufficient: enforceStock,
                });
                stockBefore = result.stockBefore;
                stockAfter  = result.stockAfter;
            } catch (err) {
                if (err instanceof StockError) {
                    throw err.code === 'PRODUCT_NOT_FOUND'
                        ? new SaleError('PRODUCT_NOT_FOUND', 404, err.message)
                        : new SaleError('INSUFFICIENT_STOCK', 422, err.message);
                }
                throw err;
            }

            await tx.kardexMovement.create({
                data: {
                    tenantId,
                    productId:     item.id,
                    type:          'OUT_SALE',
                    quantity:      -item.quantity,
                    stockBefore,
                    stockAfter,
                    referenceId:   created.id,
                    referenceType: 'SALE',
                    reason:        `Venta #${created.id.slice(0, 8)} (${source})`,
                    userId,
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
                tenantId,
                userId,
                created.id,
                finalTotal.toNumber(),
                costTotal.toDecimalPlaces(2).toNumber(),
                paymentMethod
            );
        } catch (accErr) {
            console.warn('⚠️ Accounting hook failed (sale continues):', accErr);
        }

        // 5f. AuditLog dentro de la transacción (atomicidad garantizada)
        await tx.auditLog.create({
            data: {
                tenantId,
                userId,
                action:  'SALE_CREATED',
                details: JSON.stringify({
                    saleId:        created.id,
                    total:         finalTotal.toString(),
                    source,
                    itemCount:     items.length,
                    paymentMethod,
                }),
            },
        });

        return created;
    });
    } catch (err: unknown) {
        // Si dos requests con el mismo offlineId corren a la vez, la restricción
        // @unique aborta la segunda (código P2002): devolvemos la venta ya creada.
        if (
            offlineId &&
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
        ) {
            const existing = await prisma.sale.findFirst({ where: { offlineId, tenantId } });
            if (existing) return existing;
        }
        throw err;
    }

    return sale;
}
