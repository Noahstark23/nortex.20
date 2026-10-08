import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { batchExpiryWindow } from '../lib/batchExpiry.js';
import { QUOTATION_READ_ROLES } from '../middleware/accessPolicies.js';
import type {
    OperationalAlertSample, OperationalAlertSection, OperationalAlertSectionId, OperationalAlertsResponse,
} from '../../utils/operationalAlerts.js';

export type OperationalAlertsDatabase = Pick<PrismaClient, 'tenant' | 'product' | 'productBatch' | 'publicOrder'>;

const STOCK_READ_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'];
// expiring-soon admite los roles autenticados existentes. La nueva ruta no
// incorpora BODEGUERO (su allowlist lo deniega) ni acepta roles desconocidos.
export const OPERATIONAL_ALERT_READ_ROLES = [
    ...STOCK_READ_ROLES, 'MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE',
    'VENDEDOR', 'ACCOUNTANT', 'COLLECTOR',
];

export class OperationalAlertsAccessError extends Error {
    constructor(public readonly status: 401 | 403) {
        super(status === 401 ? 'No se pudo identificar el negocio.' : 'Permisos insuficientes para consultar alertas.');
    }
}

/** Fechas de lote son días civiles guardados en UTC, no instantes de vencimiento. */
export function operationalExpiryWindow(asOf: Date) {
    const { today, afterLastDay } = batchExpiryWindow(asOf, 30);
    return { today, afterThirtyDays: afterLastDay };
}

export function createOperationalAlertsService(
    db: OperationalAlertsDatabase = prisma,
    now: () => Date = () => new Date(),
) {
    return {
        async getSummary(tenantId: string, role: string): Promise<OperationalAlertsResponse | null> {
            if (!tenantId?.trim()) throw new OperationalAlertsAccessError(401);
            // Verificar antes de cualquier lectura; protege también callers fuera del router.
            if (!OPERATIONAL_ALERT_READ_ROLES.includes(role)) throw new OperationalAlertsAccessError(403);
            const asOf = now();
            const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { type: true } });
            if (!tenant) return null;
            if (tenant.type === 'LENDER') return { checkedAt: asOf.toISOString(), sections: [] };

            const { today, afterThirtyDays } = operationalExpiryWindow(asOf);
            const queries: Array<{
                id: OperationalAlertSectionId;
                count: () => PromiseLike<number>;
                samples?: () => Promise<OperationalAlertSample[]>;
            }> = [];
            const productSection = (id: OperationalAlertSectionId, where: Prisma.ProductWhereInput) => ({
                id,
                count: () => db.product.count({ where }),
                samples: async () => (await db.product.findMany({
                    where, take: 3, orderBy: [{ name: 'asc' }, { id: 'asc' }],
                    select: { id: true, name: true, stock: true },
                })).map(product => ({ id: product.id, name: product.name, detail: `Existencias: ${product.stock}` })),
            });
            const batchSection = (id: OperationalAlertSectionId, where: Prisma.ProductBatchWhereInput) => ({
                id,
                count: () => db.productBatch.count({ where }),
                samples: async () => (await db.productBatch.findMany({
                    where, take: 3, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
                    select: { id: true, batchNumber: true, expiryDate: true, product: { select: { name: true } } },
                })).map(batch => ({
                    id: batch.id, name: batch.product.name,
                    detail: `Lote ${batch.batchNumber} · Vence ${batch.expiryDate.toISOString().slice(0, 10)}`,
                })),
            });
            if (STOCK_READ_ROLES.includes(role)) {
                queries.push(
                    productSection('out_of_stock', { tenantId, stock: { lte: 0 } }),
                    // Comparación entre columnas en la BD; no descarga el catálogo.
                    productSection('low_stock', { tenantId, stock: { gt: 0, lte: db.product.fields.minStock } }),
                );
            }
            queries.push(
                batchSection('expired_batches', { tenantId, stock: { gt: 0 }, expiryDate: { lt: today } }),
                batchSection('expiring_batches', { tenantId, stock: { gt: 0 }, expiryDate: { gte: today, lt: afterThirtyDays } }),
            );
            if (QUOTATION_READ_ROLES.includes(role)) {
                queries.push({ id: 'pending_orders', count: () => db.publicOrder.count({ where: { tenantId, status: 'PENDING' } }) });
            }

            // Los índices tenantId existentes acotan cada conteo al negocio.
            // No implica comprobar planes MySQL ni índices compuestos adicionales.
            const sections = await Promise.all(queries.map(async ({ id, count, samples }): Promise<OperationalAlertSection> => {
                try {
                    const total = await count();
                    return { id, status: 'ok', count: total, ...(total > 0 && samples ? { samples: await samples() } : {}) };
                } catch {
                    // No publicar errores de Prisma ni transformar un fallo en cero.
                    return { id, status: 'error', count: null };
                }
            }));
            return { checkedAt: asOf.toISOString(), sections };
        },
    };
}
