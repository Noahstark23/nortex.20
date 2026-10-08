import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REQUIRED_INTEGRATION_SUITES } from './quality-gate-contract.mjs';

export async function discoverQualitySuites(root = process.cwd()) {
  const discovered = [];
  async function visit(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        const source = await readFile(path.join(root, relative), 'utf8');
        if (/\.(integration|mysql)\.test\.ts$/.test(entry.name)
          || /process\.env\.(NORTEX_QA_BASE_URL|NORTEX_MYSQL_INTEGRATION)/.test(source)) discovered.push(relative);
      }
    }
  }
  await visit('tests');
  return discovered.sort();
}

export function validateQualitySuiteRegistration(registered, discovered, existing) {
  if (!registered.length || new Set(registered).size !== registered.length) throw new Error('Registro de integración vacío o duplicado.');
  for (const suite of registered) if (!existing.has(suite)) throw new Error(`Falta una suite obligatoria: ${suite}`);
  for (const suite of discovered) if (!registered.includes(suite)) throw new Error(`Suite de integración no registrada: ${suite}`);
  return registered;
}

export async function verifyQualitySuiteRegistration(root = process.cwd()) {
  const discovered = await discoverQualitySuites(root);
  const existing = new Set();
  for (const suite of REQUIRED_INTEGRATION_SUITES) {
    await readFile(path.join(root, suite), 'utf8');
    existing.add(suite);
  }
  return validateQualitySuiteRegistration(REQUIRED_INTEGRATION_SUITES, discovered, existing);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log((await verifyQualitySuiteRegistration()).join('\n')); }
  catch { console.error('Registro obligatorio de integración inválido o ilegible.'); process.exitCode = 1; }
}
