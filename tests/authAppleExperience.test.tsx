// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from '../components/ForgotPassword';
import Login from '../components/Login';
import RegisterTenant from '../components/RegisterTenant';
import ResetPassword from '../components/ResetPassword';
import { UI_MODE_KEY } from '../utils/navigation';
import { resolveWorkspaceThemeStorageKey, WORKSPACE_THEME_KEY } from '../utils/workspaceTheme';

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../utils/analytics', () => ({ trackEvent }));

const LocationProbe = () => {
    const location = useLocation();
    return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

const jsonResponse = (body: unknown, ok = true) => ({
    ok,
    json: async () => body,
});

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-nx-theme');
    document.body.removeAttribute('data-nx-theme');
    trackEvent.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('autenticación pública Apple', () => {
    it('inicia en Día, expone un solo toggle y propaga Noche al scope tras login completo', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            token: 'token-login',
            user: { id: 'user-login', role: 'OWNER', name: 'Ada' },
            tenant: { id: 'tenant-login', type: 'PULPERIA', businessName: 'Pulpería Ada' },
        })));

        render(
            <MemoryRouter initialEntries={['/login']}>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="*" element={<LocationProbe />} />
                </Routes>
            </MemoryRouter>,
        );

        const root = screen.getByTestId('auth-theme-root');
        const toggle = screen.getByRole('button', { name: /cambiar a modo noche/i });
        expect(screen.getAllByRole('button', { name: /cambiar a modo/i })).toHaveLength(1);
        expect(root).toHaveAttribute('data-nx-theme', 'light');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'light');

        await user.click(toggle);
        expect(root).toHaveAttribute('data-nx-theme', 'dark');
        expect(localStorage.getItem(WORKSPACE_THEME_KEY)).toBe('dark');

        await user.type(screen.getByLabelText('Correo electrónico'), 'ada@example.com');
        await user.type(screen.getByLabelText('Contraseña'), 'segura123');
        await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

        await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('/login'));
        const scopedKey = resolveWorkspaceThemeStorageKey(
            localStorage.getItem('nortex_user'),
            localStorage.getItem('nortex_tenant_id'),
        );
        expect(scopedKey).toBe('nortex_workspace_theme:tenant-login:user-login');
        expect(localStorage.getItem(scopedKey!)).toBe('dark');
        expect(localStorage.getItem('nortex_token')).toBe('token-login');
    });

    it('mantiene validación, tracking y tema scopeado al crear un tenant', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            token: 'token-register',
            user: { id: 'user-register', role: 'OWNER', name: 'Marta' },
            tenant: { id: 'tenant-register', type: 'PULPERIA', businessName: 'Pulpería Marta' },
        })));

        render(
            <MemoryRouter initialEntries={['/register?source=landing_spa']}>
                <Routes>
                    <Route path="/register" element={<RegisterTenant />} />
                    <Route path="*" element={<LocationProbe />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(screen.getAllByRole('button', { name: /cambiar a modo/i })).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: /cambiar a modo noche/i }));
        await user.type(screen.getByLabelText('Nombre del negocio'), 'Pulpería Marta');
        await user.selectOptions(screen.getByLabelText('Tipo de negocio'), 'PULPERIA');
        await user.type(screen.getByLabelText('Correo del administrador'), 'marta@example.com');
        await user.type(screen.getByLabelText('Contraseña'), 'segura123');
        await user.click(screen.getByRole('button', { name: /crear mi negocio/i }));

        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app/inicio?welcome=1'));
        const scopedKey = resolveWorkspaceThemeStorageKey(
            localStorage.getItem('nortex_user'),
            localStorage.getItem('nortex_tenant_id'),
        );
        expect(localStorage.getItem(scopedKey!)).toBe('dark');
        expect(trackEvent).toHaveBeenCalledWith('register_started', expect.objectContaining({ source: 'landing_spa' }));
        expect(trackEvent).toHaveBeenCalledWith('sign_up', expect.objectContaining({ business_type: 'PULPERIA' }));
        expect(trackEvent).toHaveBeenCalledWith('begin_trial', expect.objectContaining({ business_type: 'PULPERIA' }));
    });

    it('conserva el mismo shell y el estado de confirmación al solicitar recuperación', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })));

        render(
            <MemoryRouter initialEntries={['/forgot-password']}>
                <ForgotPassword />
            </MemoryRouter>,
        );

        const submit = screen.getByRole('button', { name: /enviar link de recuperación/i });
        expect(submit).toBeDisabled();
        await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
        await user.click(submit);

        expect(await screen.findByRole('heading', { name: '¡Revisá tu correo!' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('ana@example.com');
        expect(screen.getByTestId('auth-theme-root')).toHaveAttribute('data-nx-theme', 'light');
        expect(screen.getAllByRole('button', { name: /cambiar a modo/i })).toHaveLength(1);
    });

    it('restablece con mínimo de 8, persiste la sesión completa y scopea el tema', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method) return jsonResponse({ email: 'ana@example.com', name: 'Ana' });
            return jsonResponse({
                token: 'token-reset',
                user: { id: 'user-reset', role: 'OWNER', name: 'Ana', email: 'ana@example.com' },
                tenant: { id: 'tenant-reset', type: 'PULPERIA', businessName: 'Pulpería Ana' },
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        render(
            <MemoryRouter initialEntries={['/reset-password/token-publico']}>
                <Routes>
                    <Route path="/reset-password/:token" element={<ResetPassword />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(screen.getByRole('heading', { name: 'Validando tu link' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /cambiar a modo noche/i }));
        await user.type(screen.getByLabelText('Nueva contraseña', { selector: 'input' }), 'segura88');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'segura88');
        await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

        expect(await screen.findByRole('heading', { name: '¡Contraseña actualizada!' })).toBeInTheDocument();
        expect(localStorage.getItem(WORKSPACE_THEME_KEY)).toBe('dark');
        expect(localStorage.getItem('nortex_token')).toBe('token-reset');
        expect(localStorage.getItem('nortex_tenant_id')).toBe('tenant-reset');
        expect(JSON.parse(localStorage.getItem('nortex_tenant_data') || '{}')).toEqual({
            id: 'tenant-reset',
            type: 'PULPERIA',
            businessName: 'Pulpería Ana',
        });
        const scopedKey = resolveWorkspaceThemeStorageKey(
            localStorage.getItem('nortex_user'),
            localStorage.getItem('nortex_tenant_id'),
        );
        expect(scopedKey).toBe('nortex_workspace_theme:tenant-reset:user-reset');
        expect(localStorage.getItem(scopedKey!)).toBe('dark');
        expect(fetchMock).toHaveBeenLastCalledWith(
            expect.stringContaining('/api/auth/reset-password/token-publico'),
            expect.objectContaining({ body: JSON.stringify({ password: 'segura88' }) }),
        );
    });

    it('envía un tenant LENDER a su dashboard aunque haya modo simple guardado', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        localStorage.setItem(UI_MODE_KEY, 'simple');
        vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method) return jsonResponse({ email: 'cobros@example.com', name: 'Cobros' });
            return jsonResponse({
                token: 'token-lender',
                user: { id: 'user-lender', role: 'ADMIN', name: 'Cobros', email: 'cobros@example.com' },
                tenant: { id: 'tenant-lender', type: 'LENDER', businessName: 'Cobros Norte' },
            });
        }));

        render(
            <MemoryRouter initialEntries={['/reset-password/token-lender']}>
                <Routes>
                    <Route path="/reset-password/:token" element={<ResetPassword />} />
                    <Route path="*" element={<LocationProbe />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeInTheDocument();
        await user.type(screen.getByLabelText('Nueva contraseña', { selector: 'input' }), 'segura88');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'segura88');
        await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
        expect(await screen.findByRole('heading', { name: '¡Contraseña actualizada!' })).toBeInTheDocument();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1600);
        });
        expect(screen.getByTestId('location')).toHaveTextContent('/app/dashboard');
    });

    it('no persiste una sesión parcial y ofrece login manual si la respuesta exitosa está incompleta', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method) return jsonResponse({ email: 'ana@example.com', name: 'Ana' });
            return jsonResponse({
                message: 'Contraseña actualizada exitosamente.',
                token: 'token-sin-tenant',
                user: { id: 'user-reset', role: 'OWNER', name: 'Ana' },
            });
        }));

        render(
            <MemoryRouter initialEntries={['/reset-password/token-incompleto']}>
                <Routes>
                    <Route path="/reset-password/:token" element={<ResetPassword />} />
                    <Route path="*" element={<LocationProbe />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeInTheDocument();
        await user.type(screen.getByLabelText('Nueva contraseña', { selector: 'input' }), 'segura88');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'segura88');
        await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

        expect(await screen.findByRole('heading', { name: 'Contraseña actualizada' })).toBeInTheDocument();
        expect(screen.getByText(/no pudimos iniciar tu sesión automáticamente/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Entrar con mi nueva contraseña' })).toHaveAttribute('href', '/login');
        expect(localStorage.getItem('nortex_token')).toBeNull();
        expect(localStorage.getItem('nortex_user')).toBeNull();
        expect(localStorage.getItem('nortex_tenant_id')).toBeNull();
        expect(localStorage.getItem('nortex_tenant_data')).toBeNull();
    });

    it('revierte escrituras parciales y conserva el fallback manual si el navegador bloquea storage', async () => {
        const user = userEvent.setup();
        const nativeSetItem = window.localStorage.setItem.bind(window.localStorage);
        let wroteResetToken = false;
        vi.spyOn(window.localStorage, 'setItem').mockImplementation((key: string, value: string) => {
            if (key === 'nortex_token') wroteResetToken = true;
            if (key === 'nortex_user' && wroteResetToken) throw new DOMException('Storage bloqueado');
            return nativeSetItem(key, value);
        });
        vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method) return jsonResponse({ email: 'ana@example.com', name: 'Ana' });
            return jsonResponse({
                token: 'token-reset',
                user: { id: 'user-reset', role: 'OWNER', name: 'Ana', email: 'ana@example.com' },
                tenant: { id: 'tenant-reset', type: 'PULPERIA', businessName: 'Pulpería Ana' },
            });
        }));

        render(
            <MemoryRouter initialEntries={['/reset-password/token-storage']}>
                <Routes>
                    <Route path="/reset-password/:token" element={<ResetPassword />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeInTheDocument();
        await user.type(screen.getByLabelText('Nueva contraseña', { selector: 'input' }), 'segura88');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'segura88');
        await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

        expect(await screen.findByRole('heading', { name: 'Contraseña actualizada' })).toBeInTheDocument();
        expect(localStorage.getItem('nortex_token')).toBeNull();
        expect(localStorage.getItem('nortex_user')).toBeNull();
        expect(localStorage.getItem('nortex_tenant_id')).toBeNull();
        expect(localStorage.getItem('nortex_tenant_data')).toBeNull();
    });

    it('mantiene el mínimo de contraseña en 8 antes de llamar al POST', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL) => (
            jsonResponse({ email: 'ana@example.com', name: 'Ana' })
        ));
        vi.stubGlobal('fetch', fetchMock);

        render(
            <MemoryRouter initialEntries={['/reset-password/token-publico']}>
                <Routes>
                    <Route path="/reset-password/:token" element={<ResetPassword />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByRole('heading', { name: 'Nueva contraseña' })).toBeInTheDocument();
        const passwordInput = screen.getByLabelText('Nueva contraseña', { selector: 'input' });
        expect(passwordInput).toHaveAttribute('minlength', '8');
        await user.type(passwordInput, 'secreto');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'secreto');
        await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

        expect(screen.getByRole('alert')).toHaveTextContent('La contraseña debe tener al menos 8 caracteres.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('protege contraste, autofill, foco y objetivos táctiles desde la primitive común', () => {
        const css = readFileSync(resolve(process.cwd(), 'index.css'), 'utf8');
        expect(css).toMatch(/\.nx-auth-control\s*\{[\s\S]*?min-height:\s*48px;[\s\S]*?color:\s*var\(--nx-canvas-text\);[\s\S]*?caret-color:\s*var\(--nx-canvas-text\);/);
        expect(css).toMatch(/\.nx-auth-shell :is\(input, textarea, select\):-webkit-autofill[\s\S]*?-webkit-text-fill-color:\s*var\(--nx-canvas-text\);[\s\S]*?var\(--nx-canvas-raised\) inset;/);
        expect(css).toMatch(/\.nx-auth-theme-toggle\s*\{[\s\S]*?min-height:\s*var\(--nx-tap-min\);/);
        expect(css).toMatch(/\.nx-auth-control::placeholder[\s\S]*?color:\s*var\(--nx-canvas-faint\);[\s\S]*?opacity:\s*1;/);
    });
});
