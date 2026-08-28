import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    newManualBatchClientEventId,
    soleActiveWarehouseId,
} from '../components/Inventory';

const source = readFileSync(resolve(process.cwd(), 'components/Inventory.tsx'), 'utf8');
const flow = source.slice(
    source.indexOf('// BATCHES'),
    source.indexOf('// ADJUST', source.indexOf('// BATCHES')),
);
const modal = source.slice(
    source.indexOf('MODAL: BATCHES (LOTES)'),
    source.indexOf('MODAL: EDICIÓN MASIVA'),
);

describe('UX de alta y merma lote+bodega', () => {
    it('genera UUID válidos y solo autoselecciona una bodega cuando es inequívoca', () => {
        expect(newManualBatchClientEventId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
        expect(soleActiveWarehouseId([
            { id: 'w1', name: 'Principal', isActive: true, isDefault: true },
        ])).toBe('w1');
        expect(soleActiveWarehouseId([
            { id: 'w1', name: 'Principal', isActive: true, isDefault: true },
            { id: 'w2', name: 'Norte', isActive: true, isDefault: false },
        ])).toBe('');
    });

    it('envía UUID, bodega y cantidad como texto en ambos comandos', () => {
        expect(flow).toContain('clientEventId: batchForm.clientEventId');
        expect(flow).toContain('warehouseId: batchForm.warehouseId');
        expect(flow).toContain('quantity: batchForm.quantity.trim()');
        expect(flow).toContain('clientEventId: writeoffForm.clientEventId');
        expect(flow).toContain('warehouseId: writeoffForm.warehouseId');
        expect(flow).toContain('quantity: writeoffForm.quantity.trim()');
        expect(flow).not.toContain('quantity: Number(batchForm.quantity)');
    });

    it('conserva clientEventId al reintentar y lo rota solo tras edición o éxito', () => {
        expect(flow).toContain('setBatchForm(current => ({ ...current, attempted: true }))');
        expect(flow).toContain("Reintentá: el identificador se conserva.");
        expect(flow).toContain('current.attempted\n                ? { clientEventId: newManualBatchClientEventId(), attempted: false }');
        expect(flow).toContain('setBatchForm(newManualBatchForm(batchForm.warehouseId))');
        expect(flow).toContain('setWriteoffForm(current => current ? { ...current, attempted: true } : current)');
    });

    it('la merma no usa confirm vacío ni supone que el saldo global pertenece a una bodega', () => {
        expect(flow).not.toMatch(/confirm\s*\(/u);
        expect(flow).toContain("quantity: ''");
        expect(modal).toContain('No se reparte ni se adivina ubicación.');
        expect(modal).toContain('aria-label="Bodega de la merma"');
        expect(modal).toContain('aria-label="Cantidad a dar de baja"');
        expect(modal).toContain('aria-label="Justificación de la merma"');
    });

    it('presenta errores recuperables dentro del diálogo y bloquea cierres durante envío', () => {
        expect(modal).toContain('role="dialog"');
        expect(modal).toContain('role="alert"');
        expect(modal).toContain('!batchSubmitting && !writeoffSubmitting');
        expect(flow).toContain("setBatchCommandError(data.error || 'No pudimos registrar el lote.')");
        expect(flow).toContain("setBatchCommandError(data.error || 'No pudimos registrar la baja del lote.')");
    });
});
