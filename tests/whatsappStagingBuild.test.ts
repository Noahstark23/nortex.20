// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/build-whatsapp-staging.sh', import.meta.url));
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nortex-staging-build-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const capture = join(root, 'docker-argv');
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$QA_CAPTURE"\nexit "${QA_DOCKER_EXIT:-0}"\n');
  chmodSync(join(bin, 'docker'), 0o755);
  const env = { PATH: `${bin}:/usr/bin:/bin`, QA_CAPTURE: capture, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  return { root, bin, capture, env };
}
function run(f: ReturnType<typeof fixture>, extra = {}) {
  return spawnSync('/bin/sh', [script], { cwd: f.root, env: { ...f.env, ...extra }, encoding: 'utf8' });
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('build de WhatsApp staging con procedencia del checkout', () => {
  it('lee HEAD de un Git real y pasa el argv exacto sin iniciar servicios', () => {
    const f = fixture();
    function git(args: string[]) {
      const result = spawnSync('/usr/bin/git', args, { cwd: f.root, env: f.env, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    }
    git(['init', '--quiet']);
    writeFileSync(join(f.root, 'fixture.txt'), 'checkout sintético');
    git(['add', 'fixture.txt']);
    git(['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
    const commit = git(['rev-parse', 'HEAD']);
    expect(run(f, { SOURCE_COMMIT: 'metadato-obsoleto' }).status).toBe(0);
    expect(readFileSync(f.capture, 'utf8').trimEnd().split('\n')).toEqual([
      'compose', '-f', './docker-compose.yml', '--env-file', '/artifacts/build-time.env',
      '-f', 'docker-compose.whatsapp-staging.yml', '--profile', 'assistant-worker',
      '--profile', 'whatsapp-commerce-worker', 'build', '--build-arg', `NORTEX_BUILD_COMMIT=${commit}`,
      'app', 'assistant-worker', 'whatsapp-commerce-worker',
    ]);
  });
  it('fallo de Git detiene el build antes de Docker', () => {
    const f = fixture();
    expect(run(f).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it.each(['main', '1'.repeat(39), 'A'.repeat(40), 'a'.repeat(41), ''])('rechaza HEAD inválido %s sin invocar Docker', value => {
    const f = fixture();
    writeFileSync(join(f.bin, 'git'), `#!/bin/sh\nprintf '%s\\n' '${value}'\n`);
    chmodSync(join(f.bin, 'git'), 0o755);
    expect(run(f).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('propaga fallo de Docker Compose al sistema de despliegue', () => {
    const f = fixture();
    writeFileSync(join(f.bin, 'git'), `#!/bin/sh\nprintf '%s\\n' '${'a'.repeat(40)}'\n`);
    chmodSync(join(f.bin, 'git'), 0o755);
    expect(run(f, { QA_DOCKER_EXIT: '17' }).status).toBe(17);
  });
});
