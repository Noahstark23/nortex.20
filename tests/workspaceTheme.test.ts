import { describe, expect, it } from 'vitest';
import {
    currentWorkspaceThemeStorageKey,
    nextWorkspaceTheme,
    persistWorkspaceTheme,
    readWorkspaceTheme,
    resolveWorkspaceThemeStorageKey,
    resolveWorkspaceTheme,
    WORKSPACE_THEME_KEY,
    type WorkspaceThemeStorage,
} from '../utils/workspaceTheme';

const memoryStorage = (
    initial: Record<string, string | null> = {},
): WorkspaceThemeStorage & { values: Record<string, string | null> } => ({
    values: { ...initial },
    getItem(key) {
        return Object.prototype.hasOwnProperty.call(this.values, key)
            ? this.values[key] ?? null
            : null;
    },
    setItem(key, value) {
        this.values[key] = value;
    },
});

describe('tema del workspace autenticado', () => {
    it('usa light como default y solo reconoce valores del contrato', () => {
        expect(resolveWorkspaceTheme(null)).toBe('light');
        expect(resolveWorkspaceTheme('')).toBe('light');
        expect(resolveWorkspaceTheme('auto')).toBe('light');
        expect(resolveWorkspaceTheme('light')).toBe('light');
        expect(resolveWorkspaceTheme('dark')).toBe('dark');
    });

    it('aísla la preferencia por tenant y usuario cuando la sesión está completa', () => {
        const key = resolveWorkspaceThemeStorageKey(
            JSON.stringify({ id: 'u-1', tenant: { id: 't-9' } }),
            null,
        );
        const storage = memoryStorage({
            nortex_user: JSON.stringify({ id: 'u-1', tenant: { id: 't-9' } }),
            [WORKSPACE_THEME_KEY]: 'dark',
        });

        expect(key).toBe('nortex_workspace_theme:t-9:u-1');
        expect(readWorkspaceTheme(storage)).toBe('light');
        persistWorkspaceTheme('dark', storage);
        expect(storage.values[key!]).toBe('dark');
        expect(storage.values[WORKSPACE_THEME_KEY]).toBe('dark');
        expect(readWorkspaceTheme(storage)).toBe('dark');
    });

    it('degrada a light sin romper la app cuando localStorage está bloqueado', () => {
        const blocked: WorkspaceThemeStorage = {
            getItem() { throw new Error('storage bloqueado'); },
            setItem() { throw new Error('storage bloqueado'); },
        };

        expect(readWorkspaceTheme(blocked)).toBe('light');
        expect(() => persistWorkspaceTheme('dark', blocked)).not.toThrow();
    });

    it('alterna de forma determinista entre Día y Noche', () => {
        expect(nextWorkspaceTheme('light')).toBe('dark');
        expect(nextWorkspaceTheme('dark')).toBe('light');
    });

    it('solo usa la clave global legado cuando falta scope de sesión', () => {
        const scoped = resolveWorkspaceThemeStorageKey(
            JSON.stringify({ id: 'u-1', tenant: { id: 't-9' } }),
            null,
        );
        const storage = memoryStorage({
            nortex_user: JSON.stringify({ id: 'u-1', tenant: { id: 't-9' } }),
            nortex_tenant_id: 't-9',
            [WORKSPACE_THEME_KEY]: 'dark',
        });

        expect(currentWorkspaceThemeStorageKey(storage)).toBe(scoped);
        expect(readWorkspaceTheme(storage)).toBe('light');

        const legacyOnly = memoryStorage({ [WORKSPACE_THEME_KEY]: 'dark' });
        expect(currentWorkspaceThemeStorageKey(legacyOnly)).toBeNull();
        expect(readWorkspaceTheme(legacyOnly)).toBe('dark');
    });
});
