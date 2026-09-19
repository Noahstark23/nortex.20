import { useSyncExternalStore } from 'react';
import { resolveUiMode, UI_MODE_KEY, type UiMode } from '../utils/navigation';

const MODE_CHANGED = 'nortex:ui-mode-changed';

function readMode(): UiMode {
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(UI_MODE_KEY);
        const tenant = JSON.parse(localStorage.getItem('nortex_tenant_data') || '{}');
        const user = JSON.parse(localStorage.getItem('nortex_user') || '{}');
        return resolveUiMode(tenant?.type || user?.tenant?.type || '', stored);
    } catch { return resolveUiMode('', stored); }
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

/** Una preferencia reactiva para menú y POS, sin recrear la venta en curso. */
export function useUiMode() {
    return [useSyncExternalStore(subscribe, readMode, () => 'simple' as UiMode), setMode] as const;
}
