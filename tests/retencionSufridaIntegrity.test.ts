import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CreateRetencionSufridaSchema } from '../backend/validation/schemas';

const root = process.cwd();
const server = fs.readFileSync(path.join(root, 'backend/server.ts'), 'utf8');
const prismaSchema = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
    path.join(root, 'backend/prisma/migrations/20260827_retencion_sufrida_idempotency/migration.sql'),
    'utf8',
);

const routeStart = server.indexOf("app.post('/api/accounting/retenciones-sufridas'");
const routeEnd = server.indexOf("app.get('/api/accounting/retenciones-sufridas'", routeStart);
const route = server.slice(routeStart, routeEnd);
const modelStart = prismaSchema.indexOf('model RetencionSufrida {');
const modelEnd = prismaSchema.indexOf('\n}', modelStart);
const model = prismaSchema.slice(modelStart, modelEnd);

const validPayload = {
    saleId: 'sale-tenant-a',
    clientEventId: 'c1697c4e-4a8d-4d8f-a65d-86f597c58242',
    fecha: '2026-08-27',
    clienteRetenedor: '  Alcaldía de Managua  ',
    tipo: 'IMI_1' as const,
    baseAmount: '1500.00',
    amount: '15.00',
    numeroConstancia: '  IMI-2026-0042  ',
};

describe('CreateRetencionSufridaSchema — frontera financiera', () => {
    it('exige vínculo reconciliable y normaliza texto/día civil', () => {
        const result = CreateRetencionSufridaSchema.safeParse(validPayload);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data).toEqual({
            ...validPayload,
            clienteRetenedor: 'Alcaldía de Managua',
            numeroConstancia: 'IMI-2026-0042',
        });
    });

    it('rechaza saleId o UUID omitidos aunque la BD conserve históricos nullable', () => {
        const { saleId: _saleId, ...withoutSaleId } = validPayload;
        const { clientEventId: _clientEventId, ...withoutClientEventId } = validPayload;
        expect(CreateRetencionSufridaSchema.safeParse(withoutSaleId).success).toBe(false);
        expect(CreateRetencionSufridaSchema.safeParse(withoutClientEventId).success).toBe(false);
    });

    it('proyecta datetimes con offset al día fiscal de Managua', () => {
        const result = CreateRetencionSufridaSchema.safeParse({
            ...validPayload,
            // Todavía es 26 de agosto en Managua (UTC-6).
            fecha: '2026-08-27T05:30:00.000Z',
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.fecha).toBe('2026-08-26');
    });

    it.each([
        ['prefijo parcial', '12abc'],
        ['separador ambiguo', '1,500.00'],
        ['infinito', 'Infinity'],
        ['notación fuera de rango', '1e400'],
        ['cero', '0'],
        ['negativo', '-1'],
        ['más de dos decimales', '15.001'],
        ['fuera de Decimal(12,2)', '10000000000.00'],
    ])('rechaza amount %s (%s)', (_label, amount) => {
        expect(CreateRetencionSufridaSchema.safeParse({
            ...validPayload,
            amount,
        }).success).toBe(false);
    });

    it('rechaza una retención mayor que su base', () => {
        const result = CreateRetencionSufridaSchema.safeParse({
            ...validPayload,
            baseAmount: '10.00',
            amount: '10.01',
        });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues.some(issue => issue.path.join('.') === 'amount')).toBe(true);
    });

    it.each(['', '2026-02-30', '2026-08-27T05:30:00', '27/08/2026'])('rechaza fecha ambigua o inválida: %s', (fecha) => {
        expect(CreateRetencionSufridaSchema.safeParse({
            ...validPayload,
            fecha,
        }).success).toBe(false);
    });

    it('rechaza UUID inválido y tenantId inyectado por el cliente', () => {
        expect(CreateRetencionSufridaSchema.safeParse({
            ...validPayload,
            clientEventId: 'retry-1',
        }).success).toBe(false);
        expect(CreateRetencionSufridaSchema.safeParse({
            ...validPayload,
            tenantId: 'otro-tenant',
        }).success).toBe(false);
    });
});

describe('RetencionSufrida — persistencia idempotente', () => {
    it('declara columnas nullable para históricos y UNIQUE por tenant+evento', () => {
        expect(model).toMatch(/clientEventId\s+String\?\s+@db\.VarChar\(128\)/);
        expect(model).toMatch(/payloadHash\s+String\?\s+@db\.VarChar\(64\)/);
        expect(model).toContain('@@unique([tenantId, clientEventId])');
    });

    it('incluye una migración MySQL expand-only equivalente', () => {
        expect(migration).toContain('ALTER TABLE `RetencionSufrida`');
        expect(migration).toContain('ADD COLUMN `clientEventId` VARCHAR(128) NULL');
        expect(migration).toContain('ADD COLUMN `payloadHash` VARCHAR(64) NULL');
        expect(migration).toContain('CREATE UNIQUE INDEX `RetencionSufrida_tenantId_clientEventId_key`');
        expect(migration).toContain('ON `RetencionSufrida`(`tenantId`, `clientEventId`)');
        expect(migration).not.toMatch(/DROP|DELETE|UPDATE\s+`RetencionSufrida`/);
    });
});

describe('POST retenciones sufridas — replay, aislamiento y atomicidad', () => {
    it('monta autenticación, rol y Zod antes del handler', () => {
        expect(route).toContain(
            "authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), validate(CreateRetencionSufridaSchema)",
        );
    });

    it('construye un hash canónico sin pasar dinero por Number', () => {
        expect(route).toContain("baseAmount: base.toFixed(2)");
        expect(route).toContain("amount: amt.toFixed(2)");
        expect(route).toContain("numeroConstancia: numeroConstancia ?? null");
        expect(route).toContain('saleId,');
        expect(route).toContain("crypto.createHash('sha256')");
        expect(route).not.toContain('new Decimal(Number(');
        expect(route).not.toContain('parseFloat(');
    });

    it('aísla y bloquea Sale + Customer con el tenant autenticado en orden estable', () => {
        expect(route).toContain('where: { tenantId: authReq.tenantId!, clientEventId }');
        const saleLock = route.indexOf('FROM \\`Sale\\`');
        const customerLock = route.indexOf('FROM \\`Customer\\`');
        const replayLookup = route.indexOf('tx.retencionSufrida.findFirst');
        expect(saleLock).toBeGreaterThan(-1);
        expect(route.slice(saleLock, customerLock)).toContain('tenantId = ${authReq.tenantId!}');
        expect(customerLock).toBeGreaterThan(saleLock);
        expect(route.slice(customerLock, replayLookup)).toContain('tenantId = ${authReq.tenantId!}');
        expect(replayLookup).toBeGreaterThan(customerLock);
        expect(route.match(/FOR UPDATE`/g)).toHaveLength(2);
        expect(route).toContain("throw new Error('RETENCION_SALE_NOT_FOUND')");
        expect(route).toContain("throw new Error('RETENCION_CUSTOMER_NOT_FOUND')");
    });

    it('solo liquida una CxC abierta, impone el saldo y reconcilia ambos agregados', () => {
        expect(route).toContain("lockedSale.paymentMethod !== 'CREDIT'");
        expect(route).toContain("throw new Error('RETENCION_SALE_SETTLED')");
        expect(route).toContain("throw new Error('RETENCION_EXCEEDS_BALANCE')");
        expect(route).toContain('const balanceAfter = balanceBefore.minus(amt).toDecimalPlaces(2);');
        expect(route).toContain("const statusAfter = balanceAfter.isZero() ? 'PAID' : 'CREDIT_PENDING';");
        expect(route).toContain('const debtAfter = Decimal.max(0, debtBefore.minus(amt)).toDecimalPlaces(2);');
        expect(route).toContain('const saleUpdated = await tx.sale.updateMany({');
        expect(route).toContain('where: { id: saleId, tenantId: authReq.tenantId! }');
        expect(route).toContain('const customerUpdated = await tx.customer.updateMany({');
        expect(route).toContain('where: { id: lockedCustomer.id, tenantId: authReq.tenantId! }');
    });

    it('crea retención, asiento trazable y auditoría en la misma transacción', () => {
        const txStart = route.indexOf('await prisma.$transaction');
        const createIndex = route.indexOf('tx.retencionSufrida.create', txStart);
        const journalIndex = route.indexOf('await createJournalEntry', createIndex);
        const auditIndex = route.indexOf('await tx.auditLog.create', journalIndex);
        const txEnd = route.indexOf('return { retencionId: retencion.id, idempotentReplay: false }', auditIndex);

        expect(txStart).toBeGreaterThanOrEqual(0);
        expect(createIndex).toBeGreaterThan(txStart);
        expect(journalIndex).toBeGreaterThan(createIndex);
        expect(auditIndex).toBeGreaterThan(journalIndex);
        expect(txEnd).toBeGreaterThan(auditIndex);
        expect(route.slice(journalIndex, auditIndex)).toContain("retencion.id, 'RETENCION_SUFRIDA'");
        expect(route.slice(auditIndex, txEnd)).toContain("action: 'RETENCION_SUFRIDA_CREATE'");
        expect(route.slice(auditIndex, txEnd)).toContain('before: {');
        expect(route.slice(auditIndex, txEnd)).toContain('balance: balanceBefore.toFixed(2)');
        expect(route.slice(auditIndex, txEnd)).toContain('currentDebt: debtBefore.toFixed(2)');
        expect(route.slice(auditIndex, txEnd)).toContain('balance: balanceAfter.toFixed(2)');
        expect(route.slice(auditIndex, txEnd)).toContain('currentDebt: debtAfter.toFixed(2)');
        expect(route.slice(auditIndex, txEnd)).toContain('after: {');
    });

    it('clasifica replay, conflicto de payload y la carrera P2002 sin duplicar efectos', () => {
        expect(route).toContain("throw new Error('RETENCION_IDEMPOTENCY_CONFLICT')");
        expect(route).toContain("error?.code === 'P2002' && clientEventId");
        expect(route).toContain("code: 'RETENCION_IDEMPOTENCY_CONFLICT'");
        expect(route).toContain('idempotentReplay: true');
        expect(route).toContain('result.idempotentReplay ? 200 : 201');
        expect(route).not.toContain('error instanceof Error ? error.message');
    });

    it('expone 400/404/409 específicos sin filtrar errores internos', () => {
        expect(route).toContain("res.status(404).json({");
        expect(route).toContain("RETENCION_SALE_NOT_CREDIT: 'La factura seleccionada no es una venta a crédito.'");
        expect(route).toContain("RETENCION_SALE_SETTLED: 'La factura seleccionada ya no tiene saldo pendiente.'");
        expect(route).toContain("RETENCION_EXCEEDS_BALANCE: 'La retención excede el saldo pendiente de la factura.'");
        expect(route).toContain("return res.status(400).json({ error: businessErrors[error.message], code: error.message });");
        expect(route).toContain("return res.status(409).json({");
    });

    it('normaliza el día de calendario antes de persistir/asentar', () => {
        expect(route).toContain('const day = normalizeCalendarDateInput(fecha);');
        expect(route).toContain('fecha: day');
        expect(route).toContain('{ isAutomatic: true, date: day }');
        expect(route).not.toContain('new Date(fecha)');
    });
});
