import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
const geminiKey = ['GEMINI', 'API', 'KEY'].join('_');

describe('frontera de secretos del frontend', () => {
    it('no carga ni define claves de IA en la configuración de Vite', () => {
        expect(viteConfig).not.toContain('loadEnv');
        expect(viteConfig).not.toContain(geminiKey);
        expect(viteConfig).not.toContain('process.env.API_KEY');
    });

    it('no enseña a poner una clave de IA en el entorno del navegador', () => {
        expect(readme).not.toContain(`Set the \`${geminiKey}\` in [.env.local]`);
        expect(readme).toContain('Nunca crear `.env.local` con una clave');
    });
});
