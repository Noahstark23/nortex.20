import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPaymentJournalLines } from '../backend/services/accounting';
import { CreatePaymentSchema } from '../backend/validation/schemas';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const schema = readFileSync(resolve(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
    resolve(process.cwd(), 'backend/prisma/migrations/20260827_customer_relationship_hub/migration.sql'),
    'utf8',
);
const paymentHandler = server.slice(
    server.indexOf('async function registerCreditPayment('),
    server.indexOf('// POST /api/credits/:saleId/writeoff'),
);

describe('integridad de abonos de clientes', () => {
    it('contabiliza efectivo en Caja y medios electrónicos en Bancos', () => {
        expect(buildPaymentJournalLines('25.55')).toEqual([
            { accountCode: '1.1.1', debit: 25.55, credit: 0 },
            { accountCode: '1.1.3', debit: 0, credit: 25.55 },
        ]);

        for (const method of ['CARD', 'TRANSFER', 'QR'] as const) {
            expect(buildPaymentJournalLines('25.50', method)[0]).toEqual({
                accountCode: '1.1.2',
                debit: 25.5,
                credit: 0,
            });
        }
    });

    it('rechaza montos inválidos y crédito como método de un abono', () => {
        expect(() => buildPaymentJournalLines(Symbol('monto') as never)).toThrowError('amount no es un monto decimal válido');
        expect(() => buildPaymentJournalLines('0')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('-1')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('NaN')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('Infinity')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('1.001')).toThrowError('amount no cabe en el rango monetario permitido');
        expect(() => buildPaymentJournalLines('100000000')).toThrowError('amount no cabe en el rango monetario permitido');
        expect(CreatePaymentSchema.safeParse({
            saleId: 'sale-1',
            amount: '10',
            method: 'CREDIT',
            clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8277',
        }).success).toBe(false);
        expect(CreatePaymentSchema.safeParse({
            saleId: 'sale-1',
            amount: '10.25',
            method: 'TRANSFER',
            clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8277',
        }).success).toBe(true);
    });

    it('rechaza abonos actuales sin UUID idempotente antes de ejecutar el handler', () => {
        const basePayment = { saleId: 'sale-1', amount: '10.25', method: 'CASH' };

        expect(CreatePaymentSchema.safeParse(basePayment).success).toBe(false);
        expect(CreatePaymentSchema.safeParse({ ...basePayment, clientEventId: null }).success).toBe(false);
        expect(CreatePaymentSchema.safeParse({ ...basePayment, clientEventId: '' }).success).toBe(false);
        expect(paymentHandler).not.toContain('if (clientEventId)');
        expect(paymentHandler).not.toContain('clientEventId: clientEventId ?? null');
        expect(paymentHandler).toContain('where: { saleId, clientEventId }');
        expect(paymentHandler).toContain('clientEventId,\n                    payloadHash,');
    });

    it('hace que el alias legacy y la ruta canónica compartan un único handler protegido', () => {
        expect(server).toContain("'/api/payments',\n    authenticate,\n    checkRole(CUSTOMER_PAYMENT_ROLES)");
        expect(server).toContain("'/api/credits/payment',\n    authenticate,\n    checkRole(CUSTOMER_PAYMENT_ROLES)");
        expect(server.match(/registerCreditPayment,/g)).toHaveLength(2);
        expect(server).toContain('async function lockCustomerForScopedMutation(');
        expect(server).toContain('SELECT s.id, s.customerId, s.customerName, s.paymentMethod,');
        expect(server).toContain('await lockCustomerForScopedMutation(tx, authReq, lockedSale.customerId)');
        expect(server).toContain('FOR UPDATE`');
        expect(server).toContain("throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT')");
    });

    it('persiste la llave idempotente aditiva sin obligar históricos', () => {
        const paymentModel = schema.slice(schema.indexOf('model Payment {'), schema.indexOf('model Expense {'));
        expect(paymentModel).toMatch(/clientEventId\s+String\?/);
        expect(paymentModel).toMatch(/payloadHash\s+String\?/);
        expect(paymentModel).toContain('@@unique([saleId, clientEventId])');
        expect(migration).toContain('ADD COLUMN `clientEventId` VARCHAR(128) NULL');
        expect(migration).toContain('ADD COLUMN `payloadHash` VARCHAR(64) NULL');
        expect(migration).toContain('CREATE UNIQUE INDEX `Payment_saleId_clientEventId_key`');
    });
});
