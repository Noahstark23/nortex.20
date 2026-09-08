import { describe, expect, it } from 'vitest';
import {
    allowedReturnRefundMethods,
    assertMatchingReturnReplay,
    buildReturnAvailability,
    buildReturnPayloadHash,
    resolveReturnRefundMethod,
    resolveRequestedReturnItems,
    resolveReturnWarehouseId,
    ReturnResolutionError,
    type ReturnProductAuthority,
    type ReturnSaleItemSnapshot,
} from '../backend/services/returnService';

const makeLine = (
    overrides: Partial<ReturnSaleItemSnapshot> = {},
): ReturnSaleItemSnapshot => ({
    id: 'sale-item-meat-base',
    productId: 'product-meat',
    quantity: '1.50',
    priceAtSale: '120.00',
    costAtSale: '80.00',
    discount: '0',
    productNameAtSale: 'Posta de res',
    unitAtSale: 'lb',
    saleModeAtSale: 'MEASURED',
    quantityStepAtSale: '0.01',
    presentationAtSale: 'BASE',
    presentationQuantityAtSale: '1.50',
    ...overrides,
});

const productsFor = (
    ...products: Array<ReturnProductAuthority & { quantityStep?: string }>
): Map<string, ReturnProductAuthority> => new Map(
    products.map((product): [string, ReturnProductAuthority] => [product.id, product]),
);

const meatProducts = productsFor({
    id: 'product-meat',
    name: 'Nombre actual que no debe sustituir el snapshot',
    unit: 'kg',
    quantityStep: '0.25',
});

const errorFrom = (operation: () => unknown): ReturnResolutionError => {
    try {
        operation();
    } catch (error) {
        expect(error).toBeInstanceOf(ReturnResolutionError);
        return error as ReturnResolutionError;
    }
    throw new Error('Se esperaba ReturnResolutionError');
};

describe('idempotencia de devoluciones', () => {
    const basePayload = {
        saleId: 'sale-001',
        items: [
            { saleItemId: 'line-b', quantity: '0.5000' },
            { saleItemId: 'line-a', productId: 'product-a', quantity: '1.2500' },
        ],
        reason: '  Empaque dañado  ',
        refundMethod: 'CARD' as const,
    };

    it('produce SHA-256 estable para reintentos semánticamente iguales', () => {
        const first = buildReturnPayloadHash(basePayload);
        const replay = buildReturnPayloadHash({
            ...basePayload,
            items: [
                // El precio legacy se ignora y el orden/formato decimal no
                // convierten un retry de red en una operación nueva.
                { saleItemId: 'line-a', productId: 'product-a', quantity: '1.25', price: '0.01' } as never,
                { saleItemId: 'line-b', quantity: 0.5 },
            ],
            reason: 'Empaque dañado',
        });

        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(replay).toBe(first);
        expect(() => assertMatchingReturnReplay({ payloadHash: first }, replay)).not.toThrow();
    });

    it.each([
        ['otra venta', { saleId: 'sale-002' }],
        ['otra cantidad', { items: [{ saleItemId: 'line-b', quantity: '0.75' }, { saleItemId: 'line-a', productId: 'product-a', quantity: '1.25' }] }],
        ['otro motivo', { reason: 'Producto vencido' }],
        ['otro canal', { refundMethod: 'CASH' as const }],
        ['otra aprobación', { correctionRequestId: 'correction-002' }],
    ])('cambia la huella ante %s', (_label, override) => {
        expect(buildReturnPayloadHash({ ...basePayload, ...override })).not.toBe(
            buildReturnPayloadHash(basePayload),
        );
    });

    it.each([null, undefined, 'f'.repeat(64)])(
        'clasifica hash previo %s como conflicto estable',
        (payloadHash) => {
            const error = errorFrom(() => assertMatchingReturnReplay(
                { payloadHash },
                buildReturnPayloadHash(basePayload),
            ));
            expect(error).toMatchObject({
                code: 'RETURN_IDEMPOTENCY_CONFLICT',
                httpStatus: 409,
            });
        },
    );
});

describe('devoluciones por línea vendida', () => {
    it('devuelve 0.50 lb sin truncar y calcula desde el precio autoritativo de la venta', () => {
        const result = resolveRequestedReturnItems({
            saleItems: [makeLine()],
            previousReturns: [],
            productsById: meatProducts,
            requestedItems: [{
                saleItemId: 'sale-item-meat-base',
                quantity: '0.50',
                // Un cliente antiguo o manipulado puede seguir enviándolo en
                // runtime; el servicio no debe consultarlo para calcular nada.
                price: '0.01',
            } as never],
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].quantity.toString()).toBe('0.5');
        expect(result.items[0].unit).toBe('lb');
        expect(result.items[0].name).toBe('Posta de res');
        expect(result.items[0].refundUnitPrice.toString()).toBe('120');
        expect(result.items[0].lineTotal.toString()).toBe('60');
        expect(result.total.toFixed(2)).toBe('60.00');
        expect(result.costTotal.toFixed(2)).toBe('40.00');
    });

    it('multiplica el precio unitario exacto y redondea una sola vez al total', () => {
        const result = resolveRequestedReturnItems({
            saleItems: [makeLine({
                quantity: '3',
                priceAtSale: '3.33',
                unitPriceExactAtSale: '3.3333',
                saleModeAtSale: 'COUNTED',
                quantityStepAtSale: '1',
                presentationQuantityAtSale: '3',
            })],
            previousReturns: [],
            productsById: meatProducts,
            requestedItems: [{ saleItemId: 'sale-item-meat-base', quantity: '3' }],
        });

        expect(result.items[0].refundUnitPrice.toFixed(4)).toBe('3.3333');
        expect(result.items[0].lineTotal.toFixed(4)).toBe('9.9999');
        expect(result.total.toFixed(2)).toBe('10.00');
        expect(result.total.toFixed(2)).not.toBe('9.99');
    });

    it('conserva más de 4 decimales tras descuentos hasta multiplicar la cantidad', () => {
        const result = resolveRequestedReturnItems({
            saleItems: [makeLine({
                quantity: '200',
                priceAtSale: '3.33',
                unitPriceExactAtSale: '3.3333',
                discount: '10',
                saleModeAtSale: 'COUNTED',
                quantityStepAtSale: '1',
                presentationQuantityAtSale: '200',
            })],
            previousReturns: [],
            productsById: meatProducts,
            requestedItems: [{ saleItemId: 'sale-item-meat-base', quantity: '200' }],
        });

        // 3.3333 × 90% = 2.99997; 2.99997 × 200 = 599.994 → 599.99.
        // Redondear antes el unitario a 3.0000 produciría el total incorrecto 600.00.
        expect(result.items[0].refundUnitPrice.toFixed(5)).toBe('2.99997');
        expect(result.items[0].lineTotal.toFixed(5)).toBe('599.99400');
        expect(result.total.toFixed(2)).toBe('599.99');
        expect(result.total.toFixed(2)).not.toBe('600.00');
    });

    it('distingue BASE y PACK del mismo SKU por saleItemId, incluso con precios distintos', () => {
        const saleItems = [
            makeLine({
                id: 'line-base',
                quantity: '2.00',
                priceAtSale: '100.00',
                presentationAtSale: 'BASE',
                presentationQuantityAtSale: '2.00',
            }),
            makeLine({
                id: 'line-pack',
                quantity: '6.00',
                priceAtSale: '72.50',
                productNameAtSale: 'Posta de res — paquete familiar',
                presentationAtSale: 'PACK',
                presentationQuantityAtSale: '6.00',
            }),
        ];

        const result = resolveRequestedReturnItems({
            saleItems,
            previousReturns: [],
            productsById: meatProducts,
            requestedItems: [
                { saleItemId: 'line-pack', quantity: '0.50' },
                { saleItemId: 'line-base', quantity: '0.25' },
            ],
        });

        expect(result.items.map((item) => ({
            id: item.saleItemId,
            presentation: item.presentation,
            price: item.refundUnitPrice.toString(),
            total: item.lineTotal.toString(),
        }))).toEqual([
            { id: 'line-pack', presentation: 'PACK', price: '72.5', total: '36.25' },
            { id: 'line-base', presentation: 'BASE', price: '100', total: '25' },
        ]);
        expect(result.total.toFixed(2)).toBe('61.25');
    });

    it('mantiene compatibilidad con productId solo cuando identifica una única línea', () => {
        const result = resolveRequestedReturnItems({
            saleItems: [makeLine()],
            previousReturns: [],
            productsById: meatProducts,
            requestedItems: [{ productId: 'product-meat', quantity: '0.50' }],
        });

        expect(result.items[0].saleItemId).toBe('sale-item-meat-base');
        expect(result.items[0].quantity.toString()).toBe('0.5');
    });

    it('rechaza productId legacy cuando el SKU aparece en dos líneas de la venta', () => {
        const error = errorFrom(() => resolveRequestedReturnItems({
            saleItems: [
                makeLine({ id: 'line-base', presentationAtSale: 'BASE' }),
                makeLine({ id: 'line-pack', presentationAtSale: 'PACK' }),
            ],
            previousReturns: [],
            productsById: meatProducts,
            requestedItems: [{ productId: 'product-meat', quantity: '0.50' }],
        }));

        expect(error).toMatchObject({
            code: 'AMBIGUOUS_LEGACY_RETURN_ITEM',
            httpStatus: 409,
        });
    });
});

describe('bodega de restitución', () => {
    it('deduplica una misma bodega e ignora ubicaciones legacy nulas', () => {
        expect(resolveReturnWarehouseId([
            { warehouseId: 'warehouse-norte' },
            { warehouseId: null },
            { warehouseId: 'warehouse-norte' },
            {},
        ])).toBe('warehouse-norte');
    });

    it('conserva el fallback legacy cuando ningún movimiento tenía bodega', () => {
        expect(resolveReturnWarehouseId([
            { warehouseId: null },
            {},
            { warehouseId: '   ' },
        ])).toBeNull();
    });

    it('rechaza una venta cuyos movimientos apuntan a dos bodegas', () => {
        const error = errorFrom(() => resolveReturnWarehouseId([
            { warehouseId: 'warehouse-norte' },
            { warehouseId: 'warehouse-sur' },
        ]));

        expect(error).toMatchObject({
            code: 'RETURN_WAREHOUSE_RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });
    });
});

describe('método del importe ya liquidado', () => {
    it.each(['CASH', 'CARD', 'QR', 'TRANSFER'] as const)(
        'una venta %s no crédito deriva el mismo canal',
        (salePaymentMethod) => {
            expect(resolveReturnRefundMethod({
                salePaymentMethod,
                payments: [],
                settledRefund: '25.00',
            })).toBe(salePaymentMethod);
        },
    );

    it('una venta CREDIT pagada por un único método deriva ese método', () => {
        expect(resolveReturnRefundMethod({
            salePaymentMethod: 'CREDIT',
            payments: [{ method: 'CARD' }, { method: 'CARD' }],
            settledRefund: '25.00',
        })).toBe('CARD');
    });

    it('CREDIT sin pagos requiere un método explícito para devolver lo ya liquidado', () => {
        const error = errorFrom(() => resolveReturnRefundMethod({
            salePaymentMethod: 'CREDIT',
            payments: [],
            settledRefund: '25.00',
        }));

        expect(error).toMatchObject({
            code: 'RETURN_REFUND_METHOD_RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });
    });

    it('CREDIT con pagos mixtos requiere elegir explícitamente un método observado', () => {
        const payments = [{ method: 'CASH' }, { method: 'CARD' }];
        const missing = errorFrom(() => resolveReturnRefundMethod({
            salePaymentMethod: 'CREDIT',
            payments,
            settledRefund: '25.00',
        }));
        expect(missing).toMatchObject({
            code: 'RETURN_REFUND_METHOD_RECONCILIATION_REQUIRED',
            httpStatus: 409,
        });

        expect(resolveReturnRefundMethod({
            salePaymentMethod: 'CREDIT',
            payments,
            explicitRefundMethod: 'CARD',
            settledRefund: '25.00',
        })).toBe('CARD');
    });

    it('rechaza un método explícito que no aparece entre los pagos observados', () => {
        const error = errorFrom(() => resolveReturnRefundMethod({
            salePaymentMethod: 'CREDIT',
            payments: [{ method: 'CARD' }, { method: 'TRANSFER' }],
            explicitRefundMethod: 'QR',
            settledRefund: '25.00',
        }));

        expect(error).toMatchObject({
            code: 'RETURN_REFUND_METHOD_MISMATCH',
            httpStatus: 409,
        });
    });

    it('CREDIT sin pagos acepta el método explícito', () => {
        expect(resolveReturnRefundMethod({
            salePaymentMethod: 'CREDIT',
            payments: [],
            explicitRefundMethod: 'QR',
            settledRefund: '25.00',
        })).toBe('QR');
    });

    it('sin importe liquidado no necesita reconciliar un canal', () => {
        expect(resolveReturnRefundMethod({
            salePaymentMethod: 'CREDIT',
            payments: [{ method: 'CASH' }, { method: 'CARD' }],
            settledRefund: '0',
        })).toBeNull();
    });
});

describe('opciones permitidas de reembolso', () => {
    it('CREDIT con un único método observado ofrece solo ese método', () => {
        expect(allowedReturnRefundMethods({
            salePaymentMethod: 'CREDIT',
            payments: [{ method: 'CARD' }, { method: 'card' }, { method: ' CARD ' }],
        })).toEqual(['CARD']);
    });

    it('CREDIT mixto deduplica, ignora valores inválidos y conserva orden estable', () => {
        expect(allowedReturnRefundMethods({
            salePaymentMethod: 'CREDIT',
            payments: [
                { method: 'TRANSFER' },
                { method: 'cash' },
                { method: 'QR' },
                { method: 'CASH' },
                { method: 'CARD' },
                { method: 'CRYPTO' },
                { method: null },
            ],
        })).toEqual(['CASH', 'CARD', 'QR', 'TRANSFER']);
    });

    it('CREDIT legacy sin evidencia de pagos ofrece los cuatro canales soportados', () => {
        expect(allowedReturnRefundMethods({
            salePaymentMethod: 'CREDIT',
            payments: [],
        })).toEqual(['CASH', 'CARD', 'QR', 'TRANSFER']);
    });

    it.each(['CASH', 'CARD', 'QR', 'TRANSFER'] as const)(
        'una venta no crédito %s no necesita opciones explícitas',
        (salePaymentMethod) => {
            expect(allowedReturnRefundMethods({
                salePaymentMethod,
                payments: [{ method: salePaymentMethod }],
            })).toEqual([]);
        },
    );
});

describe('historial y límites de devolución', () => {
    it('suma devoluciones previas por saleItemId sin descontarlas de otra línea del mismo SKU', () => {
        const availability = buildReturnAvailability({
            saleItems: [
                makeLine({ id: 'line-base', quantity: '1.50', presentationAtSale: 'BASE' }),
                makeLine({ id: 'line-pack', quantity: '4.00', presentationAtSale: 'PACK' }),
            ],
            previousReturns: [
                { items: [{ saleItemId: 'line-base', productId: 'product-meat', quantity: '0.20' }] },
                { items: [{ saleItemId: 'line-base', quantity: '0.30' }] },
            ],
            productsById: meatProducts,
        });

        const base = availability.find((item) => item.saleItemId === 'line-base');
        const pack = availability.find((item) => item.saleItemId === 'line-pack');
        expect(base?.returnedQuantity.toString()).toBe('0.5');
        expect(base?.returnableQuantity.toString()).toBe('1');
        expect(pack?.returnedQuantity.toString()).toBe('0');
        expect(pack?.returnableQuantity.toString()).toBe('4');
    });

    it('rechaza una solicitud que excede lo restante después del historial', () => {
        const error = errorFrom(() => resolveRequestedReturnItems({
            saleItems: [makeLine({ quantity: '1.25' })],
            previousReturns: [{
                items: [{ saleItemId: 'sale-item-meat-base', quantity: '0.75' }],
            }],
            productsById: meatProducts,
            requestedItems: [{ saleItemId: 'sale-item-meat-base', quantity: '0.75' }],
        }));

        expect(error).toMatchObject({
            code: 'RETURN_QUANTITY_EXCEEDED',
            httpStatus: 409,
        });
        expect(error.message).toContain('0.5 lb');
    });

    it('rechaza fracciones para líneas COUNTED aunque el payload sea decimal válido', () => {
        const countedProducts = productsFor({
            id: 'product-chicken',
            name: 'Pollo entero',
            unit: 'unidad',
            quantityStep: '1',
        });
        const error = errorFrom(() => resolveRequestedReturnItems({
            saleItems: [makeLine({
                id: 'line-chicken',
                productId: 'product-chicken',
                productNameAtSale: 'Pollo entero',
                unitAtSale: 'unidad',
                saleModeAtSale: 'COUNTED',
                quantityStepAtSale: '1',
                quantity: '3',
                presentationQuantityAtSale: '3',
            })],
            previousReturns: [],
            productsById: countedProducts,
            requestedItems: [{ saleItemId: 'line-chicken', quantity: '0.50' }],
        }));

        expect(error).toMatchObject({
            code: 'INVALID_RETURN_QUANTITY',
            httpStatus: 400,
        });
        expect(error.message).toContain('cantidades y pasos enteros');
    });

    it('usa quantityStepAtSale aunque el paso actual del producto haya cambiado', () => {
        const result = resolveRequestedReturnItems({
            saleItems: [makeLine({
                quantity: '1.00',
                quantityStepAtSale: '0.01',
            })],
            previousReturns: [],
            // El catálogo actual exige 0.25, pero 0.03 era una cantidad válida
            // bajo el contrato congelado cuando se facturó la línea.
            productsById: productsFor({
                id: 'product-meat',
                name: 'Posta de res',
                unit: 'lb',
                quantityStep: '0.25',
            }),
            requestedItems: [{ saleItemId: 'sale-item-meat-base', quantity: '0.03' }],
        });

        expect(result.items[0].quantityStep.toString()).toBe('0.01');
        expect(result.items[0].quantity.toString()).toBe('0.03');
    });

    it('aplica fallbacks históricos 1 para COUNTED y 0.0001 para cualquier otro modo', () => {
        const availability = buildReturnAvailability({
            saleItems: [
                makeLine({
                    id: 'legacy-counted',
                    productId: 'product-counted',
                    quantity: '2',
                    saleModeAtSale: 'COUNTED',
                    quantityStepAtSale: null,
                }),
                makeLine({
                    id: 'legacy-measured',
                    productId: 'product-measured',
                    quantity: '1.0000',
                    saleModeAtSale: 'MEASURED',
                    quantityStepAtSale: null,
                }),
                makeLine({
                    id: 'legacy-null-mode',
                    productId: 'product-null-mode',
                    quantity: '1.0000',
                    saleModeAtSale: null,
                    quantityStepAtSale: null,
                }),
            ],
            previousReturns: [],
            productsById: productsFor(
                { id: 'product-counted', quantityStep: '5' },
                { id: 'product-measured', quantityStep: '0.25' },
                { id: 'product-null-mode', quantityStep: '0.50' },
            ),
        });

        expect(availability.map((line) => ({
            id: line.saleItemId,
            mode: line.saleMode,
            step: line.quantityStep.toString(),
        }))).toEqual([
            { id: 'legacy-counted', mode: 'COUNTED', step: '1' },
            { id: 'legacy-measured', mode: 'MEASURED', step: '0.0001' },
            { id: 'legacy-null-mode', mode: 'MEASURED', step: '0.0001' },
        ]);
    });
});
