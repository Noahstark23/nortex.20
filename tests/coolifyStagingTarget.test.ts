// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
    parseCoolifyStagingTarget,
    verifyCoolifyStagingTarget,
} from '../scripts/verify-coolify-staging-target.mjs';

const SHA = 'a'.repeat(40);
const env = {
    CANDIDATE_SHA: SHA,
    COOLIFY_STAGING_WEBHOOK: 'https://coolify.staging.example.test/api/v1/deploy?uuid=staging-app',
    COOLIFY_STAGING_API_ORIGIN: 'https://coolify.staging.example.test',
    COOLIFY_STAGING_APPLICATION_UUID: 'staging-app',
    COOLIFY_STAGING_READ_TOKEN: 'synthetic-staging-read-token',
};
const application = {
    uuid: 'staging-app',
    git_commit_sha: SHA,
    build_pack: 'dockercompose',
    settings: { is_auto_deploy_enabled: false },
};
const response = (payload: unknown = application) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
});

describe('destino Coolify de staging: identidad independiente y pin', () => {
    it.each([
        { COOLIFY_STAGING_WEBHOOK: 'https://foreign.example.test/api/v1/deploy?uuid=staging-app' },
        { COOLIFY_STAGING_WEBHOOK: 'https://coolify.staging.example.test/api/v1/deploy?uuid=other-app' },
        { COOLIFY_STAGING_API_ORIGIN: 'http://coolify.staging.example.test' },
        { COOLIFY_STAGING_API_ORIGIN: 'https://coolify.staging.example.test/api/v1' },
        { COOLIFY_STAGING_APPLICATION_UUID: '../staging-app' },
        { COOLIFY_STAGING_READ_TOKEN: '' },
    ])('bloquea una configuración ambigua antes de enviar token o hacer red: %j', async (patch) => {
        const fetchImpl = vi.fn();
        const expected = Object.hasOwn(patch, 'COOLIFY_STAGING_READ_TOKEN')
            ? 'COOLIFY_STAGING_READ_TOKEN_REQUIRED'
            : 'TRUSTED_COOLIFY_STAGING_TARGET_REQUIRED';
        await expect(verifyCoolifyStagingTarget({ env: { ...env, ...patch }, fetchImpl }))
            .rejects.toThrow(expected);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 'a'.repeat(39), 'A'.repeat(40)])('exige un SHA candidato completo antes de enviar el token: %j', async (CANDIDATE_SHA) => {
        const fetchImpl = vi.fn();
        await expect(verifyCoolifyStagingTarget({
            env: { ...env, CANDIDATE_SHA },
            fetchImpl,
        })).rejects.toThrow('CANDIDATE_SHA_REQUIRED');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('consulta solo la aplicación declarada en el origen de API independiente', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(response());
        expect(parseCoolifyStagingTarget(env)).toEqual({
            uuid: 'staging-app',
            applicationUrl: 'https://coolify.staging.example.test/api/v1/applications/staging-app',
        });
        await expect(verifyCoolifyStagingTarget({ env, fetchImpl })).resolves.toBe(SHA);
        expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
            'https://coolify.staging.example.test/api/v1/applications/staging-app',
            {
                method: 'GET',
                headers: { accept: 'application/json', authorization: `Bearer ${env.COOLIFY_STAGING_READ_TOKEN}` },
                redirect: 'error',
                signal: expect.any(AbortSignal),
            },
        );
    });

    it.each([
        { ...application, git_commit_sha: 'b'.repeat(40) },
        { ...application, build_pack: 'dockerimage' },
        { ...application, settings: { is_auto_deploy_enabled: true } },
        { ...application, uuid: 'other-app' },
    ])('rechaza una aplicación staging que no es un candidato Git seguro: %j', async (payload) => {
        await expect(verifyCoolifyStagingTarget({ env, fetchImpl: async () => response(payload) }))
            .rejects.toThrow(/COOLIFY_(COMMIT_NOT_PINNED|GIT_BUILD_PACK_REQUIRED|AUTO_DEPLOY_NOT_DISABLED|APPLICATION_MISMATCH)/);
    });

    it('el CLI no revela la configuración sensible de staging', () => {
        const result = spawnSync(process.execPath, ['scripts/verify-coolify-staging-target.mjs'], {
            encoding: 'utf8',
            env: { ...process.env, ...env, COOLIFY_STAGING_READ_TOKEN: '' },
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe('Compuerta de staging cerrada: COOLIFY_STAGING_READ_TOKEN_REQUIRED');
        expect(result.stderr).not.toMatch(/https|staging-app|synthetic/);
    });
});
