import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { DemoResetError, previewDemoReset, confirmDemoReset } from '../services/demoAccountReset.js';
import { adminResetReceipt, importAfterAdminReset } from '../services/adminDemoAccountReset.js';
const router = Router();
const key = z.string().uuid().transform(s => s.toLowerCase());
const previewSchema = z.object({ requestKey: key, ownerId: z.string().min(1).max(191) }).strict();
const confirmSchema = previewSchema.extend({ previewId: z.string().uuid(), password: z.string().min(1).max(256),
  confirmation: z.literal('REINICIAR'), confirmedTestData: z.literal(true), confirmedUnpaid: z.literal(true) });
const attempts = rateLimit({ windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => req.userId, message: { error: 'Esperá un minuto antes de intentar de nuevo.' } });
router.use(authenticate, requireSuperAdmin, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.param('tenantId', (_req, res, next, value) => value.length <= 191 ? next() : res.status(400).json({ error: 'Empresa inválida.' }));
function fail(res: any, error: unknown) {
  if (error instanceof DemoResetError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Revisá los datos de esta solicitud.' });
  console.error('No se pudo confirmar la operación de reinicio asistido.');
  return res.status(500).json({ error: 'Resultado incierto. Verificá este mismo intento antes de continuar.', code: 'RESET_UNCERTAIN' });
}
router.post('/:tenantId/preview', attempts, async (req: any, res) => {
  try {
    const input = previewSchema.parse(req.body);
    return res.json(await previewDemoReset(req, input.requestKey, { tenantId: req.params.tenantId, ownerId: input.ownerId }));
  } catch (error) { return fail(res, error); }
});
router.post('/:tenantId/confirm', attempts, async (req: any, res) => {
  try {
    const input = confirmSchema.parse(req.body);
    return res.json(await confirmDemoReset(req, { ...input, requestKey: input.requestKey! }, { tenantId: req.params.tenantId, ownerId: input.ownerId }));
  } catch (error) { return fail(res, error); }
});
router.get('/:tenantId/receipts/:requestKey', async (req: any, res) => {
  try { return res.json(await adminResetReceipt(req, req.params.tenantId, key.parse(req.params.requestKey))); }
  catch (error) { return fail(res, error); }
});
router.post('/:tenantId/receipts/:requestKey/products', async (req: any, res) => {
  try { return res.json(await importAfterAdminReset(req, req.params.tenantId, key.parse(req.params.requestKey), req.body)); }
  catch (error) { return fail(res, error); }
});
export default router;
