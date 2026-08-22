import { pathToFileURL } from 'node:url';

const DEFAULT_ATTEMPTS = 48;
const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;

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
    if (payload.commit !== expectedCommit) {
        return { ready: false, reason: 'COMMIT_MISMATCH', observedCommit: payload.commit ?? null };
    }
    return { ready: true, reason: 'READY', observedCommit: payload.commit };
};

export const healthUrlFor = (baseUrl) => {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('APP_URL debe usar http:// o https://');
    }
    const cleanPath = url.pathname.replace(/\/+$/, '');
    url.pathname = cleanPath.endsWith('/api/health')
        ? cleanPath
        : `${cleanPath}/api/health`;
    url.search = '';
    url.hash = '';
    return url.toString();
};

const positiveInteger = (value, fallback) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const waitForExpectedRelease = async ({
    baseUrl,
    expectedCommit,
    attempts = DEFAULT_ATTEMPTS,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
}) => {
    const healthUrl = healthUrlFor(baseUrl);
    let lastReason = 'NOT_CHECKED';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetchImpl(healthUrl, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(timeoutMs),
            });
            const payload = await response.json();
            const assessment = assessReleaseHealth(payload, expectedCommit);

            if (response.ok && assessment.ready) {
                return { healthUrl, payload, attemptsUsed: attempt };
            }

            lastReason = response.ok ? assessment.reason : `HTTP_${response.status}`;
            if (assessment.observedCommit) {
                lastReason += `:${assessment.observedCommit}`;
            }
        } catch (error) {
            lastReason = error instanceof Error ? error.message : 'REQUEST_FAILED';
        }

        if (attempt < attempts) await sleep(intervalMs);
    }

    throw new Error(
        `La release ${expectedCommit} no apareció sana en ${healthUrl}. Último estado: ${lastReason}`,
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
                attempts: positiveInteger(process.env.HEALTH_ATTEMPTS, DEFAULT_ATTEMPTS),
                intervalMs: positiveInteger(process.env.HEALTH_INTERVAL_MS, DEFAULT_INTERVAL_MS),
                timeoutMs: positiveInteger(process.env.HEALTH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
            });
            console.log(`✅ ${result.healthUrl} sirve ${expectedCommit} y la base de datos está arriba.`);
        } catch (error) {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        }
    }
}
