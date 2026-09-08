import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
    'backend/prisma/migrations/20260831_pharmacy_inventory_safety_phase0/migration.sql',
    'utf8',
);

function modelBlock(name: string): string {
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`No se encontró model ${name}`);
    return match[0];
}

describe('Farmacias Bloque 0 — contrato persistente', () => {
    it('preserva apagado por defecto el modo farmacéutico', () => {
        const tenant = modelBlock('Tenant');

        expect(tenant).toMatch(
            /pharmacyInventoryMode\s+String\s+@default\("OFF"\)\s+@db\.VarChar\(16\)/,
        );
        expect(tenant).toMatch(/pharmacyInventoryActivatedAt\s+DateTime\?/);
        expect(tenant).toContain('productBatchHolds');
    });

    it('separa stock físico y stock retenido con precisión exacta', () => {
        const stock = modelBlock('ProductBatchWarehouseStock');

        expect(stock).toMatch(/stock\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(18, 4\)/);
        expect(stock).toMatch(/heldStock\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(18, 4\)/);
        expect(stock).toContain('@@unique([tenantId, batchId, warehouseId])');
    });

    it('persiste un libro append-only, idempotente y tenant-scoped', () => {
        const hold = modelBlock('ProductBatchHold');

        for (const field of [
            'quantityDelta',
            'heldBefore',
            'heldAfter',
            'physicalStockSnapshot',
            'sellableBefore',
            'sellableAfter',
        ]) {
            expect(hold).toMatch(new RegExp(`${field}\\s+Decimal\\s+@db\\.Decimal\\(18, 4\\)`));
        }
        expect(hold).toMatch(/holdReasonCode\s+String\s+@db\.VarChar\(32\)/);
        expect(hold).toMatch(/referenceId\s+String\?/);
        expect(hold).toMatch(/referenceType\s+String\?\s+@db\.VarChar\(64\)/);
        expect(hold).toMatch(/sourceKey\s+String\s+@db\.VarChar\(191\)/);
        expect(hold).toMatch(/payloadHash\s+String\s+@db\.VarChar\(64\)/);
        expect(hold).toContain('@@unique([tenantId, sourceKey])');
        expect(hold).toContain('@@index([tenantId, batchId, warehouseId, createdAt])');
        expect(hold).toContain('@@index([tenantId, productId, warehouseId, createdAt])');
        expect(hold).toContain('@@index([tenantId, referenceType, referenceId])');
        expect(hold).toContain('@relation("ProductBatchHoldCreator"');
    });

    it('declara las backrelations de todas sus dimensiones', () => {
        const expected: Record<string, string> = {
            Tenant: 'productBatchHolds',
            User: 'productBatchHoldsCreated',
            Product: 'batchHolds',
            ProductBatch: 'holds',
            Warehouse: 'batchHolds',
        };

        for (const [model, relation] of Object.entries(expected)) {
            expect(modelBlock(model)).toContain(relation);
        }
    });

    it('mantiene la migración expand-only y sin activación automática', () => {
        expect(migration).toContain(
            "ADD COLUMN `pharmacyInventoryMode` VARCHAR(16) NOT NULL DEFAULT 'OFF'",
        );
        expect(migration).toContain(
            'ADD COLUMN `pharmacyInventoryActivatedAt` DATETIME(3) NULL',
        );
        expect(migration).toContain(
            'ADD COLUMN `heldStock` DECIMAL(18, 4) NOT NULL DEFAULT 0',
        );
        expect(migration).toContain('CREATE TABLE `ProductBatchHold`');
        expect(migration).toContain('`referenceId` VARCHAR(191) NULL');
        expect(migration).toContain('`referenceType` VARCHAR(64) NULL');
        expect(migration).toContain('ProductBatchHold_tenantId_sourceKey_key');
        expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
        expect(migration).not.toMatch(/^(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
        expect(migration).not.toMatch(/\b(?:MODIFY|CHANGE|RENAME)\s+(?:COLUMN|TABLE)\b/i);
        expect(migration).not.toMatch(/DEFAULT\s+'ENFORCED'/i);
        expect(migration).not.toContain('--accept-data-loss');
    });
});
