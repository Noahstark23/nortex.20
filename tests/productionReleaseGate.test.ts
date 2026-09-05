// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { assessProductionIntent, authorizeProductionRelease, readCurrentMain } from '../scripts/authorize-production-release.mjs';
import { waitForExpectedRelease } from '../scripts/verify-deployed-release.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const approved = {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: SHA,
    NORTEX_DEPLOY_ENABLED: 'true',
    PRODUCTION_APPROVED: 'true',
    PRODUCTION_SHA: SHA,
    STAGING_URL: 'https://staging.example.test',
    COOLIFY_PROD_WEBHOOK: 'https://coolify.example.test/api/v1/deploy?uuid=production-app',
    COOLIFY_TOKEN: 'synthetic-token',
};

describe('autorización de producción por intención, main y staging', () => {
    it.each([
        [{ GITHUB_EVENT_NAME: 'push' }, 'MANUAL_DISPATCH_REQUIRED'],
        [{ GITHUB_EVENT_NAME: 'pull_request' }, 'MANUAL_DISPATCH_REQUIRED'],
        [{ GITHUB_EVENT_NAME: '' }, 'MANUAL_DISPATCH_REQUIRED'],
        [{ GITHUB_REF: 'refs/heads/release' }, 'MAIN_BRANCH_REQUIRED'],
        [{ GITHUB_REF: 'refs/tags/main' }, 'MAIN_BRANCH_REQUIRED'],
        [{ NORTEX_DEPLOY_ENABLED: '' }, 'DEPLOY_DISABLED'],
        [{ NORTEX_DEPLOY_ENABLED: 'false' }, 'DEPLOY_DISABLED'],
        [{ PRODUCTION_APPROVED: '' }, 'PRODUCTION_APPROVAL_REQUIRED'],
        [{ PRODUCTION_APPROVED: 'false' }, 'PRODUCTION_APPROVAL_REQUIRED'],
        [{ PRODUCTION_APPROVED: '1' }, 'PRODUCTION_APPROVAL_REQUIRED'],
        [{ PRODUCTION_APPROVED: 'true ' }, 'PRODUCTION_APPROVAL_REQUIRED'],
        [{ PRODUCTION_SHA: '' }, 'FULL_PRODUCTION_SHA_REQUIRED'],
        [{ PRODUCTION_SHA: SHA.slice(0, 7) }, 'FULL_PRODUCTION_SHA_REQUIRED'],
        [{ PRODUCTION_SHA: SHA.toUpperCase() }, 'FULL_PRODUCTION_SHA_REQUIRED'],
        [{ PRODUCTION_SHA: `${SHA}\n` }, 'FULL_PRODUCTION_SHA_REQUIRED'],
        [{ PRODUCTION_SHA: OTHER_SHA }, 'WORKFLOW_SHA_MISMATCH'],
        [{ GITHUB_SHA: '' }, 'WORKFLOW_SHA_MISMATCH'],
    ])('cierra antes de red o git ante %j', async (patch, reason) => {
        const verifyStaging = vi.fn();
        const readMain = vi.fn();
        const env = { ...approved, ...patch };
        expect(assessProductionIntent(env)).toBe(reason);
        await expect(authorizeProductionRelease({ env, verifyStaging, readMain })).rejects.toThrow(reason);
        expect(verifyStaging).not.toHaveBeenCalled();
        expect(readMain).not.toHaveBeenCalled();
    });

    it.each(['', 'http://staging.example.test', 'https://user:secret@staging.example.test', 'https://staging.example.test?token=private', 'https://staging.example.test#private'])('rechaza configuración de staging inválida sin exponerla', async (STAGING_URL) => {
        const verifyStaging = vi.fn();
        await expect(authorizeProductionRelease({ env: { ...approved, STAGING_URL }, verifyStaging })).rejects.toThrow('VALID_STAGING_URL_REQUIRED');
        expect(verifyStaging).not.toHaveBeenCalled();
    });

    it.each([
        { status: 503, payload: { ok: true, db: 'up', commit: SHA } },
        { status: 200, payload: { ok: false, db: 'up', commit: SHA } },
        { status: 200, payload: { ok: true, db: 'down', commit: SHA } },
        { status: 200, payload: { ok: true, db: 'up', commit: OTHER_SHA } },
        { status: 200, payload: { ok: true, db: 'up' } },
    ])('rechaza staging sin prueba sana del mismo SHA: %j', async ({ status, payload }) => {
        const readMain = vi.fn();
        const fetchImpl = vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => payload });
        const verifyStaging = (options) => waitForExpectedRelease({ ...options, fetchImpl });
        await expect(authorizeProductionRelease({ env: approved, verifyStaging, readMain })).rejects.toThrow('STAGING_RELEASE_NOT_VERIFIED');
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(readMain).not.toHaveBeenCalled();
    });

    it('cierra si se perdió conexión o main avanzó mientras se esperaba aprobación', async () => {
        const verifyStaging = vi.fn().mockResolvedValue({});
        await expect(authorizeProductionRelease({ env: approved, verifyStaging, readMain: () => OTHER_SHA })).rejects.toThrow('MAIN_HEAD_MOVED');
        await expect(authorizeProductionRelease({ env: approved, verifyStaging, readMain: () => { throw new Error('private remote URL'); } })).rejects.toThrow('MAIN_HEAD_UNAVAILABLE');
    });

    it('autoriza el SHA completo solo tras comprobar staging y después main vigente', async () => {
        const order: string[] = [];
        const fetchImpl = vi.fn().mockImplementation(async () => {
            order.push('staging');
            return { ok: true, json: async () => ({ ok: true, db: 'up', commit: SHA }) };
        });
        const verifyStaging = vi.fn((options) => waitForExpectedRelease({ ...options, fetchImpl }));
        const verifyCoolify = vi.fn(async () => { order.push('coolify'); });
        const result = await authorizeProductionRelease({ env: approved, verifyStaging, readMain: () => { order.push('main'); return SHA; }, verifyCoolify });
        expect(result).toBe(SHA);
        expect(order).toEqual(['staging', 'main', 'coolify']);
        expect(verifyStaging).toHaveBeenCalledWith({ baseUrl: approved.STAGING_URL, expectedCommit: SHA, attempts: 1, timeoutMs: 5000 });
        expect(verifyCoolify).toHaveBeenCalledWith({ env: approved });
    });

    it('consulta únicamente la referencia remota main y no ejecuta entradas como shell', () => {
        const git = vi.fn().mockReturnValue(`${SHA}\trefs/heads/main\n`);
        expect(readCurrentMain(git)).toBe(SHA);
        expect(git).toHaveBeenCalledWith('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], {
            encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
        });
    });

    it.each(['', `${SHA}\trefs/heads/release\n`, `${SHA}\trefs/heads/main\n${OTHER_SHA}\trefs/heads/main\n`, `${SHA.slice(0, 7)}\trefs/heads/main\n`])('rechaza una respuesta remota ausente o ambigua: %j', (response) => {
        expect(() => readCurrentMain(vi.fn().mockReturnValue(response))).toThrow('MAIN_HEAD_UNAVAILABLE');
    });

    it.each(['push', 'workflow_dispatch'])('el CLI sale con error sin autorización, incluso para un cambio solo documental (%s)', (event) => {
        const result = spawnSync(process.execPath, ['scripts/authorize-production-release.mjs'], {
            encoding: 'utf8',
            env: { ...approved, GITHUB_EVENT_NAME: event, PRODUCTION_APPROVED: 'false', STAGING_URL: 'https://private.invalid?secret=DO_NOT_LOG' },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Compuerta de producción cerrada');
        expect(result.stdout).toBe('');
        expect(result.stderr).not.toMatch(/private|DO_NOT_LOG/);
    });
});
