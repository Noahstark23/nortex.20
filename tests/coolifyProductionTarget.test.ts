// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { parseCoolifyProductionTarget, verifyCoolifyProductionTarget } from '../scripts/verify-coolify-production-target.mjs';
import { authorizeProductionRelease } from '../scripts/authorize-production-release.mjs';

const SHA = 'a'.repeat(40);
const env = {
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: SHA, NORTEX_DEPLOY_ENABLED: 'true', PRODUCTION_APPROVED: 'true', PRODUCTION_SHA: SHA,
    STAGING_URL: 'https://staging.example.test',
    COOLIFY_PROD_WEBHOOK: 'https://coolify.example.test/api/v1/deploy?uuid=production-app&force=false',
    COOLIFY_TOKEN: 'synthetic-private-token',
};
const application = {
    uuid: 'production-app', git_commit_sha: SHA, build_pack: 'dockerfile',
    settings: { is_auto_deploy_enabled: false },
    manual_webhook_secret_github: 'SENSITIVE_RESPONSE_MUST_NOT_APPEAR',
};
const response = (payload: unknown = application) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

describe('destino de producción Coolify: lectura, pin y auto deploy', () => {
    it.each([
        '', 'http://coolify.example.test/api/v1/deploy?uuid=production-app',
        'https://user:pass@coolify.example.test/api/v1/deploy?uuid=production-app',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app#private',
        'https://coolify.example.test/api/v1/applications/production-app/start',
        'https://coolify.example.test/api/v1/deploy',
        'https://coolify.example.test/api/v1/deploy?tag=production',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app&tag=production',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app,other-app',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app%2Cother-app',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app&uuid=other-app',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app&pr=5',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app&pr=0',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app&commit=main',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app&force=true&force=false',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app&force=anything',
        'https://coolify.example.test/api/v1/deploy?uuid=../other',
        'https://coolify.example.test/api/v1/deploy?uuid=production-app%0A',
        ' https://coolify.example.test/api/v1/deploy?uuid=production-app',
    ])('rechaza un webhook ambiguo o inseguro antes de contactar la API: %s', async (COOLIFY_PROD_WEBHOOK) => {
        const fetchImpl = vi.fn();
        await expect(verifyCoolifyProductionTarget({ env: { ...env, COOLIFY_PROD_WEBHOOK }, fetchImpl })).rejects.toThrow('SINGLE_COOLIFY_DEPLOY_TARGET_REQUIRED');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each(['', ' ', 'token\r\nInjected: header'])('falta de token válido bloquea sin red: %j', async (COOLIFY_TOKEN) => {
        const fetchImpl = vi.fn();
        await expect(verifyCoolifyProductionTarget({ env: { ...env, COOLIFY_TOKEN }, fetchImpl })).rejects.toThrow('COOLIFY_API_TOKEN_REQUIRED');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('deriva una sola lectura GET del mismo origen; prohíbe redirecciones con el token', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(response());
        expect(parseCoolifyProductionTarget(env)).toEqual({ uuid: 'production-app', applicationUrl: 'https://coolify.example.test/api/v1/applications/production-app' });
        await verifyCoolifyProductionTarget({ env, fetchImpl });
        expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('https://coolify.example.test/api/v1/applications/production-app', {
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${env.COOLIFY_TOKEN}` },
            redirect: 'error', signal: expect.any(AbortSignal),
        });
    });

    it.each([301, 302, 400, 401, 403, 404, 500, 503])('rechaza HTTP %i sin leer ni imprimir la respuesta sensible', async (status) => {
        const httpResponse = new Response(null, { status });
        const json = vi.spyOn(httpResponse, 'json');
        await expect(verifyCoolifyProductionTarget({ env, fetchImpl: async () => httpResponse })).rejects.toThrow('COOLIFY_TARGET_UNAVAILABLE');
        expect(json).not.toHaveBeenCalled();
    });

    it('rechaza errores de transporte y JSON sin propagar secretos del error', async () => {
        const secretError = new Error('SENSITIVE_RESPONSE_MUST_NOT_APPEAR synthetic-private-token');
        await expect(verifyCoolifyProductionTarget({ env, fetchImpl: async () => { throw secretError; } })).rejects.toThrow('COOLIFY_TARGET_UNAVAILABLE');
        await expect(verifyCoolifyProductionTarget({ env, fetchImpl: async () => new Response(secretError.message, { status: 200 }) })).rejects.toThrow('COOLIFY_TARGET_UNAVAILABLE');
    });

    it.each([null, [], {}, { ...application, uuid: 'other-app' }])('rechaza aplicaciones ausentes, múltiples o distintas', async (payload) => {
        await expect(verifyCoolifyProductionTarget({ env, fetchImpl: async () => response(payload) })).rejects.toThrow('COOLIFY_APPLICATION_MISMATCH');
    });

    it.each([undefined, '', 'HEAD', 'main', 'refs/heads/main', 'v1.0', SHA.slice(0, 7), 'b'.repeat(40)])('rechaza un commit no fijado al SHA autorizado: %j', async (git_commit_sha) => {
        await expect(verifyCoolifyProductionTarget({ env, fetchImpl: async () => response({ ...application, git_commit_sha }) })).rejects.toThrow('COOLIFY_COMMIT_NOT_PINNED');
    });

    it.each([undefined, null, {}, { is_auto_deploy_enabled: true }, { is_auto_deploy_enabled: 'false' }, { is_auto_deploy_enabled: 0 }])('exige false booleano explícito en settings: %j', async (settings) => {
        await expect(verifyCoolifyProductionTarget({ env, fetchImpl: async () => response({ ...application, settings }) })).rejects.toThrow('COOLIFY_AUTO_DEPLOY_NOT_DISABLED');
    });

    it.each([undefined, 'dockerimage', 'dockercompose', 'nixpacks'])('rechaza un pipeline que podría ignorar el Dockerfile/pin Git: %j', async (build_pack) => {
        await expect(verifyCoolifyProductionTarget({ env, fetchImpl: async () => response({ ...application, build_pack }) })).rejects.toThrow('COOLIFY_GIT_DOCKERFILE_REQUIRED');
    });

    it('la autorización real falla si Coolify sigue HEAD aunque staging y main coincidan', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(response({ ...application, git_commit_sha: 'HEAD' }));
        await expect(authorizeProductionRelease({ env, verifyStaging: vi.fn().mockResolvedValue({}), readMain: () => SHA,
            verifyCoolify: ({ env: releaseEnv }) => verifyCoolifyProductionTarget({ env: releaseEnv, fetchImpl }),
        })).rejects.toThrow('COOLIFY_COMMIT_NOT_PINNED');
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('autoriza con configuración fijada sin imprimir respuesta, token ni URL', async () => {
        const log = vi.spyOn(console, 'log');
        const error = vi.spyOn(console, 'error');
        try {
            const fetchImpl = vi.fn().mockResolvedValue(response());
            await expect(authorizeProductionRelease({ env, verifyStaging: vi.fn().mockResolvedValue({}), readMain: () => SHA,
                verifyCoolify: ({ env: releaseEnv }) => verifyCoolifyProductionTarget({ env: releaseEnv, fetchImpl }),
            })).resolves.toBe(SHA);
            expect(log).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
        } finally { log.mockRestore(); error.mockRestore(); }
    });

    it('CLI sin token cierra antes de staging, main y cualquier webhook', () => {
        const result = spawnSync(process.execPath, ['scripts/authorize-production-release.mjs'], {
            encoding: 'utf8', env: { ...env, COOLIFY_TOKEN: '' },
        });
        expect(result.status).toBe(1);
        expect(result.stderr.trim()).toBe('Compuerta de producción cerrada: COOLIFY_API_TOKEN_REQUIRED');
        expect(result.stdout).toBe('');
        expect(result.stderr).not.toMatch(/https|production-app|synthetic/);
    });
});
