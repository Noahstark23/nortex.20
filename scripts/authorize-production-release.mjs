import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { waitForExpectedRelease } from './verify-deployed-release.mjs';

const FULL_SHA = /^[a-f0-9]{40}$/;

// La intención se valida antes de cualquier llamada de red. Los códigos son
// estables y no interpolan entradas ni errores que puedan contener secretos.
export const assessProductionCandidate = (env) => {
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') return 'MANUAL_DISPATCH_REQUIRED';
    if (env.GITHUB_REF !== 'refs/heads/main') return 'MAIN_BRANCH_REQUIRED';
    if (env.NORTEX_PRODUCTION_DEPLOY_ENABLED !== 'true') return 'PRODUCTION_DEPLOY_DISABLED';

    const candidate = env.CANDIDATE_SHA;
    if (typeof candidate !== 'string' || !FULL_SHA.test(candidate)) return 'FULL_CANDIDATE_SHA_REQUIRED';
    if (candidate !== env.GITHUB_SHA) return 'WORKFLOW_SHA_MISMATCH';
    if (env.PRODUCTION_CONFIRMATION !== `PROMOTE ${candidate}`) return 'TYPED_CONFIRMATION_REQUIRED';
    return null;
};

export const validStagingUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && Boolean(url.hostname)
            && !url.username
            && !url.password
            && !url.search
            && !url.hash;
    } catch {
        return false;
    }
};

export const readCurrentMain = (git = execFileSync) => {
    const output = git('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], {
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const match = /^([a-f0-9]{40})\trefs\/heads\/main\r?\n?$/.exec(output);
    if (!match) throw new Error('MAIN_HEAD_UNAVAILABLE');
    return match[1];
};

export const authorizeProductionRelease = async ({
    env = process.env,
    verifyStaging = waitForExpectedRelease,
    readMain = readCurrentMain,
} = {}) => {
    const rejection = assessProductionCandidate(env);
    if (rejection) throw new Error(rejection);
    if (!validStagingUrl(env.STAGING_URL)) throw new Error('VALID_STAGING_URL_REQUIRED');

    try {
        // No esperamos a que staging se ponga al día: debe estar sano en el
        // candidato exacto al inicio de preflight y otra vez tras la aprobación.
        await verifyStaging({
            baseUrl: env.STAGING_URL,
            expectedCommit: env.CANDIDATE_SHA,
            attempts: 1,
            timeoutMs: 5_000,
        });
    } catch {
        throw new Error('STAGING_RELEASE_NOT_VERIFIED');
    }

    let currentMain;
    try {
        currentMain = readMain();
    } catch {
        throw new Error('MAIN_HEAD_UNAVAILABLE');
    }
    if (currentMain !== env.CANDIDATE_SHA) throw new Error('MAIN_HEAD_MOVED');
    return env.CANDIDATE_SHA;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const sha = await authorizeProductionRelease();
        console.log(`Candidato de producción autorizado: ${sha}`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'UNKNOWN_GATE_FAILURE';
        console.error(`Compuerta de producción cerrada: ${reason}`);
        process.exitCode = 1;
    }
}
