import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CUSTOMER_INTERACTION_WRITE_ROLES,
    CUSTOMER_READ_ROLES,
} from '../backend/middleware/accessPolicies';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const schema = readFileSync(resolve(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
    resolve(process.cwd(), 'backend/prisma/migrations/20260827_customer_relationship_hub/migration.sql'),
    'utf8',
);

describe('seguimiento de clientes', () => {
    it('mantiene lectura amplia y escritura operativa sin habilitar VIEWER', () => {
        expect(CUSTOMER_READ_ROLES).toContain('VIEWER');
        expect(CUSTOMER_INTERACTION_WRITE_ROLES).toEqual(expect.arrayContaining([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'CASHIER', 'VENDEDOR',
        ]));
        expect(CUSTOMER_INTERACTION_WRITE_ROLES).not.toContain('VIEWER');
    });

    it('aísla por tenant y cartera, bloquea la fila al resolver y audita en la misma transacción', () => {
        const createStart = server.indexOf("'/api/customers/:id/interactions'");
        const updateStart = server.indexOf("'/api/customers/:customerId/interactions/:interactionId'");
        const updateEnd = server.indexOf("app.put('/api/customers/:id'", updateStart);
        const createRoute = server.slice(createStart, updateStart);
        const updateRoute = server.slice(updateStart, updateEnd);

        expect(createRoute).toContain('checkRole(CUSTOMER_INTERACTION_WRITE_ROLES)');
        expect(createRoute).toContain('applySellerCustomerScope(authReq, { id: customerId, tenantId })');
        expect(createRoute).toContain('await prisma.$transaction');
        expect(createRoute).toContain("action: 'CUSTOMER_INTERACTION_CREATED'");
        expect(createRoute).not.toContain('note: created.note');

        expect(updateRoute).toContain('AND tenantId = ${tenantId}');
        expect(updateRoute).toContain('AND customerId = ${customerId}');
        expect(updateRoute).toContain('FOR UPDATE`');
        expect(updateRoute).toContain("action: 'CUSTOMER_INTERACTION_RESOLVED'");
    });

    it('crea una tabla aditiva tenant-scoped con FKs restrictivas e índices de agenda', () => {
        const model = schema.slice(schema.indexOf('model CustomerInteraction {'), schema.indexOf('model Supplier {'));
        expect(model).toContain('promisedAmount Decimal?');
        expect(model).toContain('followUpAt');
        expect(model).toContain('onDelete: Restrict');
        expect(model).toContain('@@index([tenantId, customerId, createdAt])');
        expect(model).toContain('@@index([tenantId, status, followUpAt])');

        expect(migration).toContain('CREATE TABLE `CustomerInteraction`');
        expect(migration.match(/ON DELETE RESTRICT/g)).toHaveLength(3);
        expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    });
});

