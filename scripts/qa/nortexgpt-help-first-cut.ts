/** Borrador reproducible del corpus WEB_INTERNAL inicial. No revisa ni publica. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LEGACY_KNOWLEDGE, canonicalManifest, canonicalPayload, digest,
  payloadHash } from '../../backend/services/assistant/knowledge/model.js';
import { stageInput } from '../../backend/services/assistant/knowledge/lifecycle.js';

const RELEASE_ID = 'nortexgpt-primer-corte-20260923';
const WEB_VERSION = '2026-09-23.web1';
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
    return { documentId: id, version: WEB_VERSION,
      sectionId: source.reference.sectionId,
      payload: canonicalPayload({ ...source.payload, channels: ['WEB_INTERNAL'] }) };
  });
  const release = stageInput.parse({ id: RELEASE_ID, formatVersion: 1, documents });
  const manifest = canonicalManifest({ formatVersion: 1, references: documents.map(doc => ({
    documentId: doc.documentId, version: doc.version, sectionId: doc.sectionId,
    contentHash: payloadHash(doc.payload),
  })) });
  return { release, manifest, manifestHash: digest(manifest) };
}

function reviewSheet(result: ReturnType<typeof draft>): string {
  const hashes = new Map(result.manifest.references.map(ref => [ref.documentId, ref.contentHash]));
  const attention: Record<string, string> = {
    asistente: 'Confirmar que la mención de propuestas de compra no sugiera confirmación desde el chat inicial.',
    reposicion: 'Confirmar que la orden en borrador describa el flujo manual vigente; operaciones del asistente siguen apagadas.',
    'salida-proveedor': 'Confirmar que la salida física y la nota de crédito permanezcan fuera del chat inicial.',
    merma: 'Confirmar que la baja se ejecuta sólo en el flujo autorizado, no por una respuesta del modelo.',
  };
  const sections = result.release.documents.map(doc => [
    `## ${doc.documentId} · ${doc.payload.title}`,
    '',
    `- Versión: \`${doc.version}\``,
    `- Hash del artículo: \`${hashes.get(doc.documentId)}\``,
    `- Roles: ${doc.payload.roles.join(', ')}`,
    `- Canal: ${doc.payload.channels.join(', ')}`,
    `- Atención: ${attention[doc.documentId] ?? 'Comprobar texto, permisos y recorrido real en Nortex.'}`,
    '',
    doc.payload.body,
    '',
  ].join('\n'));
  return [
    '# NortexGPT · hoja de revisión del primer corte web',
    '',
    '**Borrador sin aprobación ni publicación.** Revisar el texto completo y los roles de cada versión.',
    `Hash del manifiesto exacto: \`${result.manifestHash}\`.`,
    'Cada artículo permite sólo `WEB_INTERNAL`; promociones y canal privado están excluidos.',
    'Si se corrige un texto, generar otra versión y otro hash antes de aprobar.',
    '',
    ...sections,
  ].join('\n');
}

async function main() {
  const result = draft();
  const files = [
    ['release-draft.json', `${JSON.stringify(result.release, null, 2)}\n`],
    ['manifest-draft.json', `${JSON.stringify(result.manifest, null, 2)}\n`],
    ['review-sheet.md', reviewSheet(result)],
  ] as const;
  if (process.argv.includes('--verify')) {
    for (const [name, body] of files) {
      const actual = await readFile(resolve(directory, name), 'utf8');
      if (actual !== body) throw new Error(`Borrador desactualizado: ${name}`);
    }
    console.log(`Borrador íntegro: ${result.release.documents.length} artículos; hash ${result.manifestHash}.`);
    return;
  }
  if (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === '--refresh'))
    throw new Error('Uso: nortexgpt-help-first-cut.ts [--verify|--refresh]');
  await mkdir(directory, { recursive: true });
  for (const [name, body] of files)
    await writeFile(resolve(directory, name), body,
      { flag: process.argv[2] === '--refresh' ? 'w' : 'wx', mode: 0o600 });
  console.log(`Borrador generado: ${result.release.documents.length} artículos web; hash ${result.manifestHash}. Sin publicación.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'No se pudo generar el borrador.'); process.exitCode = 1; });
