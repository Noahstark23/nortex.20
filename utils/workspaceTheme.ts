/**
 * Tema visual del workspace autenticado.
 *
 * Es una preferencia local del dispositivo, no una autorización ni un dato de
 * negocio. El modo claro es deliberadamente el valor seguro por defecto para
 * sesiones nuevas y para valores guardados por versiones futuras o dañados.
 */
export type WorkspaceTheme = 'light' | 'dark';

export const WORKSPACE_THEME_KEY = 'nortex_workspace_theme';

export interface WorkspaceThemeStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

type WorkspaceThemeReadableStorage = Pick<WorkspaceThemeStorage, 'getItem'>;

const usefulText = (value: unknown): value is string => (
    typeof value === 'string' && value.trim().length > 0
);

export function resolveWorkspaceTheme(value: unknown): WorkspaceTheme {
    return value === 'dark' ? 'dark' : 'light';
}

function browserStorage(): WorkspaceThemeStorage | undefined {
    if (typeof window === 'undefined') return undefined;
    try {
        return window.localStorage;
    } catch {
        // Safari privado o políticas corporativas pueden bloquear el storage.
        return undefined;
    }
}

/**
 * El tema es cosmético, pero no debe cruzar cuentas en una terminal
 * compartida. Si la identidad de la sesión actual es insuficiente, el caller
 * puede degradar al key global legado.
 */
export function resolveWorkspaceThemeStorageKey(
    userJson: string | null,
    tenantIdFallback: string | null,
): string | null {
    try {
        const user = JSON.parse(userJson || '{}') as {
            id?: unknown;
            tenant?: { id?: unknown } | null;
        };
        const tenantId = usefulText(user.tenant?.id)
            ? user.tenant.id
            : tenantIdFallback;
        if (!usefulText(user.id) || !usefulText(tenantId)) return null;

        return `${WORKSPACE_THEME_KEY}:${encodeURIComponent(tenantId)}:${encodeURIComponent(user.id)}`;
    } catch {
        return null;
    }
}

export function currentWorkspaceThemeStorageKey(
    storage: WorkspaceThemeReadableStorage | undefined = browserStorage(),
): string | null {
    try {
        return resolveWorkspaceThemeStorageKey(
            storage?.getItem('nortex_user') ?? null,
            storage?.getItem('nortex_tenant_id') ?? null,
        );
    } catch {
        return null;
    }
}

export function readWorkspaceTheme(
    storage: WorkspaceThemeStorage | undefined = browserStorage(),
): WorkspaceTheme {
    try {
        const scopedKey = currentWorkspaceThemeStorageKey(storage);
        return resolveWorkspaceTheme(storage?.getItem(scopedKey ?? WORKSPACE_THEME_KEY));
    } catch {
        return 'light';
    }
}

export function persistWorkspaceTheme(
    theme: WorkspaceTheme,
    storage: WorkspaceThemeStorage | undefined = browserStorage(),
): void {
    try {
        const scopedKey = currentWorkspaceThemeStorageKey(storage);
        storage?.setItem(scopedKey ?? WORKSPACE_THEME_KEY, theme);
    } catch {
        // El control sigue funcionando durante la sesión aunque no pueda persistir.
    }
}

export function nextWorkspaceTheme(theme: WorkspaceTheme): WorkspaceTheme {
    return theme === 'light' ? 'dark' : 'light';
}
