import type { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordSupplierCreditNoteMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/services/accounting.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/accounting.js')>()),
    recordSupplierCreditNote: recordSupplierCreditNoteMock,
}));

import { normalizeCalendarDateInput } from '../backend/lib/calendarDate';
import {
    buildSupplierCreditNoteCommandId,
    buildSupplierCreditNotePayloadHash,
    normalizeSupplierCreditNoteRequest,
    planSupplierCreditNotePosting,
    serializeSupplierCreditNoteStoredResult,
    SupplierCreditNoteError,
    type SupplierCreditNoteCommandInput,
    type SupplierCreditPurchaseSnapshot,
    type SupplierCreditReturnItemSnapshot,
} from '../backend/lib/supplierCreditNotes';
import {
    buildSupplierCreditNoteResultAuditId,
    executeSupplierCreditNote,
    executeSupplierCreditNoteTransaction,
    SupplierCreditNoteServiceError,
    type SupplierCreditNoteRequest,
} from '../backend/services/supplierCreditNoteService';

const NOW = new Date('2026-08-28T16:30:00.000Z');
const CREATED_AT = new Date('2026-08-28T16:30:01.000Z');
const EVENT_ID = '018f2f89-6f3f-7ca1-8a00-123456789abc';

const requestInput = (overrides: Partial<SupplierCreditNoteRequest> = {}): SupplierCreditNoteRequest => ({
    clientEventId: EVENT_ID.toUpperCase(),
    creditNoteNumber: ' NC-001 ',
    invoiceDate: '2026-08-01',
    creditNoteDate: '2026-08-28',
    devolutionDate: '2026-08-20',
    postingDate: '2026-08-28',
    reason: ' Mercadería devuelta ',
    supplierReference: ' PROV-NC-1 ',
    subtotal: '18',
    tax: '2.70',
    creditableTax: '2.7',
    total: '20.70',
    lines: [
        {
            supplierReturnItemId: 'return-item-2',
            quantity: '1',
            subtotal: '8',
            tax: '1.20',
            creditableTax: '1.20',
            total: '9.20',
        },
        {
            supplierReturnItemId: 'return-item-1',
            quantity: '1.0000',
            subtotal: '10',
            tax: '1.5',
            creditableTax: '1.50',
            total: '11.50',
        },
    ],
    applications: [{ purchaseId: 'purchase-1', amount: '20.7' }],
    ...overrides,
});

const returnItemSnapshot = (
    overrides: Partial<SupplierCreditReturnItemSnapshot> = {},
): SupplierCreditReturnItemSnapshot => ({
    supplierReturnItemId: 'return-item-1',
    supplierReturnId: 'return-1',
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    returnStatus: 'POSTED',
    devolutionDateManagua: '2026-08-18',
    sourceHash: 'a'.repeat(64),
    sourceType: 'DIRECT_PURCHASE_ITEM',
    goodsReceiptItemId: null,
    quantityExact: '1.0000',
    bookUnitCostExact: '7.005000',
    bookValueExact: '7.0050',
    productNameAtReturn: 'Carne de res',
    unitAtReturn: 'LB',
    sourcePurchaseId: 'purchase-1',
    sourcePurchaseItemId: 'purchase-item-1',
    purchaseMatchAllocationId: null,
    alreadyCredited: false,
    originalQtyExact: '2.0000',
    originalSubtotal: '20.00',
    originalTax: '3.00',
    originalCreditableTax: '3.00',
    creditedQtyExact: '0.0000',
    creditedSubtotal: '0.00',
    creditedTax: '0.00',
    creditedCreditableTax: '0.00',
    ...overrides,
});

const planFixture = () => {
    const request = normalizeSupplierCreditNoteRequest({
        ...requestInput(),
        tenantId: 'tenant-1',
        userId: 'user-1',
        supplierId: 'supplier-1',
        fiscalRegimeAtCredit: 'GENERAL',
        currencyAtIssue: 'NIO',
    } as SupplierCreditNoteCommandInput);
    const returnItems = [
        returnItemSnapshot(),
        returnItemSnapshot({
            supplierReturnItemId: 'return-item-2',
            supplierReturnId: 'return-2',
            devolutionDateManagua: '2026-08-20',
            sourceHash: 'b'.repeat(64),
            sourceType: 'PURCHASE_MATCH_ALLOCATION',
            bookUnitCostExact: '6.004000',
            bookValueExact: '6.0040',
            productNameAtReturn: 'Pollo entero',
            unitAtReturn: 'UND',
            sourcePurchaseItemId: 'purchase-item-2',
            purchaseMatchAllocationId: 'match-2',
            originalSubtotal: '16.00',
            originalTax: '2.40',
            originalCreditableTax: '2.40',
        }),
    ];
    const purchases: SupplierCreditPurchaseSnapshot[] = [{
        purchaseId: 'purchase-1',
        tenantId: 'tenant-1',
        supplierId: 'supplier-1',
        paymentMethod: 'CREDIT',
        documentStatus: 'POSTED',
        invoiceDateManagua: '2026-08-01',
        fiscalRegimeAtPurchase: 'GENERAL',
        balanceDue: '20.7000',
        retentionAdjustmentRequired: false,
    }];
    return planSupplierCreditNotePosting({
        request,
        returnItems,
        purchases,
        fiscalPeriodOpen: true,
        retentionAdjustmentRequired: false,
        fiscalRegimeAtPosting: 'GENERAL',
    });
};

const persistedCreditNote = () => {
    const plan = planFixture();
    return {
        id: 'credit-note-existing',
        tenantId: 'tenant-1',
        supplierId: 'supplier-1',
        creditNoteNumber: plan.command.creditNoteNumber,
        type: 'RETURN',
        status: 'POSTED',
        invoiceDate: normalizeCalendarDateInput(plan.command.invoiceDate),
        creditNoteDate: normalizeCalendarDateInput(plan.command.creditNoteDate),
        devolutionDate: normalizeCalendarDateInput(plan.command.devolutionDate),
        postingDate: normalizeCalendarDateInput(plan.command.postingDate),
        fiscalRegimeAtCredit: plan.command.fiscalRegimeAtCredit,
        currencyAtIssue: plan.command.currencyAtIssue,
        subtotal: new Decimal(plan.command.subtotal),
        tax: new Decimal(plan.command.tax),
        creditableTax: new Decimal(plan.command.creditableTax),
        total: new Decimal(plan.command.total),
        inventoryReversalExact: new Decimal(plan.command.inventoryReversalExact),
        priceVarianceReversalExact: new Decimal(plan.command.priceVarianceReversalExact),
        remainingCredit: new Decimal(plan.command.remainingCredit),
        reason: plan.command.reason,
        supplierReference: plan.command.supplierReference,
        clientEventId: plan.command.clientEventId,
        payloadVersion: 1,
        payloadHash: buildSupplierCreditNotePayloadHash(plan.command),
        createdBy: 'user-1',
        createdAt: CREATED_AT,
        applications: plan.command.applications.map((application) => ({
            id: `application-${application.purchaseId}`,
            purchaseId: application.purchaseId,
            amount: new Decimal(application.amount),
        })),
        lines: plan.command.lines.map((line) => ({
            supplierReturnItemId: line.supplierReturnItemId,
            sourcePurchaseItemId: line.sourcePurchaseItemId,
            purchaseMatchAllocationId: line.purchaseMatchAllocationId,
            sourceHash: line.sourceHash,
            quantityExact: new Decimal(line.quantity),
            bookUnitCostExact: new Decimal(line.bookUnitCostExact),
            bookValueExact: new Decimal(line.bookValueExact),
            subtotal: new Decimal(line.subtotal),
            tax: new Decimal(line.tax),
            creditableTax: new Decimal(line.creditableTax),
            total: new Decimal(line.total),
            inventoryReversalExact: new Decimal(line.inventoryReversalExact),
            priceVarianceReversalExact: new Decimal(line.priceVarianceReversalExact),
            descriptionAtCredit: line.descriptionAtCredit,
            unitAtCredit: line.unitAtCredit,
            sourcePurchaseItem: line.sourcePurchaseItemId ? { purchaseId: line.sourcePurchaseId } : null,
            purchaseMatchAllocation: line.purchaseMatchAllocationId
                ? { purchaseItem: { purchaseId: line.sourcePurchaseId } }
                : null,
            supplierReturnItem: {
                supplierReturnId: line.supplierReturnId,
                sourceType: line.sourceType,
                goodsReceiptItemId: line.goodsReceiptItemId,
                sourceHash: line.sourceHash,
            },
        })),
    };
};

const persistedAudit = () => {
    const plan = planFixture();
    const stored = serializeSupplierCreditNoteStoredResult({
        version: 1,
        commandType: 'SUPPLIER_CREDIT_NOTE_POST',
        commandId: buildSupplierCreditNoteCommandId(plan.command),
        payloadHash: buildSupplierCreditNotePayloadHash(plan.command),
        response: {
            supplierCreditNoteId: 'credit-note-existing',
            creditNoteNumber: plan.command.creditNoteNumber,
            supplierId: plan.command.supplierId,
            status: 'POSTED',
            total: plan.command.total,
            remainingCredit: '0.00',
            returnItemIds: plan.command.lines.map((line) => line.supplierReturnItemId),
            applications: plan.command.applications,
        },
    });
    return {
        id: buildSupplierCreditNoteResultAuditId({
            tenantId: 'tenant-1',
            clientEventId: plan.command.clientEventId,
        }),
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'SUPPLIER_CREDIT_NOTE_POSTED',
        details: JSON.stringify({
            ...JSON.parse(stored),
            purchases: [],
        }),
    };
};

const serviceReturnItems = () => [
    {
        id: 'return-item-1',
        tenantId: 'tenant-1',
        supplierReturnId: 'return-1',
        sourceType: 'DIRECT_PURCHASE_ITEM',
        purchaseItemId: 'purchase-item-1',
        goodsReceiptItemId: null,
        purchaseMatchAllocationId: null,
        quantityExact: new Decimal('1.0000'),
        bookUnitCostExact: new Decimal('7.005000'),
        bookValueExact: new Decimal('7.0050'),
        productNameAtReturn: 'Carne de res',
        unitAtReturn: 'LB',
        sourceHash: 'a'.repeat(64),
        supplierReturn: {
            supplierId: 'supplier-1',
            status: 'POSTED',
            returnedAt: new Date('2026-08-18T16:00:00.000Z'),
        },
        purchaseItem: {
            id: 'purchase-item-1',
            purchaseId: 'purchase-1',
            quantity: 2,
            quantityExact: new Decimal('2.0000'),
            totalCost: new Decimal('20.00'),
            taxAmountExact: new Decimal('3.00'),
            creditableTaxExact: new Decimal('3.00'),
        },
        purchaseMatchAllocation: null,
        creditNoteLine: null,
    },
    {
        id: 'return-item-2',
        tenantId: 'tenant-1',
        supplierReturnId: 'return-2',
        sourceType: 'PURCHASE_MATCH_ALLOCATION',
        purchaseItemId: null,
        goodsReceiptItemId: null,
        purchaseMatchAllocationId: 'match-2',
        quantityExact: new Decimal('1.0000'),
        bookUnitCostExact: new Decimal('6.004000'),
        bookValueExact: new Decimal('6.0040'),
        productNameAtReturn: 'Pollo entero',
        unitAtReturn: 'UND',
        sourceHash: 'b'.repeat(64),
        supplierReturn: {
            supplierId: 'supplier-1',
            status: 'POSTED',
            returnedAt: new Date('2026-08-20T16:00:00.000Z'),
        },
        purchaseItem: null,
        purchaseMatchAllocation: {
            id: 'match-2',
            quantityExact: new Decimal('1.0000'),
            purchaseItem: {
                id: 'purchase-item-2',
                purchaseId: 'purchase-1',
                quantity: 2,
                quantityExact: new Decimal('2.0000'),
                totalCost: new Decimal('16.00'),
                taxAmountExact: new Decimal('2.40'),
                creditableTaxExact: new Decimal('2.40'),
            },
        },
        creditNoteLine: null,
    },
];

const queryText = (query: { strings?: string[] }) => query.strings?.join(' ') ?? '';

interface FakeTxOptions {
    replayReads?: unknown[];
    userActive?: boolean;
    supplierExists?: boolean;
    creditNoteCreateError?: unknown;
    priorAudit?: unknown;
    purchaseUpdateCount?: number;
    retentionPurchaseIds?: string[];
}

const fakeTx = (options: FakeTxOptions = {}) => {
    const locks: string[] = [];
    const replayReads = [...(options.replayReads ?? [null, null])];
    const purchase = {
        id: 'purchase-1',
        tenantId: 'tenant-1',
        supplierId: 'supplier-1',
        status: 'PARTIALLY_PAID',
        paymentMethod: 'CREDIT',
        documentStatus: 'POSTED',
        date: normalizeCalendarDateInput('2026-08-01'),
        fiscalRegimeAtPurchase: 'GENERAL',
        balanceDue: new Decimal('20.7000'),
        paidAt: null,
        settledAt: null,
    };
    const tx = {
        $queryRaw: vi.fn(async (query: { strings?: string[] }) => {
            const sql = queryText(query);
            locks.push(sql);
            if (sql.includes('FROM `Tenant`')) return [{ id: 'tenant-1' }];
            if (sql.includes('FROM `Supplier`')) return options.supplierExists === false ? [] : [{ id: 'supplier-1' }];
            if (sql.includes('FROM `Purchase`')) return [{ id: 'purchase-1' }];
            if (sql.includes('FROM `SupplierReturn` sr')) {
                return [
                    { supplierReturnId: 'return-1', supplierReturnItemId: 'return-item-1' },
                    { supplierReturnId: 'return-2', supplierReturnItemId: 'return-item-2' },
                ];
            }
            if (sql.includes('FROM `PurchaseMatchAllocation`')) {
                return [{ id: 'match-2', goodsReceiptItemId: null }];
            }
            if (sql.includes('FROM `SupplierCreditNoteLine`')) return [];
            return [];
        }),
        user: {
            findFirst: vi.fn(async () => (
                options.userActive === false ? null : { id: 'user-1' }
            )),
        },
        tenant: {
            findFirst: vi.fn(async () => ({ fiscalRegime: 'GENERAL' })),
        },
        purchase: {
            findMany: vi.fn(async () => [purchase]),
            updateMany: vi.fn(async () => ({ count: options.purchaseUpdateCount ?? 1 })),
        },
        supplierReturnItem: {
            findMany: vi.fn(async () => serviceReturnItems()),
        },
        purchaseMatchAllocation: {
            findMany: vi.fn(async () => []),
        },
        supplierCreditNoteLine: {
            findMany: vi.fn(async () => []),
            createMany: vi.fn(async () => ({ count: 2 })),
        },
        fiscalRetention: {
            findMany: vi.fn(async () => (options.retentionPurchaseIds ?? [])
                .map((purchaseId) => ({ purchaseId }))),
        },
        fiscalPeriod: {
            findUnique: vi.fn(async () => null),
        },
        supplierCreditNote: {
            findFirst: vi.fn(async () => replayReads.shift() ?? null),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                if (options.creditNoteCreateError) throw options.creditNoteCreateError;
                return { id: 'credit-note-created', ...data, createdAt: CREATED_AT };
            }),
        },
        supplierCreditApplication: {
            createMany: vi.fn(async () => ({ count: 1 })),
        },
        auditLog: {
            findFirst: vi.fn(async () => options.priorAudit ?? null),
            create: vi.fn(async (_args: unknown) => ({ id: 'audit-1' })),
        },
    } as unknown as Prisma.TransactionClient;
    return { tx, locks, purchase };
};

const expectServiceError = async (
    promise: Promise<unknown>,
    code: string,
) => {
    try {
        await promise;
    } catch (error) {
        expect(
            error instanceof SupplierCreditNoteServiceError || error instanceof SupplierCreditNoteError,
        ).toBe(true);
        expect((error as SupplierCreditNoteServiceError | SupplierCreditNoteError).code).toBe(code);
        return error as SupplierCreditNoteServiceError | SupplierCreditNoteError;
    }
    throw new Error('Se esperaba error tipado');
};

describe('executeSupplierCreditNote', () => {
    beforeEach(() => {
        recordSupplierCreditNoteMock.mockReset();
        recordSupplierCreditNoteMock.mockResolvedValue(undefined);
    });

    it('postea la nota, crea líneas y aplicaciones, asienta contabilidad y liquida settledAt sin tocar paidAt', async () => {
        const { tx, locks } = fakeTx();
        const result = await executeSupplierCreditNote({
            tx,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            request: requestInput(),
            now: NOW,
        });

        expect(result).toEqual({
            replay: false,
            supplierCreditNote: {
                id: 'credit-note-created',
                supplierId: 'supplier-1',
                creditNoteNumber: 'NC-001',
                status: 'POSTED',
                total: '20.70',
                remainingCredit: '0.00',
            },
            returnItemIds: ['return-item-1', 'return-item-2'],
            applications: [{ purchaseId: 'purchase-1', amount: '20.70' }],
        });
        expect(recordSupplierCreditNoteMock).toHaveBeenCalledWith(
            tx,
            'tenant-1',
            'user-1',
            'credit-note-created',
            [
                { accountCode: '2.1.1', debit: '20.70', credit: '0.00' },
                { accountCode: '1.1.5', debit: '0.00', credit: '2.70' },
                { accountCode: '1.1.4', debit: '0.00', credit: '13.01' },
                { accountCode: '5.1.3', debit: '0.00', credit: '4.99' },
            ],
            normalizeCalendarDateInput('2026-08-28'),
        );
        expect((tx.purchase.updateMany as any).mock.calls[0][0]).toEqual({
            where: {
                id: 'purchase-1',
                tenantId: 'tenant-1',
            },
            data: {
                balanceDue: new Decimal('0.0000'),
                status: 'COMPLETED',
                settledAt: NOW,
            },
        });
        const audit = (tx.auditLog.create as any).mock.calls[0][0] as { data: { id: string; details: string } };
        expect(audit.data.id).toBe(buildSupplierCreditNoteResultAuditId({
            tenantId: 'tenant-1',
            clientEventId: EVENT_ID,
        }));
        expect(JSON.parse(audit.data.details)).toMatchObject({
            commandType: 'SUPPLIER_CREDIT_NOTE_POST',
            response: {
                supplierCreditNoteId: 'credit-note-created',
                returnItemIds: ['return-item-1', 'return-item-2'],
            },
            purchases: [{
                purchaseId: 'purchase-1',
                before: { paidAt: null, settledAt: null },
                after: { paidAt: null, settledAt: NOW.toISOString() },
            }],
        });
        expect(locks[0]).toContain('FROM `Tenant`');
        expect(locks[1]).toContain('FROM `Supplier`');
        expect(locks[2]).toContain('FROM `Purchase`');
        expect(locks[3]).toContain('FROM `SupplierReturn` sr');
    });

    it('devuelve replay exacto desde AuditLog sin recalcular ni escribir efectos', async () => {
        const { tx, locks } = fakeTx({
            replayReads: [persistedCreditNote()],
            priorAudit: persistedAudit(),
        });
        const result = await executeSupplierCreditNote({
            tx,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            request: requestInput(),
            now: NOW,
        });

        expect(result.replay).toBe(true);
        expect(result.supplierCreditNote.id).toBe('credit-note-existing');
        expect(locks).toHaveLength(2);
        expect((tx.purchase.findMany as any).mock.calls).toHaveLength(0);
        expect((tx.supplierCreditNote.create as any).mock.calls).toHaveLength(0);
        expect(recordSupplierCreditNoteMock).not.toHaveBeenCalled();
    });

    it('bloquea la contabilización cuando una compra aplicada tiene retenciones', async () => {
        const { tx } = fakeTx({ retentionPurchaseIds: ['purchase-1'] });

        await expectServiceError(executeSupplierCreditNote({
            tx,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            request: requestInput(),
            now: NOW,
        }), 'FISCAL_ADJUSTMENT_REVIEW_REQUIRED');

        expect(tx.fiscalRetention.findMany).toHaveBeenCalledWith({
            where: {
                tenantId: 'tenant-1',
                purchaseId: { in: ['purchase-1'] },
            },
            select: { purchaseId: true },
        });
        expect(tx.supplierCreditNote.create).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
        expect(recordSupplierCreditNoteMock).not.toHaveBeenCalled();
    });

    it('rechaza actor inactivo antes de abrir una transacción nueva', async () => {
        const db = {
            user: { findFirst: vi.fn(async () => null) },
            $transaction: vi.fn(),
        } as unknown as import('@prisma/client').PrismaClient;

        await expectServiceError(executeSupplierCreditNoteTransaction({
            db,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            request: requestInput(),
            now: NOW,
        }), 'SUPPLIER_CREDIT_NOTE_ACTOR_FORBIDDEN');
        expect(db.$transaction).not.toHaveBeenCalled();
    });
});

describe('executeSupplierCreditNoteTransaction', () => {
    beforeEach(() => {
        recordSupplierCreditNoteMock.mockReset();
        recordSupplierCreditNoteMock.mockResolvedValue(undefined);
    });

    it('relee replay en snapshot fresco después de un P2002', async () => {
        const db = {
            user: { findFirst: vi.fn(async () => ({ id: 'user-1' })) },
            $transaction: vi.fn(async () => {
                throw { code: 'P2002' };
            }),
            supplierCreditNote: { findFirst: vi.fn(async () => persistedCreditNote()) },
            auditLog: { findFirst: vi.fn(async () => persistedAudit()) },
        } as unknown as import('@prisma/client').PrismaClient;

        const result = await executeSupplierCreditNoteTransaction({
            db,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            request: requestInput(),
            now: NOW,
        });

        expect(result.replay).toBe(true);
        expect(result.supplierCreditNote.id).toBe('credit-note-existing');
        expect(db.$transaction).toHaveBeenCalledOnce();
        expect((db.$transaction as any).mock.calls[0][1]).toEqual({ isolationLevel: 'ReadCommitted' });
    });

    it('recupera replay si la carrera ya dejó la línea como acreditada bajo lock', async () => {
        const db = {
            user: { findFirst: vi.fn(async () => ({ id: 'user-1' })) },
            $transaction: vi.fn(async () => {
                throw new SupplierCreditNoteError(
                    'SUPPLIER_CREDIT_NOTE_RETURN_ITEM_ALREADY_CREDITED',
                    409,
                    'concurrencia',
                );
            }),
            supplierCreditNote: { findFirst: vi.fn(async () => persistedCreditNote()) },
            auditLog: { findFirst: vi.fn(async () => persistedAudit()) },
        } as unknown as import('@prisma/client').PrismaClient;

        const result = await executeSupplierCreditNoteTransaction({
            db,
            tenantId: 'tenant-1',
            userId: 'user-1',
            supplierId: 'supplier-1',
            request: requestInput(),
            now: NOW,
        });

        expect(result.replay).toBe(true);
        expect(result.returnItemIds).toEqual(['return-item-1', 'return-item-2']);
    });
});
