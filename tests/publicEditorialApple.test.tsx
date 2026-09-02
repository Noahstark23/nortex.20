// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PrivacyPolicy, { PrivacyPolicyContent } from '../components/PrivacyPolicy';
import TermsOfService from '../components/TermsOfService';
import BlogShell from '../components/blog/BlogShell';
import { WORKSPACE_THEME_KEY } from '../utils/workspaceTheme';

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-nx-theme');
    document.body.removeAttribute('data-nx-theme');
});

afterEach(() => {
    cleanup();
});

describe('chrome Apple editorial público', () => {
    it('mantiene blog, categorías y artículos en un único shell Día/Noche', async () => {
        const user = userEvent.setup();

        render(
            <MemoryRouter>
                <BlogShell>
                    <h1>Recursos de prueba</h1>
                </BlogShell>
            </MemoryRouter>,
        );

        const root = screen.getByTestId('public-theme-root');
        expect(root).toHaveAttribute('data-nx-theme', 'light');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'light');
        expect(screen.getAllByRole('button', { name: /cambiar a modo/i })).toHaveLength(1);
        expect(screen.getByRole('link', { name: /probar gratis/i })).toHaveAttribute('href', '/register');

        await user.click(screen.getByRole('button', { name: /cambiar a modo noche/i }));

        expect(root).toHaveAttribute('data-nx-theme', 'dark');
        expect(document.documentElement).toHaveAttribute('data-nx-theme', 'dark');
        expect(localStorage.getItem(WORKSPACE_THEME_KEY)).toBe('dark');
    });

    it.each([
        {
            component: <PrivacyPolicy />,
            contentId: 'privacy-main-content',
            heading: 'Política de Privacidad',
            reciprocalLink: 'Términos de Servicio',
        },
        {
            component: <TermsOfService />,
            contentId: 'terms-main-content',
            heading: 'Términos de Servicio',
            reciprocalLink: 'Política de Privacidad',
        },
    ])('lleva $heading al mismo chrome sin perder sus enlaces', ({ component, contentId, heading, reciprocalLink }) => {
        render(<MemoryRouter>{component}</MemoryRouter>);

        expect(screen.getByTestId('public-theme-root')).toHaveAttribute('data-nx-theme', 'light');
        expect(screen.getAllByRole('button', { name: /cambiar a modo/i })).toHaveLength(1);
        expect(screen.getByRole('main')).toHaveAttribute('id', contentId);
        expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: reciprocalLink })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /volver al inicio/i })).toHaveAttribute('href', '/');
    });

    it('elimina el tema oscuro aislado de legal y mantiene todo el blog sobre BlogShell', () => {
        const files = [
            'components/blog/BlogShell.tsx',
            'components/PrivacyPolicy.tsx',
            'components/TermsOfService.tsx',
        ].map(file => readFileSync(resolve(process.cwd(), file), 'utf8'));
        const routeFiles = [
            'components/Blog.tsx',
            'components/BlogPost.tsx',
            'components/ClusterPage.tsx',
        ].map(file => readFileSync(resolve(process.cwd(), file), 'utf8'));

        for (const source of files) {
            expect(source).not.toMatch(/(?:bg-nortex-|text-nortex-accent|text-slate-|text-white|border-slate-)/);
        }
        for (const source of routeFiles) {
            expect(source).toContain("import BlogShell from './blog/BlogShell'");
        }
    });

    it('conserva legible el enlace externo de privacidad también sin JavaScript', () => {
        const html = renderToStaticMarkup(<PrivacyPolicyContent />);

        expect(html).toContain('con el <a');
        expect(html).toContain('</a> o bloqueando cookies');
    });
});

describe('primer paint público prerenderizado', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/prerender.ts'), 'utf8');

    it('resuelve Día/Noche antes del CSS con scope seguro y fallback claro', () => {
        expect(source).toContain('data-nx-public-theme-bootstrap');
        expect(source).toContain("var theme = 'light'");
        expect(source).toContain("var baseKey = 'nortex_workspace_theme'");
        expect(source).toContain("encodeURIComponent(tenantId) + ':' + encodeURIComponent(userId)");
        expect(source).toContain("storage.getItem(storageKey) === 'dark' ? 'dark' : 'light'");
        expect(source).toContain("document.documentElement.setAttribute('data-nx-theme', theme)");
        expect(source).toContain("shell.includes('nortex_workspace_theme')");
        expect(source).not.toContain('storage.setItem(');
    });

    it('usa la misma superficie semántica en blog, legal, registro y landings', () => {
        expect(source).toContain('data-nx-public-first-paint');
        expect(source).toContain('const seoContainer = `<main data-prerender="seo" class="nx-public-prerender">${routeBody}</main>`');
        expect(source).not.toContain('const isBlogRoute');
        expect(source).not.toContain('style="max-width:820px');
    });

    it('prerenderiza la copia legal real y metadatos sociales específicos de cada ruta', () => {
        expect(source).toContain('renderToStaticMarkup(createElement(PrivacyPolicyContent))');
        expect(source).toContain('renderToStaticMarkup(createElement(TermsOfServiceContent))');
        expect(source).toContain('body: privacyPolicyBody');
        expect(source).toContain('body: termsOfServiceBody');
        expect(source).toContain('name="twitter:title"');
        expect(source).toContain('name="twitter:description"');
    });
});
