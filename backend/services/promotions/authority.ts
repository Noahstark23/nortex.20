import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { POS_SALE_ROLES } from '../../middleware/accessPolicies.js';

export type PromotionDb = PrismaClient | Prisma.TransactionClient;
export interface PromotionPrincipal { tenantId: string; userId: string; role?: string }
export const PROMOTION_MANAGE_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;
export class PromotionError extends Error {
    constructor(readonly code: string, readonly httpStatus: number, message: string) { super(message); this.name = 'PromotionError'; }
}
export const json = <T = any>(value: unknown): T => JSON.parse(JSON.stringify(value));
const canonical = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        if (typeof value.toJSON === 'function') return value.toJSON();
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
};
export const promotionHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const promotionsFlag = () => process.env.NORTEX_PROMOTIONS_ENABLED === 'true';
export async function promotionsEnabled(db: PromotionDb, tenantId: string, lock = false): Promise<boolean> {
    if (!promotionsFlag()) return false;
    if (lock) {
        const [current] = await db.$queryRaw<Array<{ promotionsEnabled: boolean | number }>>`SELECT promotionsEnabled FROM \`AssistantTenantConfig\` WHERE tenantId = ${tenantId} FOR SHARE`;
        return Boolean(current?.promotionsEnabled);
    }
    const config = await db.assistantTenantConfig.findUnique({ where: { tenantId }, select: { promotionsEnabled: true } });
    return config?.promotionsEnabled === true;
}
export async function authorizePromotion(db: PromotionDb, principal: PromotionPrincipal, manage = false, lock = false) {
    const users = lock ? await db.$queryRaw<Array<{ id: string; role: string; status: string }>>`SELECT id, role, status FROM \`User\` WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`
        : [await db.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId }, select: { id: true, role: true, status: true } })];
    const user = users[0];
    const roles: readonly string[] = manage ? PROMOTION_MANAGE_ROLES : POS_SALE_ROLES;
    if (!user || user.status !== 'ACTIVE' || !roles.includes(user.role) || (principal.role && user.role !== principal.role)) {
        throw new PromotionError('PROMOTION_FORBIDDEN', 403, 'Tu sesión o permiso cambió. Volvé a ingresar.');
    }
    return { ...principal, role: user.role };
}
export const keyForPromotion = (key: string) => {
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'El identificador de la operación no es válido.');
    return key;
};
export const productColumns = { id: true, name: true, unit: true, price: true, cost: true, ivaExento: true, saleMode: true, quantityStep: true, promotionPriceVersion: true,
    wholesalePrice: true, wholesaleMinQty: true, packUnit: true, packSize: true, packPrice: true, requiresBatchTracking: true } as const;
export type PromotionProduct = Prisma.ProductGetPayload<{ select: typeof productColumns }>;
export interface PromotionFiscal { fiscalRegime: string; fiscalRegimeVersion: number }
export async function promotionFiscal(db: PromotionDb, tenantId: string, lock = false): Promise<PromotionFiscal> {
    if (lock) {
        const [row] = await db.$queryRaw<PromotionFiscal[]>`SELECT fiscalRegime, fiscalRegimeVersion FROM \`Tenant\` WHERE id = ${tenantId} FOR SHARE`;
        if (row) return row;
    } else {
        const row = await db.tenant.findUnique({ where: { id: tenantId }, select: { fiscalRegime: true, fiscalRegimeVersion: true } });
        if (row) return row;
    }
    throw new PromotionError('PROMOTION_FORBIDDEN', 403, 'Negocio no disponible.');
}
export async function loadPromotionProducts(db: PromotionDb, tenantId: string, productIds: string[], lock = false): Promise<PromotionProduct[]> {
    const ids = [...new Set(productIds)].sort();
    if (!ids.length || ids.length > 500) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Elegí los productos de la promoción.');
    const rows = lock ? await db.$queryRaw<PromotionProduct[]>(Prisma.sql`SELECT ${Prisma.join(Object.keys(productColumns).map(key => Prisma.raw(`\`${key}\``)))} FROM \`Product\` WHERE tenantId = ${tenantId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
        : await db.product.findMany({ where: { tenantId, id: { in: ids } }, select: productColumns, take: 500 });
    if (rows.length !== ids.length) throw new PromotionError('PROMOTION_PRODUCT_NOT_FOUND', 404, 'Uno o más productos no pertenecen a tu negocio.');
    return rows.map(row => ({ ...row, ivaExento: Boolean(row.ivaExento), requiresBatchTracking: Boolean(row.requiresBatchTracking) })).sort((a, b) => a.id.localeCompare(b.id));
}
export function promotionConfig(product: PromotionProduct, fiscal: PromotionFiscal) {
    const { cost: _cost, ...config } = product;
    return json({ ...config, fiscalRegime: fiscal.fiscalRegime, fiscalRegimeVersion: fiscal.fiscalRegimeVersion });
}
