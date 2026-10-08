import { useSyncExternalStore } from 'react';
import { resolvePosSimple, resolveUiMode, UI_MODE_KEY, type UiMode } from '../utils/navigation';

const MODE_CHANGED = 'nortex:ui-mode-changed';

/** El giro vive en el tenant; el usuario lo trae anidado. Mismo criterio en los dos lectores. */
function readTenantType(): string {
    const tenant = JSON.parse(localStorage.getItem('nortex_tenant_data') || '{}');
    const user = JSON.parse(localStorage.getItem('nortex_user') || '{}');
    return tenant?.type || user?.tenant?.type || '';
}

function readMode(): UiMode {
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(UI_MODE_KEY);
        return resolveUiMode(readTenantType(), stored);
    } catch { return resolveUiMode('', stored); }
}

/**
 * El POS resuelve con SU política, no con la del menú (ver resolvePosSimple).
 * Comparte el mismo almacenamiento y la misma suscripción: el toggle del
 * sidebar sigue moviendo al POS al instante, pero el DEFAULT es distinto.
 */
function readPosSimple(): boolean {
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(UI_MODE_KEY);
        return resolvePosSimple(readTenantType(), stored);
    } catch { return resolvePosSimple('', stored); }
}

function subscribe(onChange: () => void): () => void {
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || [UI_MODE_KEY, 'nortex_tenant_data', 'nortex_user'].includes(event.key)) onChange();
    };
    window.addEventListener(MODE_CHANGED, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(MODE_CHANGED, onChange);
        window.removeEventListener('storage', onStorage);
    };
}

function setMode(value: UiMode | ((previous: UiMode) => UiMode)): void {
    const next = typeof value === 'function' ? value(readMode()) : value;
    localStorage.setItem(UI_MODE_KEY, next);
    window.dispatchEvent(new Event(MODE_CHANGED));
}

/** Modo del MENÚ: reactivo, sin recrear la venta en curso. */
export function useUiMode() {
    return [useSyncExternalStore(subscribe, readMode, () => 'simple' as UiMode), setMode] as const;
}

/**
 * Modo simple del POS. Existe aparte de `useUiMode` porque esconde cosas que el
 * menú no esconde —descuento, tiquetera, parqueo, devoluciones, importación— y
 * su default no puede ser el del menú. El snapshot de servidor devuelve `false`:
 * en prerender no hay localStorage y equivocarse hacia "completo" muestra un
 * control de más por un instante, mientras que equivocarse hacia "simple"
 * esconde el descuento.
 */
export function usePosSimpleMode(): boolean {
    return useSyncExternalStore(subscribe, readPosSimple, () => false);
}
