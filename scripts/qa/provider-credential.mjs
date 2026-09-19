/**
 * Única decisión revisada sobre si una clave del proveedor entra al entorno de un
 * proceso hijo de QA. Ningún otro archivo debe leer ni escribir ANTHROPIC_API_KEY.
 *
 * Reglas que este módulo hace cumplir:
 * - El valor nunca se registra, se imprime ni se devuelve; sólo su huella y su longitud.
 * - El valor nunca viaja en argumentos de comando: se asigna al entorno del hijo.
 * - Un entorno de QA jamás lleva variables VITE_*, que terminarían en el bundle.
 * - La propagación es explícita: sin `allow` el lanzador queda sin clave del proveedor.
 */
import { createHash } from 'node:crypto';

export const PROVIDER_ENV_VAR = 'ANTHROPIC_API_KEY';
/** Forma pública de una clave de Anthropic; no valida que sea válida ni vigente. */
export const PROVIDER_KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{16,}$/;
const FRONTEND_PREFIX = /^VITE_/;

/** Identificador estable y no reversible para auditar sin exponer el secreto. */
export function fingerprintSecret(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
}

export function readProviderKey(source = process.env) {
  const raw = source?.[PROVIDER_ENV_VAR];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length ? value : null;
}

export function assertNoFrontendSecrets(env) {
  const leaked = Object.keys(env).filter(name => FRONTEND_PREFIX.test(name));
  if (leaked.length) throw new Error(`El entorno de QA no admite variables VITE_* (${leaked.join(', ')}): terminarían en el bundle del frontend.`);
}

/**
 * Aplica —o retira deliberadamente— la credencial del proveedor sobre `childEnv`.
 * Devuelve sólo metadatos auditables; nunca el secreto.
 */
export function applyProviderCredential(childEnv, { allow = false, source = process.env } = {}) {
  assertNoFrontendSecrets(childEnv);
  if (!allow) {
    // Retirada explícita: la compuerta obligatoria no puede gastar presupuesto ni
    // volverse no determinista porque otra terminal exportó una clave.
    delete childEnv[PROVIDER_ENV_VAR];
    return { propagated: false, reason: 'provider_excluded_by_default' };
  }
  const key = readProviderKey(source);
  if (!key) throw new Error(`Falta ${PROVIDER_ENV_VAR} en el entorno del lanzador. Cargalo desde el llavero con scripts/qa/nortexgpt-qa-run.sh; no lo escribas en un archivo ni en la línea de comandos.`);
  if (!PROVIDER_KEY_SHAPE.test(key)) throw new Error(`El valor de ${PROVIDER_ENV_VAR} no tiene la forma de una clave de Anthropic. No se propaga una credencial que no se puede reconocer.`);
  childEnv[PROVIDER_ENV_VAR] = key;
  return { propagated: true, fingerprint: fingerprintSecret(key), length: key.length };
}

/** Detección de filtraciones para las pruebas del lanzador. Devuelve las etiquetas comprometidas. */
export function findSecretOccurrences(secret, samples) {
  if (typeof secret !== 'string' || !secret.length) throw new Error('Se requiere un secreto no vacío para buscar filtraciones.');
  return samples.filter(({ text }) => typeof text === 'string' && text.includes(secret)).map(({ label }) => label);
}
