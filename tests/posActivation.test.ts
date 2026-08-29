import { describe, expect, it, vi } from 'vitest';
import {
    checkoutAttemptFor,
    customerCreditUsagePct,
    effectivePosSaleMode,
    effectivePosQuantityStep,
    normalizeApiFailure,
    normalizeFieldErrors,
    repeatedCatalogAddIncrement,
    requestErrorCategory,
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

    it('un producto legacy por unidad vuelve a tratarse como contado en el POS', () => {
        const legacyUnit = { saleMode: null, quantityStep: null, unit: 'unidad' } as const;
        expect(effectivePosSaleMode(legacyUnit)).toBe('COUNTED');
        expect(effectivePosQuantityStep(legacyUnit)).toBe(1);
    });

    it('un producto medido legacy sigue conservando paso decimal', () => {
        const legacyMeasured = { saleMode: null, quantityStep: null, unit: 'kg' } as const;
        expect(effectivePosSaleMode(legacyMeasured)).toBe('MEASURED');
        expect(effectivePosQuantityStep(legacyMeasured)).toBe(0.0001);
    });

    it('normaliza unidad legacy sin convertir productos configurados explícitamente', () => {
        expect(effectivePosSaleMode({ saleMode: null, quantityStep: null, unit: ' Unidad ' })).toBe('COUNTED');
        expect(effectivePosSaleMode({ saleMode: 'MEASURED', quantityStep: null, unit: 'unidad' })).toBe('MEASURED');
        expect(effectivePosSaleMode({ saleMode: null, quantityStep: 0.5, unit: 'unidad' })).toBe('MEASURED');
        expect(effectivePosSaleMode({ saleMode: null, quantityStep: null })).toBe('MEASURED');
    });

    it('solo acepta pasos explícitos finitos y positivos', () => {
        expect(effectivePosQuantityStep({ saleMode: 'MEASURED', quantityStep: 0.25 })).toBe(0.25);
        expect(effectivePosQuantityStep({ saleMode: 'MEASURED', quantityStep: 0 })).toBe(0.0001);
        expect(effectivePosQuantityStep({ saleMode: 'MEASURED', quantityStep: -1 })).toBe(0.0001);
        expect(effectivePosQuantityStep({ saleMode: 'MEASURED', quantityStep: Number.NaN })).toBe(0.0001);
        expect(effectivePosQuantityStep({ saleMode: 'COUNTED', quantityStep: null })).toBe(1);
    });

    it('el primer toque y los repetidos respetan el múltiplo de un producto contado', () => {
        expect(repeatedCatalogAddIncrement({ saleMode: 'COUNTED', quantityStep: 6, unit: 'unidad' })).toBe(6);
        expect(repeatedCatalogAddIncrement({ saleMode: 'COUNTED', quantityStep: null, unit: 'unidad' })).toBe(1);
    });

    it('un producto legacy medido conserva el incremento histórico de una unidad', () => {
        expect(repeatedCatalogAddIncrement({ saleMode: null, quantityStep: null, unit: 'kg' })).toBe(1);
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

    it('la barra de crédito no produce NaN ni Infinity cuando el límite es cero', () => {
        expect(customerCreditUsagePct(0, 0)).toBe(0);
        expect(customerCreditUsagePct(0, 50)).toBe(0);
        expect(customerCreditUsagePct(100, 25)).toBe(25);
        expect(customerCreditUsagePct(100, 500)).toBe(100);
    });

    it('la barra de crédito acota entradas negativas y no finitas', () => {
        expect(customerCreditUsagePct(-1, 20)).toBe(0);
        expect(customerCreditUsagePct(Number.NaN, 20)).toBe(0);
        expect(customerCreditUsagePct(100, -1)).toBe(0);
        expect(customerCreditUsagePct(100, -0.01)).toBe(0);
        expect(customerCreditUsagePct(100, Number.POSITIVE_INFINITY)).toBe(0);
        expect(customerCreditUsagePct(100, 0)).toBe(0);
    });

    it('acepta espacios periféricos y distingue el límite exacto del SKU', () => {
        const result = validateQuickProductDraft({
            name: ' Producto ',
            sku: 'x'.repeat(100),
            price: ' 10.50 ',
            cost: '   ',
            stock: '   ',
        }, 'NO-USAR');

        expect(result).toEqual({
            ok: true,
            payload: {
                name: 'Producto',
                sku: 'X'.repeat(100),
                price: '10.5',
                cost: '0',
                stock: '0',
                minStock: '5',
                category: 'General',
                unit: 'unidad',
                saleMode: 'COUNTED',
                quantityStep: '1',
                productFamily: 'GENERAL',
            },
        });
    });

    it('usa un mensaje seguro si la validación de existencia lanza un valor inesperado', async () => {
        vi.resetModules();
        vi.doMock('../utils/quantity', () => ({
            validateNonNegativeQuantity: () => {
                throw null;
            },
        }));

        try {
            const isolatedModule = await import('../utils/posActivation');
            const result = isolatedModule.validateQuickProductDraft({
                name: 'Producto', sku: 'SKU-1', price: '10', cost: '5', stock: '1',
            }, 'NO-USAR');

            expect(result).toStrictEqual({
                ok: false,
                errors: { stock: 'La existencia no es válida.' },
            });
        } finally {
            vi.doUnmock('../utils/quantity');
            vi.resetModules();
        }
    });

    it('normaliza SKU y conserva costo y existencia válidos', () => {
        const result = validateQuickProductDraft({
            name: ' Clavos ', sku: ' cla-1 ', price: '10.00', cost: '4.50', stock: '',
        }, 'NO-USAR');
        expect(result).toEqual({
            ok: true,
            payload: {
                name: 'Clavos', sku: 'CLA-1', price: '10', cost: '4.5', stock: '0',
                minStock: '5', category: 'General', unit: 'unidad', saleMode: 'COUNTED',
                quantityStep: '1', productFamily: 'GENERAL',
            },
        });
    });

    it('reporta juntos todos los campos inválidos del alta rápida', () => {
        const result = validateQuickProductDraft({
            name: ' ', sku: 'x'.repeat(101), price: '0', cost: '-1', stock: '-2',
        }, 'SKU-AUTO');
        expect(result.ok).toBe(false);
        if (result.ok === false) {
            expect(result.errors.name).toBe('Escribí el nombre del producto.');
            expect(result.errors.sku).toContain('100');
            expect(result.errors.price).toContain('mayor que cero');
            expect(result.errors.cost).toContain('negativo');
            expect(result.errors.stock).toBeTruthy();
        }
    });

    it.each(['', '.', 'texto', 'Infinity', '-0.01'])(
        'rechaza un precio no vendible: %s',
        (price) => {
            const result = validateQuickProductDraft({
                name: 'Producto', sku: '', price, cost: '', stock: '1',
            }, 'SKU-AUTO');
            expect(result.ok).toBe(false);
            if (result.ok === false) expect(result.errors.price).toBe('Ingresá un precio mayor que cero.');
        },
    );

    it.each(['.', 'texto', 'Infinity', '-0.01'])(
        'rechaza un costo inválido: %s',
        (cost) => {
            const result = validateQuickProductDraft({
                name: 'Producto', sku: '', price: '10', cost, stock: '1',
            }, 'SKU-AUTO');
            expect(result.ok).toBe(false);
            if (result.ok === false) expect(result.errors.cost).toBe('El costo no puede ser negativo.');
        },
    );
});

describe('errores de API del POS', () => {
    it('normaliza solo mensajes utilizables por campo', () => {
        expect(normalizeFieldErrors(null)).toEqual({});
        expect(normalizeFieldErrors([])).toEqual({});
        expect(normalizeFieldErrors('error')).toEqual({});
        const normalized = normalizeFieldErrors({
            name: ['', '   ', 7, 'Nombre requerido'],
            price: 'Precio inválido',
            ignored: [7, false],
            scalarIgnored: 7,
        });
        expect(normalized).toStrictEqual({ name: 'Nombre requerido', price: 'Precio inválido' });
        expect(Object.keys(normalized)).toEqual(['name', 'price']);
    });

    it.each([
        [undefined, 'network'],
        [400, 'validation'],
        [422, 'validation'],
        [409, 'conflict'],
        [401, 'authorization'],
        [403, 'authorization'],
        [500, 'server'],
        [503, 'server'],
        [404, 'unknown'],
    ] as const)('clasifica status %s como %s', (status, expected) => {
        expect(requestErrorCategory(status)).toBe(expected);
    });

    it('usa fallback para errores vacíos y conserva un código válido', () => {
        expect(normalizeApiFailure(409, { error: '  ', code: 'DUPLICATE', details: null }, 'Reintentá')).toEqual({
            message: 'Reintentá',
            fields: {},
            category: 'conflict',
            code: 'DUPLICATE',
        });
        expect(normalizeApiFailure(undefined, null, 'Sin conexión')).toEqual({
            message: 'Sin conexión',
            fields: {},
            category: 'network',
        });
        expect(normalizeApiFailure(400, { error: '  Precio inválido  ' }, 'Falló')).toEqual({
            message: 'Precio inválido',
            fields: {},
            category: 'validation',
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

    it('crea un intento nuevo con la hora inyectada cuando no existe uno previo', () => {
        expect(checkoutAttemptFor(null, 'sale-a', () => 'id-a', () => 42)).toEqual({
            signature: 'sale-a',
            offlineId: 'id-a',
            startedAt: 42,
        });
    });
});
