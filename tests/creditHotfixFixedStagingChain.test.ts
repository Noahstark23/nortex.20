// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREDIT_HOTFIX as H, expectedArtifactBinding, manifestDigest, readCreditHotfixManifest, sha256 } from '../scripts/verify-credit-hotfix-release.mjs';
import * as releaseIdentity from '../scripts/verify-credit-hotfix-release.mjs';
import { decodeEvidenceZip, prepareHotfixReleaseEvidence, recordHotfixEvidence, verifyHotfixCi } from '../scripts/verify-credit-hotfix-run-evidence.mjs';
import { authorizeProductionRelease } from '../scripts/authorize-production-release.mjs';

const executor = '399ce7764e714bbe4a543160f8cb36ded12e885f';
const historical = '526fb15440d7a993da2862baa45baf7e4bf1cb92';
const ids = [37164392068, 37165601168, 37166458396];
const fixture = new URL('./fixtures/credit-hotfix-staging-chain-20261004/', import.meta.url);
const env = {
    CREDIT_HOTFIX_20261001: 'true', CREDIT_HOTFIX_ACTION: 'promote', CREDIT_HOTFIX_PHASE: 'production',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: executor,
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: H.repository,
    CANDIDATE_SHA: H.candidate, PROD_URL: H.productionOrigin, STAGING_URL: H.stageOrigin,
    NORTEX_PRODUCTION_DEPLOY_ENABLED: 'true', PRODUCTION_CONFIRMATION: 'PROMOTE ' + H.candidate,
    SOLE_OWNER_CONFIRMATION: 'SOLE_OWNER ' + H.candidate,
};
const recover = { ...env, CREDIT_HOTFIX_ACTION: 'recover', CANDIDATE_SHA: H.base,
    PRODUCTION_CONFIRMATION: 'PROMOTE ' + H.base, SOLE_OWNER_CONFIRMATION: 'SOLE_OWNER ' + H.base };
const temporary: string[] = [];
const contextPath = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'credit-fixed-chain-')); temporary.push(dir);
    return path.join(dir, 'context.json');
};
afterEach(() => { vi.restoreAllMocks(); temporary.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });

function zip(value: unknown) {
    return execFileSync('python3', ['-c',
        "import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('evidence.json',sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())"],
    { input: JSON.stringify(value), maxBuffer: 131072 });
}

function client() {
    const records = JSON.parse(readFileSync(new URL('provenance.json', fixture), 'utf8'));
    const attempts = new Map<number, any>(records.map((r: any) => [r.run.id, structuredClone(r.run)]));
    const artifacts = new Map<number, Buffer>(records.map((r: any) =>
        [r.artifacts[0].id, readFileSync(new URL(r.run.id + '.zip', fixture))]));
    const actions = {
        listWorkflowRuns: vi.fn(async (q: any) => ({ data: { workflow_runs: records.map((r: any) => r.run)
            .filter((r: any) => r.path.endsWith('/' + q.workflow_id) && r.head_sha === q.head_sha
                && r.head_branch === q.branch && r.event === q.event) } })),
        getWorkflowRun: vi.fn(async ({ run_id }: any) => ({ data: records.find((r: any) => r.run.id === run_id)?.run })),
        getWorkflowRunAttempt: vi.fn(async ({ run_id, attempt_number }: any) => ({ data: attempt_number === 1 ? attempts.get(run_id) : undefined })),
        listWorkflowRunArtifacts: vi.fn(async ({ run_id }: any) => ({ data: { artifacts: records.find((r: any) => r.run.id === run_id)?.artifacts || [] } })),
        downloadArtifact: vi.fn(async ({ artifact_id }: any) => ({ data: artifacts.get(artifact_id) })),
        listJobsForWorkflowRunAttempt: vi.fn(async ({ run_id }: any) => ({ data: { jobs: records.find((r: any) => r.run.id === run_id)?.jobs || [] } })),
        listJobsForWorkflowRun: vi.fn(async () => ({ data: { jobs: [] } })),
    };
    return { rest: { actions }, records, artifacts, attempts };
}
const prepare = (github: ReturnType<typeof client>, input: Record<string, string | undefined> = env) =>
    prepareHotfixReleaseEvidence({ github, env: input, phase: 'production', contextPath: contextPath() });

function addProductionRequest(github: ReturnType<typeof client>, patch = {}) {
    const source = structuredClone(github.records[2]);
    source.run = { ...source.run, id: 40000000000, head_sha: executor, path: '.github/workflows/release-production.yml',
        conclusion: 'failure', created_at: '2026-10-05T00:00:00Z' };
    const value = { ...decodeEvidenceZip(github.artifacts.get(source.artifacts[0].id)), phase: 'requested',
        environment: 'production', controller: executor, run_id: source.run.id,
        binding: { origin_sha256: sha256(H.productionOrigin), application_sha256: H.productionAppHash },
        previous_run_id: ids[2], recovery_run_id: ids[1], ...patch };
    const bytes = zip(value);
    source.artifacts = [{ ...source.artifacts[0], id: 12345678900, name: 'credit-hotfix-production-attempt',
        size_in_bytes: bytes.length, digest: 'sha256:' + sha256(bytes),
        workflow_run: { id: source.run.id, head_sha: executor, head_branch: 'main' } }];
    source.jobs = [{ ...source.jobs[0], run_id: source.run.id, head_sha: executor, name: 'deploy-production', conclusion: 'failure', steps: [
        { name: 'Desplegar PROD (webhook de Coolify)', conclusion: 'success' },
        { name: 'Conservar evidencia requested', conclusion: 'success' },
    ] }];
    github.records.push(source); github.attempts.set(source.run.id, structuredClone(source.run));
    github.artifacts.set(source.artifacts[0].id, bytes);
    return source;
}

describe('cadena de staging fija del 4 de octubre, sólo crédito C′/B′', () => {
    it('promueve con los tres artifacts reales aunque el ejecutor haya avanzado', async () => {
        const github = client();
        const result = await prepare(github);
        expect(result).toEqual({ controller: executor, action: 'promote', target: H.candidate,
            phase: 'production', previous_run_id: ids[2], recovery_run_id: ids[1] });
        for (const id of ids) {
            expect(github.rest.actions.getWorkflowRunAttempt).toHaveBeenCalledWith(expect.objectContaining({ run_id: id, attempt_number: 1 }));
            expect(github.rest.actions.listJobsForWorkflowRunAttempt).toHaveBeenCalledWith(expect.objectContaining({ run_id: id, attempt_number: 1 }));
        }
        expect(github.rest.actions.listJobsForWorkflowRun).not.toHaveBeenCalled();
    });
    it('conserva el manifiesto histórico y los SHA candidatos exactos', () => {
        expect(manifestDigest()).toBe('ceaa32441b04b2f97882623844e7ce4c2db1fa6b2672347b0c2555ffb63f105e');
        expect(H.candidate).toBe('df6fc095fe8da39b4829336e79b78e4454997046');
        expect(H.base).toBe('f656392d2c3a861d605e3da7012c7a9d4732e221');
    });
    it('rechaza cambio del manifiesto local antes de leer el histórico', async () => {
        vi.spyOn(releaseIdentity, 'manifestDigest').mockReturnValue('b'.repeat(64));
        const github = client();
        await expect(prepare(github)).rejects.toThrow('HOTFIX_FIXED_STAGING_MANIFEST_MISMATCH');
        expect(github.rest.actions.getWorkflowRun).not.toHaveBeenCalled();
    });
    it('un rerun posterior fallido no reemplaza el intento1 productor', async () => {
        const github = client();
        github.records[2].run.run_attempt = 2; github.records[2].run.conclusion = 'failure';
        await expect(prepare(github)).resolves.toMatchObject({ previous_run_id: ids[2] });
        expect(github.rest.actions.getWorkflowRunAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ attempt_number: 2 }));
    });
    it('el recibo productivo nuevo identifica al ejecutor actual, nunca al histórico', async () => {
        const ctx = contextPath();
        await prepareHotfixReleaseEvidence({ github: client(), env, phase: 'production', contextPath: ctx });
        const receipt = recordHotfixEvidence({ env: { ...env, HOTFIX_APP_URL: H.productionOrigin,
            GITHUB_RUN_ID: '40000000000', GITHUB_RUN_ATTEMPT: '1' }, phase: 'requested', environment: 'production',
            contextPath: ctx, output: path.join(path.dirname(ctx), 'evidence.json'), bind: expectedArtifactBinding });
        expect(receipt).toMatchObject({ controller: executor, previous_run_id: ids[2], recovery_run_id: ids[1] });
    });
    it('recupera B′ con solicitud productiva del ejecutor y la cadena histórica íntegra', async () => {
        const github = client(); const request = addProductionRequest(github);
        await expect(prepare(github, recover)).resolves.toMatchObject({ controller: executor, target: H.base,
            previous_run_id: request.run.id, recovery_run_id: ids[1] });
    });
    it('no recupera sólo por disponer del histórico, sin solicitud productiva actual', async () => {
        await expect(prepare(client(), recover)).rejects.toThrow('HOTFIX_RELEASE_EVIDENCE_REQUIRED');
    });
    it.each([
        { previous_run_id: ids[0] }, { previous_run_id: 999 }, { recovery_run_id: ids[0] },
        { recovery_run_id: null }, { controller: historical },
        { binding: { origin_sha256: sha256(H.stageOrigin), application_sha256: H.stageAppHash } },
    ])('rechaza solicitud productiva con enlace/controlador/destino adulterado %j', async patch => {
        const github = client(); addProductionRequest(github, patch);
        await expect(prepare(github, recover)).rejects.toThrow();
    });
    it('no acepta una solicitud productiva emitida por el controlador histórico', async () => {
        const github = client(); const r = addProductionRequest(github, { controller: historical });
        r.run.head_sha = historical;
        await expect(prepare(github, recover)).rejects.toThrow('HOTFIX_RELEASE_EVIDENCE_REQUIRED');
    });
    it.each([
        { head_sha: executor }, { head_sha: H.candidate }, { id: 999 }, { head_branch: H.branch },
        { event: 'push' }, { path: '.github/workflows/ci.yml' }, { repository: { full_name: 'fork/nortex.20' } },
        { head_repository: { full_name: 'fork/nortex.20' } },
    ])('rechaza run histórico con procedencia adulterada %j', async patch => {
        const github = client(); Object.assign(github.records[1].run, patch);
        await expect(prepare(github)).rejects.toThrow();
    });
    it.each([
        { id: 999 }, { head_sha: executor }, { run_attempt: 2 }, { head_branch: H.branch },
        { status: 'in_progress' }, { conclusion: 'failure' }, { event: 'push' },
        { path: '.github/workflows/release-production.yml' },
    ])('rechaza intento productor adulterado %j', async patch => {
        const github = client(); Object.assign(github.attempts.get(ids[1]), patch);
        await expect(prepare(github)).rejects.toThrow();
    });
    it.each([
        { id: 123 }, { expired: true }, { digest: 'sha256:' + 'b'.repeat(64) },
        { workflow_run: { id: ids[1], head_sha: executor, head_branch: 'main' } },
        { workflow_run: { id: 999, head_sha: historical, head_branch: 'main' } },
        { workflow_run: { id: ids[1], head_sha: historical, head_branch: H.branch } },
    ])('rechaza identidad/digest/expiración del artifact %j', async patch => {
        const github = client(); Object.assign(github.records[1].artifacts[0], patch);
        await expect(prepare(github)).rejects.toThrow();
        expect(github.rest.actions.downloadArtifact).not.toHaveBeenCalledWith(expect.objectContaining({ artifact_id: github.records[1].artifacts[0].id }));
    });
    it.each([
        { controller: executor }, { target: H.candidate }, { candidate: executor }, { base: executor },
        { run_id: ids[0] }, { run_attempt: 2 }, { previous_run_id: ids[2] }, { recovery_run_id: ids[0] },
        { manifest_digest: 'b'.repeat(64) }, { environment: 'production' },
        { binding: { origin_sha256: sha256(H.productionOrigin), application_sha256: H.productionAppHash } },
    ])('rechaza recibo reempaquetado aunque anuncie su nuevo digest correcto %j', async patch => {
        const github = client(); const metadata = github.records[1].artifacts[0];
        const bytes = zip({ ...decodeEvidenceZip(github.artifacts.get(metadata.id)), ...patch });
        github.artifacts.set(metadata.id, bytes); metadata.digest = 'sha256:' + sha256(bytes); metadata.size_in_bytes = bytes.length;
        await expect(prepare(github)).rejects.toThrow('HOTFIX_FIXED_STAGING_ARTIFACT_MISMATCH');
    });
    it('rechaza bytes distintos bajo el digest fijado', async () => {
        const github = client(); const id = github.records[1].artifacts[0].id;
        const bytes = Buffer.from(github.artifacts.get(id)!); bytes[30] ^= 1; github.artifacts.set(id, bytes);
        await expect(prepare(github)).rejects.toThrow('HOTFIX_ARTIFACT_DIGEST_MISMATCH');
    });
    it.each(['missing', 'duplicate', 'other-id'])('rechaza artifact %s sin buscar sustitutos', async kind => {
        const github = client(); const r = github.records[1];
        if (kind === 'missing') r.artifacts = [];
        else if (kind === 'duplicate') r.artifacts.push({ ...r.artifacts[0], id: 123 });
        else r.artifacts[0].id = 123;
        await expect(prepare(github)).rejects.toThrow();
    });
    it.each([
        { run_id: 999 }, { head_sha: executor }, { run_attempt: 2 }, { conclusion: 'failure' }, { status: 'in_progress' },
    ])('rechaza jobs ajenos o fallidos %j', async patch => {
        const github = client(); Object.assign(github.records[1].jobs[0], patch);
        await expect(prepare(github)).rejects.toThrow('HOTFIX_ATTEMPT_JOBS_MISMATCH');
    });
    it.each(['Desplegar STAGING (webhook de Coolify)', 'Verificar STAGING sano y en el candidato esperado', 'Conservar evidencia healthy'])
    ('exige paso exitoso %s', async name => {
        const github = client(); github.records[1].jobs[0].steps.find((s: any) => s.name === name).conclusion = 'failure';
        await expect(prepare(github)).rejects.toThrow();
    });
    it.each([0, 1])('rechaza orden temporal adulterado en posición %s', async index => {
        const github = client(); github.attempts.get(ids[index]).created_at = '2026-10-06T00:00:00Z';
        await expect(prepare(github)).rejects.toThrow('HOTFIX_RECOVERY_ORDER_INVALID');
    });
    it.each([
        { CANDIDATE_SHA: executor }, { CANDIDATE_SHA: H.base }, { STAGING_URL: H.productionOrigin },
        { PROD_URL: H.stageOrigin }, { COOLIFY_STAGING_APPLICATION_UUID: 'other-app' },
        { COOLIFY_PROD_APPLICATION_UUID: 'other-app' },
    ])('rechaza candidato/destino ajeno antes de leer artifacts %j', async patch => {
        const github = client(); await expect(prepare(github, { ...env, ...patch })).rejects.toThrow();
        expect(github.rest.actions.downloadArtifact).not.toHaveBeenCalled();
    });
    it('el histórico no habilita recover de staging desde otro controlador', async () => {
        const github = client();
        await expect(prepareHotfixReleaseEvidence({ github, env: { ...recover, CREDIT_HOTFIX_PHASE: 'staging' },
            phase: 'staging', contextPath: contextPath() })).rejects.toThrow('HOTFIX_RELEASE_EVIDENCE_REQUIRED');
        expect(github.rest.actions.getWorkflowRun).not.toHaveBeenCalled();
    });
    it('una evidencia actual incompleta bloquea aunque exista el histórico válido', async () => {
        const github = client(); const r = structuredClone(github.records[2]);
        r.run = { ...r.run, id: 40000000000, head_sha: executor, created_at: '2026-10-05T00:00:00Z' };
        const value = { ...decodeEvidenceZip(github.artifacts.get(r.artifacts[0].id)), controller: executor,
            run_id: r.run.id, recovery_run_id: null };
        const bytes = zip(value);
        r.artifacts = [{ ...r.artifacts[0], id: 12345678900, digest: 'sha256:' + sha256(bytes), size_in_bytes: bytes.length,
            workflow_run: { id: r.run.id, head_sha: executor, head_branch: 'main' } }];
        r.jobs = [{ ...r.jobs[0], run_id: r.run.id, head_sha: executor }];
        github.records.push(r); github.attempts.set(r.run.id, r.run); github.artifacts.set(r.artifacts[0].id, bytes);
        await expect(prepare(github)).rejects.toThrow('HOTFIX_EVIDENCE_LINK_REQUIRED');
        expect(github.rest.actions.getWorkflowRun).not.toHaveBeenCalled();
    });
    it('la revalidación del ejecutor contra main sigue bloqueando el avance', async () => {
        await expect(authorizeProductionRelease({ env,
            verifyHotfix: async () => ({ manifest: readCreditHotfixManifest(), controller: executor, candidate: H.candidate, base: H.base, target: H.candidate }),
            verifyStaging: async () => ({ healthUrl: H.stageOrigin + '/api/health', payload: {}, attemptsUsed: 1 }),
            readMain: () => historical })).rejects.toThrow('MAIN_HEAD_MOVED');
    });
    it.each([executor, historical])('CI sólo pasa cuando los cuatro jobs pertenecen al ejecutor %s', async ciController => {
        const github = client();
        const sources = [
            { head_sha: ciController, head_branch: 'main', event: 'push' },
            { head_sha: H.candidate, head_branch: H.branch, event: 'workflow_dispatch' },
            { head_sha: H.base, head_branch: 'main', event: 'push' },
        ];
        sources.forEach((source, i) => github.records.push({ run: { ...github.records[0].run, ...source,
            id: 50000000000 + i, path: '.github/workflows/ci.yml' } }));
        github.rest.actions.listJobsForWorkflowRun.mockResolvedValue({ data: { jobs:
            ['verify', 'integration-required', 'deploy-schema-smoke', 'backup-restore-smoke']
                .map(name => ({ name, status: 'completed', conclusion: 'success' })) } } as any);
        if (ciController === executor) await expect(verifyHotfixCi({ github, env })).resolves.toBeUndefined();
        else await expect(verifyHotfixCi({ github, env })).rejects.toThrow('HOTFIX_CI_TERMINAL_SUCCESS_REQUIRED');
        expect(github.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(expect.objectContaining({ workflow_id: 'ci.yml', head_sha: executor }));
    });
});
