import { describe, expect, it } from 'vitest';
import { buildBoundedBatchWarehouseSourceKey } from '../backend/lib/batchWarehouseLedger';

describe('mutación: sourceKey lote-bodega acotado', () => {
    it('conserva exactamente 191 caracteres y compacta desde 192', () => {
        const prefix = 'p'.repeat(100);
        const batchAtLimit = 'b'.repeat(84);
        const rawAtLimit = `${prefix}:batch:${batchAtLimit}`;
        expect(rawAtLimit).toHaveLength(191);
        expect(buildBoundedBatchWarehouseSourceKey(prefix, batchAtLimit)).toBe(rawAtLimit);

        const compacted = buildBoundedBatchWarehouseSourceKey(prefix, `${batchAtLimit}b`);
        expect(compacted).toMatch(/^batch-event:[a-f0-9]{64}$/u);
        expect(compacted).toHaveLength(76);
        expect(compacted).not.toBe(`${prefix}:batch:${batchAtLimit}b`);
    });
});
