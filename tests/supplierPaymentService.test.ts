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
import { SupplierPaymentError as CashSupplierPaymentError } from '../backend/services/supplierPayment';
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
    invoiceNumber: 'F-001',
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
    /** Efectivo en la gaveta del turno abierto (fondo inicial, sin movimientos). */
    efectivoEnGaveta?: string;
    /** `false` = el turno se cerró entre el handler y la transacción. */
    turnoAbierto?: boolean;
    purchaseUpdateCount?: number;
    createError?: unknown;
}

const cajaDepsPorTx = new WeakMap<object, never>();

const fakeTransaction = (options: FakeTxOptions = {}) => {
    const events: string[] = [];
    const replayReads = [...(options.replayReads ?? [])];
    const findFirst = vi.fn(async (): Promise<unknown | null> => replayReads.shift() ?? null);
    // Dos locks distintos comparten $queryRaw: el de la compra llega como
    // `Prisma.sql` (objeto) y el del turno como template literal (array). Si el
    // fake no los distinguiera, un cambio de orden de bloqueo pasaría inadvertido.
    const queryRaw = vi.fn(async (query: unknown) => {
        if (Array.isArray(query)) {
            events.push('lock-turno');
            return [];
        }
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
    // La gaveta del turno: row-lock, relectura del disponible, gasto y
    // movimiento FIRMADO. Reemplaza al débito de `Tenant.walletBalance`.
    const shiftFindFirst = vi.fn(async () => (options.turnoAbierto === false
        ? null
        : { id: 'shift-1', initialCash: new Decimal(options.efectivoEnGaveta ?? '5000') }));
    const saleFindMany = vi.fn(async () => []);
    const cashMovementFindMany = vi.fn(async () => []);
    const expenseCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('caja');
        return { id: 'expense-1', ...data };
    });
    const appendCashMovement = vi.fn(async (_tx: unknown, data: Record<string, unknown>) => ({
        id: 'movement-1',
        ...data,
    }));
    const recordCashMovement = vi.fn(() => {
        throw new Error('El abono no postea el asiento de caja: lo postea recordSupplierPayment');
    });
    const purchaseUpdate = vi.fn(async () => {
        events.push('purchase');
        return { count: options.purchaseUpdateCount ?? 1 };
    });
    const auditCreate = vi.fn(async (_args: unknown) => {
        events.push('audit');
        return { id: 'audit-1' };
    });
    const walletUpdate = vi.fn(() => {
        throw new Error('El abono NUNCA debe tocar Tenant.walletBalance');
    });
    const tx = {
        $queryRaw: queryRaw,
        supplierPayment: { findFirst, create },
        tenant: { updateMany: walletUpdate },
        purchase: { updateMany: purchaseUpdate },
        auditLog: { create: auditCreate },
        expense: { create: expenseCreate },
        shift: { findFirst: shiftFindFirst },
        sale: { findMany: saleFindMany },
        cashMovement: { findMany: cashMovementFindMany },
    } as unknown as Prisma.TransactionClient;
    const cajaDeps = { appendCashMovement, recordCashMovement } as never;
    cajaDepsPorTx.set(tx as object, cajaDeps);
    return {
        tx,
        events,
        cajaDeps,
        mocks: {
            findFirst,
            queryRaw,
            create,
            walletUpdate,
            purchaseUpdate,
            auditCreate,
            expenseCreate,
            shiftFindFirst,
            appendCashMovement,
            recordCashMovement,
        },
    };
};

const execute = (
    tx: Prisma.TransactionClient,
    request: Record<string, unknown> = {},
    purchaseId = 'purchase-1',
    extra: { shiftId?: string | null; cajaDeps?: never } = {},
) => executeSupplierPayment({
    tx,
    tenantId: 'tenant-1',
    userId: 'user-1',
    purchaseId,
    request,
    shiftId: 'shiftId' in extra ? extra.shiftId : 'shift-1',
    cajaDeps: extra.cajaDeps ?? cajaDepsPorTx.get(tx as object),
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

/** El error de la GAVETA es otra clase (otro mapa de códigos → HTTP). */
const expectCajaError = async (
    promise: Promise<unknown>,
    code: string,
): Promise<CashSupplierPaymentError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(CashSupplierPaymentError);
        expect((error as CashSupplierPaymentError).code).toBe(code);
        return error as CashSupplierPaymentError;
    }
    throw new Error('Se esperaba CashSupplierPaymentError');
};

describe('executeSupplierPayment', () => {
    beforeEach(() => {
        recordSupplierPaymentMock.mockReset();
        recordSupplierPaymentMock.mockResolvedValue(undefined);
    });

    it('registra un abono CASH parcial sacando el efectivo de la GAVETA, con asiento, saldo y auditoría atómicos', async () => {
        const { tx, events, mocks, cajaDeps } = fakeTransaction();
        recordSupplierPaymentMock.mockImplementation(async () => {
            events.push('journal');
        });

        const result = await execute(tx, {
            amount: '40.12',
            method: 'CASH',
            clientEventId: 'event-0001',
            reference: ' REC-42 ',
            notes: ' primer abono ',
        }, 'purchase-1', { cajaDeps });

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
        // ORDEN DE BLOQUEO: la compra primero, el turno DESPUÉS. Es el mismo
        // orden que /api/purchases y /api/returns; invertirlo abre un deadlock.
        expect(events).toEqual(['lock', 'payment', 'lock-turno', 'caja', 'journal', 'purchase', 'audit']);
        expect(mocks.walletUpdate).not.toHaveBeenCalled();
        expect(mocks.shiftFindFirst).toHaveBeenCalledWith({
            where: { id: 'shift-1', tenantId: 'tenant-1', status: 'OPEN' },
            select: { id: true, initialCash: true },
        });
        expect(mocks.expenseCreate).toHaveBeenCalledWith({
            data: {
                tenantId: 'tenant-1',
                amount: 40.12,
                description: 'Abono Factura #F-001',
                category: 'PAGO_PROVEEDOR',
            },
        });
        expect(mocks.appendCashMovement).toHaveBeenCalledWith(tx, {
            tenantId: 'tenant-1',
            shiftId: 'shift-1',
            userId: 'user-1',
            type: 'OUT',
            amount: 40.12,
            currency: 'NIO',
            category: 'PAGO_PROVEEDOR',
            description: 'Abono Factura #F-001',
            expenseId: 'expense-1',
        });
        // El asiento de caja lo postea recordSupplierPayment (Debe CxP / Haber
        // Caja). Postearlo también acá acreditaría Caja dos veces.
        expect(mocks.recordCashMovement).not.toHaveBeenCalled();
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
            // Capa 3: el before/after de la gaveta viaja en el mismo AuditLog.
            caja: {
                shiftId: 'shift-1',
                cashMovementId: 'movement-1',
                expenseId: 'expense-1',
                efectivoAntes: '5000.00',
                efectivoDespues: '4959.88',
            },
        });
    });

    it.each(['TRANSFER', 'CARD', 'QR'] as const)(
        'liquida por %s contra Bancos sin tocar la gaveta ni la billetera',
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
        expect(mocks.walletUpdate).not.toHaveBeenCalled();
        expect(mocks.appendCashMovement).toHaveBeenCalledOnce();
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

    it('falla por efectivo insuficiente EN LA GAVETA antes del asiento, saldo y auditoría', async () => {
        const { tx, events, mocks } = fakeTransaction({ efectivoEnGaveta: '99.99' });
        const error = await expectCajaError(execute(tx, {
            amount: '100', method: 'CASH', clientEventId: 'event-0001',
        }), 'EFECTIVO_INSUFICIENTE');
        // El mensaje dice cuánto hay y cuánto falta: el bug reportado era que
        // mandaba a "recargar la billetera", que no interviene en nada.
        expect(error.message).toContain('disponible C$ 99.99');
        expect(error.message).not.toMatch(/billetera/i);
        expect(events).toEqual(['lock', 'payment', 'lock-turno']);
        expect(mocks.expenseCreate).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
        expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('exige caja abierta para un abono en efectivo, sin inventar saldo', async () => {
        const { tx, events, mocks } = fakeTransaction();
        const error = await expectServiceError(execute(tx, {
            amount: '100', method: 'CASH', clientEventId: 'event-0001',
        }, 'purchase-1', { shiftId: null }), 'NO_OPEN_SHIFT');
        expect(error.httpStatus).toBe(409);
        expect(error.message).toContain('Abrí una caja');
        expect(events).toEqual(['lock', 'payment']);
        expect(mocks.walletUpdate).not.toHaveBeenCalled();
        expect(mocks.expenseCreate).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
    });

    it('aborta si el turno se cerró entre el handler y la transacción', async () => {
        const { tx, events, mocks } = fakeTransaction({ turnoAbierto: false });
        await expectCajaError(execute(tx, {
            amount: '100', method: 'CASH', clientEventId: 'event-0001',
        }), 'SIN_CAJA_ABIERTA');
        expect(events).toEqual(['lock', 'payment', 'lock-turno']);
        expect(mocks.expenseCreate).not.toHaveBeenCalled();
        expect(recordSupplierPaymentMock).not.toHaveBeenCalled();
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
        expect(events).toEqual(['lock', 'payment', 'lock-turno', 'caja', 'journal']);
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
        expect(events).toEqual(['lock', 'payment', 'lock-turno', 'caja', 'journal']);
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
