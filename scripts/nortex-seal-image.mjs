// Se ejecuta exclusivamente al construir: receipt nuevo para los bytes nuevos.
// Nunca conecta DB ni toma hashes/confirmaciones desde variables del entorno.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
// Validar el checkout real también en CI, antes de llegar al build remoto.
// Los fingerprints de las bases siguen siendo contratos revisados, no se generan aquí.
export function verifySourceContracts(root = '.') {
  const read = path => JSON.parse(readFileSync(`${root}/${path}`, 'utf8'));
  const product = read('deploy/nortex/product-files.json');
  for (const [path, expected] of Object.entries(product.files)) {
    if (hash(`${root}/${path}`) !== expected) throw new Error('NORTEX_PRODUCT_SOURCE_MISMATCH');
  }
  const contracts = {};
  for (const profile of ['staging', 'production']) {
    const contract = read(`deploy/nortex/${profile}.contract.json`);
    if (hash(`${root}/node_modules/.prisma/client/schema.prisma`) !== contract.generatedSchemaSha256)
      throw new Error('NORTEX_BUILD_CLIENT_MISMATCH');
    contracts[profile] = contract;
  }
  return { product, contracts };
}
export function sealImage(root = '.') {
  const source = JSON.parse(readFileSync(`${root}/.nortex-build-source.json`, 'utf8'));
  if (source.version !== 1 || !/^[a-f0-9]{40}$/.test(source.commit ?? '')) throw new Error('NORTEX_BUILD_IDENTITY_REQUIRED');
  const { product, contracts } = verifySourceContracts(root);
  const files = {};
  const walk = relative => {
    for (const name of readdirSync(`${root}/${relative}`).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (['.git', 'node_modules', '.env', '.nortex-build-source.json', 'deploy/nortex/image-receipt.json'].includes(path)
        || path.startsWith('.env.')) continue;
      const stat = lstatSync(`${root}/${path}`);
      if (stat.isSymbolicLink()) throw new Error('NORTEX_IMAGE_SYMLINK_FORBIDDEN');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files[path] = hash(`${root}/${path}`);
    }
  };
  walk('');
  if (!files['dist/index.html'] || !files['dist/sw.js'] || !files['scripts/deploy-schema-preflight.ts']
    || !files['scripts/nortex-start.sh'] || !files['scripts/nortex-schema-gate.mjs']) throw new Error('NORTEX_BUILD_INCOMPLETE');
  const receipt = { version: 1, previousCommit: source.commit, productOrigin: product.origin, files, contracts };
  writeFileSync(`${root}/deploy/nortex/image-receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) sealImage();
