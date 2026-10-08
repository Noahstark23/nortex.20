import { describe, expect, it } from 'vitest';
import {
    CreateSupplierDocumentSchema,
    CreateSupplierSchema,
    isSupplierControlAuthorized,
    SupplierListQuerySchema,
    UpdateSupplierSchema,
} from '../backend/validation/supplierSchemas';

describe('supplierSchemas', () => {
    it('mantiene el listado acotado y rechaza query params desconocidos', () => {
        expect(SupplierListQuerySchema.parse({})).toEqual({ status: 'ACTIVE', limit: 500 });
        expect(SupplierListQuerySchema.parse({ limit: '500', search: '  pollo  ' })).toEqual({
            limit: 500,
            search: 'pollo',
            status: 'ACTIVE',
        });
        expect(SupplierListQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
        expect(SupplierListQuerySchema.safeParse({ tenantId: 'otro-tenant' }).success).toBe(false);
    });

    it('rechaza tenant inyectado y conserva montos exactos con cuatro decimales', () => {
        const valid = CreateSupplierSchema.parse({
            name: 'Distribuidora Norte',
            creditLimit: '1000.125',
            minimumOrderAmount: 25.5,
            currency: 'nio',
        });

        expect(valid.creditLimit).toBe('1000.1250');
        expect(valid.minimumOrderAmount).toBe('25.5000');
        expect(valid.currency).toBe('NIO');
        expect(CreateSupplierSchema.safeParse({ name: 'X', tenantId: 'forjado' }).success).toBe(false);
        expect(CreateSupplierSchema.safeParse({ name: 'X', creditLimit: '1.00001' }).success).toBe(false);
        expect(CreateSupplierSchema.safeParse({ name: 'X', creditLimit: 'Infinity' }).success).toBe(false);
    });

    it('alinea estados y tipo legal al contrato canónico', () => {
        expect(CreateSupplierSchema.safeParse({
            name: 'Proveedor',
            status: 'BLOCKED',
            legalType: 'JURIDICAL',
        }).success).toBe(true);
        expect(CreateSupplierSchema.safeParse({ name: 'Proveedor', status: 'PROSPECT' }).success).toBe(false);
        expect(CreateSupplierSchema.safeParse({ name: 'Proveedor', legalType: 'LEGAL' }).success).toBe(false);
    });

    it('hace fail-closed en updates vacíos y en controles privilegiados', () => {
        expect(UpdateSupplierSchema.safeParse({}).success).toBe(false);
        expect(isSupplierControlAuthorized('MANAGER', { name: 'Nuevo nombre' })).toBe(true);
        expect(isSupplierControlAuthorized('MANAGER', { name: 'Nuevo', status: 'BLOCKED' })).toBe(false);
        expect(isSupplierControlAuthorized('ADMIN', { creditLimit: '100.0000' })).toBe(true);
    });

    it('solo admite metadata de storage privado, nunca URL o traversal', () => {
        const valid = CreateSupplierDocumentSchema.parse({
            kind: 'tax_certificate',
            fileName: 'constancia.pdf',
            storageKey: '2026/08/documento-abc.pdf',
            sha256: 'A'.repeat(64),
            expiresAt: '2027-08-27T12:00:00-06:00',
        });
        expect(valid.kind).toBe('TAX_CERTIFICATE');
        expect(valid.sha256).toBe('a'.repeat(64));
        expect(valid.expiresAt).toBeInstanceOf(Date);

        expect(CreateSupplierDocumentSchema.safeParse({
            kind: 'OTHER', fileName: 'x.pdf', storageKey: 'https://cdn.example/x.pdf',
        }).success).toBe(false);
        expect(CreateSupplierDocumentSchema.safeParse({
            kind: 'OTHER', fileName: 'x.pdf', storageKey: '../tenant-ajeno/x.pdf',
        }).success).toBe(false);
        expect(CreateSupplierDocumentSchema.safeParse({
            kind: 'OTHER', fileName: 'x.pdf', storageKey: 'x.pdf', publicUrl: 'https://example.test/x',
        }).success).toBe(false);
    });
});
