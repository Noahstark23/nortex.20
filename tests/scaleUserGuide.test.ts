import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidEan13 } from '../utils/scaleLabels';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const guide = source('docs/GUIA_FACTURAR_CARNE_CON_BALANZA.md');
const helpCenter = source('components/HelpCenter.tsx');
const scaleSettings = source('components/ScaleSettings.tsx');

describe('guía de facturación de carne por peso', () => {
    it('explica los dos flujos productivos sin exigir conexión directa', () => {
        expect(guide).toContain('no es obligatorio conectar la balanza por cable');
        expect(guide).toContain('escribir el peso manualmente');
        expect(guide).toContain('etiqueta impresa y lector de código');
        expect(guide).toContain('no envía la lectura al carrito');
        expect(guide).toContain('captura manual');
        expect(guide).toContain('etiqueta EAN-13 configurada');
    });

    it('usa un ejemplo EAN-13 válido y deja clara la separación PLU/SKU', () => {
        expect(isValidEan13('2000123012506')).toBe(true);
        expect(guide).toContain('El SKU identifica el producto en el catálogo; no es el PLU de la balanza.');
        expect(guide).toContain('PLU `00123` → producto `Posta de res`');
    });

    it('mantiene el resumen disponible en el Centro de Ayuda', () => {
        expect(helpCenter).toContain("title: 'Facturar carne por peso'");
        expect(helpCenter).toContain('Con cualquier balanza: pesá, tocá el producto y escribí el peso estable en el POS.');
        expect(helpCenter).toContain('un lector USB/Bluetooth en modo teclado con Enter');
        expect(helpCenter).toContain('La conexión serial directa sigue siendo experimental.');
    });

    it('muestra la decisión operativa antes de configurar perfiles', () => {
        expect(scaleSettings).toContain('Cómo se factura carne por peso hoy');
        expect(scaleSettings).toContain('No hace falta conectar un cable.');
        expect(scaleSettings).toContain('Conectá al POS un lector USB/Bluetooth en modo teclado, no la balanza.');
        expect(scaleSettings).toContain('todavía no agrega peso al ticket');
    });
});
