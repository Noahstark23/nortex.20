import { pathToFileURL } from 'node:url';

// Un reemplazo de contenedor puede devolver 503 mientras el nuevo proceso sube.
// El reintento tiene una ventana total real de ocho minutos, incluso si cada
// request consume sus cinco segundos de timeout. Nunca se acepta un 503 como una
// release sana.
/** @type {Readonly<{ attempts: number, intervalMs: number, timeoutMs: number, deadlineMs: number }>} */
export const DEPLOYED_HEALTH_RETRY = Object.freeze({
    attempts: 97,
    intervalMs: 5_000,
    timeoutMs: 5_000,
    deadlineMs: 8 * 60_000,
});

const invalidAppUrl = () => new Error('APP_URL_INVALID');

const hasNoStore = (headers) => {
    const value = headers?.get?.('cache-control');
    return typeof value === 'string'
        && value.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store');
};

export const assessReleaseHealth = (payload, expectedCommit) => {
    if (!expectedCommit || typeof expectedCommit !== 'string') {
        return { ready: false, reason: 'EXPECTED_COMMIT_REQUIRED' };
    }
    if (!payload || typeof payload !== 'object') {
        return { ready: false, reason: 'INVALID_PAYLOAD' };
    }
    if (payload.ok !== true || payload.db !== 'up') {
        return { ready: false, reason: 'UNHEALTHY' };
    }
    if (typeof payload.commit !== 'string' || payload.commit.length === 0) {
        return { ready: false, reason: 'COMMIT_MISSING' };
    }
    if (payload.commit !== expectedCommit) {
        return { ready: false, reason: 'COMMIT_MISMATCH' };
    }
    return { ready: true, reason: 'READY', observedCommit: payload.commit };
};

export const healthUrlFor = (baseUrl) => {
    const rawAuthority = typeof baseUrl === 'string'
        ? /^https?:\/\/([^/]+)/i.exec(baseUrl)?.[1]
        : null;
    if (typeof baseUrl !== 'string'
        || !baseUrl
        || baseUrl.trim() !== baseUrl
        || /[\x00-\x20\x7f]/.test(baseUrl)
        || baseUrl.includes('?')
        || baseUrl.includes('#')
        || !rawAuthority
        || rawAuthority.includes('@')) {
        throw invalidAppUrl();
    }

    let url;
    try {
        url = new URL(baseUrl);
    } catch {
        throw invalidAppUrl();
    }

    if (!['http:', 'https:'].includes(url.protocol)
        || !url.hostname
        || url.username
        || url.password
        || url.search
        || url.hash) {
        throw invalidAppUrl();
    }

    const cleanPath = url.pathname.replace(/\/+$/, '');
    url.pathname = cleanPath.endsWith('/api/health')
        ? cleanPath
        : `${cleanPath}/api/health`;
    return url.toString();
};

const positiveInteger = (value, fallback) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const waitForExpectedRelease = async ({
    baseUrl,
    expectedCommit,
    attempts = DEPLOYED_HEALTH_RETRY.attempts,
    intervalMs = DEPLOYED_HEALTH_RETRY.intervalMs,
    timeoutMs = DEPLOYED_HEALTH_RETRY.timeoutMs,
    deadlineMs = DEPLOYED_HEALTH_RETRY.deadlineMs,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    now = () => Date.now(),
}) => {
    const healthUrl = healthUrlFor(baseUrl);
    let lastReason = 'NOT_CHECKED';
    const deadlineAt = now() + deadlineMs;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const requestBudgetMs = deadlineAt - now();
        if (requestBudgetMs <= 0) break;
        try {
            const response = await fetchImpl(healthUrl, {
                // La app responde no-store; pedirlo también evita que un proxy
                // ignore por accidente esa política al observar el SHA vivo.
                cache: 'no-store',
                headers: { accept: 'application/json', 'cache-control': 'no-cache' },
                redirect: 'error',
                signal: AbortSignal.timeout(Math.min(timeoutMs, requestBudgetMs)),
            });

            if (!response.ok) {
                lastReason = Number.isInteger(response.status) ? `HTTP_${response.status}` : 'HTTP_UNEXPECTED';
            } else if (!hasNoStore(response.headers)) {
                // Un request no-cache no corrige un proxy que entrega una
                // respuesta almacenada. Sin esta política observada, el SHA
                // no es evidencia fresca del despliegue esperado.
                lastReason = 'CACHE_POLICY_MISSING';
            } else {
                const payload = await response.json();
                const assessment = assessReleaseHealth(payload, expectedCommit);

                if (assessment.ready) {
                    return { healthUrl, payload, attemptsUsed: attempt };
                }

                lastReason = assessment.reason;
            }
        } catch {
            // Los errores de red y de parseo pueden reflejar URL o contenido remoto.
            // El job expone solamente un código estable para no filtrar esa entrada.
            lastReason = 'REQUEST_FAILED';
        }

        const sleepBudgetMs = deadlineAt - now();
        if (attempt < attempts && sleepBudgetMs > 0) {
            await sleep(Math.min(intervalMs, sleepBudgetMs));
        }
    }

    throw new Error(
        `La release esperada no apareció sana. Último estado: ${lastReason}`,
    );
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const [, , baseUrl, expectedCommit] = process.argv;
    if (!baseUrl || !expectedCommit) {
        console.error('Uso: node scripts/verify-deployed-release.mjs <APP_URL> <EXPECTED_COMMIT>');
        process.exitCode = 2;
    } else {
        try {
            const result = await waitForExpectedRelease({
                baseUrl,
                expectedCommit,
                attempts: positiveInteger(process.env.HEALTH_ATTEMPTS, DEPLOYED_HEALTH_RETRY.attempts),
                intervalMs: positiveInteger(process.env.HEALTH_INTERVAL_MS, DEPLOYED_HEALTH_RETRY.intervalMs),
                timeoutMs: positiveInteger(process.env.HEALTH_TIMEOUT_MS, DEPLOYED_HEALTH_RETRY.timeoutMs),
            });
            console.log(`✅ La aplicación sirve ${expectedCommit} y la base de datos está arriba.`);
        } catch (error) {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        }
    }
}
