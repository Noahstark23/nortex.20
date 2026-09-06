import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { REQUIRED_INTEGRATION_SUITES, assertExecutedSuite, validateQualityDatabase } from './quality-gate-contract.mjs';

// No heredar proveedores, credenciales de producción ni configuración de despliegue.
const env = {
  PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: randomBytes(48).toString('hex'), HOST: '127.0.0.1', WHATSAPP_ENABLED: 'false',
  NORTEX_DATA_KEYS: 'qa:' + randomBytes(32).toString('base64'),
  NORTEX_LEDGER_KEYS: 'qa:' + randomBytes(32).toString('base64'),
  NORTEX_INDEX_KEY: randomBytes(32).toString('base64'), NORTEX_MYSQL_INTEGRATION: '1',
  SOURCE_COMMIT: 'quality-gate-' + randomBytes(8).toString('hex'),
};
const output = path.resolve('reports/quality-integration');
await mkdir(output, { recursive: true });
let server;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const child = server;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  server = undefined;
}
process.once('SIGTERM', () => { void stop().finally(() => process.exit(143)); });
process.once('SIGINT', () => { void stop().finally(() => process.exit(130)); });
async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
const results = [];
let complete = false;
// Invalidar la evidencia anterior incluso si la configuración se rechaza
// antes de arrancar el backend. finally cierra ese intento con total cero.
await writeFile(path.join(output, 'summary.json'), JSON.stringify({ passed: false, inProgress: true, suites: [], total: 0 }));
try {
  validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);
  for (const suite of REQUIRED_INTEGRATION_SUITES) {
    if (!existsSync(suite)) throw new Error(`Falta una suite requerida: ${suite}`);
    const port = await freePort();
    const runtime = { ...env, PORT: String(port), NORTEX_QA_BASE_URL: `http://127.0.0.1:${port}`, FRONTEND_URL: `http://127.0.0.1:${port}` };
    const name = path.basename(suite);
    const log = createWriteStream(path.join(output, name + '.server.log'));
    server = spawn(process.execPath, ['--import', 'tsx', 'backend/server.ts'], { env: runtime, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.pipe(log); server.stderr.pipe(log);
    server.on('error', error => log.write(error.message));
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) throw new Error('El backend terminó antes de estar listo.');
      try {
        const response = await fetch(runtime.NORTEX_QA_BASE_URL + '/api/health', { signal: AbortSignal.timeout(1000) });
        const health = await response.json();
        if (response.ok && health.ok === true && health.db === 'up' && health.commit === env.SOURCE_COMMIT) { healthy = true; break; }
      } catch { /* Espera acotada por inicialización local. */ }
      await delay(500);
    }
    if (!healthy) throw new Error('Backend o MySQL de QA no disponible; no se omiten las pruebas.');
    const reportPath = path.join(output, name + '.json');
    const testLog = createWriteStream(path.join(output, name + '.log'));
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', suite, '--maxWorkers=1', '--reporter=default', '--reporter=json', '--outputFile=' + reportPath], { env: runtime, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(testLog); child.stderr.pipe(testLog);
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (exit !== 0) throw new Error(`Falló ${suite}; revisar reports/quality-integration.`);
    const count = assertExecutedSuite(report, suite);
    results.push({ suite, passed: count });
    console.log(`${suite}: ${count} casos ejecutados y aprobados`);
    await stop(); log.end(); testLog.end();
  }
  complete = true;
} finally {
  await stop();
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({ passed: complete, suites: results, total: results.reduce((sum, row) => sum + row.passed, 0) }, null, 2));
}
