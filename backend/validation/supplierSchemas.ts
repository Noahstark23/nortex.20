import Decimal from 'decimal.js';
import { z } from 'zod';

const MAX_MONEY = new Decimal('99999999999999.9999');

const cleanNullableString = (max: number) => z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().max(max).nullable(),
);

const cleanOptionalString = (max: number) => cleanNullableString(max).optional();

const nullableMoney = z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.union([z.string(), z.number(), z.null()]),
).transform((value, context): string | null => {
    if (value === null) return null;
    const raw = typeof value === 'string' ? value.trim() : String(value);

    let amount: Decimal;
    try {
        amount = new Decimal(raw);
    } catch {
        context.addIssue({ code: 'custom', message: 'El monto debe ser un decimal válido' });
        return z.NEVER;
    }

    if (!amount.isFinite() || amount.isNegative() || amount.greaterThan(MAX_MONEY)) {
        context.addIssue({
            code: 'custom',
            message: 'El monto debe ser finito, no negativo y caber en Decimal(18,4)',
        });
        return z.NEVER;
    }
    if (amount.decimalPlaces() > 4) {
        context.addIssue({ code: 'custom', message: 'El monto admite máximo 4 decimales' });
        return z.NEVER;
    }

    return amount.toFixed(4);
});

const optionalMoney = nullableMoney.optional();

const optionalIsoDate = z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.union([
        z.string().datetime({ offset: true }),
        z.date(),
        z.null(),
    ]),
).transform((value) => value === null ? null : new Date(value)).optional();

export const SUPPLIER_STATUSES = [
    'ACTIVE',
    'SUSPENDED',
    'BLOCKED',
] as const;

export const SUPPLIER_LEGAL_TYPES = ['NATURAL', 'JURIDICAL'] as const;

const supplierFields = {
    name: z.string().trim().min(1, 'El nombre es requerido').max(191),
    ruc: cleanOptionalString(40),
    contactName: cleanOptionalString(160),
    phone: cleanOptionalString(80),
    email: z.preprocess(
        (value) => typeof value === 'string' && value.trim() === '' ? null : value,
        z.string().trim().email('Email inválido').max(254).nullable(),
    ).optional(),
    address: cleanOptionalString(1000),
    category: cleanOptionalString(120),
    status: z.enum(SUPPLIER_STATUSES).optional(),
    legalType: z.preprocess(
        (value) => typeof value === 'string' && value.trim() === '' ? null : value,
        z.enum(SUPPLIER_LEGAL_TYPES).nullable(),
    ).optional(),
    // La clasificación fiscal no se cierra a un enum inventado: DGI puede
    // ampliar los regímenes y el schema la conserva como catálogo configurable.
    fiscalCategory: cleanOptionalString(64),
    currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/)
        .transform((value) => value.toUpperCase()).optional(),
    paymentTermsDays: z.number().int().min(0).max(3650).nullable().optional(),
    creditLimit: optionalMoney,
    leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
    minimumOrderAmount: optionalMoney,
    notes: cleanOptionalString(5000),
};

export const CreateSupplierSchema = z.object(supplierFields).strict();

export const UpdateSupplierSchema = z.object({
    name: supplierFields.name.optional(),
    ruc: supplierFields.ruc,
    contactName: supplierFields.contactName,
    phone: supplierFields.phone,
    email: supplierFields.email,
    address: supplierFields.address,
    category: supplierFields.category,
    status: supplierFields.status,
    legalType: supplierFields.legalType,
    fiscalCategory: supplierFields.fiscalCategory,
    currency: supplierFields.currency,
    paymentTermsDays: supplierFields.paymentTermsDays,
    creditLimit: supplierFields.creditLimit,
    leadTimeDays: supplierFields.leadTimeDays,
    minimumOrderAmount: supplierFields.minimumOrderAmount,
    notes: supplierFields.notes,
}).strict().refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'Indicá al menos un cambio' },
);

export const SupplierListQuerySchema = z.object({
    search: z.string().trim().max(160).optional(),
    status: z.union([z.enum(SUPPLIER_STATUSES), z.literal('ALL')]).default('ACTIVE'),
    limit: z.preprocess(
        (value) => value === undefined ? 500 : value,
        z.union([z.string(), z.number()]),
    ).transform((value, context) => {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
            context.addIssue({ code: 'custom', message: 'limit debe ser un entero entre 1 y 500' });
            return z.NEVER;
        }
        return parsed;
    }),
}).strict();

export const SupplierIdParamsSchema = z.object({
    id: z.string().trim().min(1).max(191),
}).strict();

export const SupplierContactParamsSchema = z.object({
    id: z.string().trim().min(1).max(191),
    contactId: z.string().trim().min(1).max(191),
}).strict();

export const SupplierDocumentParamsSchema = z.object({
    id: z.string().trim().min(1).max(191),
    documentId: z.string().trim().min(1).max(191),
}).strict();

const contactFields = {
    name: z.string().trim().min(1, 'El nombre del contacto es requerido').max(160),
    title: cleanOptionalString(120),
    phone: cleanOptionalString(80),
    email: z.preprocess(
        (value) => typeof value === 'string' && value.trim() === '' ? null : value,
        z.string().trim().email('Email inválido').max(254).nullable(),
    ).optional(),
    isPrimary: z.boolean().optional(),
    notes: cleanOptionalString(2000),
};

export const CreateSupplierContactSchema = z.object(contactFields).strict();

export const UpdateSupplierContactSchema = z.object({
    name: contactFields.name.optional(),
    title: contactFields.title,
    phone: contactFields.phone,
    email: contactFields.email,
    isPrimary: contactFields.isPrimary,
    notes: contactFields.notes,
}).strict().refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'Indicá al menos un cambio' },
);

const PRIVATE_STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,383}$/;

export const CreateSupplierDocumentSchema = z.object({
    kind: z.string().trim().min(1).max(64).regex(
        /^[A-Za-z0-9_]+$/,
        'kind solo admite letras, números y guion bajo',
    ).transform((value) => value.toUpperCase()),
    fileName: z.string().trim().min(1).max(255),
    storageKey: z.string().trim().min(1).max(384)
        .regex(PRIVATE_STORAGE_KEY, 'storageKey privado inválido')
        .refine((value) => !value.split('/').includes('..'), 'storageKey privado inválido')
        .refine((value) => !value.includes('://'), 'No se aceptan URL públicas'),
    mimeType: cleanOptionalString(127),
    sizeBytes: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
    sha256: z.preprocess(
        (value) => typeof value === 'string' && value.trim() === '' ? null : value,
        z.string().trim().regex(/^[A-Fa-f0-9]{64}$/, 'sha256 inválido')
            .transform((value) => value.toLowerCase()).nullable(),
    ).optional(),
    expiresAt: optionalIsoDate,
}).strict();

export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;
export type SupplierListQuery = z.infer<typeof SupplierListQuerySchema>;
export type CreateSupplierContactInput = z.infer<typeof CreateSupplierContactSchema>;
export type UpdateSupplierContactInput = z.infer<typeof UpdateSupplierContactSchema>;
export type CreateSupplierDocumentInput = z.infer<typeof CreateSupplierDocumentSchema>;

export const SUPPLIER_ADMIN_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;

const SUPPLIER_CONTROL_FIELDS = new Set<keyof CreateSupplierInput>([
    'ruc',
    'status',
    'legalType',
    'fiscalCategory',
    'currency',
    'paymentTermsDays',
    'creditLimit',
]);

export function hasSupplierControlIntent(payload: Record<string, unknown>): boolean {
    return Object.keys(payload).some((key) => SUPPLIER_CONTROL_FIELDS.has(key as keyof CreateSupplierInput));
}

export function isSupplierControlAuthorized(role: string | undefined, payload: Record<string, unknown>): boolean {
    return !hasSupplierControlIntent(payload)
        || SUPPLIER_ADMIN_ROLES.includes(role as typeof SUPPLIER_ADMIN_ROLES[number]);
}
