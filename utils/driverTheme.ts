/**
 * Preferencia visual de la app publica de repartidor.
 *
 * El tema es cosmetico y vive solo en este dispositivo. Cada preferencia se
 * aisla por el id no secreto que devuelve el backend; nunca se deriva del
 * token, telefono o nombre del repartidor. La clave de scope solo permite
 * recuperar el tema durante una sesion ya existente.
 */
export type DriverTheme = 'light' | 'dark';

export const DRIVER_THEME_KEY_PREFIX = 'nortex_driver_theme';
export const DRIVER_THEME_SCOPE_KEY = 'nortex_driver_theme_scope';

export interface DriverThemeStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const normalizedDriverId = (driverId: unknown): string | null => {
    if (typeof driverId !== 'string') return null;
    const normalized = driverId.trim();
    return normalized.length > 0 ? normalized : null;
};

const isDriverTheme = (value: unknown): value is DriverTheme => (
    value === 'light' || value === 'dark'
);

function browserStorage(): DriverThemeStorage | undefined {
    if (typeof window === 'undefined') return undefined;
    try {
        return window.localStorage;
    } catch {
        // Safari privado o una politica corporativa puede bloquear storage.
        return undefined;
    }
}

export function resolveDriverTheme(value: unknown): DriverTheme {
    return value === 'dark' ? 'dark' : 'light';
}

export function resolveDriverThemeStorageKey(driverId: unknown): string | null {
    const normalized = normalizedDriverId(driverId);
    if (!normalized) return null;
    return `${DRIVER_THEME_KEY_PREFIX}:${encodeURIComponent(normalized)}`;
}

/**
 * El login siempre empieza en Dia. La eleccion hecha antes de autenticar es
 * solo estado de la sesion de React y se enlaza a una identidad al ingresar.
 */
export function readPreAuthDriverTheme(): DriverTheme {
    return 'light';
}

export function currentDriverThemeStorageKey(
    storage: DriverThemeStorage | undefined = browserStorage(),
): string | null {
    try {
        return resolveDriverThemeStorageKey(
            storage?.getItem(DRIVER_THEME_SCOPE_KEY) ?? null,
        );
    } catch {
        return null;
    }
}

/**
 * Recupera el tema de una sesion ya enlazada. Si no hay scope valido no se
 * consulta ninguna clave global: Dia es el unico fallback seguro.
 */
export function readDriverTheme(
    storage: DriverThemeStorage | undefined = browserStorage(),
): DriverTheme {
    try {
        const scopedKey = currentDriverThemeStorageKey(storage);
        if (!scopedKey) return 'light';
        return resolveDriverTheme(storage?.getItem(scopedKey));
    } catch {
        return 'light';
    }
}

/**
 * Enlaza el scope a la identidad autoritativa devuelta por login u orders.
 * Una preferencia valida previa gana; para un repartidor nuevo se conserva la
 * eleccion pre-auth actual y se guarda exclusivamente en su clave scoped.
 */
export function bindDriverTheme(
    driverId: unknown,
    currentTheme: DriverTheme = 'light',
    storage: DriverThemeStorage | undefined = browserStorage(),
): DriverTheme {
    const normalized = normalizedDriverId(driverId);
    const scopedKey = resolveDriverThemeStorageKey(normalized);
    const fallback = resolveDriverTheme(currentTheme);
    if (!normalized || !scopedKey || !storage) return fallback;

    let saved: string | null;
    let activeScope: string | null;
    try {
        activeScope = normalizedDriverId(storage.getItem(DRIVER_THEME_SCOPE_KEY));
        saved = storage.getItem(scopedKey);
    } catch {
        return fallback;
    }

    // Si un token existente hidrata una identidad distinta de la apuntada,
    // nunca usar el tema visible de la cuenta anterior como fallback. Una
    // preferencia ya guardada de la identidad nueva sí conserva prioridad.
    const safeFallback = activeScope && activeScope !== normalized
        ? 'light'
        : fallback;
    const effectiveTheme = isDriverTheme(saved) ? saved : safeFallback;
    try {
        if (!isDriverTheme(saved)) storage.setItem(scopedKey, effectiveTheme);
        storage.setItem(DRIVER_THEME_SCOPE_KEY, normalized);
    } catch {
        // El tema efectivo aun puede vivir en el estado local de React.
    }

    return effectiveTheme;
}

/**
 * Persiste un cambio solo cuando el caller ya conoce el driver.id actual.
 * Exigir la identidad evita que una clave de scope obsoleta reciba el tema de
 * otra cuenta en un dispositivo compartido.
 */
export function persistDriverTheme(
    driverId: unknown,
    theme: DriverTheme,
    storage: DriverThemeStorage | undefined = browserStorage(),
): void {
    const normalized = normalizedDriverId(driverId);
    const scopedKey = resolveDriverThemeStorageKey(normalized);
    if (!normalized || !scopedKey || !storage) return;

    try {
        storage.setItem(scopedKey, resolveDriverTheme(theme));
        storage.setItem(DRIVER_THEME_SCOPE_KEY, normalized);
    } catch {
        // El control sigue funcionando durante la sesion aunque no persista.
    }
}

/**
 * Cerrar sesion olvida unicamente el scope activo. Las preferencias scoped se
 * conservan para que el mismo repartidor las recupere en su proximo login.
 */
export function clearDriverThemeScope(
    storage: DriverThemeStorage | undefined = browserStorage(),
): void {
    try {
        storage?.removeItem(DRIVER_THEME_SCOPE_KEY);
    } catch {
        // El logout de negocio no debe depender de una preferencia visual.
    }
}

export function nextDriverTheme(theme: DriverTheme): DriverTheme {
    return theme === 'light' ? 'dark' : 'light';
}
