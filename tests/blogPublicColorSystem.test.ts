import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Calculator from '../components/Calculator';
import { markdownToHtml, renderMarkdown } from '../utils/markdown';

const tokens = readFileSync(new URL('../nortex-tokens.css', import.meta.url), 'utf8');
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const prerenderSource = readFileSync(new URL('../scripts/prerender.ts', import.meta.url), 'utf8');

const hexToken = (name: string): string => {
    const match = tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    if (!match) throw new Error(`Falta el token hexadecimal ${name}`);
    return match[1];
};

const relativeLuminance = (hex: string): number => {
    const channels = hex.match(/[0-9a-f]{2}/gi);
    if (!channels || channels.length !== 3) throw new Error(`Color inválido: ${hex}`);
    const [r, g, b] = channels.map(channel => {
        const value = Number.parseInt(channel, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (foreground: string, background: string): number => {
    const a = relativeLuminance(foreground);
    const b = relativeLuminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

describe('sistema de color público', () => {
    const backgrounds = [
        '--nx-public-canvas',
        '--nx-public-canvas-alt',
        '--nx-public-surface',
        '--nx-public-surface-raised',
    ];

    it('usa el canvas cálido aprobado y evita blanco puro como superficie dominante', () => {
        expect(hexToken('--nx-public-canvas').toUpperCase()).toBe('#ECECF0');
        expect(hexToken('--nx-public-canvas-alt').toUpperCase()).toBe('#E8E8ED');
        expect(hexToken('--nx-public-text').toUpperCase()).toBe('#1D1D1F');
        expect(hexToken('--nx-public-surface').toUpperCase()).not.toBe('#FFFFFF');
        expect(hexToken('--nx-public-surface-raised').toUpperCase()).not.toBe('#FFFFFF');
    });

    it('mantiene texto principal, secundario y sutil con margen sobre AA', () => {
        const minimums = [
            ['--nx-public-text', 7],
            ['--nx-public-text-secondary', 6],
            ['--nx-public-text-subtle', 5],
        ] as const;

        for (const [foregroundName, minimum] of minimums) {
            for (const backgroundName of backgrounds) {
                expect(
                    contrast(hexToken(foregroundName), hexToken(backgroundName)),
                    `${foregroundName} sobre ${backgroundName}`,
                ).toBeGreaterThanOrEqual(minimum);
            }
        }
    });

    it('separa el verde para texto del verde de relleno y conserva contraste en ambos usos', () => {
        const accent = hexToken('--nx-public-accent-text');
        for (const backgroundName of backgrounds) {
            expect(contrast(accent, hexToken(backgroundName)), `acento sobre ${backgroundName}`)
                .toBeGreaterThanOrEqual(4.75);
        }
        expect(contrast(accent, hexToken('--nx-public-accent-soft'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(hexToken('--nx-on-brand'), hexToken('--nx-brand'))).toBeGreaterThanOrEqual(7);
        expect(hexToken('--nx-public-accent-text')).not.toBe(hexToken('--nx-brand'));
    });

    it('expone las primitivas semánticas y conserva el canvas durante carga y prerender', () => {
        const classes = [
            'nx-public-page',
            'nx-public-nav',
            'nx-public-surface',
            'nx-public-card',
            'nx-public-reading',
            'nx-public-muted',
            'nx-public-subtle',
            'nx-public-link',
            'nx-public-badge',
            'nx-public-primary',
            'nx-public-secondary',
            'nx-public-loading',
            'nx-public-prerender',
        ];

        for (const className of classes) {
            expect(css, `falta .${className}`).toContain(`.${className}`);
        }
        expect(css).toMatch(/\.nx-public-loading,\s*\.nx-public-prerender\s*\{[^}]*min-height:\s*100vh/s);
        expect(appSource).toContain('className="nx-public-loading"');
        expect(prerenderSource).toContain('class="nx-public-prerender"');
    });
});

describe('renderer editorial accesible', () => {
    const markdown = [
        '## Una guía legible',
        '',
        'Texto con **dato importante**, `código` y [otra guía](/blog).',
        '',
        '> Una nota que necesita contexto.',
        '',
        '- Primer paso',
        '- Segundo paso',
        '',
        '| Concepto | Valor |',
        '| --- | --- |',
        '| IVA | 15% |',
        '| IR | Según actividad |',
        '',
        '[Empezá con Nortex →](/register)',
    ].join('\n');

    it('emite las mismas clases semánticas en React y HTML SEO', () => {
        const seo = markdownToHtml(markdown);
        const react = renderToStaticMarkup(
            React.createElement(React.Fragment, null, ...renderMarkdown(markdown)),
        );
        const sharedClasses = [
            'nx-prose-heading-2',
            'nx-prose-paragraph',
            'nx-prose-strong',
            'nx-prose-code',
            'nx-public-link',
            'nx-prose-quote',
            'nx-prose-list',
            'nx-prose-table-wrap',
            'nx-public-primary',
        ];

        for (const className of sharedClasses) {
            expect(seo, `SEO sin ${className}`).toContain(className);
            expect(react, `React sin ${className}`).toContain(className);
        }
        expect(seo).toContain('scope="col"');
        expect(seo).toContain('role="region"');
        expect(seo).toContain('tabindex="0"');
    });

    it('no permite que selectores legacy ni colores utilitarios pisen el CTA', () => {
        expect(css).not.toMatch(/\.prose-nortex\s+a(?:[\s:{.#[])/);
        expect(css).not.toContain('blog-cta');

        const seo = markdownToHtml(markdown);
        const react = renderToStaticMarkup(
            React.createElement(React.Fragment, null, ...renderMarkdown(markdown)),
        );
        for (const output of [seo, react]) {
            expect(output).not.toMatch(/blog-cta|text-white|bg-emerald|text-emerald|#[0-9a-f]{3,8}/i);
            expect(output).toMatch(/class="nx-public-primary"[^>]*>Empezá con Nortex →<\/a>/);
        }
    });
});

describe('calculadora pública legible', () => {
    it('usa las superficies semánticas y no reintroduce grises tenues sobre blanco', () => {
        const html = renderToStaticMarkup(React.createElement(Calculator, { type: 'aguinaldo' }));

        expect(html).toContain('nx-public-calculator');
        expect(html).toContain('nx-public-field');
        expect(html).toContain('nx-public-muted');
        expect(html).toContain('nx-public-subtle');
        expect(html).toContain('nx-public-primary');
        expect(html).not.toMatch(/text-slate-400|bg-white|bg-slate-50|text-white/);
        expect(html).toContain('text-[13px]');
    });
});
