import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { closeShiftWithReport, type CloseShiftCommand } from '../backend/services/shiftCloseService';

const command: CloseShiftCommand = {
    tenantId: 'tenant-a', userId: 'user-a', role: 'CASHIER', shiftId: 'shift-a',
    declaredCash: '215.00', declaredCashUsd: '20.1234', auditNotes: 'Todo conciliado',
    clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8278',
};
const fixedNow = () => new Date('2026-09-04T18:00:00Z');
const decimal = (value: string) => new Prisma.Decimal(value);

// Adaptador determinista para el servicio real. Simula rollback, pero no
// pretende demostrar locks ni concurrencia de MySQL: esa es otra compuerta.
function fixture() {
    let shift: any = {
        id: 'shift-a', tenantId: 'tenant-a', userId: 'user-a', employeeId: null,
        initialCash: decimal('100'), initialCashUsd: decimal('20.1234'), status: 'OPEN',
        startTime: new Date('2026-09-04T12:00:00Z'), endTime: null,
        finalCashDeclared: null, finalCashDeclaredUsd: null,
        closeEventId: null, closePayloadHash: null,
    };
    let report: any = null;
    let audits: any[] = [];
    const tx: any = {
        $queryRaw: vi.fn(async (query: Prisma.Sql) => {
            if (query.sql.includes('FROM `Shift`')) {
                return query.values.includes(shift.id) && query.values.includes(shift.tenantId) ? [{ ...shift }] : [];
            }
            if (query.sql.includes('AS returnCount')) return [{ returnCount: 0, returnLineCount: 0 }];
            if (query.sql.includes('AS vatCollected')) return [{ vatCollected: decimal('0') }];
            return [];
        }),
        shift: {
            findFirst: vi.fn(async ({ select }: any) => select ? {
                user: { name: 'Caja', email: null }, employee: null,
                tenant: { businessName: 'Comercio QA', taxId: '', address: null, phone: null, theftAlertThreshold: decimal('500') },
            } : { ...shift }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (where.tenantId !== shift.tenantId || where.id !== shift.id || where.status !== shift.status) return { count: 0 };
                shift = { ...shift, ...data };
                return { count: 1 };
            }),
        },
        sale: { groupBy: vi.fn(async () => [{ paymentMethod: 'CASH', _sum: { total: decimal('115'), storeCreditApplied: decimal('0') }, _count: { _all: 1 } }]) },
        cashMovement: { groupBy: vi.fn(async () => []) },
        tenant: { findUnique: vi.fn(async () => ({ theftAlertThreshold: decimal('0') })) },
        user: { findFirst: vi.fn(async () => ({ name: 'Caja', email: null })) },
        shiftCloseReport: {
            findUnique: vi.fn(async () => report),
            create: vi.fn(async ({ data }: any) => { report = { id: 'report-a', ...data }; return report; }),
        },
        auditLog: { create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }) },
    };
    const client: any = {
        $transaction: vi.fn(async (run: (value: any) => Promise<unknown>) => {
            const before = { shift: { ...shift }, report, audits: [...audits] };
            try { return await run(tx); } catch (error) {
                shift = before.shift; report = before.report; audits = before.audits;
                throw error;
            }
        }),
    };
    return { tx, client, state: () => ({ shift, report, audits }), setShift: (values: object) => { shift = { ...shift, ...values }; } };
}

describe('identidad del cierre con reporte', () => {
    it('conserva USD4 en estado, reporte y auditoría; un retry canónico no recalcula ni escribe', async () => {
        const f = fixture();
        const first = await closeShiftWithReport(command, f.client, fixedNow);
        const snapshot = JSON.stringify(f.state());
        const retry = await closeShiftWithReport({ ...command, declaredCash: '215.0', auditNotes: '  Todo conciliado  ' }, f.client,
            () => new Date('2026-09-05T18:00:00Z'));
        expect(first.idempotentReplay).toBe(false);
        expect(retry.idempotentReplay).toBe(true);
        expect(retry.closeReport).toEqual(first.closeReport);
        expect(retry.theftAlert).toBe(false);
        expect(JSON.stringify(f.state())).toBe(snapshot);
        expect(f.state().shift).toMatchObject({
            finalCashDeclared: '215.00', finalCashDeclaredUsd: '20.1234',
            systemExpectedUsd: '20.1234', differenceUsd: '0.0000',
            closeEventId: command.clientEventId, closePayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        expect(first.closeReport.report.cash).toMatchObject({ countedUsd: '20.1234', expectedUsd: '20.1234', differenceUsd: '0.0000' });
        expect(JSON.parse(f.state().audits[0].details)).toMatchObject({
            countedUsd: '20.1234', expectedUsd: '20.1234', differenceUsd: '0.0000',
            closeEventId: command.clientEventId, closePayloadHash: f.state().shift.closePayloadHash,
        });
        expect(f.tx.sale.groupBy).toHaveBeenCalledTimes(1);
        expect(f.tx.cashMovement.groupBy).toHaveBeenCalledTimes(1);
        expect(f.tx.shift.updateMany).toHaveBeenCalledTimes(1);
        expect(f.tx.shiftCloseReport.create).toHaveBeenCalledTimes(1);
        expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it.each([
        { auditNotes: 'Falta dinero' }, { declaredCash: '214.99' }, { declaredCashUsd: '20.1235' },
        { clientEventId: '5ac0efc2-fb48-48c8-936a-9bf4dbdf8278' },
    ])('rechaza otra intención o identidad aunque el resto coincida: %j', async (change) => {
        const f = fixture();
        await closeShiftWithReport(command, f.client, fixedNow);
        const snapshot = JSON.stringify(f.state());
        await expect(closeShiftWithReport({ ...command, ...change }, f.client, fixedNow))
            .rejects.toMatchObject({ httpStatus: 409 });
        expect(JSON.stringify(f.state())).toBe(snapshot);
        expect(f.tx.shift.updateMany).toHaveBeenCalledTimes(1);
        expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('los clientes sin UUID repiten solo el mismo comando canónico', async () => {
        const f = fixture();
        const legacy = { ...command, clientEventId: undefined };
        await closeShiftWithReport(legacy, f.client, fixedNow);
        expect(f.state().shift.closeEventId).toMatch(/^legacy:[a-f0-9]{64}$/);
        expect((await closeShiftWithReport(legacy, f.client, fixedNow)).idempotentReplay).toBe(true);
        await expect(closeShiftWithReport({ ...legacy, auditNotes: 'Otra revisión' }, f.client, fixedNow))
            .rejects.toMatchObject({ httpStatus: 409 });
    });

    it('no acredita un retry histórico sin identidad registrada', async () => {
        const f = fixture();
        await closeShiftWithReport(command, f.client, fixedNow);
        f.setShift({ closeEventId: null, closePayloadHash: null });
        await expect(closeShiftWithReport(command, f.client, fixedNow)).rejects.toMatchObject({ httpStatus: 409 });
        expect(f.tx.shiftCloseReport.create).toHaveBeenCalledTimes(1);
    });

    it('no acredita un replay si el estado o los importes persistidos contradicen el cierre', async () => {
        const f = fixture();
        await closeShiftWithReport(command, f.client, fixedNow);
        f.setShift({ status: 'CANCELLED' });
        await expect(closeShiftWithReport(command, f.client, fixedNow)).rejects.toMatchObject({ httpStatus: 409 });
        f.setShift({ status: 'CLOSED', finalCashDeclaredUsd: '20.1235' });
        await expect(closeShiftWithReport(command, f.client, fixedNow)).rejects.toMatchObject({ httpStatus: 409 });
        expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('la colisión tenant/evento revierte todo y devuelve conflicto en vez de éxito', async () => {
        const f = fixture();
        f.tx.shift.updateMany.mockRejectedValueOnce(Object.assign(new Error('UUID reutilizada'), { code: 'P2002' }));
        await expect(closeShiftWithReport(command, f.client, fixedNow)).rejects.toMatchObject({
            code: 'SHIFT_CLOSE_CONFLICT', httpStatus: 409,
        });
        expect(f.state().shift.status).toBe('OPEN');
        expect(f.state().report).toBeNull();
        expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('un claim perdido no genera documento ni auditoría', async () => {
        const f = fixture();
        f.tx.shift.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(closeShiftWithReport(command, f.client, fixedNow)).rejects.toMatchObject({ httpStatus: 409 });
        expect(f.tx.shiftCloseReport.create).not.toHaveBeenCalled();
        expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    });

    it.each([
        [{ tenantId: 'tenant-b' }, 404], [{ userId: 'user-b' }, 403],
    ] as const)('rechaza acceso ajeno antes de leer el reporte: %j', async (change, status) => {
        const f = fixture();
        await expect(closeShiftWithReport({ ...command, ...change }, f.client, fixedNow))
            .rejects.toMatchObject({ httpStatus: status });
        expect(f.tx.shiftCloseReport.findUnique).not.toHaveBeenCalled();
        expect(f.tx.shift.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        { declaredCash: '215.001' }, { declaredCash: '-1' }, { declaredCash: 'NaN' },
        { declaredCash: '100000000' }, { declaredCashUsd: '20.12345' }, { clientEventId: 'invalid' },
    ])('rechaza entrada no persistible antes de iniciar transacción: %j', async (change) => {
        const f = fixture();
        await expect(closeShiftWithReport({ ...command, ...change }, f.client, fixedNow)).rejects.toMatchObject({ httpStatus: 400 });
        expect(f.client.$transaction).not.toHaveBeenCalled();
    });

    it('revierte el estado y el reporte si no puede persistir auditoría', async () => {
        const f = fixture();
        f.tx.auditLog.create.mockRejectedValueOnce(new Error('Auditoría no disponible'));
        await expect(closeShiftWithReport(command, f.client, fixedNow)).rejects.toThrow('Auditoría no disponible');
        expect(f.state().shift.status).toBe('OPEN');
        expect(f.state().shift.closeEventId).toBeNull();
        expect(f.state().report).toBeNull();
        expect(f.state().audits).toEqual([]);
    });
});
