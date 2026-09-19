import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertCatalogMysqlTarget } from '../../../scripts/qa/catalog-identity-mysql.mjs';
import { searchAssistantCatalog } from '../../../backend/services/assistant/operations/catalogSearch.js';
import { getAssistantCatalogOptions } from '../../../backend/services/assistant/operations/catalogOptions.js';
import type { AssistantPrincipal } from '../../../shared/assistant.js';

assertCatalogMysqlTarget(process.env.DATABASE_URL, process.env.NORTEX_CATALOG_MYSQL_MARKER);
assert.equal(Prisma.prismaVersion.client, '6.4.1');
const db = new PrismaClient({ log: [{ level: 'query', emit: 'event' }] });
const sql: string[] = [];
let catalogQueryRecording = true;
let equivalenceQuery: { query: string; params: string } | undefined;
db.$on('query', event => {
  if (!catalogQueryRecording) return;
  sql.push(event.query);
  if (/REGEXP_REPLACE/i.test(event.query) && /FROM\s+Product\s+p/i.test(event.query)) equivalenceQuery = { query: event.query, params: event.params };
});
const owner = { tenantId: 'tenant-a', userId: 'owner-a', role: 'OWNER' };
const bodega = { tenantId: 'tenant-a', userId: 'bodega-a', role: 'BODEGUERO' };
const other = { tenantId: 'tenant-b', userId: 'owner-b', role: 'OWNER' };
const results: Array<{ name: string; status: string; error?: string }> = [];
let selectOnlyCredential = false;
let performanceDiagnostic: Record<string, unknown> | undefined;
const search = (principal: AssistantPrincipal, input: unknown) => searchAssistantCatalog(principal, input, { db, now: () => new Date('2026-09-19T00:00:00Z') });
const options = (principal: AssistantPrincipal, input: unknown) => getAssistantCatalogOptions(principal, input, { db });
async function check(name: string, run: () => Promise<void>) {
  try { await run(); results.push({ name, status: 'PASSED' }); }
  catch (error) { results.push({ name, status: 'FAILED', error: error instanceof Error ? error.message : String(error) }); }
}
/** El log de Prisma puede contener controles literales dentro de un parámetro de REGEXP. */
function loggedParameters(value: string): unknown[] {
  let quoted = false, escaped = false, json = '';
  for (const character of value) {
    if (quoted && character.charCodeAt(0) < 32) json += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    else json += character;
    if (escaped) { escaped = false; continue; }
    if (quoted && character === '\\') { escaped = true; continue; }
    if (character === '"') quoted = !quoted;
  }
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed));
  return parsed;
}
try {
  const marker = await db.$queryRaw<Array<{ tenantId: string }>>`SELECT tenantId FROM User WHERE id='fixture-marker'`;
  assert.equal(marker[0]?.tenantId, process.env.NORTEX_CATALOG_MYSQL_MARKER);
  const tables = await db.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`;
  assert.deepEqual(tables.map(row => row.TABLE_NAME).sort(), ['AssistantCatalogAlias', 'AssistantTenantConfig', 'Product', 'Supplier', 'User']);
  const grants = await db.$queryRawUnsafe<Array<Record<string, string>>>('SHOW GRANTS');
  const privileges = grants.flatMap(row => Object.values(row));
  assert.ok(privileges.some(grant => /^GRANT SELECT ON/.test(grant)));
  assert.ok(privileges.every(grant => /^GRANT (USAGE|SELECT) ON/.test(grant)));
  selectOnlyCredential = true;
  sql.length = 0;

  await check('OWNER distingue SKU/marca/unidad/empaque sin inferir peso', async () => {
    const { rows } = await search(owner, { kind: 'products', query: 'Cemento' });
    assert.deepEqual(rows.map(row => row.id), ['cement-a', 'cement-b']);
    assert.equal(rows[0].brand, 'Marca A'); assert.equal(rows[0].sku, 'CEM-A');
    assert.equal(rows[0].unit, 'bolsa'); assert.equal(rows[0].packSize, '12');
    assert.match(rows[0].detail!, /Factor 12 unidades base/); assert.notEqual(rows[0].detail, rows[1].detail);
    assert.ok(rows.every(row => !row.selectionIssue));
  });
  await check('BODEGUERO recibe la misma identidad sin campos financieros', async () => {
    const result = await search(bodega, { kind: 'products', query: 'Cemento' });
    assert.equal(result.rows.length, 2);
    assert.ok(result.rows.every(row => !Object.keys(row).some(key => /cost|price|stock|balance/i.test(key))));
  });
  await check('BODEGUERO no hereda el permiso administrativo de proveedores', async () => {
    await assert.rejects(() => search(bodega, { kind: 'suppliers', selectedId: 'central-a' }), { code: 'ASSISTANT_FORBIDDEN' });
    await assert.rejects(() => options(bodega, { kind: 'suppliers', query: 'Central' }), { code: 'ASSISTANT_FORBIDDEN' });
  });
  await check('los campos faltantes quedan null aunque el nombre sugiera peso', async () => {
    const { rows } = await search(owner, { kind: 'products', selectedId: 'sparse-a' });
    assert.equal(rows[0].label, 'Bolsa 50 kg'); assert.equal(rows[0].brand, null);
    assert.equal(rows[0].packSize, null); assert.equal(rows[0].packUnit, null);
    assert.equal(rows[0].quantityStep, null); assert.equal(rows[0].saleMode, null);
  });
  await check('Decimal y requisito de lote conservan significado de catálogo', async () => {
    const { rows } = await search(bodega, { kind: 'products', selectedId: 'batch-a' });
    assert.equal(rows[0].quantityStep, '0.25'); assert.equal(rows[0].requiresBatchTracking, true);
    assert.equal(rows[0].unit, 'kg'); assert.equal(rows[0].saleMode, 'MEASURED');
  });
  await check('selectedId recupera exactamente la ficha aunque cambie la búsqueda', async () => {
    const result = await options(owner, { kind: 'products', selectedId: 'cement-b', query: 'ninguna coincidencia' });
    assert.deepEqual(result.items.map(row => row.id), ['cement-b']); assert.equal(result.items[0].brand, 'Marca B');
  });
  await check('selectedId extranjero o inexistente nunca devuelve otra ficha', async () => {
    for (const selectedId of ['foreign-product', 'missing']) assert.deepEqual((await search(owner, { kind: 'products', selectedId })).rows, []);
    assert.deepEqual((await search(owner, { kind: 'suppliers', selectedId: 'foreign-supplier' })).rows, []);
  });
  await check('dos tenants homónimos permanecen separados en búsqueda', async () => {
    assert.deepEqual((await search(other, { kind: 'products', query: 'Cemento' })).rows.map(row => row.id), ['foreign-product']);
    assert.deepEqual((await search(other, { kind: 'suppliers', query: 'Distribuidora Central' })).rows.map(row => row.id), ['foreign-supplier']);
  });
  await check('proveedores homónimos distinguibles conservan RUC y dirección', async () => {
    const result = await options(owner, { kind: 'suppliers', query: 'Distribuidora Central' });
    assert.deepEqual(result.items.map(row => row.id), ['central-a', 'central-b']);
    assert.equal(result.items[0].ruc, 'RUC-A'); assert.equal(result.items[0].address, 'Managua');
    assert.equal(result.items[1].ruc, 'RUC-B'); assert.ok(result.items.every(row => !row.selectionIssue));
  });
  await check('proveedores inactivos y borrados no son recuperables por ID', async () => {
    for (const selectedId of ['inactive-supplier', 'deleted-supplier']) assert.deepEqual((await options(owner, { kind: 'suppliers', selectedId })).items, []);
  });
  await check('un separador dentro del RUC no colisiona visualmente con el campo dirección', async () => {
    const { items } = await options(owner, { kind: 'suppliers', query: 'Separador' });
    assert.deepEqual(items.map(row => row.id), ['separator-a', 'separator-b']);
    assert.equal(items[0].ruc, '123 · Dirección Managua'); assert.equal(items[0].address, null);
    assert.equal(items[1].ruc, '123'); assert.equal(items[1].address, 'Managua');
    assert.notEqual(items[0].detail, items[1].detail);
    assert.ok(items[0].detail!.includes(JSON.stringify('123 · Dirección Managua')));
    assert.ok(items[1].detail!.includes(JSON.stringify('Managua')));
    assert.ok(items.every(row => !row.selectionIssue));
    for (const selectedId of ['separator-a', 'separator-b']) {
      const recovered = await options(owner, { kind: 'suppliers', selectedId });
      assert.equal(recovered.items[0].id, selectedId); assert.equal(recovered.items[0].selectionIssue, undefined);
    }
  });
  await check('homónimos indistinguibles visibles quedan bloqueados', async () => {
    const { rows } = await search(owner, { kind: 'suppliers', query: 'Duplicado' });
    assert.equal(rows.length, 2); assert.ok(rows.every(row => row.selectionIssue));
  });
  await check('selectedId conserva bloqueo aunque la lista sea de una fila', async () => {
    const result = await options(owner, { kind: 'suppliers', selectedId: 'duplicate-b', limit: 1 });
    assert.equal(result.items[0].id, 'duplicate-b'); assert.ok(result.items[0].selectionIssue);
  });
  await check('la lista detecta identidad visual igual con espacios internos distintos', async () => {
    const { rows } = await search(owner, { kind: 'suppliers', query: 'Casa' });
    assert.equal(rows.length, 2); assert.equal(rows[0].label, rows[1].label);
    assert.ok(rows.every(row => row.selectionIssue));
  });
  await check('selectedId también bloquea duplicado visual con espacios internos distintos', async () => {
    const result = await options(owner, { kind: 'suppliers', selectedId: 'spaces-a', limit: 1 });
    assert.equal(result.items[0].id, 'spaces-a');
    assert.ok(result.items[0].selectionIssue, 'selectedId habilitó Casa Central pese a otra ficha con la misma identidad visible');
  });
  await check('dirección truncada bloquea elección porque faltan datos visibles', async () => {
    const { rows } = await search(owner, { kind: 'suppliers', selectedId: 'long-address' });
    assert.equal(rows[0].id, 'long-address'); assert.ok(rows[0].selectionIssue);
  });
  for (const [name, kind, selectedId] of [
    ['21 productos con mismo prefijo y nombres distintos', 'products', 'prefix-product-20'],
    ['21 productos con mismo nombre y SKU distintos', 'products', 'same-name-product-20'],
    ['21 proveedores con mismo prefijo y nombres distintos', 'suppliers', 'prefix-supplier-20'],
    ['21 proveedores con mismo nombre y RUC distintos', 'suppliers', 'many-20'],
    ['21 proveedores con mismo nombre y RUC pero direcciones distintas', 'suppliers', 'address-supplier-20'],
  ] as const) await check(`selectedId inequívoco no se bloquea entre ${name}`, async () => {
    const result = await options(owner, { kind, selectedId, limit: 1 });
    assert.equal(result.items[0].id, selectedId);
    assert.equal(result.items[0].selectionIssue, undefined, `La ficha ${selectedId} se distingue visiblemente y no debe bloquearse por el número de candidatos`);
  });
  await check('límite máximo y subconjunto elegido son deterministas', async () => {
    assert.equal((await search(owner, { kind: 'products', query: 'Listado' })).rows.length, 20);
    assert.deepEqual((await options(owner, { kind: 'products', query: 'Listado', limit: 3 })).items.map(row => row.id), ['list-00', 'list-01', 'list-02']);
    await assert.rejects(() => search(owner, { kind: 'products', query: 'Listado', limit: 21 }));
  });
  await check('alias aprobado sólo propone dentro del negocio', async () => {
    assert.deepEqual((await search(owner, { kind: 'products', query: 'favorito sintético' })).rows.map(row => row.id), ['cement-b']);
    assert.deepEqual((await search(owner, { kind: 'products', query: 'alias retirado' })).rows, []);
  });
  await check('usuario inactivo y tenant forjado fallan antes de devolver catálogo', async () => {
    await assert.rejects(() => search({ ...owner, userId: 'inactive-a' }, { kind: 'products', selectedId: 'cement-a' }), { code: 'SESSION_REVOKED' });
    await assert.rejects(() => search({ ...owner, tenantId: 'tenant-b' }, { kind: 'products', selectedId: 'foreign-product' }), { code: 'SESSION_REVOKED' });
  });
  await check('diagnóstico de 20 lecturas exactas limita recorrido a 10.000 productos del tenant entre 20.000 totales', async () => {
    const count = await db.product.count({ where: { tenantId: owner.tenantId } });
    assert.equal(count, 10_000);
    const otherCount = await db.product.count({ where: { tenantId: other.tenantId } });
    const totalCount = await db.product.count();
    assert.equal(otherCount, 10_000); assert.equal(totalCount, 20_000);
    const samplesMs: number[] = [];
    const statementsBefore = sql.length;
    equivalenceQuery = undefined;
    for (let index = 5000; index < 5020; index++) {
      const selectedId = `volume-${String(index).padStart(5, '0')}`;
      const started = performance.now();
      const result = await options(owner, { kind: 'products', selectedId, limit: 1 });
      samplesMs.push(performance.now() - started);
      assert.equal(result.items[0].id, selectedId);
      assert.equal(result.items[0].selectionIssue, undefined);
    }
    const queryCount = sql.length - statementsBefore;
    assert.ok(equivalenceQuery, 'No se observó la consulta real de equivalencia del catálogo');
    const captured = equivalenceQuery as { query: string; params: string };
    const sorted = [...samplesMs].sort((a, b) => a - b);
    const rounded = (value: number) => Math.round(value * 1000) / 1000;
    performanceDiagnostic = {
      scope: 'Diagnóstico local después de los casos funcionales; no acredita capacidad de producción.',
      tenantProductCount: count, otherTenantProductCount: otherCount, totalProductCount: totalCount,
      sequentialExactReads: 20, distinctSelectedIds: 20, concurrentReads: 1,
      percentileMethod: 'nearest rank', p50Ms: rounded(sorted[Math.ceil(sorted.length * 0.50) - 1]),
      p95Ms: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]), totalMs: rounded(samplesMs.reduce((sum, value) => sum + value, 0)),
      samplesMs: samplesMs.map(rounded), queryCount, queriesPerRead: queryCount / samplesMs.length,
      equivalenceQuerySha256: createHash('sha256').update(captured.query).digest('hex'), equivalenceQuery: captured.query.trim(),
    };
    catalogQueryRecording = false;
    try {
      const planRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`EXPLAIN FORMAT=JSON ${captured.query}`, ...loggedParameters(captured.params));
      const value = Object.values(planRows[0] ?? {})[0];
      performanceDiagnostic.explain = typeof value === 'string' ? JSON.parse(value) : value;
      assert.ok(performanceDiagnostic.explain, 'EXPLAIN no devolvió un plan');
      const actualRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`EXPLAIN ANALYZE ${captured.query}`, ...loggedParameters(captured.params));
      const actualPlan = actualRows.flatMap(row => Object.values(row)).map(String).join('\n');
      performanceDiagnostic.explainAnalyze = actualPlan;
      performanceDiagnostic.diagnosticExplainStatements = 2;
      const lookupLine = actualPlan.split('\n').find(line => /Index (?:lookup|range scan) on p using Product_tenantId_name_idx/.test(line));
      assert.ok(lookupLine, 'La equivalencia debe usar lookup/range del índice por tenant, no recorrer PRIMARY');
      assert.match(lookupLine, /tenantId/);
      const actualLookup = lookupLine.match(/\brows=([\d.e+-]+)\s+loops=([\d.e+-]+)\)/);
      assert.ok(actualLookup, 'Falta el conteo real de la consulta por tenant');
      const actualLookupRows = Number(actualLookup[1]) * Number(actualLookup[2]);
      performanceDiagnostic.actualTenantLookupRows = actualLookupRows;
      assert.ok(Number.isFinite(actualLookupRows) && actualLookupRows <= count, 'La consulta exacta no debe recorrer filas de otros tenants');
    } finally { catalogQueryRecording = true; }
  });
  await check('SQL de todos los servicios sólo lee tablas y columnas permitidas', async () => {
    assert.ok(sql.length > 0);
    for (const query of sql) {
      assert.match(query.trim(), /^SELECT\b/i);
      assert.doesNotMatch(query, /\b(?:cost|price|stock|balance|creditLimit|phone|email|AuditLog|Purchase|Sale)\b/i);
      assert.doesNotMatch(query, /\bFOR\s+UPDATE\b/i);
      for (const match of query.matchAll(/\b(?:FROM|JOIN)\s+(?:`[^`]+`\.)?`?([A-Za-z_]\w*)`?/gi))
        assert.ok(['User', 'AssistantTenantConfig', 'Product', 'Supplier', 'AssistantCatalogAlias'].includes(match[1]));
    }
  });
} catch (error) {
  results.push({ name: 'fixture aislado y permisos SELECT', status: 'FAILED', error: error instanceof Error ? error.message : String(error) });
} finally {
  await db.$disconnect();
}
const failed = results.filter(result => result.status === 'FAILED').length;
process.stdout.write(JSON.stringify({ status: failed ? 'FAILED' : 'PASSED', total: results.length, passed: results.length - failed, failed, selectOnlyCredential, serviceSqlStatements: sql.length, performanceDiagnostic, results }) + '\n');
process.exitCode = failed ? 1 : 0;
