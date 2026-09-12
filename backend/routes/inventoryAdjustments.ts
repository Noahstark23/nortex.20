import express from 'express';
import { ZodError } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import { BODEGUERO_ROLE } from '../security/bodegueroPolicy.js';
import { InventoryAdjustSchema, validate } from '../validation/schemas.js';
import { executeInventoryAdjustment, InventoryAdjustmentError } from '../services/inventoryAdjustmentService.js';
import { PeriodLockedError } from '../services/accounting.js';
import { StockError } from '../services/stockService.js';
import { QuantityValidationError } from '../../utils/quantity.js';

const router = express.Router();
router.post('/', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), validate(InventoryAdjustSchema), async (req: any, res: any) => {
  try {
    return res.json(await executeInventoryAdjustment({ principal: { tenantId: req.tenantId, userId: req.userId }, input: req.body }));
  } catch (error) {
    if (error instanceof InventoryAdjustmentError) return res.status(error.httpStatus).json({ error: error.message, code: error.code,
      ...(error.rejection ? { outcome: 'REJECTED', clientEventId: error.rejection.clientEventId, rejection: error.rejection } : {}) });
    if (error instanceof PeriodLockedError) return res.status(409).json({ error: error.message, code: 'FISCAL_PERIOD_CLOSED' });
    if (error instanceof QuantityValidationError) return res.status(400).json({ error: error.message, code: error.code });
    if (error instanceof ZodError) return res.status(400).json({ error: 'Datos de entrada inválidos', details: error.issues });
    if (error instanceof StockError) {
      const status = error.code === 'PRODUCT_NOT_FOUND' ? 404 : ['WAREHOUSE_REQUIRED', 'INSUFFICIENT_STOCK'].includes(error.code) ? 409 : 400;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    if ((error as { code?: string })?.code === 'P2034') return res.status(409).json({ error: 'Otro movimiento cambió las existencias. Reintentá con el mismo identificador.', code: 'INVENTORY_ADJUSTMENT_CONCURRENT_WRITE' });
    console.error('Error en ajuste de inventario', { name: error instanceof Error ? error.name : 'UnknownError', code: (error as { code?: string })?.code });
    return res.status(500).json({ error: 'No se pudo confirmar el ajuste. Reintentá con el mismo identificador.' });
  }
});
export default router;
