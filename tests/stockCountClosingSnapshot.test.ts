import { describe, expect, it, vi } from 'vitest';
import { assertStockCountCaptureFresh, readStockCountWarehouseBook } from '../backend/services/stockCountClosingSnapshot';

describe('libro físico autoritativo del cierre', () => {
    const base = { tenantId: 'tenant-a', productId: 'product-a', warehouseId: 'principal', isDefault: true, aggregateStock: '10' };
    it('resta otras bodegas al agregado cuando principal es implícita', async () => {
        const tx = { $queryRaw: vi.fn().mockResolvedValue([{ warehouseId: 'secundaria', stock: '3' }]) } as any;
        expect((await readStockCountWarehouseBook(tx, base)).toString()).toBe('7');
    });
    it('respeta saldo explícito y secundaria ausente', async () => {
        const tx = { $queryRaw: vi.fn().mockResolvedValue([{ warehouseId: 'principal', stock: '2.75' }]) } as any;
        expect((await readStockCountWarehouseBook(tx, base)).toString()).toBe('2.75');
        expect((await readStockCountWarehouseBook(tx, { ...base, warehouseId: 'sin-stock', isDefault: false })).toString()).toBe('0');
    });
    it('rechaza cambio neto aunque el movimiento tenga fecha comercial retroactiva', () => {
        expect(() => assertStockCountCaptureFresh({ productName: 'Clavo', currentBook: '8', bookStockAtCapture: '10' })).toThrow(/cambió después/);
        expect(() => assertStockCountCaptureFresh({ productName: 'Clavo', currentBook: '10', bookStockAtCapture: '10' })).not.toThrow();
    });
    it('exige recapturar historia sin evidencia y admite saldo cero confirmado', () => {
        expect(() => assertStockCountCaptureFresh({ productName: 'Clavo', currentBook: '8', bookStockAtCapture: null })).toThrow(/necesita confirmación/);
        expect(() => assertStockCountCaptureFresh({ productName: 'Clavo', currentBook: '0', bookStockAtCapture: '0' })).not.toThrow();
    });
    it('normaliza Float heredado a la precisión física sin ocultar un cambio real de 0.0001', async () => {
        const tx = { $queryRaw: vi.fn().mockResolvedValue([{ warehouseId: 'principal', stock: 0.1 + 0.2 }]) } as any;
        const currentBook = await readStockCountWarehouseBook(tx, { ...base, aggregateStock: 0.1 + 0.2 });
        expect(currentBook.toString()).toBe('0.3');
        expect(() => assertStockCountCaptureFresh({ productName: 'Medido', currentBook: 0.1 + 0.2, bookStockAtCapture: '0.3000' })).not.toThrow();
        expect(() => assertStockCountCaptureFresh({ productName: 'Medido', currentBook: '0.3001', bookStockAtCapture: '0.3000' })).toThrow(/cambió/);
    });
});
