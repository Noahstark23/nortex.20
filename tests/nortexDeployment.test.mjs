// @vitest-environment node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { sealImage, verifySourceContracts } from '../scripts/nortex-seal-image.mjs';

test('los contratos versionados coinciden con las fuentes y el cliente Prisma del checkout real', async () => {
  const { Prisma } = await import('@prisma/client');
  const { contracts } = verifySourceContracts(new URL('..', import.meta.url).pathname);
  const models = Prisma.dmmf.datamodel.models;
  const columns = models.reduce((count, model) => count + model.fields.filter(field => field.kind !== 'object').length, 0);
  for (const [profile, contract] of Object.entries(contracts)) {
    assert.equal(contract.prismaVersion, Prisma.prismaVersion.client, `${profile}: versión Prisma`);
    assert.equal(contract.models, models.length, `${profile}: modelos del cliente`);
    assert.equal(contract.scalarColumns, columns, `${profile}: columnas del cliente`);
  }
});

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

// Captured by running the real public Coolify v4.3.18 PHP validation/flags/
// build-args helpers in deployment order; provenance is in the fixture.
// The full local container regression also executes the internal Docker calls.
const providerCommands = JSON.parse(readFileSync(new URL('./fixtures/nortex-provider-v4.3.18.json', import.meta.url), 'utf8'));
test('provider-transformed prepare/start commands pass the strict wrapper argument gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'nortex-command-'));
  try {
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'scripts/nortex-release.sh'), readFileSync(new URL('../scripts/nortex-release.sh', import.meta.url)));
    for (const command of providerCommands.cases) {
      const result = spawnSync('sh', ['-c', command.output], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 1, command.output);
      // Reaching repository validation proves dispatch/arity succeeded; no
      // repository, Docker, database or real environment values are accessed.
      assert.equal(result.stderr.trim(), 'NORTEX_REPOSITORY_REQUIRED', command.output);
    }
  } finally { rmSync(root, { recursive: true }); }
});
test('prepare continues to reject unexpected external build arguments', () => {
  for (const target of ['staging', 'production']) {
    const result = spawnSync('sh', [new URL('../scripts/nortex-release.sh', import.meta.url).pathname, target, 'prepare', '--build-arg', 'SYNTHETIC_FLAG'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'NORTEX_ARGUMENTS_INVALID');
  }
});
