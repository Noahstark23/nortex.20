// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createReleaseCommitResolver, resolveReleaseCommit } from '../backend/lib/releaseIdentity';

const COMMIT = '1'.repeat(40);
const STALE = '2'.repeat(40);
const script = fileURLToPath(new URL('../scripts/write-release-identity.mjs', import.meta.url));
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nortex-release-identity-'));
  roots.push(root);
  mkdirSync(join(root, 'backend'));
  writeFileSync(join(root, 'backend/server.ts'), Buffer.from('servidor\r\nñ\n'));
  return root;
}
function build(root: string, commit?: string) {
  // Entorno sintético: no hereda credenciales ni variables locales.
  return spawnSync(process.execPath, [script], {
    cwd: root, env: commit === undefined ? {} : { NORTEX_BUILD_COMMIT: commit }, encoding: 'utf8',
  });
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('procedencia de release de la imagen', () => {
  it('genera SHA256 de bytes reales y prevalece sobre SOURCE_COMMIT obsoleto', () => {
    const root = fixture();
    expect(build(root, COMMIT).status).toBe(0);
    const marker = JSON.parse(readFileSync(join(root, '.nortex-release.json'), 'utf8'));
    expect(marker).toEqual({ version: 1, commit: COMMIT, serverSha256: createHash('sha256')
      .update(readFileSync(join(root, 'backend/server.ts'))).digest('hex') });
    expect(resolveReleaseCommit({ rootDir: root, sourceCommit: 'quality-gate-stale' })).toBe(COMMIT);
  });
  it('archivo ausente conserva el fallback original, incluyendo identificadores de QA local', () => {
    const root = fixture();
    expect(resolveReleaseCommit({ rootDir: root, sourceCommit: STALE })).toBe(STALE);
    expect(resolveReleaseCommit({ rootDir: root })).toBeNull();
    expect(resolveReleaseCommit({ rootDir: root, sourceCommit: 'quality-gate-012345abcdef' })).toBe('quality-gate-012345abcdef');
    expect(resolveReleaseCommit({ rootDir: root, sourceCommit: 'local-delivery-qa' })).toBe('local-delivery-qa');
  });
  it.each(['{', 'null', JSON.stringify({ version: 2, commit: COMMIT, serverSha256: 'a'.repeat(64) }),
    JSON.stringify({ version: 1, commit: 'main', serverSha256: 'a'.repeat(64) }),
    JSON.stringify({ version: 1, commit: COMMIT, serverSha256: 'bad' })])(
    'metadata inválida falla cerrada sin fallback (%s)', raw => {
      const root = fixture();
      writeFileSync(join(root, '.nortex-release.json'), raw);
      expect(resolveReleaseCommit({ rootDir: root, sourceCommit: STALE })).toBeNull();
    });
  it('cambio de bytes del servidor y servidor ausente invalidan el marker sin fallback', () => {
    const root = fixture();
    expect(build(root, COMMIT).status).toBe(0);
    writeFileSync(join(root, 'backend/server.ts'), 'servidor\nñ\n');
    expect(resolveReleaseCommit({ rootDir: root, sourceCommit: STALE })).toBeNull();
    rmSync(join(root, 'backend/server.ts'));
    expect(resolveReleaseCommit({ rootDir: root, sourceCommit: STALE })).toBeNull();
  });
  it.each([undefined, ''])('build genérico borra marker inyectado, con input %s', input => {
    const root = fixture();
    writeFileSync(join(root, '.nortex-release.json'), '{"commit":"inyectado"}');
    expect(build(root, input).status).toBe(0);
    expect(() => readFileSync(join(root, '.nortex-release.json'))).toThrow();
  });
  it.each(['main', '1'.repeat(39), 'A'.repeat(40), COMMIT + '\n'])('build rechaza input no vacío inválido %s', input => {
    const root = fixture();
    writeFileSync(join(root, '.nortex-release.json'), '{}');
    expect(build(root, input).status).not.toBe(0);
    expect(() => readFileSync(join(root, '.nortex-release.json'))).toThrow();
  });
  it('memoiza la identidad para la vida del proceso, incluyendo resultado inválido', () => {
    const root = fixture();
    expect(build(root, COMMIT).status).toBe(0);
    const getCommit = createReleaseCommitResolver({ rootDir: root, sourceCommit: STALE });
    expect(getCommit()).toBe(COMMIT);
    writeFileSync(join(root, '.nortex-release.json'), '{');
    expect(getCommit()).toBe(COMMIT);
    const getInvalidCommit = createReleaseCommitResolver({ rootDir: root, sourceCommit: STALE });
    expect(getInvalidCommit()).toBeNull();
    expect(build(root, COMMIT).status).toBe(0);
    expect(getInvalidCommit()).toBeNull();
  });
  it('build reemplaza marker inyectado con identidad de sus propios bytes', () => {
    const root = fixture();
    writeFileSync(join(root, '.nortex-release.json'), JSON.stringify({ version: 1, commit: STALE, serverSha256: 'a'.repeat(64) }));
    expect(build(root, COMMIT).status).toBe(0);
    expect(resolveReleaseCommit({ rootDir: root, sourceCommit: STALE })).toBe(COMMIT);
  });
});
