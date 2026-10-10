import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import { verifyAuthToken } from '../services/secrets.js';
import { DemoResetError, confirmDemoReset, demoResetEligibility, previewDemoReset, readDemoResetReceipt } from '../services/demoAccountReset.js';

const router = Router();
const attempts = rateLimit({ windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => req.userId,
  message: { error: 'Esperá un minuto antes de intentar de nuevo.' } });
const previewSchema = z.object({ requestKey: z.string().uuid().transform(s => s.toLowerCase()) }).strict();
const confirmSchema = previewSchema.extend({
  previewId: z.string().uuid(), password: z.string().min(1).max(256),
  confirmation: z.literal('REINICIAR'), confirmedTestData: z.literal(true),
});
function fail(res: any, error: unknown) {
  if (error instanceof DemoResetError) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error('No se pudo completar el reinicio de prueba.');
  return res.status(500).json({ error: 'No se pudo confirmar el resultado. Verificá este mismo intento antes de iniciar otro.', code: 'RESET_UNCERTAIN' });
}
// El token anterior solo permite leer SU comprobante después de quedar revocado.
router.get('/receipts/:requestKey', async (req, res) => {
  const key = z.string().uuid().safeParse(req.params.requestKey);
  if (!key.success) return res.status(400).json({ error: 'Identificador inválido.' });
  let principal;
  try {
    const authorization = req.headers.authorization ?? '';
    if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Necesitás tu sesión para verificar este intento.' });
    principal = verifyAuthToken(authorization.slice(7));
    if (!principal.tenantId || !principal.userId) return res.status(403).json({ error: 'Sesión inválida.' });
  } catch { return res.status(403).json({ error: 'Sesión inválida.' }); }
  res.set('Cache-Control', 'no-store');
  try { return res.json(await readDemoResetReceipt(principal, key.data.toLowerCase())); }
  catch (error) { return fail(res, error); }
});
router.use(authenticate, checkRole(['OWNER', 'ADMIN']));
router.get('/', async (req: any, res) => {
  res.set('Cache-Control', 'no-store');
  try { return res.json(await demoResetEligibility(req)); } catch (error) { return fail(res, error); }
});
router.post('/preview', attempts, async (req: any, res) => {
  const input = previewSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Datos de revisión inválidos.' });
  res.set('Cache-Control', 'no-store');
  try { return res.json(await previewDemoReset(req, input.data.requestKey)); } catch (error) { return fail(res, error); }
});
router.post('/confirm', attempts, async (req: any, res) => {
  const input = confirmSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Confirmá que son datos de prueba y escribí REINICIAR.' });
  res.set('Cache-Control', 'no-store');
  try { return res.json(await confirmDemoReset(req, { ...input.data, requestKey: input.data.requestKey! })); } catch (error) { return fail(res, error); }
});
export default router;
