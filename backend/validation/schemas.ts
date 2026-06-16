/**
 * NORTEX — Esquemas de Validación Zod
 *
 * Todos los endpoints transaccionales (ventas, gastos, compras,
 * movimientos de caja, pagos) deben validar su req.body aquí
 * antes de tocar la base de datos.
 *
 * Regla: Si la validación falla → HTTP 400 con los errores de Zod.
 * Los montos validados salen como string para que Decimal.js los
 * consuma sin pérdida de precisión (evita coercions intermedias).
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ============================================================
// HELPERS
// ============================================================

/** Cantidad monetaria: string o number → Decimal-safe string  */
const moneyAmount = z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
        message: 'El monto debe ser un número positivo',
    });

/** Cantidad monetaria estrictamente mayor que cero */
const moneyAmountPositive = moneyAmount.refine((v) => parseFloat(v) > 0, {
    message: 'El monto debe ser mayor que cero',
});

/** Entero positivo */
const positiveInt = z.number().int().positive();

/** Método de pago permitido */
const paymentMethod = z.enum(['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'QR']);

// ============================================================
// ESQUEMAS POR ENDPOINT
// ============================================================

// POST /api/sales
export const SaleItemSchema = z.object({
    productId:   z.string().min(1, 'productId requerido'),
    quantity:    positiveInt,
    price:       moneyAmountPositive,
    costPrice:   moneyAmount.optional(),
    batchId:     z.string().optional(),
    discount:    moneyAmount.optional(),
});

export const CreateSaleSchema = z.object({
    items:          z.array(SaleItemSchema).min(1, 'Se requiere al menos 1 producto'),
    paymentMethod,
    customerId:     z.string().optional(),
    customerName:   z.string().optional(),
    employeeId:     z.string().optional(),
    globalDiscount: z.number().min(0).max(100).optional(),
    discount:       moneyAmount.optional(),
    notes:          z.string().max(500).optional(),
    invoiceNumber:  z.union([z.string(), z.number()]).optional(),
});

// POST /api/returns
export const CreateReturnSchema = z.object({
    saleId: z.string().min(1, 'saleId requerido'),
    items:  z.array(z.object({
        productId: z.string().min(1),
        quantity:  positiveInt,
        price:     moneyAmountPositive,
    })).min(1, 'Se requiere al menos 1 producto a devolver'),
    reason:  z.string().min(3, 'La razón debe tener al menos 3 caracteres').max(500),
});

// POST /api/expenses
export const CreateExpenseSchema = z.object({
    amount:      moneyAmountPositive,
    description: z.string().min(3, 'La descripción es obligatoria').max(300),
    category:    z.string().min(1, 'La categoría es obligatoria'),
    date:        z.string().datetime({ offset: true }).optional(),
});

// POST /api/cash-movements
export const CreateCashMovementSchema = z.object({
    type:        z.enum(['IN', 'OUT']),
    amount:      moneyAmountPositive,
    category:    z.string().min(1, 'La categoría es obligatoria'),
    description: z.string().max(300).optional(),
    shiftId:     z.string().optional(),
});

// POST /api/payments
export const CreatePaymentSchema = z.object({
    saleId: z.string().min(1, 'saleId requerido'),
    amount: moneyAmountPositive,
    method: paymentMethod.optional(),
});

// POST /api/purchases
export const PurchaseItemSchema = z.object({
    productId:   z.string().min(1),
    quantity:    positiveInt,
    unitCost:    moneyAmountPositive,
    batchNumber: z.string().optional(),
    expiryDate:  z.string().datetime({ offset: true }).optional(),
});

export const CreatePurchaseSchema = z.object({
    supplierId:    z.string().min(1, 'supplierId requerido'),
    invoiceNumber: z.string().min(1, 'Número de factura requerido'),
    paymentMethod: z.enum(['CASH', 'CREDIT']),
    dueDate:       z.string().datetime({ offset: true }).optional(),
    notes:         z.string().max(500).optional(),
    items:         z.array(PurchaseItemSchema).min(1, 'Se requiere al menos 1 ítem'),
});

// POST /api/inventory/adjust
export const InventoryAdjustSchema = z.object({
    productId: z.string().min(1, 'productId requerido'),
    quantity:  z.number().int().refine((v) => v !== 0, { message: 'La cantidad no puede ser cero' }),
    reason:    z.string().min(3, 'La justificación es obligatoria (mín. 3 caracteres)').max(300).optional(),
    type:      z.enum(['ADJUST_LOSS', 'ADJUST_GAIN', 'IN_PURCHASE', 'RETURN']).optional(),
});

// PATCH /api/products/bulk-edit  [Bodeguero A2 — edición masiva]
export const BulkEditProductsSchema = z
    .object({
        ids:        z.array(z.string().min(1)).min(1, 'Selecciona al menos 1 producto').max(500, 'Máximo 500 productos por lote'),
        category:   z.string().trim().min(1).max(100).optional(),
        priceMode:  z.enum(['set', 'pct']).optional(),
        priceValue: z.number().finite().optional(),
    })
    .refine((d) => d.category !== undefined || d.priceMode !== undefined, {
        message: 'Indica al menos un cambio: categoría o precio',
    })
    .refine((d) => d.priceMode === undefined || d.priceValue !== undefined, {
        message: 'priceValue es obligatorio al cambiar el precio',
        path: ['priceValue'],
    })
    .refine((d) => !(d.priceMode === 'set' && d.priceValue !== undefined && d.priceValue < 0), {
        message: 'El precio no puede ser negativo',
        path: ['priceValue'],
    })
    .refine((d) => !(d.priceMode === 'pct' && d.priceValue !== undefined && d.priceValue <= -100), {
        message: 'El descuento porcentual no puede ser ≥ 100%',
        path: ['priceValue'],
    });

// POST /api/inventory/batches  [Bodeguero A4 — alta de lote]
export const CreateBatchSchema = z.object({
    productId:   z.string().min(1, 'productId requerido'),
    batchNumber: z.string().trim().min(1, 'Número de lote requerido').max(100),
    expiryDate:  z.string().min(1, 'Fecha de vencimiento requerida'),
    quantity:    z.number().int().positive('La cantidad debe ser mayor que cero'),
});

// POST /api/shifts/open
export const OpenShiftSchema = z.object({
    initialCash: moneyAmount,
    employeePin: z.string().regex(/^\d{4}$/, 'El PIN debe ser exactamente 4 dígitos numéricos'),
});

// POST /api/shifts/close
export const CloseShiftSchema = z.object({
    shiftId:      z.string().min(1, 'shiftId requerido'),
    declaredCash: moneyAmount,
    auditNotes:   z.string().max(500).optional(),
});

// POST /api/payroll/calculate
export const PayrollCalculateSchema = z.object({
    month: z.number().int().min(1).max(12),
    year:  z.number().int().min(2020).max(2100),
});

// POST /api/tax-report/generate
export const TaxReportSchema = PayrollCalculateSchema;

// ============================================================
// MIDDLEWARE FACTORY
// ============================================================

/**
 * Crea un middleware Express que valida `req.body` con el schema dado.
 * Si falla → 400 JSON con errores de Zod estructurados.
 * Si pasa → `req.body` es reemplazado con el valor parseado/transformado.
 *
 * @example
 * app.post('/api/sales', authenticate, validate(CreateSaleSchema), handler)
 */
export function validate<T extends z.ZodTypeAny>(schema: T) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                error: 'Datos de entrada inválidos',
                details: result.error.flatten().fieldErrors,
            });
            return;
        }
        req.body = result.data;
        next();
    };
}
