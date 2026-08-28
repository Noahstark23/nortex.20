import type { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordSupplierPaymentMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/services/accounting.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../backend/services/accounting.js')>()),
    recordSupplierPayment: recordSupplierPaymentMock,
}));

import {
    buildSupplierPaymentPayloadHash,
    SupplierPaymentError,
} from '../backend/lib/supplierPayments';
import { PeriodLockedError } from '../backend/services/accounting';
import {
    executeSupplierPayment,
    executeSupplierPaymentTransaction,
} from '../backend/services/supplierPaymentService';

const NOW = new Date('2026-08-27T15:30:00.000Z');
const CREATED_AT = new Date('2026-08-27T15:30:01.000Z');

const purchase = (overrides: Record<string, unknown> = {}) => ({
    id: 'purchase-1',
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    total: new Decimal('100'),
    balanceDue: new Decimal('100'),
    status: 'PENDING_PAYMENT',
    paymentMethod: 'CREDIT',
    documentStatus: 'POSTED',
    paymentHold: false,
    paidAt: null,
    settledAt: null,
    ...overrides,
});

const existingPayment = (overrides: Record<string, unknown> = {}) => ({
    id: 'payment-existing',
    tenantId: 'tenant-1',
    purchaseId: 'purchase-1',
    supplierId: 'supplier-1',
    clientEventId: 'event-0001',
    payloadHash: buildSupplierPaymentPayloadHash('purchase-1', {
        amount: '100',
        method: 'TRANSFER',
        clientEventId: 'event-0001',
    }),
    amount: new Decimal('100'),
    method: 'TRANSFER',
    reference: null,
    notes: null,
    paidAt: NOW,
    createdBy: 'user-1',
    createdAt: CREATED_AT,
    purchase: {
        id: 'purchase-1',
        supplierId: 'supplier-1',
        total: new Decimal('100'),
        balanceDue: new Decimal(0),
        status: 'COMPLETED',
        paymentMethod: 'CREDIT',
        paidAt: NOW,
        settledAt: NOW,
    },
    ...overrides,
});

interface FakeTxOptions {
    lockedRows?: unknown[];
    replayReads?: unknown[];
    walletCount?: number;
    purchaseUpdateCount?: number;
    createError?: unknown;
}

const fakeTransaction = (options: FakeTxOptions = {}) => {
    const events: string[] = [];
    const replayReads = [...(options.replayReads ?? [])];
    const findFirst = vi.fn(async (): Promise<unknown | null> => replayReads.shift() ?? null);
    const queryRaw = vi.fn(async (query: unknown) => {
        events.push('lock');
        return options.lockedRows ?? [purchase()];
    });
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('payment');
        if (options.createError) throw options.createError;
        return {
            id: 'payment-created',
            ...data,
            createdAt: CREATED_AT,
        };
    });
    const walletUpdate = vi.fn(async () => {
        events.push('wallet');
        return { count: options.walletCount ?? 1 };
    });
    const purchaseUpdate = vi.fn(async () => {
        events.push('purchase');
        return { count: options.purchaseUpdateCount ?? 1 };
    });
    const auditCreate = vi.fn(async (_args: unknown) => {
        events.push('audit');
        return { id: 'audit-1' };
    });
    const expenseCreate = vi.fn(() => {
        throw new Error('SupplierPayment nunca debe crear Expense');
    });
    const tx = {
        $queryRaw: queryRaw,
        supplierPayment: { findFirst, create },
        tenant: { updateMany: walletUpdate },
        purchase: { updateMany: purchaseUpdate },
        auditLog: { create: auditCreate },
        expense: { create: expenseCreate },
    } as unknown as Prisma.TransactionClient;
    return {
        tx,
        events,
        mocks: {
            findFirst,
            queryRaw,
            create,
            walletUpdate,
            purchaseUpdate,
            auditCreate,
            expenseCreate,
        },
    };
};

const execute = (
    tx: Prisma.TransactionClient,
    request: Record<string, unknown> = {},
    purchaseId = 'purchase-1',
) => executeSupplierPayment({
    tx,
    tenantId: 'tenant-1',
    userId: 'user-1',
    purchaseId,
    request,
    now: NOW,
});

const expectServiceError = async (
    promise: Promise<unknown>,
    code: string,
): Promise<SupplierPaymentError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(SupplierPaymentError);
        expect((error as SupplierPaymentError).code).toBe(code);
        return error as SupplierPaymentError;
    }
    throw new Error('Se esperaba SupplierPaymentError');
};

describe('executeSupplierPayment', () => {
    beforeEach(() => {
        recordSupplierPaymentMock.mockReset();
        recordSupplierPaymentMock.mockResolvedValue(undefined);
    });

    it('registra un abono CASH parcial con wallet, asiento, saldo y auditoría atómicos', async () => {
        const { tx, events, mocks } = fakeTransaction();
        recordSupplierPaymentMock.mockImplementation(async () => {
            events.push('journal');
        });

        const result = await execute(tx, {
            amount: '40.12',
            method: 'CASH',
            clientEventId: 'event-0001',
            reference: ' REC-42 ',
            notes: ' primer abono ',
        });

        expect(result.replay).toBe(false);
        expect(result.purchase).toEqual({
            id: 'purchase-1',
            supplierId: 'supplier-1',
            total: '100',
            balanceDue: '59.88',
            status: 'PARTIALLY_PAID',
            paymentMethod: 'CREDIT',
            paidAt: null,
            settledAt: null,
        });
        expect(result.payment).toMatchObject({
            id: 'payment-created',
            amount: '40.12',
            method: 'CASH',
            reference: 'REC-42',
            notes: 'primer abono',
        });
        expect(events).toEqual(['lock', 'payment', 'wallet', 'journal', 'purchase', 'audit']);
        expect(mocks.walletUpdate).toHaveBeenCalledWith({
            where: {
                id: 'tenant-1',
                walletBalance: { gte: new Decimal('40.12') },
            },
            data: { walletBalance: { decrement: new Decimal('40.12') } },
        });
        expect(recordSupplierPaymentMock).toHaveBeenCalledWith(
            tx,
            'tenant-1',
            'user-1',
            'payment-created',
            new Decimal('40.12'),
            'CASH',
            NOW,
        );
        expect(mocks.purchaseUpdate).toHaveBeenCalledWith({
            where: { id: 'purchase-1', tenantId: 'tenant-1' },
            data: {
                balanceDue: new Decimal('59.88'),
                status: 'PARTIALLY_PAID',
                paidAt: null,
                settledAt: null,
            },
        });
        const audit = mocks.auditCreate.mock.calls[0][0] as { data: { details: string } };
        expect(JSON.parse(audit.data.details)).toMatchObject({
            before: { status: 'PENDING_PAYMENT', balanceDue: '100.0000' },
            after: { status: 'PARTIALLY_PAID', balanceDue: '59.8800', paidAt: null, settledAt: null },
            payment: { amount: '40.1200', method: 'CASH' },
        });
        expect(mocks.expenseCreate).not.toHaveBeenCalled();
    });

    it.each(['TRANSFER', 'CARD', 'QR'] as const)(
        'liquida por %s contra Bancos sin tocar wallet',
        async (method) => {
            const { tx, events, mocks } = fakeTransaction();
            recordSupplierPaymentMock.mockImplementation(async () => {
                events.push('journal');
            });
            const result = await execute(tx, {
                amount: '100',
                method,
                clientEventId: `event-${method.toLowerCase()}`,
            });

            expect(result.purchase.status).toBe('COMPLETED');
            expect(result.purchase.balanceDue).toBe('0');
            expect(result.purchase.paidAt).toBe(NOW.toISOString());
            expect(result.purchase.settledAt).toBe(NOW.toISOString());
            expect(mocks.walletUpdate).not.toHaveBeenCalled();
            expect(recordSupplierPaymentMock).toHaveBeenCalledWith(
                tx,
                'tenant-1',
                'user-1',
                'payment-created',
                new Decimal(100),
                method,
                NOW,
            );
            expect(events).toEqual(['lock', 'payment', 'journal', 'purchase', 'audit']);
        },
    );

    it('mantiene el bodyless legacy como liquidación total CASH con llave interna', async () => {
        const { tx, mocks } = fakeTransaction({
            lockedRows: [purchase({ total: new Decimal('75'), balanceDue: null })],
        });
        const result = await execute(tx);

        expect(result.payment.amount).toBe('75');
        expect(result.payment.method).toBe('CASH');
        expect(result.payment.clientEventId).toMatch(/^legacy:[0-9a-f-]{36}$/);
        expect(result.purchase.status).toBe('COMPLETED');
        expect(result.purchase.settledAt).toBe(NOW.toISOString());
        expect(mocks.findFirst).not.toHaveBeenCalled();
        expect(mocks.walletUpdate).toHaveBeenCalledOnce();
    });

    it('conserva paidAt histórico y materializa settledAt al liquidar el saldo restante', async () => {
        const priorPaidAt = new Date('2026-08-20T10:00:00.000Z');
        const { tx, mocks } = fakeTransaction({
            lockedRows: [purchase({
                total: new Decimal('100'),
                balanceDue: new Decimal('10'),
                status: 'PARTIALLY_PAID',
                paidAt: priorPaidAt,
                settledAt: null,
            })],
        });
        const result = await execute(tx, {
            amount: '10',
            method: 'TRANSFER',
            clientEventId: 'event-last-balance',
        });

        expect(result.purchase.paidAt).toBe(NOW.toISOString());
        expect(result.purchase.settledAt).toBe(NOW.toISOString());
        expect(mocks.purchaseUpdate).toHaveBeenCalledWith({
            where: { id: 'purchase-1', tenantId: 'tenant-1' },
            data: {
                balanceDue: new Decimal('0'),
                status: 'COMPLETED',
                paidAt: NOW,
                settledAt: NOW,
            },
        });
        const audit = mocks.auditCreate.mock.calls[0][0] as { data: { details: string } };
        expect(JSON.parse(audit.data.details)).toMatchObject({
            before: {
                paidAt: priorPaidAt.toISOString(),
                settledAt: null,
            },
            after: {
                paidAt: NOW.toISOString(),
                settledAt: NOW.toISOString(),
            },
        });
    });

    it('rechaza parcial sin clientEventId antes de cualquier efecto monetario', async () => {
        const { tx, events, mocks } = fakeTransaction();
        await expectServiceError(execute(tx, { amount: '25', method: 'CASH' }),
            'PARTIAL_PAYMENT_REQUIRES_CLIENT_EVENT_ID');
        expect(events).toEqual(['lock']);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('devuelve replay exacto aun cuando la compra ya quedó completada', async () => {
        const replay = existingPayment();
        const { tx, mocks, events } = fakeTransaction({ replayReads: [replay] });
        const result = await execute(tx, {
            amount: '100', method: 'TRANSFER', clientEventId: 'event-0001',
        });

        expect(result.replay).toBe(true);
        expect(result.purchase.status).toBe('COMPLETED');
        expect(result.payment.id).toBe('payment-existing');
        expect(events).toEqual([]);
        expect(mocks.queryRaw).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.walletUpdate).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
    });

    it('rechaza establemente un clientEventId reutilizado con otro payload', async () => {
        const { tx, mocks } = fakeTransaction({ replayReads: [existingPayment()] });
        const error = await expectServiceError(execute(tx, {
            amount: '99', method: 'TRANSFER', clientEventId: 'event-0001',
        }), 'PAYMENT_IDEMPOTENCY_CONFLICT');
        expect(error.httpStatus).toBe(409);
        expect(mocks.queryRaw).not.toHaveBeenCalled();
    });

    it('recupera un P2002 como replay sin ejecutar efectos posteriores', async () => {
        const replay = existingPayment();
        const { tx, events, mocks } = fakeTransaction({
            replayReads: [null, null, replay],
            createError: { code: 'P2002' },
        });
        const result = await execute(tx, {
            amount: '100', method: 'TRANSFER', clientEventId: 'event-0001',
        });

        expect(result.replay).toBe(true);
        expect(events).toEqual(['lock', 'payment']);
        expect(mocks.walletUpdate).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('convierte el P2002 conflictivo en PAYMENT_IDEMPOTENCY_CONFLICT', async () => {
        const replay = existingPayment({ payloadHash: 'hash-distinto' });
        const { tx } = fakeTransaction({
            replayReads: [null, null, replay],
            createError: { code: 'P2002' },
        });
        await expectServiceError(execute(tx, {
            amount: '100', method: 'TRANSFER', clientEventId: 'event-0001',
        }), 'PAYMENT_IDEMPOTENCY_CONFLICT');
    });

    it('aísla el lock por tenant y no revela una compra ajena', async () => {
        const { tx, mocks } = fakeTransaction({ lockedRows: [] });
        const error = await expectServiceError(execute(tx), 'PURCHASE_NOT_FOUND');
        expect(error.httpStatus).toBe(404);
        const sql = mocks.queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
        expect(sql.strings.join(' ')).toContain('AND `tenantId` =');
        expect(sql.values).toEqual(['purchase-1', 'tenant-1']);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('rechaza NORTEX_CAPITAL antes de crear subledger o asiento', async () => {
        const { tx, events, mocks } = fakeTransaction({
            lockedRows: [purchase({ paymentMethod: 'NORTEX_CAPITAL' })],
        });
        await expectServiceError(execute(tx), 'CAPITAL_PURCHASE_NOT_PAYABLE');
        expect(events).toEqual(['lock']);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
    });

    it('rechaza un documento no posteado dentro del lock y antes de efectos', async () => {
        const { tx, events, mocks } = fakeTransaction({
            lockedRows: [purchase({ documentStatus: 'VOIDED' })],
        });
        const error = await expectServiceError(execute(tx), 'PURCHASE_DOCUMENT_NOT_POSTED');
        expect(error.httpStatus).toBe(409);
        expect(events).toEqual(['lock']);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
    });

    it('bloquea el pago de una factura retenida por matching antes de efectos', async () => {
        const { tx, events, mocks } = fakeTransaction({
            lockedRows: [purchase({ paymentHold: true })],
        });
        const error = await expectServiceError(execute(tx), 'PURCHASE_PAYMENT_ON_HOLD');
        expect(error.httpStatus).toBe(409);
        expect(events).toEqual(['lock']);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.walletUpdate).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
    });

    it('un doble submit legacy ya saldado no vuelve a mover dinero', async () => {
        const { tx, events, mocks } = fakeTransaction({
            lockedRows: [purchase({ balanceDue: new Decimal(0), status: 'COMPLETED', paidAt: NOW })],
        });
        await expectServiceError(execute(tx), 'PURCHASE_ALREADY_PAID');
        expect(events).toEqual(['lock']);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.walletUpdate).not.toHaveBeenCalled();
    });

    it('falla por caja insuficiente antes del asiento, saldo y auditoría', async () => {
        const { tx, events, mocks } = fakeTransaction({ walletCount: 0 });
        await expectServiceError(execute(tx, {
            amount: '100', method: 'CASH', clientEventId: 'event-0001',
        }), 'INSUFFICIENT_CASH_BALANCE');
        expect(events).toEqual(['lock', 'payment', 'wallet']);
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('si falla el asiento no actualiza compra ni escribe auditoría parcial', async () => {
        const { tx, events, mocks } = fakeTransaction();
        recordSupplierPaymentMock.mockImplementation(async () => {
            events.push('journal');
            throw new Error('fallo contable');
        });
        await expect(execute(tx, {
            amount: '100', method: 'CASH', clientEventId: 'event-0001',
        })).rejects.toThrow('fallo contable');
        expect(events).toEqual(['lock', 'payment', 'wallet', 'journal']);
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('propaga PeriodLockedError y deja que la transacción revierta todo el pago', async () => {
        const { tx, events, mocks } = fakeTransaction();
        recordSupplierPaymentMock.mockImplementation(async () => {
            events.push('journal');
            throw new PeriodLockedError('2026-08');
        });
        await expect(execute(tx, {
            amount: '100', method: 'CASH', clientEventId: 'event-0001',
        })).rejects.toBeInstanceOf(PeriodLockedError);
        expect(events).toEqual(['lock', 'payment', 'wallet', 'journal']);
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('si no puede actualizar la compra no deja AuditLog engañoso', async () => {
        const { tx, events, mocks } = fakeTransaction({ purchaseUpdateCount: 0 });
        recordSupplierPaymentMock.mockImplementation(async () => {
            events.push('journal');
        });
        await expectServiceError(execute(tx, {
            amount: '100', method: 'TRANSFER', clientEventId: 'event-0001',
        }), 'PURCHASE_CONCURRENT_UPDATE_FAILED');
        expect(events).toEqual(['lock', 'payment', 'journal', 'purchase']);
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });
});

describe('executeSupplierPaymentTransaction', () => {
    beforeEach(() => {
        recordSupplierPaymentMock.mockReset();
        recordSupplierPaymentMock.mockResolvedValue(undefined);
    });

    it('relee el replay en snapshot fresco después de un P2002 transaccional', async () => {
        const replay = existingPayment();
        const transaction = vi.fn(async (_callback: unknown, _options?: unknown) => {
            throw { code: 'P2002' };
        });
        const findFirst = vi.fn().mockResolvedValue(replay);
        const db = {
            $transaction: transaction,
            supplierPayment: { findFirst },
        } as unknown as import('@prisma/client').PrismaClient;

        const result = await executeSupplierPaymentTransaction({
            db,
            tenantId: 'tenant-1',
            userId: 'user-1',
            purchaseId: 'purchase-1',
            request: {
                amount: '100', method: 'TRANSFER', clientEventId: 'event-0001',
            },
            now: NOW,
        });

        expect(result.replay).toBe(true);
        expect(result.payment.id).toBe('payment-existing');
        expect(transaction).toHaveBeenCalledOnce();
        expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'ReadCommitted' });
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 'tenant-1', clientEventId: 'event-0001' },
        }));
    });

    it.each(['PURCHASE_ALREADY_PAID', 'PAYMENT_EXCEEDS_BALANCE'])(
        'recupera replay concurrente cuando el lock ya observa %s',
        async (code) => {
            const transaction = vi.fn(async () => {
                throw new SupplierPaymentError(code, 409, 'estado concurrente');
            });
            const db = {
                $transaction: transaction,
                supplierPayment: { findFirst: vi.fn().mockResolvedValue(existingPayment()) },
            } as unknown as import('@prisma/client').PrismaClient;

            const result = await executeSupplierPaymentTransaction({
                db,
                tenantId: 'tenant-1',
                userId: 'user-1',
                purchaseId: 'purchase-1',
                request: {
                    amount: '100', method: 'TRANSFER', clientEventId: 'event-0001',
                },
            });
            expect(result.replay).toBe(true);
        },
    );

    it('convierte un P2002 divergente detectado fuera de tx en conflicto estable', async () => {
        const db = {
            $transaction: vi.fn(async () => {
                throw { code: 'P2002' };
            }),
            supplierPayment: { findFirst: vi.fn().mockResolvedValue(existingPayment()) },
        } as unknown as import('@prisma/client').PrismaClient;

        await expectServiceError(executeSupplierPaymentTransaction({
            db,
            tenantId: 'tenant-1',
            userId: 'user-1',
            purchaseId: 'purchase-1',
            request: {
                amount: '99', method: 'TRANSFER', clientEventId: 'event-0001',
            },
        }), 'PAYMENT_IDEMPOTENCY_CONFLICT');
    });

    it('no convierte un P2002 ajeno si no existe el evento después del rollback', async () => {
        const original = { code: 'P2002', meta: { target: 'otro_indice' } };
        const db = {
            $transaction: vi.fn(async () => {
                throw original;
            }),
            supplierPayment: { findFirst: vi.fn().mockResolvedValue(null) },
        } as unknown as import('@prisma/client').PrismaClient;

        await expect(executeSupplierPaymentTransaction({
            db,
            tenantId: 'tenant-1',
            userId: 'user-1',
            purchaseId: 'purchase-1',
            request: {
                amount: '100', method: 'TRANSFER', clientEventId: 'event-0001',
            },
        })).rejects.toBe(original);
    });
});
