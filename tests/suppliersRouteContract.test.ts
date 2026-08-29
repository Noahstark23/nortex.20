import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    SUPPLIER_READ_ROLES,
    SUPPLIER_WRITE_ROLES,
} from '../backend/middleware/accessPolicies';

const route = readFileSync(resolve(process.cwd(), 'backend/routes/suppliers.ts'), 'utf8');
const service = readFileSync(resolve(process.cwd(), 'backend/services/supplierService.ts'), 'utf8');

describe('suppliers route contract', () => {
    it('declara mínimo privilegio canónico', () => {
        expect(SUPPLIER_READ_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT',
        ]);
        expect(SUPPLIER_WRITE_ROLES).toEqual(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
        expect(route).toContain("checkRole(SUPPLIER_READ_ROLES)");
        expect(route).toContain("checkRole(SUPPLIER_WRITE_ROLES)");
        expect(route).toContain("checkRole(SUPPLIER_CONTACT_WRITE_ROLES)");
        expect(route).toContain("checkRole(SUPPLIER_ADMIN_ROLES)");
        expect(route).not.toContain("'MANAGER'] as const");
    });

    it('valida cuerpos, query y params con esquemas estrictos', () => {
        expect(route).toContain('SupplierListQuerySchema, req.query');
        expect(route).toContain('SupplierIdParamsSchema, req.params');
        expect(route).toContain('SupplierContactParamsSchema, req.params');
        expect(route).toContain('SupplierDocumentParamsSchema, req.params');
        expect(route).toContain('validateBody(CreateSupplierSchema)');
        expect(route).toContain('validateBody(UpdateSupplierSchema)');
        expect(route).toContain('validateBody(CreateSupplierContactSchema)');
        expect(route).toContain('validateBody(UpdateSupplierContactSchema)');
        expect(route).toContain('validateBody(CreateSupplierDocumentSchema)');
    });

    it('preserva respuesta legacy en create/update y agrega el adaptador data', () => {
        expect(route.match(/return res\.json\(\{ \.\.\.data, data \}\);/g)).toHaveLength(2);
        expect(route).not.toContain('res.status(201).json({ ...data, data })');
    });

    it('no ofrece upload, download ni URL pública', () => {
        expect(route).not.toMatch(/router\.(get|post)\([^\n]*(download|upload)/i);
        expect(route).not.toContain('publicUrl');
        expect(service).not.toContain('signedUrl');
        expect(service).not.toContain('https://');
    });

    it('usa singleton y todas las listas quedan acotadas', () => {
        expect(service).toContain("import prisma from '../lib/prisma.js'");
        expect(service).not.toContain('new PrismaClient');
        const findManyCalls = service.match(/\.findMany\(\{/g) ?? [];
        const takeClauses = service.match(/\btake:/g) ?? [];
        // Contactos, documentos, compras, pagos y los tres historiales 2C,
        // además de la lista raíz de proveedores.
        expect(findManyCalls.length).toBe(8);
        expect(takeClauses.length).toBeGreaterThanOrEqual(findManyCalls.length);
    });

    it('hace soft-delete de proveedor y auditoría dentro de transacción', () => {
        expect(service).toContain("action: 'SUPPLIER_SOFT_DELETED'");
        expect(service).toContain('data: { deletedAt }');
        expect(service).not.toContain('tx.supplier.delete(');
        expect(service).toContain('return database.$transaction(async (tx) => {');
    });
});
