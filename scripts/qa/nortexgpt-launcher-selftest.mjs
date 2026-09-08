/**
 * Prueba del lanzador con una credencial sintética y un proceso de prueba.
 *
 *   node scripts/qa/nortexgpt-launcher-selftest.mjs [--report ruta.json]
 *
 * Aislamiento (reglas de esta prueba):
 * - Credencial sintética en un servicio de llavero aparte, que se borra al terminar.
 *   Nunca lee ni usa la credencial real.
 * - Entorno controlado: se construye una lista corta de variables. No hereda el
 *   entorno del operador, así que un ANTHROPIC_API_KEY exportado no contamina.
 * - Búsqueda de filtraciones sobre una LISTA EXPLÍCITA de archivos que esta prueba
 *   produce o gobierna. No recorre el repositorio y no abre .env, llaves ni secretos.
 * - Un fallo de lectura o de un comando FALLA la comprobación. Nunca la aprueba.
 * - No llama al proveedor y no gasta presupuesto.
 *
 * En macOS usa el llavero real. Donde no hay llavero (Linux, CI) se puede fijar
 * NORTEX_QA_SECURITY_DIR al doble de prueba de scripts/qa/testdouble; el informe
 * queda rotulado como `simulated` y no acredita el almacenamiento real.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROVIDER_ENV_VAR, fingerprintSecret, findSecretOccurrences } from './provider-credential.mjs';

const SERVICE = 'nortex-qa-anthropic-selftest';
const ACCOUNT = 'ANTHROPIC_API_KEY';
const LAUNCHER = 'scripts/qa/nortexgpt-qa-run.sh';
const PROBE = 'scripts/qa/nortexgpt-credential-probe.mjs';
/** Variables permitidas en el entorno del hijo. Nada más se hereda. */
const ALLOWED_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SHELL', 'TERM'];
/** Rutas que esta prueba jamás debe abrir, aunque alguien las agregue a la lista. */
const FORBIDDEN_TARGET = /(^|\/)\.env(\.|$)|(^|\/)\.netrc$|(^|\/)id_[a-z]+$|\.pem$|\.p12$|\.key$/i;

const argument = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const reportPath = path.resolve(argument('--report') ?? 'reports/assistant-evaluation/launcher-selftest.json');

const doubleDir = process.env.NORTEX_QA_SECURITY_DIR ? path.resolve(process.env.NORTEX_QA_SECURITY_DIR) : null;
const keychain = doubleDir ? 'simulated' : 'macos';
const fakeStore = doubleDir ? path.join(tmpdir(), `nortex-qa-fake-keychain-${randomBytes(6).toString('hex')}`) : null;

/** Entorno controlado: lista blanca, sin la credencial real y sin variables del frontend. */
function controlledEnv(extra = {}) {
  const env = {};
  for (const key of ALLOWED_ENV_KEYS) if (typeof process.env[key] === 'string') env[key] = process.env[key];
  const built = {
    ...env,
    ...(doubleDir ? { PATH: `${doubleDir}${path.delimiter}${env.PATH ?? ''}`, NORTEX_QA_FAKE_KEYCHAIN: fakeStore } : {}),
    NORTEX_QA_KEYCHAIN_SERVICE: SERVICE, NORTEX_QA_KEYCHAIN_ACCOUNT: ACCOUNT,
    ...extra,
  };
  delete built[PROVIDER_ENV_VAR];
  return built;
}

/** Ejecuta y distingue "el comando falló" de "el comando respondió con código != 0". */
function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${label}: no se pudo ejecutar (${result.error.message}).`);
  if (result.status === null) throw new Error(`${label}: terminó por señal ${result.signal ?? 'desconocida'}.`);
  return result;
}

const security = (args, options = {}) => run('security', doubleDir ? path.join(doubleDir, 'security') : 'security', args, { env: controlledEnv(), ...options });
const launcher = (args, extra = {}) => run('lanzador', 'bash', [LAUNCHER, ...args], { env: controlledEnv(extra) });

function removeSynthetic() {
  const result = spawnSync(doubleDir ? path.join(doubleDir, 'security') : 'security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], { encoding: 'utf8', env: controlledEnv() });
  return !result.error;
}
function readBack() {
  const found = spawnSync(doubleDir ? path.join(doubleDir, 'security') : 'security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], { encoding: 'utf8', env: controlledEnv() });
  if (found.error) throw new Error(`No se pudo consultar el llavero de prueba (${found.error.message}).`);
  return found.status === 0 ? found.stdout.trim() : null;
}
function storeSynthetic(secret) {
  removeSynthetic();
  // Preferido: el valor entra por stdin y nunca aparece en la lista de procesos.
  const piped = security(['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-D', 'Nortex QA — credencial sintética de prueba', '-w'], { input: `${secret}\n${secret}\n` });
  if (piped.status === 0 && readBack() === secret) return 'stdin';
  removeSynthetic();
  const argv = security(['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-D', 'Nortex QA — credencial sintética de prueba', '-w', secret]);
  if (argv.status !== 0 || readBack() !== secret) throw new Error('No se pudo preparar la credencial sintética en el llavero.');
  return 'argv_fallback_synthetic_only';
}

/** Lectura estricta: si un objetivo requerido no se puede leer, la comprobación falla. */
function readAllowedTarget(target) {
  if (FORBIDDEN_TARGET.test(target.path)) return { ok: false, error: 'RUTA_PROHIBIDA' };
  try { return { ok: true, text: readFileSync(target.path, 'utf8') }; }
  catch (error) { return { ok: false, error: error?.code ?? 'ERROR_DE_LECTURA' }; }
}

const checks = [];
const record = (id, passed, detail) => { checks.push({ id, passed: Boolean(passed), detail }); return Boolean(passed); };

if (keychain === 'macos' && process.platform !== 'darwin') {
  console.error('Sin llavero de macOS. Ejecutá esta prueba en la Mac, o fijá NORTEX_QA_SECURITY_DIR=scripts/qa/testdouble para la variante simulada.');
  process.exit(4);
}

const secret = `sk-ant-qa-selftest-${randomBytes(24).toString('hex')}`;
const fingerprint = fingerprintSecret(secret);
const markerPath = path.join(tmpdir(), `nortex-qa-probe-${randomBytes(8).toString('hex')}.json`);
let storageMethod = null;
let environmentVisibleToSameUser = null;
let fatal = null;

try {
  // 0. Aislamiento del entorno construido, antes de tocar el llavero.
  const sample = controlledEnv();
  record('aislamiento.sin_credencial_real', sample[PROVIDER_ENV_VAR] === undefined, { operadorTeniaCredencialExportada: typeof process.env[PROVIDER_ENV_VAR] === 'string' });
  record('aislamiento.sin_variables_vite', Object.keys(sample).every(key => !key.startsWith('VITE_')), { claves: Object.keys(sample).length });
  record('aislamiento.lista_blanca', Object.keys(sample).every(key => ALLOWED_ENV_KEYS.includes(key) || key.startsWith('NORTEX_QA_')), { permitidas: ALLOWED_ENV_KEYS });

  storageMethod = storeSynthetic(secret);

  // 1. Propagación: el proceso de prueba recibe exactamente la credencial guardada.
  rmSync(markerPath, { force: true });
  const propagation = launcher(['node', PROBE], { NORTEX_QA_PROBE_MARKER: markerPath });
  let probe = null;
  try { probe = JSON.parse(propagation.stdout.trim().split('\n').at(-1)); } catch { probe = null; }
  record('propagacion.salida_exitosa', propagation.status === 0, { exitCode: propagation.status });
  record('propagacion.proceso_respondio', probe !== null, { stdoutVacio: propagation.stdout.trim() === '' });
  record('propagacion.credencial_recibida', probe?.present === true, { present: probe?.present ?? null });
  record('propagacion.huella_coincide', probe?.fingerprint === fingerprint, { expected: fingerprint, observed: probe?.fingerprint ?? null });
  record('propagacion.longitud_coincide', probe?.length === secret.length, { expected: secret.length, observed: probe?.length ?? null });
  record('propagacion.proceso_ejecutado', existsSync(markerPath), { marker: existsSync(markerPath) });

  // 2. Filtraciones, sobre una lista explícita. Nada de recorrer el repositorio.
  record('fuga.no_en_stdout_ni_stderr', findSecretOccurrences(secret, [
    { label: 'stdout', text: propagation.stdout }, { label: 'stderr', text: propagation.stderr },
  ]).length === 0, { revisado: ['stdout', 'stderr'] });

  const scanTargets = [
    { label: 'archivo-del-proceso-de-prueba', path: markerPath },
    { label: 'lanzador', path: LAUNCHER },
    { label: 'proceso-de-prueba', path: PROBE },
    { label: 'script-de-credencial', path: 'scripts/qa/nortexgpt-credential.sh' },
    { label: 'modulo-de-credencial', path: 'scripts/qa/provider-credential.mjs' },
    { label: 'lanzador-de-evaluacion', path: 'scripts/qa/nortexgpt-eval-server.mjs' },
    { label: 'compuerta-de-integracion', path: 'scripts/run-quality-integration.mjs' },
  ];
  const reads = scanTargets.map(target => ({ ...target, ...readAllowedTarget(target) }));
  const unreadable = reads.filter(entry => !entry.ok);
  record('fuga.todos_los_objetivos_legibles', unreadable.length === 0, { ilegibles: unreadable.map(entry => ({ label: entry.label, error: entry.error })) });
  record('fuga.no_en_objetivos_permitidos',
    unreadable.length === 0 && findSecretOccurrences(secret, reads.map(entry => ({ label: entry.label, text: entry.text }))).length === 0,
    { revisados: scanTargets.map(target => target.label), recorridoDelRepositorio: false, archivosSensiblesAbiertos: 0 });
  record('fuga.probe_no_ve_secreto_en_argv', probe?.argvContainsSecret === false, { argvContainsSecret: probe?.argvContainsSecret ?? null });
  record('fuga.sin_variables_vite_en_el_hijo', Array.isArray(probe?.viteVariables) && probe.viteVariables.length === 0, { viteVariables: probe?.viteVariables ?? null });

  // argv del hijo real, observado desde fuera. Si `ps` no responde, la comprobación falla.
  const sleeper = run('observador de procesos', 'bash', ['-c',
    `bash ${LAUNCHER} sleep 4 & pid=$!; sleep 1; ps -o args= -p $pid; echo "---ENV---"; { ps -Ewww -o args= -p $pid 2>/dev/null || tr '\\0' ' ' < /proc/$pid/environ 2>/dev/null; }; kill $pid 2>/dev/null; wait $pid 2>/dev/null`,
  ], { env: controlledEnv() });
  const [argvView = '', envView = ''] = sleeper.stdout.split('---ENV---');
  const observed = argvView.includes('sleep 4');
  record('fuga.argv_observado_efectivamente', observed, { salida: argvView.trim().slice(0, 120) || '(vacía)' });
  record('fuga.no_en_argumentos_del_proceso', observed && !argvView.includes(secret), { muestra: argvView.trim().slice(0, 120) });
  environmentVisibleToSameUser = envView.trim() ? envView.includes(secret) : null;

  // 3. Falta de credencial: falla cerrada y no arranca el proceso.
  record('ausencia.credencial_retirada', removeSynthetic() && readBack() === null, { llavero: 'vacío' });
  rmSync(markerPath, { force: true });
  const missing = launcher(['node', PROBE], { NORTEX_QA_PROBE_MARKER: markerPath });
  record('ausencia.codigo_de_salida_3', missing.status === 3, { exitCode: missing.status });
  record('ausencia.mensaje_orienta', /nortexgpt-credential\.sh guardar/.test(missing.stderr), { stderr: missing.stderr.trim().split('\n').slice(0, 3) });
  record('ausencia.no_ejecuta_el_comando', !existsSync(markerPath), { marker: existsSync(markerPath) });
  record('ausencia.sin_salida_estandar', missing.stdout.trim() === '', { stdout: missing.stdout.trim().slice(0, 80) });
} catch (error) {
  // Un fallo de comando o de lectura no aprueba nada: se registra y hunde la prueba.
  fatal = error instanceof Error ? error.message : 'error desconocido';
  record('ejecucion.sin_errores_de_comando_o_lectura', false, { error: fatal });
} finally {
  removeSynthetic();
  rmSync(markerPath, { force: true });
  if (fakeStore) rmSync(fakeStore, { recursive: true, force: true });
}

const passed = checks.length > 0 && checks.every(check => check.passed) && !fatal;
const report = {
  version: 2,
  createdAt: new Date().toISOString(),
  scope: 'launcher_only_synthetic_credential',
  providerCalled: false,
  isolation: { controlledEnv: true, allowedEnvKeys: ALLOWED_ENV_KEYS, inheritedOperatorEnv: false, repositoryWalk: false, sensitiveFilesRead: 0 },
  keychain, keychainService: SERVICE,
  syntheticFingerprint: fingerprint,
  storageMethod, fatal,
  passed, checks,
  residualExposure: {
    processEnvironmentReadableBySameUser: environmentVisibleToSameUser,
    note: 'El backend espera ANTHROPIC_API_KEY como variable de entorno; en macOS el propio usuario puede leer el entorno de sus procesos. El lanzador evita disco, historial y argumentos, no ese canal. `null` significa que no se pudo observar, no que no exista.',
  },
  limitations: [
    'La credencial es sintética: esta prueba no evalúa Haiku ni acredita una llamada real.',
    'No se verificó MySQL, el backend de QA ni el presupuesto del servidor.',
    'La búsqueda de filtraciones cubre la lista explícita de objetivos, no todo el repositorio.',
    ...(keychain === 'simulated' ? ['Llavero simulado con scripts/qa/testdouble/security: verifica la conducta del lanzador, no el almacenamiento real de macOS.'] : []),
  ],
};
// El informe se revisa antes de escribirlo: no puede ser el vehículo de la filtración.
if (findSecretOccurrences(secret, [{ label: 'informe', text: JSON.stringify(report) }]).length) {
  console.error('FALLIDO: el informe contendría el secreto; no se escribe.');
  process.exit(1);
}
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`${passed ? 'APROBADO' : 'FALLIDO'}: ${checks.filter(c => c.passed).length}/${checks.length} comprobaciones. Informe: ${path.relative(process.cwd(), reportPath)}`);
if (fatal) console.log(`  ERROR: ${fatal}`);
for (const check of checks.filter(c => !c.passed)) console.log(`  FALLA ${check.id}: ${JSON.stringify(check.detail)}`);
if (!passed) process.exitCode = 1;
