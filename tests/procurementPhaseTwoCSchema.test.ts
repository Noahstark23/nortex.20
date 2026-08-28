import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
    'backend/prisma/migrations/20260827_procurement_phase_two_c_supplier_returns_credits/migration.sql',
    'utf8',
);

function modelBlock(name: string): string {
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`No se encontró model ${name}`);
    return match[0];
}

describe('Procurement Fase 2C — contrato persistente', () => {
    it('expande Purchase/PurchaseItem sin reinterpretar el histórico', () => {
        const purchase = modelBlock('Purchase');
        const item = modelBlock('PurchaseItem');

        expect(purchase).toMatch(/settledAt\s+DateTime\?/);
        expect(purchase).toContain('creditApplications SupplierCreditApplication[]');
        expect(item).toMatch(/inventoryWarehouseId\s+String\?/);
        expect(item).toMatch(/inventoryBatchId\s+String\?/);
        expect(item).toMatch(/inventoryUnitCostExact\s+Decimal\?\s+@db\.Decimal\(18, 6\)/);
        expect(item).toContain('@relation("PurchaseItemInventoryWarehouse"');
        expect(item).toContain('@relation("PurchaseItemInventoryBatch"');
        expect(item).toContain('onDelete: Restrict');
        expect(item).toContain('@@index([inventoryWarehouseId])');
        expect(item).toContain('@@index([inventoryBatchId])');
    });

    it('modela la devolución física como documento idempotente tenant-scoped', () => {
        const header = modelBlock('SupplierReturn');
        const item = modelBlock('SupplierReturnItem');

        expect(header).toMatch(/status\s+String\s+@default\("POSTED"\)\s+@db\.VarChar\(32\)/);
        expect(header).toMatch(/clientEventId\s+String\s+@db\.VarChar\(128\)/);
        expect(header).toMatch(/payloadVersion\s+Int\s+@default\(1\)/);
        expect(header).toMatch(/payloadHash\s+String\s+@db\.VarChar\(64\)/);
        expect(header).toMatch(/batchLedgerMode\s+String\s+@db\.VarChar\(16\)/);
        expect(header).toContain('@@unique([tenantId, returnNumber])');
        expect(header).toContain('@@unique([tenantId, clientEventId])');

        expect(item).toMatch(/sourceType\s+String\s+@db\.VarChar\(32\)/);
        for (const sourceId of ['purchaseItemId', 'goodsReceiptItemId', 'purchaseMatchAllocationId']) {
            expect(item).toMatch(new RegExp(`${sourceId}\\s+String\\?`));
        }
        expect(item).toMatch(/quantityExact\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/productNameAtReturn\s+String\s+@db\.VarChar\(191\)/);
        expect(item).toMatch(/bookUnitCostExact\s+Decimal\s+@db\.Decimal\(18, 6\)/);
        expect(item).toMatch(/bookValueExact\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(item).toMatch(/sourceHash\s+String\s+@db\.VarChar\(64\)/);
        expect(item).toContain('@@unique([supplierReturnId, sourceHash])');
        expect(item).toContain('@@index([tenantId, purchaseItemId])');
        expect(item).toContain('@@index([tenantId, goodsReceiptItemId])');
        expect(item).toContain('@@index([tenantId, purchaseMatchAllocationId])');
        expect(item).toContain('@@index([tenantId, batchId])');
        expect(item).toMatch(/supplierReturn\s+SupplierReturn\s+@relation\([^\n]+onDelete: Cascade\)/);
    });

    it('separa fechas fiscales y conserva IVA, inventario y PPV exactos', () => {
        const note = modelBlock('SupplierCreditNote');

        expect(note).toMatch(/type\s+String\s+@default\("RETURN"\)\s+@db\.VarChar\(32\)/);
        expect(note).toMatch(/status\s+String\s+@default\("POSTED"\)\s+@db\.VarChar\(32\)/);
        for (const date of ['invoiceDate', 'creditNoteDate', 'devolutionDate', 'postingDate']) {
            expect(note).toMatch(new RegExp(`${date}\\s+DateTime(?!\\?)`));
        }
        expect(note).toMatch(/fiscalRegimeAtCredit\s+String\s+@db\.VarChar\(32\)/);
        expect(note).toMatch(/currencyAtIssue\s+String\s+@db\.VarChar\(3\)/);
        for (const amount of [
            'subtotal',
            'tax',
            'creditableTax',
            'total',
            'inventoryReversalExact',
            'priceVarianceReversalExact',
        ]) {
            expect(note).toMatch(new RegExp(`${amount}\\s+Decimal\\s+@db\\.Decimal\\(18, 4\\)`));
        }
        expect(note).toMatch(/remainingCredit\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(18, 4\)/);
        expect(note).toContain('@@unique([tenantId, supplierId, creditNoteNumber])');
        expect(note).toContain('@@unique([tenantId, clientEventId])');
    });

    it('impide acreditar dos veces una salida física y aplica cada nota una vez por factura', () => {
        const line = modelBlock('SupplierCreditNoteLine');
        const application = modelBlock('SupplierCreditApplication');

        expect(line).toMatch(/supplierReturnItemId\s+String\s+@unique/);
        expect(line).toContain('@@unique([creditNoteId, supplierReturnItemId])');
        expect(line).toMatch(/sourceHash\s+String\s+@db\.VarChar\(64\)/);
        expect(line).toMatch(/bookUnitCostExact\s+Decimal\s+@db\.Decimal\(18, 6\)/);
        expect(line).toMatch(/bookValueExact\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(line).toMatch(/descriptionAtCredit\s+String\s+@db\.VarChar\(191\)/);
        expect(line).toMatch(/unitAtCredit\s+String\s+@db\.VarChar\(32\)/);
        expect(line).toMatch(/creditNote\s+SupplierCreditNote\s+@relation\([^\n]+onDelete: Cascade\)/);

        expect(application).toMatch(/amount\s+Decimal\s+@db\.Decimal\(18, 4\)/);
        expect(application).toContain('@@unique([creditNoteId, purchaseId])');
        expect(application).toMatch(/creditNote\s+SupplierCreditNote\s+@relation\([^\n]+onDelete: Restrict\)/);
        expect(application).toMatch(/purchase\s+Purchase\s+@relation\([^\n]+onDelete: Restrict\)/);
    });

    it('declara todas las backrelations requeridas', () => {
        const expected: Record<string, string[]> = {
            Tenant: [
                'supplierReturns', 'supplierReturnItems', 'supplierCreditNotes',
                'supplierCreditNoteLines', 'supplierCreditApplications',
            ],
            User: [
                'supplierReturnsCreated', 'supplierCreditNotesCreated',
                'supplierCreditApplicationsCreated',
            ],
            Supplier: ['supplierReturns', 'creditNotes', 'creditApplications'],
            Purchase: ['creditApplications'],
            PurchaseItem: ['supplierReturnItems', 'supplierCreditNoteLines'],
            GoodsReceiptItem: ['supplierReturnItems'],
            PurchaseMatchAllocation: ['supplierReturnItems', 'supplierCreditNoteLines'],
            Product: ['supplierReturnItems'],
            Warehouse: ['purchaseItemsWithInventoryEvidence', 'supplierReturnItems'],
            ProductBatch: ['purchaseItemsWithInventoryEvidence', 'supplierReturnItems'],
        };
        for (const [model, relations] of Object.entries(expected)) {
            const block = modelBlock(model);
            for (const relation of relations) expect(block).toContain(relation);
        }
    });

    it('mantiene la migración expand-only y limita CASCADE a header→líneas', () => {
        for (const table of [
            'SupplierReturn',
            'SupplierReturnItem',
            'SupplierCreditNote',
            'SupplierCreditNoteLine',
            'SupplierCreditApplication',
        ]) {
            expect(migration).toContain(`CREATE TABLE \`${table}\``);
        }
        expect(migration).toContain('ADD COLUMN `settledAt` DATETIME(3) NULL');
        expect(migration).toContain('ADD COLUMN `inventoryUnitCostExact` DECIMAL(18, 6) NULL');
        expect(migration).toContain('`productNameAtReturn` VARCHAR(191) NOT NULL');
        expect(migration).toContain('SupplierCreditNoteLine_supplierReturnItemId_key');
        expect(migration).toContain('SupplierCreditApplication_creditNoteId_purchaseId_key');
        expect(migration.match(/ON DELETE CASCADE ON UPDATE CASCADE/g)).toHaveLength(2);
        expect(migration).toContain('SupplierReturnItem_supplierReturnId_fkey');
        expect(migration).toContain('SupplierCreditNoteLine_creditNoteId_fkey');
        expect(migration).not.toMatch(/^(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
        expect(migration).not.toMatch(/\b(?:MODIFY|CHANGE|RENAME)\s+(?:COLUMN|TABLE)\b/i);
        expect(migration).not.toContain('--accept-data-loss');
        expect(migration).not.toMatch(/batchWarehouseLedgerMode\s*=|SHADOW|ENFORCED/);
    });
});
