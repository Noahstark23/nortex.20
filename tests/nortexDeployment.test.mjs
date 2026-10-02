// @vitest-environment node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { sealImage } from '../scripts/nortex-seal-image.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nortex-seal-'));
  const put = (path, value) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'object' ? JSON.stringify(value) : value);
  };
  put('.nortex-build-source.json', { version: 1, commit: 'a'.repeat(40) });
  put('deploy/nortex/product-files.json', { origin: 'b'.repeat(40), files: { 'backend/server.ts': sha('unchanged') } });
  put('backend/server.ts', 'unchanged');
  for (const path of ['dist/index.html', 'dist/sw.js', 'scripts/deploy-schema-preflight.ts', 'scripts/nortex-start.sh', 'scripts/nortex-schema-gate.mjs']) put(path, 'test artifact');
  put('node_modules/.prisma/client/schema.prisma', 'exact generated client');
  for (const profile of ['staging', 'production']) put(`deploy/nortex/${profile}.contract.json`, { generatedSchemaSha256: sha('exact generated client') });
  return { root, put };
}
test('new receipt binds new SHA and actual artifacts, independently of historic receipt identity', () => {
  const { root, put } = fixture();
  try {
    const first = sealImage(root);
    assert.equal(first.previousCommit, 'a'.repeat(40));
    assert.equal(first.productOrigin, 'b'.repeat(40));
    assert.equal(first.files['dist/index.html'], sha('test artifact'));
    put('dist/index.html', 'new build artifact');
    const second = sealImage(root);
    assert.equal(second.files['dist/index.html'], sha('new build artifact'));
    assert.notEqual(first.files['dist/index.html'], second.files['dist/index.html']);
    assert.equal(first.contracts.production.generatedSchemaSha256, second.contracts.production.generatedSchemaSha256);
  } finally { rmSync(root, { recursive: true }); }
});
for (const [name, mutate, error] of [
  ['missing or malformed SHA', f => f.put('.nortex-build-source.json', { version: 1, commit: 'unknown' }), 'NORTEX_BUILD_IDENTITY_REQUIRED'],
  ['changed product source', f => f.put('backend/server.ts', 'unauthorized change'), 'NORTEX_PRODUCT_SOURCE_MISMATCH'],
  ['changed generated client', f => f.put('node_modules/.prisma/client/schema.prisma', 'wrong client'), 'NORTEX_BUILD_CLIENT_MISMATCH'],
  ['missing PWA output', f => rmSync(join(f.root, 'dist/sw.js')), 'NORTEX_BUILD_INCOMPLETE'],
]) test(`seal rejects ${name}`, () => {
  const f = fixture();
  try { mutate(f); assert.throws(() => sealImage(f.root), { message: error }); }
  finally { rmSync(f.root, { recursive: true }); }
});
test('deployment uses scripts from repository and image; original DDL entrypoint remains outside CMD', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY \. \./);
  assert.match(dockerfile, /RUN node scripts\/nortex-seal-image\.mjs/);
  assert.match(dockerfile, /CMD \["sh", "scripts\/nortex-start\.sh"\]/);
  const start = readFileSync(new URL('../scripts/nortex-start.sh', import.meta.url), 'utf8');
  assert.match(start, /set -eu[\s\S]*node scripts\/nortex-schema-gate\.mjs[\s\S]*exec env NODE_ENV=production node node_modules\/tsx\/dist\/cli\.mjs backend\/server\.ts/);
  assert.doesNotMatch(start, /db push|migrate|npm run/);
});
