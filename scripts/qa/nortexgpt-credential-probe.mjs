/**
 * Proceso de prueba del lanzador. Informa si recibió la credencial y su huella;
 * nunca el valor. Sirve para comprobar propagación y ausencia de filtraciones sin
 * llamar al proveedor ni gastar presupuesto.
 */
import { writeFileSync } from 'node:fs';
import { PROVIDER_ENV_VAR, fingerprintSecret, readProviderKey } from './provider-credential.mjs';

const key = readProviderKey();
const report = {
  probe: 'nortexgpt-credential-probe',
  pid: process.pid,
  present: Boolean(key),
  envVar: PROVIDER_ENV_VAR,
  length: key ? key.length : 0,
  fingerprint: key ? fingerprintSecret(key) : null,
  // Un secreto en argv sería visible para cualquier proceso del sistema.
  argvContainsSecret: Boolean(key) && process.argv.some(argument => argument.includes(key)),
  viteVariables: Object.keys(process.env).filter(name => name.startsWith('VITE_')),
};
const marker = process.env.NORTEX_QA_PROBE_MARKER;
if (marker) writeFileSync(marker, JSON.stringify(report), { mode: 0o600 });
console.log(JSON.stringify(report));
