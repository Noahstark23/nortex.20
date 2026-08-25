import { describe, expect, it, vi } from 'vitest';
import {
    checkoutAttemptFor,
    effectivePosQuantityStep,
    normalizeApiFailure,
    validateQuickProductDraft,
} from '../utils/posActivation';

describe('alta rápida del POS', () => {
    it('crea unidades contables con paso 1 y costo desconocido en cero', () => {
        const result = validateQuickProductDraft({
            name: '  Gaseosa  ',
            sku: '',
            price: '25.50',
            cost: '',
            stock: '12',
        }, 'SKU-AUTO');

        expect(result).toEqual({
            ok: true,
            payload: {
                name: 'Gaseosa',
                sku: 'SKU-AUTO',
                price: '25.5',
                cost: '0',
                stock: '12',
                minStock: '5',
                category: 'General',
                unit: 'unidad',
                saleMode: 'COUNTED',
                quantityStep: '1',
                productFamily: 'GENERAL',
            },
        });
    });

    it('no reemplaza un costo cero explícito con un porcentaje del precio', () => {
        const result = validateQuickProductDraft({
            name: 'Servicio sin costo', sku: 'zero', price: '100', cost: '0', stock: '0',
        }, 'unused');
        expect(result.ok && result.payload.cost).toBe('0');
    });

    it('rechaza existencia fraccionaria para un producto contado', () => {
        const result = validateQuickProductDraft({
            name: 'Unidad', sku: '', price: '10', cost: '', stock: '1.5',
        }, 'SKU-AUTO');
        expect(result).toEqual({
            ok: false,
            errors: { stock: 'Los productos contables requieren cantidades y pasos enteros' },
        });
    });

    it('el botón + lleva una unidad de 1 a 2 sin romper pasos medidos o legacy', () => {
        expect(1 + effectivePosQuantityStep({ saleMode: 'COUNTED', quantityStep: 1 })).toBe(2);
        expect(effectivePosQuantityStep({ saleMode: 'MEASURED', quantityStep: 0.25 })).toBe(0.25);
        expect(effectivePosQuantityStep({ saleMode: null, quantityStep: null })).toBe(0.0001);
    });

    it('devuelve errores por campo sin descartar el detalle del backend', () => {
        expect(normalizeApiFailure(400, {
            error: 'Datos de entrada inválidos',
            details: { name: ['Nombre requerido'], price: ['Precio inválido'] },
        }, 'Falló')).toEqual({
            message: 'Datos de entrada inválidos',
            fields: { name: 'Nombre requerido', price: 'Precio inválido' },
            category: 'validation',
        });
    });

    it('clasifica un 500 sin exponer detalles técnicos', () => {
        expect(normalizeApiFailure(500, {}, 'El servidor no pudo guardar el producto.')).toEqual({
            message: 'El servidor no pudo guardar el producto.',
            fields: {},
            category: 'server',
        });
    });
});

describe('identidad del intento de cobro', () => {
    it('reusa offlineId para el mismo payload y crea otro si cambia la intención', () => {
        const createId = vi.fn()
            .mockReturnValueOnce('sale-attempt-1')
            .mockReturnValueOnce('sale-attempt-2');
        const first = checkoutAttemptFor(null, 'cash:line-1', createId, () => 1000);
        const retry = checkoutAttemptFor(first, 'cash:line-1', createId, () => 2000);
        const changed = checkoutAttemptFor(retry, 'cash:line-2', createId, () => 3000);

        expect(retry).toBe(first);
        expect(changed).toEqual({ signature: 'cash:line-2', offlineId: 'sale-attempt-2', startedAt: 3000 });
        expect(createId).toHaveBeenCalledTimes(2);
    });
});
