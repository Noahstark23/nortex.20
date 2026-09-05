import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
    readFileSync(join(__dirname, '..', relativePath), 'utf8');

const indexHtml = read('index.html');
const tailwindConfig = read('tailwind.config.js');
const indexCss = read('index.css');
const dashboard = read('components/Dashboard.tsx');
const delivery = read('components/DeliveryManager.tsx');
const deliveryKanban = read('components/delivery/DeliveryKanban.tsx');
const stockCount = read('components/StockCount.tsx');

describe('compuerta movil y PWA', () => {
    it('habilita safe-area real en iPhone y mantiene superficies semanticas', () => {
        expect(indexHtml).toContain('viewport-fit=cover');
        expect(indexCss).toContain('.nx-bottom-bar');
        expect(indexCss).toContain('.nx-ticket-dock');
        expect(indexCss).toContain('env(safe-area-inset-bottom)');
    });

    it('contiene overscroll en shell y contenedores scrolleables', () => {
        expect(indexCss).toContain('overscroll-behavior-y: none');
        expect(indexCss).toContain('.overflow-y-auto');
        expect(indexCss).toContain('.overflow-x-auto');
        expect(indexCss).toContain('overscroll-behavior: contain');
    });

    it('compila el subconjunto real de animaciones de entrada usado por Nortex', () => {
        expect(tailwindConfig).toContain("'nx-enter'");
        expect(tailwindConfig).toContain('.animate-in');
        expect(tailwindConfig).toContain('.fade-in');
        expect(tailwindConfig).toContain('.slide-in-from-bottom-full');
        expect(tailwindConfig).toContain('.slide-in-from-right-full');
        expect(tailwindConfig).toContain('.zoom-in-95');
    });

    it('no deja remanentes de 100vh en superficies operativas auditadas', () => {
        expect(dashboard).not.toContain('calc(100vh-2rem)');
        expect(delivery).not.toContain('calc(100vh-260px)');
        expect(deliveryKanban).not.toContain('calc(100vh-260px)');
        expect(stockCount).not.toContain('calc(100vh-2rem)');
        expect(dashboard).toContain('calc(100dvh-2rem)');
        expect(deliveryKanban).toContain('calc(100dvh-260px)');
        expect(stockCount).toContain('calc(100dvh-2rem)');
    });
});
