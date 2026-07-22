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

/** Número que acepta string o number (defensa ante payloads con strings). */
const numeric = z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((v) => !isNaN(v), { message: 'Debe ser un número válido' });

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

// POST /api/stock-counts  [Bodeguero B1 — toma física]
export const CreateStockCountSchema = z
    .object({
        scope:    z.enum(['ALL', 'CATEGORY']).default('ALL'),
        category: z.string().trim().min(1).max(100).optional(),
        notes:    z.string().trim().max(300).optional(),
    })
    .refine((d) => d.scope !== 'CATEGORY' || (d.category && d.category.length > 0), {
        message: 'La categoría es obligatoria cuando el alcance es CATEGORY',
        path: ['category'],
    });

// PATCH /api/stock-counts/:id/count  [Bodeguero B1 — captura de conteo]
export const RecordCountSchema = z.object({
    productId: z.string().min(1, 'productId requerido'),
    counted:   z.number().min(0, 'El conteo no puede ser negativo'),
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
// AUTH
// ============================================================
const businessType = z.enum(['FERRETERIA', 'PULPERIA', 'FARMACIA', 'BOUTIQUE', 'RETAIL', 'LENDER', 'DISTRIBUIDORA', 'MISCELANEA']);

// POST /api/auth/register
export const RegisterSchema = z.object({
    companyName: z.string().trim().min(2, 'El nombre del negocio es obligatorio').max(120),
    email:       z.string().trim().email('Correo inválido'),
    password:    z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
    type:        businessType.optional(),
});

// POST /api/auth/login — sin mínimo de contraseña para no bloquear cuentas viejas.
export const LoginSchema = z.object({
    email:    z.string().trim().email('Correo inválido'),
    password: z.string().min(1, 'La contraseña es obligatoria'),
});

// POST /api/auth/reset-password/:token
export const ResetPasswordSchema = z.object({
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
});

// ============================================================
// PRÉSTAMOS (Prestamista)
// ============================================================
const loanFrequency = z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']);
const loanType = z.enum(['INFORMAL_FLAT', 'FORMAL_AMORTIZED']);

// POST /api/loans
export const OriginateLoanSchema = z.object({
    clientName:      z.string().trim().min(1, 'El nombre del cliente es obligatorio').max(160),
    clientPhone:     z.string().trim().max(40).optional(),
    clientAddress:   z.string().trim().max(300).optional(),
    principalAmount: moneyAmountPositive,
    interestRate:    numeric.refine((v) => v >= 0 && v <= 1000, { message: 'Tasa de interés fuera de rango' }),
    installments:    numeric.refine((v) => Number.isInteger(v) && v > 0, { message: 'Número de cuotas inválido' }),
    frequency:       loanFrequency.optional(),
    type:            loanType.optional(),
});

// POST /api/loans/:id/repayments
export const RepaymentSchema = z.object({
    amountPaid:  moneyAmountPositive,
    collectedBy: z.string().trim().max(120).optional(),
    notes:       z.string().trim().max(500).optional(),
    timestamp:   z.union([z.string(), z.number()]).optional(),
});

// PATCH /api/loans/clients/:clientId
export const UpdateClientSchema = z.object({
    isBlocked:   z.boolean().optional(),
    creditLimit: moneyAmount.optional(),
}).refine((d) => d.isBlocked !== undefined || d.creditLimit !== undefined, {
    message: 'Indicá al menos un cambio (bloqueo o límite de crédito)',
});

// POST /api/loans/:id/refinance
export const RefinanceLoanSchema = z.object({
    newPrincipal: moneyAmount,
    interestRate: numeric.refine((v) => v >= 0 && v <= 1000, { message: 'Tasa de interés fuera de rango' }),
    installments: numeric.refine((v) => Number.isInteger(v) && v > 0, { message: 'Número de cuotas inválido' }),
    frequency:    loanFrequency.optional(),
    type:         loanType.optional(),
});

// POST /api/loans/:id/penalty
export const PenaltySchema = z.object({
    penaltyAmount: moneyAmountPositive,
    reason:        z.string().trim().max(300).optional(),
});

// POST /api/loans/vault/deposit
export const VaultDepositSchema = z.object({
    collectorId: z.string().trim().optional(),
    amount:      moneyAmountPositive,
    notes:       z.string().trim().max(500).optional(),
});

// POST /api/loans/route-expenses
export const RouteExpenseSchema = z.object({
    amount:      moneyAmountPositive,
    description: z.string().trim().min(1, 'La descripción es obligatoria').max(300),
    collectedBy: z.string().trim().max(120).optional(),
});

// ============================================================
// AGENTE BANCARIO (corresponsalía) — ver docs/PLAN_AGENTE_BANCARIO.md
// ============================================================

/** Operaciones de mostrador del agente (define la dirección del efectivo). */
export const agentOperation = z.enum([
    'DEPOSITO', 'PAGO_TARJETA', 'PAGO_PRESTAMO', 'PAGO_SERVICIO', 'RECARGA',
    'REMESA_ENVIO', // cliente envía dinero → entrega efectivo (IN)
    'RETIRO', 'REMESA_COBRO', // el negocio paga efectivo (OUT)
    // Fase B — traslado de efectivo con el banco (solo manager, comisión 0):
    'LIQUIDACION_ENTREGA', // llevás el efectivo captado al banco (OUT, baja la deuda)
    'LIQUIDACION_FONDEO',  // traés efectivo del banco para fondear retiros (IN, sube la deuda)
]);

/** Config de comisión por operación: monto fijo y/o porcentaje (pactado en contrato). */
const commissionEntry = z.object({
    fija: numeric.refine((v) => v >= 0, { message: 'Comisión fija inválida' }).optional(),
    pct:  numeric.refine((v) => v >= 0 && v <= 100, { message: 'Porcentaje de comisión fuera de rango' }).optional(),
});

// z.record con clave enum exige TODAS las claves (exhaustivo) en esta versión
// de Zod → clave string + refine de pertenencia, para aceptar configs parciales
// ({ DEPOSITO: {...} } sin las otras 7 operaciones).
const commissionConfigSchema = z.record(z.string(), commissionEntry).refine(
    (cfg) => Object.keys(cfg).every((k) => (agentOperation.options as string[]).includes(k)),
    { message: 'Operación desconocida en la configuración de comisiones' },
);

/** Límites por operación del convenio (Fase C): por transacción y/o por día. */
const limitEntry = z.object({
    maxTx:  numeric.refine((v) => v > 0, { message: 'Límite por transacción inválido' }).optional(),
    maxDia: numeric.refine((v) => v > 0, { message: 'Límite diario inválido' }).optional(),
});
const limitsConfigSchema = z.record(z.string(), limitEntry).refine(
    (cfg) => Object.keys(cfg).every((k) => (agentOperation.options as string[]).includes(k)),
    { message: 'Operación desconocida en la configuración de límites' },
);

// PATCH /api/agent-banking/settings — umbrales de alerta de gaveta del tenant.
// null limpia el umbral; validación cruzada min < max sobre el estado enviado.
export const AgentSettingsSchema = z.object({
    agentCashMin: moneyAmountPositive.nullable().optional(),
    agentCashMax: moneyAmountPositive.nullable().optional(),
}).refine((d) => d.agentCashMin !== undefined || d.agentCashMax !== undefined, {
    message: 'Indicá al menos un umbral',
}).refine((d) => {
    if (d.agentCashMin == null || d.agentCashMax == null) return true;
    return parseFloat(d.agentCashMin) < parseFloat(d.agentCashMax);
}, { message: 'El mínimo debe ser menor que el máximo' });

// POST /api/agent-banking/agreements
export const CreateAgentAgreementSchema = z.object({
    name: z.string().trim().min(1, 'El nombre del convenio es obligatorio').max(120),
    kind: z.enum(['BANCO', 'RED_RECAUDADORA', 'REMESERA']).default('BANCO'),
    commissionConfig: commissionConfigSchema.optional(),
    limitsConfig: limitsConfigSchema.optional(),
});

// PATCH /api/agent-banking/agreements/:id
export const UpdateAgentAgreementSchema = z.object({
    name:   z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    commissionConfig: commissionConfigSchema.optional(),
    limitsConfig: limitsConfigSchema.optional(),
}).refine((d) => d.name !== undefined || d.active !== undefined || d.commissionConfig !== undefined || d.limitsConfig !== undefined, {
    message: 'Indicá al menos un cambio',
});

// POST /api/agent-banking/transactions/:id/reverse
export const ReverseAgentTxSchema = z.object({
    reason: z.string().trim().min(3, 'Indicá el motivo de la reversa').max(300),
});

// POST /api/agent-banking/agreements/:id/settle-commissions
export const SettleCommissionsSchema = z.object({
    // Sin monto = liquidar TODO lo devengado.
    amount: moneyAmountPositive.optional(),
});

// POST /api/agent-banking/transactions
export const CreateAgentTxSchema = z.object({
    agreementId: z.string().min(1, 'agreementId requerido'),
    operation:   agentOperation,
    amount:      moneyAmountPositive,
    currency:    z.enum(['NIO', 'USD']).default('NIO'),
    // Si no viene, se calcula del commissionConfig del convenio.
    commission:  moneyAmount.optional(),
    externalRef: z.string().trim().max(120).optional(),
    customerRef: z.string().trim().max(160).optional(),
});

// ============================================================
// INVENTARIO / CAPITAL
// ============================================================

// POST /api/kardex/record
export const KardexRecordSchema = z.object({
    productId:     z.string().min(1, 'productId requerido'),
    type:          z.string().min(1).max(40),
    quantity:      numeric.refine((v) => v !== 0, { message: 'La cantidad no puede ser cero' }),
    referenceId:   z.string().optional(),
    referenceType: z.string().optional(),
    reason:        z.string().trim().max(300).optional(),
});

// POST /api/capital/finance-purchase
export const FinancePurchaseSchema = z.object({
    supplierId: z.string().min(1, 'supplierId requerido'),
    items: z.array(z.object({
        productId:   z.string().min(1),
        productName: z.string().optional(),
        quantity:    positiveInt,
        unitCost:    moneyAmountPositive,
    })).min(1, 'Se requiere al menos 1 ítem'),
});

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
