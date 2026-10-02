import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import {
    CREDIT_HOTFIX, assessCreditHotfix, artifactBinding, expectedArtifactBinding, hotfixAction,
    hotfixTarget, manifestDigest, sha256,
} from './verify-credit-hotfix-release.mjs';

const REPO = Object.freeze({ owner: 'Noahstark23', repo: 'nortex.20' });
const REQUIRED_JOBS = ['verify', 'integration-required', 'deploy-schema-smoke', 'backup-restore-smoke'];
const CONTEXT_PATH = '.credit-hotfix-context.json';
const fail = code => { throw new Error(code); };
const safeRest = async callback => { try { return await callback(); } catch { fail('HOTFIX_REST_UNAVAILABLE'); } };
const bindingMatches = (binding, env, environment) => {
    if (!binding || Object.keys(binding).sort().join(',') !== 'application_sha256,origin_sha256') return false;
    return JSON.stringify(binding) === JSON.stringify(expectedArtifactBinding(env, environment));
};
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const paths = { staging: '.github/workflows/release-staging.yml', production: '.github/workflows/release-production.yml' };
const artifactName = (phase, environment) => 'credit-hotfix-' + environment + '-' + (phase === 'requested' ? 'attempt' : 'health');

// Sólo GET por Octokit oficial, actions:read. No imprime respuestas, descarga
// a disco ni sigue URLs proporcionadas por el contenido del artifact.
const pages = async (method, args, field) => {
    const all = [];
    for (let page = 1; page <= 10; page++) {
        const { data } = await safeRest(() => method({ ...REPO, ...args, page, per_page: 100 }));
        if (!data || !Array.isArray(data[field])) fail('HOTFIX_REST_RESPONSE_INVALID');
        all.push(...data[field]);
        if (data[field].length < 100) return all;
    }
    fail('HOTFIX_REST_PAGE_LIMIT');
};
const runRepositoryMatches = run => run.repository?.full_name === CREDIT_HOTFIX.repository
    && run.head_repository?.full_name === CREDIT_HOTFIX.repository;
const manualControlRun = (run, env, environment) => run && positiveId(run.id)
    && positiveId(run.run_attempt) && runRepositoryMatches(run)
    && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.head_sha === env.GITHUB_SHA && run.path === paths[environment]
    && Number.isFinite(Date.parse(run.created_at));

export const verifyHotfixCi = async ({ github, env = process.env }) => {
    assessCreditHotfix(env);
    const identities = [
        { sha: env.GITHUB_SHA, branch: 'main', event: 'push' },
        { sha: CREDIT_HOTFIX.candidate, branch: CREDIT_HOTFIX.branch, event: 'workflow_dispatch' },
        // B puede tener CI histórico de push en main; si no, el mismo workflow
        // se despacha en la referencia fija de recuperación, sin nuevos permisos.
        { sha: CREDIT_HOTFIX.base, branch: 'main', event: 'push', fallback: CREDIT_HOTFIX.recoveryBranch },
    ];
    for (const identity of identities) {
        let query = { workflow_id: 'ci.yml', head_sha: identity.sha, branch: identity.branch, event: identity.event };
        let runs = await pages(github.rest.actions.listWorkflowRuns, query, 'workflow_runs');
        if (!runs.length && identity.fallback) {
            query = { ...query, branch: identity.fallback, event: 'workflow_dispatch' };
            runs = await pages(github.rest.actions.listWorkflowRuns, query, 'workflow_runs');
        }
        if (!runs.length || runs.some(run => !runRepositoryMatches(run)
            || run.head_sha !== identity.sha || run.head_branch !== query.branch || run.event !== query.event
            || run.path !== '.github/workflows/ci.yml' || run.status !== 'completed' || run.conclusion !== 'success'
            || !positiveId(run.id))) fail('HOTFIX_CI_TERMINAL_SUCCESS_REQUIRED');
        for (const run of runs) {
            const jobs = await pages(github.rest.actions.listJobsForWorkflowRun, { run_id: run.id, filter: 'latest' }, 'jobs');
            if (REQUIRED_JOBS.some(name => jobs.filter(job => job.name === name && job.status === 'completed' && job.conclusion === 'success').length !== 1)) {
                fail('HOTFIX_CI_JOBS_REQUIRED');
            }
        }
    }
};

// Lee un único JSON del ZIP en memoria, acotado; no extrae paths del archivo.
// Artifacts v4: digest SHA256 del archivo, documentado por GitHub REST Actions.
const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
};
export const decodeEvidenceZip = bytes => {
    const b = Buffer.from(bytes);
    if (b.length < 22 || b.length > 131072) fail('HOTFIX_ARTIFACT_SIZE_INVALID');
    try {
        let end = -1;
        for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
            if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
        }
        if (end < 0 || b.readUInt16LE(end + 4) !== 0 || b.readUInt16LE(end + 6) !== 0
            || b.readUInt16LE(end + 8) !== 1 || b.readUInt16LE(end + 10) !== 1
            || end + 22 + b.readUInt16LE(end + 20) !== b.length) fail('HOTFIX_ARTIFACT_ZIP_INVALID');
        const central = b.readUInt32LE(end + 16);
        if (b.readUInt32LE(central) !== 0x02014b50) fail('HOTFIX_ARTIFACT_ZIP_INVALID');
        const flags = b.readUInt16LE(central + 8), method = b.readUInt16LE(central + 10);
        const compressed = b.readUInt32LE(central + 20), size = b.readUInt32LE(central + 24);
        const nameLength = b.readUInt16LE(central + 28), extra = b.readUInt16LE(central + 30), comment = b.readUInt16LE(central + 32);
        const local = b.readUInt32LE(central + 42);
        if (flags & 1 || ![0, 8].includes(method) || size > 32768 || compressed > 65536
            || b.toString('utf8', central + 46, central + 46 + nameLength) !== 'evidence.json'
            || central + 46 + nameLength + extra + comment !== end
            || b.readUInt32LE(end + 12) !== end - central
            || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 8) !== method
            || b.readUInt16LE(local + 6) !== flags) fail('HOTFIX_ARTIFACT_ZIP_INVALID');
        const localNameLength = b.readUInt16LE(local + 26), localExtraLength = b.readUInt16LE(local + 28);
        if (b.toString('utf8', local + 30, local + 30 + localNameLength) !== 'evidence.json') fail('HOTFIX_ARTIFACT_ZIP_INVALID');
        const start = local + 30 + localNameLength + localExtraLength;
        if (start + compressed > central) fail('HOTFIX_ARTIFACT_ZIP_INVALID');
        const payload = b.subarray(start, start + compressed);
        const decoded = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: 32768 });
        if (decoded.length !== size || crc32(decoded) !== b.readUInt32LE(central + 16)) fail('HOTFIX_ARTIFACT_ZIP_INVALID');
        return JSON.parse(decoded.toString('utf8'));
    } catch { fail('HOTFIX_ARTIFACT_ZIP_INVALID'); }
};
export const assessHotfixEvidence = ({ evidence, run, env, phase, environment, target }) => {
    const expectedKeys = ['version', 'case', 'phase', 'environment', 'action', 'target', 'candidate', 'base', 'controller',
        'manifest_digest', 'run_id', 'run_attempt', 'binding', 'previous_run_id', 'recovery_run_id'].sort();
    if (!evidence || Array.isArray(evidence) || JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(expectedKeys)
        || evidence.version !== 1 || evidence.case !== CREDIT_HOTFIX.case || evidence.phase !== phase
        || evidence.environment !== environment || evidence.target !== target
        || evidence.action !== (target === CREDIT_HOTFIX.base ? 'recover' : 'promote')
        || evidence.candidate !== CREDIT_HOTFIX.candidate || evidence.base !== CREDIT_HOTFIX.base
        || evidence.controller !== env.GITHUB_SHA || evidence.manifest_digest !== manifestDigest()
        || evidence.run_id !== run.id || evidence.run_attempt !== run.run_attempt
        || !manualControlRun(run, env, environment)
        || !['completed'].includes(run.status)
        || (phase === 'healthy' && run.conclusion !== 'success')
        || !['success', 'failure', 'cancelled'].includes(run.conclusion)
        || [evidence.previous_run_id, evidence.recovery_run_id].some(id => id !== null && !positiveId(id))
        || !bindingMatches(evidence.binding, env, environment)) fail('HOTFIX_EVIDENCE_INVALID');
    return evidence;
};
const readRunEvidence = async ({ github, env, run, phase, environment, target, optional = false }) => {
    if (!manualControlRun(run, env, environment)) {
        if (optional) return null;
        fail('HOTFIX_RUN_PROVENANCE_INVALID');
    }
    const artifacts = await pages(github.rest.actions.listWorkflowRunArtifacts, { run_id: run.id }, 'artifacts');
    const selected = artifacts.filter(artifact => artifact.name === artifactName(phase, environment));
    if (!selected.length && optional) return null;
    if (selected.length !== 1) fail('HOTFIX_ARTIFACT_REQUIRED');
    const artifact = selected[0];
    if (!positiveId(artifact.id) || artifact.expired !== false || !positiveId(artifact.size_in_bytes)
        || artifact.size_in_bytes > 131072 || artifact.workflow_run?.id !== run.id
        || artifact.workflow_run?.head_sha !== env.GITHUB_SHA || artifact.workflow_run?.head_branch !== 'main'
        || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')) fail('HOTFIX_ARTIFACT_METADATA_INVALID');
    const { data } = await safeRest(() => github.rest.actions.downloadArtifact({ ...REPO, artifact_id: artifact.id, archive_format: 'zip' }));
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) fail('HOTFIX_ARTIFACT_BYTES_INVALID');
    const bytes = Buffer.from(data instanceof ArrayBuffer ? data : data.buffer, data.byteOffset || 0, data.byteLength);
    if ('sha256:' + sha256(bytes) !== artifact.digest) fail('HOTFIX_ARTIFACT_DIGEST_MISMATCH');
    const decoded = decodeEvidenceZip(bytes);
    if (![CREDIT_HOTFIX.base, CREDIT_HOTFIX.candidate].includes(decoded?.target)) fail('HOTFIX_EVIDENCE_INVALID');
    if (!positiveId(decoded.run_attempt) || decoded.run_attempt > run.run_attempt) fail('HOTFIX_ATTEMPT_INVALID');
    // Un rerun conserva run_id/artifacts, pero cambia el intento y su resultado.
    // Verificar siempre el intento productor y sus jobs, nunca los de latest.
    const { data: sourceRun } = await safeRest(() => github.rest.actions.getWorkflowRunAttempt({
        ...REPO, run_id: run.id, attempt_number: decoded.run_attempt,
    }));
    if (!manualControlRun(sourceRun, env, environment) || sourceRun.id !== run.id
        || sourceRun.run_attempt !== decoded.run_attempt) fail('HOTFIX_ATTEMPT_PROVENANCE_INVALID');
    const evidence = assessHotfixEvidence({ evidence: decoded, run: sourceRun, env, phase, environment, target: decoded.target });
    if (evidence.target !== target) {
        if (optional) return null;
        fail('HOTFIX_EVIDENCE_TARGET_MISMATCH');
    }
    const jobs = await pages(github.rest.actions.listJobsForWorkflowRunAttempt,
        { run_id: sourceRun.id, attempt_number: sourceRun.run_attempt }, 'jobs');
    const name = environment === 'staging' ? 'deploy-staging' : 'deploy-production';
    const job = jobs.filter(item => item.name === name);
    if (job.length !== 1 || job[0].run_id !== sourceRun.id || job[0].head_sha !== env.GITHUB_SHA
        || (job[0].run_attempt !== undefined && job[0].run_attempt !== sourceRun.run_attempt)
        || job[0].status !== 'completed' || !['success', 'failure', 'cancelled'].includes(job[0].conclusion)
        || (phase === 'healthy' && job[0].conclusion !== 'success')) fail('HOTFIX_ATTEMPT_JOBS_MISMATCH');
    const webhook = environment === 'staging' ? 'Desplegar STAGING (webhook de Coolify)' : 'Desplegar PROD (webhook de Coolify)';
    if (job.length !== 1 || !Array.isArray(job[0].steps)
        || job[0].steps.filter(step => step.name === webhook && step.conclusion === 'success').length !== 1) fail('HOTFIX_REQUEST_NOT_PROVEN');
    if (phase === 'healthy') {
        const health = environment === 'staging' ? 'Verificar STAGING sano y en el candidato esperado' : 'Verificar PROD sano y en el candidato esperado';
        if (job[0].steps.filter(step => step.name === health && step.conclusion === 'success').length !== 1) fail('HOTFIX_HEALTH_NOT_PROVEN');
    }
    if (job[0].steps.filter(step => step.name === 'Conservar evidencia ' + phase && step.conclusion === 'success').length !== 1) {
        fail('HOTFIX_ARTIFACT_PRODUCER_NOT_PROVEN');
    }
    return { run: sourceRun, evidence };
};
const byId = async ({ github, env, id, phase = 'healthy', environment = 'staging', target }) => {
    if (!positiveId(id)) fail('HOTFIX_EVIDENCE_LINK_REQUIRED');
    const { data: run } = await safeRest(() => github.rest.actions.getWorkflowRun({ ...REPO, run_id: id }));
    return readRunEvidence({ github, env, run, phase, environment, target });
};
const latest = async ({ github, env, phase = 'healthy', environment = 'staging', target, optional = false }) => {
    const workflow_id = environment === 'staging' ? 'release-staging.yml' : 'release-production.yml';
    const runs = await pages(github.rest.actions.listWorkflowRuns, { workflow_id, head_sha: env.GITHUB_SHA, branch: 'main', event: 'workflow_dispatch' }, 'workflow_runs');
    for (const run of runs.sort((a, b) => b.id - a.id)) {
        const result = await readRunEvidence({ github, env, run, phase, environment, target, optional: true });
        if (result) return result;
    }
    if (optional) return null;
    fail('HOTFIX_RELEASE_EVIDENCE_REQUIRED');
};
const ordered = (later, earlier) => later.run.id !== earlier.run.id
    && Date.parse(later.run.created_at) > Date.parse(earlier.run.created_at);
const verifyRecoveryChain = async ({ github, env, final }) => {
    const recovered = await byId({ github, env, id: final.evidence.recovery_run_id, target: CREDIT_HOTFIX.base });
    const initial = await byId({ github, env, id: recovered.evidence.previous_run_id, target: CREDIT_HOTFIX.candidate });
    if (!ordered(final, recovered) || !ordered(recovered, initial)
        || JSON.stringify(final.evidence.binding) !== JSON.stringify(recovered.evidence.binding)
        || JSON.stringify(final.evidence.binding) !== JSON.stringify(initial.evidence.binding)) fail('HOTFIX_RECOVERY_ORDER_INVALID');
    return recovered;
};
const stageEnv = env => ({ ...env, HOTFIX_APP_URL: env.STAGING_URL, HOTFIX_APP_UUID: env.COOLIFY_STAGING_APPLICATION_UUID });
const productionEnv = env => ({ ...env, HOTFIX_APP_URL: env.PROD_URL, HOTFIX_APP_UUID: env.COOLIFY_PROD_APPLICATION_UUID });

export const prepareHotfixReleaseEvidence = async ({ github, env = process.env, phase, contextPath = CONTEXT_PATH }) => {
    assessCreditHotfix(env);
    expectedArtifactBinding(stageEnv(env), 'staging');
    if (phase === 'production') expectedArtifactBinding(productionEnv(env), 'production');
    const action = hotfixAction(env);
    let previous_run_id = null, recovery_run_id = null;
    if (phase === 'staging') {
        const bound = stageEnv(env);
        if (action === 'recover') {
            // Prueba de solicitud incluso si C nunca llegó sano; ese caso sirve
            // para recuperar, pero no acredita el ensayo C sano → B → C.
            await latest({ github, env: bound, phase: 'requested', target: CREDIT_HOTFIX.candidate });
            const initial = await latest({ github, env: bound, target: CREDIT_HOTFIX.candidate, optional: true });
            previous_run_id = initial?.run.id ?? null;
        } else {
            const recovered = await latest({ github, env: bound, target: CREDIT_HOTFIX.base, optional: true });
            if (recovered?.evidence.previous_run_id) {
                await byId({ github, env: bound, id: recovered.evidence.previous_run_id, target: CREDIT_HOTFIX.candidate });
                recovery_run_id = recovered.run.id;
            }
        }
    } else if (phase === 'production') {
        const boundStage = stageEnv(env);
        if (action === 'promote') {
            const final = await latest({ github, env: boundStage, target: CREDIT_HOTFIX.candidate });
            const recovered = await verifyRecoveryChain({ github, env: boundStage, final });
            previous_run_id = final.run.id; recovery_run_id = recovered.run.id;
        } else {
            // La solicitud debe provenir del mismo controlador y app, y haber
            // pasado staging/recovery. No exige health sano del C averiado.
            const request = await latest({ github, env: productionEnv(env), phase: 'requested', environment: 'production', target: CREDIT_HOTFIX.candidate });
            const final = await byId({ github, env: boundStage, id: request.evidence.previous_run_id, target: CREDIT_HOTFIX.candidate });
            await verifyRecoveryChain({ github, env: boundStage, final });
            const restoredStage = await latest({ github, env: boundStage, target: CREDIT_HOTFIX.base });
            previous_run_id = request.run.id; recovery_run_id = restoredStage.run.id;
        }
    } else fail('HOTFIX_PHASE_INVALID');
    const result = { controller: env.GITHUB_SHA, action, target: hotfixTarget(env), phase, previous_run_id, recovery_run_id };
    writeFileSync(contextPath, JSON.stringify(result));
    return result;
};
export const recordHotfixEvidence = ({ env = process.env, phase, environment, output = '.credit-hotfix-evidence/evidence.json', contextPath = CONTEXT_PATH, bind = artifactBinding }) => {
    assessCreditHotfix(env);
    if (!['requested', 'healthy'].includes(phase) || !['staging', 'production'].includes(environment)) fail('HOTFIX_PHASE_INVALID');
    let context;
    try { context = JSON.parse(readFileSync(contextPath, 'utf8')); } catch { fail('HOTFIX_CONTEXT_REQUIRED'); }
    if (context.controller !== env.GITHUB_SHA || context.action !== hotfixAction(env)
        || context.target !== hotfixTarget(env) || context.phase !== environment
        || [context.previous_run_id, context.recovery_run_id].some(id => id !== null && !positiveId(id))) fail('HOTFIX_CONTEXT_MISMATCH');
    const run_id = Number(env.GITHUB_RUN_ID), run_attempt = Number(env.GITHUB_RUN_ATTEMPT);
    if (!positiveId(run_id) || !positiveId(run_attempt)) fail('HOTFIX_RUN_ID_INVALID');
    const evidence = { version: 1, case: CREDIT_HOTFIX.case, phase, environment, action: context.action,
        target: context.target, candidate: CREDIT_HOTFIX.candidate, base: CREDIT_HOTFIX.base,
        controller: env.GITHUB_SHA, manifest_digest: manifestDigest(), run_id, run_attempt,
        binding: bind(env, environment), previous_run_id: context.previous_run_id, recovery_run_id: context.recovery_run_id };
    writeFileSync(output, JSON.stringify(evidence) + '\n', { flag: 'wx' });
    return evidence;
};
