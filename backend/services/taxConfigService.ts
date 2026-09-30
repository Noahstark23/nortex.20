/**
 * Configuración fiscal del tenant (B4) — validación y guardado auditado (H7).
 *
 * Antes el PUT convertía con `Number(v) || 0`: un PUT parcial ponía en cero los
 * campos omitidos, aceptaba cualquier tasa entre 0 y 100% y no dejaba rastro.
 * Ahora:
 *  - Zod estricto: solo los cuatro campos conocidos, cada uno opcional.
 *  - INSS patronal ∈ {21.5%, 22.5%} (Ley 539: <50 / ≥50 trabajadores).
 *  - Anticipo IR / PMD ∈ {1%, 2%, 3%} (LCT art. 58: escala del pago mínimo).
 *  - IMI: fracción en [0, 1]. PREGUNTA abierta para el contador: la tasa depende
 *    del Plan de Arbitrios de cada alcaldía y no hay una lista decidida; no se
 *    inventa una restricción.
 *  - Lo omitido conserva el valor guardado (o el default si no hay fila).
 *  - AuditLog before/after en la misma transacción que el upsert.
 */
import Decimal from 'decimal.js';
import { z } from 'zod';
import prisma from '../lib/prisma';

export const INSS_PATRONAL_RATES = ['0.215', '0.225'] as const;
export const ANTICIPO_IR_RATES = ['0.01', '0.02', '0.03'] as const;

export const TAX_CONFIG_DEFAULTS = {
    inssPatronalRate: '0.225',
    anticipoIrRate: '0.01',
    imiRate: '0.01',
    salarioMinimo: '0',
} as const;

const decimalInput = z.union([z.number(), z.string().trim().min(1)])
    .transform((value, ctx) => {
        try {
            const parsed = new Decimal(value);
            if (parsed.isFinite()) return parsed;
        } catch { /* se reporta abajo */ }
        ctx.addIssue({ code: 'custom', message: 'Debe ser un número válido.' });
        return z.NEVER;
    });

const allowedRate = (allowed: readonly string[], label: string) => decimalInput.refine(
    value => allowed.some(rate => value.equals(rate)),
    { message: `${label} debe ser ${allowed.map(r => `${new Decimal(r).times(100).toString()}%`).join(' o ')}.` },
);

export const TaxConfigUpdateSchema = z.object({
    inssPatronalRate: allowedRate(INSS_PATRONAL_RATES, 'INSS patronal').optional(),
    anticipoIrRate: allowedRate(ANTICIPO_IR_RATES, 'Anticipo IR / PMD').optional(),
    imiRate: decimalInput.refine(
        value => value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(1) && value.decimalPlaces() <= 4,
        { message: 'IMI debe ser una fracción entre 0 y 1 con hasta 4 decimales (ej. 0.01 = 1%).' },
    ).optional(),
    salarioMinimo: decimalInput.refine(
        value => value.greaterThanOrEqualTo(0) && value.decimalPlaces() <= 2 && value.lessThan('10000000000'),
        { message: 'El salario mínimo debe ser un monto no negativo con hasta 2 decimales.' },
    ).optional(),
}).strict();

export type TaxConfigValues = { [K in keyof typeof TAX_CONFIG_DEFAULTS]: string };

type StoredTaxConfig = { [K in keyof typeof TAX_CONFIG_DEFAULTS]: { toString(): string } | string | number };

export class TaxConfigValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TaxConfigValidationError';
    }
}

/** Función pura: combina lo guardado con lo enviado, sin tocar lo omitido. */
export function mergeTaxConfigUpdate(current: StoredTaxConfig | null, body: unknown): { before: TaxConfigValues; after: TaxConfigValues } {
    const parsed = TaxConfigUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) {
        throw new TaxConfigValidationError(parsed.error.issues.map(issue => issue.message).join(' '));
    }
    const base = current ?? TAX_CONFIG_DEFAULTS;
    const before: TaxConfigValues = {
        inssPatronalRate: new Decimal(base.inssPatronalRate.toString()).toFixed(4),
        anticipoIrRate: new Decimal(base.anticipoIrRate.toString()).toFixed(4),
        imiRate: new Decimal(base.imiRate.toString()).toFixed(4),
        salarioMinimo: new Decimal(base.salarioMinimo.toString()).toFixed(2),
    };
    const update = parsed.data;
    const after: TaxConfigValues = {
        inssPatronalRate: update.inssPatronalRate?.toFixed(4) ?? before.inssPatronalRate,
        anticipoIrRate: update.anticipoIrRate?.toFixed(4) ?? before.anticipoIrRate,
        imiRate: update.imiRate?.toFixed(4) ?? before.imiRate,
        salarioMinimo: update.salarioMinimo?.toFixed(2) ?? before.salarioMinimo,
    };
    return { before, after };
}

type TaxConfigDb = Pick<typeof prisma, '$transaction'>;

export async function updateTaxConfig(params: {
    tenantId: string;
    userId: string;
    body: unknown;
    db?: TaxConfigDb;
}) {
    const db = params.db ?? prisma;
    return db.$transaction(async (tx: any) => {
        // Bloquea la fila (si existe) para que dos PUT parciales no se pisen.
        await tx.$queryRaw`SELECT tenantId FROM \`TaxConfig\` WHERE tenantId = ${params.tenantId} FOR UPDATE`;
        const current = await tx.taxConfig.findUnique({ where: { tenantId: params.tenantId } });
        const { before, after } = mergeTaxConfigUpdate(current, params.body);
        const config = await tx.taxConfig.upsert({
            where: { tenantId: params.tenantId },
            create: { tenantId: params.tenantId, ...after },
            update: after,
        });
        await tx.auditLog.create({
            data: {
                tenantId: params.tenantId,
                userId: params.userId,
                action: 'TAX_CONFIG_UPDATED',
                details: JSON.stringify({ before: current ? before : null, after }),
            },
        });
        return config;
    });
}
