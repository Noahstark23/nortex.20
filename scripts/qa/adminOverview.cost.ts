/** Medición acotada sintética; no es capacidad productiva ni consulta de clientes. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
assert.equal(url.hostname, '127.0.0.1');
assert.match(url.pathname, /^\/nortex_test_admin_main_v2cost$/);
assert.equal(process.env.NORTEX_QA_DATABASE_ACK, 'disposable-database');
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const { createAdminOverviewService } = await import('../../backend/services/adminOverviewService');
const now = new Date('2026-09-30T12:00:00Z');
const service = createAdminOverviewService(db, () => now);
const observed: { query: string; params: string; duration: number }[] = [];
let capture = false;
db.$on('query', event => { if (capture && (/^\s*WITH\b/.test(event.query) || event.query.includes('FROM PlatformPaymentEvidence'))) observed.push(event); });
try {
    assert.equal(await db.tenant.count({ where: { id: { startsWith: 'cost-' } } }), 0, 'No repetir seed en una DB ya usada para esta medición.');
    const tenants = 200, salesPerTenant = 100;
    await db.tenant.createMany({ data: Array.from({ length: tenants }, (_, i) => ({ id: `cost-${i}`, businessName: `Medición sintética ${i}`, taxId: `SYNTHETIC-COST-${i}`, type: 'FERRETERIA', createdAt: new Date('2026-08-01T12:00:00Z') })) });
    await db.platformAccountEvidence.createMany({ data: Array.from({ length: tenants }, (_, i) => ({ tenantId: `cost-${i}`, businessKind: 'REAL', evidenceReference: `synthetic-cost-${i}`, verifiedAt: now })) });
    for (let i = 0; i < tenants; i++) await db.sale.createMany({ data: Array.from({ length: salesPerTenant }, (_, j) => ({ id: `cost-sale-${i}-${j}`, tenantId: `cost-${i}`, total: '1', status: 'COMPLETED', paymentMethod: 'CASH', createdAt: new Date(j % 2 ? '2026-09-15T06:05:00Z' : '2026-09-15T05:55:00Z') })) });
    const fixture = { tenants: await db.tenant.count(), sales: await db.sale.count(), products: await db.product.count(), audits: await db.auditLog.count(), addedTenants: tenants, addedSales: tenants * salesPerTenant };
    const samples: { page: number; wallMs: number; sqlMs: number[]; cteQueries: number }[] = [];
    let explainQueries: typeof observed = [];
    capture = true;
    for (let run = 0; run < 8; run++) {
        observed.length = 0; const start = performance.now(); const page = run % 2 + 1;
        const data = await service.getOverview({ page });
        assert.equal(data.metrics.registered, fixture.tenants);
        assert(data.tenants.length <= 50);
        const cteQueries = observed.filter(row => /^\s*WITH\b/.test(row.query));
        assert.equal(cteQueries.length, 4); assert.equal(observed.length, 5);
        samples.push({ page, wallMs: Math.round((performance.now() - start) * 100) / 100, sqlMs: observed.map(row => row.duration), cteQueries: cteQueries.length });
        if (run === 1) explainQueries = [...cteQueries];
    }
    capture = false;
    const plans = [];
    // Sólo SELECT capturados de Prisma.sql, con sus parámetros originales, sobre
    // la DB nueva propia validada arriba. No recibe SQL arbitrario ni tenants externos.
    for (const row of explainQueries) {
        const params = (JSON.parse(row.params) as unknown[]).map(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : value);
        const result = await db.$queryRawUnsafe<Record<string, string>[]>('EXPLAIN ANALYZE ' + row.query, ...params);
        plans.push(Object.values(result[0]).join('\n'));
    }
    const warmed = samples.slice(1).map(row => row.wallMs).sort((a, b) => a - b);
    const output = process.env.NORTEX_ADMIN_COST_REPORT ?? '../evidence/admin-v2/cost.json';
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    await writeFile(output, JSON.stringify({ sourceCommit, sourceTree, result: 'PASS', engine: (await db.$queryRawUnsafe<{ version: string }[]>('SELECT VERSION() AS version'))[0].version,
        fixture, samples, warmMedianMs: warmed[Math.floor(warmed.length / 2)], warmMaxMs: warmed.at(-1), plans,
        conclusion: 'Se ejecutan cuatro CTE globales por página más conciliación. Los planes muestran el trabajo real repetido; LIMIT50 no limita los agregados globales.',
        limits: ['Un cliente secuencial, ocho snapshots, dataset acotado sintético', 'No mide autorización HTTP, carga concurrente, cache fría controlada ni producción', 'No cambiar estrategia SQL en este lote; valorar reducción de agregados repetidos antes de escalar'] }, null, 2));
    console.log(`PASS: ocho snapshots y cuatro EXPLAIN ANALYZE; ${output}`);
} finally { await db.$disconnect(); }
