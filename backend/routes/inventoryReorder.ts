import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import { getInventoryReorder } from '../services/inventoryReorderService.js';

const integer = (fallback: number, max: number) => z.preprocess(value => value === undefined ? fallback : value,
  z.union([z.number().int(), z.string().regex(/^[1-9]\d*$/).transform(Number)]).pipe(z.number().int().min(1).max(max)));
const querySchema = z.object({ page: integer(1, 100_000), pageSize: integer(100, 100) });
const router = express.Router();
router.get('/', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'La página debe ser positiva y el tamaño entre 1 y 100.', code: 'REORDER_PAGINATION_INVALID' });
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(await getInventoryReorder(req.tenantId, { page: query.data.page!, pageSize: query.data.pageSize! }));
  } catch (error) {
    console.error('Error calculando reposición', { name: error instanceof Error ? error.name : 'UnknownError', code: (error as { code?: string })?.code });
    return res.status(500).json({ error: 'No se pudo calcular la reposición. Intentá nuevamente.' });
  }
});
export default router;
