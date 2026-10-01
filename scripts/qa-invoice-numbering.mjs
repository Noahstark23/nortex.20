import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExecutedSuite, validateQualityDatabase } from './quality-gate-contract.mjs';
import { verifyQualitySuiteRegistration } from './verify-quality-suite-registration.mjs';

// Launcher focal: nunca acepta DATABASE_URL ni reutiliza una DB/contenedor.
// No instala paquetes ni descarga imágenes. El gate integral continúa siendo obligatorio.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const output = path.join(root, 'reports/invoice-numbering');
await mkdir(output, { recursive: true });
const sha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Indicá el SHA completo del candidato como único argumento.');
const suite = 'tests/invoiceNumberingConcurrency.mysql.test.ts';
const id = randomBytes(8).toString('hex');
const container = `nortex-qa-fiscal-${process.pid}-${id}`;
const database = 'nortex_qa_fiscal';
const user = 'nortex_qa_fiscal';
const rootPassword = randomBytes(24).toString('hex');
const password = randomBytes(24).toString('hex');
const children = new Set();
const logs = new Map();
let started = false, server, complete = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const baseEnv = { PATH: process.env.PATH, NODE_ENV: 'test' };
const secrets = [rootPassword, password];
const scrub = text => secrets.reduce((value, secret) => value.replaceAll(secret, '[synthetic-secret]'), String(text))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[synthetic-jwt]');
function launch(command, args, env, name) {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child); logs.set(name, '');
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => logs.set(name, logs.get(name) + scrub(chunk)));
    child.once('exit', () => children.delete(child));
    return child;
}
async function exit(child) {
    if (child.exitCode !== null) return child.exitCode;
    return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
}
async function run(command, args, env, name) {
    const child = launch(command, args, env, name);
    const code = await exit(child);
    if (code !== 0) throw new Error(`${name}: salida ${code}; revisar el log sanitizado.`);
    return logs.get(name);
}
async function docker(args, name, extras = {}) { return run('docker', args, { ...baseEnv, ...extras }, name); }
async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM'); await Promise.race([exit(child), delay(3_000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit(child); }
}
async function freePort() {
    const socket = createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
const summary = { sourceSha: sha, startedAt: new Date().toISOString(), suite, passed: false,
    installedSoftware: false, existingDatabasesUsed: false, container, image: 'mysql:8.0',
    node: process.versions.node, tests: 0, cleanupConfirmed: false };
process.once('SIGTERM', () => { for (const child of children) child.kill('SIGTERM'); });
process.once('SIGINT', () => { for (const child of children) child.kill('SIGTERM'); });
try {
    if (process.versions.node !== '22.23.2') throw new Error('Requiere Node 22.23.2 ya instalado.');
    for (const name of ['prisma', 'vitest', 'tsx']) if (!existsSync(`node_modules/${name}/package.json`)) throw new Error(`Falta ${name} local; no se instala automáticamente.`);
    const contexts = JSON.parse(await docker(['context', 'inspect'], 'docker-context'));
    const endpoint = contexts[0]?.Endpoints?.docker?.Host;
    if (!endpoint?.startsWith('unix:///')) throw new Error('Docker debe usar un socket local unix; se rechaza daemon remoto.');
    summary.dockerEndpoint = endpoint;
    await docker(['info', '--format', '{{.ServerVersion}}'], 'docker-version');
    const image = (await docker(['image', 'inspect', '--format', '{{.Id}}', 'mysql:8.0'], 'mysql-image')).trim();
    summary.imageId = image;
    await verifyQualitySuiteRegistration(root);
    await docker(['run', '-d', '--rm', '--name', container, '--pull=never', '--tmpfs', '/var/lib/mysql',
        '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', '-e', 'MYSQL_DATABASE', '-e', 'MYSQL_USER', '-e', 'MYSQL_PASSWORD',
        'mysql:8.0', '--default-authentication-plugin=mysql_native_password', '--log-bin-trust-function-creators=1'],
        'mysql-start', { MYSQL_ROOT_PASSWORD: rootPassword, MYSQL_DATABASE: database, MYSQL_USER: user, MYSQL_PASSWORD: password });
    started = true;
    let ready = false, port;
    for (let attempt = 0; attempt < 60; attempt++) {
        const published = await docker(['port', container, '3306/tcp'], 'mysql-port');
        port = published.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
        if (!port) throw new Error('MySQL debe estar publicado exclusivamente en loopback.');
        try {
            await docker(['exec', '-e', 'MYSQL_PWD', container, 'mysql', '-h', '127.0.0.1', '-u', user, '-Nse', 'SELECT 1'], 'mysql-ready', { MYSQL_PWD: password });
            ready = true; break;
        } catch { await delay(500); }
    }
    if (!ready) throw new Error('MySQL efímero no quedó listo.');
    await docker(['exec', '-e', 'MYSQL_PWD', container, 'mysql', '-u', 'root', '-e',
        `GRANT SELECT ON performance_schema.data_lock_waits TO '${user}'@'%'; GRANT SELECT ON performance_schema.data_locks TO '${user}'@'%';`],
        'mysql-observe-locks', { MYSQL_PWD: rootPassword });
    const url = `mysql://${user}:${password}@127.0.0.1:${port}/${database}?connection_limit=12`;
    const env = { ...baseEnv, DATABASE_URL: url, NORTEX_QA_DATABASE_ACK: 'disposable-database' };
    validateQualityDatabase(url, env.NORTEX_QA_DATABASE_ACK);
    summary.databasePort = Number(port);
    summary.mysql = (await docker(['exec', '-e', 'MYSQL_PWD', container, 'mysql', '-u', user, '-Nse', 'SELECT VERSION()'], 'mysql-version', { MYSQL_PWD: password })).trim();
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema', 'backend/prisma/schema.prisma'], env, 'prisma-generate');
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'validate', '--schema', 'backend/prisma/schema.prisma'], env, 'prisma-validate');
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--schema', 'backend/prisma/schema.prisma', '--skip-generate'], env, 'prisma-empty-db-push');
    const jwt = randomBytes(48).toString('hex'), data = randomBytes(32).toString('base64'), ledger = randomBytes(32).toString('base64'), index = randomBytes(32).toString('base64');
    secrets.push(jwt, data, ledger, index);
    const httpPort = await freePort();
    const runtime = { ...env, JWT_SECRET: jwt, HOST: '127.0.0.1', PORT: String(httpPort),
        NORTEX_DATA_KEYS: 'qa:' + data, NORTEX_LEDGER_KEYS: 'qa:' + ledger, NORTEX_INDEX_KEY: index,
        NORTEX_MYSQL_INTEGRATION: '1', WHATSAPP_ENABLED: 'false', WHATSAPP_COMMERCE_ENABLED: 'false',
        NORTEX_ASSISTANT_ENABLED: 'false', NORTEX_PRIVATE_WA_SENDING_ENABLED: 'false', NORTEX_PROMOTIONS_ENABLED: 'false',
        NORTEX_ASSISTANT_STORAGE_DIR: path.join(output, `scratch-${id}`), SOURCE_COMMIT: sha,
        NORTEX_QA_BASE_URL: `http://127.0.0.1:${httpPort}`, FRONTEND_URL: `http://127.0.0.1:${httpPort}` };
    summary.httpPort = httpPort;
    server = launch(process.execPath, ['--import', 'tsx', 'backend/server.ts'], runtime, 'backend');
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
        if (server.exitCode !== null) throw new Error('El backend terminó antes de iniciar.');
        try {
            const response = await fetch(runtime.NORTEX_QA_BASE_URL + '/api/health', { signal: AbortSignal.timeout(1000) });
            const health = await response.json();
            if (response.ok && health.ok === true && health.db === 'up' && health.commit === sha && /no-store/.test(response.headers.get('cache-control') ?? '')) {
                summary.health = { status: response.status, db: health.db, commit: health.commit, cacheControl: response.headers.get('cache-control') };
                healthy = true; break;
            }
        } catch { /* espera acotada */ }
        await delay(500);
    }
    if (!healthy) throw new Error('Health no confirma el backend/DB de esta corrida.');
    const test = launch(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', suite, '--maxWorkers=1', '--reporter=default', '--reporter=json', '--outputFile=' + path.join(output, 'vitest.json')], runtime, 'vitest');
    const testExit = await exit(test);
    const report = JSON.parse(await readFile(path.join(output, 'vitest.json'), 'utf8'));
    summary.counts = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests,
        pending: report.numPendingTests, todo: report.numTodoTests };
    if (testExit !== 0) throw new Error(`vitest: salida ${testExit}; revisar el log sanitizado.`);
    summary.tests = assertExecutedSuite(report, suite);
    complete = true;
} catch (error) {
    summary.error = scrub(error.message); process.exitCode = 1;
} finally {
    for (const child of [...children]) await stop(child);
    if (started) {
        try { await docker(['rm', '-f', container], 'mysql-cleanup');
            const remaining = await docker(['ps', '-aq', '--filter', `name=^${container}$`], 'mysql-cleanup-check');
            summary.cleanupConfirmed = remaining.trim() === '';
        } catch { summary.cleanupConfirmed = false; process.exitCode = 1; }
    }
    await rm(path.join(output, `scratch-${id}`), { recursive: true, force: true });
    summary.passed = complete && summary.cleanupConfirmed;
    summary.endedAt = new Date().toISOString();
    for (const [name, text] of logs) await writeFile(path.join(output, `${name}.log`), scrub(text));
    await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
}
