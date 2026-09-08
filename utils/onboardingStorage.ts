const WELCOME_PREFIX = 'nortex_onb_welcome';
const DISMISSED_PREFIX = 'nortex_onb_dismissed';

export interface OnboardingStorageKeys {
    welcome: string;
    dismissed: string;
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const usefulText = (value: unknown): value is string => (
    typeof value === 'string' && value.trim().length > 0
);

/**
 * El onboarding es cosmético, pero no puede cruzar cuentas en una terminal
 * compartida. Sin tenant + usuario válidos no se persiste ninguna bandera.
 */
export function resolveOnboardingStorageKeys(
    userJson: string | null,
    tenantIdFallback: string | null,
): OnboardingStorageKeys | null {
    try {
        const user = JSON.parse(userJson || '{}') as {
            id?: unknown;
            tenant?: { id?: unknown } | null;
        };
        const tenantId = usefulText(user.tenant?.id)
            ? user.tenant.id
            : tenantIdFallback;
        if (!usefulText(user.id) || !usefulText(tenantId)) return null;

        const scope = `${encodeURIComponent(tenantId)}:${encodeURIComponent(user.id)}`;
        return {
            welcome: `${WELCOME_PREFIX}:${scope}`,
            dismissed: `${DISMISSED_PREFIX}:${scope}`,
        };
    } catch {
        return null;
    }
}

export function currentOnboardingStorageKeys(
    storage: ReadableStorage = globalThis.localStorage,
): OnboardingStorageKeys | null {
    try {
        return resolveOnboardingStorageKeys(
            storage.getItem('nortex_user'),
            storage.getItem('nortex_tenant_id'),
        );
    } catch {
        return null;
    }
}

export function isOnboardingFlagSet(
    storage: ReadableStorage,
    key: string | undefined,
): boolean {
    if (!key) return false;
    try {
        return storage.getItem(key) === '1';
    } catch {
        return false;
    }
}

export function setOnboardingFlag(
    storage: WritableStorage,
    key: string | undefined,
): void {
    if (!key) return;
    try {
        storage.setItem(key, '1');
    } catch { /* storage no disponible: el onboarding sigue sin persistencia */ }
}

export function clearOnboardingFlags(
    storage: WritableStorage,
    keys: OnboardingStorageKeys | null,
): void {
    if (!keys) return;
    try {
        storage.removeItem(keys.welcome);
        storage.removeItem(keys.dismissed);
    } catch { /* la ayuda puede continuar aunque storage esté bloqueado */ }
}
