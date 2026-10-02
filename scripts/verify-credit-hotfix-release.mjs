import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { waitForExpectedRelease } from './verify-deployed-release.mjs';

export const CREDIT_HOTFIX = Object.freeze({
    case: 'credit-20261001', repository: 'Noahstark23/nortex.20',
    candidate: '6c6d1d2608316bacc55bc9a9ce6b7b394f520dc8',
    base: 'e315c5a8c796f2bcbb285dc6fe4ef3699264766a',
    initialProductionBase: 'bd67bdb3a5e9a1c9209adec5ffcbc8f015d527a4',
    tree: '5deba66796c14e069e2c7db376e2650edcf00ed7',
    baseTree: '883331c0f27acfae264c1752736a28af5638b012',
    branch: 'codex/hotfix-pos-credit-packaged-20261002',
    recoveryBranch: 'codex/credit-recovery-packaged-20261002',
    stageOrigin: 'https://staging.somosnortex.com', productionOrigin: 'https://somosnortex.com',
    stageAppHash: '18ce89ef7c4909f28286601331102f6770691bfb51925d04b98e531c0d69a8f6',
    productionAppHash: '7995eb46427376f2da54ab6a179e0e18e9d6503aecf304d09b59a9373db7c2b4',
});
const MANIFEST_URL = new URL('../docs/releases/credit-hotfix-20261001.json', import.meta.url);
const FULL_SHA = /^[a-f0-9]{40}$/;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };

export const creditHotfixEnabled = (env) => {
    const value = env.CREDIT_HOTFIX_20261001;
    if (value === 'true') return true;
    if (value === undefined || value === '' || value === 'false') return false;
    fail('HOTFIX_FLAG_INVALID');
};
export const readCreditHotfixManifest = () => {
    let manifest;
    try { manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8')); } catch { fail('HOTFIX_MANIFEST_INVALID'); }
    if (manifest.active !== true || manifest.case !== CREDIT_HOTFIX.case
        || manifest.repository !== CREDIT_HOTFIX.repository
        || manifest.candidate_commit !== CREDIT_HOTFIX.candidate || manifest.base_commit !== CREDIT_HOTFIX.base
        || manifest.candidate_tree !== CREDIT_HOTFIX.tree || manifest.base_tree !== CREDIT_HOTFIX.baseTree
        || manifest.initial_production_base !== CREDIT_HOTFIX.initialProductionBase
        || manifest.branch !== CREDIT_HOTFIX.branch || manifest.recovery_branch !== CREDIT_HOTFIX.recoveryBranch
        || manifest.applications?.staging?.origin !== CREDIT_HOTFIX.stageOrigin
        || manifest.applications?.production?.origin !== CREDIT_HOTFIX.productionOrigin
        || manifest.applications?.staging?.identity_sha256 !== CREDIT_HOTFIX.stageAppHash
        || manifest.applications?.production?.identity_sha256 !== CREDIT_HOTFIX.productionAppHash
        || !Array.isArray(manifest.source_files) || manifest.source_files.length !== 10
        || manifest.patch_sha256 !== 'a5715d6ae54fb07f36a0d4f2edd8059a09651cb258b0e1b669ead47f2550286a') {
        fail('HOTFIX_MANIFEST_INVALID');
    }
    return manifest;
};
export const hotfixAction = env => {
    const action = env.CREDIT_HOTFIX_ACTION || 'promote';
    if (!['promote', 'recover'].includes(action)) fail('HOTFIX_ACTION_INVALID');
    if (!creditHotfixEnabled(env) && action !== 'promote') fail('HOTFIX_MODE_REQUIRED');
    return action;
};
export const hotfixTarget = env => hotfixAction(env) === 'recover' ? CREDIT_HOTFIX.base : CREDIT_HOTFIX.candidate;
export const assessCreditHotfix = env => {
    if (!creditHotfixEnabled(env)) fail('HOTFIX_MODE_REQUIRED');
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') fail('MANUAL_DISPATCH_REQUIRED');
    if (env.GITHUB_REF !== 'refs/heads/main') fail('MAIN_BRANCH_REQUIRED');
    if (env.GITHUB_SERVER_URL !== 'https://github.com') fail('HOTFIX_SERVER_MISMATCH');
    if (env.GITHUB_REPOSITORY !== CREDIT_HOTFIX.repository) fail('HOTFIX_REPOSITORY_MISMATCH');
    if (!FULL_SHA.test(env.GITHUB_SHA || '')) fail('CONTROL_SHA_REQUIRED');
    if (env.CANDIDATE_SHA !== hotfixTarget(env)) fail('HOTFIX_CANDIDATE_MISMATCH');
    readCreditHotfixManifest();
    return hotfixAction(env);
};
export const validHttpsRoot = value => {
    try {
        const authority = typeof value === 'string' ? /^https:\/\/([^/?#\\\s]+)\/?$/.exec(value)?.[1] : null;
        if (!authority || authority.includes('@')) return false;
        const url = new URL(value);
        return url.pathname === '/' && url.protocol === 'https:' && !url.search && !url.hash && !url.username && !url.password;
    } catch { return false; }
};
const runGit = args => execFileSync('git', args, { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
const textGit = (git, args) => git(args).toString('utf8').trim();
export const verifyCreditHotfixGit = ({ env = process.env, git = runGit, readManifest = readCreditHotfixManifest } = {}) => {
    assessCreditHotfix(env);
    const manifest = readManifest();
    try {
        if (textGit(git, ['rev-parse', 'HEAD']) !== env.GITHUB_SHA) fail('CONTROL_CHECKOUT_MISMATCH');
        if (textGit(git, ['status', '--porcelain', '--untracked-files=no'])) fail('CONTROL_CHECKOUT_DIRTY');
        const refs = textGit(git, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main', 'refs/heads/' + CREDIT_HOTFIX.branch]);
        const rows = refs.split('\n').map(line => line.split('\t'));
        if (rows.length !== 2 || rows.some(row => row.length !== 2 || !FULL_SHA.test(row[0]))) fail('HOTFIX_REFS_UNAVAILABLE');
        const refMap = Object.fromEntries(rows.map(([sha, ref]) => [ref, sha]));
        if (refMap['refs/heads/main'] !== env.GITHUB_SHA) fail('MAIN_HEAD_MOVED');
        if (refMap['refs/heads/' + CREDIT_HOTFIX.branch] !== CREDIT_HOTFIX.candidate) fail('HOTFIX_BRANCH_MOVED');
        const commit = textGit(git, ['cat-file', 'commit', CREDIT_HOTFIX.candidate]);
        const header = commit.split('\n\n')[0].split('\n');
        const parents = header.filter(line => line.startsWith('parent '));
        if (parents.length !== 1 || parents[0] !== 'parent ' + CREDIT_HOTFIX.base) fail('HOTFIX_PARENT_MISMATCH');
        if (header[0] !== 'tree ' + CREDIT_HOTFIX.tree
            || textGit(git, ['rev-parse', CREDIT_HOTFIX.base + '^{tree}']) !== CREDIT_HOTFIX.baseTree) fail('HOTFIX_TREE_MISMATCH');
        const paths = git(['diff', '--no-renames', '--name-only', '-z', CREDIT_HOTFIX.base, CREDIT_HOTFIX.candidate]).toString('utf8').split('\0').filter(Boolean).sort();
        const expected = manifest.source_files.map(file => file.path).sort();
        if (JSON.stringify(paths) !== JSON.stringify(expected) || new Set(expected).size !== 10) fail('HOTFIX_SCOPE_MISMATCH');
        for (const file of manifest.source_files) {
            const source = git(['show', CREDIT_HOTFIX.candidate + ':' + file.path]);
            if (sha256(source) !== file.sha256 || source.length !== file.bytes) fail('HOTFIX_SOURCE_MISMATCH');
        }
        const critical = git(['diff', '--name-only', '-z', CREDIT_HOTFIX.base, CREDIT_HOTFIX.candidate, '--',
            'backend', '.github', 'package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml', 'scripts/docker-entrypoint.sh']);
        if (critical.length) fail('HOTFIX_CRITICAL_SCOPE_MISMATCH');
    } catch (error) {
        if (error instanceof Error && /^(HOTFIX_|CONTROL_|MAIN_HEAD_)/.test(error.message)) throw error;
        fail('HOTFIX_GIT_UNAVAILABLE');
    }
    return { manifest, controller: env.GITHUB_SHA, candidate: CREDIT_HOTFIX.candidate, base: CREDIT_HOTFIX.base, target: hotfixTarget(env) };
};
export const verifyCreditHotfixRelease = async ({ env = process.env, phase = env.CREDIT_HOTFIX_PHASE,
    git = runGit, verifyHealth = waitForExpectedRelease, verifyGit = verifyCreditHotfixGit } = {}) => {
    assessCreditHotfix(env);
    const target = hotfixTarget(env);
    if (!['staging', 'production'].includes(phase)) fail('HOTFIX_PHASE_INVALID');
    const enabled = phase === 'staging' ? env.NORTEX_DEPLOY_ENABLED : env.NORTEX_PRODUCTION_DEPLOY_ENABLED;
    if (enabled !== 'true') fail(phase === 'staging' ? 'STAGING_DEPLOY_DISABLED' : 'PRODUCTION_DEPLOY_DISABLED');
    const prefix = phase === 'staging' ? 'STAGE ' : 'PROMOTE ';
    const confirmation = phase === 'staging' ? env.STAGING_CONFIRMATION : env.PRODUCTION_CONFIRMATION;
    if (confirmation !== prefix + target) fail('TYPED_CONFIRMATION_REQUIRED');
    if (phase === 'production' && env.SOLE_OWNER_CONFIRMATION !== 'SOLE_OWNER ' + target) fail('SOLE_OWNER_ACK_REQUIRED');
    if (!validHttpsRoot(env.PROD_URL) || new URL(env.PROD_URL).origin !== CREDIT_HOTFIX.productionOrigin) fail('VALID_PRODUCTION_URL_REQUIRED');
    const result = verifyGit({ env, git });
    // Recuperar no puede exigir que el contenedor averiado esté sano. El gate
    // REST separado exige el recibo confiable de la solicitud C a la misma app.
    if (hotfixAction(env) === 'promote') {
        // Primera promoción parte de B histórico; después de recuperar, de B′.
        // Son dos identidades fijas, nunca un SHA suministrado por el solicitante.
        try { await verifyHealth({ baseUrl: env.PROD_URL, expectedCommit: CREDIT_HOTFIX.initialProductionBase, attempts: 1 }); }
        catch {
            try { await verifyHealth({ baseUrl: env.PROD_URL, expectedCommit: CREDIT_HOTFIX.base, attempts: 1 }); }
            catch { fail('HOTFIX_PRODUCTION_BASE_NOT_VERIFIED'); }
        }
    }
    return result;
};
export const expectedArtifactBinding = (env, environment) => {
    if (!['staging', 'production'].includes(environment)) fail('HOTFIX_PHASE_INVALID');
    const origin = environment === 'staging' ? CREDIT_HOTFIX.stageOrigin : CREDIT_HOTFIX.productionOrigin;
    const application = environment === 'staging' ? CREDIT_HOTFIX.stageAppHash : CREDIT_HOTFIX.productionAppHash;
    if (!validHttpsRoot(env.HOTFIX_APP_URL) || new URL(env.HOTFIX_APP_URL).origin !== origin) fail('HOTFIX_APP_URL_INVALID');
    // El preflight no entra al environment. Para leer evidencia se usa la
    // identidad aprobada del manifiesto; post-environment también se compara
    // la variable real. Nunca se inventa ni transporta su UUID a otro entorno.
    if (env.HOTFIX_APP_UUID && (!/^[a-zA-Z0-9_-]{1,128}$/.test(env.HOTFIX_APP_UUID)
        || sha256(env.HOTFIX_APP_UUID) !== application)) fail('HOTFIX_APP_UUID_MISMATCH');
    return { origin_sha256: sha256(origin), application_sha256: application };
};
export const artifactBinding = (env, environment) => {
    if (!env.HOTFIX_APP_UUID) fail('HOTFIX_APP_UUID_REQUIRED');
    return expectedArtifactBinding(env, environment);
};
export const manifestDigest = () => sha256(readFileSync(MANIFEST_URL));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await verifyCreditHotfixRelease(); console.log('Excepción puntual de crédito validada.'); }
    catch (error) { console.error('Compuerta hotfix cerrada: ' + (error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'HOTFIX_GATE_FAILED')); process.exitCode = 1; }
}
