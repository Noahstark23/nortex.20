import { promotionHash, PromotionError, PROMOTION_MANAGE_ROLES } from '../../promotions/authority.js';
import { executePromotionInTransaction, parsePromotionDraft, preparePromotion } from '../../promotions/management.js';
import type { AssistantActionAdapter } from './types.js';

export const promotionActionAdapter: AssistantActionAdapter = {
    roles: PROMOTION_MANAGE_ROLES,
    parseDraft: raw => JSON.parse(JSON.stringify(parsePromotionDraft(raw))),
    async prepare(principal, draft, tx) {
        try {
            const result = await preparePromotion(principal, draft, tx);
            return { hash: result.hash, issues: [], preview: JSON.parse(JSON.stringify(result.preview)) };
        } catch (error) {
            if (!(error instanceof PromotionError)) throw error;
            if (error.httpStatus === 403) throw error;
            return { hash: promotionHash({ draft, issue: error.code }), issues: [error.message], preview: {
                summary: 'Completá y revisá la promoción', lines: [], effects: [], warnings: [error.message], confirmLabel: 'Publicar promoción',
            } };
        }
    },
    async execute(principal, draft, context) {
        const result = await executePromotionInTransaction(principal, draft, context);
        return { resourceId: result.promotionId, message: result.status === 'CANCELLED' ? 'Promoción cancelada. Las ventas registradas conservan su precio.' : 'Promoción publicada para POS con conexión. No se movió inventario ni dinero.' };
    },
};
