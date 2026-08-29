import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import type {
    CreateSupplierContactInput,
    CreateSupplierDocumentInput,
    CreateSupplierInput,
    SupplierListQuery,
    UpdateSupplierContactInput,
    UpdateSupplierInput,
} from '../validation/supplierSchemas.js';
import { SUPPLIER_ADMIN_ROLES } from '../validation/supplierSchemas.js';

type Delegate = {
    findFirst(args: unknown): Promise<any>;
    findMany(args: unknown): Promise<any[]>;
    create(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
    updateMany(args: unknown): Promise<{ count: number }>;
    delete(args: unknown): Promise<any>;
    deleteMany(args: unknown): Promise<{ count: number }>;
    aggregate(args: unknown): Promise<any>;
};

type AuditDelegate = Pick<Delegate, 'create'>;

export interface SupplierDatabase {
    supplier: Delegate;
    supplierContact: Delegate;
    supplierDocument: Delegate;
    supplierPayment: Delegate;
    supplierReturn: Delegate;
    supplierCreditNote: Delegate;
    supplierCreditApplication: Delegate;
    purchase: Delegate;
    auditLog: AuditDelegate;
    $transaction<T>(callback: (tx: SupplierDatabase) => Promise<T>): Promise<T>;
    $queryRaw<T = unknown>(query: unknown): Promise<T>;
}

const db = prisma as unknown as SupplierDatabase;

export class SupplierServiceError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly code: string,
    ) {
        super(message);
        this.name = 'SupplierServiceError';
    }
}

const notFound = () => new SupplierServiceError(404, 'Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');

function money(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return new Decimal(String(value)).toFixed(4);
}

export interface SupplierSettlementTotalsInput {
    totalCreditPurchased: Decimal.Value;
    outstandingBalance: Decimal.Value;
    recordedPaymentAmount: Decimal.Value;
    totalCreditApplied: Decimal.Value;
}

/**
 * Separa las dos formas de liquidar CxP: dinero pagado y notas aplicadas.
 * El saldo materializado sigue siendo autoritativo, mientras que la resta del
 * subledger de créditos evita presentar una aplicación como si fuera un pago.
 * Las compras históricas COMPLETED sin SupplierPayment conservan el fallback
 * explícito en legacyPaidAmount.
 */
export function calculateSupplierSettlementTotals(input: SupplierSettlementTotalsInput) {
    const totalCreditPurchased = new Decimal(input.totalCreditPurchased);
    const outstandingBalance = new Decimal(input.outstandingBalance);
    const recordedPaymentAmount = new Decimal(input.recordedPaymentAmount);
    const totalCreditApplied = new Decimal(input.totalCreditApplied);
    const totalPaid = Decimal.max(
        totalCreditPurchased.minus(outstandingBalance).minus(totalCreditApplied),
        0,
    );

    return {
        totalPaid: totalPaid.toFixed(4),
        legacyPaidAmount: Decimal.max(totalPaid.minus(recordedPaymentAmount), 0).toFixed(4),
        unappliedCredit: Decimal.max(recordedPaymentAmount.minus(totalPaid), 0).toFixed(4),
    };
}

function safeSupplierDto(supplier: any) {
    return {
        id: supplier.id,
        name: supplier.name,
        ruc: supplier.ruc ?? null,
        contactName: supplier.contactName ?? null,
        phone: supplier.phone ?? null,
        email: supplier.email ?? null,
        address: supplier.address ?? null,
        category: supplier.category ?? null,
        status: supplier.status,
        legalType: supplier.legalType ?? null,
        fiscalCategory: supplier.fiscalCategory ?? null,
        currency: supplier.currency,
        paymentTermsDays: supplier.paymentTermsDays ?? null,
        creditLimit: money(supplier.creditLimit),
        leadTimeDays: supplier.leadTimeDays ?? null,
        minimumOrderAmount: money(supplier.minimumOrderAmount),
        notes: supplier.notes ?? null,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
    };
}

function safeContactDto(contact: any) {
    return {
        id: contact.id,
        supplierId: contact.supplierId,
        name: contact.name,
        title: contact.title ?? null,
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        isPrimary: Boolean(contact.isPrimary),
        notes: contact.notes ?? null,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
    };
}

function safeDocumentDto(document: any, canSeeStorageKey: boolean) {
    return {
        id: document.id,
        supplierId: document.supplierId,
        kind: document.kind,
        fileName: document.fileName,
        ...(canSeeStorageKey ? { storageKey: document.storageKey } : {}),
        mimeType: document.mimeType ?? null,
        sizeBytes: document.sizeBytes ?? null,
        sha256: document.sha256 ?? null,
        expiresAt: document.expiresAt ?? null,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
    };
}

function supplierAuditSnapshot(supplier: any) {
    return {
        status: supplier.status ?? null,
        legalType: supplier.legalType ?? null,
        fiscalCategory: supplier.fiscalCategory ?? null,
        currency: supplier.currency ?? null,
        paymentTermsDays: supplier.paymentTermsDays ?? null,
        leadTimeDays: supplier.leadTimeDays ?? null,
        hasCreditLimit: supplier.creditLimit !== null && supplier.creditLimit !== undefined,
        hasMinimumOrderAmount: supplier.minimumOrderAmount !== null
            && supplier.minimumOrderAmount !== undefined,
        hasName: Boolean(supplier.name),
        hasRuc: Boolean(supplier.ruc),
        hasContactName: Boolean(supplier.contactName),
        hasPhone: Boolean(supplier.phone),
        hasEmail: Boolean(supplier.email),
        hasAddress: Boolean(supplier.address),
        hasNotes: Boolean(supplier.notes),
        deleted: supplier.deletedAt !== null && supplier.deletedAt !== undefined,
    };
}

function contactAuditSnapshot(contact: any) {
    return {
        isPrimary: Boolean(contact.isPrimary),
        hasTitle: Boolean(contact.title),
        hasPhone: Boolean(contact.phone),
        hasEmail: Boolean(contact.email),
        hasNotes: Boolean(contact.notes),
    };
}

function documentAuditSnapshot(document: any) {
    return {
        kind: document.kind,
        mimeType: document.mimeType ?? null,
        sizeBytes: document.sizeBytes ?? null,
        hasSha256: Boolean(document.sha256),
        hasExpiry: Boolean(document.expiresAt),
    };
}

function auditDetails(
    entityId: string,
    before: unknown,
    after: unknown,
    changedFields?: string[],
) {
    return JSON.stringify({
        supplierId: entityId,
        before,
        after,
        ...(changedFields ? { changedFields: [...changedFields].sort() } : {}),
    });
}

function isAdmin(role: string): boolean {
    return SUPPLIER_ADMIN_ROLES.includes(role as typeof SUPPLIER_ADMIN_ROLES[number]);
}

function canonicalStorageKey(tenantId: string, supplierId: string, requestedKey: string): string {
    // El caller aporta solamente un identificador relativo. La frontera del
    // servidor lo encierra en el namespace del tenant/proveedor autenticado.
    const key = `tenants/${tenantId}/suppliers/${supplierId}/${requestedKey}`;
    if (key.length > 512) {
        throw new SupplierServiceError(400, 'storageKey privado demasiado largo', 'INVALID_STORAGE_KEY');
    }
    return key;
}

function supplierCreateData(tenantId: string, input: CreateSupplierInput) {
    return {
        tenantId,
        name: input.name,
        ...(input.ruc !== undefined ? { ruc: input.ruc } : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.legalType !== undefined ? { legalType: input.legalType } : {}),
        ...(input.fiscalCategory !== undefined ? { fiscalCategory: input.fiscalCategory } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.paymentTermsDays !== undefined ? { paymentTermsDays: input.paymentTermsDays } : {}),
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
        ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
        ...(input.minimumOrderAmount !== undefined
            ? { minimumOrderAmount: input.minimumOrderAmount }
            : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
}

function supplierUpdateData(input: UpdateSupplierInput) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function requireActiveSupplier(database: SupplierDatabase, tenantId: string, supplierId: string) {
    const supplier = await database.supplier.findFirst({
        where: { id: supplierId, tenantId, deletedAt: null },
    });
    if (!supplier) throw notFound();
    return supplier;
}

async function lockActiveSupplier(database: SupplierDatabase, tenantId: string, supplierId: string) {
    const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM Supplier
        WHERE id = ${supplierId}
          AND tenantId = ${tenantId}
          AND deletedAt IS NULL
        FOR UPDATE
    `);
    if (rows.length !== 1) throw notFound();
}

export function createSupplierService(database: SupplierDatabase = db) {
    return {
        async list(tenantId: string, query: SupplierListQuery) {
            const search = query.search?.trim();
            const suppliers = await database.supplier.findMany({
                where: {
                    tenantId,
                    deletedAt: null,
                    ...(query.status !== 'ALL' ? { status: query.status } : {}),
                    ...(search ? {
                        OR: [
                            { name: { contains: search } },
                            { ruc: { contains: search } },
                            { phone: { contains: search } },
                            { email: { contains: search } },
                            { category: { contains: search } },
                        ],
                    } : {}),
                },
                orderBy: { name: 'asc' },
                take: query.limit,
            });
            return suppliers.map(safeSupplierDto);
        },

        async detail(tenantId: string, supplierId: string, role: string) {
            // Supplier 360 conserva el contrato de directorio activo. Esto no
            // bloquea ajustes históricos: el comando financiero de NC resuelve
            // supplierId por tenant sin exigir deletedAt = NULL.
            const supplier = await requireActiveSupplier(database, tenantId, supplierId);
            const canSeeStorageKey = isAdmin(role);
            const documentSelect = {
                id: true,
                supplierId: true,
                kind: true,
                fileName: true,
                ...(canSeeStorageKey ? { storageKey: true } : {}),
                mimeType: true,
                sizeBytes: true,
                sha256: true,
                expiresAt: true,
                createdAt: true,
                updatedAt: true,
            };

            const [
                contacts,
                documents,
                recentPurchases,
                recentPayments,
                recentReturns,
                recentCreditNotes,
                recentCreditApplications,
                purchaseTotals,
                creditTotals,
                balanceDueTotals,
                legacyPendingTotals,
                inconsistentPartialTotals,
                negativeBalanceTotals,
                paymentTotals,
                returnTotals,
                creditNoteTotals,
                creditApplicationTotals,
            ] = await Promise.all([
                database.supplierContact.findMany({
                    where: { tenantId, supplierId },
                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                    take: 100,
                }),
                database.supplierDocument.findMany({
                    where: { tenantId, supplierId },
                    select: documentSelect,
                    orderBy: { createdAt: 'desc' },
                    take: 100,
                }),
                database.purchase.findMany({
                    where: { tenantId, supplierId, documentStatus: 'POSTED' },
                    select: {
                        id: true,
                        invoiceNumber: true,
                        date: true,
                        dueDate: true,
                        total: true,
                        balanceDue: true,
                        status: true,
                        paymentMethod: true,
                    },
                    orderBy: { date: 'desc' },
                    take: 12,
                }),
                database.supplierPayment.findMany({
                    where: {
                        tenantId,
                        supplierId,
                        purchase: { documentStatus: 'POSTED' },
                    },
                    select: {
                        id: true,
                        purchaseId: true,
                        amount: true,
                        method: true,
                        paidAt: true,
                        createdAt: true,
                    },
                    orderBy: { paidAt: 'desc' },
                    take: 12,
                }),
                database.supplierReturn.findMany({
                    where: { tenantId, supplierId, status: 'POSTED' },
                    select: {
                        id: true,
                        returnNumber: true,
                        status: true,
                        reasonCode: true,
                        reason: true,
                        supplierReference: true,
                        batchLedgerMode: true,
                        returnedAt: true,
                        createdAt: true,
                    },
                    orderBy: { returnedAt: 'desc' },
                    take: 12,
                }),
                database.supplierCreditNote.findMany({
                    where: { tenantId, supplierId, status: 'POSTED', type: 'RETURN' },
                    select: {
                        id: true,
                        creditNoteNumber: true,
                        type: true,
                        status: true,
                        creditNoteDate: true,
                        devolutionDate: true,
                        postingDate: true,
                        currencyAtIssue: true,
                        total: true,
                        creditableTax: true,
                        remainingCredit: true,
                        createdAt: true,
                    },
                    orderBy: { creditNoteDate: 'desc' },
                    take: 12,
                }),
                database.supplierCreditApplication.findMany({
                    where: {
                        tenantId,
                        supplierId,
                        creditNote: { status: 'POSTED', type: 'RETURN' },
                        purchase: { documentStatus: 'POSTED' },
                    },
                    select: {
                        id: true,
                        creditNoteId: true,
                        purchaseId: true,
                        amount: true,
                        appliedAt: true,
                        createdAt: true,
                    },
                    orderBy: { appliedAt: 'desc' },
                    take: 12,
                }),
                database.purchase.aggregate({
                    where: { tenantId, supplierId, documentStatus: 'POSTED' },
                    _count: { id: true },
                    _sum: { total: true },
                }),
                database.purchase.aggregate({
                    where: {
                        tenantId,
                        supplierId,
                        documentStatus: 'POSTED',
                        paymentMethod: 'CREDIT',
                    },
                    _sum: { total: true },
                }),
                database.purchase.aggregate({
                    where: {
                        tenantId,
                        supplierId,
                        documentStatus: 'POSTED',
                        paymentMethod: 'CREDIT',
                        status: { in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'] },
                        balanceDue: { not: null },
                    },
                    _sum: { balanceDue: true },
                }),
                // Compatibilidad de filas anteriores al subledger: una compra
                // pendiente sin balanceDue conserva como saldo su total. Las
                // CREDIT+COMPLETED históricas nunca reaparecen como deuda.
                database.purchase.aggregate({
                    where: {
                        tenantId,
                        supplierId,
                        documentStatus: 'POSTED',
                        paymentMethod: 'CREDIT',
                        status: 'PENDING_PAYMENT',
                        balanceDue: null,
                    },
                    _sum: { total: true },
                }),
                database.purchase.aggregate({
                    where: {
                        tenantId,
                        supplierId,
                        documentStatus: 'POSTED',
                        paymentMethod: 'CREDIT',
                        status: 'PARTIALLY_PAID',
                        balanceDue: null,
                    },
                    _count: { id: true },
                }),
                database.purchase.aggregate({
                    where: {
                        tenantId,
                        supplierId,
                        documentStatus: 'POSTED',
                        paymentMethod: 'CREDIT',
                        balanceDue: { lt: 0 },
                    },
                    _count: { id: true },
                }),
                database.supplierPayment.aggregate({
                    where: {
                        tenantId,
                        supplierId,
                        purchase: { documentStatus: 'POSTED' },
                    },
                    _count: { id: true },
                    _sum: { amount: true },
                }),
                database.supplierReturn.aggregate({
                    where: { tenantId, supplierId, status: 'POSTED' },
                    _count: { id: true },
                }),
                database.supplierCreditNote.aggregate({
                    where: { tenantId, supplierId, status: 'POSTED', type: 'RETURN' },
                    _count: { id: true },
                    _sum: { total: true },
                }),
                database.supplierCreditApplication.aggregate({
                    where: {
                        tenantId,
                        supplierId,
                        creditNote: { status: 'POSTED', type: 'RETURN' },
                        purchase: { documentStatus: 'POSTED' },
                    },
                    _count: { id: true },
                    _sum: { amount: true },
                }),
            ]);

            if (inconsistentPartialTotals._count.id > 0 || negativeBalanceTotals._count.id > 0) {
                throw new SupplierServiceError(
                    500,
                    'El saldo del proveedor requiere conciliación',
                    'SUPPLIER_BALANCE_INCONSISTENT',
                );
            }

            const totalPurchased = new Decimal(String(purchaseTotals._sum.total ?? 0));
            const totalCreditPurchased = new Decimal(String(creditTotals._sum.total ?? 0));
            const recordedPaymentAmount = new Decimal(String(paymentTotals._sum.amount ?? 0));
            const totalCreditNotes = new Decimal(String(creditNoteTotals._sum.total ?? 0));
            const totalCreditApplied = new Decimal(String(creditApplicationTotals._sum.amount ?? 0));
            const outstandingBalance = new Decimal(String(balanceDueTotals._sum.balanceDue ?? 0))
                .plus(String(legacyPendingTotals._sum.total ?? 0));
            // CREDIT+COMPLETED históricas no tienen filas SupplierPayment, pero
            // sí representan obligaciones liquidadas. El pago se deriva del
            // saldo autoritativo menos el subledger real de créditos, para que
            // ninguna aplicación de NC aparezca como dinero pagado.
            const settlementTotals = calculateSupplierSettlementTotals({
                totalCreditPurchased,
                outstandingBalance,
                recordedPaymentAmount,
                totalCreditApplied,
            });

            return {
                supplier: safeSupplierDto(supplier),
                contacts: contacts.map(safeContactDto),
                documents: documents.map((document) => safeDocumentDto(document, canSeeStorageKey)),
                recentPurchases: recentPurchases.map((purchase) => ({
                    ...purchase,
                    total: money(purchase.total),
                    balanceDue: money(purchase.balanceDue),
                })),
                recentPayments: recentPayments.map((payment) => ({
                    ...payment,
                    amount: money(payment.amount),
                })),
                recentReturns,
                recentCreditNotes: recentCreditNotes.map((creditNote) => ({
                    ...creditNote,
                    total: money(creditNote.total),
                    creditableTax: money(creditNote.creditableTax),
                    remainingCredit: money(creditNote.remainingCredit),
                })),
                recentCreditApplications: recentCreditApplications.map((application) => ({
                    ...application,
                    amount: money(application.amount),
                })),
                aggregates: {
                    purchaseCount: purchaseTotals._count.id,
                    paymentCount: paymentTotals._count.id,
                    returnCount: returnTotals._count.id,
                    creditNoteCount: creditNoteTotals._count.id,
                    creditApplicationCount: creditApplicationTotals._count.id,
                    totalPurchased: totalPurchased.toFixed(4),
                    totalCreditPurchased: totalCreditPurchased.toFixed(4),
                    totalPaid: settlementTotals.totalPaid,
                    recordedPaymentAmount: recordedPaymentAmount.toFixed(4),
                    legacyPaidAmount: settlementTotals.legacyPaidAmount,
                    outstandingBalance: outstandingBalance.toFixed(4),
                    unappliedCredit: settlementTotals.unappliedCredit,
                    totalCreditNotes: totalCreditNotes.toFixed(4),
                    totalCreditApplied: totalCreditApplied.toFixed(4),
                },
            };
        },

        async create(tenantId: string, userId: string, input: CreateSupplierInput) {
            return database.$transaction(async (tx) => {
                const created = await tx.supplier.create({
                    data: supplierCreateData(tenantId, input),
                });
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_CREATED',
                        details: auditDetails(created.id, null, supplierAuditSnapshot(created)),
                    },
                });
                return safeSupplierDto(created);
            });
        },

        async update(tenantId: string, userId: string, supplierId: string, input: UpdateSupplierInput) {
            return database.$transaction(async (tx) => {
                const existing = await requireActiveSupplier(tx, tenantId, supplierId);
                const result = await tx.supplier.updateMany({
                    where: { id: supplierId, tenantId, deletedAt: null },
                    data: supplierUpdateData(input),
                });
                if (result.count !== 1) throw notFound();
                const updated = await requireActiveSupplier(tx, tenantId, supplierId);
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_UPDATED',
                        details: auditDetails(
                            supplierId,
                            supplierAuditSnapshot(existing),
                            supplierAuditSnapshot(updated),
                            Object.keys(input),
                        ),
                    },
                });
                return safeSupplierDto(updated);
            });
        },

        async softDelete(tenantId: string, userId: string, supplierId: string) {
            return database.$transaction(async (tx) => {
                const existing = await requireActiveSupplier(tx, tenantId, supplierId);
                const deletedAt = new Date();
                const result = await tx.supplier.updateMany({
                    where: { id: supplierId, tenantId, deletedAt: null },
                    data: { deletedAt },
                });
                if (result.count !== 1) throw notFound();
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_SOFT_DELETED',
                        details: auditDetails(
                            supplierId,
                            supplierAuditSnapshot(existing),
                            { ...supplierAuditSnapshot(existing), deleted: true },
                        ),
                    },
                });
                return { id: supplierId, deletedAt };
            });
        },

        async createContact(
            tenantId: string,
            userId: string,
            supplierId: string,
            input: CreateSupplierContactInput,
        ) {
            return database.$transaction(async (tx) => {
                await requireActiveSupplier(tx, tenantId, supplierId);
                if (input.isPrimary) {
                    await lockActiveSupplier(tx, tenantId, supplierId);
                    await tx.supplierContact.updateMany({
                        where: { tenantId, supplierId, isPrimary: true },
                        data: { isPrimary: false },
                    });
                }
                const created = await tx.supplierContact.create({
                    data: { tenantId, supplierId, createdBy: userId, ...input },
                });
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_CONTACT_CREATED',
                        details: JSON.stringify({
                            supplierId,
                            contactId: created.id,
                            before: null,
                            after: contactAuditSnapshot(created),
                        }),
                    },
                });
                return safeContactDto(created);
            });
        },

        async updateContact(
            tenantId: string,
            userId: string,
            supplierId: string,
            contactId: string,
            input: UpdateSupplierContactInput,
        ) {
            return database.$transaction(async (tx) => {
                await requireActiveSupplier(tx, tenantId, supplierId);
                if (input.isPrimary) {
                    await lockActiveSupplier(tx, tenantId, supplierId);
                }
                const existing = await tx.supplierContact.findFirst({
                    where: { id: contactId, tenantId, supplierId },
                });
                if (!existing) {
                    throw new SupplierServiceError(404, 'Contacto no encontrado', 'SUPPLIER_CONTACT_NOT_FOUND');
                }
                if (input.isPrimary) {
                    await tx.supplierContact.updateMany({
                        where: { tenantId, supplierId, isPrimary: true, id: { not: contactId } },
                        data: { isPrimary: false },
                    });
                }
                const result = await tx.supplierContact.updateMany({
                    where: { id: contactId, tenantId, supplierId },
                    data: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
                });
                if (result.count !== 1) {
                    throw new SupplierServiceError(404, 'Contacto no encontrado', 'SUPPLIER_CONTACT_NOT_FOUND');
                }
                const updated = await tx.supplierContact.findFirst({
                    where: { id: contactId, tenantId, supplierId },
                });
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_CONTACT_UPDATED',
                        details: JSON.stringify({
                            supplierId,
                            contactId,
                            before: contactAuditSnapshot(existing),
                            after: contactAuditSnapshot(updated),
                            changedFields: Object.keys(input).sort(),
                        }),
                    },
                });
                return safeContactDto(updated);
            });
        },

        async deleteContact(tenantId: string, userId: string, supplierId: string, contactId: string) {
            return database.$transaction(async (tx) => {
                await requireActiveSupplier(tx, tenantId, supplierId);
                const existing = await tx.supplierContact.findFirst({
                    where: { id: contactId, tenantId, supplierId },
                });
                if (!existing) {
                    throw new SupplierServiceError(404, 'Contacto no encontrado', 'SUPPLIER_CONTACT_NOT_FOUND');
                }
                const result = await tx.supplierContact.deleteMany({
                    where: { id: contactId, tenantId, supplierId },
                });
                if (result.count !== 1) {
                    throw new SupplierServiceError(404, 'Contacto no encontrado', 'SUPPLIER_CONTACT_NOT_FOUND');
                }
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_CONTACT_DELETED',
                        details: JSON.stringify({
                            supplierId,
                            contactId,
                            before: contactAuditSnapshot(existing),
                            after: null,
                        }),
                    },
                });
                return { id: contactId };
            });
        },

        async createDocument(
            tenantId: string,
            userId: string,
            supplierId: string,
            input: CreateSupplierDocumentInput,
        ) {
            return database.$transaction(async (tx) => {
                await requireActiveSupplier(tx, tenantId, supplierId);
                const created = await tx.supplierDocument.create({
                    data: {
                        tenantId,
                        supplierId,
                        kind: input.kind,
                        fileName: input.fileName,
                        storageKey: canonicalStorageKey(tenantId, supplierId, input.storageKey),
                        mimeType: input.mimeType,
                        sizeBytes: input.sizeBytes,
                        sha256: input.sha256,
                        expiresAt: input.expiresAt,
                        uploadedBy: userId,
                    },
                });
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_DOCUMENT_REGISTERED',
                        details: JSON.stringify({
                            supplierId,
                            documentId: created.id,
                            before: null,
                            after: documentAuditSnapshot(created),
                        }),
                    },
                });
                return safeDocumentDto(created, true);
            });
        },

        async deleteDocument(tenantId: string, userId: string, supplierId: string, documentId: string) {
            return database.$transaction(async (tx) => {
                await requireActiveSupplier(tx, tenantId, supplierId);
                const existing = await tx.supplierDocument.findFirst({
                    where: { id: documentId, tenantId, supplierId },
                });
                if (!existing) {
                    throw new SupplierServiceError(404, 'Documento no encontrado', 'SUPPLIER_DOCUMENT_NOT_FOUND');
                }
                const result = await tx.supplierDocument.deleteMany({
                    where: { id: documentId, tenantId, supplierId },
                });
                if (result.count !== 1) {
                    throw new SupplierServiceError(404, 'Documento no encontrado', 'SUPPLIER_DOCUMENT_NOT_FOUND');
                }
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'SUPPLIER_DOCUMENT_METADATA_DELETED',
                        details: JSON.stringify({
                            supplierId,
                            documentId,
                            before: documentAuditSnapshot(existing),
                            after: null,
                        }),
                    },
                });
                return { id: documentId };
            });
        },
    };
}

export const supplierService = createSupplierService();
