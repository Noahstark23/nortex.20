import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import { POS_SALE_ROLES } from '../middleware/accessPolicies.js';
import { authorizePromotion, json, PROMOTION_MANAGE_ROLES, PromotionError, productColumns, promotionConfig, promotionFiscal, promotionHash } from '../services/promotions/authority.js';
import { createCheckoutQuote, getCheckoutOperation } from '../services/promotions/checkout.js';
import { cancelCheckoutOperation } from '../services/promotions/receipt.js';
import { SaleItemNormalizationError } from '../services/saleItemMeasurementService.js';

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
const principal = (req: any) => ({ tenantId: req.tenantId, userId: req.userId, role: req.role });
const handle = (run: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
    try { await run(req, res); } catch (error) {
        if (error instanceof PromotionError || error instanceof SaleItemNormalizationError) return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        console.error('Error de promociones:', error instanceof Error ? error.name : 'Error');
        res.status(500).json({ error: 'No pudimos completar la operación.' });
    }
};
router.post('/checkout/quote', authenticate, checkRole(POS_SALE_ROLES), handle(async (req, res) => {
    const parsed = z.object({ shiftId: z.string().min(1).max(191), sale: z.unknown() }).safeParse(req.body);
    if (!parsed.success) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'Revisá el carrito y la caja antes de cobrar.');
    res.json(await createCheckoutQuote(principal(req), parsed.data));
}));
router.get('/checkout/operations/:offlineId', authenticate, checkRole(POS_SALE_ROLES), handle(async (req, res) => {
    const result = await getCheckoutOperation(principal(req), req.params.offlineId);
    res.status(result.status === 'NOT_FOUND' ? 404 : 200).json(result);
}));
router.post('/checkout/operations/:offlineId/cancel', authenticate, checkRole(POS_SALE_ROLES), handle(async (req, res) => {
    if (!z.object({}).strict().safeParse(req.body).success) throw new PromotionError('PROMOTION_INVALID_INPUT', 400, 'La cancelación sólo recibe el identificador del cobro.');
    res.json(await cancelCheckoutOperation(principal(req), req.params.offlineId));
}));
router.get('/', authenticate, checkRole(PROMOTION_MANAGE_ROLES), handle(async (req, res) => {
    await authorizePromotion(prisma, principal(req), true);
    const fiscal = await promotionFiscal(prisma, req.tenantId);
    const rows = await prisma.promotion.findMany({ where: { tenantId: req.tenantId }, orderBy: { createdAt: 'desc' }, take: 50, include: { items: { take: 200, include: { product: { select: productColumns } } } } });
    const now = new Date();
    res.json({ data: json(rows.map(row => ({ ...row,
        effectiveStatus: row.status === 'CANCELLED' ? 'CANCELLED' : row.endsAt <= now ? 'EXPIRED'
            : row.items.some(item => item.configHash !== promotionHash(promotionConfig(item.product, fiscal))) ? 'SUSPENDED'
            : row.startsAt > now ? 'SCHEDULED' : 'ACTIVE',
        items: row.items.map(({ product: _product, ...item }) => item),
    }))) });
}));
export default router;
