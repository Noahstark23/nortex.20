import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ownerLabel = 'io.nortex.qa.catalog-identity-owner';
const isolatedEnvironment = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
export function assertCatalogMysqlTarget(connection, marker) {
  if (!/^[a-f0-9]{32}$/.test(marker ?? '')) throw new Error('CATALOG_QA_MARKER_REQUIRED');
  const url = new URL(connection);
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !/^\d+$/.test(url.port)
      || Number(url.port) < 1024 || Number(url.port) > 65535 || url.pathname !== '/nortex_catalog_identity_qa'
      || url.username !== 'catalog_reader' || !/^[a-f0-9]{48}$/.test(url.password)) throw new Error('CATALOG_QA_TARGET_REQUIRED');
  return url;
}
async function execute(command, args, { env = isolatedEnvironment(), input, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

/** Sólo cinco tablas sintéticas; deliberadamente no existen columnas de costos, precios o stock. */
function fixtureSql(marker, readerPassword) {
  return `
CREATE TABLE User (id VARCHAR(191) PRIMARY KEY, tenantId VARCHAR(191) NOT NULL, role VARCHAR(32) NOT NULL, status VARCHAR(32) NOT NULL);
CREATE TABLE AssistantTenantConfig (tenantId VARCHAR(191) PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT TRUE,
 extractionEnabled BOOLEAN NOT NULL DEFAULT FALSE, executionEnabled BOOLEAN NOT NULL DEFAULT FALSE,
 operationsEnabled BOOLEAN NOT NULL DEFAULT FALSE, actionsEnabled BOOLEAN NOT NULL DEFAULT FALSE,
 promotionsEnabled BOOLEAN NOT NULL DEFAULT FALSE, privateWhatsappEnabled BOOLEAN NOT NULL DEFAULT FALSE,
 monthlyBudgetUsd DECIMAL(18,6) NOT NULL DEFAULT 0);
CREATE TABLE Product (id VARCHAR(191) PRIMARY KEY, tenantId VARCHAR(191) NOT NULL, name VARCHAR(191) NOT NULL,
 sku VARCHAR(191) NOT NULL, brand VARCHAR(100), unit VARCHAR(191) NOT NULL, saleMode VARCHAR(191), quantityStep DECIMAL(18,4),
 packUnit VARCHAR(191), packSize DOUBLE, requiresBatchTracking BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE KEY tenant_sku(tenantId,sku), KEY Product_tenantId_name_idx(tenantId,name));
CREATE TABLE Supplier (id VARCHAR(191) PRIMARY KEY, tenantId VARCHAR(191) NOT NULL, name VARCHAR(191) NOT NULL,
 ruc VARCHAR(191), address TEXT, status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', deletedAt DATETIME(3), KEY Supplier_tenantId_status_name_idx(tenantId,status,name));
CREATE TABLE AssistantCatalogAlias (id VARCHAR(191) PRIMARY KEY, tenantId VARCHAR(191) NOT NULL, productId VARCHAR(191) NOT NULL,
 normalizedAlias VARCHAR(100) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE KEY tenant_alias_product(tenantId,normalizedAlias,productId));
INSERT INTO User VALUES ('fixture-marker','${marker}','QA_MARKER','ACTIVE'),
 ('owner-a','tenant-a','OWNER','ACTIVE'),('bodega-a','tenant-a','BODEGUERO','ACTIVE'),
 ('owner-b','tenant-b','OWNER','ACTIVE'),('inactive-a','tenant-a','OWNER','DISABLED');
INSERT INTO AssistantTenantConfig (tenantId) VALUES ('tenant-a'),('tenant-b');
INSERT INTO Product (id,tenantId,name,sku,brand,unit,saleMode,quantityStep,packUnit,packSize,requiresBatchTracking) VALUES
 ('cement-a','tenant-a','Cemento','CEM-A','Marca A','bolsa','COUNTED',1,'fardo',12,FALSE),
 ('cement-b','tenant-a','Cemento','CEM-B','Marca B','bolsa','COUNTED',1,NULL,NULL,FALSE),
 ('sparse-a','tenant-a','Bolsa 50 kg','BOLSA-A',NULL,'unidad',NULL,NULL,NULL,NULL,FALSE),
 ('batch-a','tenant-a','Producto de lote','LOTE-A',NULL,'kg','MEASURED',0.25,NULL,NULL,TRUE),
 ('foreign-product','tenant-b','Cemento','CEM-B','Marca privada','bolsa',NULL,NULL,NULL,NULL,FALSE);
INSERT INTO Supplier (id,tenantId,name,ruc,address,status,deletedAt) VALUES
 ('central-a','tenant-a','Distribuidora Central','RUC-A','Managua','ACTIVE',NULL),
 ('central-b','tenant-a','Distribuidora Central','RUC-B','Masaya','ACTIVE',NULL),
 ('inactive-supplier','tenant-a','Distribuidora Central','RUC-OFF','Oculta','SUSPENDED',NULL),
 ('deleted-supplier','tenant-a','Distribuidora Central','RUC-DEL','Oculta','ACTIVE','2026-09-19'),
 ('foreign-supplier','tenant-b','Distribuidora Central','RUC-PRIVATE','Otra dirección','ACTIVE',NULL),
 ('duplicate-a','tenant-a','Duplicado',NULL,NULL,'ACTIVE',NULL),
 ('duplicate-b','tenant-a','Duplicado',NULL,NULL,'ACTIVE',NULL),
 ('spaces-a','tenant-a','Casa  Central','RUC-SAME','León','ACTIVE',NULL),
 ('spaces-b','tenant-a','Casa Central','RUC-SAME','León','ACTIVE',NULL),
 ('separator-a','tenant-a','Separador','123 · Dirección Managua',NULL,'ACTIVE',NULL),
 ('separator-b','tenant-a','Separador','123','Managua','ACTIVE',NULL),
 ('long-address','tenant-a','Dirección extensa',NULL,REPEAT('x',2001),'ACTIVE',NULL);
INSERT INTO AssistantCatalogAlias VALUES ('alias-a','tenant-a','cement-b','favorito sintético',TRUE),
 ('alias-off','tenant-a','cement-a','alias retirado',FALSE),
 ('alias-foreign','tenant-b','foreign-product','favorito sintetico',TRUE);
${Array.from({ length: 25 }, (_, index) => `INSERT INTO Product (id,tenantId,name,sku,unit) VALUES ('list-${String(index).padStart(2, '0')}','tenant-a','Listado ${String(index).padStart(2, '0')}','LIST-${index}','unidad');`).join('\n')}
${Array.from({ length: 21 }, (_, index) => `INSERT INTO Product (id,tenantId,name,sku,unit) VALUES ('prefix-product-${index}','tenant-a','Clavo modelo ${index}','CLAVO-${index}','unidad');`).join('\n')}
${Array.from({ length: 21 }, (_, index) => `INSERT INTO Product (id,tenantId,name,sku,unit) VALUES ('same-name-product-${index}','tenant-a','Perno','PERNO-${index}','unidad');`).join('\n')}
${Array.from({ length: 21 }, (_, index) => `INSERT INTO Supplier (id,tenantId,name,ruc,address) VALUES ('prefix-supplier-${index}','tenant-a','Distribuidora Regional ${index}','REGIONAL-${index}','Dirección ${index}');`).join('\n')}
${Array.from({ length: 21 }, (_, index) => `INSERT INTO Supplier (id,tenantId,name,ruc,address) VALUES ('many-${String(index).padStart(2, '0')}','tenant-a','Muchos homónimos','RUC-${index}','Dirección ${index}');`).join('\n')}
${Array.from({ length: 21 }, (_, index) => `INSERT INTO Supplier (id,tenantId,name,ruc,address) VALUES ('address-supplier-${index}','tenant-a','Sucursal','RUC-COMPARTIDO','Dirección ${index}');`).join('\n')}
CREATE USER 'catalog_reader'@'%' IDENTIFIED BY '${readerPassword}';
GRANT SELECT ON nortex_catalog_identity_qa.* TO 'catalog_reader'@'%';
`;
}

export async function main() {
  const owner = randomUUID(), marker = randomBytes(16).toString('hex');
  const rootPassword = randomBytes(24).toString('hex'), readerPassword = randomBytes(24).toString('hex');
  const directory = path.resolve(root, '../../release-evidence/catalog-20260919/mysql');
  const startedAt = new Date().toISOString();
  const report = { scope: 'H01-1-catalog-identity-select-only', startedAt, status: 'FAILED', cleanup: false };
  let container;
  const clean = value => String(value).replaceAll(rootPassword, '[redacted]').replaceAll(readerPassword, '[redacted]').replaceAll(marker, '[fixture-marker]');
  const must = async (...args) => { const result = await execute(...args); if (result.code !== 0) throw new Error(clean(result.stderr || result.stdout || 'COMMAND_FAILED')); return result; };
  try {
    if (process.version !== 'v22.23.2') throw new Error('NODE_22_23_2_REQUIRED');
    const packageJson = JSON.parse(await readFile(path.join(root, 'node_modules/@prisma/client/package.json'), 'utf8'));
    if (packageJson.version !== '6.4.1') throw new Error('PRISMA_6_4_1_REQUIRED');
    const started = await must('docker', ['run', '--detach', '--pull', 'never', '--name', `nortex-catalog-qa-${owner}`,
      '--label', `${ownerLabel}=${owner}`, '--publish', '127.0.0.1::3306', '--tmpfs', '/var/lib/mysql:rw',
      '--env', `MYSQL_ROOT_PASSWORD=${rootPassword}`, '--env', 'MYSQL_DATABASE=nortex_catalog_identity_qa',
      'mysql:8.0', '--innodb-buffer-pool-size=64M']);
    container = started.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('OWNED_CONTAINER_REQUIRED');
    const mysqlArgs = ['exec', '-i', '--env', `MYSQL_PWD=${rootPassword}`, container, 'mysql', '--protocol=TCP',
      '--host=127.0.0.1', '--user=root', '--batch', '--skip-column-names', '--default-character-set=utf8mb4', 'nortex_catalog_identity_qa'];
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      const ping = await execute('docker', mysqlArgs, { input: 'SELECT 1;', timeout: 5000 });
      if (ping.code === 0 && ping.stdout.trim() === '1') { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('DISPOSABLE_MYSQL_STARTUP_TIMEOUT');
    const ports = JSON.parse((await must('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container])).stdout);
    if (ports['3306/tcp']?.length !== 1 || ports['3306/tcp'][0].HostIp !== '127.0.0.1') throw new Error('LOOPBACK_REQUIRED');
    const connection = `mysql://catalog_reader:${readerPassword}@127.0.0.1:${ports['3306/tcp'][0].HostPort}/nortex_catalog_identity_qa?connection_limit=2`;
    assertCatalogMysqlTarget(connection, marker);
    await must('docker', mysqlArgs, { input: fixtureSql(marker, readerPassword) });
    for (const [tenant, prefix] of [['tenant-a', 'volume'], ['tenant-b', 'foreign-volume']]) {
      const initialProductCount = Number((await must('docker', mysqlArgs, { input: `SELECT COUNT(*) FROM Product WHERE tenantId='${tenant}';` })).stdout.trim());
      if (!Number.isInteger(initialProductCount) || initialProductCount < 1 || initialProductCount > 10_000) throw new Error('UNEXPECTED_SYNTHETIC_CATALOG_SIZE');
      for (let start = initialProductCount; start < 10_000; start += 500) {
        const rows = Array.from({ length: Math.min(500, 10_000 - start) }, (_, offset) => {
          const index = String(start + offset).padStart(5, '0');
          return `('${prefix}-${index}','${tenant}','Artículo sintético ${index}','VOLUME-${index}','Marca sintética','unidad')`;
        });
        await must('docker', mysqlArgs, { input: `INSERT INTO Product (id,tenantId,name,sku,brand,unit) VALUES ${rows.join(',')};` });
      }
    }
    await must('docker', mysqlArgs, { input: 'ANALYZE TABLE Product;' });
    report.syntheticProductCount = 20_000;
    report.syntheticProductCountsByTenant = { 'tenant-a': 10_000, 'tenant-b': 10_000 };
    report.fixtureStatisticsAnalyzed = true;
    report.mysqlVersion = (await must('docker', mysqlArgs, { input: 'SELECT VERSION();' })).stdout.trim();
    if (!report.mysqlVersion.startsWith('8.0.')) throw new Error('MYSQL_8_0_REQUIRED');
    const sources = ['backend/services/assistant/catalogIdentity.ts', 'backend/services/assistant/operations/catalogSearch.ts',
      'backend/services/assistant/operations/catalogOptions.ts', 'backend/services/assistant/access.ts',
      'shared/assistantCatalog.ts', 'scripts/qa/catalog-identity-mysql.mjs', 'tests/fixtures/assistant/catalogIdentity.mysql.ts'];
    const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async source => [source, createHash('sha256').update(await readFile(path.join(root, source))).digest('hex')])));
    report.sourceHashes = await hashes();
    const result = await execute(process.execPath, ['--import', 'tsx', 'tests/fixtures/assistant/catalogIdentity.mysql.ts'], {
      env: { ...isolatedEnvironment(), NODE_ENV: 'test', DATABASE_URL: connection, NORTEX_CATALOG_MYSQL_MARKER: marker, NORTEX_ASSISTANT_ENABLED: 'true' },
    });
    if (!result.stdout.trim()) throw new Error(clean(result.stderr || 'FIXTURE_NO_REPORT'));
    const output = JSON.parse(result.stdout.trim());
    Object.assign(report, output);
    if (JSON.stringify(await hashes()) !== JSON.stringify(report.sourceHashes)) throw new Error('SOURCES_CHANGED_DURING_QA');
    if (result.code !== 0 || output.status !== 'PASSED') throw new Error('CATALOG_MYSQL_SCENARIOS_FAILED');
  } catch (error) { report.status = 'FAILED'; report.error = clean(error instanceof Error ? error.message : error); }
  finally {
    if (container) {
      try {
        const label = (await must('docker', ['inspect', '--format', `{{index .Config.Labels "${ownerLabel}"}}`, container])).stdout.trim();
        if (label !== owner) throw new Error('OWNERSHIP_MISMATCH_NO_CLEANUP');
        await must('docker', ['rm', '--force', '--volumes', container]);
        if ((await must('docker', ['ps', '--all', '--filter', `id=${container}`, '--format', '{{.ID}}'])).stdout.trim()) throw new Error('CLEANUP_NOT_VERIFIED');
        report.cleanup = true;
      } catch (error) { report.status = 'FAILED'; report.cleanupError = clean(error.message); }
    }
    report.finishedAt = new Date().toISOString();
    await mkdir(directory, { recursive: true });
    const resultFile = path.join(directory, `${startedAt.replaceAll(':', '-')}.json`);
    await writeFile(resultFile, clean(JSON.stringify(report, null, 2)) + '\n');
    process.stdout.write(clean(JSON.stringify({ ...report, evidence: resultFile }, null, 2)) + '\n');
    process.exitCode = report.status === 'PASSED' && report.cleanup ? 0 : 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
