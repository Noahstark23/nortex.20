import { describe, expect, it } from 'vitest';
import {
    PURCHASE_FISCAL_STATUSES,
    PURCHASE_PAYABLE_STATUSES,
    assertMatchingSupplierPaymentReplay,
    buildSupplierPaymentPayloadHash,
    normalizeSupplierPaymentClientEventId,
    normalizeSupplierPaymentAmount,
    normalizeSupplierPaymentMethod,
    normalizeSupplierPaymentRequest,
    resolveEffectiveSupplierBalance,
    resolveSupplierPaymentPlan,
    SupplierPaymentError,
} from '../backend/lib/supplierPayments';
import { buildSupplierPaymentJournalLines } from '../backend/services/accounting';

const captureError = (callback: () => unknown): SupplierPaymentError => {
    try {
        callback();
    } catch (error) {
        expect(error).toBeInstanceOf(SupplierPaymentError);
        expect((error as SupplierPaymentError).name).toBe('SupplierPaymentError');
        return error as SupplierPaymentError;
    }
    throw new Error('Se esperaba SupplierPaymentError');
};

describe('reglas puras de pagos a proveedores', () => {
    it('expone los estados fiscales y pagables sin omitir abonos parciales', () => {
        expect(PURCHASE_FISCAL_STATUSES).toEqual([
            'COMPLETED',
            'PENDING_PAYMENT',
            'PARTIALLY_PAID',
        ]);
        expect(PURCHASE_PAYABLE_STATUSES).toEqual(['PENDING_PAYMENT', 'PARTIALLY_PAID']);
    });

    it.each([
        ['0.01', '0.01'],
        ['19.12', '19.12'],
        ['9999999999.99', '9999999999.99'],
    ])('acepta el monto límite %s sin redondearlo', (raw, expected) => {
        expect(normalizeSupplierPaymentAmount(raw).toString()).toBe(expected);
    });

    it.each([
        ['0', 'amount debe ser mayor que cero'],
        ['-0.0001', 'amount debe ser mayor que cero'],
        ['0.001', 'amount admite como máximo 2 decimales'],
        ['1.001', 'amount admite como máximo 2 decimales'],
        ['10000000000', 'amount excede el máximo permitido'],
        ['NaN', 'amount debe ser un monto finito'],
        ['Infinity', 'amount debe ser un monto finito'],
        ['no-es-numero', 'amount no es un monto decimal válido'],
    ])(
        'rechaza el monto inválido %s con diagnóstico estable',
        (raw, message) => {
            const error = captureError(() => normalizeSupplierPaymentAmount(raw));
            expect(error.code).toBe('INVALID_PAYMENT_AMOUNT');
            expect(error.httpStatus).toBe(400);
            expect(error.message).toBe(message);
        },
    );

    it('rechaza métodos fuera del contrato y conserva CASH como default', () => {
        expect(normalizeSupplierPaymentMethod(undefined)).toBe('CASH');
        const error = captureError(() => normalizeSupplierPaymentMethod('WIRE'));
        expect(error.code).toBe('INVALID_PAYMENT_METHOD');
        expect(error.httpStatus).toBe(400);
        expect(error.message).toBe('method debe ser CASH, TRANSFER, CARD o QR');
    });

    it('valida ambos bordes persistibles de clientEventId', () => {
        expect(normalizeSupplierPaymentClientEventId('12345678')).toBe('12345678');
        expect(normalizeSupplierPaymentClientEventId('x'.repeat(128))).toBe('x'.repeat(128));
        for (const invalid of ['1234567', 'x'.repeat(129), '   ']) {
            const error = captureError(() => normalizeSupplierPaymentClientEventId(invalid));
            expect(error.code).toBe('INVALID_CLIENT_EVENT_ID');
            expect(error.httpStatus).toBe(400);
            expect(error.message).toBe('clientEventId debe contener entre 8 y 128 caracteres');
        }
    });

    it('normaliza el request antes de persistir o firmar su intención', () => {
        const normalized = normalizeSupplierPaymentRequest({
            amount: '10.5000',
            method: ' transfer ',
            clientEventId: '  event-0001  ',
            reference: '  TRX-42 ',
            notes: '  pago de agosto  ',
        });
        expect(normalized.amount?.toString()).toBe('10.5');
        expect(normalized.method).toBe('TRANSFER');
        expect(normalized.clientEventId).toBe('event-0001');
        expect(normalized.reference).toBe('TRX-42');
        expect(normalized.notes).toBe('pago de agosto');
    });

    it('convierte textos vacíos en null para una huella y persistencia únicas', () => {
        const normalized = normalizeSupplierPaymentRequest({ reference: '  ', notes: '' });
        expect(normalized.reference).toBeNull();
        expect(normalized.notes).toBeNull();
        expect(buildSupplierPaymentPayloadHash('purchase-1', {
            reference: '  ', notes: '',
        })).toBe(buildSupplierPaymentPayloadHash('purchase-1'));
    });

    it('materializa el saldo legacy pendiente y reconoce el completado como cero', () => {
        expect(resolveEffectiveSupplierBalance({
            total: '125.50',
            balanceDue: null,
            status: 'PENDING_PAYMENT',
        }).toString()).toBe('125.5');
        expect(resolveEffectiveSupplierBalance({
            total: '125.50',
            balanceDue: null,
            status: 'COMPLETED',
        }).toString()).toBe('0');
    });

    it('usa balanceDue no nulo como autoridad en vez del total histórico', () => {
        expect(resolveEffectiveSupplierBalance({
            total: '500',
            balanceDue: '125.4321',
            status: 'PENDING_PAYMENT',
        }).toString()).toBe('125.4321');
    });

    it.each([
        { total: '100', balanceDue: null, status: 'PARTIALLY_PAID' },
        { total: '100', balanceDue: '-0.0001', status: 'PARTIALLY_PAID' },
        { total: '100', balanceDue: '10.00001', status: 'PARTIALLY_PAID' },
    ])('exige conciliación para un saldo imposible: $status/$balanceDue', (purchase) => {
        const error = captureError(() => resolveEffectiveSupplierBalance(purchase));
        expect(error.code).toBe('PURCHASE_BALANCE_RECONCILIATION_REQUIRED');
        expect(error.httpStatus).toBe(409);
        expect(error.message).toBe(
            'El saldo de la compra requiere conciliación antes de registrar pagos',
        );
    });

    it('identifica cuál decimal histórico está corrupto', () => {
        const balanceError = captureError(() => resolveEffectiveSupplierBalance({
            total: '100', balanceDue: 'corrupto', status: 'PARTIALLY_PAID',
        }));
        expect(balanceError.message).toBe('balanceDue no es un monto decimal válido');

        const totalError = captureError(() => resolveEffectiveSupplierBalance({
            total: 'corrupto', balanceDue: null, status: 'PENDING_PAYMENT',
        }));
        expect(totalError.message).toBe('total no es un monto decimal válido');
    });

    it('resuelve un abono parcial y el saldo exacto restante', () => {
        const plan = resolveSupplierPaymentPlan({
            total: '100',
            balanceDue: '100',
            status: 'PENDING_PAYMENT',
        }, '33.33', true);
        expect(plan.previousBalance.toString()).toBe('100');
        expect(plan.amount.toString()).toBe('33.33');
        expect(plan.remainingBalance.toString()).toBe('66.67');
        expect(plan.nextStatus).toBe('PARTIALLY_PAID');
        expect(plan.paidInFull).toBe(false);
    });

    it('un monto omitido liquida el saldo completo por compatibilidad', () => {
        const plan = resolveSupplierPaymentPlan({
            total: '100',
            balanceDue: '42.25',
            status: 'PARTIALLY_PAID',
        }, undefined, false);
        expect(plan.amount.toString()).toBe('42.25');
        expect(plan.remainingBalance.toString()).toBe('0');
        expect(plan.nextStatus).toBe('COMPLETED');
        expect(plan.paidInFull).toBe(true);
    });

    it('permite monto explícito completo sin clientEventId pero no uno parcial', () => {
        expect(resolveSupplierPaymentPlan({
            total: '100', balanceDue: '100', status: 'PENDING_PAYMENT',
        }, '100', false).nextStatus).toBe('COMPLETED');
        const partialError = captureError(() => resolveSupplierPaymentPlan({
            total: '100', balanceDue: '100', status: 'PENDING_PAYMENT',
        }, '99.99', false));
        expect(partialError.code).toBe('PARTIAL_PAYMENT_REQUIRES_CLIENT_EVENT_ID');
        expect(partialError.message).toBe(
            'Los abonos parciales requieren clientEventId para evitar duplicados',
        );
    });

    it('distingue compra saldada y sobrepago con códigos estables', () => {
        const alreadyPaid = captureError(() => resolveSupplierPaymentPlan({
            total: '100', balanceDue: '0', status: 'COMPLETED',
        }, undefined, false));
        expect(alreadyPaid.code).toBe('PURCHASE_ALREADY_PAID');
        expect(alreadyPaid.message).toBe('La compra ya está pagada');
        expect(captureError(() => resolveSupplierPaymentPlan({
            total: '100', balanceDue: '100', status: 'COMPLETED',
        }, undefined, false)).code).toBe('PURCHASE_ALREADY_PAID');
        const overpayment = captureError(() => resolveSupplierPaymentPlan({
            total: '100', balanceDue: '25', status: 'PARTIALLY_PAID',
        }, '25.01', true));
        expect(overpayment.code).toBe('PAYMENT_EXCEEDS_BALANCE');
        expect(overpayment.message).toBe('El pago excede el saldo pendiente de la compra');
    });

    it.each(['DRAFT', 'CANCELLED', 'RECEIVED', ''])(
        'rechaza explícitamente el estado no pagable %s aunque tenga balanceDue',
        (status) => {
            const error = captureError(() => resolveEffectiveSupplierBalance({
                total: '100', balanceDue: '100', status,
            }));
            expect(error.code).toBe('PURCHASE_NOT_PAYABLE');
            expect(error.message).toBe(
                `La compra en estado ${status || 'desconocido'} no admite pagos`,
            );
        },
    );

    it('genera una huella estable para reintentos semánticamente iguales', () => {
        const left = buildSupplierPaymentPayloadHash(' purchase-1 ', {
            amount: '10.5000',
            method: 'transfer',
            clientEventId: 'event-0001',
            reference: ' REF-1 ',
            notes: ' pago ',
        });
        const right = buildSupplierPaymentPayloadHash('purchase-1', {
            amount: '10.5',
            method: 'TRANSFER',
            clientEventId: 'another-event',
            reference: 'REF-1',
            notes: 'pago',
        });
        expect(left).toMatch(/^[a-f0-9]{64}$/);
        expect(right).toBe(left);
    });

    it('la huella cambia con cada parte económica de la intención', () => {
        const base = buildSupplierPaymentPayloadHash('purchase-1', {
            amount: '10', method: 'CASH', reference: 'R1', notes: 'N1',
        });
        expect(buildSupplierPaymentPayloadHash('purchase-2', {
            amount: '10', method: 'CASH', reference: 'R1', notes: 'N1',
        })).not.toBe(base);
        expect(buildSupplierPaymentPayloadHash('purchase-1', {
            amount: '11', method: 'CASH', reference: 'R1', notes: 'N1',
        })).not.toBe(base);
        expect(buildSupplierPaymentPayloadHash('purchase-1', {
            amount: '10', method: 'QR', reference: 'R1', notes: 'N1',
        })).not.toBe(base);
        expect(buildSupplierPaymentPayloadHash('purchase-1', {
            amount: '10', method: 'CASH', reference: 'R2', notes: 'N1',
        })).not.toBe(base);
        expect(buildSupplierPaymentPayloadHash('purchase-1', {
            amount: '10', method: 'CASH', reference: 'R1', notes: 'N2',
        })).not.toBe(base);
        expect(buildSupplierPaymentPayloadHash('purchase-1')).not.toBe(base);
    });

    it('acepta replay exacto y rechaza reutilización conflictiva', () => {
        const hash = buildSupplierPaymentPayloadHash('purchase-1', { amount: '10' });
        expect(() => assertMatchingSupplierPaymentReplay({ payloadHash: hash }, hash)).not.toThrow();
        const error = captureError(() => assertMatchingSupplierPaymentReplay(
            { payloadHash: 'otro-hash' },
            hash,
        ));
        expect(error.code).toBe('PAYMENT_IDEMPOTENCY_CONFLICT');
        expect(error.httpStatus).toBe(409);
        expect(error.message).toBe(
            'clientEventId ya fue usado con una intención de pago distinta',
        );
    });
});

describe('asiento de pago a proveedor', () => {
    it('debe CxP y acredita Caja exclusivamente para CASH', () => {
        expect(buildSupplierPaymentJournalLines('12.34')).toEqual([
            { accountCode: '2.1.1', debit: 12.34, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: 12.34 },
        ]);
    });

    it.each(['TRANSFER', 'CARD', 'QR'] as const)(
        'debe CxP y acredita Bancos para %s',
        (method) => {
            expect(buildSupplierPaymentJournalLines('5.25', method)).toEqual([
                { accountCode: '2.1.1', debit: 5.25, credit: 0 },
                { accountCode: '1.1.2', debit: 0, credit: 5.25 },
            ]);
        },
    );

    it('comparte la validación decimal estricta con el servicio', () => {
        expect(() => buildSupplierPaymentJournalLines('1.001', 'CASH')).toThrow(
            'amount admite como máximo 2 decimales',
        );
        expect(() => buildSupplierPaymentJournalLines('0', 'CASH')).toThrow(
            'amount debe ser mayor que cero',
        );
    });
});
