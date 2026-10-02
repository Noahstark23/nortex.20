// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import { assessProductionCandidate, authorizeProductionRelease } from '../scripts/authorize-production-release.mjs';
import {
    CREDIT_HOTFIX as H, assessCreditHotfix, artifactBinding, creditHotfixEnabled,
    expectedArtifactBinding, hotfixAction, hotfixTarget, manifestDigest, readCreditHotfixManifest,
    sha256, verifyCreditHotfixGit, verifyCreditHotfixRelease,
} from '../scripts/verify-credit-hotfix-release.mjs';
import {
    assessHotfixEvidence, decodeEvidenceZip, prepareHotfixReleaseEvidence,
    recordHotfixEvidence, verifyHotfixCi,
} from '../scripts/verify-credit-hotfix-run-evidence.mjs';

const M = 'a'.repeat(40);
const env = {
    CREDIT_HOTFIX_20261001: 'true', CREDIT_HOTFIX_ACTION: 'promote', CREDIT_HOTFIX_PHASE: 'production',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: M,
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: H.repository,
    CANDIDATE_SHA: H.candidate, PROD_URL: H.productionOrigin, STAGING_URL: H.stageOrigin,
    HOTFIX_APP_URL: H.stageOrigin, NORTEX_DEPLOY_ENABLED: 'true', NORTEX_PRODUCTION_DEPLOY_ENABLED: 'true',
    STAGING_CONFIRMATION: 'STAGE ' + H.candidate,
    PRODUCTION_CONFIRMATION: 'PROMOTE ' + H.candidate, SOLE_OWNER_CONFIRMATION: 'SOLE_OWNER ' + H.candidate,
};
const recover = { ...env, CREDIT_HOTFIX_ACTION: 'recover', CANDIDATE_SHA: H.base,
    STAGING_CONFIRMATION: 'STAGE ' + H.base, PRODUCTION_CONFIRMATION: 'PROMOTE ' + H.base, SOLE_OWNER_CONFIRMATION: 'SOLE_OWNER ' + H.base };
const temporary: string[] = [];
const temp = () => { const p = mkdtempSync(path.join(tmpdir(), 'credit-control-')); temporary.push(p); return p; };
afterEach(() => { temporary.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
const contextPath = () => path.join(temp(), 'context.json');
// Fuentes sintéticas independientes: CI usa checkout superficial. La comprobación
// adicional de los objetos C/B reales se conserva en la evidencia local del release.
const fixtureSources = new Map<string, Buffer>(readCreditHotfixManifest().source_files.map(file => [file.path, Buffer.from('qa-source:' + file.path)]));
const fixtureManifest = { ...readCreditHotfixManifest(), source_files: [...fixtureSources].map(([file, source]) => ({ path: file, bytes: source.length, sha256: sha256(source) })) };
const verifyFixtureGit = (options: any) => verifyCreditHotfixGit({ ...options, readManifest: () => fixtureManifest });
const fixtureGit = (mutate?: (args: string[], result: Buffer) => Buffer) => (args: string[]) => {
    let result: Buffer;
    if (args[0] === 'ls-remote') result = Buffer.from(M + '\trefs/heads/main\n' + H.candidate + '\trefs/heads/' + H.branch + '\n');
    else if (args.join(' ') === 'rev-parse HEAD') result = Buffer.from(M);
    else if (args[0] === 'status') result = Buffer.from('');
    else if (args[0] === 'cat-file') result = Buffer.from('tree ' + H.tree + '\nparent ' + H.base + '\n\nqa\n');
    else if (args.join(' ') === 'rev-parse ' + H.base + '^{tree}') result = Buffer.from(H.baseTree);
    else if (args[0] === 'diff' && args.includes('--no-renames')) result = Buffer.from([...fixtureSources.keys()].join('\0') + '\0');
    else if (args[0] === 'diff') result = Buffer.alloc(0);
    else if (args[0] === 'show' && fixtureSources.has(args[1].slice(H.candidate.length + 1))) result = fixtureSources.get(args[1].slice(H.candidate.length + 1))!;
    else throw new Error('unexpected synthetic Git query');
    return Buffer.from(mutate ? mutate(args, result) : result);
};

function zipEvidence(value: any, method = 0) {
    // Escritor independiente (stdlib Python), no copiar el parser/CRC de la compuerta.
    return execFileSync('python3', ['-c',
        "import sys,io,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w',compression=int(sys.argv[1])); z.writestr('evidence.json',sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())", String(method)],
        { input: JSON.stringify(value), maxBuffer: 131072 });
}
function run(id: number, environment = 'staging', conclusion = 'success') {
    return { id, run_attempt: 1, repository: { full_name: H.repository }, head_repository: { full_name: H.repository },
        event: 'workflow_dispatch', head_branch: 'main', head_sha: M, path: '.github/workflows/release-' + environment + '.yml',
        status: 'completed', conclusion, created_at: new Date(id * 100000).toISOString() };
}
function evidence(r: any, target: string = H.candidate, phase = 'healthy', links: any = {}) {
    const environment = r.path.includes('production') ? 'production' : 'staging';
    const bound = { HOTFIX_APP_URL: environment === 'staging' ? H.stageOrigin : H.productionOrigin };
    return { version: 1, case: H.case, phase, environment, action: target === H.base ? 'recover' : 'promote', target,
        candidate: H.candidate, base: H.base, controller: M, manifest_digest: manifestDigest(), run_id: r.id, run_attempt: 1,
        binding: expectedArtifactBinding(bound, environment), previous_run_id: null, recovery_run_id: null, ...links };
}
function releaseJobs(r: any) {
    if (r.preflightFailed) return { data: { jobs: [{ run_id: r.id, head_sha: r.head_sha, run_attempt: r.run_attempt,
        status: 'completed', conclusion: 'failure', name: 'preflight', steps: [] }] } };
    const production = r.path.includes('production');
    return { data: { jobs: [{ run_id: r.id, head_sha: r.head_sha, run_attempt: r.run_attempt,
        status: r.status, conclusion: r.conclusion, name: production ? 'deploy-production' : 'deploy-staging', steps: [
        { name: production ? 'Desplegar PROD (webhook de Coolify)' : 'Desplegar STAGING (webhook de Coolify)', conclusion: 'success' },
        { name: production ? 'Verificar PROD sano y en el candidato esperado' : 'Verificar STAGING sano y en el candidato esperado', conclusion: r.conclusion },
        { name: 'Conservar evidencia requested', conclusion: 'success' },
        { name: 'Conservar evidencia healthy', conclusion: r.conclusion },
    ] }] } };
}
function client(records: { run: any; values: any[]; attempts?: any[] }[] = []) {
    const ci = [
        { sha: M, branch: 'main', event: 'push' },
        { sha: H.candidate, branch: H.branch, event: 'workflow_dispatch' },
        { sha: H.base, branch: 'main', event: 'push' },
    ].map((x, i) => ({ ...run(900 + i), head_sha: x.sha, head_branch: x.branch, event: x.event, path: '.github/workflows/ci.yml' }));
    const artifacts = new Map<number, Buffer>(); let nextArtifact = 1000;
    const perRun = new Map<number, any[]>();
    for (const record of records) perRun.set(record.run.id, record.values.map(value => {
        const bytes = zipEvidence(value); const id = nextArtifact++; artifacts.set(id, bytes);
        return { id, name: 'credit-hotfix-' + value.environment + '-' + (value.phase === 'requested' ? 'attempt' : 'health'),
            size_in_bytes: bytes.length, expired: false, digest: 'sha256:' + sha256(bytes),
            workflow_run: { id: record.run.id, head_sha: M, head_branch: 'main' } };
    }));
    const actions = {
        listWorkflowRuns: vi.fn(async (query: any) => ({ data: { workflow_runs: [...ci, ...records.map(x => x.run)]
            .filter(r => r.path.endsWith('/' + query.workflow_id) && r.head_sha === query.head_sha && r.head_branch === query.branch && r.event === query.event) } })),
        listJobsForWorkflowRun: vi.fn(async ({ run_id }: any) => {
            if (ci.some(r => r.id === run_id)) return { data: { jobs: ['verify', 'integration-required', 'deploy-schema-smoke', 'backup-restore-smoke'].map(name => ({ name, status: 'completed', conclusion: 'success' })) } };
            return releaseJobs(records.find(x => x.run.id === run_id)!.run);
        }),
        getWorkflowRunAttempt: vi.fn(async ({ run_id, attempt_number }: any) => {
            const record = records.find(x => x.run.id === run_id);
            return { data: (record?.attempts || [record?.run]).find(r => r?.run_attempt === attempt_number) };
        }),
        listJobsForWorkflowRunAttempt: vi.fn(async ({ run_id, attempt_number }: any) => {
            const record = records.find(x => x.run.id === run_id);
            const attempt = (record?.attempts || [record?.run]).find(r => r?.run_attempt === attempt_number);
            if (!attempt) throw new Error('unknown attempt');
            return releaseJobs(attempt);
        }),
        listWorkflowRunArtifacts: vi.fn(async ({ run_id }: any) => ({ data: { artifacts: perRun.get(run_id) || [] } })),
        downloadArtifact: vi.fn(async ({ artifact_id }: any) => ({ data: artifacts.get(artifact_id) })),
        getWorkflowRun: vi.fn(async ({ run_id }: any) => ({ data: records.find(x => x.run.id === run_id)?.run })),
    };
    return { rest: { actions }, ci, artifacts, perRun };
}
const chain = () => {
    const first = run(10), restored = run(20), final = run(30);
    return [
        { run: first, values: [evidence(first, H.candidate, 'requested'), evidence(first)] },
        { run: restored, values: [evidence(restored, H.base, 'requested', { previous_run_id: 10 }), evidence(restored, H.base, 'healthy', { previous_run_id: 10 })] },
        { run: final, values: [evidence(final, H.candidate, 'requested', { recovery_run_id: 20 }), evidence(final, H.candidate, 'healthy', { recovery_run_id: 20 })] },
    ];
};

describe('excepción puntual: identidad, Git y fallo cerrado', () => {
    it.each([undefined, '', 'false'])('la excepción está apagada por defecto (%s)', value => {
        expect(creditHotfixEnabled({ CREDIT_HOTFIX_20261001: value })).toBe(false);
        expect(assessProductionCandidate({ ...env, CREDIT_HOTFIX_20261001: value })).toBe('WORKFLOW_SHA_MISMATCH');
    });
    it.each(['TRUE', 'yes', '1', ' true', false, true])('no coacciona flag inválida %s', value => expect(() => creditHotfixEnabled({ CREDIT_HOTFIX_20261001: value })).toThrow('HOTFIX_FLAG_INVALID'));
    it.each([
        [{ GITHUB_EVENT_NAME: 'push' }, 'MANUAL_DISPATCH_REQUIRED'], [{ GITHUB_REF: 'refs/heads/' + H.branch }, 'MAIN_BRANCH_REQUIRED'],
        [{ GITHUB_REPOSITORY: 'fork/nortex.20' }, 'HOTFIX_REPOSITORY_MISMATCH'], [{ GITHUB_SERVER_URL: 'https://other.test' }, 'HOTFIX_SERVER_MISMATCH'],
        [{ GITHUB_SHA: 'bad' }, 'CONTROL_SHA_REQUIRED'], [{ CANDIDATE_SHA: M }, 'HOTFIX_CANDIDATE_MISMATCH'],
        [{ CANDIDATE_SHA: H.base }, 'HOTFIX_CANDIDATE_MISMATCH'], [{ CREDIT_HOTFIX_ACTION: 'other' }, 'HOTFIX_ACTION_INVALID'],
    ])('rechaza contexto inválido %j antes de Git', (patch, reason) => {
        const git = vi.fn(); expect(() => verifyFixtureGit({ env: { ...env, ...patch }, git })).toThrow(reason); expect(git).not.toHaveBeenCalled();
    });
    it('admite C y recuperación sólo de B, verificando árbol y nueve fuentes', () => {
        expect(verifyFixtureGit({ env, git: fixtureGit() }).target).toBe(H.candidate);
        expect(verifyFixtureGit({ env: recover, git: fixtureGit() }).target).toBe(H.base);
        expect(hotfixTarget(recover)).toBe(H.base); expect(readCreditHotfixManifest().source_files).toHaveLength(9);
    });
    it.each([
        ['HEAD', (a: string[], b: Buffer) => a.join(' ') === 'rev-parse HEAD' ? Buffer.from(H.candidate) : b, 'CONTROL_CHECKOUT_MISMATCH'],
        ['main', (a: string[], b: Buffer) => a[0] === 'ls-remote' ? Buffer.from(b.toString().replace(M, 'b'.repeat(40))) : b, 'MAIN_HEAD_MOVED'],
        ['rama C', (a: string[], b: Buffer) => a[0] === 'ls-remote' ? Buffer.from(b.toString().replace(H.candidate, M)) : b, 'HOTFIX_BRANCH_MOVED'],
        ['checkout sucio', (a: string[], b: Buffer) => a[0] === 'status' ? Buffer.from(' M scripts/guard.mjs') : b, 'CONTROL_CHECKOUT_DIRTY'],
        ['padre extra', (a: string[], b: Buffer) => a[0] === 'cat-file' ? Buffer.from(b.toString().replace('\n\n', '\nparent ' + M + '\n\n')) : b, 'HOTFIX_PARENT_MISMATCH'],
        ['árbol', (a: string[], b: Buffer) => a[0] === 'cat-file' ? Buffer.from(b.toString().replace(H.tree, M)) : b, 'HOTFIX_TREE_MISMATCH'],
        ['archivo extra', (a: string[], b: Buffer) => a[0] === 'diff' && a.includes('--no-renames') ? Buffer.concat([b, Buffer.from('backend/server.ts\0')]) : b, 'HOTFIX_SCOPE_MISMATCH'],
        ['fuente distinta', (a: string[], b: Buffer) => a[0] === 'show' ? Buffer.concat([b, Buffer.from(' ')]) : b, 'HOTFIX_SOURCE_MISMATCH'],
    ])('rechaza adulteración %s', (_name, mutate, reason) => expect(() => verifyFixtureGit({ env, git: fixtureGit(mutate) })).toThrow(reason));
    it('no admite recover sin excepción, ni destino arbitrario', () => {
        expect(() => hotfixAction({ CREDIT_HOTFIX_ACTION: 'recover' })).toThrow('HOTFIX_MODE_REQUIRED');
        expect(() => assessCreditHotfix({ ...recover, CANDIDATE_SHA: M })).toThrow('HOTFIX_CANDIDATE_MISMATCH');
    });
    it.each([
        [{ PRODUCTION_CONFIRMATION: 'PROMOTE ' + H.base }, 'TYPED_CONFIRMATION_REQUIRED'], [{ SOLE_OWNER_CONFIRMATION: '' }, 'SOLE_OWNER_ACK_REQUIRED'],
        [{ NORTEX_PRODUCTION_DEPLOY_ENABLED: 'false' }, 'PRODUCTION_DEPLOY_DISABLED'], [{ PROD_URL: 'https://other.test' }, 'VALID_PRODUCTION_URL_REQUIRED'],
    ])('rechaza intención/configuración antes de red %j', async (patch, reason) => {
        const git = vi.fn(); const verifyHealth = vi.fn();
        await expect(verifyCreditHotfixRelease({ env: { ...env, ...patch }, phase: 'production', git, verifyHealth })).rejects.toThrow(reason);
        expect(git).not.toHaveBeenCalled(); expect(verifyHealth).not.toHaveBeenCalled();
    });
    it('promover exige B sano/no-store; recuperar usa el gate de recibo, sin exigir C sano', async () => {
        const verifyHealth = vi.fn().mockResolvedValue({});
        await verifyCreditHotfixRelease({ env, phase: 'production', git: fixtureGit(), verifyHealth, verifyGit: verifyFixtureGit });
        expect(verifyHealth).toHaveBeenCalledWith({ baseUrl: H.productionOrigin, expectedCommit: H.base, attempts: 1 });
        verifyHealth.mockClear(); await verifyCreditHotfixRelease({ env: recover, phase: 'production', git: fixtureGit(), verifyHealth, verifyGit: verifyFixtureGit });
        expect(verifyHealth).not.toHaveBeenCalled();
        await expect(verifyCreditHotfixRelease({ env, phase: 'production', git: fixtureGit(), verifyHealth: async () => { throw new Error('secret'); }, verifyGit: verifyFixtureGit })).rejects.toThrow('HOTFIX_PRODUCTION_BASE_NOT_VERIFIED');
    });
    it('autorización preserva stage target y exige main controlador también en recuperación', async () => {
        const verifyHotfix = vi.fn().mockResolvedValue({}); const verifyStaging = vi.fn().mockResolvedValue({});
        expect(assessProductionCandidate(env)).toBeNull(); expect(assessProductionCandidate(recover)).toBeNull();
        await expect(authorizeProductionRelease({ env: recover, verifyHotfix, verifyStaging, readMain: () => M })).resolves.toBe(H.base);
        expect(verifyStaging).toHaveBeenCalledWith(expect.objectContaining({ expectedCommit: H.base }));
        await expect(authorizeProductionRelease({ env, verifyHotfix, verifyStaging, readMain: () => H.candidate })).rejects.toThrow('MAIN_HEAD_MOVED');
    });
});

describe('CI exacto de control, producto y recuperación', () => {
    it('acepta tres identidades, cuatro jobs por cada una', async () => {
        const github = client(); await verifyHotfixCi({ github, env }); expect(github.rest.actions.listJobsForWorkflowRun).toHaveBeenCalledTimes(3);
    });
    it.each([
        { head_sha: M }, { head_branch: 'main' }, { event: 'pull_request' }, { path: '.github/workflows/ci.yml@refs/heads/main' },
        { status: 'in_progress', conclusion: null }, { conclusion: 'failure' }, { head_repository: { full_name: 'other/repo' } },
    ])('rechaza CI C ajeno/pendiente %j', async patch => {
        const github = client(); github.rest.actions.listWorkflowRuns.mockImplementation(async (query: any) => ({ data: { workflow_runs: github.ci.filter(x => x.head_sha === query.head_sha).map(x => x.head_sha === H.candidate ? { ...x, ...patch } : x) } }));
        await expect(verifyHotfixCi({ github, env })).rejects.toThrow('HOTFIX_CI_TERMINAL_SUCCESS_REQUIRED');
    });
    it('un CI verde no oculta otro fallido', async () => {
        const github = client(); const original = github.rest.actions.listWorkflowRuns.getMockImplementation()!;
        github.rest.actions.listWorkflowRuns.mockImplementation(async (query: any) => { const r = await original(query); if (query.head_sha === H.candidate) r.data.workflow_runs.push({ ...github.ci[1], id: 999, conclusion: 'failure' }); return r; });
        await expect(verifyHotfixCi({ github, env })).rejects.toThrow('HOTFIX_CI_TERMINAL_SUCCESS_REQUIRED');
    });
    it('un job de integración omitido bloquea aunque el run diga success', async () => {
        const github = client(); github.rest.actions.listJobsForWorkflowRun.mockResolvedValue({ data: { jobs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] } });
        await expect(verifyHotfixCi({ github, env })).rejects.toThrow('HOTFIX_CI_JOBS_REQUIRED');
    });
    it('no revela errores REST con contenido privado', async () => {
        const github = client(); github.rest.actions.listWorkflowRuns.mockRejectedValue(new Error('private URL/token'));
        await expect(verifyHotfixCi({ github, env })).rejects.toThrow('HOTFIX_REST_UNAVAILABLE');
    });
});

describe('artefactos y transición C → B → C, sin usar main como aplicación', () => {
    it.each([0, 8])('ZIP JSON real método%s se decodifica en memoria', method => expect(decodeEvidenceZip(zipEvidence({ qa: true }, method))).toEqual({ qa: true }));
    it.each([Buffer.alloc(0), Buffer.alloc(131073), zipEvidence({ qa: true }).subarray(0, 20)])('rechaza ZIP ausente/truncado/grande', bytes => expect(() => decodeEvidenceZip(bytes)).toThrow());
    it('rechaza CRC, múltiples entradas y paths; no extrae archivos', () => {
        const zip = zipEvidence({ qa: true }); const badCrc = Buffer.from(zip); badCrc[30 + 'evidence.json'.length] ^= 1;
        expect(() => decodeEvidenceZip(badCrc)).toThrow('HOTFIX_ARTIFACT_ZIP_INVALID');
        const many = Buffer.from(zip); many.writeUInt16LE(2, many.length - 12); expect(() => decodeEvidenceZip(many)).toThrow();
        const renamed = Buffer.from(zip); renamed.fill(46, 30, 30 + 'evidence.json'.length); expect(() => decodeEvidenceZip(renamed)).toThrow();
    });
    it('primera etapa C no acredita recuperación; la cadena completa sí habilita promover', async () => {
        await expect(prepareHotfixReleaseEvidence({ github: client(chain().slice(0, 1)), env, phase: 'production', contextPath: contextPath() })).rejects.toThrow('HOTFIX_EVIDENCE_LINK_REQUIRED');
        const result = await prepareHotfixReleaseEvidence({ github: client(chain()), env, phase: 'production', contextPath: contextPath() });
        expect(result).toMatchObject({ controller: M, target: H.candidate, previous_run_id: 30, recovery_run_id: 20 });
    });
    it('cada paso de staging deriva sus links de runs anteriores', async () => {
        const staging = { ...env, CREDIT_HOTFIX_PHASE: 'staging' };
        expect(await prepareHotfixReleaseEvidence({ github: client(), env: staging, phase: 'staging', contextPath: contextPath() })).toMatchObject({ previous_run_id: null, recovery_run_id: null });
        expect(await prepareHotfixReleaseEvidence({ github: client(chain().slice(0, 1)), env: { ...recover, CREDIT_HOTFIX_PHASE: 'staging' }, phase: 'staging', contextPath: contextPath() })).toMatchObject({ target: H.base, previous_run_id: 10 });
        expect(await prepareHotfixReleaseEvidence({ github: client(chain().slice(0, 2)), env: staging, phase: 'staging', contextPath: contextPath() })).toMatchObject({ target: H.candidate, recovery_run_id: 20 });
    });
    it('recupera C no sano sólo con recibo de POST aceptado, misma app y staging B', async () => {
        const failed = run(40, 'production', 'failure'); const receipt = evidence(failed, H.candidate, 'requested', { previous_run_id: 30, recovery_run_id: 20 });
        const result = await prepareHotfixReleaseEvidence({ github: client([...chain(), { run: failed, values: [receipt] }]), env: recover, phase: 'production', contextPath: contextPath() });
        expect(result).toMatchObject({ target: H.base, previous_run_id: 40, recovery_run_id: 20 });
        await expect(prepareHotfixReleaseEvidence({ github: client(chain()), env: recover, phase: 'production', contextPath: contextPath() })).rejects.toThrow('HOTFIX_RELEASE_EVIDENCE_REQUIRED');
    });
    it('conserva recibo C de intento1 si un rerun2 falla antes de producir artifact', async () => {
        const first = run(40, 'production', 'failure');
        const second = { ...first, run_attempt: 2, preflightFailed: true };
        const receipt = evidence(first, H.candidate, 'requested', { previous_run_id: 30, recovery_run_id: 20 });
        const github = client([...chain(), { run: second, values: [receipt], attempts: [first, second] }]);
        const result = await prepareHotfixReleaseEvidence({ github, env: recover, phase: 'production', contextPath: contextPath() });
        expect(result).toMatchObject({ target: H.base, previous_run_id: 40, recovery_run_id: 20 });
        expect(github.rest.actions.getWorkflowRunAttempt).toHaveBeenCalledWith(expect.objectContaining({ run_id: 40, attempt_number: 1 }));
        expect(github.rest.actions.listJobsForWorkflowRunAttempt).toHaveBeenCalledWith(expect.objectContaining({ run_id: 40, attempt_number: 1 }));
        expect(github.rest.actions.listJobsForWorkflowRun).not.toHaveBeenCalled();
    });
    it('conserva health de intento1 exitoso aunque el rerun2 de staging falle', async () => {
        const records: { run: any; values: any[]; attempts?: any[] }[] = chain();
        const first = records[2].run;
        records[2] = { ...records[2], run: { ...first, run_attempt: 2, conclusion: 'failure', preflightFailed: true }, attempts: [first] };
        const github = client(records);
        await expect(prepareHotfixReleaseEvidence({ github, env, phase: 'production', contextPath: contextPath() })).resolves.toMatchObject({ previous_run_id: 30, recovery_run_id: 20 });
        expect(github.rest.actions.getWorkflowRunAttempt).toHaveBeenCalledWith(expect.objectContaining({ run_id: 30, attempt_number: 1 }));
        expect(github.rest.actions.listJobsForWorkflowRun).not.toHaveBeenCalled();
    });
    it.each([0, -1, 1.5, '1', null, 3])('rechaza número de intento falsificado %s antes de consultar su API', async attempt => {
        const first = run(40, 'production', 'failure');
        const receipt = evidence(first, H.candidate, 'requested', { previous_run_id: 30, recovery_run_id: 20, run_attempt: attempt });
        const github = client([...chain(), { run: { ...first, run_attempt: 2 }, values: [receipt], attempts: [first] }]);
        await expect(prepareHotfixReleaseEvidence({ github, env: recover, phase: 'production', contextPath: contextPath() })).rejects.toThrow('HOTFIX_ATTEMPT_INVALID');
        expect(github.rest.actions.getWorkflowRunAttempt).not.toHaveBeenCalled();
    });
    it.each([
        { run_attempt: 2 }, { id: 41 }, { head_sha: H.candidate }, { head_branch: H.branch },
        { path: '.github/workflows/ci.yml' }, { event: 'push' }, { head_repository: { full_name: 'other/repo' } },
        { status: 'in_progress' }, { conclusion: 'timed_out' },
    ])('rechaza identidad/resultado ajeno del intento productor %j', async patch => {
        const first = run(40, 'production', 'failure');
        const receipt = evidence(first, H.candidate, 'requested', { previous_run_id: 30, recovery_run_id: 20 });
        const github = client([...chain(), { run: { ...first, run_attempt: 2 }, values: [receipt], attempts: [first] }]);
        github.rest.actions.getWorkflowRunAttempt.mockResolvedValue({ data: { ...first, ...patch } });
        await expect(prepareHotfixReleaseEvidence({ github, env: recover, phase: 'production', contextPath: contextPath() })).rejects.toThrow();
        expect(github.rest.actions.listJobsForWorkflowRun).not.toHaveBeenCalled();
    });
    it.each([{ run_attempt: 2 }, { run_id: 41 }, { head_sha: H.candidate }, { status: 'in_progress' }, { conclusion: 'neutral' }])('rechaza jobs ajenos al intento productor %j', async patch => {
        const first = run(40, 'production', 'failure');
        const github = client([...chain(), { run: { ...first, run_attempt: 2 }, values: [evidence(first, H.candidate, 'requested', { previous_run_id: 30, recovery_run_id: 20 })], attempts: [first] }]);
        const original = github.rest.actions.listJobsForWorkflowRunAttempt.getMockImplementation()!;
        github.rest.actions.listJobsForWorkflowRunAttempt.mockImplementation(async args => {
            const result = await original(args);
            if (args.run_id === 40) Object.assign(result.data.jobs[0], patch);
            return result;
        });
        await expect(prepareHotfixReleaseEvidence({ github, env: recover, phase: 'production', contextPath: contextPath() })).rejects.toThrow('HOTFIX_ATTEMPT_JOBS_MISMATCH');
        expect(github.rest.actions.listJobsForWorkflowRun).not.toHaveBeenCalled();
    });
    it.each(['missing-attempt', 'missing-post', 'missing-upload', 'attempt-api-error', 'jobs-api-error'])('no sustituye prueba histórica ausente por un rerun verde: %s', async kind => {
        const first = run(40, 'production', 'failure');
        const second = { ...first, run_attempt: 2, conclusion: 'success' };
        const github = client([...chain(), { run: second, values: [evidence(first, H.candidate, 'requested', { previous_run_id: 30, recovery_run_id: 20 })], attempts: [first, second] }]);
        if (kind === 'missing-attempt') github.rest.actions.getWorkflowRunAttempt.mockResolvedValue({ data: undefined });
        if (kind === 'attempt-api-error') github.rest.actions.getWorkflowRunAttempt.mockRejectedValue(new Error('private token'));
        if (kind === 'jobs-api-error') github.rest.actions.listJobsForWorkflowRunAttempt.mockRejectedValue(new Error('private token'));
        if (kind === 'missing-post' || kind === 'missing-upload') {
            const original = github.rest.actions.listJobsForWorkflowRunAttempt.getMockImplementation()!;
            github.rest.actions.listJobsForWorkflowRunAttempt.mockImplementation(async args => {
                const result = await original(args);
                if (args.run_id === 40) result.data.jobs[0].steps[kind === 'missing-post' ? 0 : 2].conclusion = 'skipped';
                return result;
            });
        }
        await expect(prepareHotfixReleaseEvidence({ github, env: recover, phase: 'production', contextPath: contextPath() })).rejects.toThrow(/^(HOTFIX_ATTEMPT_PROVENANCE_INVALID|HOTFIX_REQUEST_NOT_PROVEN|HOTFIX_ARTIFACT_PRODUCER_NOT_PROVEN|HOTFIX_REST_UNAVAILABLE)$/);
        expect(github.rest.actions.listJobsForWorkflowRun).not.toHaveBeenCalled();
    });
    it('identifica jobs por el endpoint de intento aunque la respuesta no incluya run_attempt', async () => {
        const first = run(40, 'production', 'failure');
        const github = client([...chain(), { run: { ...first, run_attempt: 2 }, values: [evidence(first, H.candidate, 'requested', { previous_run_id: 30, recovery_run_id: 20 })], attempts: [first] }]);
        const original = github.rest.actions.listJobsForWorkflowRunAttempt.getMockImplementation()!;
        github.rest.actions.listJobsForWorkflowRunAttempt.mockImplementation(async args => {
            const result = await original(args); delete (result.data.jobs[0] as any).run_attempt; return result;
        });
        await expect(prepareHotfixReleaseEvidence({ github, env: recover, phase: 'production', contextPath: contextPath() })).resolves.toMatchObject({ previous_run_id: 40 });
        expect(github.rest.actions.listJobsForWorkflowRunAttempt).toHaveBeenCalledWith(expect.objectContaining({ run_id: 40, attempt_number: 1 }));
        expect(github.rest.actions.listJobsForWorkflowRun).not.toHaveBeenCalled();
    });
    it('staging C nunca sano se puede recuperar, pero no acredita un drill válido', async () => {
        const failed = run(10, 'staging', 'failure');
        const result = await prepareHotfixReleaseEvidence({ github: client([{ run: failed, values: [evidence(failed, H.candidate, 'requested')] }]), env: { ...recover, CREDIT_HOTFIX_PHASE: 'staging' }, phase: 'staging', contextPath: contextPath() });
        expect(result.previous_run_id).toBeNull();
    });
    it.each([
        { controller: H.candidate }, { target: M }, { candidate: M }, { base: M }, { case: 'other' }, { manifest_digest: 'b'.repeat(64) },
        { run_id: 999 }, { run_attempt: 2 }, { phase: 'requested' }, { unexpected: true },
        { binding: { origin_sha256: sha256('https://other.test'), application_sha256: H.stageAppHash } },
        { binding: { origin_sha256: sha256(H.stageOrigin), application_sha256: 'b'.repeat(64) } },
    ])('rechaza evidencia adulterada %j', patch => {
        const r = run(10); expect(() => assessHotfixEvidence({ evidence: { ...evidence(r), ...patch }, run: r, env, phase: 'healthy', environment: 'staging', target: H.candidate })).toThrow('HOTFIX_EVIDENCE_INVALID');
    });
    it.each([{ head_sha: H.candidate }, { event: 'push' }, { head_branch: H.branch }, { conclusion: 'failure' }, { path: '.github/workflows/ci.yml' }])('rechaza procedencia ajena %j', patch => {
        const r = run(10); expect(() => assessHotfixEvidence({ evidence: evidence(r), run: { ...r, ...patch }, env, phase: 'healthy', environment: 'staging', target: H.candidate })).toThrow('HOTFIX_EVIDENCE_INVALID');
    });
    it.each(['digest', 'expired', 'wrong-artifact', 'missing-post', 'failed-health'])('rechaza prueba REST %s', async kind => {
        const github = client(chain());
        if (kind === 'digest') github.perRun.get(30)![1].digest = 'sha256:' + 'b'.repeat(64);
        if (kind === 'expired') github.perRun.get(30)![1].expired = true;
        if (kind === 'wrong-artifact') github.perRun.get(30)![1].workflow_run.id = 999;
        if (kind === 'missing-post' || kind === 'failed-health') {
            const original = github.rest.actions.listJobsForWorkflowRunAttempt.getMockImplementation()!;
            github.rest.actions.listJobsForWorkflowRunAttempt.mockImplementation(async args => {
                const r = await original(args); if (args.run_id === 30) (r.data.jobs[0] as any).steps[kind === 'missing-post' ? 0 : 1].conclusion = 'failure'; return r;
            });
        }
        await expect(prepareHotfixReleaseEvidence({ github, env, phase: 'production', contextPath: contextPath() })).rejects.toThrow();
    });
    it('recovery fuera de orden y controles de otra revisión bloquean', async () => {
        const records = chain(); records[2].values[1].recovery_run_id = 10;
        await expect(prepareHotfixReleaseEvidence({ github: client(records), env, phase: 'production', contextPath: contextPath() })).rejects.toThrow();
        await expect(prepareHotfixReleaseEvidence({ github: client(chain()), env: { ...env, GITHUB_SHA: 'b'.repeat(40) }, phase: 'production', contextPath: contextPath() })).rejects.toThrow('HOTFIX_RELEASE_EVIDENCE_REQUIRED');
    });
    it('writer conserva identidad y links validados; UUID ajeno y contexto distinto fallan', async () => {
        const ctx = contextPath(), output = path.join(temp(), 'evidence.json');
        await prepareHotfixReleaseEvidence({ github: client(chain()), env, phase: 'production', contextPath: ctx });
        const e = recordHotfixEvidence({ env: { ...env, HOTFIX_APP_URL: H.productionOrigin, GITHUB_RUN_ID: '40', GITHUB_RUN_ATTEMPT: '1' },
            phase: 'requested', environment: 'production', output, contextPath: ctx, bind: expectedArtifactBinding });
        expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(e); expect(e.previous_run_id).toBe(30);
        expect(() => artifactBinding({ HOTFIX_APP_URL: H.productionOrigin, HOTFIX_APP_UUID: 'qa-other-app' }, 'production')).toThrow('HOTFIX_APP_UUID_MISMATCH');
        expect(() => recordHotfixEvidence({ env: recover, phase: 'requested', environment: 'production', output, contextPath: ctx })).toThrow('HOTFIX_CONTEXT_MISMATCH');
    });
});

describe('YAML real: control confiable, condiciones obligatorias y recibo antes de health', () => {
    for (const phase of ['staging', 'production']) it('protege workflow ' + phase, () => {
        const doc = parseDocument(readFileSync('.github/workflows/release-' + phase + '.yml', 'utf8'), { uniqueKeys: true }); expect(doc.errors).toEqual([]);
        const workflow = doc.toJS(); const input = workflow.on.workflow_dispatch.inputs;
        expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']); expect(input.credit_hotfix_20261001).toMatchObject({ type: 'boolean', default: false });
        expect(input.credit_hotfix_action.options).toEqual(['promote', 'recover']); expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' });
        for (const key of ['preflight', 'deploy-' + phase]) {
            const job = workflow.jobs[key]; const gates = job.steps.filter((s: any) => s.name === 'Verificar evidencia puntual de crédito');
            expect(gates).toHaveLength(1); expect(gates[0].if).toBe('${{ inputs.credit_hotfix_20261001 == true }}');
            expect(gates[0]['continue-on-error']).toBeUndefined(); expect(gates[0].with.script).toContain('verifyHotfixCi'); expect(gates[0].with.script).toContain('prepareHotfixReleaseEvidence');
            expect(gates[0].with.script).toContain('GITHUB_WORKSPACE');
        }
        const deploy = workflow.jobs['deploy-' + phase]; expect(deploy.environment.name).toBe(phase);
        const checkout = deploy.steps.find((s: any) => s.uses === 'actions/checkout@v4');
        expect(checkout.with.ref).toBe('${{ inputs.credit_hotfix_20261001 && github.sha || inputs.candidate_sha }}');
        expect(deploy.steps.some((s: any) => s['continue-on-error'] === true)).toBe(false);
        const names = deploy.steps.map((s: any) => s.name); const webhook = names.findIndex((s: string) => /Desplegar .*webhook/.test(s));
        const request = names.indexOf('Registrar solicitud puntual'); const health = names.findIndex((s: string) => /^Verificar (STAGING|PROD) sano/.test(s));
        expect(webhook).toBeLessThan(request); expect(request).toBeLessThan(health); expect(health).toBeLessThan(names.indexOf('Registrar salud puntual'));
        for (const upload of deploy.steps.filter((step: any) => step.uses === 'actions/upload-artifact@v4')) {
            expect(upload.with.path).toMatch(/^credit-hotfix-(attempt|health)\/evidence\.json$/);
            expect(upload.with['if-no-files-found']).toBe('error');
            expect(upload.with['include-hidden-files']).toBeUndefined();
        }
        expect(JSON.stringify(workflow.jobs.preflight)).not.toContain('secrets.');
        expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    });
});
