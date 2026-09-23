import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ownerLabel = 'io.nortex.qa.knowledge-owner';
export function isolatedEnvironment(source = process.env) {
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(k => source[k]).map(k => [k, source[k]]));
}
export function assertKnowledgeMysqlTarget(connection, marker) {
  if (!/^[a-f0-9]{32}$/.test(marker ?? '')) throw new Error('KNOWLEDGE_QA_MARKER_REQUIRED');
  const url = new URL(connection);
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !/^\d+$/.test(url.port)
      || Number(url.port) < 1024 || Number(url.port) > 65535 || url.pathname !== '/nortex_knowledge_qa'
      || url.username !== 'root' || !/^[a-f0-9]{48}$/.test(url.password)) throw new Error('KNOWLEDGE_QA_TARGET_REQUIRED');
  return url;
}
async function execute(command, args, { env, input, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: env ?? isolatedEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}
export async function main() {
  const owner = randomUUID(), marker = randomBytes(16).toString('hex'), password = randomBytes(24).toString('hex');
  const name = `nortex-editorial-qa-${owner}`;
  const directory = path.join(root, 'docs/evidence/nortexgpt/editorial-20260919/mysqlworker');
  const startedAt = new Date().toISOString();
  const report = { scope: 'official-help-editorial-notes-and-lifecycle-only', startedAt, status: 'FAILED', cleanup: false };
  let container;
  const cleanText = text => String(text).replaceAll(password, '[synthetic-password-redacted]').replaceAll(marker, '[fixture-marker]');
  const must = async (...args) => { const result = await execute(...args); if (result.code !== 0) throw new Error(cleanText(result.stderr || result.stdout || 'COMMAND_FAILED')); return result; };
  try {
    const run = await must('docker', ['run', '--detach', '--name', name, '--label', `${ownerLabel}=${owner}`,
      '--publish', '127.0.0.1::3306', '--tmpfs', '/var/lib/mysql:rw',
      '--env', `MYSQL_ROOT_PASSWORD=${password}`, '--env', 'MYSQL_DATABASE=nortex_knowledge_qa',
      'mysql:8.0', '--innodb-buffer-pool-size=64M']);
    container = run.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('OWNED_CONTAINER_ID_MISSING');
    const mysqlArgs = ['exec', '-i', '--env', `MYSQL_PWD=${password}`, container, 'mysql', '--protocol=TCP', '--host=127.0.0.1', '--user=root', '--batch', '--skip-column-names', 'nortex_knowledge_qa'];
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const ping = await execute('docker', mysqlArgs, { input: 'SELECT 1;', timeout: 5000 });
      if (ping.code === 0 && ping.stdout.trim() === '1') { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('DISPOSABLE_MYSQL_STARTUP_TIMEOUT');
    const bindings = JSON.parse((await must('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container])).stdout);
    const mapping = bindings['3306/tcp'];
    if (mapping?.length !== 1 || mapping[0].HostIp !== '127.0.0.1') throw new Error('NON_LOOPBACK_CONTAINER');
    const connection = `mysql://root:${password}@127.0.0.1:${mapping[0].HostPort}/nortex_knowledge_qa?connection_limit=6`;
    assertKnowledgeMysqlTarget(connection, marker);
    const fixture = await readFile(path.join(root, 'tests/fixtures/assistant/knowledge/schema.sql'), 'utf8');
    const migrationPaths = ['backend/prisma/migrations/20260919010000_assistant_knowledge_publication/migration.sql',
      'backend/prisma/migrations/20260919020000_assistant_knowledge_editorial/migration.sql'];
    const migrations = await Promise.all(migrationPaths.map(async migrationPath => ({ path: migrationPath,
      sql: await readFile(path.join(root, migrationPath), 'utf8') })));
    await must('docker', mysqlArgs, { input: `${fixture}\nINSERT INTO KnowledgeQaFixture VALUES ('owned', '${marker}');\n${migrations.map(migration => migration.sql).join('\n')}` });
    report.mysqlVersion = (await must('docker', mysqlArgs, { input: 'SELECT VERSION();' })).stdout.trim();
    if (!report.mysqlVersion.startsWith('8.0.')) throw new Error('MYSQL_8_REQUIRED');
    report.migrations = migrations.map(migration => ({ path: migration.path, sha256: createHash('sha256').update(migration.sql).digest('hex') }));
    const sourcePaths = [...migrationPaths, 'backend/services/assistant/knowledge/lifecycle.ts', 'backend/services/assistant/knowledge/model.ts',
      'backend/services/assistant/knowledge/editorAccess.ts', 'backend/services/assistant/knowledge/editorNotes.ts',
      'backend/services/assistant/knowledge/editorial.ts', 'shared/assistantKnowledgeEditorial.ts',
      'backend/services/assistant/knowledge/store.ts', 'backend/services/assistant/knowledge.ts', 'backend/services/assistant/access.ts',
      'scripts/qa/knowledge-mysql.mjs', 'tests/fixtures/assistant/knowledge/schema.sql', 'tests/fixtures/assistant/knowledge/lifecycle.mysql.ts'];
    const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async source => [source,
      createHash('sha256').update(await readFile(path.join(root, source))).digest('hex')])));
    report.sourceHashes = await sourceHashes();
    const test = await execute('mise', ['exec', '--', 'node', '--import', 'tsx', 'tests/fixtures/assistant/knowledge/lifecycle.mysql.ts'], {
      env: { ...isolatedEnvironment(), NODE_ENV: 'test', DATABASE_URL: connection, NORTEX_KNOWLEDGE_MYSQL_MARKER: marker },
      timeout: 120_000,
    });
    const output = JSON.parse(test.stdout.trim());
    Object.assign(report, output);
    if (test.code !== 0 || output.status !== 'PASSED') throw new Error('EDITORIAL_MYSQL_SCENARIO_FAILED');
    if (JSON.stringify(await sourceHashes()) !== JSON.stringify(report.sourceHashes)) throw new Error('SOURCES_CHANGED_DURING_QA');
  } catch (error) {
    report.status = 'FAILED';
    report.error = cleanText(error instanceof Error ? error.message : error);
  } finally {
    if (container) {
      try {
        const found = (await must('docker', ['inspect', '--format', `{{index .Config.Labels "${ownerLabel}"}}`, container])).stdout.trim();
        if (found !== owner) throw new Error('OWNERSHIP_MISMATCH_NO_CLEANUP');
        await must('docker', ['rm', '--force', '--volumes', container]);
        const absent = await must('docker', ['ps', '--all', '--filter', `id=${container}`, '--format', '{{.ID}}']);
        if (absent.stdout.trim()) throw new Error('CLEANUP_NOT_VERIFIED');
        report.cleanup = true;
      } catch (error) { report.status = 'FAILED'; report.cleanupError = cleanText(error.message); }
    }
    report.finishedAt = new Date().toISOString();
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${startedAt.replaceAll(':', '-')}.json`), JSON.stringify(report, null, 2) + '\n');
    await writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.status === 'PASSED' && report.cleanup ? 0 : 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
