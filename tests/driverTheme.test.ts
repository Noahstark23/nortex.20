import { describe, expect, it } from 'vitest';
import {
    bindDriverTheme,
    clearDriverThemeScope,
    currentDriverThemeStorageKey,
    DRIVER_THEME_KEY_PREFIX,
    DRIVER_THEME_SCOPE_KEY,
    nextDriverTheme,
    persistDriverTheme,
    readDriverTheme,
    readPreAuthDriverTheme,
    resolveDriverTheme,
    resolveDriverThemeStorageKey,
    type DriverThemeStorage,
} from '../utils/driverTheme';

const memoryStorage = (
    initial: Record<string, string> = {},
): DriverThemeStorage & { values: Record<string, string> } => {
    const values = { ...initial };
    return {
        values,
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(values, key)
                ? values[key]
                : null;
        },
        setItem(key, value) {
            values[key] = value;
        },
        removeItem(key) {
            delete values[key];
        },
    };
};

describe('tema de la app publica de repartidor', () => {
    it('usa Dia antes del login y solo reconoce valores del contrato', () => {
        expect(readPreAuthDriverTheme()).toBe('light');
        expect(resolveDriverTheme(null)).toBe('light');
        expect(resolveDriverTheme('auto')).toBe('light');
        expect(resolveDriverTheme('light')).toBe('light');
        expect(resolveDriverTheme('dark')).toBe('dark');
        expect(nextDriverTheme('light')).toBe('dark');
        expect(nextDriverTheme('dark')).toBe('light');
    });

    it('deriva una clave scoped solo desde un driver.id no vacio', () => {
        expect(resolveDriverThemeStorageKey('driver/a 1'))
            .toBe('nortex_driver_theme:driver%2Fa%201');
        expect(resolveDriverThemeStorageKey('   ')).toBeNull();
        expect(resolveDriverThemeStorageKey(null)).toBeNull();
    });

    it('enlaza login e hidratacion sin filtrar preferencia entre cuentas', () => {
        const storage = memoryStorage();
        const driverAKey = resolveDriverThemeStorageKey('driver-a')!;
        const driverBKey = resolveDriverThemeStorageKey('driver-b')!;

        expect(bindDriverTheme('driver-a', 'dark', storage)).toBe('dark');
        expect(storage.values[DRIVER_THEME_SCOPE_KEY]).toBe('driver-a');
        expect(storage.values[driverAKey]).toBe('dark');

        clearDriverThemeScope(storage);
        expect(readPreAuthDriverTheme()).toBe('light');
        expect(readDriverTheme(storage)).toBe('light');

        expect(bindDriverTheme('driver-b', 'light', storage)).toBe('light');
        persistDriverTheme('driver-b', 'dark', storage);
        expect(storage.values[driverBKey]).toBe('dark');
        expect(storage.values[driverAKey]).toBe('dark');

        clearDriverThemeScope(storage);
        expect(bindDriverTheme('driver-a', 'light', storage)).toBe('dark');
        expect(currentDriverThemeStorageKey(storage)).toBe(driverAKey);
        expect(readDriverTheme(storage)).toBe('dark');
    });

    it('nunca lee ni escribe una clave global sin scope valido', () => {
        const storage = memoryStorage({
            [DRIVER_THEME_KEY_PREFIX]: 'dark',
        });

        expect(currentDriverThemeStorageKey(storage)).toBeNull();
        expect(readDriverTheme(storage)).toBe('light');
        expect(bindDriverTheme('', 'dark', storage)).toBe('dark');
        persistDriverTheme('', 'dark', storage);
        expect(storage.values).toEqual({ [DRIVER_THEME_KEY_PREFIX]: 'dark' });
    });

    it('no usa el tema visible de otra identidad al corregir un scope obsoleto', () => {
        const driverAKey = resolveDriverThemeStorageKey('driver-a')!;
        const driverBKey = resolveDriverThemeStorageKey('driver-b')!;
        const storage = memoryStorage({
            [DRIVER_THEME_SCOPE_KEY]: 'driver-a',
            [driverAKey]: 'dark',
        });

        expect(bindDriverTheme('driver-b', 'dark', storage)).toBe('light');
        expect(storage.values[DRIVER_THEME_SCOPE_KEY]).toBe('driver-b');
        expect(storage.values[driverAKey]).toBe('dark');
        expect(storage.values[driverBKey]).toBe('light');

        storage.values[DRIVER_THEME_SCOPE_KEY] = 'driver-a';
        storage.values[driverBKey] = 'dark';
        expect(bindDriverTheme('driver-b', 'light', storage)).toBe('dark');
    });

    it('limpia solo el scope al salir y conserva preferencias por repartidor', () => {
        const storage = memoryStorage();
        const scopedKey = resolveDriverThemeStorageKey('driver-7')!;

        bindDriverTheme('driver-7', 'dark', storage);
        clearDriverThemeScope(storage);

        expect(storage.values[DRIVER_THEME_SCOPE_KEY]).toBeUndefined();
        expect(storage.values[scopedKey]).toBe('dark');
        expect(readDriverTheme(storage)).toBe('light');
    });

    it('tolera storage bloqueado sin romper login, toggle ni logout', () => {
        const blocked: DriverThemeStorage = {
            getItem() { throw new Error('storage bloqueado'); },
            setItem() { throw new Error('storage bloqueado'); },
            removeItem() { throw new Error('storage bloqueado'); },
        };

        expect(readDriverTheme(blocked)).toBe('light');
        expect(bindDriverTheme('driver-1', 'dark', blocked)).toBe('dark');
        expect(() => persistDriverTheme('driver-1', 'dark', blocked)).not.toThrow();
        expect(() => clearDriverThemeScope(blocked)).not.toThrow();
    });
});
