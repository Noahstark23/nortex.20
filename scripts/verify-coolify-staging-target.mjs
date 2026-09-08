import { pathToFileURL } from 'node:url';

// Solo lectura: nunca modifica una aplicación ni dispara /deploy. El webhook
// es una capacidad de escritura; su URL no puede elegir a dónde se envía el
// token de lectura de staging.
export const parseCoolifyStagingTarget = (env) => {
    const token = env.COOLIFY_STAGING_READ_TOKEN;
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
        throw new Error('COOLIFY_STAGING_READ_TOKEN_REQUIRED');
    }
    if (typeof env.CANDIDATE_SHA !== 'string' || !/^[a-f0-9]{40}$/.test(env.CANDIDATE_SHA)) {
        throw new Error('CANDIDATE_SHA_REQUIRED');
    }

    try {
        const apiOrigin = env.COOLIFY_STAGING_API_ORIGIN;
        if (typeof apiOrigin !== 'string'
            || apiOrigin.trim() !== apiOrigin
            || /[\x00-\x20\x7f]/.test(apiOrigin)) {
            throw new Error('invalid');
        }
        const trustedApi = new URL(apiOrigin);
        if (trustedApi.protocol !== 'https:'
            || trustedApi.username
            || trustedApi.password
            || trustedApi.search
            || trustedApi.hash
            || trustedApi.pathname !== '/') {
            throw new Error('invalid');
        }

        const expectedUuid = env.COOLIFY_STAGING_APPLICATION_UUID;
        if (typeof expectedUuid !== 'string'
            || !expectedUuid
            || expectedUuid.length > 128
            || !/^[a-zA-Z0-9_-]+$/.test(expectedUuid)) {
            throw new Error('invalid');
        }

        const webhook = env.COOLIFY_STAGING_WEBHOOK;
        if (typeof webhook !== 'string' || webhook.trim() !== webhook || /[\x00-\x20\x7f]/.test(webhook)) {
            throw new Error('invalid');
        }
        const url = new URL(webhook);
        if (url.protocol !== 'https:'
            || url.username
            || url.password
            || url.hash
            || url.pathname !== '/api/v1/deploy'
            || url.origin !== trustedApi.origin) {
            throw new Error('invalid');
        }
        const keys = [...url.searchParams.keys()];
        if (keys.some((key) => !['uuid', 'force'].includes(key)) || new Set(keys).size !== keys.length) {
            throw new Error('invalid');
        }
        if (url.searchParams.get('uuid') !== expectedUuid) throw new Error('invalid');
        if (url.searchParams.has('force') && !['true', 'false'].includes(url.searchParams.get('force'))) {
            throw new Error('invalid');
        }
        return {
            uuid: expectedUuid,
            applicationUrl: new URL(`/api/v1/applications/${expectedUuid}`, trustedApi.origin).href,
        };
    } catch {
        throw new Error('TRUSTED_COOLIFY_STAGING_TARGET_REQUIRED');
    }
};

export const verifyCoolifyStagingTarget = async ({ env = process.env, fetchImpl = globalThis.fetch } = {}) => {
    const target = parseCoolifyStagingTarget(env);
    let application;
    try {
        const response = await fetchImpl(target.applicationUrl, {
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${env.COOLIFY_STAGING_READ_TOKEN}` },
            redirect: 'error',
            signal: AbortSignal.timeout(5_000),
        });
        if (response.status !== 200) throw new Error('invalid');
        application = await response.json();
    } catch {
        throw new Error('COOLIFY_TARGET_UNAVAILABLE');
    }

    if (!application || Array.isArray(application) || application.uuid !== target.uuid) {
        throw new Error('COOLIFY_APPLICATION_MISMATCH');
    }
    if (application.git_commit_sha !== env.CANDIDATE_SHA) throw new Error('COOLIFY_COMMIT_NOT_PINNED');
    if (!['dockerfile', 'dockercompose'].includes(application.build_pack)) {
        throw new Error('COOLIFY_GIT_BUILD_PACK_REQUIRED');
    }
    if (application.settings?.is_auto_deploy_enabled !== false) {
        throw new Error('COOLIFY_AUTO_DEPLOY_NOT_DISABLED');
    }
    return env.CANDIDATE_SHA;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const sha = await verifyCoolifyStagingTarget();
        console.log(`Destino de staging fijado al candidato: ${sha}`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'UNKNOWN_GATE_FAILURE';
        console.error(`Compuerta de staging cerrada: ${reason}`);
        process.exitCode = 1;
    }
}
