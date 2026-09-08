/**
 * Obtiene una sesión local de Nortex para el evaluador y la deja en un archivo
 * privado 0600 fuera del repositorio. Usa únicamente el usuario sintético de la
 * demostración; nunca una cuenta real ni la clave del proveedor.
 *
 *   node scripts/qa/nortexgpt-qa-session.mjs --base-url http://127.0.0.1:3211 --vertical ferreteria
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const argument = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const vertical = argument('--vertical');
if (!['ferreteria', 'farmacia'].includes(vertical)) throw new Error('Indicá --vertical ferreteria|farmacia.');
const base = new URL(argument('--base-url') ?? 'invalid:');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Sólo se admite el backend local de QA.');

const email = `${vertical}.demo@nortex.invalid`;
const password = 'NortexDemo-2026!'; // Contraseña de la fixture sintética, no de una persona.
const response = await fetch(new URL('/api/auth/login', base), {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }), redirect: 'error', signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`No se pudo iniciar sesión de QA (HTTP ${response.status}).`);
const data = await response.json();
const token = data.token ?? data.accessToken;
if (typeof token !== 'string' || !token.length) throw new Error('La respuesta de sesión no trae un token utilizable.');

const directory = path.join(homedir(), '.nortex-qa');
await mkdir(directory, { recursive: true, mode: 0o700 });
const target = path.join(directory, `sesion-${vertical}`);
await writeFile(target, token, { mode: 0o600 });
await chmod(target, 0o600);
console.log(JSON.stringify({ vertical, email, sessionTokenFile: target, mode: '0600', note: 'El token es la sesión de Nortex, nunca la clave del proveedor.' }, null, 2));
