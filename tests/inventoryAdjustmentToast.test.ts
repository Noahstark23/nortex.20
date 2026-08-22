import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../components/Inventory.tsx', import.meta.url), 'utf8');
const adjustmentFlow = source.slice(
    source.indexOf('const handleAdjust = async'),
    source.indexOf('// CREATE PRODUCT'),
);

describe('mensajería del ajuste manual de inventario', () => {
    it('confirma el éxito sin bloquear y nombra la bodega', () => {
        expect(adjustmentFlow).toContain("tone: 'success'");
        expect(adjustmentFlow).toContain("title: 'Ajuste registrado'");
        expect(adjustmentFlow).toContain('Existencia actualizada en ${warehouseName}.');
        expect(adjustmentFlow).not.toMatch(/\balert\s*\(/);
    });

    it('mantiene los errores dentro del modal y monta el viewport accesible', () => {
        expect(adjustmentFlow).toContain("setAdjustError(data.error || 'No pudimos registrar el ajuste.')");
        expect(source).toContain('<ToastViewport toast={toast} onDismiss={dismissToast} />');
    });
});
