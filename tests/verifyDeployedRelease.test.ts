import { describe, expect, it, vi } from 'vitest';
import {
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
            observedCommit: 'old',
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
        expect(() => healthUrlFor('file:///tmp/nortex')).toThrow('APP_URL debe usar http:// o https://');
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
        })).rejects.toThrow(`COMMIT_MISMATCH:old`);
    });

    it('mantiene ocho minutos de reintentos aunque reciba respuestas inmediatas', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
        const sleep = vi.fn().mockResolvedValue(undefined);

        await expect(waitForExpectedRelease({
            baseUrl: 'https://staging.somosnortex.com',
            expectedCommit: SHA,
            fetchImpl,
            sleep,
        })).rejects.toThrow('HTTP_503');

        expect(fetchImpl).toHaveBeenCalledTimes(97);
        expect(sleep).toHaveBeenCalledTimes(96);
        expect(sleep).toHaveBeenCalledWith(5_000);
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
});
