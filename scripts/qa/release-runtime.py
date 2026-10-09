"""Real candidate CMD and migration rehearsal; Docker resources are synthetic only."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--evidence', required=True)
parser.add_argument('--image', help='Reuse an image sealed for the current exact Git commit')
args = parser.parse_args()
E = Path(args.evidence).resolve()
E.mkdir(parents=True, exist_ok=True)

def docker(parts, **kwargs):
    return subprocess.check_output(['docker', *parts], text=True, stderr=subprocess.PIPE, **kwargs).strip()

_BUILD_DIAGNOSTICS = {
    'unclassified': '[docker build] cause unclassified; inspect image-build.log',
    'unavailable': '[docker build] diagnostic unavailable; build failure preserved',
    'timeout': '[docker build] transport timeout reported',
    'dns': '[docker build] DNS resolution failure reported',
    'registry_429': '[docker build] registry HTTP 429 reported',
    'npm_install': '[docker build] npm install step failed',
    'frontend': '[docker build] frontend build step failed',
    'seal': '[docker build] image seal step failed',
}

def _build_diagnostic_kind(path):
    # Only classify bounded BuildKit error records. Never return source text.
    with path.open('rb') as log:
        log.seek(0, os.SEEK_END)
        log.seek(max(0, log.tell() - 65536))
        tail = log.read(65536).decode('utf-8', errors='replace')
    signals = set()
    for line in tail.splitlines():
        if not re.match(r'^(?:ERROR: failed to solve:|#\d+ ERROR:)', line):
            continue
        line = line.lower()
        if any(marker in line for marker in ('i/o timeout', 'tls handshake timeout', 'context deadline exceeded')):
            signals.add('timeout')
        if any(marker in line for marker in ('no such host', 'temporary failure in name resolution')):
            signals.add('dns')
        if '429 too many requests' in line and any(marker in line for marker in ('failed to authorize', 'failed to fetch oauth token', 'failed to resolve source metadata')):
            signals.add('registry_429')
        if 'process "/bin/sh -c ' in line and 'did not complete successfully' in line:
            for marker, kind in [('npm ci', 'npm_install'), ('npm run build:seo', 'frontend'), ('node scripts/nortex-seal-image.mjs', 'seal')]:
                if marker in line:
                    signals.add(kind)
    return next(iter(signals)) if len(signals) == 1 else 'unclassified'

sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
prefix = 'nortex-runtime-' + str(os.getpid()) + '-' + str(time.time_ns())
label = 'nortex.qa.runtime=' + prefix
image = args.image or prefix + ':' + sha
net, dbname, volume = prefix + '-net', prefix + '-db', prefix + '-mysql'
created = []
checks = []

def sql(query, database=None):
    return docker(['exec', '-i', dbname, 'mysql', '--protocol=TCP', '-h127.0.0.1', '-uroot', '--batch', '--raw', '--skip-column-names', *([database] if database else [])], input=query)

queries = json.loads((ROOT / 'scripts/qa/credit-image/fixtures/schema-fingerprint-queries.json').read_text())

def fingerprint(database):
    metadata = [[line.split('\t') for line in sql(query, database).splitlines()] for query in queries]
    return hashlib.sha256(json.dumps(metadata, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def mutation_count(start, ddl_only=False):
    verbs = 'ALTER|CREATE|DROP|TRUNCATE|RENAME' + ('' if ddl_only else '|INSERT|UPDATE|DELETE|REPLACE')
    return int(sql("SELECT COUNT(*) FROM mysql.general_log WHERE event_time > '" + start + "' AND command_type='Query' AND argument REGEXP '^[[:space:]]*(" + verbs + ")[[:space:]]'"))

def prepare_dispatch_checks():
    # Execute the actual shell wrapper in a disposable filesystem. The Docker
    # test double checks dispatch/fail-closed order; real Compose run is below.
    with tempfile.TemporaryDirectory(prefix='nortex-prepare-', dir=E) as folder:
        f = Path(folder)
        (f / 'deploy/nortex').mkdir(parents=True)
        (f / 'docker-compose.yml').write_text('services: {}\n')
        for profile in ['staging', 'production']:
            (f / ('deploy/nortex/' + profile + '.yml')).write_text('services: {}\n')
        (f / 'Dockerfile').write_text('ARG NORTEX_BUILD_COMMIT\n')
        (f / 'build-time.env').write_text('# synthetic only\n')
        mock = f / 'docker'
        mock.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> /qa/calls.log
test -f /qa/.env || exit 31
test "$(stat -c %a /qa/.env)" = 600 || exit 32
case "$*" in
  *"config --images app") printf '%s_app:%s\\n' "$QA_PROJECT" "$QA_SHA" ;;
  *" build "*) exit "$QA_BUILD_STATUS" ;;
  *" run "*) exit "$QA_GATE_STATUS" ;;
esac
''')
        mock.chmod(0o755)
        for profile, project in [('staging', 'jxzjinox4xrszsr2giwjxaky'), ('production', 'loksow84gw0wccs8ookkosw8')]:
            for build, gate, existing in [(0, 0, False), (7, 0, False), (0, 9, False), (0, 0, True)]:
                (f / 'calls.log').write_text('')
                if existing:
                    (f / '.env').write_text('# existing synthetic environment, preserve bytes\n')
                    (f / '.env').chmod(0o600)
                proc = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '-v', folder + ':/qa', '-v', str(f / 'build-time.env') + ':/artifacts/build-time.env:ro', '-v', str(ROOT / 'scripts/nortex-release.sh') + ':/wrapper.sh:ro', '-w', '/qa', '-e', 'PATH=/qa:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '-e', 'QA_PROJECT=' + project, '-e', 'QA_SHA=' + sha, '-e', 'QA_BUILD_STATUS=' + str(build), '-e', 'QA_GATE_STATUS=' + str(gate), 'alpine:3.22', 'sh', '/wrapper.sh', profile, 'prepare'], text=True, capture_output=True)
                assert proc.returncode == (build or gate), proc.stderr
                if existing:
                    assert (f / '.env').read_text() == '# existing synthetic environment, preserve bytes\n'
                    (f / '.env').unlink()
                else:
                    assert not (f / '.env').exists(), 'temporary environment file not cleaned'
                calls = (f / 'calls.log').read_text().splitlines()
                builds = [i for i, call in enumerate(calls) if ' build ' in call]
                runs = [i for i, call in enumerate(calls) if ' run ' in call]
                assert len(builds) == 1 and not any(' up ' in call or ' down ' in call or ' stop ' in call for call in calls)
                assert len(runs) == (0 if build else 1)
                if runs:
                    assert builds[0] < runs[0]
                    assert calls[runs[0]].endswith('run --rm --no-deps --pull never -T --label traefik.enable=false --entrypoint node app scripts/nortex-schema-gate.mjs')
                checks.append({'check': 'prepare dispatch', 'profile': profile, 'buildExit': build, 'gateExit': gate, 'existingEnvPreserved': existing, 'status': 'PASS'})

try:
    docker(['pull', 'mysql:8.0.43'])
    docker(['pull', 'alpine:3.22'])
    prepare_dispatch_checks()
    if not args.image:
        (ROOT / '.nortex-build-source.json').write_text(json.dumps({'version': 1, 'commit': sha}) + '\n')
        try:
            with (E / 'image-build.log').open('w') as log:
                subprocess.run(['docker', 'build', '-t', image, str(ROOT)], stdout=log, stderr=subprocess.STDOUT, check=True)
        except subprocess.CalledProcessError:
            try:
                diagnostic = _BUILD_DIAGNOSTICS[_build_diagnostic_kind(E / 'image-build.log')]
            except BaseException:
                diagnostic = '[docker build] diagnostic unavailable; build failure preserved'
            try:
                print(diagnostic, flush=True)
            except BaseException:
                pass
            raise
    receipt = json.loads(docker(['run', '--rm', '--network', 'none', '--entrypoint', 'cat', image, '/app/deploy/nortex/image-receipt.json']))
    assert receipt['previousCommit'] == sha
    identity = json.loads(docker(['image', 'inspect', '--format', '{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"cmd":{{json .Config.Cmd}}}', image]))
    assert identity['cmd'] == ['sh', 'scripts/nortex-start.sh']
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        assert identity['os'] == 'linux' and identity['arch'] == 'amd64'
    docker(['network', 'create', '--internal', '--label', label, net]); created.append(('network', net))
    docker(['volume', 'create', '--label', label, volume]); created.append(('volume', volume))
    docker(['run', '-d', '--name', dbname, '--label', label, '--network', net, '--network-alias', 'db', '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/mysql', '-e', 'MYSQL_ALLOW_EMPTY_PASSWORD=yes', 'mysql:8.0.43', '--general-log=1', '--log-output=TABLE']); created.append(('container', dbname))
    for attempt in range(120):
        try:
            if sql('SELECT 1') == '1': break
        except subprocess.CalledProcessError: pass
        time.sleep(.5)
    else: raise RuntimeError('Synthetic MySQL readiness timeout')
    uuid = sql('SELECT @@server_uuid')
    for profile in ['staging', 'production']:
        database = 'nortex_runtime_' + profile
        sql('CREATE DATABASE `' + database + '`')
        fixture = ROOT / ('scripts/qa/credit-image/fixtures/' + profile + '-baseline.sql')
        sql(fixture.read_text(), database)
        contract = receipt['contracts'][profile]
        if profile == 'staging': sql((fixture.parent / 'wa-expansion.sql').read_text(), database)
        values = {'DATABASE_URL': 'mysql://root@db:3306/' + database, 'NORTEX_ROLLBACK_DATABASE': database, 'NORTEX_ROLLBACK_MYSQL_UUID': uuid, 'NORTEX_ROLLBACK_CONFIRMATION': 'PRESERVE_SCHEMA ' + sha + ' ' + database, 'NORTEX_SCHEMA_PROFILE': profile, 'SOURCE_COMMIT': sha, 'JWT_SECRET': 'runtime-ci-synthetic-only-not-a-real-key', 'NORTEX_ASSISTANT_ENABLED': 'false', 'NODE_ENV': 'production', 'PORT': '3000'}
        envargs = [part for k, v in values.items() for part in ['-e', k + '=' + v]]
        if profile == 'production':
            assert fingerprint(database) == contract['provenance']['beforeSchemaFingerprintSha256']
            start = sql('SELECT NOW(6)')
            blocked = subprocess.run(['docker', 'run', '--rm', '--network', net, *envargs, '--entrypoint', 'node', image, 'scripts/nortex-schema-gate.mjs'], text=True, capture_output=True, timeout=150)
            assert blocked.returncode != 0 and blocked.stderr.strip() == 'ROLLBACK_EXPANSION_MISSING', blocked.stderr
            assert mutation_count(start) == 0
            checks.append({'check': 'old production schema rejected', 'mutations': 0, 'status': 'PASS'})
            for path, expected in contract['provenance']['migrationFiles'].items():
                migration = ROOT / path
                assert hashlib.sha256(migration.read_bytes()).hexdigest() == expected
                sql(migration.read_text(), database)
        assert fingerprint(database) == contract['schemaFingerprintSha256']
        # Run Compose's exact one-off command beside a running sentinel. It
        # must not recreate/start dependencies, publish ports or execute app CMD.
        sentinel = prefix + '-live-' + profile
        docker(['run', '-d', '--name', sentinel, '--label', label, '--network', net, 'alpine:3.22', 'sleep', '600']); created.append(('container', sentinel))
        sentinel_id = docker(['inspect', '--format', '{{.Id}}', sentinel])
        compose = E / (profile + '-synthetic-compose.json')
        compose.write_text(json.dumps({'services': {'db': {'image': 'mysql:8.0.43'}, 'app': {'image': image, 'environment': values, 'depends_on': ['db']}}, 'networks': {'default': {'external': True, 'name': net}}}))
        command = ['docker', 'compose', '-p', prefix + '-' + profile, '-f', str(compose), 'run', '--rm', '--no-deps', '--pull', 'never', '-T', '--label', 'traefik.enable=false', '--entrypoint', 'node', 'app', 'scripts/nortex-schema-gate.mjs']
        start = sql('SELECT NOW(6)')
        gate = subprocess.run(command, capture_output=True, text=True, timeout=150)
        assert gate.returncode == 0, gate.stderr
        assert json.loads(gate.stdout)['ddlStatements'] == 0 and mutation_count(start) == 0
        assert docker(['inspect', '--format', '{{.Id}} {{.State.Running}}', sentinel]) == sentinel_id + ' true'
        assert docker(['compose', '-p', prefix + '-' + profile, '-f', str(compose), 'ps', '-aq', 'db']) == ''
        # Same guard must fail on a stale runtime SHA without touching the live container.
        stale = subprocess.run(command[:-2] + ['-e', 'SOURCE_COMMIT=' + 'f' * 40, *command[-2:]], capture_output=True, text=True, timeout=150)
        assert stale.returncode != 0 and 'ROLLBACK_SOURCE_COMMIT_MISMATCH' in stale.stderr
        assert mutation_count(start) == 0
        assert docker(['inspect', '--format', '{{.Id}} {{.State.Running}}', sentinel]) == sentinel_id + ' true'
        checks.append({'check': 'Compose pre-cut gate and stale SHA rejection', 'profile': profile, 'liveContainerPreserved': True, 'mutations': 0, 'status': 'PASS'})
        app = prefix + '-app-' + profile
        start = sql('SELECT NOW(6)')
        docker(['run', '-d', '--name', app, '--label', label, '--network', net, *envargs, image]); created.append(('container', app))
        health = None
        for attempt in range(100):
            try:
                health = json.loads(docker(['exec', app, 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify({body:await r.json(),cacheControl:r.headers.get('cache-control')}))}).catch(()=>process.exit(1))"]))
                break
            except (subprocess.CalledProcessError, json.JSONDecodeError): time.sleep(.5)
        (E / (profile + '-startup.log')).write_text(docker(['logs', app]) + '\n')
        assert health and health['body']['commit'] == sha and health['body']['db'] == 'up'
        assert 'no-store' in health['cacheControl'] and mutation_count(start, ddl_only=True) == 0
        assert fingerprint(database) == contract['schemaFingerprintSha256']
        checks.append({'check': 'actual CMD health', 'profile': profile, 'health': health, 'ddl': 0, 'status': 'PASS'})
        docker(['stop', app])
    (E / 'runtime.json').write_text(json.dumps({'status': 'PASS', 'sha': sha, 'image': identity, 'syntheticOnly': True, 'checks': checks}, indent=2) + '\n')
    print('PASS: prepare fail-closed, real Compose guard, production migration and both candidate CMDs.', flush=True)
finally:
    for kind, name in reversed(created):
        item = json.loads(docker([kind, 'inspect', name]))[0]
        labels = item['Config']['Labels'] if kind == 'container' else item['Labels']
        assert labels.get('nortex.qa.runtime') == prefix
        if kind == 'container': docker(['stop', name])
        docker([kind, 'rm', name])
