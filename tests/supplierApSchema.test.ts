import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
const migration = readFileSync(
    'backend/prisma/migrations/20260827_supplier_ap_hub/migration.sql',
    'utf8',
);

function modelBlock(name: string): string {
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`No se encontró model ${name}`);
    return match[0];
}

describe('supplier/AP schema', () => {
    it('usa Decimal(18,4) y conserva históricos de CxP como estado desconocido', () => {
        const supplier = modelBlock('Supplier');
        const purchase = modelBlock('Purchase');
        const payment = modelBlock('SupplierPayment');

        expect(supplier).toMatch(/creditLimit\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(supplier).toMatch(/minimumOrderAmount\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(purchase).toMatch(/balanceDue\s+Decimal\?\s+@db\.Decimal\(18, 4\)/);
        expect(purchase).toMatch(/paidAt\s+DateTime\?/);
        expect(payment).toMatch(/amount\s+Decimal\s+@db\.Decimal\(18, 4\)/);
    });

    it('incluye soft delete, back-relations tenant-scoped e idempotencia persistida', () => {
        const tenant = modelBlock('Tenant');
        const user = modelBlock('User');
        const supplier = modelBlock('Supplier');
        const purchase = modelBlock('Purchase');
        const contact = modelBlock('SupplierContact');
        const document = modelBlock('SupplierDocument');
        const payment = modelBlock('SupplierPayment');

        expect(supplier).toMatch(/deletedAt\s+DateTime\?/);
        expect(supplier).toMatch(/status\s+String\s+@default\("ACTIVE"\)/);
        expect(tenant).toContain('supplierContacts');
        expect(tenant).toContain('supplierDocuments');
        expect(tenant).toContain('supplierPayments');
        expect(user).toContain('@relation("SupplierContactCreator")');
        expect(user).toContain('@relation("SupplierDocumentUploader")');
        expect(user).toContain('@relation("SupplierPaymentCreator")');
        expect(contact).toContain('tenantId');
        expect(document).toMatch(/storageKey\s+String\s+@db\.VarChar\(512\)/);
        expect(payment).toMatch(/clientEventId\s+String\s+@db\.VarChar\(128\)/);
        expect(payment).toMatch(/payloadHash\s+String\s+@db\.VarChar\(64\)/);
        expect(payment).toContain('@@unique([tenantId, clientEventId])');
        expect(purchase).toContain('@@unique([tenantId, supplierId, invoiceNumber])');
    });

    it('declara índices alineados con los listados y el historial de proveedor', () => {
        const supplier = modelBlock('Supplier');
        const purchase = modelBlock('Purchase');
        const payment = modelBlock('SupplierPayment');

        expect(supplier).toContain('@@index([tenantId, deletedAt, name])');
        expect(supplier).toContain('@@index([tenantId, status, name])');
        expect(purchase).toContain('@@index([tenantId, supplierId, date])');
        expect(payment).toContain('@@index([tenantId, supplierId, paidAt])');
    });

    it('mantiene la migración expand-only y sin backfill DML', () => {
        expect(migration).toContain('ADD COLUMN `balanceDue` DECIMAL(18, 4) NULL');
        expect(migration).toContain(
            'CREATE UNIQUE INDEX `Purchase_tenantId_supplierId_invoiceNumber_key`',
        );
        expect(migration).toContain('CREATE TABLE `SupplierPayment`');
        expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
        expect(migration).not.toMatch(/^(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
        expect(migration).not.toMatch(/\b(?:MODIFY|CHANGE|RENAME)\s+(?:COLUMN|TABLE)\b/i);
        expect(migration).not.toContain('--accept-data-loss');
    });
});
