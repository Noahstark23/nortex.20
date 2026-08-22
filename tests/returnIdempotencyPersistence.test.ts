import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
const migration = readFileSync(resolve(
    process.cwd(),
    'backend/prisma/migrations/20260822_measured_products_scales/migration.sql',
), 'utf8');

const modelBlock = (name: string): string => {
    const start = schema.indexOf(`model ${name} {`);
    const end = schema.indexOf('\n}', start);
    if (start < 0 || end < 0) throw new Error(`Modelo ${name} no encontrado`);
    return schema.slice(start, end + 2);
};

describe('persistencia idempotente de devoluciones', () => {
    it('mantiene columnas históricas nullable y unicidad tenant+evento', () => {
        const productReturn = modelBlock('ProductReturn');
        expect(productReturn).toMatch(/clientEventId\s+String\?\s+@db\.VarChar\(128\)/);
        expect(productReturn).toMatch(/payloadHash\s+String\?\s+@db\.VarChar\(64\)/);
        expect(productReturn).toContain('@@unique([tenantId, clientEventId])');
    });

    it('migra columnas aditivas antes de crear el índice único', () => {
        const alterIndex = migration.indexOf('ALTER TABLE `ProductReturn`');
        const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX `ProductReturn_tenantId_clientEventId_key`');
        expect(alterIndex).toBeGreaterThan(-1);
        expect(migration.slice(alterIndex, uniqueIndex)).toContain('`clientEventId` VARCHAR(128) NULL');
        expect(migration.slice(alterIndex, uniqueIndex)).toContain('`payloadHash` VARCHAR(64) NULL');
        expect(uniqueIndex).toBeGreaterThan(alterIndex);
        expect(migration.slice(uniqueIndex)).toContain('ON `ProductReturn`(`tenantId`, `clientEventId`)');
    });

    it('incluye el hash offline coordinado sin alterar la llave offline legacy', () => {
        const sale = modelBlock('Sale');
        expect(sale).toContain('offlineId      String?   @unique');
        expect(sale).toMatch(/offlinePayloadHash\s+String\?\s+@db\.VarChar\(64\)/);
        expect(migration).toContain('ADD COLUMN `offlinePayloadHash` VARCHAR(64) NULL');
    });
});
