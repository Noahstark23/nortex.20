// Solo lectura: nunca modifica la aplicación ni dispara /deploy. No conservar
// ni imprimir la respuesta completa: Coolify puede incluir campos sensibles.
export const parseCoolifyProductionTarget = (env) => {
    const token = env.COOLIFY_TOKEN;
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
        throw new Error('COOLIFY_API_TOKEN_REQUIRED');
    }
    try {
        const webhook = env.COOLIFY_PROD_WEBHOOK;
        if (typeof webhook !== 'string' || webhook.trim() !== webhook || /[\x00-\x20\x7f]/.test(webhook)) {
            throw new Error('invalid');
        }
        const url = new URL(webhook);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.pathname !== '/api/v1/deploy') {
            throw new Error('invalid');
        }
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => !['uuid', 'force'].includes(key)) || new Set(keys).size !== keys.length) {
            throw new Error('invalid');
        }
        const uuid = url.searchParams.get('uuid');
        if (!uuid || uuid.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(uuid)) throw new Error('invalid');
        if (url.searchParams.has('force') && !['true', 'false'].includes(url.searchParams.get('force'))) {
            throw new Error('invalid');
        }
        return { uuid, applicationUrl: new URL(`/api/v1/applications/${uuid}`, url.origin).href };
    } catch {
        throw new Error('SINGLE_COOLIFY_DEPLOY_TARGET_REQUIRED');
    }
};

export const verifyCoolifyProductionTarget = async ({ env, fetchImpl = globalThis.fetch }) => {
    const target = parseCoolifyProductionTarget(env);
    let application;
    try {
        const response = await fetchImpl(target.applicationUrl, {
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${env.COOLIFY_TOKEN}` },
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
    if (application.git_commit_sha !== env.PRODUCTION_SHA) throw new Error('COOLIFY_COMMIT_NOT_PINNED');
    // Nortex construye su Dockerfile desde Git. Un build de imagen externa
    // podría ignorar el pin Git aunque el campo siguiera presente.
    if (application.build_pack !== 'dockerfile') throw new Error('COOLIFY_GIT_DOCKERFILE_REQUIRED');
    if (application.settings?.is_auto_deploy_enabled !== false) throw new Error('COOLIFY_AUTO_DEPLOY_NOT_DISABLED');
};
