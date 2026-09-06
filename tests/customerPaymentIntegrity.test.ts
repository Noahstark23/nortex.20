import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPaymentJournalLines } from '../backend/services/accounting';
import { CreatePaymentSchema } from '../backend/validation/schemas';
import { calcularEfectivoTurno } from '../utils/margen';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const shiftCloseService = readFileSync(resolve(process.cwd(), 'backend/services/shiftCloseService.ts'), 'utf8');
const schema = readFileSync(resolve(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
    resolve(process.cwd(), 'backend/prisma/migrations/20260827_customer_relationship_hub/migration.sql'),
    'utf8',
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

    it('rechaza montos inválidos y crédito como método', () => {
        expect(() => buildPaymentJournalLines(Symbol('monto') as never)).toThrowError('amount no es un monto decimal válido');
        expect(() => buildPaymentJournalLines('0')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('-1')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('NaN')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('Infinity')).toThrowError('amount debe ser finito y mayor que cero');
        expect(() => buildPaymentJournalLines('1.001')).toThrowError('amount no cabe en el rango monetario permitido');
        expect(() => buildPaymentJournalLines('100000000')).toThrowError('amount no cabe en el rango monetario permitido');
        expect(CreatePaymentSchema.safeParse({ saleId: 'sale-1', amount: '10', method: 'CREDIT' }).success).toBe(false);
    });

    it('exige un UUID idempotente en cada abono nuevo', () => {
        expect(CreatePaymentSchema.safeParse({ saleId: 'sale-1', amount: '10', method: 'TRANSFER' }).success).toBe(false);
        expect(CreatePaymentSchema.safeParse({
            saleId: 'sale-1',
            amount: '10.25',
            method: 'TRANSFER',
            clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8277',
        }).success).toBe(true);
    });

    it('hace que el alias legacy y la ruta canónica compartan un único handler protegido', () => {
        expect(server).toContain("'/api/payments',\n    authenticate,\n    checkRole(CUSTOMER_PAYMENT_ROLES)");
        expect(server).toContain("'/api/credits/payment',\n    authenticate,\n    checkRole(CUSTOMER_PAYMENT_ROLES)");
        expect(server.match(/registerCreditPayment,/g)).toHaveLength(2);
        expect(server).toContain('SELECT s.id, s.customerId, s.customerName, s.paymentMethod,');
        expect(server).toContain('FOR UPDATE`');
        expect(server).toContain("throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT')");
        expect(server).toContain("const saleUpdated = await tx.sale.updateMany({");
        expect(server).toContain("where: { id: saleId, tenantId: authReq.tenantId! },");
        expect(server).toContain("const customerUpdated = await tx.customer.updateMany({");
        expect(server).toContain("where: { id: lockedSale.customerId, tenantId: authReq.tenantId! },");
    });

    it('liga cada abono CASH nuevo a la caja autoritativa y el replay no duplica el arqueo', () => {
        const handlerStart = server.indexOf('async function registerCreditPayment');
        const handlerEnd = server.indexOf('// POST /api/credits/:saleId/writeoff', handlerStart);
        const handler = server.slice(handlerStart, handlerEnd);

        const saleLock = handler.indexOf('SELECT s.id, s.customerId');
        const replayGuard = handler.indexOf('if (clientEventId)');
        const cashBranch = handler.indexOf("if (method === 'CASH')");
        const shiftLock = handler.indexOf('FROM \\`Shift\\`', cashBranch);
        const paymentCreate = handler.indexOf('const payment = await tx.payment.create');
        const movementCreate = handler.indexOf('const cashMovement = await appendSignedCashMovement');
        const replayReturn = handler.indexOf('return { replayed: true, paymentId: replay.id }');

        expect(saleLock).toBeGreaterThan(-1);
        expect(replayGuard).toBeGreaterThan(saleLock);
        expect(replayReturn).toBeGreaterThan(replayGuard);
        expect(cashBranch).toBeGreaterThan(replayReturn);
        expect(shiftLock).toBeGreaterThan(cashBranch);
        expect(paymentCreate).toBeGreaterThan(shiftLock);
        expect(movementCreate).toBeGreaterThan(paymentCreate);

        // Tenant/usuario vienen del JWT; el body no decide la caja.
        expect(handler).toContain('WHERE \\`tenantId\\` = ${authReq.tenantId!}');
        expect(handler).toContain('AND \\`userId\\` = ${authReq.userId!}');
        expect(handler).not.toContain('req.body.shiftId');
        expect(handler).toContain('if (ownOpenShifts.length > 1)');
        expect(handler).toContain("if (!cashShiftId) throw new Error('PAYMENT_OPEN_SHIFT_REQUIRED')");
        expect(handler).toContain("throw new Error('PAYMENT_OPEN_SHIFT_AMBIGUOUS')");

        // Un único IN firmado alimenta la fórmula del cierre Z; los medios no
        // CASH nunca entran a esta rama y recordPayment conserva su asiento.
        expect(handler.match(/appendSignedCashMovement/g)).toHaveLength(1);
        expect(handler).toContain('shiftId: cashShiftId');
        expect(handler).toContain("type: 'IN'");
        expect(handler).toContain('amount: paymentAmount.toFixed(2)');
        expect(handler).not.toContain('amount: paymentAmount.toNumber()');
        expect(handler).toContain("currency: 'NIO'");
        expect(handler).toContain("category: 'COBRO_CREDITO'");
        expect(handler).toContain('cashShiftId,');
        expect(handler).toContain('cashMovementId,');
        expect(shiftCloseService).toContain("tx.cashMovement.groupBy({");
        expect(shiftCloseService).toContain("where: { tenantId: command.tenantId, shiftId: locked.id, isVoided: false }");

        const drawer = calcularEfectivoTurno({
            initialCash: '100.00',
            initialCashUsd: '0',
            cashSales: '0',
            movimientos: [{
                type: 'IN',
                amount: '25.50',
                currency: 'NIO',
                category: 'COBRO_CREDITO',
            }],
        });
        expect(drawer.efectivoNIO.toFixed(2)).toBe('125.50');
        expect(drawer.desglose.manualINs.toFixed(2)).toBe('25.50');

        const voidStart = server.indexOf("app.post('/api/cash-movements/:id/void'");
        const voidEnd = server.indexOf('// ==========================================\n// 📦 INVENTORY', voidStart);
        const voidHandler = server.slice(voidStart, voidEnd);
        // El rechazo COBRO_CREDITO se prueba ejecutando el servicio en
        // manualCashMovementVoid.test.ts y por HTTP + MySQL en su integración.
        expect(voidHandler).toContain('voidManualCashMovement(');
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

    it('mantiene el castigo de incobrables scopeado por tenant y habilita super admin igual que la UI', () => {
        expect(server).toContain("app.post('/api/credits/:saleId/writeoff', authenticate, checkRole(['OWNER', 'ADMIN', 'SUPER_ADMIN'])");
        expect(server).toContain('FROM \\`Sale\\`');
        expect(server).toContain('WHERE id = ${saleId} AND tenantId = ${authReq.tenantId!}');
        expect(server).toContain('SELECT currentDebt FROM \\`Customer\\`');
        expect(server).toContain('WHERE id = ${sale.customerId} AND tenantId = ${authReq.tenantId!}');
        expect(server).toContain("data: { currentDebt: newDebt.toFixed(2) }");
    });
});
