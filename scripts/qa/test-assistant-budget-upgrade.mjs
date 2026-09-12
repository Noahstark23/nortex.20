#!/usr/bin/env node
// QA MySQL 8 descartable: no recibe URLs, credenciales ni bases externas.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE_COMMIT = 'ead043c2aa27e25e6522e97b3cdc2c3a4e585783';
const MIGRATION_PATHS = [
  'backend/prisma/migrations/20260909010000_assistant_budget_approval/migration.sql',
  'backend/prisma/migrations/20260909020000_weekly_cash_review_index/migration.sql',
  'backend/prisma/migrations/20260912010000_cash_close_investigation_index/migration.sql',
  'backend/prisma/migrations/20260912020000_assistant_budget_owner_authority/migration.sql',
];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = join(repo, 'reports/assistant-budget-upgrade', stamp);
const work = mkdtempSync(join(tmpdir(), 'nortex-budget-upgrade-'));
const name = `nortex-budget-upgrade-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { CI: 'true', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' });
const hash = s => createHash('sha256').update(s).digest('hex');
let attemptedContainer = false;
let port;
let stage = 'prerequisites';
const result = { status: 'RUNNING', startedUtc: new Date().toISOString(), syntheticOnly: true, aiCalls: 0, aiCostUsd: 0, scenarios: [], resourceLimits: { memoryMiB: 512, cpus: 0.5 }, cleanup: false };
mkdirSync(evidence, { recursive: true });
function command(bin, args, { input, allowFailure = false, childEnv = env, cwd = work, timeout = 180000 } = {}) {
  const r = spawnSync(bin, args, { cwd, env: childEnv, input, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  if ((r.error || r.status !== 0) && !allowFailure) {
    // Nunca copiar stdout/stderr ni argumentos: Prisma puede incluir la conexión.
    throw new Error(`${stage}: ${bin} failed (${r.error?.code ?? r.status})`);
  }
  return r;
}
const docker = (args, options) => command('docker', args, options);
function sql(db, input, allowFailure = false) {
  assert.match(db, /^budget_(legacy|column|table|mirror|authority)_test$/);
  return docker(['exec', '-i', name, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --raw --skip-column-names "$1"', 'qa', db], { input, allowFailure });
}
function rows(db, query) { return sql(db, query).stdout.trim().split('\n').filter(Boolean); }
function push(db, file) {
  const url = `mysql://root:${password}@127.0.0.1:${port}/${db}`;
  command('npx', ['--no-install', '--prefix', repo, 'prisma', 'db', 'push', '--skip-generate', '--schema', file], { childEnv: { ...env, DATABASE_URL: url }, timeout: 240000 });
}
function preflight(db) {
  command(process.execPath, ['--import', join(repo, 'node_modules/tsx/dist/loader.mjs'), join(repo, 'scripts/run-deploy-schema-preflight.ts')], {
    childEnv: { ...env, DATABASE_URL: `mysql://root:${password}@127.0.0.1:${port}/${db}` }, timeout: 180000,
  });
}
function fingerprint(db) {
  const columns = rows(db, "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA,COALESCE(COLLATION_NAME,'') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;");
  const indices = rows(db, "SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,COALESCE(SUB_PART,0),INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;");
  const fks = rows(db, "SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION;");
  return { columns, indices, fks };
}
const quote = x => '`' + x.replaceAll('`', '``') + '`';
function snapshot(db, legacyColumns) {
  return Object.fromEntries(Object.entries(legacyColumns).map(([table, columns]) => [table, rows(db, `SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY 1;`)]));
}
function expectSqlError(db, text, number) {
  const r = sql(db, text, true);
  assert.equal(r.status, 1, 'SQL negativo debe rechazarse');
  assert.match(r.stderr, new RegExp(`ERROR ${number} `));
}
const seed = `
INSERT INTO Tenant(id,businessName,taxId) VALUES ('qa-a','Synthetic A','qa-tax-a'),('qa-b','Synthetic B','qa-tax-b'),('qa-fk','Synthetic FK','qa-tax-fk');
INSERT INTO User(id,tenantId,password,name,role) VALUES ('qa-admin-granted','qa-a','synthetic-not-a-login','Synthetic prior grant','ADMIN'),('qa-admin-legacy','qa-a','synthetic-not-a-login','Synthetic HR owner','ADMIN'),('qa-user','qa-a','synthetic-not-a-login','Synthetic owner','OWNER');
INSERT INTO Employee(id,tenantId,userId,firstName,lastName,role,baseSalary) VALUES ('qa-employee-owner','qa-a','qa-admin-legacy','Synthetic','HR owner','OWNER',0);
INSERT INTO AssistantTenantConfig(tenantId,enabled,monthlyBudgetUsd) VALUES ('qa-a',1,10),('qa-b',0,10);
INSERT INTO AssistantBudget(id,scope,month,limitUsd,reservedUsd,spentUsd,blocked,updatedAt) VALUES ('qa-global','GLOBAL','2026-09',20,0.800001,1.250002,0,'2026-09-01'),('qa-budget','TENANT:qa-a','2026-09',10,0.800001,1.250002,1,'2026-09-01');
INSERT INTO AssistantUsage(id,tenantId,userId,month,reservedUsd,actualUsd,status,runId,updatedAt) VALUES ('qa-unknown','qa-a','qa-user','2026-09',0.600001,NULL,'UNKNOWN','qa-run-unknown','2026-09-01'),('qa-reserved','qa-a','qa-user','2026-09',0.2,NULL,'RESERVED','qa-run-reserved','2026-09-01'),('qa-settled','qa-a','qa-user','2026-09',1.3,1.250002,'SETTLED','qa-run-settled','2026-09-01');
`;
const request = (id, tenant = 'qa-a', key = 'qa-key') => `INSERT INTO AssistantBudgetRequest(id,tenantId,requestedBy,requestKey,requestedUsd,reason) VALUES ('${id}','${tenant}','qa-user','${key}',5.123456,'Solicitud sintética');`;
try {
  assert.equal(process.version, 'v22.23.2', 'Usar mise exec -- node');
  const context = docker(['context', 'show']).stdout.trim();
  const endpoint = docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']).stdout.trim();
  assert.ok(endpoint.startsWith('unix://'), 'Solo Docker local por socket Unix');
  assert.equal(docker(['info', '--format', '{{.OSType}}']).stdout.trim(), 'linux');
  result.mysqlImageId = docker(['image', 'inspect', 'mysql:8.0', '--format', '{{.Id}}']).stdout.trim();
  assert.equal(JSON.parse(readFileSync(join(repo, 'node_modules/prisma/package.json'), 'utf8')).version, '6.4.1');
  result.baseCommit = BASELINE_COMMIT;
  result.headCommit = command('git', ['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
  const old = command('git', ['show', `${BASELINE_COMMIT}:backend/prisma/schema.prisma`], { cwd: repo }).stdout;
  assert.ok(!old.includes('approvedMonthlyBudgetUsd') && !old.includes('model AssistantBudgetRequest ') && !old.includes('assistantBudgetOwner'), 'El baseline fijo debe ser anterior a presupuesto y autoridad');
  const current = readFileSync(join(repo, 'backend/prisma/schema.prisma'), 'utf8');
  const migrations = MIGRATION_PATHS.map(path => ({ path, sql: readFileSync(join(repo, path), 'utf8') }));
  const migration = migrations[0].sql, authoritySql = migrations[3].sql;
  const mirrorSql = migrations.map(entry => entry.sql).join('\n');
  const split = migration.indexOf('CREATE TABLE `AssistantBudgetRequest`');
  assert.ok(split > 0);
  const columnSql = migration.slice(0, split), tableSql = migration.slice(split);
  assert.match(columnSql, /^ALTER TABLE `AssistantTenantConfig` ADD COLUMN `approvedMonthlyBudgetUsd` DECIMAL\(18,6\) NOT NULL DEFAULT 2;/);
  assert.match(authoritySql, /ALTER TABLE `User` ADD COLUMN `assistantBudgetOwner` BOOLEAN NOT NULL DEFAULT false;/);
  result.oldSchemaSha256 = hash(old); result.schemaSha256 = hash(current); result.migrationSha256 = hash(migration);
  result.migrations = migrations.map(({ path, sql }) => ({ path, sha256: hash(sql) }));
  result.mirrorSqlSha256 = hash(mirrorSql);
  result.scriptSha256 = hash(readFileSync(fileURLToPath(import.meta.url)));
  const oldFile = join(work, 'old.prisma'), newFile = join(work, 'new.prisma');
  writeFileSync(oldFile, old); writeFileSync(newFile, current);
  const cred = join(work, 'synthetic-mysql-config');
  writeFileSync(cred, `MYSQL_ROOT_PASSWORD=${password}\nMYSQL_ROOT_HOST=%\n`, { mode: 0o600 });
  stage = 'start_disposable_mysql'; attemptedContainer = true;
  docker(['run', '-d', '--name', name, '--label', `nortex.qa.assistant-budget=${name}`, '--memory=512m', '--cpus=0.5', '--env-file', cred, '-p', '127.0.0.1::3306', 'mysql:8.0', '--innodb-buffer-pool-size=64M', '--max-connections=30', '--performance-schema=OFF']);
  const binding = docker(['port', name, '3306/tcp']).stdout.trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/); port = Number(binding.split(':').at(-1));
  let ready = false;
  for (let n = 0; n < 120; n++) {
    if (docker(['exec', name, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 -P3306 -uroot -Nse "SELECT 1"'], { allowFailure: true }).status === 0) { ready = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(ready, 'MySQL local no inició');
  result.mysqlVersion = docker(['exec', name, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -Nse "SELECT VERSION()"']).stdout.trim();
  assert.match(result.mysqlVersion, /^8\./);
  let canonicalFingerprint;
  for (const scenario of ['legacy', 'column', 'table', 'mirror', 'authority']) {
    const db = `budget_${scenario}_test`; stage = scenario;
    console.log(`QA presupuesto: ${scenario}`);
    docker(['exec', '-i', name, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'], { input: `CREATE DATABASE ${quote(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` });
    push(db, oldFile); sql(db, seed);
    const legacyColumns = {};
    for (const line of rows(db, "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;")) {
      const [t,c] = line.split('\t'); (legacyColumns[t] ??= []).push(c);
    }
    const before = snapshot(db, legacyColumns);
    if (scenario === 'column') { sql(db, columnSql); sql(db, "UPDATE AssistantTenantConfig SET approvedMonthlyBudgetUsd=7.123456 WHERE tenantId='qa-a';"); }
    if (scenario === 'table') { sql(db, tableSql); sql(db, request('qa-request')); }
    if (scenario === 'mirror') sql(db, mirrorSql);
    if (scenario === 'authority') {
      sql(db, authoritySql);
      sql(db, "UPDATE User SET assistantBudgetOwner=true WHERE id='qa-admin-granted';");
    }
    const partialRequest = scenario === 'table' ? rows(db, 'SELECT * FROM AssistantBudgetRequest ORDER BY id;') : null;
    const partialAuthority = scenario === 'authority' ? rows(db, 'SELECT id,assistantBudgetOwner FROM User ORDER BY id;') : null;
    const mirrorBeforePush = scenario === 'mirror' ? fingerprint(db) : null;
    preflight(db); push(db, newFile);
    assert.deepEqual(snapshot(db, legacyColumns), before, 'Cada fila y columna legacy debe conservarse');
    assert.deepEqual(rows(db, 'SELECT tenantId,monthlyBudgetUsd,approvedMonthlyBudgetUsd FROM AssistantTenantConfig ORDER BY tenantId;'), [`qa-a\t10.000000\t${scenario === 'column' ? '7.123456' : '2.000000'}`, 'qa-b\t10.000000\t2.000000']);
    if (partialRequest) assert.deepEqual(rows(db, 'SELECT * FROM AssistantBudgetRequest ORDER BY id;'), partialRequest);
    const authorityAfter = rows(db, 'SELECT id,assistantBudgetOwner FROM User ORDER BY id;');
    assert.deepEqual(authorityAfter, [`qa-admin-granted\t${scenario === 'authority' ? '1' : '0'}`, 'qa-admin-legacy\t0', 'qa-user\t0'], 'La expansión no infiere autoridad desde User.role ni Employee.role');
    if (partialAuthority) assert.deepEqual(authorityAfter, partialAuthority, 'La autoridad explícita preexistente debe conservarse');
    assert.deepEqual(rows(db, "SELECT u.role,e.role,u.assistantBudgetOwner FROM User u JOIN Employee e ON e.userId=u.id AND e.tenantId=u.tenantId WHERE u.id='qa-admin-legacy';"), ['ADMIN\tOWNER\t0'], 'El vínculo legacy de RRHH no autoriza presupuesto');
    const after = fingerprint(db);
    if (mirrorBeforePush) assert.deepEqual(after, mirrorBeforePush, 'SQL espejo no debe requerir DDL correctivo');
    if (canonicalFingerprint) assert.deepEqual(after, canonicalFingerprint, 'Todos los caminos convergen al mismo DDL');
    else canonicalFingerprint = after;
    if (scenario !== 'table') sql(db, request('qa-request'));
    assert.deepEqual(rows(db, "SELECT requestedUsd,status,decidedBy,decisionReason,decidedAt FROM AssistantBudgetRequest WHERE id='qa-request';"), ['5.123456\tPENDING\tNULL\tNULL\tNULL']);
    expectSqlError(db, request('qa-duplicate'), 1062);
    expectSqlError(db, request('qa-orphan', 'missing-tenant'), 1452);
    sql(db, request('qa-other-tenant', 'qa-b'));
    sql(db, request('qa-delete-restricted', 'qa-fk'));
    expectSqlError(db, "DELETE FROM Tenant WHERE id='qa-fk';", 1451);
    sql(db, "INSERT INTO Tenant(id,businessName,taxId) VALUES ('qa-new','Synthetic new','qa-tax-new'); INSERT INTO AssistantTenantConfig(tenantId) VALUES ('qa-new');");
    assert.deepEqual(rows(db, "SELECT monthlyBudgetUsd,approvedMonthlyBudgetUsd,enabled FROM AssistantTenantConfig WHERE tenantId='qa-new';"), ['10.000000\t2.000000\t0']);
    sql(db, "INSERT INTO User(id,tenantId,password,name,role) VALUES ('qa-new-user','qa-new','synthetic-not-a-login','Synthetic new admin','ADMIN');");
    assert.deepEqual(rows(db, "SELECT assistantBudgetOwner FROM User WHERE id='qa-new-user';"), ['0'], 'Un usuario nuevo tampoco recibe autoridad por default');
    const requestsBeforeReplay = rows(db, 'SELECT * FROM AssistantBudgetRequest ORDER BY id;');
    const configBeforeReplay = rows(db, 'SELECT * FROM AssistantTenantConfig ORDER BY tenantId;');
    const usersBeforeReplay = rows(db, 'SELECT * FROM User ORDER BY id;');
    preflight(db); push(db, newFile);
    assert.deepEqual(fingerprint(db), after, 'DDL idempotente');
    assert.deepEqual(rows(db, 'SELECT * FROM AssistantBudgetRequest ORDER BY id;'), requestsBeforeReplay);
    assert.deepEqual(rows(db, 'SELECT * FROM AssistantTenantConfig ORDER BY tenantId;'), configBeforeReplay);
    assert.deepEqual(rows(db, 'SELECT * FROM User ORDER BY id;'), usersBeforeReplay, 'La reejecución conserva usuarios y autoridad sin backfill');
    for (const t of ['AssistantBudget', 'AssistantUsage']) assert.deepEqual(rows(db, `SELECT ${legacyColumns[t].map(quote).join(',')} FROM ${quote(t)} ORDER BY 1;`), before[t]);
    result.scenarios.push({ name: scenario, status: 'PASSED', legacyTablesCompared: Object.keys(legacyColumns).length, legacyConfigTenDollarsPreserved: true, approvedDefaultTwoDollars: true, reservedSpentAndUnknownPreserved: true, legacyAdminEmployeeOwnerNotGranted: true, newUserAuthorityDefaultFalse: true, partialExplicitAuthorityPreserved: scenario === 'authority', exactSchemaIndexesForeignKeys: true, uniqueAndForeignKeyRejections: true, repeatPreflightAndDbPush: true, sqlMirrorNeedsNoCorrection: scenario === 'mirror' });
  }
  assert.equal(hash(readFileSync(join(repo, 'backend/prisma/schema.prisma'))), result.schemaSha256, 'Schema cambió durante el ensayo: repetir');
  for (const { path, sha256 } of result.migrations) assert.equal(hash(readFileSync(join(repo, path))), sha256, 'SQL espejo cambió durante el ensayo: repetir');
  result.status = 'PASSED';
} catch (e) {
  result.status = 'FAILED'; result.failedStage = stage;
  // Las aserciones comparan exclusivamente metadatos y fixtures sintéticos.
  result.failure = String(e.message).replaceAll(password, '[REDACTED]').slice(0, 3000);
  process.exitCode = 1;
} finally {
  if (attemptedContainer) {
    const removed = docker(['rm', '-f', '-v', name], { allowFailure: true });
    const absent = docker(['ps', '-aq', '--filter', `name=^/${name}$`], { allowFailure: true });
    result.cleanup = removed.status === 0 && absent.status === 0 && !absent.stdout.trim();
  } else result.cleanup = true;
  rmSync(work, { recursive: true, force: true });
  if (!result.cleanup) { result.status = 'FAILED'; result.cleanupFailure = true; process.exitCode = 1; }
  result.completedUtc = new Date().toISOString();
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, scenarios: result.scenarios.length, cleanup: result.cleanup, evidence: join(evidence, 'summary.json'), aiCalls: 0 }));
}
