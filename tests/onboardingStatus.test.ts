import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOnboardingStatus, invalidateOnboardingStatusCache } from '../utils/onboardingStatus';

const status = {
    type: 'PULPERIA',
    businessName: 'La Esquina',
    steps: [],
    completed: 0,
    total: 2,
    allDone: false,
};

describe('lectura compartida del estado de activación', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        invalidateOnboardingStatusCache();
    });

    it('deduplica solicitudes simultáneas del mismo tenant autenticado', async () => {
        let resolveResponse: ((value: Response) => void) | undefined;
        const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
        const fetchMock = vi.fn(() => pending);
        vi.stubGlobal('fetch', fetchMock);

        const first = fetchOnboardingStatus('token-a');
        const second = fetchOnboardingStatus('token-a');
        resolveResponse?.(new Response(JSON.stringify(status), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(Promise.all([first, second])).resolves.toEqual([status, status]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('force vuelve a consultar después de una mutación', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(status), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await fetchOnboardingStatus('token-a');
        await fetchOnboardingStatus('token-a', { force: true });

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
