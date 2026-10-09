/** Borrador reproducible del corpus WEB_INTERNAL inicial. No revisa ni publica. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LEGACY_KNOWLEDGE, canonicalManifest, canonicalPayload, digest,
  payloadHash } from '../../backend/services/assistant/knowledge/model.js';
import { stageInput } from '../../backend/services/assistant/knowledge/lifecycle.js';

const RELEASE_ID = 'nortexgpt-primer-corte-20260923';
const WEB_VERSION = '2026-09-23.web1';
const PILOT_COPY: Record<string, string> = {
  asistente: 'Podés consultar información permitida para tu rol y pedir ayuda para usar Nortex. Las consultas muestran su período y procedencia. Una propuesta de compra no cambia inventario ni dinero. Para registrarla, una persona con permiso debe revisar los datos en la vista correspondiente de Nortex y confirmarla allí; el chat no confirma la compra.',
  lotes: 'Para productos con seguimiento por lote, comprobá el número de lote y la fecha de vencimiento antes de recibir. El vencimiento se evalúa por día civil, tomando como referencia la fecha vigente en Managua. El stock físico puede incluir unidades retenidas o vencidas: no lo confundás con disponibilidad para vender.',
  reposicion: 'Para planificar una reposición, consultá las existencias según los permisos de tu rol y revisá unidades, mínimos y recepciones pendientes. Comprobá aparte los lotes vencidos o retenidos antes de tratar esas unidades como disponibles para vender. La pantalla Compras Inteligentes requiere permisos de administración. Una orden preparada queda en borrador hasta su aprobación; el envío al proveedor se gestiona por separado. Prepararla no aumenta existencias ni deuda. La consulta de cobertura desde NortexGPT sigue deshabilitada en este piloto.',
  'salida-proveedor': 'Seleccioná el proveedor y la línea de compra o recepción original; revisá producto, lote, bodega y cantidad. Cuando la mercadería ya haya sido entregada físicamente al proveedor, confirmá ese hecho en el formulario autorizado de Nortex. El chat inicial no registra la salida. El comprobante de devolución no reduce por sí solo la cuenta por pagar; una nota de crédito del proveedor se concilia por separado.',
  merma: 'Una fecha vencida no demuestra que las unidades fueron retiradas físicamente. Revisá lote, bodega, cantidad y motivo; la vista de confirmación muestra la salida y su valor. Al confirmar la baja en el flujo autorizado, Nortex registra la salida de inventario, el movimiento de Kardex y la auditoría; si la pérdida tiene valor positivo, también genera el asiento. El chat no ejecuta la baja. Si cambian los datos después de revisar, actualizá la propuesta y volvé a revisarla.',
  comparacion: 'En este piloto NortexGPT puede mostrar cifras del período autorizado, pero no realiza la comparación automática con una ventana anterior. Para comparar manualmente, usá períodos equivalentes y considerá el corte de Managua. Una variación no demuestra su causa.',
};
const WEB_VERSIONS: Record<string, string> = {
  asistente: '2026-09-23.web2', lotes: '2026-09-23.web2',
  reposicion: '2026-09-23.web3', 'salida-proveedor': '2026-09-23.web2',
  merma: '2026-09-23.web2', comparacion: '2026-09-23.web2',
};
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
    return { documentId: id, version: WEB_VERSIONS[id] ?? WEB_VERSION,
      sectionId: source.reference.sectionId,
      payload: canonicalPayload({ ...source.payload, body: PILOT_COPY[id] ?? source.payload.body,
        channels: ['WEB_INTERNAL'] }) };
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
    asistente: 'Comprobar que la compra se confirma sólo en la vista autorizada, nunca en el chat.',
    lotes: 'Comprobar el día civil de Managua y la separación de stock físico y vendible.',
    reposicion: 'Comprobar permisos de Compras Inteligentes y cobertura deshabilitada.',
    comparacion: 'Verificar que el piloto muestre cifras del período sin prometer comparación automática.',
    'salida-proveedor': 'Comprobar la entrega física antes de confirmar; la nota de crédito es separada.',
    merma: 'Comprobar la condición de valor positivo del asiento y la confirmación fuera del chat.',
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
    'Cada artículo permite sólo `WEB_INTERNAL`; promociones y canal privado están excluidos de consultas nuevas. Las citas históricas siguen sujetas a su propio contrato de acceso.',
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
