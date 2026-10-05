// Gate de recuperación de sólo lectura. No es un modo del entrypoint normal.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const quoted = (name) => '`' + name.replaceAll('`', '``') + '`';
// Fixed metadata queries: receipt data can never introduce executable SQL.
const schemaQueries = [
  "SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME",
  "SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA,COALESCE(COLLATION_NAME,'<NULL>') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION",
  "SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,COALESCE(SUB_PART,'<NULL>'),INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX",
  "SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,CASE WHEN UNIQUE_CONSTRAINT_SCHEMA=DATABASE() THEN '<SELF>' ELSE UNIQUE_CONSTRAINT_SCHEMA END,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME",
  "SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,ORDINAL_POSITION,COALESCE(CASE WHEN REFERENCED_TABLE_SCHEMA=DATABASE() THEN '<SELF>' ELSE REFERENCED_TABLE_SCHEMA END,'<NULL>'),COALESCE(REFERENCED_TABLE_NAME,'<NULL>'),COALESCE(REFERENCED_COLUMN_NAME,'<NULL>') FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION",
  "SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_ORDER,ACTION_ORIENTATION,ACTION_STATEMENT,SQL_MODE,DEFINER,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY EVENT_OBJECT_TABLE,TRIGGER_NAME",
  "SELECT tc.TABLE_NAME,tc.CONSTRAINT_NAME,tc.ENFORCED,COALESCE(cc.CHECK_CLAUSE,'<MISSING>') FROM information_schema.TABLE_CONSTRAINTS tc LEFT JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.CONSTRAINT_TYPE='CHECK' ORDER BY tc.TABLE_NAME,tc.CONSTRAINT_NAME"
];
const timeout = setTimeout(() => {
  console.error('ROLLBACK_GATE_TIMEOUT');
  process.exit(1);
}, 120_000);
let db;
try {
  const receipt = JSON.parse(readFileSync(new URL('../deploy/nortex/image-receipt.json', import.meta.url)));
  const profile = process.env.NORTEX_SCHEMA_PROFILE;
  if (!['staging', 'production'].includes(profile)) fail('ROLLBACK_PROFILE_REQUIRED');
  const contract = receipt.contracts[profile];
  if (!contract) fail('ROLLBACK_PROFILE_REQUIRED');
  Object.assign(receipt, contract);
  if (process.env.SOURCE_COMMIT !== receipt.previousCommit) fail('ROLLBACK_SOURCE_COMMIT_MISMATCH');
  const database = process.env.NORTEX_ROLLBACK_DATABASE;
  const uuid = process.env.NORTEX_ROLLBACK_MYSQL_UUID;
  if (receipt.version !== 1 || !/^[a-f0-9]{40}$/.test(receipt.previousCommit)
    || !/^[a-f0-9]{64}$/.test(receipt.schemaFingerprintSha256 ?? '')) fail('ROLLBACK_RECEIPT_INVALID');
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(database ?? '') || !/^[a-f0-9-]{36}$/.test(uuid ?? '')) fail('ROLLBACK_TARGET_REQUIRED');
  if (process.env.NORTEX_ROLLBACK_CONFIRMATION !== `PRESERVE_SCHEMA ${receipt.previousCommit} ${database}`) fail('ROLLBACK_CONFIRMATION_REQUIRED');
  const url = new URL(process.env.DATABASE_URL);
  if (url.protocol !== 'mysql:' || decodeURIComponent(url.pathname) !== `/${database}`) fail('ROLLBACK_TARGET_MISMATCH');
  if (JSON.parse(readFileSync('package.json')).scripts.start !== 'tsx backend/server.ts') fail('ROLLBACK_START_MISMATCH');
  for (const [file, sha] of Object.entries(receipt.files)) {
    if (hash(file) !== sha) fail('ROLLBACK_IMAGE_MISMATCH');
  }
  // Prisma copia el schema formateado; su hash difiere del archivo fuente.
  if (hash('node_modules/.prisma/client/schema.prisma') !== receipt.generatedSchemaSha256) fail('ROLLBACK_CLIENT_MISMATCH');
  const require = createRequire(resolve('package.json'));
  const { Prisma, PrismaClient } = require('@prisma/client');
  if (Prisma.prismaVersion.client !== receipt.prismaVersion) fail('ROLLBACK_CLIENT_VERSION_MISMATCH');
  db = new PrismaClient({ log: [] });
  const [identity] = await db.$queryRawUnsafe('SELECT DATABASE() AS db, @@server_uuid AS uuid');
  if (identity.db !== database || identity.uuid !== uuid) fail('ROLLBACK_TARGET_MISMATCH');
  // An empty TRIGGERS result proves absence only with full schema visibility.
  // Accept explicit existing SELECT/TRIGGER grants on this schema or *.* only.
  // Role-only or partially revoked grants are ambiguous here and fail closed.
  const grants = (await db.$queryRawUnsafe('SHOW GRANTS')).flatMap(Object.values);
  const hasDirectPrivilege = (privilege) => grants.some((grant) => {
    const match = typeof grant === 'string' && grant.match(/^GRANT (.+) ON (\*\.\*|`([^`]+)`\.\*) TO /);
    if (!match || (match[2] !== '*.*' && match[3].replaceAll('\\_', '_') !== database)) return false;
    const privileges = match[1].split(',').map((name) => name.trim());
    return privileges.includes(privilege) || privileges.includes('ALL PRIVILEGES');
  });
  if (grants.some((grant) => typeof grant === 'string' && grant.startsWith('REVOKE '))
    || !hasDirectPrivilege('SELECT') || !hasDirectPrivilege('TRIGGER')) fail('ROLLBACK_METADATA_VISIBILITY_REQUIRED');
  const tables = await db.$queryRawUnsafe('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ?', 'BASE TABLE');
  if (!receipt.expandedTables.every((name) => tables.some((row) => row.name === name))) fail('ROLLBACK_EXPANSION_MISSING');
  for (const index of receipt.expandedIndexes) {
    const rows = await db.$queryRawUnsafe('SELECT COLUMN_NAME AS col, NON_UNIQUE AS nonUnique, SUB_PART AS prefix, INDEX_TYPE AS type FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX', index.table, index.name);
    if (rows.length !== index.columns.length || rows.some((row, i) => row.col !== index.columns[i] || Number(row.nonUnique) !== index.nonUnique || row.prefix !== null || row.type !== 'BTREE')) fail('ROLLBACK_EXPANSION_MISSING');
  }
  // This hotfix accepts only the exact reviewed expanded schema metadata.
  // Read no business rows and run no schema synchronization.
  const metadata = [];
  for (const query of schemaQueries) {
    const rows = await db.$queryRawUnsafe(query);
    metadata.push(rows.map((row) => Object.values(row).map((value) => String(value))));
  }
  const schemaFingerprint = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  if (schemaFingerprint !== receipt.schemaFingerprintSha256) fail('ROLLBACK_SCHEMA_MISMATCH');
  // Reuse the immutable product preflight; every mutation is rejected before SQL.
  const { tsImport } = require('tsx/esm/api');
  const { applyDeploySchemaPreflight } = await tsImport(resolve('scripts/deploy-schema-preflight.ts'), import.meta.url);
  try {
    await applyDeploySchemaPreflight({
      query: (statement) => {
        if (!/^\s*SELECT\b/i.test(statement.sql ?? '')) fail('ROLLBACK_PREFLIGHT_DDL_FORBIDDEN');
        return db.$queryRaw(statement);
      },
      execute: () => fail('ROLLBACK_PREFLIGHT_DDL_FORBIDDEN'),
    }, { info: () => {}, warn: () => {} });
  } catch (error) {
    if (error.code === 'ROLLBACK_PREFLIGHT_DDL_FORBIDDEN') throw error;
    fail('ROLLBACK_PREFLIGHT_UNSAFE');
  }
  let models = 0;
  let columns = 0;
  for (const model of Prisma.dmmf.datamodel.models) {
    const scalars = model.fields.filter((field) => field.kind !== 'object');
    await db.$queryRawUnsafe(`SELECT ${scalars.map((field) => quoted(field.dbName ?? field.name)).join(',')} FROM ${quoted(model.dbName ?? model.name)} LIMIT 0`);
    await db[model.name[0].toLowerCase() + model.name.slice(1)].count();
    models += 1;
    columns += scalars.length;
  }
  if (models !== receipt.models || columns !== receipt.scalarColumns) fail('ROLLBACK_CLIENT_MISMATCH');
  console.log(JSON.stringify({ gate: 'PASS', mode: 'preserve-expanded-schema', previousCommit: receipt.previousCommit, models, scalarColumns: columns, ddlStatements: 0 }));
} catch (error) {
  // No imprimir mensajes de Prisma/URL: pueden contener identidad o datos privados.
  console.error(typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'ROLLBACK_GATE_FAILED');
  process.exitCode = 1;
} finally {
  if (db) await db.$disconnect();
  clearTimeout(timeout);
}
