import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const component = readFileSync(resolve(process.cwd(), 'components/StockCount.tsx'), 'utf8');

const between = (source: string, start: string, end: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`No se encontró el bloque ${start}`);
    return source.slice(from, to);
};

describe('Toma Física responsive y no bloqueante', () => {
    it('muestra tarjetas móviles completas en el historial y conserva la tabla desde sm', () => {
        const history = between(component, '// RENDER — LISTA / HISTORIAL', '{detailLoading &&');

        expect(history).toContain('aria-label="Historial de tomas físicas"');
        expect(history).toContain('className="sm:hidden space-y-3"');
        expect(history).toContain('hidden sm:block bg-slate-800/60');
        expect(history).toContain('Creada por');
        expect(history).toContain('Productos');
        expect(history).toContain('Todo el inventario');
        expect(history).toContain('Ver detalle');
        expect(history).toContain('<time dateTime={c.createdAt}');
    });

    it('muestra esperado, contado y diferencia en tarjetas móviles del detalle', () => {
        const items = between(component, '{/* Items */}', '{/* Confirmación de cierre */}');

        expect(items).toContain('aria-label="Productos de la toma física"');
        expect(items).toContain('className="sm:hidden divide-y');
        expect(items).toContain('className="hidden sm:block overflow-x-auto"');
        expect(items).toContain('Esperado');
        expect(items).toContain('Diferencia');
        expect(items).toContain('htmlFor={inputId}');
        expect(items).toContain('inputMode="decimal"');
        expect(items).toContain('pattern="[0-9]*([.][0-9]{0,4})?"');
        expect(items).toContain('min-h-11');
        expect(items).toContain('Guardando...');
    });

    it('hace explícita la bodega y cubre OPEN/CLOSING sin heredar una ubicación silenciosa', () => {
        expect(component).toContain("fetch('/api/warehouses'");
        expect(component).toContain('.filter((warehouse: WarehouseOption) => warehouse.isActive)');
        expect(component).toContain("return available.length === 1 ? available[0].id : ''");
        expect(component).toContain('warehouseId: createWarehouseId');
        expect(component).toContain('Bodega a contar');
        expect(component).toContain('creating || !createFormValid');
        expect(component).toContain("['OPEN', 'CLOSING'].includes(count.status)");
        expect(component).toContain("CLOSING: { label: 'Cerrando'");
        expect(component).toContain("c.warehouse?.name || 'Bodega no especificada'");
        expect(component).toContain('roleCapabilitiesFor(currentSessionRole())');
        expect(component).toContain('canManageWarehouseTopology, canViewInventoryValuation');
        expect(component).toContain('{canViewInventoryValuation && (');
        expect(component).toContain('Pedile a un administrador que active una bodega.');
    });

    it('conserva hasta cuatro decimales sin aceptar valores negativos o no finitos', () => {
        expect(component).toContain("if (!/^\\d*(?:\\.\\d{0,4})?$/.test(value)) return null;");
        expect(component).toContain("if (!/^\\d+(?:\\.\\d{1,4})?$/.test(value)) return null;");
        expect(component).toContain('Number.isFinite(parsed) && parsed >= 0');
        expect(component).toContain('parseCountInput(rawValue)');
        expect(component).not.toContain('sanitizeDecimalInput');
        expect(component).not.toContain('inputMode="numeric"');
    });

    it('reemplaza diálogos nativos bloqueantes con toast y confirmaciones accesibles', () => {
        expect(component).toContain("import { ToastViewport, useToast } from './ui/Toast'");
        expect(component).not.toMatch(/\b(?:alert|confirm)\s*\(/);
        expect(component).toContain('aria-labelledby="stock-count-close-title"');
        expect(component).toContain('aria-labelledby="stock-count-cancel-title"');
        expect(component).toContain('aria-describedby="stock-count-cancel-description"');
        expect(component).toContain('aria-modal="true"');
        expect(component).toContain("event.key === 'Escape'");
        expect(component).toContain('confirmationReturnFocusRef');
    });
});
