"""Prepare disposable native AMD64 inputs for the existing synthetic runtime test."""
from pathlib import Path
import hashlib, json, os, platform, re, subprocess, sys, time

D = ['docker', '--host', 'unix:///var/run/docker.sock']
HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ['NORTEX_IMAGE_QA_ROOT']).resolve()
assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('RUNNER_ARCH') == 'X64' and platform.system() == 'Linux' and platform.machine() == 'x86_64'
assert ROOT.parent == Path(os.environ['RUNNER_TEMP']).resolve()
E = ROOT / 'evidence'

def docker(args, **kwargs):
    return subprocess.check_output(D + args, text=True, stderr=subprocess.PIPE, **kwargs).strip()

def sql(cfg, query, database=None):
    return docker(['exec', '-i', cfg['container'], 'mysql', '-uroot', '--batch', '--raw', '--skip-column-names'] + ([database] if database else []), input=query)

def cleanup():
    path = E / 'synthetic-db.json'
    if not path.exists():
        return
    cfg = json.loads(path.read_text())
    label_key, label_value = cfg['label'].split('=', 1)
    for kind, names in [('container', [cfg['appContainer'], cfg['container']]), ('volume', [cfg['privateVolume'], cfg['volume']]), ('network', [cfg['network']])]:
        for name in names:
            result = subprocess.run(D + [kind, 'inspect', name], text=True, capture_output=True)
            if result.returncode:
                continue
            item = json.loads(result.stdout)[0]
            labels = item.get('Config', {}).get('Labels', {}) if kind == 'container' else item.get('Labels', {})
            assert labels.get(label_key) == label_value
            subprocess.run(D + [kind, 'rm'] + (['-f'] if kind == 'container' else []) + [name], check=True)

if len(sys.argv) == 2 and sys.argv[1] == 'cleanup':
    cleanup()
    sys.exit(0)
assert len(sys.argv) == 1
ROOT.mkdir()  # Never reuse an earlier test's volumes or evidence.
E.mkdir()
daemon = docker(['info', '--format', '{{.OSType}}/{{.Architecture}}'])
assert daemon in ['linux/x86_64', 'linux/amd64'], daemon
manifest = json.loads(Path('docs/releases/credit-hotfix-20261001.json').read_text())
ids = {'Bprime': manifest['base_commit'], 'Cprime': manifest['candidate_commit']}
images = {}
for key, folder in [('Bprime', 'integration'), ('Cprime', 'candidate-c')]:
    sha = ids[key]
    assert re.fullmatch('[a-f0-9]{40}', sha)
    # Each build is bound to an exact reviewed Git object, never a moving ref.
    build_env = {**os.environ, 'NORTEX_BUILD_COMMIT': sha}
    actual = subprocess.check_output(['git', 'rev-parse', sha + '^{commit}'], text=True).strip()
    assert actual == build_env['NORTEX_BUILD_COMMIT']
    expected_tree = manifest['base_tree' if key == 'Bprime' else 'candidate_tree']
    assert subprocess.check_output(['git', 'rev-parse', sha + '^{tree}'], text=True).strip() == expected_tree
    source = ROOT / folder
    source.mkdir()
    # git archive excludes checkout credentials, ignored files and local edits.
    archive = subprocess.run(['git', 'archive', sha], stdout=subprocess.PIPE, check=True).stdout
    subprocess.run(['tar', '-xf', '-', '-C', str(source)], input=archive, check=True)
    (source / '.nortex-build-source.json').write_text(json.dumps({'version': 1, 'commit': build_env['NORTEX_BUILD_COMMIT']}) + '\n')
    images[key] = 'nortex-credit-image-' + key.lower() + ':' + sha
    with (E / (key + '-build.log')).open('w') as log:
        subprocess.run(D + ['build', '--platform', 'linux/amd64', '-f', str(source / 'Dockerfile'), '-t', images[key], str(source)], env=build_env, stdout=log, stderr=subprocess.STDOUT, check=True)
    assert docker(['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', images[key]]) == 'linux/amd64'
    receipt = json.loads(docker(['run', '--rm', '--network', 'none', '--entrypoint', 'cat', images[key], '/app/deploy/nortex/image-receipt.json']))
    assert receipt['previousCommit'] == sha
(E / 'candidate-identities.json').write_text(json.dumps(ids, indent=2) + '\n')
run = os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT']
assert re.fullmatch('[0-9]+-[0-9]+', run)
prefix = 'nortex-credit-image-' + run
cfg = {'container': prefix + '-db', 'appContainer': prefix + '-app', 'network': prefix + '-net', 'volume': prefix + '-mysql', 'privateVolume': prefix + '-private', 'label': 'nortex.ci.image=' + run, 'images': images, 'syntheticOnly': True}
(E / 'synthetic-db.json').write_text(json.dumps(cfg, indent=2) + '\n')
docker(['pull', 'mysql:8.0.43'])
docker(['pull', 'alpine:3.22'])
docker(['network', 'create', '--internal', '--label', cfg['label'], cfg['network']])
docker(['volume', 'create', '--label', cfg['label'], cfg['volume']])
cfg['containerId'] = docker(['run', '-d', '--name', cfg['container'], '--label', cfg['label'], '--network', cfg['network'], '--network-alias', 'db', '--mount', 'type=volume,src=' + cfg['volume'] + ',dst=/var/lib/mysql', '-e', 'MYSQL_ALLOW_EMPTY_PASSWORD=yes', 'mysql:8.0.43', '--general-log=1', '--log-output=TABLE'])
for attempt in range(120):
    try:
        if sql(cfg, 'SELECT 1') == '1':
            break
    except subprocess.CalledProcessError:
        pass
    time.sleep(.5)
else:
    raise RuntimeError('Disposable CI database readiness timeout')
cfg['uuid'] = sql(cfg, 'SELECT @@server_uuid')
queries = json.loads((HERE / 'fixtures/schema-fingerprint-queries.json').read_text())
proofs = []
for profile in ['staging', 'production']:
    database = 'nortex_prime_' + profile
    sql(cfg, 'CREATE DATABASE `' + database + '`')
    sql(cfg, (HERE / ('fixtures/' + profile + '-baseline.sql')).read_text(), database)
    if profile == 'staging':
        sql(cfg, (HERE / 'fixtures/wa-expansion.sql').read_text(), database)
    metadata = [[line.split('\t') for line in sql(cfg, query, database).splitlines()] for query in queries]
    fingerprint = hashlib.sha256(json.dumps(metadata, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    contract = json.loads((ROOT / ('integration/deploy/nortex/' + profile + '.contract.json')).read_text())
    assert fingerprint == contract['schemaFingerprintSha256']
    proofs.append({'profile': profile, 'fingerprint': fingerprint, 'tables': len(metadata[0])})
cfg['proofs'] = proofs
(E / 'synthetic-db.json').write_text(json.dumps(cfg, indent=2) + '\n')
(E / 'runner.json').write_text(json.dumps({'runnerArch': os.environ['RUNNER_ARCH'], 'uname': platform.machine(), 'docker': daemon, 'controller': os.environ['GITHUB_SHA'], 'candidates': ids}, indent=2) + '\n')
print('Exact native AMD64 images and disposable schema fixtures ready.', flush=True)
