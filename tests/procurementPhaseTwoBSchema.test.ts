import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
    'backend/prisma/migrations/20260827_procurement_phase_two_b_inventory_inspection/migration.sql',
    'utf8',
);

function modelBlock(name: string): string {
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`No se encontró model ${name}`);
    return match[0];
}

describe('Procurement Fase 2B — contrato persistente', () => {
    it('mantiene apagado por defecto el ledger de lote por bodega', () => {
        const tenant = modelBlock('Tenant');

        expect(tenant).toMatch(
            /batchWarehouseLedgerMode\s+String\s+@default\("OFF"\)\s+@db\.VarChar\(16\)/,
        );
        expect(tenant).toMatch(/batchWarehouseLedgerActivatedAt\s+DateTime\?/);
        expect(tenant).toContain('productBatchWarehouseStocks ProductBatchWarehouseStock[]');
        expect(tenant).toContain('productBatchLedgerEntries   ProductBatchLedgerEntry[]');
    });

    it('persiste el saldo decimal de lote por bodega con unicidad tenant-scoped', () => {
        const stock = modelBlock('ProductBatchWarehouseStock');

        expect(stock).toMatch(/stock\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(18, 4\)/);
        expect(stock).toContain('@@unique([tenantId, batchId, warehouseId])');
        expect(stock).toContain('@@index([tenantId, batchId])');
        expect(stock).toContain('@@index([tenantId, productId, warehouseId])');
        expect(stock).toContain('@@index([tenantId, warehouseId, productId])');
        expect(stock).toMatch(/tenant\s+Tenant\s+@relation\([^\n]+onDelete: Cascade\)/);
        for (const relation of ['product', 'batch', 'warehouse']) {
            expect(stock).toMatch(new RegExp(`${relation}\\s+\\w+\\s+@relation\\([^\\n]+onDelete: Restrict\\)`));
        }
    });

    it('persiste un ledger inmutable, preciso e idempotente', () => {
        const ledger = modelBlock('ProductBatchLedgerEntry');

        for (const field of ['quantityDelta', 'stockBefore', 'stockAfter']) {
            expect(ledger).toMatch(new RegExp(`${field}\\s+Decimal\\s+@db\\.Decimal\\(18, 4\\)`));
        }
        expect(ledger).toMatch(/movementType\s+String\s+@db\.VarChar\(32\)/);
        expect(ledger).toMatch(/status\s+String\s+@default\("APPLIED"\)\s+@db\.VarChar\(32\)/);
        expect(ledger).toMatch(/sourceKey\s+String\s+@db\.VarChar\(191\)/);
        expect(ledger).toMatch(/payloadHash\s+String\s+@db\.VarChar\(64\)/);
        expect(ledger).toContain('@@unique([tenantId, sourceKey])');
        expect(ledger).toContain('@@index([tenantId, batchId, createdAt])');
        expect(ledger).toContain('@@index([tenantId, warehouseId, createdAt])');
        expect(ledger).toContain('@@index([tenantId, productId, warehouseId, createdAt])');
        expect(ledger).toContain('@@index([tenantId, referenceType, referenceId])');
        expect(ledger).toContain('@relation("ProductBatchLedgerEntryCreator"');
    });

    it('vincula allocations históricas a bodega de forma nullable y RESTRICT', () => {
        const allocation = modelBlock('SaleItemBatchAllocation');

        expect(allocation).toMatch(/warehouseId\s+String\?/);
        expect(allocation).toMatch(
            /warehouse\s+Warehouse\?\s+@relation\([^\n]+onDelete: Restrict\)/,
        );
        expect(allocation).toContain('@@index([tenantId, warehouseId])');
    });

    it('hace idempotentes las transferencias nuevas sin reinterpretar históricos', () => {
        const transfer = modelBlock('StockTransfer');

        expect(transfer).toMatch(/clientEventId\s+String\?\s+@db\.VarChar\(128\)/);
        expect(transfer).toMatch(/payloadHash\s+String\?\s+@db\.VarChar\(64\)/);
        expect(transfer).toMatch(/payloadVersion\s+Int\s+@default\(1\)/);
        expect(transfer).toMatch(
            /batchLedgerMode\s+String\s+@default\("OFF"\)\s+@db\.VarChar\(16\)/,
        );
        expect(transfer).toMatch(
            /batchTransferStatus\s+String\s+@default\("OFF"\)\s+@db\.VarChar\(32\)/,
        );
        expect(transfer).toMatch(/batchSnapshot\s+Json\?/);
        expect(transfer).toContain('@@unique([tenantId, clientEventId])');
    });

    it('separa entregado, aceptado y rechazado sin reinterpretar quantityExact', () => {
        const order = modelBlock('PurchaseOrder');
        const orderItem = modelBlock('PurchaseOrderItem');
        const receipt = modelBlock('GoodsReceipt');
        const item = modelBlock('GoodsReceiptItem');

        expect(order).toContain('CLOSED_SHORT');
        expect(orderItem).toMatch(/quantityRejectedExact\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(orderItem).toMatch(/quantityClosedShortExact\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(receipt).toMatch(/payloadVersion\s+Int\s+@default\(1\)/);
        expect(receipt).toMatch(/inspectionOutcome\s+String\s+@default\("FULL_ACCEPT"\)\s+@db\.VarChar\(32\)/);
        expect(receipt).toMatch(/hasSupplierFault\s+Boolean\s+@default\(false\)/);
        expect(item).toMatch(/quantityExact\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/deliveredQuantityExact\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/rejectedQuantityExact\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/rejectionReasonCode\s+String\?\s+@db\.VarChar\(32\)/);
        expect(item).toMatch(/supplierFault\s+Boolean\?/);
    });

    it('registra cierres cortos idempotentes con snapshots y borrado histórico seguro', () => {
        const close = modelBlock('PurchaseOrderCloseShort');
        const item = modelBlock('PurchaseOrderCloseShortItem');

        expect(close).toMatch(/clientEventId\s+String\s+@db\.VarChar\(128\)/);
        expect(close).toMatch(/payloadHash\s+String\s+@db\.VarChar\(64\)/);
        expect(close).toContain('@@unique([tenantId, clientEventId])');
        expect(close).toContain('@@index([tenantId, purchaseOrderId, closedAt])');
        expect(close).toMatch(/purchaseOrder\s+PurchaseOrder\s+@relation\([^\n]+onDelete: Restrict\)/);
        expect(close).toContain('@relation("PurchaseOrderCloseShortCreator"');
        for (const field of [
            'quantityExact',
            'orderedQuantitySnapshotExact',
            'acceptedQuantitySnapshotExact',
            'rejectedQuantitySnapshotExact',
            'remainingBeforeExact',
            'remainingAfterExact',
        ]) {
            expect(item).toMatch(new RegExp(`${field}\\s+Decimal\\s+@db\\.Decimal\\(18, 4\\)`));
        }
        expect(item).toMatch(/closeShort\s+PurchaseOrderCloseShort\s+@relation\([^\n]+onDelete: Cascade\)/);
        expect(item).toMatch(/purchaseOrderItem\s+PurchaseOrderItem\s+@relation\([^\n]+onDelete: Restrict\)/);
    });

    it('mantiene la migración expand-only y los modos existentes sin activación', () => {
        for (const table of [
            'ProductBatchWarehouseStock',
            'ProductBatchLedgerEntry',
            'PurchaseOrderCloseShort',
            'PurchaseOrderCloseShortItem',
        ]) {
            expect(migration).toContain(`CREATE TABLE \`${table}\``);
        }
        expect(migration).toContain("ADD COLUMN `batchWarehouseLedgerMode` VARCHAR(16) NOT NULL DEFAULT 'OFF'");
        expect(migration).toContain('ADD COLUMN `clientEventId` VARCHAR(128) NULL');
        expect(migration).toContain('ADD COLUMN `payloadHash` VARCHAR(64) NULL');
        expect(migration).toContain("ADD COLUMN `batchTransferStatus` VARCHAR(32) NOT NULL DEFAULT 'OFF'");
        expect(migration).toContain('ADD COLUMN `batchSnapshot` JSON NULL');
        expect(migration).toContain('CREATE UNIQUE INDEX `StockTransfer_tenantId_clientEventId_key`');
        expect(migration).toContain("`status` VARCHAR(32) NOT NULL DEFAULT 'APPLIED'");
        expect(migration).toContain('ADD COLUMN `warehouseId` VARCHAR(191) NULL');
        expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
        expect(migration).toContain('PurchaseOrderCloseShortItem_closeShortId_fkey');
        expect(migration).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
        expect(migration).not.toMatch(/^(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
        expect(migration).not.toMatch(/\b(?:MODIFY|CHANGE|RENAME)\s+(?:COLUMN|TABLE)\b/i);
        expect(migration).not.toMatch(/DEFAULT\s+'(?:SHADOW|ENFORCED)'/i);
        expect(migration).not.toContain('--accept-data-loss');
    });
});
