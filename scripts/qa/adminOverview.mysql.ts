/** Ejecutar sólo después de preparar main base en una DB nueva propia. Nunca usa DB real. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { AdminOverview } from '../../utils/adminMetrics';

const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
assert.equal(url.protocol, 'mysql:');
assert.equal(url.hostname, '127.0.0.1');
assert.match(url.pathname, /^\/nortex_test_admin_main(?:_[a-z0-9]+)?$/);
assert.equal(process.env.NORTEX_QA_DATABASE_ACK, 'disposable-database');
process.env.JWT_SECRETS = randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
const { default: db } = await import('../../backend/lib/prisma');
const { Prisma } = await import('@prisma/client');
const { createAdminOverviewService } = await import('../../backend/services/adminOverviewService');
const { buildAdminOverviewRouter } = await import('../../backend/routes/adminOverview');
const { signAuthToken } = await import('../../backend/services/secrets');
const now = new Date('2026-09-30T12:00:00.000Z');
const checks: string[] = [];
async function check(name: string, action: () => unknown | Promise<unknown>) { await action(); checks.push(name); }
const app = express();
app.use('/api/admin', buildAdminOverviewRouter(createAdminOverviewService(db, () => now)));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}/api/admin`;
const tenant = (id: string, patch = {}) => ({ id, businessName: `Comercio sintético ${id}`, taxId: `SYNTHETIC-${id}`,
    type: 'FERRETERIA', createdAt: new Date('2026-08-01T12:00:00Z'), subscriptionStatus: 'ACTIVE', ...patch });
const user = (id: string, tenantId: string, role = 'OWNER') => ({ id, tenantId, role, status: 'ACTIVE', name: 'Usuario sintético', password: 'synthetic-non-login-value' });
let token = '';
async function request(path = '/metrics', auth: string | null = token) {
    return fetch(base + path, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
}
async function overview(path = '/metrics'): Promise<AdminOverview> {
    const res = await request(path); assert.equal(res.status, 200); return res.json() as Promise<AdminOverview>;
}
try {
    assert.equal(await db.tenant.count(), 0, 'La DB debe ser NUEVA y vacía; el runner nunca limpia una base existente.');
    await db.tenant.createMany({ data: ['real-a', 'real-b', 'demo', 'unknown', 'internal'].map(id => tenant(id)) });
    await db.user.createMany({ data: [user('owner-a', 'real-a'), user('owner-b', 'real-b'), user('owner-demo', 'demo'),
        user('owner-unknown', 'unknown'), user('admin', 'internal', 'SUPER_ADMIN')] });
    token = signAuthToken({ userId: 'admin', tenantId: 'internal', role: 'SUPER_ADMIN' });
    const legacyBefore = await db.tenant.findUniqueOrThrow({ where: { id: 'real-a' } });
    await check('Esquema todavía sin evidencia responde 503, nunca cero', async () => assert.equal((await request()).status, 503));
    const ddl = await readFile('backend/prisma/migrations/202609300010_platform_admin_evidence/migration.sql', 'utf8');
    for (const statement of ddl.split(';').map(s => s.trim()).filter(Boolean)) await db.$executeRaw(Prisma.raw(statement));
    await check('Upgrade SQL aditivo conserva tenant/beneficios legacy', async () => assert.deepEqual(await db.tenant.findUniqueOrThrow({ where: { id: 'real-a' } }), legacyBefore));
    let data = await overview();
    await check('Consulta ejecuta SQL válido en MySQL8 tras upgrade', () => assert.equal(data.metrics.registered, 5));
    await check('Sin metadatos: todas las cuentas quedan UNKNOWN', () => assert.deepEqual([data.metrics.real, data.metrics.unclassified, data.metrics.founders], [0, 5, 0]));
    await check('Sin recibos: no infiere MRR ni suscripciones pagadas desde ACTIVE', () => assert.deepEqual([data.billing.mrr, data.billing.payingSubscriptions, data.billing.reconciledPaymentsThisMonth], [null, null, []]));
    await check('Lectura no siembra evidencia administrativa', async () => assert.equal(await db.platformAccountEvidence.count(), 0));
    await db.platformAccountEvidence.createMany({ data: [
        { tenantId: 'real-a', businessKind: 'REAL', founder: true, evidenceReference: 'synthetic-account-a', verifiedAt: now },
        { tenantId: 'real-b', businessKind: 'REAL', founder: true, benefitStartedAt: new Date('2025-10-15T06:00:00Z'),
            benefitEndsAt: new Date('2026-10-15T06:00:00Z'), evidenceReference: 'synthetic-account-b', verifiedAt: now },
        { tenantId: 'demo', businessKind: 'DEMO', founder: false, evidenceReference: 'synthetic-demo', verifiedAt: now },
        { tenantId: 'internal', businessKind: 'INTERNAL', evidenceReference: 'synthetic-internal', verifiedAt: now },
    ] });
    await db.product.create({ data: { id: 'product-a', tenantId: 'real-a', sku: 'SYNTHETIC', name: 'Producto sintético', price: 1, cost: 1, stock: -1, createdBy: 'owner-a' } });
    await db.shift.create({ data: { id: 'shift-a', tenantId: 'real-a', userId: 'owner-a', status: 'OPEN', initialCash: 0, startTime: new Date('2026-09-28T12:00:00Z') } });
    const sale = (id: string, tenantId: string, createdAt: string, status = 'COMPLETED', patch = {}) => ({
        id, tenantId, total: '90000', status, paymentMethod: 'CASH', createdAt: new Date(createdAt), ...patch });
    await db.sale.createMany({ data: [
        sale('a-1', 'real-a', '2026-09-28T05:55:00Z'), sale('a-2', 'real-a', '2026-09-28T06:05:00Z', 'CREDIT_PENDING', { balance: '5' }),
        sale('a-void', 'real-a', '2026-08-01T06:00:00Z', 'VOIDED'), sale('a-draft', 'real-a', '2026-08-01T06:00:00Z', 'DRAFT'),
        sale('a-cancelled', 'real-a', '2026-08-01T06:00:00Z', 'COMPLETED', { cancelledAt: now }),
        sale('a-failed', 'real-a', '2026-08-01T06:00:00Z', 'FAILED'), sale('a-future', 'real-a', '2027-01-01T06:00:00Z'),
        sale('demo-sale', 'demo', '2026-09-27T12:00:00Z'), sale('unknown-sale', 'unknown', '2026-09-27T12:00:00Z'),
    ] });
    await db.user.update({ where: { id: 'owner-demo' }, data: { lastLogin: now } });
    // A support login must not make a dormant customer appear active.
    await db.user.create({ data: { ...user('support-b', 'real-b', 'SUPER_ADMIN'), lastLogin: now } });
    await db.auditLog.createMany({ data: [
        { tenantId: 'real-a', userId: 'owner-a', action: 'PRODUCT_CREATED', details: '{"source":"BULK_IMPORT"}', createdAt: new Date('2026-09-29T12:00:00Z') },
        { tenantId: 'real-a', userId: 'owner-a', action: 'PRODUCT_CREATED', details: '{broken historical JSON', createdAt: new Date('2026-09-29T12:00:00Z') },
        { tenantId: 'real-a', userId: 'owner-a', action: 'PRODUCT_BULK_UPDATED', createdAt: new Date('2026-09-29T12:00:00Z') },
        { tenantId: 'real-a', userId: 'owner-a', action: 'PAYROLL_JOURNAL_SKIPPED', createdAt: new Date('2026-09-29T12:00:00Z') },
        { tenantId: 'real-b', userId: 'support-b', action: 'SUPPORT_REVIEW', createdAt: now },
    ] });
    await db.assistantJob.create({ data: { tenantId: 'real-a', userId: 'owner-a', roleAtCreation: 'OWNER', attachmentIds: [], status: 'FAILED', updatedAt: new Date('2026-09-29T12:00:00Z') } });
    await db.manualPayment.create({ data: { tenantId: 'unknown', amount: '8000', bank: 'SYNTHETIC', referenceNumber: 'not-reconciled', status: 'APPROVED', reviewedAt: now, reviewedBy: 'admin' } });
    data = await overview();
    const a = data.tenants.find(t => t.id === 'real-a')!, b = data.tenants.find(t => t.id === 'real-b')!;
    await check('Demos e internos separados; cuentas sin evidencia no se adivinan', () => assert.deepEqual([data.metrics.real, data.metrics.demo, data.metrics.internal, data.metrics.unclassified], [2, 1, 1, 1]));
    await check('Activación excluye demo, unknown, anuladas, borradores, fallos y futuro', () => assert.deepEqual([data.metrics.activated, a.confirmedSales, a.firstSaleAt], [1, 2, '2026-09-28T05:55:00.000Z']));
    await check('Recurrencia usa dos días civiles de Managua aunque compartan día UTC', () => assert.deepEqual([a.saleDays30d, data.metrics.recurring30d], [2, 1]));
    await check('Última actividad procede de una operación observada', () => assert.equal(a.lastActivityAt, '2026-09-29T12:00:00.000Z'));
    await check('Login/auditoría de SUPER_ADMIN no activan al comercio', () => assert.deepEqual([b.lastActivityAt, data.metrics.active30d, data.metrics.inactive30d], [null, 1, 1]));
    await check('Importación cuenta filas confirmadas y tolera JSON histórico inválido', () => assert.equal(a.importedRows30d, 2));
    await check('Fallos observados muestran cobertura parcial', () => assert.deepEqual([a.accountingWarnings30d, a.assistantFailures30d, /parcial/.test(data.coverage.errors)], [1, 1, true]));
    await check('Señales de inventario/caja/fiado vienen de tablas del comercio', () => assert.deepEqual([a.negativeStockProducts, a.openShiftsOver24h, a.creditSalesWithBalance, data.metrics.businessesToReview], [1, 1, 1, 1]));
    await check('Un año gratis no se fecha desde alta, trial o ACTIVE', () => assert.deepEqual([a.founder, a.benefitStartedAt, a.benefitEndsAt, a.benefitState], [true, null, null, 'DATES_UNKNOWN']));
    await check('Vencimiento usa sólo fechas explícitas y no suspende', () => assert.deepEqual([b.benefitState, data.metrics.benefitsEnding30d, data.metrics.founderDatesUnknown, b.recordedSubscriptionStatus], ['ENDING_SOON', 1, 1, 'ACTIVE']));
    await check('Cohorte verificada tiene denominador de negocios reales', () => assert.deepEqual(data.cohorts, [{ month: '2026-08', registered: 2, founders: 2, activated: 1, active30d: 1, recurring30d: 1 }]));
    await check('Ventas del comercio/voucher APPROVED no generan ingresos de Nortex', () => assert.deepEqual(data.billing.reconciledPaymentsThisMonth, []));
    const payment = (tenantId: string, ref: string, amount: string, currency: string, patch = {}) => ({ tenantId, evidenceReference: ref, amount, currency, paidAt: now, reconciledAt: now, ...patch });
    await db.platformPaymentEvidence.createMany({ data: [payment('real-a', 'p-1', '0.1', 'USD'), payment('real-a', 'p-2', '0.2', 'USD'),
        payment('real-a', 'p-3', '100', 'NIO'), payment('demo', 'p-demo', '8000', 'USD'),
        payment('real-a', 'p-future', '1000', 'USD', { reconciledAt: new Date('2027-01-01') }),
        payment('real-a', 'p-before-month', '1000', 'USD', { paidAt: new Date('2026-09-01T05:59:00Z') })] });
    data = await overview();
    await check('Conciliación exacta Decimal y monedas separadas; mes Managua', () => assert.deepEqual(data.billing.reconciledPaymentsThisMonth.sort((x,y) => x.currency.localeCompare(y.currency)), [
        { currency: 'NIO', count: 1, amount: '100.0000' }, { currency: 'USD', count: 2, amount: '0.3000' }]));
    await check('Recibos parciales tampoco inventan MRR', () => assert.equal(data.billing.mrr, null));
    await check('API no retorna datos personales, comprobantes ni fintech', () => {
        for (const key of ['email', 'phone', 'taxId', 'password', 'walletBalance', 'creditLimit', 'creditScore', 'evidenceReference']) assert(!Object.hasOwn(a, key), key);
    });
    await check('Filtro sin primera venta devuelve únicamente el comercio pendiente', async () => assert.deepEqual((await overview('/metrics?kind=REAL&focus=NO_SALE')).tenants.map(t => t.id), ['real-b']));
    await check('Filtro incidencias devuelve cuentas con evidencia', async () => assert.deepEqual((await overview('/metrics?kind=REAL&focus=ERRORS')).tenants.map(t => t.id), ['real-a']));
    await check('Filtro operaciones no mezcla datos entre tenants', async () => assert.deepEqual((await overview('/metrics?kind=REAL&focus=OPERATIONS')).tenants.map(t => t.id), ['real-a']));
    await check('Búsqueda parametrizada no permite inyección SQL ni wildcard', async () => assert.equal((await overview("/metrics?search=" + encodeURIComponent("%' OR 1=1 --"))).tenants.length, 0));
    await check('GET sin JWT está cerrado', async () => assert.equal((await request('/metrics', null)).status, 401));
    const ownerToken = signAuthToken({ userId: 'owner-a', tenantId: 'real-a', role: 'SUPER_ADMIN' });
    await check('JWT firmado con claim elevado no concede rol global a OWNER', async () => assert.equal((await request('/metrics', ownerToken)).status, 403));
    await check('Otro tenant no obtiene listado global', async () => assert.equal((await request('/tenants', signAuthToken({ userId: 'owner-b', tenantId: 'real-b', role: 'OWNER' }))).status, 403));
    await check('Query no permite elegir identidad/tenant', async () => assert.equal((await request('/metrics?tenantId=real-a')).status, 400));
    await check('GET privado no se cachea', async () => assert.equal((await request()).headers.get('cache-control'), 'private, no-store'));
    await check('No hay nueva mutación administrativa', async () => assert.equal((await fetch(base + '/metrics', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 404));
    await db.user.update({ where: { id: 'owner-b' }, data: { lastLogin: new Date('2026-09-30T05:59:00Z') } });
    await check('Última actividad serializa UTC no nula en borde previo de Managua', async () => {
        const row = (await overview('/metrics?search=real-b')).tenants[0];
        assert.equal(row.lastActivityAt, '2026-09-30T05:59:00.000Z');
    });
    await db.auditLog.create({ data: { tenantId: 'real-b', userId: 'owner-b', action: 'SYNTHETIC_OPERATION', createdAt: new Date('2026-09-30T06:00:00Z') } });
    await check('Última actividad elige operación más reciente en medianoche de Managua', async () => {
        assert.equal((await overview('/metrics?search=real-b')).tenants[0].lastActivityAt, '2026-09-30T06:00:00.000Z');
    });
    await db.tenant.createMany({ data: Array.from({ length: 51 }, (_, i) => tenant(`page-${String(i).padStart(2, '0')}`, { createdAt: new Date('2026-09-01T06:00:00Z') })) });
    const page1 = await overview(), page2 = await overview('/tenants?page=2');
    await check('Paginación estable y acotada sobre más de50 tenants', () => {
        assert.equal(page1.tenants.length, 50); assert.equal(page2.tenants.length, 6);
        assert.equal(new Set([...page1.tenants, ...page2.tenants].map(t => t.id)).size, 56);
        assert.deepEqual(page2.pagination, { page: 2, pageSize: 50, total: 56, pages: 2 });
    });
    await check('Cambiar metadatos a futuro no genera clasificación verificada', async () => {
        await db.platformAccountEvidence.update({ where: { tenantId: 'demo' }, data: { verifiedAt: new Date('2027-01-01') } });
        assert.equal((await overview('/metrics?search=demo')).tenants[0].kind, 'UNKNOWN');
    });
    await db.user.update({ where: { id: 'admin' }, data: { status: 'DISABLED' } });
    await check('Administrador deshabilitado pierde acceso con JWT todavía vigente', async () => assert.equal((await request()).status, 403));
    await db.user.update({ where: { id: 'admin' }, data: { status: 'ACTIVE' } });
    await check('Lecturas no modifican beneficio ni suscripción legacy', async () => assert.deepEqual(await db.tenant.findUniqueOrThrow({ where: { id: 'real-a' } }), legacyBefore));
    const output = process.env.NORTEX_ADMIN_QA_REPORT ?? '/tmp/nortex-admin-qa-20260930/main-mysql.json';
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    await writeFile(output, JSON.stringify({ sourceCommit, sourceTree, result: 'PASS', assertions: checks.length,
        database: 'own disposable MySQL8 / nortex_test_admin_main', checks }, null, 2));
    console.log(`PASS: ${checks.length} comprobaciones HTTP/MySQL8 sintéticas; ${output}`);
} finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
}
