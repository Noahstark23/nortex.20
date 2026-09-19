import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePurchaseInput } from '../backend/services/purchaseRegistrationAuthority';

// La ruta compone este servicio; las invariantes de inventario viven aquí.
const registrationSource = readFileSync(resolve(process.cwd(), 'backend/services/purchaseRegistrationService.ts'), 'utf8');
const registrationStart = registrationSource.indexOf('export async function registerPurchase(');
if (registrationStart < 0) throw new Error('No se encontró registerPurchase');
const purchaseRoute = registrationSource.slice(registrationStart)
    + '\n' + readFileSync(resolve(process.cwd(), 'backend/services/purchaseRegistrationPreparation.ts'), 'utf8');

const preparedStart = purchaseRoute.indexOf('const processedItems = preparedItems.map');
const purchaseCreate = purchaseRoute.indexOf('const purchase = await tx.purchase.create', preparedStart);
const inventoryStart = purchaseRoute.indexOf('const inventoryMutationItems = linkedPurchaseOrder', purchaseCreate);
const financialStart = purchaseRoute.indexOf('// 4. Registro financiero', inventoryStart);
if (preparedStart < 0 || purchaseCreate < 0 || inventoryStart < 0 || financialStart < 0) {
    throw new Error('El flujo de compra no conserva las anclas de preparación e inventario');
}

const preparedBlock = purchaseRoute.slice(preparedStart, purchaseCreate);
const inventoryBlock = purchaseRoute.slice(inventoryStart, financialStart);

const occurrences = (source: string, token: string): number => source.split(token).length - 1;

describe('evidencia física de devolución en compra directa', () => {
    it('genera en servidor un id distinto para cada PurchaseItem directo, incluso sin lote', () => {
        const idPosition = preparedBlock.indexOf('id: crypto.randomUUID()');
        expect(idPosition).toBeGreaterThan(0);
        expect(idPosition).toBeGreaterThan(preparedBlock.indexOf('...persisted'));

        // La identidad se decide por ser compra directa, no por el modo del sidecar
        // ni por requiresBatchTracking; también la necesitan productos sin lote.
        const identityClause = preparedBlock.slice(Math.max(0, idPosition - 240), idPosition + 80);
        expect(identityClause).toContain('!linkedPurchaseOrder');
        expect(identityClause).not.toContain('batchWarehouseLedgerMode');
        expect(identityClause).not.toContain('requiresBatchTracking');
        expect(occurrences(preparedBlock, 'id: crypto.randomUUID()')).toBe(1);

        expect(purchaseRoute).toContain('create: processedItems.map');
        expect(inventoryBlock).toContain("if (!item.id) throw new Error('PURCHASE_ITEM_ID_REQUIRED')");
        expect(inventoryBlock).toContain(
            'sourceKey: `direct-purchase:${purchase.id}:item:${item.id}`',
        );
    });

    it('persiste bodega, lote y costo exacto solo después de confirmar el ingreso físico', () => {
        const stockPosition = inventoryBlock.indexOf('await applyStockDelta');
        const batchPosition = inventoryBlock.indexOf('await applyBatchWarehouseDelta', stockPosition);
        const evidencePosition = inventoryBlock.indexOf('inventoryWarehouseId', stockPosition);
        const kardexPosition = inventoryBlock.indexOf('await tx.kardexMovement.create', evidencePosition);

        expect(stockPosition).toBeGreaterThan(0);
        expect(batchPosition).toBeGreaterThan(stockPosition);
        expect(evidencePosition).toBeGreaterThan(batchPosition);
        expect(kardexPosition).toBeGreaterThan(evidencePosition);
        expect(inventoryBlock.slice(evidencePosition, kardexPosition)).toContain(
            'inventoryWarehouseId: purchaseWarehouseId',
        );
        expect(inventoryBlock.slice(evidencePosition, kardexPosition)).toContain(
            'inventoryBatchId: batchId',
        );
        const evidenceBlock = inventoryBlock.slice(evidencePosition, kardexPosition);
        expect(evidenceBlock).toContain(
            'inventoryUnitCostExact: new Decimal(item.averageUnitCost)',
        );
        expect(evidenceBlock).toContain('.toDecimalPlaces(6, Decimal.ROUND_HALF_UP)');
        expect(evidenceBlock).toContain('.toFixed(6)');

        // Una sola autoridad escribe cada snapshot; nunca se acepta del payload.
        expect(occurrences(purchaseRoute, 'inventoryWarehouseId')).toBe(1);
        expect(occurrences(purchaseRoute, 'inventoryBatchId')).toBe(1);
        expect(occurrences(purchaseRoute, 'inventoryUnitCostExact')).toBe(1);
        const parsed = parsePurchaseInput({
            supplierId: 'supplier-1', invoiceNumber: 'FAC-1', date: '2026-09-05', paymentMethod: 'CASH',
            items: [{ productId: 'product-1', quantity: '1', unitCost: '10',
                id: 'forged-item', inventoryWarehouseId: 'forged-warehouse', inventoryBatchId: 'forged-batch', inventoryUnitCostExact: '0.000001' }],
        });
        for (const field of ['id', 'inventoryWarehouseId', 'inventoryBatchId', 'inventoryUnitCostExact']) {
            expect(parsed.items[0]).not.toHaveProperty(field);
        }
    });

    it('exige actualizar exactamente una línea y deja el rollback a la transacción', () => {
        const evidenceUpdate = inventoryBlock.indexOf('tx.purchaseItem.updateMany');
        expect(evidenceUpdate).toBeGreaterThan(0);
        const evidenceTail = inventoryBlock.slice(evidenceUpdate, evidenceUpdate + 1_500);

        expect(evidenceTail).toContain('id: item.id');
        expect(evidenceTail).toContain('purchaseId: purchase.id');
        expect(evidenceTail).toMatch(/\.count\s*!==\s*1/u);
        expect(evidenceTail).toMatch(/throw new (?:Error|ProcurementMatchError)\(/u);
        expect(evidenceTail).not.toContain('.catch(');
        expect(purchaseRoute.indexOf('return db.$transaction')).toBeGreaterThan(-1);
        expect(purchaseRoute.indexOf('return db.$transaction'))
            .toBeLessThan(purchaseRoute.indexOf('tx.purchaseItem.updateMany'));
    });

    it('no fabrica evidencia para facturas de OC y conserva identidad con SKU duplicado', () => {
        expect(inventoryBlock).toContain('const inventoryMutationItems = linkedPurchaseOrder');
        expect(inventoryBlock).toMatch(/linkedPurchaseOrder\s*\?\s*\[\]\s*:\s*\[\.\.\.processedItems\]/u);

        const loopPosition = inventoryBlock.indexOf('for (const item of inventoryMutationItems)');
        const evidencePosition = inventoryBlock.indexOf('inventoryWarehouseId');
        expect(loopPosition).toBeGreaterThan(0);
        expect(evidencePosition).toBeGreaterThan(loopPosition);
        expect(purchaseRoute.slice(purchaseCreate, inventoryStart)).not.toContain('inventoryWarehouseId');

        // Dos líneas del mismo productId siguen siendo dos fuentes retornables:
        // el UUID nace dentro del map y el sidecar usa ese id, no el SKU/productId.
        expect(preparedBlock.indexOf('id: crypto.randomUUID()'))
            .toBeGreaterThan(preparedBlock.indexOf('preparedItems.map'));
        expect(inventoryBlock).toContain("|| (left.id ?? '').localeCompare(right.id ?? '')");
        expect(inventoryBlock).toContain(':item:${item.id}`');
    });

    it('una compra CASH nace pagada y liquidada con el mismo instante', () => {
        expect(purchaseRoute).toContain(
            "const settledNow = paymentMethod === 'CASH' ? new Date() : null",
        );
        expect(purchaseRoute).toContain('paidAt: settledNow');
        expect(purchaseRoute).toContain('settledAt: settledNow');
    });
});
