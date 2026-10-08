import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { PURCHASE_WRITE_ROLES } from '../middleware/accessPolicies';
import { extractPurchaseOrderProductIds } from '../../utils/purchaseOrderQuantities';

export interface PurchaseOrderDraftPrincipal { tenantId: string; userId: string; role: string }
export type PurchaseOrderDraftDb = PrismaClient | Prisma.TransactionClient;
export class PurchaseOrderDraftError extends Error {
    constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
        super(message); this.name = 'PurchaseOrderDraftError';
    }
}

/** Los campos desconocidos no dan autoridad: status/tenant/nombres vienen del servidor. */
export const purchaseOrderDraftSchema = z.object({
    supplierId: z.string().trim().min(1, 'supplierId es requerido').max(191),
    notes: z.preprocess(value => value ? String(value) : null, z.string().max(4000).nullable()),
    expectedDate: z.preprocess(value => value || null, z.string().max(40).refine(value => {
        if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
    }, 'La fecha esperada no es válida').nullable()),
    // normalizePurchaseOrderLines conserva los códigos de validación del formulario.
    items: z.array(z.unknown()).min(1, 'Se requiere al menos un ítem').max(200, 'El máximo es 200 ítems'),
});
export type PurchaseOrderDraftInput = z.infer<typeof purchaseOrderDraftSchema>;
export function parsePurchaseOrderDraftInput(raw: unknown): PurchaseOrderDraftInput {
    const value = raw as Record<string, unknown> | null;
    if (!value || typeof value.supplierId !== 'string' || !value.supplierId.trim()) {
        throw new PurchaseOrderDraftError('PO_INVALID_INPUT', 400, 'supplierId es requerido');
    }
    if (!Array.isArray(value.items) || value.items.length === 0) {
        throw new PurchaseOrderDraftError('PO_INVALID_INPUT', 400, 'Se requiere al menos un ítem');
    }
    const parsed = purchaseOrderDraftSchema.safeParse(raw);
    if (!parsed.success) throw new PurchaseOrderDraftError('PO_INVALID_INPUT', 400, parsed.error.issues.map(issue => issue.message).join('. '));
    extractPurchaseOrderProductIds(parsed.data.items);
    return parsed.data;
}

export async function assertPurchaseOrderDraftPrincipal(db: PurchaseOrderDraftDb, principal: PurchaseOrderDraftPrincipal, lock = false) {
    if (!principal.tenantId || !principal.userId || !PURCHASE_WRITE_ROLES.includes(principal.role)) {
        throw new PurchaseOrderDraftError('PO_FORBIDDEN', 403, 'Tu usuario no puede crear órdenes de compra.');
    }
    const user = lock
        ? (await db.$queryRaw<Array<{ id: string; role: string; status: string }>>`SELECT id, role, status FROM \`User\` WHERE id = ${principal.userId} AND \`tenantId\` = ${principal.tenantId} FOR UPDATE`)[0]
        : await db.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE' }, select: { id: true, role: true, status: true } });
    if (!user || user.status !== 'ACTIVE' || user.role !== principal.role || !PURCHASE_WRITE_ROLES.includes(user.role)) {
        throw new PurchaseOrderDraftError('PO_FORBIDDEN', 403, 'Tu sesión o permiso de compras cambió. Volvé a ingresar.');
    }
}

const canonical = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        if (typeof value.toJSON === 'function') return value.toJSON();
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
};
export const purchaseOrderDraftHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function parsePurchaseOrderDraftKey(key?: string): string | undefined {
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key))) {
        throw new PurchaseOrderDraftError('PO_INVALID_KEY', 400, 'El identificador de la operación no es válido.');
    }
    return key;
}
