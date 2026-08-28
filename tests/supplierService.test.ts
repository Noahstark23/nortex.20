import { describe, expect, it, vi } from 'vitest';
import {
    calculateSupplierSettlementTotals,
    createSupplierService,
    type SupplierDatabase,
} from '../backend/services/supplierService';

const supplier = {
    id: 'supplier-a',
    tenantId: 'tenant-a',
    name: 'Proveedor privado',
    ruc: 'RUC-SECRETO-123',
    contactName: 'Persona Privada',
    phone: '8888-0000',
    email: 'privado@example.test',
    address: 'Dirección privada',
    category: 'Alimentos',
    status: 'ACTIVE',
    legalType: 'JURIDICAL',
    fiscalCategory: 'GENERAL',
    currency: 'NIO',
    paymentTermsDays: 30,
    creditLimit: '1000.5',
    leadTimeDays: 2,
    minimumOrderAmount: '50',
    notes: 'Nota privada',
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-02T00:00:00Z'),
};

function delegate() {
    return {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        aggregate: vi.fn(),
    };
}

function fakeDatabase(): SupplierDatabase {
    const database: SupplierDatabase = {
        supplier: delegate(),
        supplierContact: delegate(),
        supplierDocument: delegate(),
        supplierPayment: delegate(),
        supplierReturn: delegate(),
        supplierCreditNote: delegate(),
        supplierCreditApplication: delegate(),
        purchase: delegate(),
        auditLog: { create: vi.fn() },
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
    };
    vi.mocked(database.$transaction).mockImplementation(async (callback: any) => callback(database));
    return database;
}

function configureDetail(database: SupplierDatabase) {
    vi.mocked(database.supplier.findFirst).mockResolvedValue(supplier);
    vi.mocked(database.supplierContact.findMany).mockResolvedValue([{
        id: 'contact-a',
        supplierId: supplier.id,
        name: 'Contacto',
        title: null,
        phone: '7777-0000',
        email: null,
        isPrimary: true,
        notes: null,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
    }]);
    vi.mocked(database.supplierDocument.findMany).mockResolvedValue([{
        id: 'doc-a',
        supplierId: supplier.id,
        kind: 'CONTRACT',
        fileName: 'contrato.pdf',
        storageKey: 'tenants/tenant-a/suppliers/supplier-a/doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        sha256: null,
        expiresAt: null,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
    }]);
    vi.mocked(database.purchase.findMany).mockResolvedValue([{
        id: 'purchase-a',
        invoiceNumber: 'F-1',
        date: supplier.createdAt,
        dueDate: supplier.updatedAt,
        total: '200',
        balanceDue: '75.25',
        status: 'PARTIALLY_PAID',
        paymentMethod: 'CREDIT',
    }]);
    vi.mocked(database.supplierPayment.findMany).mockResolvedValue([{
        id: 'payment-a',
        purchaseId: 'purchase-a',
        amount: '124.75',
        method: 'TRANSFER',
        paidAt: supplier.updatedAt,
        createdAt: supplier.updatedAt,
    }]);
    vi.mocked(database.supplierReturn.findMany).mockResolvedValue([{
        id: 'return-a',
        returnNumber: 'DEV-1',
        status: 'POSTED',
        reasonCode: 'DAMAGED',
        reason: 'Empaque roto',
        supplierReference: 'REF-DEV-1',
        batchLedgerMode: 'OFF',
        returnedAt: supplier.updatedAt,
        createdAt: supplier.updatedAt,
    }]);
    vi.mocked(database.supplierCreditNote.findMany).mockResolvedValue([{
        id: 'credit-note-a',
        creditNoteNumber: 'NC-1',
        type: 'RETURN',
        status: 'POSTED',
        creditNoteDate: supplier.updatedAt,
        devolutionDate: supplier.updatedAt,
        postingDate: supplier.updatedAt,
        currencyAtIssue: 'NIO',
        total: '80',
        creditableTax: '10.4348',
        remainingCredit: '0',
        createdAt: supplier.updatedAt,
    }]);
    vi.mocked(database.supplierCreditApplication.findMany).mockResolvedValue([{
        id: 'credit-application-a',
        creditNoteId: 'credit-note-a',
        purchaseId: 'purchase-a',
        amount: '80',
        appliedAt: supplier.updatedAt,
        createdAt: supplier.updatedAt,
    }]);
    vi.mocked(database.purchase.aggregate)
        .mockResolvedValueOnce({ _count: { id: 3 }, _sum: { total: '500' } })
        .mockResolvedValueOnce({ _sum: { total: '400' } })
        .mockResolvedValueOnce({ _sum: { balanceDue: '75.25' } })
        .mockResolvedValueOnce({ _sum: { total: '20' } })
        .mockResolvedValueOnce({ _count: { id: 0 } })
        .mockResolvedValueOnce({ _count: { id: 0 } });
    vi.mocked(database.supplierPayment.aggregate)
        .mockResolvedValue({ _count: { id: 2 }, _sum: { amount: '124.75' } });
    vi.mocked(database.supplierReturn.aggregate)
        .mockResolvedValue({ _count: { id: 1 } });
    vi.mocked(database.supplierCreditNote.aggregate)
        .mockResolvedValue({ _count: { id: 1 }, _sum: { total: '80' } });
    vi.mocked(database.supplierCreditApplication.aggregate)
        .mockResolvedValue({ _count: { id: 1 }, _sum: { amount: '80' } });
}

describe('supplierService', () => {
    it('lista con tenant, búsqueda server-side y límite; devuelve DTO Decimal', async () => {
        const database = fakeDatabase();
        vi.mocked(database.supplier.findMany).mockResolvedValue([supplier]);
        const service = createSupplierService(database);

        const result = await service.list('tenant-a', { search: 'pollo', limit: 500, status: 'ACTIVE' });

        expect(database.supplier.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: 'tenant-a',
                deletedAt: null,
                status: 'ACTIVE',
                OR: [
                    { name: { contains: 'pollo' } },
                    { ruc: { contains: 'pollo' } },
                    { phone: { contains: 'pollo' } },
                    { email: { contains: 'pollo' } },
                    { category: { contains: 'pollo' } },
                ],
            }),
            take: 500,
        }));
        expect(result).toHaveLength(1);
        expect(result[0].creditLimit).toBe('1000.5000');
        expect(result[0].minimumOrderAmount).toBe('50.0000');
        expect(result[0]).not.toHaveProperty('tenantId');
        expect(result[0]).not.toHaveProperty('deletedAt');
    });

    it('arma el 360 sin storageKey para VIEWER y calcula saldo solo desde abiertas', async () => {
        const database = fakeDatabase();
        configureDetail(database);
        const service = createSupplierService(database);

        const result = await service.detail('tenant-a', 'supplier-a', 'VIEWER');

        expect(database.supplier.findFirst).toHaveBeenCalledWith({
            where: { id: 'supplier-a', tenantId: 'tenant-a', deletedAt: null },
        });
        const documentQuery = vi.mocked(database.supplierDocument.findMany).mock.calls[0][0] as any;
        expect(documentQuery.where).toEqual({ tenantId: 'tenant-a', supplierId: 'supplier-a' });
        expect(documentQuery.take).toBe(100);
        expect(documentQuery.select.storageKey).toBeUndefined();
        expect(result.documents[0]).not.toHaveProperty('storageKey');
        expect(result.recentPurchases[0].total).toBe('200.0000');
        expect(result.recentPurchases[0].balanceDue).toBe('75.2500');
        expect(result.recentReturns[0]).toMatchObject({
            id: 'return-a',
            returnNumber: 'DEV-1',
            status: 'POSTED',
        });
        expect(result.recentCreditNotes[0]).toMatchObject({
            id: 'credit-note-a',
            total: '80.0000',
            creditableTax: '10.4348',
            remainingCredit: '0.0000',
        });
        expect(result.recentCreditApplications[0]).toMatchObject({
            id: 'credit-application-a',
            amount: '80.0000',
        });
        expect(result.aggregates).toMatchObject({
            purchaseCount: 3,
            paymentCount: 2,
            returnCount: 1,
            creditNoteCount: 1,
            creditApplicationCount: 1,
            totalPurchased: '500.0000',
            totalCreditPurchased: '400.0000',
            totalPaid: '224.7500',
            recordedPaymentAmount: '124.7500',
            legacyPaidAmount: '100.0000',
            outstandingBalance: '95.2500',
            totalCreditNotes: '80.0000',
            totalCreditApplied: '80.0000',
        });

        const recentPurchaseQuery = vi.mocked(database.purchase.findMany).mock.calls[0][0] as any;
        expect(recentPurchaseQuery.where).toMatchObject({
            tenantId: 'tenant-a',
            supplierId: 'supplier-a',
            documentStatus: 'POSTED',
        });
        for (const [aggregateQuery] of vi.mocked(database.purchase.aggregate).mock.calls as any[]) {
            expect(aggregateQuery.where).toMatchObject({
                tenantId: 'tenant-a',
                supplierId: 'supplier-a',
                documentStatus: 'POSTED',
            });
        }
        const recentPaymentQuery = vi.mocked(database.supplierPayment.findMany).mock.calls[0][0] as any;
        const paymentAggregateQuery = vi.mocked(database.supplierPayment.aggregate).mock.calls[0][0] as any;
        for (const query of [recentPaymentQuery, paymentAggregateQuery]) {
            expect(query.where).toMatchObject({
                tenantId: 'tenant-a',
                supplierId: 'supplier-a',
                purchase: { documentStatus: 'POSTED' },
            });
        }
        const recentReturnQuery = vi.mocked(database.supplierReturn.findMany).mock.calls[0][0] as any;
        const returnAggregateQuery = vi.mocked(database.supplierReturn.aggregate).mock.calls[0][0] as any;
        for (const query of [recentReturnQuery, returnAggregateQuery]) {
            expect(query.where).toEqual({
                tenantId: 'tenant-a',
                supplierId: 'supplier-a',
                status: 'POSTED',
            });
        }
        const recentCreditNoteQuery = vi.mocked(database.supplierCreditNote.findMany).mock.calls[0][0] as any;
        const creditNoteAggregateQuery = vi.mocked(database.supplierCreditNote.aggregate).mock.calls[0][0] as any;
        for (const query of [recentCreditNoteQuery, creditNoteAggregateQuery]) {
            expect(query.where).toEqual({
                tenantId: 'tenant-a',
                supplierId: 'supplier-a',
                status: 'POSTED',
                type: 'RETURN',
            });
        }
        const recentApplicationQuery = vi.mocked(database.supplierCreditApplication.findMany).mock.calls[0][0] as any;
        const applicationAggregateQuery = vi.mocked(database.supplierCreditApplication.aggregate).mock.calls[0][0] as any;
        for (const query of [recentApplicationQuery, applicationAggregateQuery]) {
            expect(query.where).toEqual({
                tenantId: 'tenant-a',
                supplierId: 'supplier-a',
                creditNote: { status: 'POSTED', type: 'RETURN' },
                purchase: { documentStatus: 'POSTED' },
            });
        }

        const queries = [
            ...vi.mocked(database.supplierContact.findMany).mock.calls,
            ...vi.mocked(database.supplierDocument.findMany).mock.calls,
            ...vi.mocked(database.purchase.findMany).mock.calls,
            ...vi.mocked(database.supplierPayment.findMany).mock.calls,
            ...vi.mocked(database.supplierReturn.findMany).mock.calls,
            ...vi.mocked(database.supplierCreditNote.findMany).mock.calls,
            ...vi.mocked(database.supplierCreditApplication.findMany).mock.calls,
        ];
        expect(queries.every(([args]: any[]) => Number.isInteger(args.take) && args.take > 0)).toBe(true);
    });

    it('separa créditos aplicados de pagos y conserva el fallback histórico', () => {
        expect(calculateSupplierSettlementTotals({
            totalCreditPurchased: '100',
            outstandingBalance: '0',
            recordedPaymentAmount: '30',
            totalCreditApplied: '70',
        })).toEqual({
            totalPaid: '30.0000',
            legacyPaidAmount: '0.0000',
            unappliedCredit: '0.0000',
        });

        expect(calculateSupplierSettlementTotals({
            totalCreditPurchased: '100',
            outstandingBalance: '0',
            recordedPaymentAmount: '0',
            totalCreditApplied: '0',
        })).toEqual({
            totalPaid: '100.0000',
            legacyPaidAmount: '100.0000',
            unappliedCredit: '0.0000',
        });
    });

    it('solo incluye storageKey para administración', async () => {
        const database = fakeDatabase();
        configureDetail(database);
        const service = createSupplierService(database);

        const result = await service.detail('tenant-a', 'supplier-a', 'ADMIN');

        const query = vi.mocked(database.supplierDocument.findMany).mock.calls[0][0] as any;
        expect(query.select.storageKey).toBe(true);
        expect(result.documents[0].storageKey).toContain('tenants/tenant-a/');
    });

    it('mantiene Supplier 360 active-only sin convertirlo en gate de NC histórica', async () => {
        const database = fakeDatabase();
        vi.mocked(database.supplier.findFirst).mockResolvedValue(null);
        const service = createSupplierService(database);

        await expect(service.detail('tenant-a', 'supplier-archived', 'ACCOUNTANT'))
            .rejects.toMatchObject({ status: 404, code: 'SUPPLIER_NOT_FOUND' });
        expect(database.supplierCreditNote.findMany).not.toHaveBeenCalled();
        expect(database.supplierCreditApplication.findMany).not.toHaveBeenCalled();
    });

    it('falla cerrado si una compra PARTIALLY_PAID perdió su balanceDue', async () => {
        const database = fakeDatabase();
        configureDetail(database);
        vi.mocked(database.purchase.aggregate).mockReset()
            .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { total: '100' } })
            .mockResolvedValueOnce({ _sum: { total: '100' } })
            .mockResolvedValueOnce({ _sum: { balanceDue: null } })
            .mockResolvedValueOnce({ _sum: { total: null } })
            .mockResolvedValueOnce({ _count: { id: 1 } })
            .mockResolvedValueOnce({ _count: { id: 0 } });
        const service = createSupplierService(database);

        await expect(service.detail('tenant-a', 'supplier-a', 'ACCOUNTANT')).rejects.toMatchObject({
            status: 500,
            code: 'SUPPLIER_BALANCE_INCONSISTENT',
        });
    });

    it('falla cerrado si una compra POSTED tiene balanceDue negativo', async () => {
        const database = fakeDatabase();
        configureDetail(database);
        vi.mocked(database.purchase.aggregate).mockReset()
            .mockResolvedValueOnce({ _count: { id: 1 }, _sum: { total: '100' } })
            .mockResolvedValueOnce({ _sum: { total: '100' } })
            .mockResolvedValueOnce({ _sum: { balanceDue: '-5' } })
            .mockResolvedValueOnce({ _sum: { total: null } })
            .mockResolvedValueOnce({ _count: { id: 0 } })
            .mockResolvedValueOnce({ _count: { id: 1 } });
        const service = createSupplierService(database);

        await expect(service.detail('tenant-a', 'supplier-a', 'ACCOUNTANT')).rejects.toMatchObject({
            status: 500,
            code: 'SUPPLIER_BALANCE_INCONSISTENT',
        });
        expect(vi.mocked(database.purchase.aggregate).mock.calls[5][0]).toMatchObject({
            where: {
                tenantId: 'tenant-a',
                supplierId: 'supplier-a',
                documentStatus: 'POSTED',
                paymentMethod: 'CREDIT',
                balanceDue: { lt: 0 },
            },
        });
    });

    it('archiva por tenant y audita before/after sin PII cruda', async () => {
        const database = fakeDatabase();
        vi.mocked(database.supplier.findFirst).mockResolvedValue(supplier);
        vi.mocked(database.supplier.updateMany).mockResolvedValue({ count: 1 });
        vi.mocked(database.auditLog.create).mockResolvedValue({});
        const service = createSupplierService(database);

        await service.softDelete('tenant-a', 'user-a', 'supplier-a');

        expect(database.supplier.updateMany).toHaveBeenCalledWith({
            where: { id: 'supplier-a', tenantId: 'tenant-a', deletedAt: null },
            data: { deletedAt: expect.any(Date) },
        });
        const audit = vi.mocked(database.auditLog.create).mock.calls[0][0] as any;
        expect(audit.data.tenantId).toBe('tenant-a');
        expect(audit.data.userId).toBe('user-a');
        expect(audit.data.action).toBe('SUPPLIER_SOFT_DELETED');
        const details = JSON.parse(audit.data.details);
        expect(details.before.deleted).toBe(false);
        expect(details.after.deleted).toBe(true);
        expect(audit.data.details).not.toContain('RUC-SECRETO-123');
        expect(audit.data.details).not.toContain('privado@example.test');
        expect(audit.data.details).not.toContain('8888-0000');
        expect(database.supplier.delete).not.toHaveBeenCalled();
    });

    it('encierra storageKey en el tenant autenticado y no acepta tenant del payload', async () => {
        const database = fakeDatabase();
        vi.mocked(database.supplier.findFirst).mockResolvedValue(supplier);
        vi.mocked(database.supplierDocument.create).mockImplementation(async (args: any) => ({
            id: 'doc-a',
            ...args.data,
            createdAt: supplier.createdAt,
            updatedAt: supplier.updatedAt,
        }));
        vi.mocked(database.auditLog.create).mockResolvedValue({});
        const service = createSupplierService(database);

        const result = await service.createDocument('tenant-a', 'user-a', 'supplier-a', {
            kind: 'CONTRACT',
            fileName: 'contrato.pdf',
            storageKey: 'documento-a.pdf',
        });

        const create = vi.mocked(database.supplierDocument.create).mock.calls[0][0] as any;
        expect(create.data.tenantId).toBe('tenant-a');
        expect(create.data.supplierId).toBe('supplier-a');
        expect(create.data.storageKey).toBe(
            'tenants/tenant-a/suppliers/supplier-a/documento-a.pdf',
        );
        expect(result.storageKey).toBe(create.data.storageKey);
    });

    it('serializa el cambio de contacto primario con lock tenant-scoped', async () => {
        const database = fakeDatabase();
        vi.mocked(database.supplier.findFirst).mockResolvedValue(supplier);
        vi.mocked(database.$queryRaw).mockResolvedValue([{ id: 'supplier-a' }]);
        vi.mocked(database.supplierContact.updateMany).mockResolvedValue({ count: 1 });
        vi.mocked(database.supplierContact.create).mockResolvedValue({
            id: 'contact-a',
            supplierId: 'supplier-a',
            name: 'Primario',
            isPrimary: true,
            createdAt: supplier.createdAt,
            updatedAt: supplier.updatedAt,
        });
        vi.mocked(database.auditLog.create).mockResolvedValue({});
        const service = createSupplierService(database);

        await service.createContact('tenant-a', 'user-a', 'supplier-a', {
            name: 'Primario',
            isPrimary: true,
        });

        expect(database.$queryRaw).toHaveBeenCalledOnce();
        const lockQuery = vi.mocked(database.$queryRaw).mock.calls[0][0] as { values: unknown[] };
        expect(lockQuery.values).toEqual(['supplier-a', 'tenant-a']);
        expect(database.supplierContact.updateMany).toHaveBeenCalledWith({
            where: { tenantId: 'tenant-a', supplierId: 'supplier-a', isPrimary: true },
            data: { isPrimary: false },
        });
    });
});
