import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

const indexHtml = source('index.html');
const appSource = source('App.tsx');
const authShell = source('components/auth/AuthShell.tsx');

const themeBootstrap = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .find(script => script.includes("var baseKey = 'nortex_workspace_theme'"));

function renderBootstrap(initialStorage: Record<string, string>) {
    if (!themeBootstrap) throw new Error('No se encontró el bootstrap de tema.');

    return new JSDOM(`
        <html><head>
            <meta name="theme-color" content="#F4F5F7" />
            <script>${themeBootstrap}</script>
        </head><body></body></html>
    `, {
        runScripts: 'dangerously',
        url: 'https://somosnortex.com/login',
        beforeParse(window) {
            for (const [key, value] of Object.entries(initialStorage)) {
                window.localStorage.setItem(key, value);
            }
        },
    });
}

describe('primer paint de las rutas públicas Apple', () => {
    it('arranca en Día y cambia el chrome del navegador antes del bundle', () => {
        const dom = renderBootstrap({});

        expect(dom.window.document.documentElement.getAttribute('data-nx-theme')).toBe('light');
        expect(dom.window.document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#F4F5F7');
        expect(indexHtml.indexOf("var baseKey = 'nortex_workspace_theme'")).toBeLessThan(indexHtml.indexOf('<link rel="stylesheet" href="/index.css">'));
        expect(indexHtml).toMatch(/body\s*\{[\s\S]*?background-color:\s*#F4F5F7;[\s\S]*?color:\s*#171A1F;/);
        expect(indexHtml).toMatch(/html\[data-nx-theme="dark"\] body\s*\{[\s\S]*?background-color:\s*#0B0D10;[\s\S]*?color:\s*#E8EBF0;/);
        dom.window.close();
    });

    it('respeta Noche y aísla la preferencia por tenant y usuario', () => {
        const scopedKey = 'nortex_workspace_theme:tenant-a:user-a';
        const dom = renderBootstrap({
            nortex_workspace_theme: 'light',
            nortex_user: JSON.stringify({ id: 'user-a', tenant: { id: 'tenant-a' } }),
            [scopedKey]: 'dark',
        });

        expect(dom.window.document.documentElement.getAttribute('data-nx-theme')).toBe('dark');
        expect(dom.window.document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0B0D10');
        dom.window.close();
    });

    it('mantiene el fallback Apple durante la carga de cada ruta pública', () => {
        for (const route of [
            "pathname === '/login'",
            "pathname === '/register'",
            "pathname === '/forgot-password'",
            "pathname.startsWith('/reset-password/')",
            "pathname === '/ferreterias'",
            "pathname === '/farmacias'",
            "pathname === '/nicaragua'",
            "pathname === '/privacy'",
            "pathname === '/terms'",
            "pathname === '/blog'",
        ]) {
            expect(appSource).toContain(route);
        }
        expect(appSource).toContain('className="nx-public-loading"');
    });

    it('la marca del acceso vuelve por navegación real a la portada productiva', () => {
        expect(authShell).toContain('<a href="/" className="nx-auth-wordmark" aria-label="Nortex, inicio">');
        expect(authShell).not.toContain("from 'react-router-dom'");
    });
});
