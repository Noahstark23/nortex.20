import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

const landing = source('public/landing.html');
const css = source('public/landing.css');
const themeScripts = [...landing.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((script) => script.includes('nortex_workspace_theme'));
const interactionScripts = [...landing.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]);
const chatScript = interactionScripts.find((script) => script.includes("var STORE_KEY = 'nx_chat_v1'"));
const tabsScript = interactionScripts.find((script) => script.includes("const tabs = Array.from(document.querySelectorAll('.tab-btn'))"));

function renderThemeWithStorage(initial: Record<string, string>) {
    const scripts = themeScripts.map((script) => `<script>${script}</script>`).join('');
    return new JSDOM(`
        <button id="landingThemeToggle" aria-pressed="false">
            <span id="landingThemeLabel">Modo noche</span>
        </button>
        ${scripts}
    `, {
        runScripts: 'dangerously',
        url: 'https://somosnortex.com/',
        beforeParse(window) {
            for (const [key, value] of Object.entries(initial)) {
                window.localStorage.setItem(key, value);
            }
        },
    });
}

function renderChatInteractions() {
    if (!chatScript) throw new Error('No se encontró el script interactivo del chat');
    return new JSDOM(`
        <button id="outsideBefore" type="button">Antes</button>
        <button id="nxChatFab" type="button" aria-controls="nxChat" aria-expanded="false">Abrir chat</button>
        <div id="nxChat" role="dialog" aria-modal="true" aria-labelledby="nxChatTitle" aria-hidden="true" tabindex="-1">
            <strong id="nxChatTitle">Asesor de Nortex</strong>
            <button id="nxChatClose" type="button">Cerrar</button>
            <div id="nxChatMsgs"></div>
            <div id="nxChips"></div>
            <a id="nxCtaReg" href="/register">Registro</a>
            <a id="nxCtaWa" href="https://wa.me/50576644030">WhatsApp</a>
            <input id="nxChatInput" type="text" />
            <button id="nxChatSend" type="button">Enviar</button>
        </div>
        <button id="outsideAfter" type="button">Después</button>
        <script>${chatScript}</script>
    `, {
        runScripts: 'dangerously',
        url: 'https://somosnortex.com/',
    });
}

function renderTabInteractions() {
    if (!tabsScript) throw new Error('No se encontró el script interactivo de pestañas');
    return new JSDOM(`
        <div role="tablist">
            <button class="tab-btn active" id="tab-button-pos" aria-controls="tab-pos" aria-selected="true" tabindex="0">POS</button>
            <button class="tab-btn" id="tab-button-inv" aria-controls="tab-inv" aria-selected="false" tabindex="-1">Inventario</button>
            <button class="tab-btn" id="tab-button-pay" aria-controls="tab-pay" aria-selected="false" tabindex="-1">Planilla</button>
        </div>
        <div class="tab-panel active" id="tab-pos"></div>
        <div class="tab-panel" id="tab-inv" hidden></div>
        <div class="tab-panel" id="tab-pay" hidden></div>
        <script>${tabsScript}</script>
    `, {
        runScripts: 'dangerously',
        url: 'https://somosnortex.com/',
    });
}

describe('landing pública Apple', () => {
    it('conserva el contrato SEO, el contenido comercial y los destinos públicos', () => {
        expect(landing).toContain('<title>Nortex | Sistema de facturación DGI, inventario y planilla para PyMES de Nicaragua</title>');
        expect(landing).toContain('<link rel="canonical" href="https://somosnortex.com/" />');
        expect(landing).toContain('<meta property="og:image" content="/og-image.svg" />');

        const jsonLd = landing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
        expect(jsonLd).toBeTruthy();
        const graph = JSON.parse(jsonLd ?? '{}')['@graph'] as Array<Record<string, unknown>>;
        expect(graph.map((entry) => entry['@type'])).toEqual([
            'Organization',
            'WebSite',
            'SoftwareApplication',
            'FAQPage',
        ]);

        for (const route of [
            '/login',
            '/register?source=landing_html&amp;location=hero',
            '/demo?source=landing_html&amp;location=nav',
            '/demo?source=landing_html&amp;location=hero',
            '/demo?source=landing_html&amp;location=final',
            '/ferreterias',
            '/farmacias',
            '/nicaragua',
            '/privacy',
            '/terms',
        ]) {
            expect(landing).toContain(`href="${route}"`);
        }

        expect(landing).toContain('Tu negocio ya vende.');
        expect(landing).toContain('Facturación DGI, inventario, planilla y cobranza');
        expect(landing).toContain("fetch('/api/landing-chat'");
        expect(landing).toContain("var STORE_KEY = 'nx_chat_v1'");
        expect(landing).toContain("window.gtag('event'");
        expect(landing).toContain('data-loc="chat-fab"');
    });

    it('es clara por defecto y ofrece un modo noche persistente con el contrato del workspace', () => {
        expect(landing).toContain('id="landingThemeToggle"');
        expect(landing).toContain('aria-pressed="false"');
        expect(landing).toContain("var baseKey = 'nortex_workspace_theme'");
        expect(landing).toContain("var STORAGE_KEY = 'nortex_workspace_theme'");
        expect(landing).toContain("theme = localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'");
        expect(landing).toContain("root.setAttribute('data-nx-theme', theme)");
        expect(landing).toContain("localStorage.setItem(themeStorageKey(), next)");

        expect(css).toMatch(/:root\s*\{[\s\S]*?color-scheme:\s*light;[\s\S]*?--bg:\s*#f5f5f7;/);
        expect(css).toMatch(/html\[data-nx-theme="dark"\]\s*\{[\s\S]*?color-scheme:\s*dark;[\s\S]*?--bg:\s*#000000;/);
        expect(css).toMatch(/\.nav-inner\s*\{[\s\S]*?min-height:\s*44px;/);
        expect(css).toMatch(/\.nav\s*\{[\s\S]*?background:\s*var\(--nav-bg\);[\s\S]*?backdrop-filter:/);
        expect(css).toMatch(/\.btn-primary\s*\{[\s\S]*?background:\s*var\(--cobalt\);/);
    });

    it('aísla la preferencia de tema por tenant y usuario cuando hay identidad local', () => {
        expect(landing).toContain("localStorage.getItem('nortex_user')");
        expect(landing).toContain("localStorage.getItem('nortex_tenant_id')");
        expect(landing).toContain("baseKey + ':' + encodeURIComponent(tenantId) + ':' + encodeURIComponent(user.id)");
        expect(landing).toContain("return STORAGE_KEY + ':' + encodeURIComponent(tenantId) + ':' + encodeURIComponent(user.id)");
        expect(landing).toMatch(/function themeStorageKey\(\)[\s\S]*?return STORAGE_KEY;/);

        const scopedWrite = landing.match(/localStorage\.setItem\(([^,]+), next\)/)?.[1];
        expect(scopedWrite).toBe('themeStorageKey()');
        expect(landing).not.toContain('localStorage.setItem(STORAGE_KEY, next)');

        expect(themeScripts).toHaveLength(2);
        const scopedKey = 'nortex_workspace_theme:tenant%2Funo:user%20uno';
        const otherAccountKey = 'nortex_workspace_theme:tenant-dos:user-dos';
        const dom = renderThemeWithStorage({
            nortex_workspace_theme: 'valor-legado-no-valido',
            nortex_user: JSON.stringify({ id: 'user uno', tenant: { id: 'tenant/uno' } }),
            [scopedKey]: 'light',
            [otherAccountKey]: 'dark',
        });

        expect(dom.window.document.documentElement.getAttribute('data-nx-theme')).toBe('light');
        dom.window.document.getElementById('landingThemeToggle')?.click();
        expect(dom.window.document.documentElement.getAttribute('data-nx-theme')).toBe('dark');
        expect(dom.window.localStorage.getItem(scopedKey)).toBe('dark');
        expect(dom.window.localStorage.getItem('nortex_workspace_theme')).toBe('valor-legado-no-valido');
        expect(dom.window.localStorage.getItem(otherAccountKey)).toBe('dark');
        dom.window.close();
    });

    it('usa la clave global de tema solamente cuando no existe una identidad suficiente', () => {
        const dom = renderThemeWithStorage({ nortex_workspace_theme: 'dark' });

        expect(dom.window.document.documentElement.getAttribute('data-nx-theme')).toBe('dark');
        dom.window.document.getElementById('landingThemeToggle')?.click();
        expect(dom.window.document.documentElement.getAttribute('data-nx-theme')).toBe('light');
        expect(dom.window.localStorage.getItem('nortex_workspace_theme')).toBe('light');
        expect(dom.window.localStorage.length).toBe(1);
        dom.window.close();

        const malformedIdentity = renderThemeWithStorage({
            nortex_workspace_theme: 'dark',
            nortex_user: '{json-inválido',
        });
        expect(malformedIdentity.window.document.documentElement.getAttribute('data-nx-theme')).toBe('dark');
        malformedIdentity.window.close();
    });

    it('implementa navegación accesible y teclado completo para las pestañas', () => {
        expect(landing).toContain('<a class="skip-link" href="#main-content">');
        expect(landing).toContain('<main id="main-content" tabindex="-1">');
        expect(landing).toContain('<nav class="nav" aria-label="Navegación principal"');
        expect(landing).toContain('role="tablist" aria-label="Pantallas del producto"');

        for (const name of ['pos', 'inv', 'pay']) {
            expect(landing).toContain(`id="tab-button-${name}"`);
            expect(landing).toContain(`aria-controls="tab-${name}"`);
            expect(landing).toContain(`id="tab-${name}" role="tabpanel" aria-labelledby="tab-button-${name}"`);
        }

        expect(landing).toContain("t.setAttribute('aria-selected', String(selected))");
        expect(landing).toContain("t.setAttribute('tabindex', selected ? '0' : '-1')");
        expect(landing).toContain('panel.hidden = !selected');
        for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
            expect(landing).toContain(`event.key === '${key}'`);
        }
    });

    it('ejecuta la navegación de pestañas y sincroniza selección, foco y panel.hidden', () => {
        const dom = renderTabInteractions();
        const { document, KeyboardEvent } = dom.window;
        const pos = document.getElementById('tab-button-pos') as HTMLButtonElement;
        const inv = document.getElementById('tab-button-inv') as HTMLButtonElement;
        const pay = document.getElementById('tab-button-pay') as HTMLButtonElement;
        const posPanel = document.getElementById('tab-pos') as HTMLElement;
        const invPanel = document.getElementById('tab-inv') as HTMLElement;
        const payPanel = document.getElementById('tab-pay') as HTMLElement;

        pos.focus();
        pos.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(inv);
        expect(inv.getAttribute('aria-selected')).toBe('true');
        expect(inv.getAttribute('tabindex')).toBe('0');
        expect(posPanel.hidden).toBe(true);
        expect(invPanel.hidden).toBe(false);

        inv.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(pay);
        expect(pay.getAttribute('aria-selected')).toBe('true');
        expect(payPanel.hidden).toBe(false);
        expect(invPanel.hidden).toBe(true);

        pay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(pos);
        expect(posPanel.hidden).toBe(false);

        pos.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(pay);
        expect(payPanel.hidden).toBe(false);
        dom.window.close();
    });

    it('mantiene el foco dentro del chat modal, cierra con Escape y lo devuelve al activador', async () => {
        const dom = renderChatInteractions();
        const { document, KeyboardEvent } = dom.window;
        const outsideBefore = document.getElementById('outsideBefore') as HTMLButtonElement;
        const fab = document.getElementById('nxChatFab') as HTMLButtonElement;
        const panel = document.getElementById('nxChat') as HTMLElement;
        const close = document.getElementById('nxChatClose') as HTMLButtonElement;
        const input = document.getElementById('nxChatInput') as HTMLInputElement;
        const send = document.getElementById('nxChatSend') as HTMLButtonElement;
        const outside = document.getElementById('outsideAfter') as HTMLButtonElement;

        outsideBefore.focus();
        fab.click();
        await new Promise((resolve) => dom.window.setTimeout(resolve, 120));

        expect(panel.classList.contains('open')).toBe(true);
        expect(panel.getAttribute('aria-hidden')).toBe('false');
        expect(panel.getAttribute('aria-modal')).toBe('true');
        expect(fab.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(input);

        send.focus();
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        send.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(close);

        const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        close.dispatchEvent(shiftTab);
        expect(shiftTab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(send);

        outside.focus();
        expect(panel.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).toBe(close);

        input.focus();
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        input.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);
        expect(panel.classList.contains('open')).toBe(false);
        expect(panel.getAttribute('aria-hidden')).toBe('true');
        expect(fab.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(fab);

        fab.click();
        await new Promise((resolve) => dom.window.setTimeout(resolve, 120));
        close.focus();
        close.click();
        expect(panel.classList.contains('open')).toBe(false);
        expect(document.activeElement).toBe(fab);
        dom.window.close();
    });

    it('mantiene foco visible, movimiento reducido y textbox del chat legible en Día y Noche', () => {
        expect(css).toMatch(/:where\(a, button, input, summary\):focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--focus\);/);
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
        expect(css).toMatch(/\.nx-chat-input input\s*\{[\s\S]*?color:\s*var\(--ink\);[\s\S]*?background:\s*var\(--bg-2\);/);
        expect(css).toMatch(/\.nx-chat-input input::placeholder\s*\{[\s\S]*?color:\s*var\(--ink-4\);[\s\S]*?opacity:\s*1;/);
        expect(css).toContain('-webkit-text-fill-color: var(--ink);');
        expect(landing).toContain('<label class="sr-only" for="nxChatInput">Escribí tu pregunta</label>');
        expect(landing).toContain('aria-live="polite"');
        expect(landing).toContain('role="dialog" aria-modal="true" aria-labelledby="nxChatTitle"');
    });
});
