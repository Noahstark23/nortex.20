import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
    DEPLOYED_HEALTH_RETRY,
    assessReleaseHealth,
    healthUrlFor,
    waitForExpectedRelease,
} from '../scripts/verify-deployed-release.mjs';

const SHA = 'ec8018443d3d1d00954823d1845d9e4ebf51b226';

describe('verificación post-deploy por commit', () => {
    it('acepta únicamente una app sana con BD arriba y el SHA esperado', () => {
        expect(assessReleaseHealth({ ok: true, db: 'up', commit: SHA }, SHA)).toEqual({
            ready: true,
            reason: 'READY',
            observedCommit: SHA,
        });
        expect(assessReleaseHealth({ ok: true, db: 'up', commit: 'old' }, SHA)).toEqual({
            ready: false,
            reason: 'COMMIT_MISMATCH',
        });
        expect(assessReleaseHealth({ ok: false, db: 'down', commit: SHA }, SHA)).toEqual({
            ready: false,
            reason: 'UNHEALTHY',
        });
        expect(assessReleaseHealth({ ok: true, db: 'up', commit: null }, SHA)).toEqual({
            ready: false,
            reason: 'COMMIT_MISSING',
        });
    });

    it('normaliza la URL sin duplicar /api/health', () => {
        expect(healthUrlFor('https://somosnortex.com/')).toBe('https://somosnortex.com/api/health');
        expect(healthUrlFor('https://somosnortex.com/api/health')).toBe('https://somosnortex.com/api/health');
        expect(() => healthUrlFor('file:///tmp/nortex')).toThrow('APP_URL_INVALID');
    });

    it.each([
        'https://user:secret@staging.example.test',
        'https://staging.example.test?token=private',
        'https://staging.example.test#private',
        ' https://staging.example.test',
        'https://staging.example.test ',
        'https://staging.example.test?',
        'https://staging.example.test#',
        'https://@staging.example.test',
        'https://:@staging.example.test',
        'https:///api/health',
    ])('rechaza APP_URL ambigua antes de cualquier request: %s', async (baseUrl) => {
        const fetchImpl = vi.fn();
        await expect(waitForExpectedRelease({
            baseUrl,
            expectedCommit: SHA,
            attempts: 1,
            fetchImpl,
        })).rejects.toThrow('APP_URL_INVALID');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('espera hasta observar el SHA nuevo y no acepta una release anterior sana', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, db: 'up', commit: 'old' })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, db: 'up', commit: SHA })));
        const sleep = vi.fn().mockResolvedValue(undefined);

        const result = await waitForExpectedRelease({
            baseUrl: 'https://staging.somosnortex.com',
            expectedCommit: SHA,
            attempts: 2,
            intervalMs: 1,
            fetchImpl,
            sleep,
        });

        expect(result.attemptsUsed).toBe(2);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledOnce();
    });

    it('falla cerrado si nunca aparece el commit esperado', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ ok: true, db: 'up', commit: 'old' })),
        );

        await expect(waitForExpectedRelease({
            baseUrl: 'https://somosnortex.com',
            expectedCommit: SHA,
            attempts: 1,
            fetchImpl,
        })).rejects.toThrow('COMMIT_MISMATCH');
    });

    it('intenta la cadencia máxima cuando las respuestas son inmediatas', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
        const sleep = vi.fn().mockResolvedValue(undefined);

        await expect(waitForExpectedRelease({
            baseUrl: 'https://staging.somosnortex.com',
            expectedCommit: SHA,
            fetchImpl,
            sleep,
        })).rejects.toThrow('HTTP_503');

        expect(fetchImpl).toHaveBeenCalledTimes(DEPLOYED_HEALTH_RETRY.attempts);
        expect(sleep).toHaveBeenCalledTimes(DEPLOYED_HEALTH_RETRY.attempts - 1);
        expect(sleep).toHaveBeenCalledWith(DEPLOYED_HEALTH_RETRY.intervalMs);
    });

    it('no supera la ventana total aunque los requests consuman su timeout', async () => {
        let clock = 0;
        const fetchImpl = vi.fn(async () => {
            clock += DEPLOYED_HEALTH_RETRY.timeoutMs;
            return new Response(null, { status: 503 });
        });
        const sleep = vi.fn(async (ms: number) => { clock += ms; });

        await expect(waitForExpectedRelease({
            baseUrl: 'https://staging.somosnortex.com',
            expectedCommit: SHA,
            attempts: 97,
            intervalMs: DEPLOYED_HEALTH_RETRY.intervalMs,
            timeoutMs: DEPLOYED_HEALTH_RETRY.timeoutMs,
            deadlineMs: 10_000,
            fetchImpl,
            sleep,
            now: () => clock,
        })).rejects.toThrow('HTTP_503');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(5_000);
        expect(clock).toBe(10_000);
    });

    it('acepta el SHA exacto tras un 503 transitorio', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, db: 'up', commit: SHA })));
        const sleep = vi.fn().mockResolvedValue(undefined);

        await expect(waitForExpectedRelease({
            baseUrl: 'https://staging.somosnortex.com',
            expectedCommit: SHA,
            attempts: 2,
            intervalMs: 1,
            fetchImpl,
            sleep,
        })).resolves.toMatchObject({ attemptsUsed: 2 });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledOnce();
    });

    it('no intenta parsear como JSON una respuesta HTTP no exitosa', async () => {
        const response = new Response('Service Unavailable', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
        });
        const json = vi.spyOn(response, 'json');
        const fetchImpl = vi.fn().mockResolvedValue(response);

        await expect(waitForExpectedRelease({
            baseUrl: 'https://somosnortex.com',
            expectedCommit: SHA,
            attempts: 1,
            fetchImpl,
        })).rejects.toThrow('HTTP_503');

        expect(json).not.toHaveBeenCalled();
    });

    it('no filtra URL, error de red ni commit remoto en una falla', async () => {
        const networkSecret = 'https://private.invalid?token=DO_NOT_LOG';
        const fetchImpl = vi.fn().mockRejectedValue(new Error(networkSecret));

        let networkMessage = '';
        try {
            await waitForExpectedRelease({
                baseUrl: 'https://somosnortex.com',
                expectedCommit: SHA,
                attempts: 1,
                fetchImpl,
            });
        } catch (error) {
            networkMessage = error instanceof Error ? error.message : '';
        }
        expect(networkMessage).toBe('La release esperada no apareció sana. Último estado: REQUEST_FAILED');
        expect(networkMessage).not.toContain(networkSecret);

        const mismatchedCommit = 'DO_NOT_LOG_REMOTE_COMMIT';
        let mismatchMessage = '';
        try {
            await waitForExpectedRelease({
                baseUrl: 'https://somosnortex.com',
                expectedCommit: SHA,
                attempts: 1,
                fetchImpl: async () => new Response(JSON.stringify({
                    ok: true,
                    db: 'up',
                    commit: mismatchedCommit,
                })),
            });
        } catch (error) {
            mismatchMessage = error instanceof Error ? error.message : '';
        }
        expect(mismatchMessage).toBe('La release esperada no apareció sana. Último estado: COMMIT_MISMATCH');
        expect(mismatchMessage).not.toContain(mismatchedCommit);

        const statusSecret = 'DO_NOT_LOG_STATUS';
        let statusMessage = '';
        try {
            await waitForExpectedRelease({
                baseUrl: 'https://somosnortex.com',
                expectedCommit: SHA,
                attempts: 1,
                fetchImpl: async () => ({ ok: false, status: statusSecret } as unknown as Response),
            });
        } catch (error) {
            statusMessage = error instanceof Error ? error.message : '';
        }
        expect(statusMessage).toBe('La release esperada no apareció sana. Último estado: HTTP_UNEXPECTED');
        expect(statusMessage).not.toContain(statusSecret);
    });

    it('prohíbe seguir redirecciones al comprobar salud', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ ok: true, db: 'up', commit: SHA })),
        );
        await waitForExpectedRelease({
            baseUrl: 'https://somosnortex.com',
            expectedCommit: SHA,
            attempts: 1,
            fetchImpl,
        });

        expect(fetchImpl).toHaveBeenCalledWith('https://somosnortex.com/api/health', {
            cache: 'no-store',
            headers: { accept: 'application/json', 'cache-control': 'no-cache' },
            redirect: 'error',
            signal: expect.any(AbortSignal),
        });
    });

    it('el CLI no imprime una APP_URL privada que fue rechazada', () => {
        const privateUrl = 'https://user:secret@staging.example.test?token=DO_NOT_LOG';
        const result = spawnSync(process.execPath, [
            'scripts/verify-deployed-release.mjs',
            privateUrl,
            SHA,
        ], { encoding: 'utf8' });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe('APP_URL_INVALID');
        expect(result.stderr).not.toMatch(/user|secret|DO_NOT_LOG|staging/);
    });
});
