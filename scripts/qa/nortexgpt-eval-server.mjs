/**
 * Backend local de QA para la evaluación de NortexGPT con Haiku.
 *
 *   scripts/qa/nortexgpt-qa-run.sh node scripts/qa/nortexgpt-eval-server.mjs --allow-provider
 *
 * Reutiliza la higiene de entorno de la compuerta de integración: no hereda el
 * entorno del shell, exige una base MySQL descartable y publica sólo en loopback.
 * La diferencia deliberada con `scripts/run-quality-integration.mjs` es una sola:
 * aquí la credencial del proveedor SÍ puede propagarse, y únicamente con
 * `--allow-provider`. La compuerta obligatoria la retira siempre.
 *
 * Habilitación de este primer paso: conversación y consultas operativas. Quedan
 * apagadas la ejecución de dinero/inventario, la preparación de acciones, la
 * extracción de documentos, WhatsApp comercial y los envíos privados.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';
import { applyProviderCredential } from './provider-credential.mjs';

const argument = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const allowProvider = process.argv.includes('--allow-provider');
const stateDir = path.join(homedir(), '.nortex-qa');
const secretPath = path.join(stateDir, 'eval-jwt-secret');

validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);

async function stableJwtSecret() {
  // Estable entre reinicios: renovar el token invalida la reanudación del evaluador.
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  try {
    const existing = (await readFile(secretPath, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch { /* se crea abajo */ }
  const created = randomBytes(48).toString('hex');
  await writeFile(secretPath, `${created}\n`, { mode: 0o600 });
  await chmod(secretPath, 0o600);
  return created;
}

async function freePort(requested) {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(requested ?? 0, '127.0.0.1', resolve); });
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

const port = await freePort(Number(argument('--port') ?? 3211));
const baseUrl = `http://127.0.0.1:${port}`;
const commit = 'nortexgpt-eval-' + randomBytes(8).toString('hex');
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: await stableJwtSecret(),
  HOST: '127.0.0.1', PORT: String(port),
  FRONTEND_URL: baseUrl, NORTEX_QA_BASE_URL: baseUrl,
  NORTEX_DATA_KEYS: 'qa:' + randomBytes(32).toString('base64'),
  NORTEX_LEDGER_KEYS: 'qa:' + randomBytes(32).toString('base64'),
  NORTEX_INDEX_KEY: randomBytes(32).toString('base64'),
  NORTEX_ASSISTANT_STORAGE_DIR: path.join(tmpdir(), 'nortex-eval-assistant-' + randomBytes(8).toString('hex')),
  SOURCE_COMMIT: commit,
  // Paso inicial: conversación y consultas operativas, nada más.
  NORTEX_ASSISTANT_ENABLED: 'true',
  NORTEX_ASSISTANT_OPERATIONS_ENABLED: 'true',
  NORTEX_ASSISTANT_LANGUAGE_ENABLED: 'false',
  NORTEX_ASSISTANT_EXTRACTION_ENABLED: 'false',
  NORTEX_ASSISTANT_EXECUTION_ENABLED: 'false',
  NORTEX_ASSISTANT_ACTIONS_ENABLED: 'false',
  NORTEX_PROMOTIONS_ENABLED: 'false',
  NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED: 'false',
  NORTEX_PRIVATE_WA_SENDING_ENABLED: 'false',
  WHATSAPP_ENABLED: 'false',
};
const credential = applyProviderCredential(env, { allow: allowProvider });

const logPath = path.resolve('reports/assistant-evaluation/qa-server.log');
await mkdir(path.dirname(logPath), { recursive: true });
const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
const server = spawn(process.execPath, ['--import', 'tsx', 'backend/server.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(log); server.stderr.pipe(log);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
async function stop(code) {
  if (stopping) return; stopping = true;
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
  log.end();
  process.exit(code);
}
process.once('SIGINT', () => void stop(130));
process.once('SIGTERM', () => void stop(143));

let healthy = false;
for (let attempt = 0; attempt < 90 && !healthy; attempt++) {
  if (server.exitCode !== null) { console.error(`El backend de QA terminó antes de estar listo. Revisá ${path.relative(process.cwd(), logPath)}.`); process.exit(1); }
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    const health = await response.json();
    if (response.ok && health.ok === true && health.db === 'up' && health.commit === commit) healthy = true;
  } catch { /* espera acotada */ }
  if (!healthy) await delay(500);
}
if (!healthy) { console.error('El backend de QA o MySQL no respondieron.'); await stop(1); }

console.log(JSON.stringify({
  baseUrl, pid: server.pid, database: new URL(env.DATABASE_URL).pathname.slice(1),
  provider: credential.propagated
    ? { propagated: true, envVar: 'ANTHROPIC_API_KEY', fingerprint: credential.fingerprint, length: credential.length }
    : { propagated: false, reason: credential.reason, effect: 'las consultas devolverán el respaldo determinista' },
  capabilities: { conversation: true, operations: true, extraction: false, execution: false, actionPrepare: false, promotions: false, privateWhatsapp: false, whatsappBusiness: false },
  serverBudgets: { globalUsd: '20', defaultTenantUsd: '2', maximumApprovedTenantUsd: '10' },
  log: path.relative(process.cwd(), logPath),
}, null, 2));
console.log('\nBackend de QA listo. Ctrl+C para detenerlo.');
await new Promise(() => {});
