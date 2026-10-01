/** Harness local: sólo router admin real y bundle compilado, sin jobs del monolito. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import express from 'express';
import path from 'node:path';
const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
assert.equal(url.hostname, '127.0.0.1');
assert.match(url.pathname, /^\/nortex_test_admin_main(?:_[a-z0-9]+)?$/);
assert.equal(process.env.NORTEX_QA_DATABASE_ACK, 'disposable-database');
process.env.JWT_SECRETS = randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
const { default: db } = await import('../../backend/lib/prisma');
const { signAuthToken } = await import('../../backend/services/secrets');
const { buildAdminOverviewRouter } = await import('../../backend/routes/adminOverview');
const { createAdminOverviewService } = await import('../../backend/services/adminOverviewService');
const app = express();
const qaDir = process.env.NORTEX_ADMIN_QA_DIR ?? '/tmp/nortex-admin-qa-20260930';
// Modo exclusivo del fixture loopback: ausencia de respuesta HTTP, nunca503.
// La app productiva no recibe esta ruta ni una opción para activarlo.
app.get('/api/admin/metrics', (req, _res, next) => {
    if (existsSync(path.join(qaDir, 'metrics-transport-failure'))) {
        console.log('QA metrics socket closed without HTTP response');
        req.socket.destroy();
        return;
    }
    next();
});
app.use('/api/admin', buildAdminOverviewRouter(createAdminOverviewService(db, () => new Date('2026-09-30T12:00:00Z'))));
// Los módulos secundarios conservados sólo se montan después del acceso admin.
// Sus backends completos quedan fuera de este harness (no se simula aceptación).
app.use('/api', (_req, res) => { res.status(404).json({error: 'Fuera del harness de QA admin'}); });
app.use(express.static(path.resolve('dist')));
app.get('/{*splat}', (_req, res) => { res.sendFile(path.resolve('dist/index.html')); });
const server = app.listen(33318, '127.0.0.1', async () => {
    await writeFile(qaDir + '/ui-session.json', JSON.stringify({
        admin: signAuthToken({ userId: 'admin', tenantId: 'internal', role: 'SUPER_ADMIN' }),
        owner: signAuthToken({ userId: 'owner-a', tenantId: 'real-a', role: 'SUPER_ADMIN' }),
    }), { mode: 0o600 });
    console.log('UI QA ready: 127.0.0.1:33318 / own synthetic DB / real admin router');
});
process.once('SIGTERM', () => { server.close(() => { void db.$disconnect().then(() => process.exit()); }); });
