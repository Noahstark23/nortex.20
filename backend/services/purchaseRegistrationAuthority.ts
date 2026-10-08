import { createHash } from 'node:crypto';
import { PURCHASE_WRITE_ROLES } from '../middleware/accessPolicies';
import { CreatePurchaseSchema } from '../validation/schemas';
import type { PurchaseInput } from './purchaseRegistrationPreparation';

export interface PurchasePrincipal { tenantId: string; userId: string; role: string }
export class PurchaseRegistrationError extends Error {
    constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
        super(message); this.name = 'PurchaseRegistrationError';
    }
}

/** Autoridad vigente en BD; el JWT nunca habilita permisos que ya se revocaron. */
export async function assertPurchasePrincipal(db: any, principal: PurchasePrincipal, lock = false) {
    if (!principal.tenantId || !principal.userId || !PURCHASE_WRITE_ROLES.includes(principal.role)) {
        throw new PurchaseRegistrationError('PURCHASE_FORBIDDEN', 403, 'Tu usuario no puede registrar compras.');
    }
    const user = lock
        ? (await db.$queryRaw`SELECT id, role, status FROM \`User\` WHERE id = ${principal.userId} AND \`tenantId\` = ${principal.tenantId} FOR UPDATE`)[0]
        : await db.user.findFirst({
            where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE' },
            select: { id: true, role: true, status: true },
        });
    if (!user || user.status !== 'ACTIVE' || user.role !== principal.role || !PURCHASE_WRITE_ROLES.includes(user.role)) {
        throw new PurchaseRegistrationError('PURCHASE_FORBIDDEN', 403, 'Tu sesión o permiso de compras cambió. Volvé a ingresar.');
    }
}

export function parsePurchaseInput(input: unknown): PurchaseInput {
    const parsed = CreatePurchaseSchema.safeParse(input);
    if (!parsed.success) {
        throw new PurchaseRegistrationError('PURCHASE_INVALID_INPUT', 400,
            parsed.error.issues.map(issue => issue.message).join('. '));
    }
    return parsed.data;
}

const canonicalValue = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object') {
        if ('toJSON' in value && typeof value.toJSON === 'function') return value.toJSON();
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalValue(item)]));
    }
    return value;
};
export function purchasePayloadHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}
export function parsePurchaseIdempotencyKey(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,190}$/.test(value)) {
        throw new PurchaseRegistrationError('PURCHASE_INVALID_KEY', 400, 'El identificador de la operación no es válido.');
    }
    return value;
}
