import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { calculateAuthoritativeUnitPrice } from '../saleItemMeasurementService.js';
import { discountedPromotionPrice } from './pricing.js';
import { authorizePromotion, json, keyForPromotion, loadPromotionProducts, promotionConfig, promotionFiscal, promotionHash,
    promotionsEnabled, PromotionError, type PromotionDb, type PromotionPrincipal, type PromotionProduct } from './authority.js';

export const promotionDraftSchema = z.object({
    operation: z.enum(['PUBLISH', 'CANCEL']).default('PUBLISH'),
    name: z.string().trim().min(1).max(120).optional(),
    percent: z.union([z.string(), z.number()]).optional(),
    productIds: z.array(z.string().trim().min(1).max(191)).max(200).optional(),
    startsAt: z.string().max(40).optional(), endsAt: z.string().max(40).optional(),
    promotionId: z.string().min(1).max(191).optional(), version: z.number().int().positive().optional(),
}).strict();
export type PromotionDraft = z.infer<typeof promotionDraftSchema>;
export function parsePromotionDraft(raw: unknown): PromotionDraft {
    const parsed = promotionDraftSchema.safeParse(raw);
    if (!parsed.success) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Revisá los datos de la promoción; sólo se admiten productos y porcentaje para POS.');
    return parsed.data;
}
/** Los datetime-local representan Managua. No interpretarlos con la zona del servidor. */
export function promotionDate(value: string | undefined): Date {
    const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value ?? '');
    if (!value || (!local && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))) {
        throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Indicá inicio y fin completos en horario de Managua.');
    }
    const date = new Date(local ? `${value}-06:00` : value);
    const day = value.slice(0, 10), calendar = new Date(`${day}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || calendar.toISOString().slice(0, 10) !== day || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19) || 0) > 59) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'La fecha de la promoción no es válida.');
    return date;
}
export function promotionPercent(value: string | number | undefined): Decimal {
    let percent: Decimal;
    try { percent = new Decimal(value as string); } catch { throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Indicá el porcentaje de descuento.'); }
    if (!percent.isFinite() || !percent.gt(0) || !percent.lt(100) || percent.decimalPlaces() > 2) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'El descuento debe ser mayor que 0 y menor que 100, con hasta dos decimales.');
    return percent;
}
function priceTiers(product: PromotionProduct, percent: Decimal) {
    const tier = (label: string, price: Decimal, factor = new Decimal(1)) => ({ label, before: price.mul(factor).toFixed(4), after: discountedPromotionPrice(price, percent).mul(factor).toFixed(4) });
    const rows = [tier('Detalle por unidad base', new Decimal(product.price))];
    if (product.wholesalePrice !== null && new Decimal(product.wholesalePrice).gt(0)) rows.push(tier('Mayoreo por unidad base', calculateAuthoritativeUnitPrice(product, 1, true)));
    if (product.packSize !== null && new Decimal(product.packSize).gt(0) && product.packPrice !== null && new Decimal(product.packPrice).gt(0)) rows.push(tier(`Empaque (${product.packUnit ?? 'PACK'} × ${product.packSize})`, calculateAuthoritativeUnitPrice(product, product.packSize, false, 'PACK'), new Decimal(product.packSize)));
    if (rows.some(row => !new Decimal(row.after).gt(0))) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'El porcentaje deja un precio no representable. Reducí el descuento.');
    return rows;
}

export async function preparePromotion(principal: PromotionPrincipal, raw: unknown, db: PromotionDb = prisma, lock = false, now = new Date()) {
    const draft = parsePromotionDraft(raw);
    await authorizePromotion(db, principal, true, lock);
    if (!await promotionsEnabled(db, principal.tenantId, lock)) throw new PromotionError('PROMOTION_DISABLED', 403, 'Las promociones no están habilitadas para este negocio.');
    if (draft.operation === 'CANCEL') {
        if (!draft.promotionId || !draft.version) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Elegí la promoción y su versión para cancelar.');
        const existing = await db.promotion.findFirst({ where: { id: draft.promotionId, tenantId: principal.tenantId }, include: { items: { orderBy: { productId: 'asc' }, take: 200 } } });
        if (!existing) throw new PromotionError('PROMOTION_NOT_FOUND', 404, 'Promoción no encontrada.');
        let current = existing;
        if (lock) {
            await loadPromotionProducts(db, principal.tenantId, existing.items.map(item => item.productId), true);
            const [row] = await db.$queryRaw<Array<Omit<typeof existing, 'items'>>>`SELECT * FROM \`Promotion\` WHERE id = ${existing.id} AND tenantId = ${principal.tenantId} FOR UPDATE`;
            if (!row) throw new PromotionError('PROMOTION_NOT_FOUND', 404, 'Promoción no encontrada.');
            current = { ...row, items: existing.items };
        }
        if (current.version !== draft.version || current.status !== 'PUBLISHED') throw new PromotionError('PROMOTION_CHANGED', 409, 'La promoción cambió. Actualizá la revisión.');
        const preview = { summary: `Cancelar ${current.name}`, lines: [{ name: current.name, startsAt: current.startsAt.toISOString(), endsAt: current.endsAt.toISOString() }], effects: [{ label: 'Aplicación futura', value: 'Deja de aplicar al confirmar' }], warnings: ['Las ventas ya registradas conservan su precio.'], confirmLabel: 'Cancelar promoción' };
        return { draft, preview, hash: promotionHash({ draft, current }), existing: current, snapshots: [] };
    }
    if (!draft.name || !draft.productIds?.length || new Set(draft.productIds).size !== draft.productIds.length) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Indicá un nombre y productos distintos para la promoción.');
    const percent = promotionPercent(draft.percent), startsAt = promotionDate(draft.startsAt), endsAt = promotionDate(draft.endsAt);
    if (endsAt <= startsAt || endsAt <= now) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'El fin debe ser posterior al inicio y todavía estar vigente.');
    const fiscal = await promotionFiscal(db, principal.tenantId, lock);
    const products = await loadPromotionProducts(db, principal.tenantId, draft.productIds, lock);
    const conflicts = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT p.id FROM \`Promotion\` p INNER JOIN \`PromotionItem\` i ON i.promotionId = p.id AND i.tenantId = p.tenantId WHERE p.tenantId = ${principal.tenantId} AND p.status = 'PUBLISHED' AND i.productId IN (${Prisma.join(draft.productIds)}) AND p.startsAt < ${endsAt} AND p.endsAt > ${startsAt} LIMIT 1 ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    if (conflicts.length) throw new PromotionError('PROMOTION_OVERLAP', 409, 'Un producto ya tiene una promoción durante ese período. Revisá las fechas o cancelá la anterior.');
    const snapshots = products.map(product => ({ productId: product.id, configSnapshot: promotionConfig(product, fiscal), configHash: promotionHash(promotionConfig(product, fiscal)) }));
    const preview = { summary: `${draft.name}: ${percent}% en POS con conexión`,
        lines: products.map(product => ({ productId: product.id, name: product.name, unit: product.unit, wholesaleMinQty: product.wholesaleMinQty, packSize: product.packSize,
            startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), prices: priceTiers(product, percent), ivaExento: product.ivaExento, ...fiscal })),
        effects: [{ label: 'Inventario o deuda al publicar', value: 'Sin movimiento' }, { label: 'Descuento', value: `${percent}%` }],
        warnings: ['Aplica a todos los lotes vendibles del producto; los vencidos siguen excluidos.', 'Sin otros descuentos en la misma línea ni descuento global en el ticket.', 'Cambiar precios, unidades, empaques o régimen fiscal requiere una nueva revisión.'], confirmLabel: 'Publicar promoción' };
    const normalized = { ...draft, percent: percent.toString(), productIds: [...draft.productIds].sort(), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    return { draft: normalized, preview, hash: promotionHash({ tenantId: principal.tenantId, normalized, snapshots }), existing: null, snapshots };
}

export async function executePromotionInTransaction(principal: PromotionPrincipal, raw: unknown, context: { tx: Prisma.TransactionClient; requestKey: string; domainHash: string }) {
    const { tx } = context, requestKey = keyForPromotion(context.requestKey), draft = parsePromotionDraft(raw), payloadHash = promotionHash(draft);
    await authorizePromotion(tx, principal, true, true);
    await tx.promotionCommand.createMany({ data: [{ tenantId: principal.tenantId, userId: principal.userId, requestKey, payloadHash }], skipDuplicates: true });
    const [command] = await tx.$queryRaw<Array<{ id: string; userId: string; payloadHash: string; promotionId: string | null; resultJson: any }>>`SELECT id, userId, payloadHash, promotionId, resultJson FROM \`PromotionCommand\` WHERE tenantId = ${principal.tenantId} AND requestKey = ${requestKey} FOR UPDATE`;
    if (!command || command.userId !== principal.userId || command.payloadHash !== payloadHash) throw new PromotionError('PROMOTION_IDEMPOTENCY_CONFLICT', 409, 'El identificador pertenece a otra operación.');
    if (command.promotionId && command.resultJson) {
        const receipt = typeof command.resultJson === 'string' ? JSON.parse(command.resultJson) : command.resultJson;
        if (receipt.promotionId !== command.promotionId) throw new PromotionError('PROMOTION_RECEIPT_UNAVAILABLE', 409, 'El comprobante de la promoción requiere revisión.');
        return { ...receipt, replayed: true };
    }
    const prepared = await preparePromotion(principal, draft, tx, true);
    if (prepared.hash !== context.domainHash) throw new PromotionError('PROMOTION_CHANGED', 409, 'La promoción o sus referencias cambiaron. Revisá otra vez.');
    let promotion;
    if (prepared.draft.operation === 'CANCEL') {
        const changed = await tx.promotion.updateMany({ where: { id: prepared.existing!.id, tenantId: principal.tenantId, version: prepared.draft.version, status: 'PUBLISHED' }, data: { status: 'CANCELLED', version: { increment: 1 }, cancelledBy: principal.userId, cancelledAt: new Date() } });
        if (changed.count !== 1) throw new PromotionError('PROMOTION_CHANGED', 409, 'La promoción cambió. Revisá otra vez.');
        promotion = await tx.promotion.findFirstOrThrow({ where: { id: prepared.existing!.id, tenantId: principal.tenantId } });
    } else {
        promotion = await tx.promotion.create({ data: { id: randomUUID(), tenantId: principal.tenantId, name: prepared.draft.name!, percent: String(prepared.draft.percent), status: 'PUBLISHED', version: 1,
            startsAt: new Date(prepared.draft.startsAt!), endsAt: new Date(prepared.draft.endsAt!), createdBy: principal.userId,
            items: { create: prepared.snapshots.map(item => ({ ...item, tenantId: principal.tenantId, configSnapshot: json(item.configSnapshot) })) } } });
    }
    const result = { promotionId: promotion.id, status: promotion.status, version: promotion.version };
    await tx.auditLog.create({ data: { tenantId: principal.tenantId, userId: principal.userId, action: draft.operation === 'CANCEL' ? 'PROMOTION_CANCELLED' : 'PROMOTION_PUBLISHED',
        details: JSON.stringify({ before: prepared.existing ? json(prepared.existing) : null, after: json(promotion), review: prepared.preview, hash: prepared.hash }) } });
    const completed = await tx.promotionCommand.updateMany({ where: { id: command.id, tenantId: principal.tenantId, userId: principal.userId, promotionId: null }, data: { promotionId: promotion.id, resultJson: result } });
    if (completed.count !== 1) throw new PromotionError('PROMOTION_IDEMPOTENCY_CONFLICT', 409, 'No pudimos conservar el comprobante de la promoción.');
    return { ...result, replayed: false };
}
