import { describe, expect, it } from 'vitest';
import {
    clearOnboardingFlags,
    isOnboardingFlagSet,
    resolveOnboardingStorageKeys,
    setOnboardingFlag,
} from '../utils/onboardingStorage';

const userJson = (tenantId: string, userId: string) => JSON.stringify({
    id: userId,
    tenant: { id: tenantId },
});

describe('onboarding storage multi-tenant', () => {
    it('aísla las banderas por tenant y usuario', () => {
        const tenantAUserA = resolveOnboardingStorageKeys(userJson('tenant-a', 'user-a'), null);
        const tenantAUserB = resolveOnboardingStorageKeys(userJson('tenant-a', 'user-b'), null);
        const tenantBUserA = resolveOnboardingStorageKeys(userJson('tenant-b', 'user-a'), null);

        expect(tenantAUserA).not.toEqual(tenantAUserB);
        expect(tenantAUserA).not.toEqual(tenantBUserA);
        expect(tenantAUserA?.dismissed).toBe('nortex_onb_dismissed:tenant-a:user-a');
    });

    it('usa el tenant persistido como fallback y falla cerrado sin identidad completa', () => {
        expect(resolveOnboardingStorageKeys(JSON.stringify({ id: 'user-a' }), 'tenant-a'))
            .toMatchObject({ welcome: 'nortex_onb_welcome:tenant-a:user-a' });
        expect(resolveOnboardingStorageKeys(JSON.stringify({ id: 'user-a' }), null)).toBeNull();
        expect(resolveOnboardingStorageKeys('{mal-json', 'tenant-a')).toBeNull();
    });

    it('lee, escribe y limpia únicamente las claves resueltas', () => {
        const data = new Map<string, string>();
        const storage = {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => { data.set(key, value); },
            removeItem: (key: string) => { data.delete(key); },
        };
        const keys = resolveOnboardingStorageKeys(userJson('tenant-a', 'user-a'), null)!;

        setOnboardingFlag(storage, keys.dismissed);
        expect(isOnboardingFlagSet(storage, keys.dismissed)).toBe(true);
        clearOnboardingFlags(storage, keys);
        expect(isOnboardingFlagSet(storage, keys.dismissed)).toBe(false);
    });
});
