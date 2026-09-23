/** Borrador reproducible del corpus WEB_INTERNAL inicial. No revisa ni publica. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LEGACY_KNOWLEDGE, canonicalManifest, digest } from '../../backend/services/assistant/knowledge/model.js';
import { stageInput } from '../../backend/services/assistant/knowledge/lifecycle.js';

const RELEASE_ID = 'nortexgpt-primer-corte-20260923';
const INCLUDED = ['asistente', 'ventas', 'offline', 'compras', 'lotes', 'contabilidad',
  'reposicion', 'salida-proveedor', 'merma', 'comparacion'] as const;
const EXCLUDED = ['promociones', 'canal-privado'] as const;
const directory = resolve('docs/evidence/nortexgpt/help-first-cut-20260923');

function draft() {
  const ids = new Set(LEGACY_KNOWLEDGE.map(doc => doc.reference.documentId));
  if (ids.size !== 12 || INCLUDED.some(id => !ids.has(id)) || EXCLUDED.some(id => !ids.has(id))
    || new Set([...INCLUDED, ...EXCLUDED]).size !== ids.size)
    throw new Error('El inventario de ayuda LEGACY cambió; se requiere otra revisión.');
  const documents = INCLUDED.map(id => {
    const source = LEGACY_KNOWLEDGE.find(doc => doc.reference.documentId === id)!;
    return { documentId: id, version: source.reference.version,
      sectionId: source.reference.sectionId, payload: source.payload };
  });
  const release = stageInput.parse({ id: RELEASE_ID, formatVersion: 1, documents });
  const manifest = canonicalManifest({ formatVersion: 1, references: INCLUDED.map(id => {
    const source = LEGACY_KNOWLEDGE.find(doc => doc.reference.documentId === id)!;
    return source.reference;
  }) });
  return { release, manifest, manifestHash: digest(manifest) };
}

async function main() {
  const result = draft();
  const files = [
    ['release-draft.json', result.release], ['manifest-draft.json', result.manifest],
  ] as const;
  if (process.argv.includes('--verify')) {
    for (const [name, value] of files) {
      const actual = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
      if (JSON.stringify(actual) !== JSON.stringify(value)) throw new Error(`Borrador desactualizado: ${name}`);
    }
    console.log(`Borrador íntegro: ${result.release.documents.length} artículos; hash ${result.manifestHash}.`);
    return;
  }
  if (process.argv.length !== 2) throw new Error('Uso: nortexgpt-help-first-cut.ts [--verify]');
  await mkdir(directory, { recursive: true });
  for (const [name, value] of files)
    await writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Borrador creado: ${result.release.documents.length} artículos; hash ${result.manifestHash}. Sin publicación.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'No se pudo generar el borrador.'); process.exitCode = 1; });
