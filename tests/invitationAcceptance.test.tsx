// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AcceptInvitation from '../components/AcceptInvitation';

const invitation = {
    email: 'ana@example.com',
    role: 'CASHIER',
    businessName: 'Pulpería Aurora',
    expiresAt: '2026-09-07T12:00:00.000Z',
};

const jsonResponse = (body: unknown, ok = true) => ({
    ok,
    json: async () => body,
});

const LocationProbe = () => {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}</output>;
};

function renderInvitation(entry = '/invite/token-seguro') {
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/invite/:token" element={<AcceptInvitation />} />
                <Route path="*" element={<LocationProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-nx-theme');
    document.body.removeAttribute('data-nx-theme');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('aceptación pública de invitaciones', () => {
    it('valida el enlace, crea el acceso y deja el inicio de sesión en la ruta canónica', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method) return jsonResponse(invitation);
            return jsonResponse({
                token: 'jwt-que-no-debe-persistirse',
                user: { id: 'new-user', email: invitation.email, role: invitation.role },
                tenant: { id: 'tenant-aurora', businessName: invitation.businessName },
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        renderInvitation();

        expect(await screen.findByRole('heading', { name: 'Unite al equipo' })).toBeInTheDocument();
        expect(screen.getByLabelText('Resumen de invitación')).toHaveTextContent('ana@example.com');
        expect(screen.getByLabelText('Correo electrónico')).toHaveValue('ana@example.com');
        expect(screen.getByText(/te invitaron a/i)).toHaveTextContent('Pulpería Aurora');

        await user.type(screen.getByLabelText('Tu nombre completo'), 'Ana López');
        await user.type(screen.getByLabelText('Crear contraseña'), 'segura123');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'segura123');
        await user.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

        expect(await screen.findByRole('heading', { name: '¡Tu cuenta está lista!' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Entrar con mi cuenta' })).toHaveAttribute('href', '/login');
        expect(fetchMock.mock.calls[0]).toEqual(['/api/invite/token-seguro']);
        expect(fetchMock.mock.calls[1][0]).toBe('/api/invite/token-seguro/accept');
        expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
            name: 'Ana López',
            password: 'segura123',
        });

        // El endpoint puede devolver un JWT, pero este flujo no lo convierte
        // en sesión: Login es la única ruta que persiste sesión completa.
        expect(localStorage.getItem('nortex_token')).toBeNull();
        expect(localStorage.getItem('nortex_user')).toBeNull();
        expect(localStorage.getItem('nortex_tenant_id')).toBeNull();
        expect(localStorage.getItem('nortex_tenant_data')).toBeNull();

        await user.click(screen.getByRole('link', { name: 'Entrar con mi cuenta' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    });

    it('muestra la razón cuando el enlace ya no puede usarse y permite reintentar la validación', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn(async () => jsonResponse({
            error: 'Esta invitación ha expirado. Solicita una nueva.',
        }, false));
        vi.stubGlobal('fetch', fetchMock);

        renderInvitation();

        expect(await screen.findByRole('heading', { name: 'Invitación no disponible' })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Esta invitación ha expirado. Solicita una nueva.');
        await user.click(screen.getByRole('button', { name: 'Validar de nuevo' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('link', { name: 'Ya tengo una cuenta' })).toHaveAttribute('href', '/login');
    });

    it('muestra el error del servidor al aceptar sin crear una sesión parcial', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method) return jsonResponse(invitation);
            return jsonResponse({ error: 'Ya existe una cuenta con este email.' }, false);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderInvitation();
        expect(await screen.findByRole('heading', { name: 'Unite al equipo' })).toBeInTheDocument();
        await user.type(screen.getByLabelText('Tu nombre completo'), 'Ana López');
        await user.type(screen.getByLabelText('Crear contraseña'), 'segura123');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'segura123');
        await user.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una cuenta con este email.');
        expect(localStorage.getItem('nortex_token')).toBeNull();
    });

    it('no presenta éxito ni persiste nada si una respuesta 200 llega incompleta', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method) return jsonResponse(invitation);
            return jsonResponse({ token: 'respuesta-incompleta' });
        });
        vi.stubGlobal('fetch', fetchMock);

        renderInvitation();
        expect(await screen.findByRole('heading', { name: 'Unite al equipo' })).toBeInTheDocument();
        await user.type(screen.getByLabelText('Tu nombre completo'), 'Ana López');
        await user.type(screen.getByLabelText('Crear contraseña'), 'segura123');
        await user.type(screen.getByLabelText('Confirmar contraseña'), 'segura123');
        await user.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('El servidor confirmó la solicitud de forma incompleta.');
        expect(screen.getByRole('heading', { name: 'Unite al equipo' })).toBeInTheDocument();
        expect(localStorage.getItem('nortex_token')).toBeNull();
    });

    it('mantiene el enlace público registrado en App y trata su carga como parte del shell público', () => {
        const app = readFileSync(resolve(process.cwd(), 'App.tsx'), 'utf8');
        expect(app).toContain("const AcceptInvitation = lazy(() => import('./components/AcceptInvitation'));");
        expect(app).toContain('<Route path="/invite/:token" element={<AcceptInvitation />} />');
        expect(app).toContain("pathname.startsWith('/invite/')");
    });
});
