import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
    'backend/prisma/migrations/20260827_procurement_phase_two/migration.sql',
    'utf8',
);

function modelBlock(name: string): string {
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`No se encontró model ${name}`);
    return match[0];
}

describe('Procurement Fase 2 — contrato persistente', () => {
    it('preserva compras históricas y agrega resolución idempotente nullable', () => {
        const purchase = modelBlock('Purchase');

        expect(purchase).toMatch(/postingDate\s+DateTime\?/);
        expect(purchase).toMatch(/documentStatus\s+String\s+@default\("POSTED"\)\s+@db\.VarChar\(32\)/);
        expect(purchase).toMatch(/matchStatus\s+String\s+@default\("NOT_REQUIRED"\)\s+@db\.VarChar\(32\)/);
        expect(purchase).toMatch(/paymentHold\s+Boolean\s+@default\(false\)/);
        expect(purchase).toMatch(/matchResolvedBy\s+String\?/);
        expect(purchase).toMatch(/matchResolvedAt\s+DateTime\?/);
        expect(purchase).toMatch(/matchResolutionNote\s+String\?\s+@db\.Text/);
        expect(purchase).toMatch(/matchResolutionClientEventId\s+String\?\s+@db\.VarChar\(128\)/);
        expect(purchase).toMatch(/matchResolutionPayloadHash\s+String\?\s+@db\.VarChar\(64\)/);
        expect(purchase).toContain('@@unique([tenantId, matchResolutionClientEventId])');
    });

    it('congela precisión de factura y vínculo exacto a línea de OC', () => {
        const item = modelBlock('PurchaseItem');
        const orderItem = modelBlock('PurchaseOrderItem');

        expect(item).toMatch(/purchaseOrderItemId\s+String\?/);
        expect(item).toMatch(/unitCostExact\s+Decimal\?\s+@db\.Decimal\(18, 6\)/);
        expect(item).toMatch(/expectedUnitCostExact\s+Decimal\?\s+@db\.Decimal\(18, 6\)/);
        expect(item).toMatch(/taxAmountExact\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/creditableTaxExact\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/priceVarianceExact\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(item).toContain('onDelete: Restrict');
        expect(item).toContain('@@index([purchaseOrderItemId])');
        expect(orderItem).toMatch(/unitCostExact\s+Decimal\?\s+@db\.Decimal\(18, 6\)/);
    });

    it('separa la recepción física de la factura y conserva receipts legacy', () => {
        const order = modelBlock('PurchaseOrder');
        const receipt = modelBlock('GoodsReceipt');
        const item = modelBlock('GoodsReceiptItem');

        expect(order).toContain('receipts Purchase[]');
        expect(order).toContain('goodsReceipts GoodsReceipt[]');
        expect(receipt).toMatch(/status\s+String\s+@default\("POSTED"\)\s+@db\.VarChar\(32\)/);
        expect(receipt).toMatch(/clientEventId\s+String\s+@db\.VarChar\(128\)/);
        expect(receipt).toMatch(/payloadHash\s+String\s+@db\.VarChar\(64\)/);
        expect(receipt).toContain('@@unique([tenantId, receiptNumber])');
        expect(receipt).toContain('@@unique([tenantId, clientEventId])');
        expect(item).toMatch(/quantityExact\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/unitSnapshot\s+String\s+@db\.VarChar\(32\)/);
        expect(item).toMatch(/unitCostExact\s+Decimal\s+@db\.Decimal\(18, 6\)/);
        expect(item).toContain('receipt           GoodsReceipt');
        expect(item).toContain('onDelete: Cascade');
        expect(item).toContain('@@index([tenantId, purchaseOrderItemId])');
    });

    it('persiste allocations, excepciones y política con precisión e índices tenant-scoped', () => {
        const allocation = modelBlock('PurchaseMatchAllocation');
        const exception = modelBlock('PurchaseMatchException');
        const policy = modelBlock('ProcurementPolicy');

        expect(allocation).toMatch(/quantityExact\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(allocation).toMatch(/expectedUnitCostExact\s+Decimal\s+@db\.Decimal\(18, 6\)/);
        expect(allocation).toMatch(/actualUnitCostExact\s+Decimal\s+@db\.Decimal\(18, 6\)/);
        expect(allocation).toMatch(/priceVarianceExact\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(allocation).toMatch(/goodsReceiptItemId\s+String\?/);
        expect(allocation).toMatch(/source\s+String\s+@default\("FORMAL_RECEIPT"\)\s+@db\.VarChar\(32\)/);
        expect(allocation).toContain('@@unique([purchaseItemId, goodsReceiptItemId])');
        expect(exception).toMatch(/status\s+String\s+@default\("OPEN"\)\s+@db\.VarChar\(16\)/);
        for (const field of ['expectedValueExact', 'actualValueExact', 'varianceExact', 'toleranceExact']) {
            expect(exception).toMatch(new RegExp(`${field}\\s+Decimal\\?\\s+@db\\.Decimal\\(18, 6\\)`));
        }
        expect(exception).toContain('@@index([tenantId, status, createdAt])');
        expect(policy).toMatch(/priceTolerancePct\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(9, 4\)/);
        expect(policy).toMatch(/autoHold\s+Boolean\s+@default\(true\)/);
        expect(policy).toMatch(/tenantId\s+String\s+@unique/);
    });

    it('mantiene la migración estrictamente aditiva, sin DML ni FKs históricas en cascade', () => {
        expect(migration).toContain('CREATE TABLE `GoodsReceipt`');
        expect(migration).toContain('CREATE TABLE `GoodsReceiptItem`');
        expect(migration).toContain('CREATE TABLE `PurchaseMatchAllocation`');
        expect(migration).toContain('CREATE TABLE `PurchaseMatchException`');
        expect(migration).toContain('CREATE TABLE `ProcurementPolicy`');
        expect(migration).toContain('ADD COLUMN `unitCostExact` DECIMAL(18, 6) NULL');
        expect(migration).toContain('`goodsReceiptItemId` VARCHAR(191) NULL');
        expect(migration).toContain("`source` VARCHAR(32) NOT NULL DEFAULT 'FORMAL_RECEIPT'");
        expect(migration).toContain('CREATE UNIQUE INDEX `Purchase_tenantId_matchResolutionClientEventId_key`');
        expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
        expect(migration).toContain('GoodsReceiptItem_goodsReceiptId_fkey');
        expect(migration).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
        expect(migration).not.toMatch(/^(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
        expect(migration).not.toMatch(/\b(?:MODIFY|CHANGE|RENAME)\s+(?:COLUMN|TABLE)\b/i);
        expect(migration).not.toContain('--accept-data-loss');
    });
});
