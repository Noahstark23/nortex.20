import { describe, expect, it } from 'vitest';
import {
    approvalTokenHash,
    assertUniqueCorrectionLines,
    canonicalCorrectionCommand,
    correctionPayloadHash,
    isReturnWithinWindow,
    isSameManaguaBusinessDay,
} from '../backend/lib/saleCorrections';
import { CreateSaleCorrectionSchema } from '../backend/validation/saleCorrectionSchemas';

const returnRequest = () => ({
    clientEventId: '018f47cb-52d6-7f6a-8b41-25db4b0ae1a9',
    saleId: 'sale-1',
    kind: 'RETURN' as const,
    reason: 'Producto defectuoso confirmado',
    resolution: 'REFUND' as const,
    refundMethod: 'CASH' as const,
    lines: [{ saleItemId: 'line-1', quantity: '1.2500', disposition: 'QUARANTINE' as const }],
});

describe('contrato de correcciones de venta', () => {
    it('exige líneas y resolución para devolución', () => {
        expect(CreateSaleCorrectionSchema.safeParse(returnRequest()).success).toBe(true);
        const noLines = CreateSaleCorrectionSchema.safeParse({ ...returnRequest(), lines: [] });
        expect(noLines.success).toBe(false);
        if (!noLines.success) expect(noLines.error.issues).toEqual([{
            code: 'custom', path: ['lines'], message: 'Seleccioná al menos un producto',
        }]);
        const noResolution = CreateSaleCorrectionSchema.safeParse({ ...returnRequest(), resolution: undefined });
        expect(noResolution.success).toBe(false);
        if (!noResolution.success) expect(noResolution.error.issues).toEqual([{
            code: 'custom', path: ['resolution'], message: 'Elegí reembolso, cambio o saldo a favor',
        }]);
        const noRefundMethod = CreateSaleCorrectionSchema.safeParse({ ...returnRequest(), refundMethod: undefined });
        expect(noRefundMethod.success).toBe(false);
        if (!noRefundMethod.success) expect(noRefundMethod.error.issues).toEqual([{
            code: 'custom', path: ['refundMethod'], message: 'Elegí cómo se devolverá el dinero',
        }]);
        expect(CreateSaleCorrectionSchema.safeParse({ ...returnRequest(), resolution: 'EXCHANGE', refundMethod: undefined }).success).toBe(true);
    });

    it('una anulación no acepta líneas ni canal de reembolso', () => {
        expect(CreateSaleCorrectionSchema.safeParse({
            clientEventId: crypto.randomUUID(), saleId: 'sale-1', kind: 'VOID',
            reason: 'Cobro duplicado al mismo cliente',
        }).success).toBe(true);
        const invalidVoid = CreateSaleCorrectionSchema.safeParse({ ...returnRequest(), kind: 'VOID' });
        expect(invalidVoid.success).toBe(false);
        if (!invalidVoid.success) expect(invalidVoid.error.issues).toEqual([{
            code: 'custom', path: [], message: 'Una anulación completa no admite líneas ni resolución de devolución',
        }]);
        const baseVoid = { clientEventId: crypto.randomUUID(), saleId: 'sale-1', kind: 'VOID', reason: 'Cobro duplicado al mismo cliente' };
        expect(CreateSaleCorrectionSchema.safeParse({ ...baseVoid, lines: returnRequest().lines }).success).toBe(false);
        expect(CreateSaleCorrectionSchema.safeParse({ ...baseVoid, resolution: 'REFUND' }).success).toBe(false);
        expect(CreateSaleCorrectionSchema.safeParse({ ...baseVoid, refundMethod: 'CASH' }).success).toBe(false);
    });

    it('la huella es estable ante orden de líneas y espacios del motivo', () => {
        const first = returnRequest();
        const second = {
            ...first,
            reason: '  Producto   defectuoso confirmado ',
            lines: [
                { saleItemId: 'line-2', quantity: '2', disposition: 'RESTOCK' as const },
                first.lines[0],
            ],
        };
        const reordered = { ...second, lines: [...second.lines].reverse() };
        expect(correctionPayloadHash(second)).toBe(correctionPayloadHash(reordered));
        expect(canonicalCorrectionCommand(second).reason).toBe('Producto defectuoso confirmado');
        expect(canonicalCorrectionCommand(second)).toEqual({
            saleId: 'sale-1', kind: 'RETURN', reason: 'Producto defectuoso confirmado',
            resolution: 'REFUND', refundMethod: 'CASH',
            lines: [
                { saleItemId: 'line-1', quantity: '1.2500', disposition: 'QUARANTINE' },
                { saleItemId: 'line-2', quantity: '2.0000', disposition: 'RESTOCK' },
            ],
        });
        expect(canonicalCorrectionCommand({ saleId: ' sale-2 ', kind: 'VOID', reason: '  Error   completo ' })).toEqual({
            saleId: 'sale-2', kind: 'VOID', reason: 'Error completo', resolution: null, refundMethod: null, lines: [],
        });
        expect(canonicalCorrectionCommand({
            ...first,
            lines: [{ saleItemId: ' line-1 ', quantity: '1.25', disposition: 'QUARANTINE' }],
        }).lines[0].saleItemId).toBe('line-1');
        expect(correctionPayloadHash(first)).toBe('62283142f9739c8cb2cf94eea21db86b342d85fb3d0ce2d1fab6fb94e1641458');
    });

    it('el token solo se persiste como SHA-256', () => {
        expect(approvalTokenHash('secreto')).toMatch(/^[a-f0-9]{64}$/);
        expect(approvalTokenHash('secreto')).toBe('df733656293a19c54f69093ba916f0a1a2a3c151fc95c13f3a794c2631eeb3a6');
        expect(approvalTokenHash('secreto')).not.toContain('secreto');
    });

    it('rechaza líneas duplicadas antes de persistir', () => {
        expect(() => assertUniqueCorrectionLines([
            { saleItemId: 'a', quantity: '1', disposition: 'RESTOCK' },
            { saleItemId: 'a', quantity: '2', disposition: 'LOSS' },
        ])).toThrow('No repitás');
        expect(() => assertUniqueCorrectionLines([
            { saleItemId: 'a', quantity: '1', disposition: 'RESTOCK' },
            { saleItemId: 'b', quantity: '2', disposition: 'LOSS' },
        ])).not.toThrow();
    });
});

describe('ventanas operativas en calendario Managua', () => {
    it('anulación solo reconoce el mismo día civil', () => {
        expect(isSameManaguaBusinessDay(
            new Date('2026-08-31T06:30:00.000Z'),
            new Date('2026-08-31T23:00:00.000Z'),
        )).toBe(true);
        expect(isSameManaguaBusinessDay(
            new Date('2026-08-31T06:30:00.000Z'),
            new Date('2026-09-01T06:30:00.000Z'),
        )).toBe(false);
    });

    it('incluye exactamente el día 30 y rechaza el 31', () => {
        const sale = new Date('2026-08-01T18:00:00.000Z');
        expect(isReturnWithinWindow(sale, 30, new Date('2026-08-31T18:00:00.000Z'))).toBe(true);
        expect(isReturnWithinWindow(sale, 30, new Date('2026-09-01T18:00:00.000Z'))).toBe(false);
        expect(isReturnWithinWindow(sale, -1, sale)).toBe(false);
        expect(isReturnWithinWindow(sale, -1, new Date('2026-07-31T18:00:00.000Z'))).toBe(false);
        expect(isReturnWithinWindow(sale, 1.5, sale)).toBe(false);
        expect(isReturnWithinWindow(sale, 0, sale)).toBe(true);
        expect(isReturnWithinWindow(sale, 0, new Date('2026-08-02T18:00:00.000Z'))).toBe(false);
    });
});
