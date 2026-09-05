import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { waitForExpectedRelease } from './verify-deployed-release.mjs';
import { parseCoolifyProductionTarget, verifyCoolifyProductionTarget } from './verify-coolify-production-target.mjs';

const FULL_SHA = /^[a-f0-9]{40}$/;

// No imprime entradas de usuario ni errores de red/git (pueden contener URLs
// privadas). Los códigos estables identifican qué condición cerró la compuerta.
export const assessProductionIntent = (env) => {
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') return 'MANUAL_DISPATCH_REQUIRED';
    if (env.GITHUB_REF !== 'refs/heads/main') return 'MAIN_BRANCH_REQUIRED';
    if (env.NORTEX_DEPLOY_ENABLED !== 'true') return 'DEPLOY_DISABLED';
    if (env.PRODUCTION_APPROVED !== 'true') return 'PRODUCTION_APPROVAL_REQUIRED';
    if (env.PRODUCTION_SHA?.length !== 40 || !FULL_SHA.test(env.PRODUCTION_SHA)) return 'FULL_PRODUCTION_SHA_REQUIRED';
    if (env.PRODUCTION_SHA !== env.GITHUB_SHA) return 'WORKFLOW_SHA_MISMATCH';
    return null;
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
    verifyCoolify = verifyCoolifyProductionTarget,
} = {}) => {
    const rejection = assessProductionIntent(env);
    if (rejection) throw new Error(rejection);

    try {
        const url = new URL(env.STAGING_URL);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
            throw new Error('invalid');
        }
    } catch {
        throw new Error('VALID_STAGING_URL_REQUIRED');
    }
    parseCoolifyProductionTarget(env);

    try {
        // Tras la aprobación no esperamos a que una versión distinta sea
        // reemplazada: staging debe seguir sano y en este SHA en ese momento.
        await verifyStaging({
            baseUrl: env.STAGING_URL,
            expectedCommit: env.PRODUCTION_SHA,
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
    if (currentMain !== env.PRODUCTION_SHA) throw new Error('MAIN_HEAD_MOVED');
    await verifyCoolify({ env });
    return env.PRODUCTION_SHA;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const sha = await authorizeProductionRelease();
        console.log(`Producción autorizada para ${sha}; main, staging y pin de Coolify coinciden.`);
    } catch (error) {
        console.error(`Compuerta de producción cerrada: ${error.message}`);
        process.exitCode = 1;
    }
}
