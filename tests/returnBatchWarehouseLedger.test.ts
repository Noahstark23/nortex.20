import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    planReturnBatchRestoration,
    ReturnResolutionError,
    type ReturnBatchAllocationSnapshot,
} from '../backend/services/returnService';

const saleItem = {
    id: 'sale-item-a',
    productId: 'product-a',
    quantity: '2.0000',
};

const allocation = (
    overrides: Partial<ReturnBatchAllocationSnapshot> = {},
): ReturnBatchAllocationSnapshot => ({
    id: 'allocation-a',
    saleItemId: saleItem.id,
    productId: saleItem.productId,
    batchId: 'batch-a',
    batchNumber: 'LOT-A',
    warehouseId: 'warehouse-a',
    quantity: '0.7500',
    ...overrides,
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

describe('plan lote+bodega de ProductReturn', () => {
    it('restaura un parcial en el orden original con cantidades Decimal exactas', () => {
        const result = planReturnBatchRestoration({
            saleItem,
            requestedQuantity: '1.2500',
            sameProductLineCount: 1,
            requiresBatchTracking: true,
            previousReturns: [],
            allocations: [
                allocation(),
                allocation({
                    id: 'allocation-b',
                    batchId: 'batch-b',
                    batchNumber: 'LOT-B',
                    quantity: '1.2500',
                }),
            ],
            ledgerMode: 'SHADOW',
        });

        expect(result.mode).toBe('BATCH_RESTORED');
        expect(result.batchRestorations.map(restoration => ({
            allocationId: restoration.allocationId,
            batchId: restoration.batchId,
            warehouseId: restoration.warehouseId,
            quantity: restoration.quantity.toFixed(4),
        }))).toEqual([
            {
                allocationId: 'allocation-a',
                batchId: 'batch-a',
                warehouseId: 'warehouse-a',
                quantity: '0.7500',
            },
            {
                allocationId: 'allocation-b',
                batchId: 'batch-b',
                warehouseId: 'warehouse-a',
                quantity: '0.5000',
            },
        ]);
        expect(result.aggregateOnlyQuantity.toFixed(4)).toBe('0.0000');
        expect(result.reconciliationGaps).toEqual([]);
    });

    it('descuenta devoluciones previas y nunca restaura dos veces el mismo allocation', () => {
        const result = planReturnBatchRestoration({
            saleItem,
            requestedQuantity: '1.0000',
            sameProductLineCount: 1,
            requiresBatchTracking: true,
            previousReturns: [{
                items: [{
                    saleItemId: saleItem.id,
                    productId: saleItem.productId,
                    quantity: '1.0000',
                    // Medio lote detallado + medio legado. La diferencia debe
                    // reservar la capacidad restante de LOT-A.
                    batchRestorations: [{
                        allocationId: 'allocation-a',
                        batchId: 'batch-a',
                        warehouseId: 'warehouse-a',
                        quantity: '0.5000',
                    }],
                }],
            }],
            allocations: [
                allocation({ quantity: '1.0000' }),
                allocation({
                    id: 'allocation-b',
                    batchId: 'batch-b',
                    batchNumber: 'LOT-B',
                    quantity: '1.0000',
                }),
            ],
            ledgerMode: 'ENFORCED',
        });

        expect(result.batchRestorations).toHaveLength(1);
        expect(result.batchRestorations[0]).toMatchObject({
            allocationId: 'allocation-b',
            batchId: 'batch-b',
        });
        expect(result.batchRestorations[0].quantity.toFixed(4)).toBe('1.0000');
    });

    it('rechaza una devolución acumulada mayor que la línea vendida', () => {
        const error = errorFrom(() => planReturnBatchRestoration({
            saleItem,
            requestedQuantity: '1.2500',
            sameProductLineCount: 1,
            requiresBatchTracking: true,
            previousReturns: [{
                items: [{
                    saleItemId: saleItem.id,
                    productId: saleItem.productId,
                    quantity: '1.0000',
                    batchRestorations: [],
                }],
            }],
            allocations: [allocation({ quantity: '2.0000' })],
            ledgerMode: 'SHADOW',
        }));

        expect(error).toMatchObject({ code: 'BATCH_RETURN_EXCEEDED', httpStatus: 409 });
    });

    it.each([
        ['allocation sin bodega', [allocation({ warehouseId: null })]],
        ['venta sin allocation', []],
    ])('ENFORCED falla cerrado ante %s', (_label, allocations) => {
        const error = errorFrom(() => planReturnBatchRestoration({
            saleItem,
            requestedQuantity: '0.5000',
            sameProductLineCount: 1,
            requiresBatchTracking: true,
            previousReturns: [],
            allocations,
            ledgerMode: 'ENFORCED',
        }));

        expect(error).toMatchObject({ code: 'RECONCILIATION_REQUIRED', httpStatus: 409 });
    });

    it('ENFORCED permite agregado para un producto autoritativamente no-lote', () => {
        const result = planReturnBatchRestoration({
            saleItem,
            requestedQuantity: '0.5000',
            sameProductLineCount: 1,
            requiresBatchTracking: false,
            previousReturns: [],
            allocations: [],
            ledgerMode: 'ENFORCED',
        });

        expect(result.mode).toBe('LEGACY_AGGREGATE_ONLY');
        expect(result.batchRestorations).toEqual([]);
        expect(result.aggregateOnlyQuantity.toFixed(4)).toBe('0.5000');
        expect(result.reconciliationGaps).toEqual([]);
    });

    it('SHADOW marca conciliación si un producto lote legacy no conserva allocations', () => {
        const result = planReturnBatchRestoration({
            saleItem,
            requestedQuantity: '0.5000',
            sameProductLineCount: 1,
            requiresBatchTracking: true,
            previousReturns: [],
            allocations: [],
            ledgerMode: 'SHADOW',
        });

        expect(result.aggregateOnlyQuantity.toFixed(4)).toBe('0.5000');
        expect(result.reconciliationGaps).toEqual([
            expect.objectContaining({
                allocationId: null,
                batchId: null,
                reason: 'MISSING_BATCH_ALLOCATION',
            }),
        ]);
    });

    it('SHADOW conserva el agregado legacy sin inventar warehouse y exige auditoría', () => {
        const result = planReturnBatchRestoration({
            saleItem,
            requestedQuantity: '0.5000',
            sameProductLineCount: 1,
            requiresBatchTracking: true,
            previousReturns: [],
            allocations: [allocation({ warehouseId: null })],
            ledgerMode: 'SHADOW',
        });

        expect(result.batchRestorations[0].warehouseId).toBeNull();
        expect(result.reconciliationGaps.map(gap => ({
            allocationId: gap.allocationId,
            batchId: gap.batchId,
            quantity: gap.quantity.toFixed(4),
            reason: gap.reason,
        }))).toEqual([{
            allocationId: 'allocation-a',
            batchId: 'batch-a',
            quantity: '0.5000',
            reason: 'MISSING_ALLOCATION_WAREHOUSE',
        }]);
    });

    it('no acepta evidencia cruzada de otra línea, producto o batch duplicado', () => {
        for (const allocations of [
            [allocation({ saleItemId: 'sale-item-foreign' })],
            [allocation({ productId: 'product-foreign' })],
            [allocation(), allocation({ id: 'allocation-b' })],
        ]) {
            const error = errorFrom(() => planReturnBatchRestoration({
                saleItem,
                requestedQuantity: '0.2500',
                sameProductLineCount: 1,
                requiresBatchTracking: true,
                previousReturns: [],
                allocations,
                ledgerMode: 'SHADOW',
            }));
            expect(error).toMatchObject({ code: 'RECONCILIATION_REQUIRED', httpStatus: 409 });
        }
    });
});

const server = readFileSync(join(__dirname, '../backend/server.ts'), 'utf8');
const between = (source: string, start: string, end: string): string => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`No se encontró bloque ${start}`);
    return source.slice(from, to);
};
const cancelRoute = between(
    server,
    "app.post('/api/sales/:id/cancel'",
    "app.get('/api/sales/search'",
);
const returnRoute = between(
    server,
    "app.post('/api/returns'",
    '// ==========================================\n// 🚫 ANULACIÓN DE COMPROBANTES',
);

describe('integración transaccional lote+bodega de devoluciones y anulaciones', () => {
    it('ProductReturn filtra allocations por tenant+venta y preflight ENFORCED ocurre antes de efectos', () => {
        const mode = returnRoute.indexOf('resolveBatchWarehouseLedgerMode');
        const allocationRead = returnRoute.indexOf('tx.saleItemBatchAllocation.findMany');
        const plan = returnRoute.indexOf('planReturnBatchRestoration');
        const create = returnRoute.indexOf('tx.productReturn.create');
        const stock = returnRoute.indexOf('applyStockDelta(tx');

        expect(mode).toBeGreaterThan(-1);
        expect(allocationRead).toBeGreaterThan(mode);
        expect(plan).toBeGreaterThan(allocationRead);
        expect(create).toBeGreaterThan(plan);
        expect(stock).toBeGreaterThan(create);
        expect(returnRoute.slice(allocationRead, plan)).toContain('tenantId: authReq.tenantId!');
        expect(returnRoute.slice(allocationRead, plan)).toContain('saleItem: { saleId, sale: { tenantId: authReq.tenantId! } }');
        expect(returnRoute.slice(plan, create)).toContain(
            'productsById.get(item.productId)?.requiresBatchTracking === true',
        );
        expect(returnRoute.slice(mode, plan)).toContain("batchWarehouseLedgerMode !== 'OFF'");
        expect(returnRoute.slice(plan, create)).toContain('ledgerMode: batchWarehouseLedgerMode');
    });

    it('aplica SALE_RETURN exacto con sourceKey estable, Decimal string y actor autenticado', () => {
        const create = returnRoute.indexOf('tx.productReturn.create');
        const core = returnRoute.indexOf('await applyBatchWarehouseDelta({');
        const batchAggregate = returnRoute.indexOf('tx.productBatch.updateMany', core);
        const aggregate = returnRoute.indexOf('applyStockDelta(tx', batchAggregate);
        const kardex = returnRoute.indexOf('tx.kardexMovement.create', aggregate);
        const accounting = returnRoute.indexOf('await recordReturn(', kardex);
        const audit = returnRoute.indexOf("action: 'RETURN_CREATED'", accounting);
        const coreBlock = returnRoute.slice(core, batchAggregate);

        expect(core).toBeGreaterThan(-1);
        expect(coreBlock).toContain('mode: batchWarehouseLedgerMode');
        expect(coreBlock).toContain('tenantId: authReq.tenantId!');
        expect(coreBlock).toContain('warehouseId: restoration.warehouseId');
        expect(coreBlock).toContain('delta: restoration.quantity.toFixed(4)');
        expect(coreBlock).toContain("movementType: 'SALE_RETURN'");
        expect(coreBlock).toContain('userId: authReq.userId!');
        expect(coreBlock).toContain('product-return:${productReturn.id}:return-item:${item.saleItemId}:allocation:${restoration.allocationId}:batch:${restoration.batchId}');
        expect(batchAggregate).toBeGreaterThan(core);
        expect(returnRoute.slice(batchAggregate, aggregate)).toContain(
            'increment: restoration.quantity.toNumber()',
        );
        expect(returnRoute.slice(batchAggregate, aggregate)).not.toContain(
            'increment: restoration.quantity.toFixed(4)',
        );
        expect(aggregate).toBeGreaterThan(batchAggregate);
        expect(kardex).toBeGreaterThan(aggregate);
        expect(accounting).toBeGreaterThan(kardex);
        expect(audit).toBeGreaterThan(accounting);
        expect(returnRoute.slice(create, core)).toContain('returnLinesInLockOrder');
        expect(returnRoute.slice(create, core)).toContain('left.item.productId.localeCompare');
        expect(returnRoute.slice(create, core)).toContain('left.batchId.localeCompare');
    });

    it('SHADOW sin bodega no llama sidecar para ese allocation y deja conciliación atómica', () => {
        const physical = returnRoute.indexOf('const exactPlan =');
        const core = returnRoute.indexOf('await applyBatchWarehouseDelta({', physical);
        const coreGuard = returnRoute.slice(physical, core);
        const reconciliation = returnRoute.indexOf(
            "action: 'BATCH_WAREHOUSE_RETURN_RECONCILIATION_REQUIRED'",
            core,
        );
        const exactKardex = returnRoute.indexOf('tx.kardexMovement.create', core);
        const transactionEnd = returnRoute.lastIndexOf('});');

        expect(coreGuard).toContain('if (restoration.warehouseId)');
        expect(returnRoute.slice(exactKardex, reconciliation)).toContain(
            '...(restoration.warehouseId',
        );
        expect(reconciliation).toBeGreaterThan(core);
        expect(reconciliation).toBeLessThan(transactionEnd);
        expect(returnRoute.slice(reconciliation, transactionEnd)).toContain('allocationId: gap.allocationId');
        expect(returnRoute.slice(reconciliation, transactionEnd)).toContain('quantity: gap.quantity.toFixed(4)');
    });

    it('OFF mantiene el helper legacy y nunca entra al sidecar', () => {
        const offPlan = returnRoute.indexOf("batchWarehouseLedgerMode === 'OFF'");
        const legacy = returnRoute.indexOf('restoreSaleItemBatchesForReturn(tx', offPlan);
        const exact = returnRoute.indexOf('planReturnBatchRestoration', legacy);
        const offPhysical = returnRoute.indexOf("if (batchWarehouseLedgerMode === 'OFF')", exact);
        const sidecar = returnRoute.indexOf('await applyBatchWarehouseDelta({', offPhysical);

        expect(legacy).toBeGreaterThan(offPlan);
        expect(exact).toBeGreaterThan(legacy);
        expect(offPhysical).toBeGreaterThan(exact);
        expect(sidecar).toBeGreaterThan(offPhysical);
        expect(returnRoute.slice(offPhysical, sidecar)).toContain('continue;');
    });

    it('replay se resuelve antes de plan, ProductBatch y sidecar', () => {
        const fastReplay = returnRoute.indexOf('preexistingReturn');
        const lockedReplay = returnRoute.indexOf('const existingReturn = await tx.productReturn.findFirst');
        const plan = returnRoute.indexOf('planReturnBatchRestoration');
        const sidecar = returnRoute.indexOf('await applyBatchWarehouseDelta({');

        expect(fastReplay).toBeGreaterThan(-1);
        expect(lockedReplay).toBeGreaterThan(fastReplay);
        expect(plan).toBeGreaterThan(lockedReplay);
        expect(sidecar).toBeGreaterThan(plan);
    });

    it('anulación bloquea y preflight antes de marcar; luego restaura sidecar, batch, stock y Kardex', () => {
        const lock = cancelRoute.indexOf('SELECT id FROM \\`Sale\\`');
        const lockedReload = cancelRoute.indexOf('const sale = await tx.sale.findFirst', lock);
        const verdict = cancelRoute.indexOf('const veredicto = puedeAnularse', lockedReload);
        const plan = cancelRoute.indexOf('planReturnBatchRestoration', verdict);
        const mark = cancelRoute.indexOf('const marcada = await tx.sale.updateMany');
        const sidecar = cancelRoute.indexOf('await applyBatchWarehouseDelta({', mark);
        const batch = cancelRoute.indexOf('tx.productBatch.updateMany', sidecar);
        const stock = cancelRoute.indexOf('applyStockDelta(tx', batch);
        const kardex = cancelRoute.indexOf('tx.kardexMovement.create', stock);
        const finalAudit = cancelRoute.indexOf("action: 'SALE_VOIDED'", kardex);

        expect(lock).toBeGreaterThan(-1);
        expect(lockedReload).toBeGreaterThan(lock);
        expect(cancelRoute.slice(lockedReload, verdict)).toContain(
            '_count: { select: { productReturns: true, payments: true } }',
        );
        expect(verdict).toBeGreaterThan(lockedReload);
        expect(plan).toBeGreaterThan(verdict);
        expect(mark).toBeGreaterThan(plan);
        expect(sidecar).toBeGreaterThan(mark);
        expect(cancelRoute.slice(sidecar, batch)).toContain("movementType: 'SALE_RETURN'");
        expect(cancelRoute.slice(sidecar, batch)).toContain('delta: restoration.quantity.toFixed(4)');
        expect(cancelRoute.slice(sidecar, batch)).toContain('sale-void:${saleId}:item:${item.id}:allocation:${restoration.allocationId}:batch:${restoration.batchId}');
        expect(cancelRoute.slice(mark, sidecar)).toContain('cancellationItemsInLockOrder');
        expect(cancelRoute.slice(mark, sidecar)).toContain('left.productId.localeCompare');
        expect(cancelRoute.slice(mark, sidecar)).toContain('left.batchId.localeCompare');
        expect(batch).toBeGreaterThan(sidecar);
        expect(cancelRoute.slice(batch, stock)).toContain(
            'increment: restoration.quantity.toNumber()',
        );
        expect(cancelRoute.slice(batch, stock)).not.toContain(
            'increment: restoration.quantity.toFixed(4)',
        );
        expect(stock).toBeGreaterThan(batch);
        expect(kardex).toBeGreaterThan(stock);
        expect(finalAudit).toBeGreaterThan(kardex);
    });

    it('anulación distingue producto no-lote y hace hard-fail si contabilidad falla', () => {
        const lock = cancelRoute.indexOf('SELECT id FROM \\`Sale\\`');
        const mode = cancelRoute.indexOf('resolveBatchWarehouseLedgerMode', lock);
        const productAuthority = cancelRoute.indexOf('const cancellationProducts = await tx.product.findMany', mode);
        const plan = cancelRoute.indexOf('planReturnBatchRestoration', mode);
        const accounting = cancelRoute.indexOf('await createJournalEntry(', plan);
        const finalAudit = cancelRoute.indexOf("action: 'SALE_VOIDED'", accounting);

        expect(mode).toBeGreaterThan(lock);
        expect(productAuthority).toBeGreaterThan(mode);
        expect(cancelRoute.slice(productAuthority, plan)).toContain('tenantId: authReq.tenantId!');
        expect(cancelRoute.slice(productAuthority, plan)).toContain('requiresBatchTracking: true');
        expect(cancelRoute.slice(plan, accounting)).toContain(
            'batchTrackingByProduct.get(item.productId) === true',
        );
        expect(accounting).toBeGreaterThan(plan);
        expect(finalAudit).toBeGreaterThan(accounting);
        expect(cancelRoute.slice(accounting, finalAudit)).not.toContain('catch (');
        expect(cancelRoute).not.toContain('Asiento de anulación falló');
    });

    it('ambas rutas traducen errores del core sin volverlos 500 genérico', () => {
        expect(returnRoute).toContain('if (error instanceof BatchWarehouseLedgerError)');
        expect(returnRoute).toContain('res.status(error.httpStatus)');
        expect(cancelRoute).toContain('error instanceof BatchWarehouseLedgerError');
        expect(cancelRoute).toContain('code: error.code');
    });
});
