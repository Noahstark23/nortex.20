// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from '../components/Layout';
import { resolveWorkspaceThemeStorageKey, WORKSPACE_THEME_KEY } from '../utils/workspaceTheme';

vi.mock('../components/PinPadClock', () => ({
    PinPadClock: () => null,
}));

vi.mock('../components/OnboardingHub', () => ({
    default: () => null,
}));

vi.mock('../components/InstallPrompt', () => ({
    default: () => null,
}));

vi.mock('../components/ui/FluidSheet', () => ({
    default: ({
        open,
        children,
        labelledBy,
        panelClassName = '',
    }: {
        open: boolean;
        children: ReactNode;
        labelledBy?: string;
        panelClassName?: string;
    }) => (open ? (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={`nx-fluid-sheet-panel ${panelClassName}`}
        >
            {children}
        </div>
    ) : null),
}));

const installMatchMedia = (desktop = false) => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: query === '(min-width: 1024px)' ? desktop : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
    })));
};

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('nortex_user', JSON.stringify({
        id: 'user-1',
        name: 'Ana',
        tenant: { id: 'tenant-1', type: 'PULPERIA', businessName: 'Pulpería QA' },
    }));
    localStorage.setItem('nortex_tenant_id', 'tenant-1');
    localStorage.setItem('nortex_token', `header.${btoa(JSON.stringify({ role: 'OWNER' }))}.signature`);
    installMatchMedia(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] })));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('toggle de tema del menú móvil', () => {
    it('expone un único botón de tema dentro de la hoja y persiste el modo noche', () => {
        render(
            <MemoryRouter initialEntries={['/app/team']}>
                <Layout>
                    <div>Contenido</div>
                </Layout>
            </MemoryRouter>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Abrir menú completo' }));
        const dialog = screen.getByRole('dialog');
        const themeButtons = within(dialog).getAllByRole('button', { name: /Cambiar a modo/i });
        const themeKey = resolveWorkspaceThemeStorageKey(
            localStorage.getItem('nortex_user'),
            localStorage.getItem('nortex_tenant_id'),
        );

        expect(themeButtons).toHaveLength(1);
        expect(themeButtons[0]).toHaveTextContent('Modo noche');
        expect(document.querySelector('.nx-app-shell')).toHaveAttribute('data-nx-theme', 'light');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'light');
        expect(document.body).toHaveAttribute('data-nx-theme', 'light');

        fireEvent.click(themeButtons[0]);

        expect(document.querySelector('.nx-app-shell')).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.body).toHaveAttribute('data-nx-theme', 'dark');
        expect(localStorage.getItem(themeKey!)).toBe('dark');
        expect(localStorage.getItem(WORKSPACE_THEME_KEY)).toBeNull();
        expect(themeButtons[0]).toHaveTextContent('Modo día');
    });
});

describe('toggle de tema del header de escritorio', () => {
    it('mantiene un único botón Día/Noche visible y persiste el cambio del shell', () => {
        installMatchMedia(true);

        render(
            <MemoryRouter initialEntries={['/app/team']}>
                <Layout>
                    <div>Contenido</div>
                </Layout>
            </MemoryRouter>,
        );

        const themeButtons = screen.getAllByRole('button', { name: /Cambiar a modo/i });
        const themeKey = resolveWorkspaceThemeStorageKey(
            localStorage.getItem('nortex_user'),
            localStorage.getItem('nortex_tenant_id'),
        );

        expect(themeButtons).toHaveLength(1);
        expect(document.querySelector('.nx-app-shell')).toHaveAttribute('data-nx-theme', 'light');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'light');
        expect(document.body).toHaveAttribute('data-nx-theme', 'light');
        expect(themeButtons[0]).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(themeButtons[0]);

        expect(document.querySelector('.nx-app-shell')).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.body).toHaveAttribute('data-nx-theme', 'dark');
        expect(localStorage.getItem(themeKey!)).toBe('dark');
        expect(localStorage.getItem(WORKSPACE_THEME_KEY)).toBeNull();
        expect(screen.getByRole('button', { name: /Cambiar a modo día/i })).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('toggle de tema del espacio de cobrador', () => {
    it.each([
        { tenantType: 'LENDER', expectedRole: 'LENDER_COLLECTOR' },
        { tenantType: 'PULPERIA', expectedRole: 'COLLECTOR' },
    ])('mantiene el rol $expectedRole en su shell reducido y permite alternar Día/Noche', ({ tenantType }) => {
        localStorage.setItem('nortex_user', JSON.stringify({
            id: 'collector-1',
            name: 'Cobrador QA',
            tenant: { id: 'tenant-collector', type: tenantType, businessName: 'Ruta QA' },
        }));
        localStorage.setItem('nortex_tenant_id', 'tenant-collector');
        localStorage.setItem('nortex_token', `header.${btoa(JSON.stringify({ role: 'COLLECTOR' }))}.signature`);

        render(
            <MemoryRouter initialEntries={['/app/dashboard']}>
                <Layout>
                    <div>Ruta de cobro verificable</div>
                </Layout>
            </MemoryRouter>,
        );

        const themeKey = resolveWorkspaceThemeStorageKey(
            localStorage.getItem('nortex_user'),
            localStorage.getItem('nortex_tenant_id'),
        );
        const themeButton = screen.getByRole('button', { name: /Cambiar a modo noche/i });

        expect(screen.getByText('Ruta de cobro verificable')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir menú completo' })).not.toBeInTheDocument();
        expect(document.querySelector('.nx-app-shell')).toHaveAttribute('data-nx-theme', 'light');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'light');
        expect(document.body).toHaveAttribute('data-nx-theme', 'light');
        expect(document.querySelector('.nx-apple-light-workspace')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /Cambiar a modo/i })).toHaveLength(1);

        fireEvent.click(themeButton);

        expect(document.querySelector('.nx-app-shell')).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.body).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.querySelector('.nx-apple-dark-workspace')).toBeInTheDocument();
        expect(localStorage.getItem(themeKey!)).toBe('dark');
        expect(localStorage.getItem(WORKSPACE_THEME_KEY)).toBeNull();
        expect(screen.getByRole('button', { name: /Cambiar a modo día/i })).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('limpieza del tema global autenticado', () => {
    it('retira el data-nx-theme global cuando Layout se desmonta', () => {
        const { unmount } = render(
            <MemoryRouter initialEntries={['/app/team']}>
                <Layout>
                    <div>Contenido</div>
                </Layout>
            </MemoryRouter>,
        );

        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'light');
        expect(document.body).toHaveAttribute('data-nx-theme', 'light');

        unmount();

        expect(document.documentElement).not.toHaveAttribute('data-nx-theme');
        expect(document.body).not.toHaveAttribute('data-nx-theme');
    });
});
