// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolveReleaseCommit } from '../backend/lib/releaseIdentity';
import { afterEach, describe, expect, it } from 'vitest';

const script = process.env.QA_BUILD_SCRIPT || fileURLToPath(new URL('../scripts/build-whatsapp-staging.sh', import.meta.url));
const roots: string[] = [];
const COMMIT = '1'.repeat(40);
const STALE = '2'.repeat(40);
const UUID = 'abcdefghijklmnopqrstuvwx';
const managed = (image = `${UUID}_app:${COMMIT}`, other = '') => `services:\n  app:\n    image: ${image}\n${other}`;
const writer = fileURLToPath(new URL('../scripts/write-release-identity.mjs', import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nortex-staging-build-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const capture = join(root, 'docker-argv');
  const configCapture = join(root, 'config-argv');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
case " $* " in
  *' config '*)
    printf '%s\\n' "$@" > "$QA_CONFIG_CAPTURE"
    if [ -n "\${QA_REAL_COMPOSE:-}" ]; then exec "$QA_REAL_COMPOSE" "$@"; fi
    printf '%s\\n' "\${QA_MODEL-services:
  app:
    build:
      context: .}"
    exit "\${QA_CONFIG_EXIT:-0}" ;;
  *' build '*)
    printf '%s\\n' "$@" > "$QA_CAPTURE"
    exit "\${QA_DOCKER_EXIT:-0}" ;;
  *) exit 99 ;;
esac
`);
  symlinkSync('/usr/bin/awk', join(bin, 'awk'));
  chmodSync(join(bin, 'docker'), 0o755);
  const env = { PATH: `${bin}:/usr/bin:/bin`, QA_CAPTURE: capture, QA_CONFIG_CAPTURE: configCapture, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  return { root, bin, capture, configCapture, env };
}
function run(f: ReturnType<typeof fixture>, extra: Record<string, string> = {}, args: string[] = []) {
  return spawnSync('/bin/sh', [script, ...args], { cwd: f.root, env: { ...f.env, ...extra }, encoding: 'utf8' });
}
function repository(f: ReturnType<typeof fixture>, content = 'checkout sintético') {
  function git(args: string[]) {
    const result = spawnSync('/usr/bin/git', args, { cwd: f.root, env: f.env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }
  git(['init', '--quiet']);
  writeFileSync(join(f.root, 'fixture.txt'), content);
  git(['add', 'fixture.txt']);
  git(['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  return git(['rev-parse', 'HEAD']);
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('build de WhatsApp staging con procedencia del checkout', () => {
  it('lee HEAD de un Git real y pasa el argv exacto sin iniciar servicios', () => {
    const f = fixture();
    const commit = repository(f);
    expect(run(f, { SOURCE_COMMIT: 'metadato-obsoleto' }).status).toBe(0);
    expect(readFileSync(f.capture, 'utf8').trimEnd().split('\n')).toEqual([
      'compose', '-f', './docker-compose.yml', '--env-file', '/artifacts/build-time.env',
      '-f', 'docker-compose.whatsapp-staging.yml', '--profile', 'assistant-worker',
      '--profile', 'whatsapp-commerce-worker', 'build', '--build-arg', `NORTEX_BUILD_COMMIT=${commit}`,
      'app', 'assistant-worker', 'whatsapp-commerce-worker',
    ]);
  });
  it('sin Git ni SHA explícito detiene el build antes de Docker', () => {
    const f = fixture();
    expect(run(f).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it.each(['main', '1'.repeat(39), 'A'.repeat(40), 'a'.repeat(41), ''])('rechaza HEAD inválido %s sin invocar Docker', value => {
    const f = fixture();
    mkdirSync(join(f.root, '.git'));
    writeFileSync(join(f.bin, 'git'), `#!/bin/sh\nprintf '%s\\n' '${value}'\n`);
    chmodSync(join(f.bin, 'git'), 0o755);
    expect(run(f).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('propaga fallo de Docker Compose al sistema de despliegue', () => {
    const f = fixture();
    mkdirSync(join(f.root, '.git'));
    writeFileSync(join(f.bin, 'git'), `#!/bin/sh\nprintf '%s\\n' '${'a'.repeat(40)}'\n`);
    chmodSync(join(f.bin, 'git'), 0o755);
    expect(run(f, { QA_DOCKER_EXIT: '17' }).status).toBe(17);
  });
  it('sin .git ni binario Git usa sólo el SHA explícito y conserva los tres servicios', () => {
    const f = fixture();
    const result = run(f, { PATH: f.bin, NORTEX_BUILD_COMMIT: COMMIT, SOURCE_COMMIT: STALE });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(f.capture, 'utf8').trimEnd().split('\n')).toEqual([
      'compose', '-f', './docker-compose.yml', '--env-file', '/artifacts/build-time.env',
      '-f', 'docker-compose.whatsapp-staging.yml', '--profile', 'assistant-worker',
      '--profile', 'whatsapp-commerce-worker', 'build', '--build-arg', `NORTEX_BUILD_COMMIT=${COMMIT}`,
      'app', 'assistant-worker', 'whatsapp-commerce-worker',
    ]);
  });
  it('SHA por argumento pasa al writer real y el marker prevalece sobre metadatos obsoletos', () => {
    const f = fixture();
    expect(run(f, {}, [COMMIT]).status).toBe(0);
    const args = readFileSync(f.capture, 'utf8').trimEnd().split('\n');
    const value = args[args.indexOf('--build-arg') + 1].split('=')[1];
    expect(value).toBe(COMMIT);
    mkdirSync(join(f.root, 'backend'));
    const server = Buffer.from('servidor sintético\r\nñ\n');
    writeFileSync(join(f.root, 'backend/server.ts'), server);
    writeFileSync(join(f.root, '.nortex-release.json'), JSON.stringify({ version: 1, commit: STALE, serverSha256: 'a'.repeat(64) }));
    const written = spawnSync(process.execPath, [writer], { cwd: f.root, env: { NORTEX_BUILD_COMMIT: value }, encoding: 'utf8' });
    expect(written.status, written.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(f.root, '.nortex-release.json'), 'utf8'))).toEqual({
      version: 1, commit: COMMIT, serverSha256: createHash('sha256').update(server).digest('hex'),
    });
    expect(resolveReleaseCommit({ rootDir: f.root, sourceCommit: STALE })).toBe(COMMIT);
  });
  it('SOURCE_COMMIT válido por sí solo no acredita un archivo sin .git', () => {
    const f = fixture();
    expect(run(f, { SOURCE_COMMIT: COMMIT }).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it.each(['main', '1'.repeat(39), 'A'.repeat(40), 'a'.repeat(41), COMMIT + '\n', ''])('rechaza entrada explícita inválida %j antes de Docker', value => {
    const f = fixture();
    const result = run(f, { NORTEX_BUILD_COMMIT: value });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SHA');
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('argumento vacío no cae en una variable de release válida', () => {
    const f = fixture();
    expect(run(f, { NORTEX_BUILD_COMMIT: COMMIT }, ['']).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('argumento y variable contradictorios no invocan Docker', () => {
    const f = fixture();
    const result = run(f, { NORTEX_BUILD_COMMIT: STALE }, [COMMIT]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('coincid');
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('rechaza argumentos adicionales en lugar de ignorarlos', () => {
    const f = fixture();
    expect(run(f, {}, [COMMIT, 'sobrante']).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it.each(['argumento', 'variable'])('Git real rechaza SHA explícito distinto por %s', source => {
    const f = fixture(); const head = repository(f);
    const other = (head[0] === 'a' ? 'b' : 'a') + head.slice(1);
    const result = source === 'argumento' ? run(f, {}, [other]) : run(f, { NORTEX_BUILD_COMMIT: other });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('coincid');
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('Git real acepta ambas entradas sólo si coinciden con HEAD', () => {
    const f = fixture(); const head = repository(f);
    expect(run(f, { NORTEX_BUILD_COMMIT: head }, [head]).status).toBe(0);
    expect(readFileSync(f.capture, 'utf8')).toContain(`NORTEX_BUILD_COMMIT=${head}\n`);
  });
  it('.git corrupto falla cerrado y no usa el SHA explícito como respaldo', () => {
    const f = fixture(); writeFileSync(join(f.root, '.git'), 'gitdir: /no-such-synthetic-repository');
    expect(run(f, { NORTEX_BUILD_COMMIT: COMMIT }).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('no toma por accidente HEAD de un repo ancestro del contexto de archivo', () => {
    const f = fixture(); repository(f);
    const archive = join(f.root, 'archive'); mkdirSync(archive);
    expect(run({ ...f, root: archive }).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });

  it('repo ancestro y .git local vacío no acreditan el contexto aunque SHA coincida', () => {
    const f = fixture(); const head = repository(f);
    const archive = join(f.root, 'archive'); mkdirSync(archive); mkdirSync(join(archive, '.git'));
    expect(run({ ...f, root: archive }, { NORTEX_BUILD_COMMIT: head }).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it.each(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'todos'])('ignora redirección heredada %s y usa metadata local', variable => {
    const f = fixture(); const head = repository(f, 'contexto propio');
    const foreign = fixture(); const other = repository(foreign, 'contexto ajeno');
    expect(other).not.toBe(head);
    const redirected = { GIT_DIR: join(foreign.root, '.git'), GIT_WORK_TREE: foreign.root,
      GIT_COMMON_DIR: join(foreign.root, '.git'), GIT_OBJECT_DIRECTORY: join(foreign.root, '.git/objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(foreign.root, '.git/objects'), GIT_INDEX_FILE: join(foreign.root, '.git/index') };
    const env = variable === 'todos' ? redirected : { [variable]: redirected[variable as keyof typeof redirected] };
    const result = run(f, env);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(f.capture, 'utf8')).toContain(`NORTEX_BUILD_COMMIT=${head}\n`);
    expect(readFileSync(f.capture, 'utf8')).not.toContain(other);
  });
  it('SHA explícito de repo ajeno no se acredita mediante GIT_DIR/GIT_WORK_TREE', () => {
    const f = fixture(); const head = repository(f, 'contexto propio');
    const foreign = fixture(); const other = repository(foreign, 'contexto ajeno');
    expect(other).not.toBe(head);
    const result = run(f, { GIT_DIR: join(foreign.root, '.git'), GIT_WORK_TREE: foreign.root, NORTEX_BUILD_COMMIT: other });
    expect(result.status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('.git local roto no se rescata redirigiendo a otro repositorio', () => {
    const f = fixture(); writeFileSync(join(f.root, '.git'), 'gitdir: /no-such-synthetic-repository');
    const foreign = fixture(); const other = repository(foreign);
    expect(run(f, { GIT_DIR: join(foreign.root, '.git'), GIT_WORK_TREE: foreign.root,
      GIT_COMMON_DIR: join(foreign.root, '.git'), NORTEX_BUILD_COMMIT: other }).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('acepta .git archivo de un worktree real con su metadata local', () => {
    const f = fixture(); const head = repository(f);
    const root = join(f.root, 'linked-worktree');
    const created = spawnSync('/usr/bin/git', ['worktree', 'add', '--quiet', '--detach', root, 'HEAD'], {
      cwd: f.root, env: f.env, encoding: 'utf8',
    });
    expect(created.status, created.stderr).toBe(0);
    expect(readFileSync(join(root, '.git'), 'utf8')).toMatch(/^gitdir: /);
    expect(run({ ...f, root }, { NORTEX_BUILD_COMMIT: head }).status).toBe(0);
    expect(readFileSync(f.capture, 'utf8')).toContain(`NORTEX_BUILD_COMMIT=${head}\n`);
  });

  it('Coolify sin .git ni SHA en shell usa app exacto y conserva argv de build', () => {
    const f = fixture();
    const result = run(f, { PATH: f.bin, QA_MODEL: managed(`docker.io/library/${UUID}_app:${COMMIT}`,
      '  db:\n    image: mysql:8.0\n'), SOURCE_COMMIT: STALE });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(f.capture, 'utf8').trimEnd().split('\n')).toEqual([
      'compose', '-f', './docker-compose.yml', '--env-file', '/artifacts/build-time.env',
      '-f', 'docker-compose.whatsapp-staging.yml', '--profile', 'assistant-worker',
      '--profile', 'whatsapp-commerce-worker', 'build', '--build-arg', `NORTEX_BUILD_COMMIT=${COMMIT}`,
      'app', 'assistant-worker', 'whatsapp-commerce-worker',
    ]);
    expect(readFileSync(f.configCapture, 'utf8').trimEnd().split('\n')).toEqual([
      'compose', '-f', './docker-compose.yml', '-f', 'docker-compose.whatsapp-staging.yml',
      '--profile', 'assistant-worker', '--profile', 'whatsapp-commerce-worker', '--env-file', '/dev/null',
      'config', '--no-interpolate', '--no-env-resolution',
    ]);
    expect(result.stdout + result.stderr).not.toContain(STALE);
  });
  it.each(['main', '', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41), `${COMMIT}@sha256:${'b'.repeat(64)}`])(
    'rechaza tag gestionado malformado %j aunque exista HEAD válido', value => {
      const f = fixture(); repository(f);
      expect(run(f, { QA_MODEL: managed(`${UUID}_app:${value}`) }).status).not.toBe(0);
      expect(() => readFileSync(f.capture)).toThrow();
    });
  it.each(['qa_app', `${UUID}_worker`, `${UUID}_backup_app`, `${UUID.toUpperCase()}_app`,
    `${UUID.slice(1)}_app`, `registry.example.invalid/${UUID}_app`, `${UUID}_app:extra`])(
    'rechaza nombre de imagen ajeno/malformado %j', name => {
      const f = fixture();
      expect(run(f, { QA_MODEL: managed(`${name}:${COMMIT}`) }).status).not.toBe(0);
      expect(() => readFileSync(f.capture)).toThrow();
    });
  it.each(['services:\n  backup:\n    image: '+UUID+'_app:'+COMMIT,
    'services:\n  app:\n    build:\n      context: .\n  backup:\n    image: '+UUID+'_app:'+COMMIT,
    managed(`${UUID}_app:${COMMIT}`, `  backup:\n    image: zyxwvutsrqponmlkjihgfedc_app:${COMMIT}\n`),
    managed(`${UUID}_app:${COMMIT}`, `  backup:\n    image: zyxwvutsrqponmlkjihgfedc_app:${STALE}\n`),
    managed(`${UUID}_app:${COMMIT}`) + managed(), '', 'not canonical YAML',
    'services:\n  app:\n    image: '+UUID+'_app:'+COMMIT+'\n    image: '+UUID+'_app:'+COMMIT])(
    'no acredita otra imagen, ambigüedad o salida inválida (%#)', model => {
      const f = fixture();
      expect(run(f, { QA_MODEL: model, NORTEX_BUILD_COMMIT: COMMIT }).status).not.toBe(0);
      expect(() => readFileSync(f.capture)).toThrow();
    });
  it.each(['HEAD', 'argumento', 'variable'])('etiqueta gestionada contradice %s y bloquea build', source => {
    const f = fixture();
    const env: Record<string, string> = { QA_MODEL: managed() };
    const args: string[] = [];
    if (source === 'HEAD') repository(f);
    if (source === 'argumento') args.push(STALE);
    if (source === 'variable') env.NORTEX_BUILD_COMMIT = STALE;
    expect(run(f, env, args).status).not.toBe(0);
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('concordancia HEAD/etiqueta/ambas entradas explícitas permite build', () => {
    const f = fixture(); const head = repository(f);
    expect(run(f, { QA_MODEL: managed(`${UUID}_app:${head}`), NORTEX_BUILD_COMMIT: head }, [head]).status).toBe(0);
    expect(readFileSync(f.capture, 'utf8')).toContain(`NORTEX_BUILD_COMMIT=${head}\n`);
  });
  it('Git corrupto no recurre a etiqueta gestionada válida', () => {
    const f = fixture(); mkdirSync(join(f.root, '.git'));
    expect(run(f, { QA_MODEL: managed() }).status).not.toBe(0);
    expect(() => readFileSync(f.configCapture)).toThrow();
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('propaga fallo de consulta Compose, sin build ni configuración en logs', () => {
    const f = fixture();
    const result = run(f, { QA_MODEL: managed()+'\n# synthetic-private-sentinel', QA_CONFIG_EXIT: '23' });
    expect(result.status).toBe(23);
    expect(result.stdout+result.stderr).not.toContain('synthetic-private-sentinel');
    expect(() => readFileSync(f.capture)).toThrow();
  });
  it('tag sin .git llega al writer real y health verifica los bytes, no SOURCE_COMMIT', () => {
    const f = fixture();
    expect(run(f, { QA_MODEL: managed(), SOURCE_COMMIT: STALE }).status).toBe(0);
    const args = readFileSync(f.capture, 'utf8').trimEnd().split('\n');
    const value = args[args.indexOf('--build-arg')+1].split('=')[1];
    mkdirSync(join(f.root, 'backend'));
    const server = Buffer.from('servidor sintético\r\nñ\n');
    writeFileSync(join(f.root, 'backend/server.ts'), server);
    const result = spawnSync(process.execPath, [writer], { cwd: f.root, env: { NORTEX_BUILD_COMMIT: value }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(resolveReleaseCommit({ rootDir: f.root, sourceCommit: STALE })).toBe(COMMIT);
    expect(JSON.parse(readFileSync(join(f.root, '.nortex-release.json'), 'utf8'))).toEqual({
      version: 1, commit: COMMIT, serverSha256: createHash('sha256').update(server).digest('hex'),
    });
    writeFileSync(join(f.root, 'backend/server.ts'), 'bytes alterados');
    expect(resolveReleaseCommit({ rootDir: f.root, sourceCommit: COMMIT })).toBeNull();
  });

});
