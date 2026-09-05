// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
    assessProductionCandidate,
    authorizeProductionRelease,
    readCurrentMain,
    validStagingUrl,
} from '../scripts/authorize-production-release.mjs';
import {
    DEPLOYED_HEALTH_RETRY,
    waitForExpectedRelease,
} from '../scripts/verify-deployed-release.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const approved = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: SHA,
    NORTEX_PRODUCTION_DEPLOY_ENABLED: 'true',
    CANDIDATE_SHA: SHA,
    PRODUCTION_CONFIRMATION: `PROMOTE ${SHA}`,
    STAGING_URL: 'https://staging.example.test',
};

describe('compuerta de producción por candidato explícito, main y staging', () => {
    it.each([
        [{ GITHUB_EVENT_NAME: 'push' }, 'MANUAL_DISPATCH_REQUIRED'],
        [{ GITHUB_EVENT_NAME: 'pull_request' }, 'MANUAL_DISPATCH_REQUIRED'],
        [{ GITHUB_EVENT_NAME: '' }, 'MANUAL_DISPATCH_REQUIRED'],
        [{ GITHUB_REF: 'refs/heads/release' }, 'MAIN_BRANCH_REQUIRED'],
        [{ GITHUB_REF: 'refs/tags/main' }, 'MAIN_BRANCH_REQUIRED'],
        [{ NORTEX_PRODUCTION_DEPLOY_ENABLED: '' }, 'PRODUCTION_DEPLOY_DISABLED'],
        [{ NORTEX_PRODUCTION_DEPLOY_ENABLED: 'false' }, 'PRODUCTION_DEPLOY_DISABLED'],
        [{ CANDIDATE_SHA: '' }, 'FULL_CANDIDATE_SHA_REQUIRED'],
        [{ CANDIDATE_SHA: SHA.slice(0, 7) }, 'FULL_CANDIDATE_SHA_REQUIRED'],
        [{ CANDIDATE_SHA: SHA.toUpperCase() }, 'FULL_CANDIDATE_SHA_REQUIRED'],
        [{ CANDIDATE_SHA: `${SHA}\n` }, 'FULL_CANDIDATE_SHA_REQUIRED'],
        [{ CANDIDATE_SHA: OTHER_SHA }, 'WORKFLOW_SHA_MISMATCH'],
        [{ GITHUB_SHA: '' }, 'WORKFLOW_SHA_MISMATCH'],
        [{ PRODUCTION_CONFIRMATION: '' }, 'TYPED_CONFIRMATION_REQUIRED'],
        [{ PRODUCTION_CONFIRMATION: `PROMOTE ${OTHER_SHA}` }, 'TYPED_CONFIRMATION_REQUIRED'],
        [{ PRODUCTION_CONFIRMATION: `PROMOTE ${SHA} ` }, 'TYPED_CONFIRMATION_REQUIRED'],
    ])('cierra antes de red o git ante %j', async (patch, reason) => {
        const verifyStaging = vi.fn();
        const readMain = vi.fn();
        const env = { ...approved, ...patch };
        expect(assessProductionCandidate(env)).toBe(reason);
        await expect(authorizeProductionRelease({ env, verifyStaging, readMain })).rejects.toThrow(reason);
        expect(verifyStaging).not.toHaveBeenCalled();
        expect(readMain).not.toHaveBeenCalled();
    });

    it.each([
        '',
        'http://staging.example.test',
        'https://user:secret@staging.example.test',
        'https://staging.example.test?token=private',
        'https://staging.example.test#private',
        ' https://staging.example.test',
        'https://staging.example.test?',
        'https://staging.example.test#',
        'https://@staging.example.test',
        'https:///api/health',
    ])('rechaza staging inválido sin consultarlo: %s', async (STAGING_URL) => {
        const verifyStaging = vi.fn();
        await expect(authorizeProductionRelease({
            env: { ...approved, STAGING_URL },
            verifyStaging,
        })).rejects.toThrow('VALID_STAGING_URL_REQUIRED');
        expect(verifyStaging).not.toHaveBeenCalled();
    });

    it('acepta únicamente un origen HTTPS raíz de staging sin credenciales, query ni fragmento', () => {
        expect(validStagingUrl('https://staging.example.test')).toBe(true);
        expect(validStagingUrl('https://staging.example.test/')).toBe(true);
        expect(validStagingUrl('https://staging.example.test/release')).toBe(false);
        expect(validStagingUrl('https://staging.example.test\\release')).toBe(false);
        expect(validStagingUrl('https://staging.example.test/.')).toBe(false);
        expect(validStagingUrl('https://staging.example.test/%2e')).toBe(false);
        expect(validStagingUrl('https://staging.example.test/release/..')).toBe(false);
        expect(validStagingUrl('ftp://staging.example.test')).toBe(false);
    });

    it.each([
        { status: 503, payload: { ok: true, db: 'up', commit: SHA } },
        { status: 200, payload: { ok: false, db: 'up', commit: SHA } },
        { status: 200, payload: { ok: true, db: 'down', commit: SHA } },
        { status: 200, payload: { ok: true, db: 'up', commit: OTHER_SHA } },
        { status: 200, payload: { ok: true, db: 'up' } },
    ])('rechaza staging sin prueba sana del SHA: %j', async ({ status, payload }) => {
        const readMain = vi.fn();
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: status === 200,
            status,
            headers: new Headers({ 'cache-control': 'no-store' }),
            json: async () => payload,
        });
        const verifyStaging = (options) => waitForExpectedRelease({
            ...options,
            attempts: 1,
            fetchImpl,
        });
        await expect(authorizeProductionRelease({ env: approved, verifyStaging, readMain }))
            .rejects.toThrow('STAGING_RELEASE_NOT_VERIFIED');
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(readMain).not.toHaveBeenCalled();
    });

    it('cierra si main avanza o la consulta remota deja de ser confiable', async () => {
        const verifyStaging = vi.fn().mockResolvedValue({});
        await expect(authorizeProductionRelease({
            env: approved,
            verifyStaging,
            readMain: () => OTHER_SHA,
        })).rejects.toThrow('MAIN_HEAD_MOVED');
        await expect(authorizeProductionRelease({
            env: approved,
            verifyStaging,
            readMain: () => { throw new Error('private remote URL'); },
        })).rejects.toThrow('MAIN_HEAD_UNAVAILABLE');
    });

    it('autoriza solo después de comprobar staging y después main vigente', async () => {
        const order: string[] = [];
        const fetchImpl = vi.fn().mockImplementation(async () => {
            order.push('staging');
            return {
                ok: true,
                status: 200,
                headers: new Headers({ 'cache-control': 'no-store' }),
                json: async () => ({ ok: true, db: 'up', commit: SHA }),
            };
        });
        const verifyStaging = vi.fn((options) => waitForExpectedRelease({ ...options, fetchImpl }));
        const result = await authorizeProductionRelease({
            env: approved,
            verifyStaging,
            readMain: () => {
                order.push('main');
                return SHA;
            },
        });

        expect(result).toBe(SHA);
        expect(order).toEqual(['staging', 'main']);
        expect(verifyStaging).toHaveBeenCalledWith({
            baseUrl: approved.STAGING_URL,
            expectedCommit: SHA,
            ...DEPLOYED_HEALTH_RETRY,
        });
    });

    it('espera una salud exacta de staging después de un 503 transitorio', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'cache-control': 'no-store' }),
                json: async () => ({ ok: true, db: 'up', commit: SHA }),
            });
        const sleep = vi.fn().mockResolvedValue(undefined);
        const verifyStaging = vi.fn((options) => waitForExpectedRelease({
            ...options,
            fetchImpl,
            sleep,
        }));

        await expect(authorizeProductionRelease({
            env: approved,
            verifyStaging,
            readMain: () => SHA,
        })).resolves.toBe(SHA);

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledOnce();
        expect(verifyStaging).toHaveBeenCalledWith({
            baseUrl: approved.STAGING_URL,
            expectedCommit: SHA,
            ...DEPLOYED_HEALTH_RETRY,
        });
    });

    it('consulta únicamente la referencia remota main, sin ejecutar entradas como shell', () => {
        const git = vi.fn().mockReturnValue(`${SHA}\trefs/heads/main\n`);
        expect(readCurrentMain(git)).toBe(SHA);
        expect(git).toHaveBeenCalledWith('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], {
            encoding: 'utf8',
            timeout: 30_000,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    });

    it.each([
        '',
        `${SHA}\trefs/heads/release\n`,
        `${SHA}\trefs/heads/main\n${OTHER_SHA}\trefs/heads/main\n`,
        `${SHA.slice(0, 7)}\trefs/heads/main\n`,
    ])('rechaza una respuesta remota ausente o ambigua: %j', (response) => {
        expect(() => readCurrentMain(vi.fn().mockReturnValue(response))).toThrow('MAIN_HEAD_UNAVAILABLE');
    });

    it.each(['push', 'workflow_dispatch'])('el CLI no revela configuración privada ni toca staging sin autorización (%s)', (event) => {
        const result = spawnSync(process.execPath, ['scripts/authorize-production-release.mjs'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                ...approved,
                GITHUB_EVENT_NAME: event,
                NORTEX_PRODUCTION_DEPLOY_ENABLED: 'false',
                STAGING_URL: 'https://private.invalid?secret=DO_NOT_LOG',
            },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Compuerta de producción cerrada');
        expect(result.stdout).toBe('');
        expect(result.stderr).not.toMatch(/private|DO_NOT_LOG/);
    });

    it('el CLI no revela una URL insegura de staging', () => {
        const privateStagingUrl = 'https://user:secret@staging.example.test?token=DO_NOT_LOG';
        const result = spawnSync(process.execPath, ['scripts/authorize-production-release.mjs'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                ...approved,
                STAGING_URL: privateStagingUrl,
            },
        });
        expect(result.status).toBe(1);
        expect(result.stderr.trim()).toBe('Compuerta de producción cerrada: VALID_STAGING_URL_REQUIRED');
        expect(result.stdout).toBe('');
        expect(result.stderr).not.toMatch(/user|secret|DO_NOT_LOG|staging/);
    });
});
